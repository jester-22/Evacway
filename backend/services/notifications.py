import json

from flask import current_app

from models import PushSubscription, StaffNotification, User, db


STAFF_ROLES = ('admin', 'lgu_personnel')


def create_staff_notifications(
    event_type,
    resource_type,
    resource_id,
    title,
    message,
    is_emergency=False,
):
    recipients = User.query.filter(
        User.is_active.is_(True),
        User.role.in_(STAFF_ROLES),
    ).all()
    notifications = [
        StaffNotification(
            user_id=user.id,
            event_type=event_type,
            resource_type=resource_type,
            resource_id=resource_id,
            title=title,
            message=message,
            is_emergency=is_emergency,
        )
        for user in recipients
    ]
    db.session.add_all(notifications)
    db.session.flush()
    return notifications


from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

_push_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix='evacway-push')


def _async_send_staff_push_notifications(app, notif_data):
    with app.app_context():
        public_key = app.config.get('VAPID_PUBLIC_KEY')
        private_key = app.config.get('VAPID_PRIVATE_KEY')
        subject = app.config.get('VAPID_CLAIMS_SUB')
        if not public_key or not private_key or not subject or not notif_data:
            return

        try:
            from pywebpush import WebPushException, webpush
        except ImportError:
            return

        frontend_url = (
            app.config.get('FRONTEND_URL_PUBLIC')
            or app.config.get('FRONTEND_URL')
            or app.config.get('APP_URL_PUBLIC')
            or 'http://localhost:5173'
        ).strip().rstrip('/')

        # Bulk-load recipients and subscriptions into plain dicts, then release the
        # DB connection BEFORE performing any external webpush HTTP calls so slow
        # push gateways never exhaust the SQLAlchemy connection pool.
        deliveries = []
        try:
            user_ids = {item['user_id'] for item in notif_data if item.get('user_id') is not None}
            if not user_ids:
                return

            active_users = {
                user_id: role
                for user_id, role in db.session.query(User.id, User.role)
                .filter(User.id.in_(user_ids), User.is_active.is_(True))
                .all()
            }
            if not active_users:
                return

            subs_by_user = defaultdict(list)
            for sub_id, sub_user_id, endpoint, p256dh, auth in (
                db.session.query(
                    PushSubscription.id,
                    PushSubscription.user_id,
                    PushSubscription.endpoint,
                    PushSubscription.p256dh,
                    PushSubscription.auth,
                )
                .filter(PushSubscription.user_id.in_(active_users.keys()))
                .all()
            ):
                subs_by_user[sub_user_id].append(
                    (
                        sub_id,
                        {
                            'endpoint': endpoint,
                            'keys': {
                                'p256dh': p256dh,
                                'auth': auth,
                            },
                        },
                    )
                )

            for item in notif_data:
                role = active_users.get(item['user_id'])
                if not role:
                    continue
                user_subs = subs_by_user.get(item['user_id'])
                if not user_subs:
                    continue

                dashboard = '/admin' if role == 'admin' else '/lgu'
                if item['resource_type'] == 'hazard_report':
                    tab = 'reports'
                elif item['resource_type'] in ('resident_registration', 'resident_account'):
                    tab = 'registrations'
                else:
                    tab = 'rescue'

                url = (
                    f"{frontend_url}{dashboard}?tab={tab}"
                    f"&notificationId={item['id']}"
                    f"&resourceType={item['resource_type'] or ''}"
                    f"&resourceId={item['resource_id'] if item['resource_id'] is not None else ''}"
                )
                payload = json.dumps({
                    'title': item['title'],
                    'body': item['message'],
                    'url': url,
                    'notificationId': item['id'],
                    'emergency': item['is_emergency'],
                    'resourceType': item['resource_type'],
                    'eventType': item.get('event_type'),
                })
                for sub_id, sub_info in user_subs:
                    deliveries.append((sub_id, sub_info, payload))
        finally:
            db.session.remove()

        if not deliveries:
            return

        expired_sub_ids = set()
        for sub_id, sub_info, payload in deliveries:
            try:
                webpush(
                    subscription_info=sub_info,
                    data=payload,
                    vapid_private_key=private_key,
                    vapid_claims={'sub': subject},
                    timeout=3,
                )
            except WebPushException as error:
                response = getattr(error, 'response', None)
                if response is not None and response.status_code in (404, 410):
                    expired_sub_ids.add(sub_id)
            except Exception:
                pass

        if expired_sub_ids:
            try:
                PushSubscription.query.filter(
                    PushSubscription.id.in_(expired_sub_ids)
                ).delete(synchronize_session=False)
                db.session.commit()
            except Exception:
                db.session.rollback()
            finally:
                db.session.remove()


def send_staff_push_notifications(notifications):
    if not notifications:
        return

    public_key = current_app.config.get('VAPID_PUBLIC_KEY')
    private_key = current_app.config.get('VAPID_PRIVATE_KEY')
    subject = current_app.config.get('VAPID_CLAIMS_SUB')
    if not public_key or not private_key or not subject:
        return

    notif_data = [
        {
            'id': n.id,
            'user_id': n.user_id,
            'event_type': n.event_type,
            'resource_type': n.resource_type,
            'resource_id': n.resource_id,
            'title': n.title,
            'message': n.message,
            'is_emergency': bool(n.is_emergency),
        }
        for n in notifications
    ]

    try:
        app = current_app._get_current_object()
        _push_executor.submit(_async_send_staff_push_notifications, app, notif_data)
    except Exception as e:
        current_app.logger.warning('Failed to submit push notification task: %s', e)
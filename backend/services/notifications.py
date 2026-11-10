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


import threading


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

        frontend_url = app.config.get(
            'FRONTEND_URL', 'http://localhost:5173'
        ).rstrip('/')

        for item in notif_data:
            user = db.session.get(User, item['user_id'])
            if not user or not user.is_active:
                continue

            dashboard = '/admin' if user.role == 'admin' else '/lgu'
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
            })
            subscriptions = PushSubscription.query.filter_by(user_id=user.id).all()
            for subscription in subscriptions:
                try:
                    webpush(
                        subscription_info={
                            'endpoint': subscription.endpoint,
                            'keys': {
                                'p256dh': subscription.p256dh,
                                'auth': subscription.auth,
                            },
                        },
                        data=payload,
                        vapid_private_key=private_key,
                        vapid_claims={'sub': subject},
                        timeout=3,
                    )
                except WebPushException as error:
                    response = getattr(error, 'response', None)
                    if response is not None and response.status_code in (404, 410):
                        db.session.delete(subscription)
                except Exception:
                    pass

        try:
            db.session.commit()
        except Exception:
            db.session.rollback()


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
        thread = threading.Thread(
            target=_async_send_staff_push_notifications,
            args=(app, notif_data),
            daemon=True,
        )
        thread.start()
    except Exception as e:
        current_app.logger.warning('Failed to spawn push notification thread: %s', e)
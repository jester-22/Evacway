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


def send_staff_push_notifications(notifications):
    public_key = current_app.config.get('VAPID_PUBLIC_KEY')
    private_key = current_app.config.get('VAPID_PRIVATE_KEY')
    subject = current_app.config.get('VAPID_CLAIMS_SUB')
    if not public_key or not private_key or not subject or not notifications:
        return

    try:
        from pywebpush import WebPushException, webpush
    except ImportError:
        current_app.logger.warning('pywebpush is not installed; push delivery is disabled')
        return

    frontend_url = current_app.config.get(
        'FRONTEND_URL', 'http://localhost:5173'
    ).rstrip('/')

    for notification in notifications:
        user = db.session.get(User, notification.user_id)
        if not user or not user.is_active:
            continue

        dashboard = '/admin' if user.role == 'admin' else '/lgu'
        tab = 'reports' if notification.resource_type == 'hazard_report' else 'rescue'
        url = (
            f'{frontend_url}{dashboard}?tab={tab}'
            f'&notificationId={notification.id}'
        )
        payload = json.dumps({
            'title': notification.title,
            'body': notification.message,
            'url': url,
            'notificationId': notification.id,
            'emergency': notification.is_emergency,
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
                )
            except WebPushException as error:
                response = getattr(error, 'response', None)
                if response is not None and response.status_code in (404, 410):
                    db.session.delete(subscription)
                else:
                    current_app.logger.warning(
                        'Push delivery failed for staff notification %s',
                        notification.id,
                    )
            except Exception:
                current_app.logger.exception(
                    'Push delivery failed for staff notification %s',
                    notification.id,
                )

    db.session.commit()
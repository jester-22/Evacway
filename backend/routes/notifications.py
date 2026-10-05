from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity

from models import (
    HazardReport,
    PushSubscription,
    RescueRequest,
    StaffNotification,
    db,
)
from utils import role_required


notifications_bp = Blueprint('notifications', __name__)


def _current_user_id():
    return int(get_jwt_identity())


def _notification_to_dict(notification, coordinates):
    result = {
        'id': notification.id,
        'event_type': notification.event_type,
        'resource_type': notification.resource_type,
        'resource_id': notification.resource_id,
        'title': notification.title,
        'message': notification.message,
        'is_emergency': notification.is_emergency,
        'is_read': notification.is_read,
        'created_at': notification.created_at.isoformat() if notification.created_at else None,
        'latitude': coordinates[0] if coordinates else None,
        'longitude': coordinates[1] if coordinates else None,
    }
    return result


@notifications_bp.route('/api/notifications', methods=['GET'])
@role_required('admin', 'lgu_personnel')
def list_notifications():
    user_id = _current_user_id()
    notifications = (
        StaffNotification.query
        .filter_by(user_id=user_id)
        .order_by(StaffNotification.created_at.desc(), StaffNotification.id.desc())
        .limit(50)
        .all()
    )
    unread_count = StaffNotification.query.filter_by(
        user_id=user_id,
        is_read=False,
    ).count()

    rescue_ids = {
        item.resource_id for item in notifications
        if item.resource_type == 'rescue_request'
    }
    report_ids = {
        item.resource_id for item in notifications
        if item.resource_type == 'hazard_report'
    }
    coordinates = {}
    if rescue_ids:
        for rescue in RescueRequest.query.filter(RescueRequest.id.in_(rescue_ids)).all():
            if rescue.latitude is not None and rescue.longitude is not None:
                coordinates[('rescue_request', rescue.id)] = (rescue.latitude, rescue.longitude)
    if report_ids:
        from geoalchemy2.shape import to_shape

        for report in HazardReport.query.filter(HazardReport.id.in_(report_ids)).all():
            if report.geom:
                point = to_shape(report.geom)
                coordinates[('hazard_report', report.id)] = (point.y, point.x)

    return jsonify({
        'notifications': [
            _notification_to_dict(item, coordinates.get((item.resource_type, item.resource_id)))
            for item in notifications
        ],
        'unread_count': unread_count,
    })


@notifications_bp.route('/api/notifications/<int:notification_id>/read', methods=['POST'])
@role_required('admin', 'lgu_personnel')
def mark_notification_read(notification_id):
    notification = StaffNotification.query.filter_by(
        id=notification_id,
        user_id=_current_user_id(),
    ).first_or_404()
    notification.is_read = True
    db.session.commit()
    return jsonify({'id': notification.id, 'is_read': True})


@notifications_bp.route('/api/push/vapid-public-key', methods=['GET'])
def get_vapid_public_key():
    public_key = current_app.config.get('VAPID_PUBLIC_KEY')
    enabled = bool(
        public_key
        and current_app.config.get('VAPID_PRIVATE_KEY')
        and current_app.config.get('VAPID_CLAIMS_SUB')
    )
    return jsonify({'public_key': public_key if enabled else None, 'enabled': enabled})


@notifications_bp.route('/api/push-subscriptions', methods=['POST'])
@role_required('admin', 'lgu_personnel')
def save_push_subscription():
    data = request.get_json(silent=True) or {}
    endpoint = data.get('endpoint')
    keys = data.get('keys') or {}
    p256dh = keys.get('p256dh')
    auth = keys.get('auth')

    if (
        not isinstance(endpoint, str)
        or not endpoint.startswith('https://')
        or not isinstance(p256dh, str)
        or not isinstance(auth, str)
    ):
        return jsonify({'error': 'A valid push subscription is required'}), 400

    user_id = _current_user_id()
    subscription = PushSubscription.query.filter_by(endpoint=endpoint).first()
    if not subscription:
        subscription = PushSubscription(user_id=user_id, endpoint=endpoint)
        db.session.add(subscription)

    subscription.user_id = user_id
    subscription.p256dh = p256dh
    subscription.auth = auth
    db.session.commit()
    return jsonify({'saved': True}), 201


@notifications_bp.route('/api/push-subscriptions', methods=['DELETE'])
@role_required('admin', 'lgu_personnel')
def delete_push_subscription():
    data = request.get_json(silent=True) or {}
    endpoint = data.get('endpoint')
    if not isinstance(endpoint, str):
        return jsonify({'error': 'A subscription endpoint is required'}), 400

    subscription = PushSubscription.query.filter_by(
        user_id=_current_user_id(),
        endpoint=endpoint,
    ).first()
    if subscription:
        db.session.delete(subscription)
        db.session.commit()
    return jsonify({'removed': True})
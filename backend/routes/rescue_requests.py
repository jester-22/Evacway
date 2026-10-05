import math

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity

from models import RescueRequest, SystemLog, db
from services.notifications import (
    create_staff_notifications,
    send_staff_push_notifications,
)
from utils import role_required


rescue_bp = Blueprint('rescue', __name__)
RESCUE_STATUSES = {'pending', 'acknowledged', 'responding', 'resolved'}


def _rescue_to_dict(rescue):
    return {
        'id': rescue.id,
        'description': rescue.description,
        'location_description': rescue.location_description,
        'latitude': rescue.latitude,
        'longitude': rescue.longitude,
        'status': rescue.status,
        'created_at': rescue.created_at.isoformat() if rescue.created_at else None,
        'updated_at': rescue.updated_at.isoformat() if rescue.updated_at else None,
    }


@rescue_bp.route('/api/rescue-requests', methods=['POST'])
def submit_rescue_request():
    data = request.get_json(silent=True) or {}
    description = str(data.get('description') or '').strip()
    location_description = str(data.get('location_description') or '').strip() or None

    if not description or len(description) > 2000:
        return jsonify({'error': 'Describe the emergency (up to 2000 characters).'}), 400
    if location_description and len(location_description) > 255:
        return jsonify({'error': 'Location details must be 255 characters or fewer.'}), 400

    raw_latitude = data.get('latitude')
    raw_longitude = data.get('longitude')
    latitude = longitude = None
    if raw_latitude is not None or raw_longitude is not None:
        try:
            latitude = float(raw_latitude)
            longitude = float(raw_longitude)
        except (TypeError, ValueError):
            return jsonify({'error': 'Both GPS coordinates must be valid numbers.'}), 400
        if (
            not math.isfinite(latitude)
            or not math.isfinite(longitude)
            or not -90 <= latitude <= 90
            or not -180 <= longitude <= 180
        ):
            return jsonify({'error': 'GPS coordinates are outside valid ranges.'}), 400

    if latitude is None and not location_description:
        return jsonify({'error': 'Provide a GPS location or describe where help is needed.'}), 400

    rescue = RescueRequest(
        description=description,
        location_description=location_description,
        latitude=latitude,
        longitude=longitude,
    )
    db.session.add(rescue)
    db.session.flush()
    notifications = create_staff_notifications(
        event_type='rescue_request',
        resource_type='rescue_request',
        resource_id=rescue.id,
        title='EMERGENCY: Rescue requested',
        message='A resident requested emergency rescue. Open the request for details.',
        is_emergency=True,
    )
    db.session.commit()
    send_staff_push_notifications(notifications)
    return jsonify({'rescue_request': _rescue_to_dict(rescue)}), 201


@rescue_bp.route('/api/rescue-requests', methods=['GET'])
@role_required('admin', 'lgu_personnel')
def list_rescue_requests():
    rescue_requests = RescueRequest.query.order_by(
        RescueRequest.created_at.desc(),
        RescueRequest.id.desc(),
    ).limit(200).all()
    return jsonify([_rescue_to_dict(item) for item in rescue_requests])


@rescue_bp.route('/api/rescue-requests/<int:rescue_id>', methods=['PATCH'])
@role_required('admin', 'lgu_personnel')
def update_rescue_status(rescue_id):
    rescue = RescueRequest.query.get_or_404(rescue_id)
    data = request.get_json(silent=True) or {}
    new_status = data.get('status')
    if new_status not in RESCUE_STATUSES:
        return jsonify({
            'error': 'status must be pending, acknowledged, responding, or resolved'
        }), 400

    rescue.status = new_status
    rescue.status_updated_by = int(get_jwt_identity())
    db.session.add(SystemLog(
        user_id=rescue.status_updated_by,
        action=f'Updated rescue request #{rescue.id} to {new_status}',
    ))
    db.session.commit()
    return jsonify(_rescue_to_dict(rescue))
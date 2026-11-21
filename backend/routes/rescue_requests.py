import json
import math
import os
import uuid

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt, get_jwt_identity, jwt_required
from werkzeug.utils import secure_filename

from models import RescueRequest, SystemLog, db, Resident, ResidentAccount, User
from services.sogod_boundary import is_inside_sogod
from services.notifications import (
    create_staff_notifications,
    send_staff_push_notifications,
)
from utils import role_required


rescue_bp = Blueprint('rescue', __name__)
RESCUE_STATUSES = {'pending', 'acknowledged', 'responding', 'resolved'}
MAX_PROOF_IMAGES = 5
ALLOWED_IMAGE_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp'}
ALLOWED_RESCUE_NEEDS = {
    'Trapped', 'Injured', 'Flooding', 'Medical emergency', 'Need evacuation',
}
ALLOWED_VULNERABILITY_FLAGS = {'PWD', 'Senior', 'Child', 'Pregnant'}


def _parse_json_choices(value, allowed_values, field_label):
    if value in (None, ''):
        return [], None
    try:
        choices = json.loads(value) if isinstance(value, str) else value
    except (TypeError, ValueError):
        return None, f'{field_label} must be a list of supported choices.'
    if not isinstance(choices, list):
        return None, f'{field_label} must be a list of supported choices.'
    if any(not isinstance(choice, str) or choice not in allowed_values for choice in choices):
        return None, f'{field_label} contains an unsupported choice.'
    return list(dict.fromkeys(choices)), None


def _parse_people_count(value, default_value):
    if value in (None, ''):
        return max(int(default_value or 1), 1), None
    try:
        count = int(value)
    except (TypeError, ValueError):
        return None, 'How many people must be a whole number from 1 to 999.'
    if count < 1 or count > 999 or str(value).strip() != str(count):
        return None, 'How many people must be a whole number from 1 to 999.'
    return count, None


def _allowed_image(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_IMAGE_EXTENSIONS


def _sanitize_uploader_folder(uploader_name):
    folder = secure_filename(str(uploader_name or '').strip())
    return folder or 'anonymous'


def _save_proof_images(photo_files, uploader_name=None):
    """Save uploads under static/uploads/rescue/<uploader> with unique names; return their URLs."""
    uploader_folder = _sanitize_uploader_folder(uploader_name)
    upload_folder = os.path.join(
        current_app.root_path, 'static', 'uploads', 'rescue', uploader_folder
    )
    os.makedirs(upload_folder, exist_ok=True)
    urls = []
    for photo in photo_files:
        ext = photo.filename.rsplit('.', 1)[1].lower()
        unique_name = f"{uuid.uuid4().hex}.{ext}"
        photo.save(os.path.join(upload_folder, unique_name))
        urls.append(f"/static/uploads/rescue/{uploader_folder}/{unique_name}")
    return urls


def _rescue_to_dict(rescue):
    proof_images = []
    if rescue.proof_images:
        try:
            proof_images = json.loads(rescue.proof_images)
        except (ValueError, TypeError):
            proof_images = []
    return {
        'id': rescue.id,
        'description': rescue.description,
        'location_description': rescue.location_description,
        'latitude': rescue.latitude,
        'longitude': rescue.longitude,
        'accuracy': getattr(rescue, 'accuracy', None),
        'is_manual_pin': bool(getattr(rescue, 'is_manual_pin', False)),
        'location_source': getattr(rescue, 'location_source', None) or ('manual' if getattr(rescue, 'is_manual_pin', False) else ('gps' if rescue.latitude is not None else None)),
        'status': rescue.status,
        'requester_name': rescue.requester_name,
        'requester_contact': rescue.requester_contact,
        'proof_images': proof_images,
        'selected_needs': json.loads(rescue.selected_needs) if rescue.selected_needs else [],
        'people_count': rescue.people_count,
        'vulnerability_flags': json.loads(rescue.vulnerability_flags) if rescue.vulnerability_flags else [],
        'created_at': rescue.created_at.isoformat() if rescue.created_at else None,
        'updated_at': rescue.updated_at.isoformat() if rescue.updated_at else None,
    }


@rescue_bp.route('/api/rescue-requests', methods=['POST'])
@jwt_required()
def submit_rescue_request():
    # The resident modal sends multipart FormData (so photos can be attached).
    # JSON bodies are still accepted for backwards compatibility.
    is_multipart = bool(request.files) or bool(request.form)
    data = request.form if is_multipart else (request.get_json(silent=True) or {})

    description = str(data.get('description') or '').strip()
    location_description = str(data.get('location_description') or '').strip() or None
    requester_name = str(data.get('requester_name') or '').strip()
    requester_contact = str(data.get('requester_contact') or '').strip()
    selected_needs, needs_error = _parse_json_choices(
        data.get('selected_needs'), ALLOWED_RESCUE_NEEDS, 'Selected needs'
    )
    vulnerability_flags, vulnerability_error = _parse_json_choices(
        data.get('vulnerability_flags'), ALLOWED_VULNERABILITY_FLAGS, 'Vulnerability flags'
    )

    claims = get_jwt() or {}
    ident = get_jwt_identity()
    account_type = claims.get('account_type', 'user')

    saved_name = claims.get('name') or ''
    saved_contact = ''
    saved_family_count = 1

    if ident:
        try:
            ident_int = int(ident)
            if account_type == 'resident_account':
                acct = ResidentAccount.query.get(ident_int)
                if acct:
                    if acct.resident:
                        saved_name = acct.resident.get_full_name()
                        if getattr(acct.resident, 'contact_number', None):
                            saved_contact = str(acct.resident.contact_number).strip()
                        family = getattr(acct.resident, 'family', None)
                        if family and family.member_count:
                            saved_family_count = max(int(family.member_count), 1)
                    elif acct.email and not saved_name:
                        saved_name = acct.email.split('@')[0]
            else:
                usr = User.query.get(ident_int)
                if usr:
                    if usr.name:
                        saved_name = usr.name
                    elif usr.email and not saved_name:
                        saved_name = usr.email.split('@')[0]
                    if getattr(usr, 'phone', None):
                        saved_contact = str(usr.phone).strip()
        except Exception:
            pass

    if not requester_name:
        requester_name = saved_name or "Resident (Assistance Needed)"
    if not requester_contact:
        requester_contact = saved_contact or ""

    photo_files = [
        f for f in request.files.getlist('proof_images') if f and f.filename
    ] if is_multipart else []

    if needs_error:
        return jsonify({'error': needs_error}), 400
    if vulnerability_error:
        return jsonify({'error': vulnerability_error}), 400
    if not description and not selected_needs:
        return jsonify({'error': 'Choose a need or briefly describe the emergency.'}), 400
    if len(description) > 2000:
        return jsonify({'error': 'Description must be 2000 characters or fewer.'}), 400
    if location_description and len(location_description) > 255:
        return jsonify({'error': 'Location details must be 255 characters or fewer.'}), 400
    if requester_name and len(requester_name) > 100:
        return jsonify({'error': 'Please provide your name (up to 100 characters).'}), 400
    if requester_contact and len(requester_contact) > 20:
        return jsonify({'error': 'Contact number must be 20 characters or fewer.'}), 400
    people_count, people_count_error = _parse_people_count(
        data.get('people_count'), saved_family_count
    )
    if people_count_error:
        return jsonify({'error': people_count_error}), 400
    if len(photo_files) > MAX_PROOF_IMAGES:
        return jsonify({'error': f'You may attach up to {MAX_PROOF_IMAGES} photos.'}), 400
    for photo in photo_files:
        if not _allowed_image(photo.filename):
            return jsonify({'error': 'Photos must be png, jpg, jpeg, or webp images.'}), 400

    # FormData sends missing GPS as empty strings; treat those as "no GPS".
    raw_latitude = data.get('latitude')
    raw_longitude = data.get('longitude')
    if raw_latitude in ('', None):
        raw_latitude = None
    if raw_longitude in ('', None):
        raw_longitude = None
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

    if latitude is None:
        return jsonify({'error': 'Share a GPS location inside Sogod so responders can locate you.'}), 400
    try:
        if not is_inside_sogod(latitude, longitude):
            return jsonify({'error': 'Rescue requests can only be submitted for locations inside Sogod.'}), 400
    except (FileNotFoundError, ValueError, OSError):
        current_app.logger.exception("Could not validate rescue request against the Sogod boundary")
        return jsonify({'error': 'Location validation is temporarily unavailable. Please try again later.'}), 503

    # Optional accuracy and location source
    raw_accuracy = data.get('accuracy')
    accuracy = None
    if raw_accuracy not in ('', None):
        try:
            accuracy = float(raw_accuracy)
            if not math.isfinite(accuracy) or accuracy < 0:
                accuracy = None
        except (TypeError, ValueError):
            accuracy = None

    raw_manual_pin = data.get('is_manual_pin')
    is_manual_pin = False
    if str(raw_manual_pin).strip().lower() in ('true', '1', 'yes'):
        is_manual_pin = True

    location_source = str(data.get('location_source') or '').strip().lower()
    if is_manual_pin or location_source == 'manual':
        location_source = 'manual'
        is_manual_pin = True
    elif location_source in ('approximate', 'approx'):
        location_source = 'approximate'
    elif location_source in ('gps', 'device'):
        location_source = 'gps'
    elif accuracy is not None and accuracy > 100:
        location_source = 'approximate'
    elif latitude is not None:
        location_source = 'gps'
    else:
        location_source = None

    # All validation passed — only now write photo files to disk.
    uploader_name = requester_name or claims.get('name')
    proof_image_urls = (
        _save_proof_images(photo_files, uploader_name=uploader_name)
        if photo_files
        else []
    )

    rescue = RescueRequest(
        description=description,
        location_description=location_description,
        latitude=latitude,
        longitude=longitude,
        accuracy=accuracy,
        is_manual_pin=is_manual_pin,
        location_source=location_source,
        requester_name=requester_name,
        requester_contact=requester_contact,
        proof_images=json.dumps(proof_image_urls) if proof_image_urls else None,
        selected_needs=json.dumps(selected_needs),
        people_count=people_count,
        vulnerability_flags=json.dumps(vulnerability_flags),
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


@rescue_bp.route('/api/rescue-requests/form-context', methods=['GET'])
@jwt_required()
def get_rescue_form_context():
    claims = get_jwt() or {}
    if claims.get('role') != 'resident' or claims.get('account_type') != 'resident_account':
        return jsonify({'error': 'Resident access required.'}), 403

    try:
        resident_id = int(claims.get('resident_id'))
    except (TypeError, ValueError):
        return jsonify({'error': 'Resident account is unavailable.'}), 404
    resident = db.session.get(Resident, resident_id)
    if not resident:
        return jsonify({'error': 'Resident account is unavailable.'}), 404
    family = resident.family
    return jsonify({
        'family_member_count': max(int(family.member_count or 1), 1) if family else 1,
        'contact_number': resident.contact_number,
    }), 200


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

    # One-way status flow: pending → acknowledged → responding → resolved
    status_order = ['pending', 'acknowledged', 'responding', 'resolved']
    current_index = status_order.index(rescue.status)
    new_index = status_order.index(new_status)
    if new_index < current_index:
        return jsonify({
            'error': f'Cannot change status from {rescue.status} back to {new_status}. Status only moves forward.'
        }), 400
    if new_index == current_index:
        return jsonify({'error': f'Status is already {new_status}.'}), 400

    rescue.status = new_status
    rescue.status_updated_by = int(get_jwt_identity())
    db.session.add(SystemLog(
        user_id=rescue.status_updated_by,
        action=f'Updated rescue request #{rescue.id} to {new_status}',
    ))
    db.session.commit()
    return jsonify(_rescue_to_dict(rescue))

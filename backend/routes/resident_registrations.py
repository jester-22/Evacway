import re
import time
import unicodedata
from collections import defaultdict
from datetime import date
from difflib import SequenceMatcher

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity
from sqlalchemy import func, or_
from sqlalchemy.orm import joinedload
from sqlalchemy.exc import IntegrityError
from werkzeug.security import generate_password_hash

from models import (
    db,
    Barangay,
    Family,
    Resident,
    ResidentRegistrationRequest,
    ResidentAccount,
    StaffNotification,
    SystemLog,
    User,
    philippines_now,
)
from services.mailer import send_resident_registration_email
from services.notifications import create_staff_notifications, send_staff_push_notifications
from utils import role_required


registrations_bp = Blueprint('resident_registrations', __name__)
_registration_rate_limits = defaultdict(list)
_EMAIL_RE = re.compile(r'[^@\s]+@[^@\s]+\.[^@\s]+')


def _is_rate_limited(ip_address, max_requests=5, window_seconds=900):
    now = time.time()
    timestamps = [
        timestamp
        for timestamp in _registration_rate_limits[ip_address]
        if now - timestamp < window_seconds
    ]
    if len(timestamps) >= max_requests:
        _registration_rate_limits[ip_address] = timestamps
        return True
    timestamps.append(now)
    _registration_rate_limits[ip_address] = timestamps
    return False


def _normalize_text(value):
    value = unicodedata.normalize('NFKD', str(value or ''))
    value = ''.join(char for char in value if not unicodedata.combining(char))
    value = value.casefold()
    return re.sub(r'[^a-z0-9]+', ' ', value).strip()


def _normalize_contact(value):
    digits = re.sub(r'\D', '', str(value or ''))
    if digits.startswith('63') and len(digits) == 12:
        digits = digits[2:]
    if digits.startswith('0') and len(digits) == 11:
        digits = digits[1:]
    return digits


def _middle_names_match(left, right):
    left_parts = _normalize_text(left).split()
    right_parts = _normalize_text(right).split()
    if len(left_parts) != len(right_parts):
        return False
    return all(
        first == second
        or (len(first) == 1 and second.startswith(first))
        or (len(second) == 1 and first.startswith(second))
        for first, second in zip(left_parts, right_parts)
    )


def _names_match(request_record, resident):
    return (
        _normalize_text(request_record.first_name) == _normalize_text(resident.first_name)
        and _normalize_text(request_record.last_name) == _normalize_text(resident.last_name)
        and _middle_names_match(request_record.middle_name, resident.middle_name)
    )


def _full_name(first_name, middle_name, last_name):
    return ' '.join(
        part.strip()
        for part in (first_name, middle_name, last_name)
        if part and part.strip()
    )


def _parse_name_fields(data):
    first_name = str(data.get('first_name') or '').strip()
    middle_name = str(data.get('middle_name') or '').strip()
    last_name = str(data.get('last_name') or '').strip()

    if not first_name and not last_name:
        name_parts = str(data.get('full_name') or '').split()
        if len(name_parts) >= 2:
            first_name = name_parts[0]
            last_name = name_parts[-1]
            middle_name = ' '.join(name_parts[1:-1])
    return first_name, middle_name, last_name


def _validate_registration(data):
    first_name, middle_name, last_name = _parse_name_fields(data)
    birthdate_value = str(data.get('birthdate') or data.get('date_of_birth') or '').strip()
    barangay = str(data.get('barangay') or '').strip()
    address = str(data.get('address') or '').strip()
    contact_number = str(data.get('contact_number') or '').strip()
    email = str(data.get('email') or '').strip().lower()
    password = data.get('password')

    if not first_name or not last_name:
        return None, 'Full name is required.'
    if any(len(part) > 100 for part in (first_name, middle_name, last_name)):
        return None, 'Each name field must be 100 characters or fewer.'
    if len(_full_name(first_name, middle_name, last_name)) > 100:
        return None, 'Full name must be 100 characters or fewer.'
    if not birthdate_value:
        return None, 'Birthdate is required.'
    try:
        birthdate = date.fromisoformat(birthdate_value)
    except ValueError:
        return None, 'Birthdate must be a valid date in YYYY-MM-DD format.'
    if birthdate > date.today():
        return None, 'Birthdate cannot be in the future.'
    if not barangay or len(barangay) > 100:
        return None, 'Barangay is required and must be 100 characters or fewer.'
    if not address or len(address) > 255:
        return None, 'Address or purok is required and must be 255 characters or fewer.'
    if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', email) or len(email) > 120:
        return None, 'Enter a valid email address.'
    contact_digits = _normalize_contact(contact_number)
    if len(contact_number) > 20 or not 7 <= len(contact_digits) <= 15:
        return None, 'Enter a valid contact number.'
    if not (
        isinstance(password, str)
        and len(password) >= 8
        and re.search(r'[A-Z]', password)
        and re.search(r'[a-z]', password)
        and re.search(r'[0-9]', password)
        and re.search(r'[^A-Za-z0-9\s]', password)
    ):
        return None, (
            'Password must have at least 8 characters, including an uppercase letter, '
            'a lowercase letter, a number, and a special character.'
        )

    return {
        'first_name': first_name,
        'middle_name': middle_name or None,
        'last_name': last_name,
        'birthdate': birthdate,
        'barangay': barangay,
        'address': address,
        'contact_number': contact_number,
        'email': email,
        'password': password,
        'contact_digits': contact_digits,
    }, None


def _duplicate_registration(email, contact_digits, exclude_request_id=None):
    # Check users table (admin, lgu_personnel)
    if User.query.filter(func.lower(User.email) == email).first():
        return 'An account with this email already exists.'

    # Check resident_accounts table (resident accounts) - only active accounts block
    if ResidentAccount.query.filter(func.lower(ResidentAccount.email) == email, ResidentAccount.is_active == True).first():
        return 'An account with this email already exists.'

    pending_query = ResidentRegistrationRequest.query.filter_by(status='pending')
    if exclude_request_id is not None:
        pending_query = pending_query.filter(
            ResidentRegistrationRequest.id != exclude_request_id
        )
    pending_requests = pending_query.all()

    if any(item.email.strip().lower() == email for item in pending_requests):
        return 'A pending registration already uses this email.'

    if any(
        _normalize_contact(user.contact_number) == contact_digits
        for user in User.query.filter(User.contact_number.isnot(None)).all()
    ):
        return 'An account with this contact number already exists.'

    if any(
        _normalize_contact(item.contact_number) == contact_digits
        for item in pending_requests
    ):
        return 'A pending registration already uses this contact number.'

    return None


def _match_fields(registration, resident):
    resident_birthdate = resident.date_of_birth.isoformat() if resident.date_of_birth else None
    resident_name = resident.get_full_name()
    fam = resident.family
    fam_barangay = fam.barangay.name if (fam and fam.barangay) else ''
    fam_address = fam.address if fam else None
    fam_contact = fam.contact_number if fam else None
    return {
        'name': _names_match(registration, resident),
        'birthdate': resident_birthdate == registration.birthdate.isoformat(),
        'barangay': _normalize_text(fam_barangay) == _normalize_text(registration.barangay),
        'address': bool(
            fam_address
            and _normalize_text(fam_address) == _normalize_text(registration.address)
        ),
        'contact_number': bool(
            fam_contact
            and _normalize_contact(fam_contact)
            == _normalize_contact(registration.contact_number)
        ),
        'name_similarity': round(
            SequenceMatcher(
                None,
                _normalize_text(registration.to_dict()['full_name']),
                _normalize_text(resident_name),
            ).ratio(),
            3,
        ),
    }


def _resident_match_result(registration):
    linked_ids = {
        resident_id
        for (resident_id,) in User.query.with_entities(User.resident_id).filter(
            User.resident_id.isnot(None)
        ).all()
    }
    candidates = []

    for resident in Resident.query.options(joinedload(Resident.family).joinedload(Family.barangay)).all():
        flags = _match_fields(registration, resident)
        score = (
            (0.55 if flags['name'] else flags['name_similarity'] * 0.55)
            + (0.25 if flags['birthdate'] else 0)
            + (0.15 if flags['barangay'] else 0)
            + (0.03 if flags['address'] else 0)
            + (0.02 if flags['contact_number'] else 0)
        )
        is_exact_match = flags['name'] and flags['birthdate'] and flags['barangay']
        candidates.append((score, is_exact_match, resident, flags))

    candidates.sort(key=lambda item: (-item[0], item[2].id))
    exact_matches = [item for item in candidates if item[1]]
    if exact_matches:
        status = 'match'
        selected = exact_matches[:3]
    else:
        possible_matches = [
            item
            for item in candidates
            if item[0] >= 0.35 and item[3]['name_similarity'] >= 0.5
        ]
        if possible_matches:
            status = 'possible'
            selected = possible_matches[:3]
        else:
            status = 'none'
            selected = []

    matches = []
    for score, _, resident, flags in selected:
        already_linked = resident.id in linked_ids
        matches.append({
            'resident': {
                'id': resident.id,
                'first_name': resident.first_name,
                'middle_name': resident.middle_name,
                'last_name': resident.last_name,
                'full_name': resident.get_full_name(),
                'birthdate': resident.date_of_birth.isoformat() if resident.date_of_birth else None,
                'barangay': resident.family.barangay.name if (resident.family and resident.family.barangay) else '',
                'address': resident.family.address if resident.family else None,
                'contact_number': resident.family.contact_number if resident.family else None,
            },
            'match_flags': {key: value for key, value in flags.items() if key != 'name_similarity'},
            'name_similarity': flags['name_similarity'],
            'already_linked': already_linked,
            'available': not already_linked,
        })

    return {'status': status, 'matches': matches}


def _send_decision_email(registration):
    try:
        send_resident_registration_email(registration)
        return True
    except Exception:
        current_app.logger.exception(
            'Could not send resident registration decision email for request %s',
            registration.id,
        )
        return False


@registrations_bp.route('/api/resident-registrations', methods=['POST'])
def submit_resident_registration():
    client_ip = request.remote_addr or 'unknown'
    if _is_rate_limited(client_ip):
        return jsonify({'error': 'Too many registration attempts. Please try again later.'}), 429

    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({'error': 'A JSON object is required.'}), 400
    fields, error = _validate_registration(data)
    if error:
        return jsonify({'error': error}), 400

    duplicate = _duplicate_registration(fields['email'], fields['contact_digits'])
    if duplicate:
        return jsonify({'error': duplicate}), 409

    registration = ResidentRegistrationRequest(
        first_name=fields['first_name'],
        middle_name=fields['middle_name'],
        last_name=fields['last_name'],
        birthdate=fields['birthdate'],
        barangay=fields['barangay'],
        address=fields['address'],
        contact_number=fields['contact_number'],
        email=fields['email'],
        password_hash=generate_password_hash(fields['password']),
        status='pending',
    )
    db.session.add(registration)
    try:
        db.session.flush()
        resident_name = f"{fields['first_name']} {fields['last_name']}".strip()
        notifications = create_staff_notifications(
            event_type='resident_registration',
            resource_type='resident_registration',
            resource_id=registration.id,
            title='New Resident Sign-Up',
            message=f'{resident_name} from Brgy. {fields["barangay"]} signed up and is awaiting verification.',
            is_emergency=False,
        )
        db.session.commit()
        try:
            send_staff_push_notifications(notifications)
        except Exception:
            current_app.logger.exception(
                'Push notification delivery failed for resident registration %s',
                registration.id,
            )
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': 'A registration with these details already exists.'}), 409

    return jsonify({
        'message': 'Registration submitted for staff review.',
        'registration': registration.to_dict(),
    }), 201


@registrations_bp.route('/api/resident-registrations', methods=['GET'])
@role_required('admin', 'lgu_personnel')
def list_resident_registrations():
    status = (request.args.get('status') or 'pending').strip().lower()
    search = (request.args.get('search') or '').strip()
    if status not in {'pending', 'approved', 'rejected', 'all'}:
        return jsonify({'error': 'status must be pending, approved, rejected, or all.'}), 400

    query = ResidentRegistrationRequest.query
    if status != 'all':
        query = query.filter_by(status=status)
    if search:
        pattern = f'%{search}%'
        query = query.filter(or_(
            ResidentRegistrationRequest.first_name.ilike(pattern),
            ResidentRegistrationRequest.middle_name.ilike(pattern),
            ResidentRegistrationRequest.last_name.ilike(pattern),
            ResidentRegistrationRequest.email.ilike(pattern),
            ResidentRegistrationRequest.contact_number.ilike(pattern),
            ResidentRegistrationRequest.barangay.ilike(pattern),
        ))

    registrations = query.order_by(
        ResidentRegistrationRequest.created_at.desc(),
        ResidentRegistrationRequest.id.desc(),
    ).all()
    return jsonify({
        'requests': [registration.to_dict() for registration in registrations],
        'count': len(registrations),
    })


@registrations_bp.route('/api/resident-registrations/<int:request_id>/matches', methods=['GET'])
@role_required('admin', 'lgu_personnel')
def get_resident_registration_matches(request_id):
    registration = db.session.get(ResidentRegistrationRequest, request_id)
    if not registration:
        return jsonify({'error': 'Registration request not found.'}), 404
    return jsonify(_resident_match_result(registration))


@registrations_bp.route('/api/resident-registrations/<int:request_id>/approve', methods=['POST'])
@role_required('admin', 'lgu_personnel')
def approve_resident_registration(request_id):
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({'error': 'A JSON object is required.'}), 400
    try:
        resident_id = int(data.get('matched_resident_id'))
    except (TypeError, ValueError, OverflowError):
        resident_id = None

    registration = db.session.get(ResidentRegistrationRequest, request_id)
    if not registration:
        return jsonify({'error': 'Registration request not found.'}), 404
    if registration.status != 'pending':
        return jsonify({'error': 'Only pending requests can be approved.'}), 409
    if not resident_id:
        return jsonify({'error': 'Link a resident record before approving this request.'}), 400

    resident = db.session.get(Resident, resident_id)
    if not resident:
        return jsonify({'error': 'The selected resident record was not found.'}), 404
    if User.query.filter_by(resident_id=resident.id).first():
        return jsonify({'error': 'This resident record is already linked to an account.'}), 409
    if ResidentAccount.query.filter_by(resident_id=resident.id).first():
        return jsonify({'error': 'This resident record is already linked to an account.'}), 409

    duplicate = _duplicate_registration(
        registration.email,
        _normalize_contact(registration.contact_number),
        exclude_request_id=registration.id,
    )
    if duplicate:
        return jsonify({'error': duplicate}), 409

    reviewer_id = int(get_jwt_identity())
    registration.status = 'approved'
    registration.matched_resident_id = resident.id
    registration.reviewed_by = reviewer_id
    registration.reviewed_at = philippines_now()
    registration.rejection_reason = None
    account = ResidentAccount(
        resident_id=resident.id,
        email=registration.email,
        password_hash=registration.password_hash,
        is_active=True,
    )
    db.session.add(account)
    StaffNotification.query.filter_by(
        resource_type='resident_registration',
        resource_id=registration.id,
    ).delete(synchronize_session=False)
    db.session.add(SystemLog(
        user_id=reviewer_id,
        action=f'Approved resident registration #{registration.id}',
    ))
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({
            'error': 'The email or resident record was linked by another account. Refresh and review the request again.'
        }), 409

    email_sent = _send_decision_email(registration)
    return jsonify({
        'message': 'Resident account approved.' if email_sent else 'Resident account approved, but the email was not sent.',
        'request': registration.to_dict(),
        'account': account.to_dict(),
        'email_sent': email_sent,
    }), 200


@registrations_bp.route('/api/resident-registrations/<int:request_id>/reject', methods=['POST'])
@role_required('admin', 'lgu_personnel')
def reject_resident_registration(request_id):
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({'error': 'A JSON object is required.'}), 400
    reason = str(data.get('reason') or '').strip()
    if not reason:
        return jsonify({'error': 'A rejection reason is required.'}), 400
    if len(reason) > 2000:
        return jsonify({'error': 'Rejection reason must be 2000 characters or fewer.'}), 400

    registration = db.session.get(ResidentRegistrationRequest, request_id)
    if not registration:
        return jsonify({'error': 'Registration request not found.'}), 404
    if registration.status != 'pending':
        return jsonify({'error': 'Only pending requests can be rejected.'}), 409

    reviewer_id = int(get_jwt_identity())
    registration.status = 'rejected'
    registration.reviewed_by = reviewer_id
    registration.reviewed_at = philippines_now()
    registration.rejection_reason = reason
    StaffNotification.query.filter_by(
        resource_type='resident_registration',
        resource_id=registration.id,
    ).delete(synchronize_session=False)
    db.session.add(SystemLog(
        user_id=reviewer_id,
        action=f'Rejected resident registration #{registration.id}',
    ))
    db.session.commit()

    email_sent = _send_decision_email(registration)
    return jsonify({
        'message': 'Resident registration rejected.' if email_sent else 'Resident registration rejected, but the email was not sent.',
        'request': registration.to_dict(),
        'email_sent': email_sent,
    }), 200


@registrations_bp.route('/api/resident-registrations/<int:request_id>/resend-email', methods=['POST'])
@role_required('admin', 'lgu_personnel')
def resend_resident_registration_email(request_id):
    registration = db.session.get(ResidentRegistrationRequest, request_id)
    if not registration:
        return jsonify({'error': 'Registration request not found.'}), 404
    if registration.status not in {'approved', 'rejected'}:
        return jsonify({'error': 'Email can only be resent after a request is approved or rejected.'}), 409

    email_sent = _send_decision_email(registration)
    return jsonify({
        'message': 'Decision email sent.' if email_sent else 'Email was not sent. Check SMTP configuration and retry.',
        'email_sent': email_sent,
    }), 200

# =========================================================================
# MANUAL RESIDENT ACCOUNT CREATION (FOR ADMIN / LGU PERSONNEL)
# =========================================================================
@registrations_bp.route('/api/resident-registrations/manual-create', methods=['POST'])
@role_required('admin', 'lgu_personnel')
def manual_create_resident_account():
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({'error': 'A JSON object is required.'}), 400

    reviewer_id = int(get_jwt_identity())
    resident_id = data.get('resident_id')
    email = str(data.get('email') or '').strip().lower()
    password = str(data.get('password') or '').strip()

    if not email or not _EMAIL_RE.fullmatch(email):
        return jsonify({'error': 'A valid email address is required.'}), 400
    if not password or len(password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters.'}), 400

    # Duplicate check for email across both User and ResidentAccount
    duplicate_email = (
        User.query.filter(func.lower(User.email) == email).first()
        or ResidentAccount.query.filter(func.lower(ResidentAccount.email) == email).first()
    )
    if duplicate_email:
        return jsonify({'error': f'An account with the email "{email}" already exists.'}), 409

    resident = None
    if resident_id:
        try:
            resident_id = int(resident_id)
            resident = db.session.get(Resident, resident_id)
        except (ValueError, TypeError):
            resident = None
        if not resident:
            return jsonify({'error': 'Selected resident record was not found.'}), 404
        if ResidentAccount.query.filter_by(resident_id=resident.id).first() or User.query.filter_by(resident_id=resident.id).first():
            return jsonify({'error': 'This resident already has an active account.'}), 409
    else:
        # Create resident record
        first_name = str(data.get('first_name') or '').strip()
        middle_name = str(data.get('middle_name') or '').strip()
        last_name = str(data.get('last_name') or '').strip()
        suffix = str(data.get('suffix') or '').strip()
        barangay_val = data.get('barangay_id') or data.get('barangay')
        address = str(data.get('address') or '').strip()
        contact_number = str(data.get('contact_number') or '').strip()
        birthdate_str = str(data.get('birthdate') or data.get('date_of_birth') or '').strip()

        if not first_name or not last_name:
            return jsonify({'error': 'First name and last name are required.'}), 400

        barangay_id = None
        if barangay_val:
            try:
                bid = int(barangay_val)
                brgy = db.session.get(Barangay, bid)
                if brgy:
                    barangay_id = brgy.id
            except (ValueError, TypeError):
                brgy = Barangay.query.filter(func.lower(Barangay.name) == str(barangay_val).lower().strip()).first()
                if brgy:
                    barangay_id = brgy.id

        birthdate_obj = None
        if birthdate_str:
            try:
                birthdate_obj = date.fromisoformat(birthdate_str)
            except ValueError:
                pass
        if not birthdate_obj:
            birthdate_obj = date(1990, 1, 1)

        resident = Resident(
            first_name=first_name,
            middle_name=middle_name or None,
            last_name=last_name,
            suffix=suffix or None,
            date_of_birth=birthdate_obj,
            barangay_id=barangay_id,
            address=address or None,
            contact_number=contact_number or None,
        )
        db.session.add(resident)
        db.session.flush()

    # Create ResidentAccount
    pwd_hash = generate_password_hash(password)
    account = ResidentAccount(
        resident_id=resident.id,
        email=email,
        password_hash=pwd_hash,
        is_active=True,
    )
    db.session.add(account)

    # Find or infer barangay name
    barangay_name = ''
    if resident.barangay:
        barangay_name = resident.barangay.name if hasattr(resident.barangay, 'name') else str(resident.barangay)
    elif resident.barangay_id:
        b_row = db.session.get(Barangay, resident.barangay_id)
        if b_row:
            barangay_name = b_row.name

    birth_dt = resident.date_of_birth or date(1990, 1, 1)

    # Create matching approved ResidentRegistrationRequest for complete recordkeeping
    reg_request = ResidentRegistrationRequest(
        first_name=resident.first_name,
        middle_name=resident.middle_name,
        last_name=resident.last_name,
        birthdate=birth_dt,
        barangay=barangay_name or 'N/A',
        address=resident.address or 'N/A',
        contact_number=resident.contact_number or 'N/A',
        email=email,
        password_hash=pwd_hash,
        status='approved',
        matched_resident_id=resident.id,
        reviewed_by=reviewer_id,
        reviewed_at=philippines_now(),
    )
    db.session.add(reg_request)

    full_nm = f"{resident.first_name} {resident.last_name}"
    db.session.add(SystemLog(
        user_id=reviewer_id,
        action=f"Manually created resident account for {full_nm} ({email})"
    ))

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': 'Database conflict: email or resident record already exists.'}), 409

    send_email = data.get('send_email', True)
    email_sent = False
    if send_email:
        email_sent = _send_decision_email(reg_request)

    return jsonify({
        'message': f'Resident account for {full_nm} created successfully.',
        'account': account.to_dict(),
        'resident': resident.to_dict(),
        'registration': reg_request.to_dict(),
        'email_sent': email_sent,
    }), 201

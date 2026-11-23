import re
import secrets
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
    EvacuationAssignment,
    EvacuationCenter,
    EvacuationCenterRoom,
    Family,
    Resident,
    ResidentRegistrationRequest,
    RegistrationLinkOverrideLog,
    ResidentAccount,
    RosterYear,
    StaffNotification,
    SystemLog,
    User,
    philippines_now,
    utc_now,
)
from services.mailer import (
    send_password_setup_email,
    send_resident_registration_email,
)
from services.notifications import create_staff_notifications, send_staff_push_notifications
from services.password_setup import (
    create_password_setup_token,
    generate_unusable_password_hash,
    send_account_setup_link,
)
from services.registration_notifications import send_registration_decision_notifications
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
    req_first = _normalize_text(request_record.first_name)
    req_last = _normalize_text(request_record.last_name)
    return (
        bool(req_first)
        and bool(req_last)
        and req_first == _normalize_text(resident.first_name)
        and req_last == _normalize_text(resident.last_name)
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


def _parse_past_birthdate(raw_value):
    birthdate_value = str(raw_value or '').strip()
    if not birthdate_value:
        return None, 'Birthdate is required.'
    try:
        birthdate = date.fromisoformat(birthdate_value)
    except ValueError:
        return None, 'Birthdate must be a valid date in YYYY-MM-DD format.'
    if birthdate >= philippines_now().date():
        return None, 'Birthdate must be a past date.'
    if birthdate.year < 1900:
        return None, 'Birthdate must be in or after 1900.'
    return birthdate, None


def _validate_registration(data):
    first_name, middle_name, last_name = _parse_name_fields(data)
    birthdate_value = data.get('birthdate') or data.get('date_of_birth')
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
    birthdate, birthdate_error = _parse_past_birthdate(birthdate_value)
    if birthdate_error:
        return None, birthdate_error
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
        and re.search(r'[a-zA-Z]', password)
        and re.search(r'[0-9]', password)
    ):
        return None, (
            'Password must be at least 8 characters, with at least one letter and one number.'
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
        'barangay': (
            bool(_normalize_text(fam_barangay))
            and _normalize_text(fam_barangay) == _normalize_text(registration.barangay)
        ),
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
    } | {
        resident_id
        for (resident_id,) in ResidentAccount.query.with_entities(ResidentAccount.resident_id).filter(
            ResidentAccount.resident_id.isnot(None),
            ResidentAccount.is_active == True,
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

    # Ensure an already-linked resident on an approved request is always included with fresh match flags
    if registration.matched_resident_id:
        already_in_selected = any(item[2].id == registration.matched_resident_id for item in selected)
        if not already_in_selected:
            linked_entry = next(
                (item for item in candidates if item[2].id == registration.matched_resident_id),
                None,
            )
            if linked_entry:
                selected = [linked_entry] + selected
                if status == 'none':
                    status = 'match' if linked_entry[1] else 'possible'

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


def _send_decision_notifications(registration):
    return send_registration_decision_notifications(
        registration,
        email_sender=send_resident_registration_email,
    )


@registrations_bp.route('/api/resident-registrations', methods=['POST'])
def submit_resident_registration():
    client_ip = request.remote_addr or 'unknown'
    if _is_rate_limited(client_ip):
        return jsonify({'error': 'Too many registration attempts. Please try again later.'}), 429

    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({'error': 'A JSON object is required.'}), 400
    if data.get('privacy_consent') is not True:
        return jsonify({'error': 'Consent to the Data Privacy Notice is required.'}), 400
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
        privacy_consent=True,
        privacy_consent_at=utc_now(),
        privacy_notice_version=current_app.config.get('DATA_PRIVACY_NOTICE_VERSION', '1'),
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

    matched_ids = {r.matched_resident_id for r in registrations if r.matched_resident_id}
    emails = {r.email.strip().lower() for r in registrations if r.email}

    accounts_by_resident_id = {}
    accounts_by_email = {}
    if matched_ids or emails:
        acct_filters = []
        if matched_ids:
            acct_filters.append(ResidentAccount.resident_id.in_(matched_ids))
        if emails:
            acct_filters.append(func.lower(ResidentAccount.email).in_(emails))
        for acct in ResidentAccount.query.filter(
            ResidentAccount.is_active == True,
            or_(*acct_filters),
        ).all():
            if acct.resident_id is not None:
                accounts_by_resident_id[acct.resident_id] = acct
            if acct.email:
                accounts_by_email[acct.email.strip().lower()] = acct

        user_filters = []
        if matched_ids:
            user_filters.append(User.resident_id.in_(matched_ids))
        if emails:
            user_filters.append(func.lower(User.email).in_(emails))
        for usr in User.query.filter(
            User.is_active == True,
            or_(*user_filters),
        ).all():
            if usr.resident_id is not None and usr.resident_id not in accounts_by_resident_id:
                accounts_by_resident_id[usr.resident_id] = usr
            if usr.email and usr.email.strip().lower() not in accounts_by_email:
                accounts_by_email[usr.email.strip().lower()] = usr

    serialized = []
    for registration in registrations:
        payload = registration.to_dict()
        matched_acct = (
            accounts_by_resident_id.get(registration.matched_resident_id)
            if registration.matched_resident_id
            else None
        ) or (
            accounts_by_email.get(registration.email.strip().lower())
            if registration.email
            else None
        )
        payload['has_account'] = matched_acct is not None
        payload['account_email'] = matched_acct.email if matched_acct else None
        serialized.append(payload)

    return jsonify({
        'requests': serialized,
        'count': len(serialized),
    })


@registrations_bp.route('/api/resident-registrations/<int:request_id>/matches', methods=['GET'])
@role_required('admin', 'lgu_personnel')
def get_resident_registration_matches(request_id):
    registration = db.session.get(ResidentRegistrationRequest, request_id)
    if not registration:
        return jsonify({'error': 'Registration request not found.'}), 404
    return jsonify(_resident_match_result(registration))


@registrations_bp.route('/api/resident-registrations/<int:request_id>', methods=['PATCH'])
@role_required('admin', 'lgu_personnel')
def update_resident_registration(request_id):
    registration = db.session.get(ResidentRegistrationRequest, request_id)
    if not registration:
        return jsonify({'error': 'Registration request not found.'}), 404

    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({'error': 'A JSON object is required.'}), 400

    first_name = str(data.get('first_name') if 'first_name' in data else (registration.first_name or '')).strip()
    middle_name = str(data.get('middle_name') if 'middle_name' in data else (registration.middle_name or '')).strip()
    last_name = str(data.get('last_name') if 'last_name' in data else (registration.last_name or '')).strip()
    birthdate_value = str(
        data.get('birthdate')
        if 'birthdate' in data
        else (registration.birthdate.isoformat() if registration.birthdate else '')
    ).strip()
    barangay = str(data.get('barangay') if 'barangay' in data else (registration.barangay or '')).strip()
    address = str(data.get('address') if 'address' in data else (registration.address or '')).strip()
    contact_number = str(
        data.get('contact_number') if 'contact_number' in data else (registration.contact_number or '')
    ).strip()
    email = str(data.get('email') if 'email' in data else (registration.email or '')).strip().lower()

    if not first_name or not last_name:
        return jsonify({'error': 'First name and last name are required.'}), 400
    if any(len(part) > 100 for part in (first_name, middle_name, last_name)):
        return jsonify({'error': 'Each name field must be 100 characters or fewer.'}), 400
    if len(_full_name(first_name, middle_name, last_name)) > 100:
        return jsonify({'error': 'Full name must be 100 characters or fewer.'}), 400
    birthdate, birthdate_error = _parse_past_birthdate(birthdate_value)
    if birthdate_error:
        return jsonify({'error': birthdate_error}), 400
    if not barangay or len(barangay) > 100:
        return jsonify({'error': 'Barangay is required and must be 100 characters or fewer.'}), 400
    if len(address) > 255:
        return jsonify({'error': 'Address or purok must be 255 characters or fewer.'}), 400
    if not email or not _EMAIL_RE.fullmatch(email) or len(email) > 120:
        return jsonify({'error': 'Enter a valid email address.'}), 400
    if contact_number:
        contact_digits = _normalize_contact(contact_number)
        if len(contact_number) > 20 or not 7 <= len(contact_digits) <= 15:
            return jsonify({'error': 'Enter a valid contact number.'}), 400

    linked_account = _resolve_registration_account(registration) if registration.status == 'approved' else None
    current_email = str(registration.email or '').strip().lower()
    if email != current_email:
        existing_user = User.query.filter(func.lower(User.email) == email).first()
        if existing_user and (not isinstance(linked_account, User) or existing_user.id != linked_account.id):
            return jsonify({'error': 'An account with this email already exists.'}), 409

        existing_res_acct = ResidentAccount.query.filter(
            func.lower(ResidentAccount.email) == email,
            ResidentAccount.is_active == True,
        ).first()
        if existing_res_acct and (
            not isinstance(linked_account, ResidentAccount) or existing_res_acct.id != linked_account.id
        ):
            return jsonify({'error': 'An account with this email already exists.'}), 409

        conflict_pending = ResidentRegistrationRequest.query.filter(
            ResidentRegistrationRequest.status == 'pending',
            ResidentRegistrationRequest.id != registration.id,
            func.lower(ResidentRegistrationRequest.email) == email,
        ).first()
        if conflict_pending:
            return jsonify({'error': 'Another pending registration already uses this email.'}), 409

    registration.first_name = first_name
    registration.middle_name = middle_name or None
    registration.last_name = last_name
    registration.birthdate = birthdate
    registration.barangay = barangay
    registration.address = address or None
    registration.contact_number = contact_number or None
    registration.email = email

    if linked_account is not None and str(linked_account.email or '').strip().lower() != email:
        linked_account.email = email

    editor_id = int(get_jwt_identity())
    db.session.add(SystemLog(
        user_id=editor_id,
        action=f'Updated resident registration #{registration.id} ({_full_name(first_name, middle_name, last_name)})',
    ))

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': 'Database conflict while updating registration details.'}), 409

    payload = registration.to_dict()
    payload['has_account'] = linked_account is not None
    payload['account_email'] = linked_account.email if linked_account else None

    return jsonify({
        'message': 'Account info updated and roster match re-analyzed.',
        'request': payload,
        'matches': _resident_match_result(registration),
    }), 200


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

    reviewer_id = int(get_jwt_identity())
    reviewer = db.session.get(User, reviewer_id)
    override_reason = str(data.get('override_reason') or '').strip()
    is_override = False

    match_flags = _match_fields(registration, resident)
    mismatched_required = []
    if not match_flags['name']:
        mismatched_required.append('name')
    if not match_flags['barangay']:
        mismatched_required.append('barangay')
    if mismatched_required:
        if len(mismatched_required) == 2:
            detail = 'name and barangay do not match'
        else:
            detail = f'{mismatched_required[0]} does not match'
        if not reviewer or reviewer.role != 'admin':
            return jsonify({
                'error': (
                    'Cannot link this registration to the selected roster record because '
                    f'{detail}. Only an admin can override a mismatch.'
                )
            }), 403
        if not override_reason:
            return jsonify({
                'error': (
                    'Cannot link this registration to the selected roster record because '
                    f'{detail}. Both name and barangay must match, or provide an override reason.'
                )
            }), 400
        if len(override_reason) > 2000:
            return jsonify({'error': 'Override reason must be 2000 characters or fewer.'}), 400
        is_override = True

    duplicate = _duplicate_registration(
        registration.email,
        _normalize_contact(registration.contact_number),
        exclude_request_id=registration.id,
    )
    if duplicate:
        return jsonify({'error': duplicate}), 409

    now = utc_now()
    registration.status = 'approved'
    registration.matched_resident_id = resident.id
    registration.reviewed_by = reviewer_id
    registration.reviewed_at = now
    registration.rejection_reason = None
    account = ResidentAccount(
        resident_id=resident.id,
        email=registration.email,
        password_hash=registration.password_hash,
        is_active=True,
    )
    db.session.add(account)
    override_log = None
    if is_override:
        override_log = RegistrationLinkOverrideLog(
            admin_id=reviewer_id,
            request_id=registration.id,
            roster_id=resident.id,
            reason=override_reason,
            timestamp=now,
        )
        db.session.add(override_log)
    StaffNotification.query.filter_by(
        resource_type='resident_registration',
        resource_id=registration.id,
    ).delete(synchronize_session=False)
    action_text = (
        f'Approved resident registration #{registration.id} '
        f'(admin override link to roster #{resident.id}: {override_reason})'
        if is_override
        else f'Approved resident registration #{registration.id}'
    )[:255]
    db.session.add(SystemLog(
        user_id=reviewer_id,
        action=action_text,
    ))
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({
            'error': 'The email or resident record was linked by another account. Refresh and review the request again.'
        }), 409

    delivery = _send_decision_notifications(registration)
    email_sent = delivery['email_sent']
    req_payload = registration.to_dict()
    req_payload['has_account'] = True
    req_payload['account_email'] = account.email
    response_body = {
        'message': 'Resident account approved.' if email_sent else 'Resident account approved, but the email was not sent.',
        'request': req_payload,
        'account': account.to_dict(),
        'email_sent': email_sent,
    }
    if override_log is not None:
        response_body['override_log'] = override_log.to_dict()
    return jsonify(response_body), 200


@registrations_bp.route('/api/resident-registrations/<int:request_id>/unlink', methods=['POST'])
@role_required('admin')
def unlink_resident_registration(request_id):
    registration = db.session.get(ResidentRegistrationRequest, request_id)
    if not registration:
        return jsonify({'error': 'Registration request not found.'}), 404

    linked_account = _resolve_registration_account(registration)
    previous_resident_id = registration.matched_resident_id or (
        linked_account.resident_id if linked_account else None
    )
    if not previous_resident_id and not linked_account:
        return jsonify({'error': 'This registration is not linked to a roster record.'}), 409

    # Inspect any center/room assignment inherited from the linked roster resident
    inherited_assignment = None
    if previous_resident_id:
        assignment = (
            EvacuationAssignment.query
            .filter_by(resident_id=previous_resident_id)
            .order_by(EvacuationAssignment.id.asc())
            .first()
        )
        if assignment:
            room = (
                db.session.get(EvacuationCenterRoom, assignment.room_id)
                if assignment.room_id
                else None
            )
            center_id = room.evacuation_center_id if room else assignment.evacuation_center_id
            center = db.session.get(EvacuationCenter, center_id) if center_id else None
            inherited_assignment = {
                'evacuation_center_id': center.id if center else center_id,
                'center_name': center.name if center else None,
                'room_id': room.id if room else assignment.room_id,
                'room_number': room.room_number if room else None,
            }

    # Remove the linked account(s) so the account no longer inherits the roster family's center/room
    accounts_to_delete = {}
    if previous_resident_id:
        for acct in ResidentAccount.query.filter_by(resident_id=previous_resident_id).all():
            accounts_to_delete[acct.id] = acct
    email_norm = str(registration.email or '').strip().lower()
    if email_norm:
        for acct in ResidentAccount.query.filter(func.lower(ResidentAccount.email) == email_norm).all():
            accounts_to_delete[acct.id] = acct

    for acct in accounts_to_delete.values():
        if acct.password_hash:
            registration.password_hash = acct.password_hash
        db.session.delete(acct)

    if previous_resident_id:
        for usr in User.query.filter_by(resident_id=previous_resident_id, role='resident').all():
            usr.resident_id = None
            usr.is_active = False

    registration.matched_resident_id = None
    registration.status = 'pending'
    registration.reviewed_by = None
    registration.reviewed_at = None
    registration.rejection_reason = None

    admin_id = int(get_jwt_identity())
    assignment_summary = ''
    if inherited_assignment and (inherited_assignment['center_name'] or inherited_assignment['room_number']):
        parts = [
            inherited_assignment['center_name'],
            f"Room {inherited_assignment['room_number']}" if inherited_assignment['room_number'] else None,
        ]
        assignment_summary = f" (cleared inherited assignment: {', '.join(p for p in parts if p)})"
    action_text = (
        f'Unlinked resident registration #{registration.id}'
        + (f' from roster #{previous_resident_id}' if previous_resident_id else '')
        + assignment_summary
    )[:255]
    db.session.add(SystemLog(
        user_id=admin_id,
        action=action_text,
    ))

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': 'Could not unlink this registration due to a database conflict.'}), 409

    payload = registration.to_dict()
    payload['has_account'] = False
    payload['account_email'] = None
    return jsonify({
        'message': 'Registration unlinked from roster record and inherited shelter assignment removed.',
        'request': payload,
        'matches': _resident_match_result(registration),
        'unlinked_resident_id': previous_resident_id,
        'cleared_inherited_assignment': inherited_assignment,
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
    registration.reviewed_at = utc_now()
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

    delivery = _send_decision_notifications(registration)
    email_sent = delivery['email_sent']
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


def _resolve_registration_account(registration):
    """Find the active ResidentAccount (or legacy resident User) for an approved registration."""
    if registration.matched_resident_id:
        acct = ResidentAccount.query.filter_by(
            resident_id=registration.matched_resident_id,
            is_active=True,
        ).first()
        if acct:
            return acct
        usr = User.query.filter_by(
            resident_id=registration.matched_resident_id,
            is_active=True,
        ).first()
        if usr:
            return usr

    email = str(registration.email or '').strip().lower()
    if email:
        acct = ResidentAccount.query.filter(
            func.lower(ResidentAccount.email) == email,
            ResidentAccount.is_active == True,
        ).first()
        if acct:
            return acct
        usr = User.query.filter(
            func.lower(User.email) == email,
            User.is_active == True,
        ).first()
        if usr:
            return usr
    return None


@registrations_bp.route('/api/resident-registrations/<int:request_id>/reset-password', methods=['POST'])
@role_required('admin', 'lgu_personnel')
def send_resident_reset_password_email(request_id):
    registration = db.session.get(ResidentRegistrationRequest, request_id)
    if not registration:
        return jsonify({'error': 'Registration request not found.'}), 404
    if registration.status != 'approved':
        return jsonify({'error': 'Password reset emails can only be sent for approved registrations.'}), 409

    account = _resolve_registration_account(registration)
    if not account or not account.email:
        return jsonify({'error': 'No active resident account was found for this registration.'}), 404

    target_email = account.email
    try:
        token = create_password_setup_token(account)
        send_password_setup_email(account, token, purpose='reset')
    except Exception:
        current_app.logger.exception(
            'Could not send password reset email for resident registration %s (%s)',
            registration.id,
            target_email,
        )
        return jsonify({
            'error': 'Password reset email could not be sent. Check backend SMTP settings.'
        }), 503

    sender_id = int(get_jwt_identity())
    db.session.add(SystemLog(
        user_id=sender_id,
        action=f'Sent password reset email to {target_email} (Request #{registration.id})',
    ))
    db.session.commit()

    return jsonify({
        'message': f'Reset link sent to {target_email}',
        'email': target_email,
        'email_sent': True,
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

    if not email or not _EMAIL_RE.fullmatch(email):
        return jsonify({'error': 'A valid email address is required.'}), 400

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

        birthdate_obj, birthdate_error = _parse_past_birthdate(birthdate_str)
        if birthdate_error:
            return jsonify({'error': birthdate_error}), 400

        family_id = None
        if barangay_id is not None:
            active_year = (
                RosterYear.query.filter_by(is_active=True).first()
                or RosterYear.query.order_by(RosterYear.year.desc()).first()
            )
            if active_year is not None:
                head_display = ' '.join(p for p in (first_name, middle_name, last_name, suffix) if p).strip()
                manual_family = Family(
                    roster_year_id=active_year.id,
                    barangay_id=barangay_id,
                    family_code=f"MAN-{secrets.token_hex(4).upper()}",
                    head_name=head_display[:150],
                    address=address or None,
                    contact_number=contact_number or None,
                    member_count=1,
                )
                db.session.add(manual_family)
                db.session.flush()
                family_id = manual_family.id

        resident = Resident(
            family_id=family_id,
            first_name=first_name,
            middle_name=middle_name or None,
            last_name=last_name,
            suffix=suffix or None,
            date_of_birth=birthdate_obj,
            alternate_contact=contact_number or None,
            is_head_of_family=bool(family_id),
            relationship_to_head='Household Head' if family_id else None,
        )
        db.session.add(resident)
        db.session.flush()

    # Validate birthdate before creating the account and registration record
    raw_birthdate = str(data.get('birthdate') or data.get('date_of_birth') or '').strip()
    if raw_birthdate:
        birth_dt, birth_err = _parse_past_birthdate(raw_birthdate)
        if birth_err:
            return jsonify({'error': birth_err}), 400
    elif resident.date_of_birth:
        if resident.date_of_birth >= philippines_now().date() or resident.date_of_birth.year < 1900:
            return jsonify({'error': 'Resident birthdate must be a past date.'}), 400
        birth_dt = resident.date_of_birth
    else:
        return jsonify({'error': 'Birthdate is required and must be a past date.'}), 400

    # Create ResidentAccount with an unusable random password until setup link is completed
    pwd_hash = generate_unusable_password_hash()
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
    elif resident.family and resident.family.barangay_id:
        b_row = db.session.get(Barangay, resident.family.barangay_id)
        if b_row:
            barangay_name = b_row.name

    fallback_address = str(data.get('address') or '').strip()
    fallback_contact = str(data.get('contact_number') or '').strip()

    # Create matching approved ResidentRegistrationRequest for complete recordkeeping
    reg_request = ResidentRegistrationRequest(
        first_name=resident.first_name,
        middle_name=resident.middle_name,
        last_name=resident.last_name,
        birthdate=birth_dt,
        barangay=barangay_name or 'N/A',
        address=resident.address or fallback_address or 'N/A',
        contact_number=resident.contact_number or fallback_contact or 'N/A',
        email=email,
        password_hash=pwd_hash,
        status='approved',
        matched_resident_id=resident.id,
        reviewed_by=reviewer_id,
        reviewed_at=utc_now(),
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

    email_sent, message = send_account_setup_link(
        account,
        token_creator=create_password_setup_token,
        email_sender=send_password_setup_email,
    )

    return jsonify({
        'message': message,
        'account': account.to_dict(),
        'resident': resident.to_dict(),
        'registration': reg_request.to_dict(),
        'email_sent': email_sent,
    }), 201

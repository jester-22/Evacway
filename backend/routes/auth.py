import base64
import hmac
import hashlib
import re
import secrets
import time
from datetime import timedelta
from collections import defaultdict
from threading import Lock
from urllib.parse import quote

from flask import Blueprint, current_app, request, jsonify
from cryptography.fernet import Fernet, InvalidToken
from models import (
    db,
    AdminMfaRecoveryRequest,
    User,
    ResidentAccount,
    ResidentRegistrationRequest,
    SystemLog,
    philippines_now,
)
from werkzeug.security import check_password_hash, generate_password_hash
from flask_jwt_extended import create_access_token, decode_token, get_jwt_identity
from sqlalchemy import func
from services.mailer import send_password_setup_email
from services.password_setup import (
    create_password_setup_token,
    is_token_password_current,
    read_password_setup_token,
)
from utils import role_required

auth_bp = Blueprint('auth', __name__)

_login_rate_buckets = defaultdict(list)
_login_rate_lock = Lock()
_DUMMY_PASSWORD_HASH = generate_password_hash('EvacWay invalid login timing sentinel')


def _generic_login_failure():
    return jsonify({"error": "Incorrect email or password"}), 401


def _login_rate_limited(login_type, email, include_email=True):
    now = time.monotonic()
    window = int(current_app.config.get('LOGIN_RATE_LIMIT_WINDOW_SECONDS', 900))
    maximum = int(current_app.config.get('LOGIN_RATE_LIMIT_MAX_REQUESTS', 20))
    client_ip = (
        request.headers.get('X-Real-IP')
        or request.remote_addr
        or 'unknown'
    ).strip()
    email_digest = hashlib.sha256(email.encode('utf-8')).hexdigest()
    keys = [f'{login_type}:ip:{client_ip}']
    if include_email:
        keys.append(f'{login_type}:email:{email_digest}')
    with _login_rate_lock:
        for key in keys:
            _login_rate_buckets[key] = [
                timestamp for timestamp in _login_rate_buckets[key]
                if now - timestamp < window
            ]
        if any(len(_login_rate_buckets[key]) >= maximum for key in keys):
            return True
        for key in keys:
            _login_rate_buckets[key].append(now)
    return False


def _totp_timestamp():
    return time.time()


def generate_totp_secret():
    return base64.b32encode(secrets.token_bytes(20)).decode('ascii').rstrip('=')


def generate_totp_code(secret, timestamp=None):
    timestamp = _totp_timestamp() if timestamp is None else timestamp
    key = base64.b32decode(secret + '=' * ((8 - len(secret) % 8) % 8))
    counter = int(timestamp // 30)
    digest = hmac.new(key, counter.to_bytes(8, 'big'), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    binary = int.from_bytes(digest[offset:offset + 4], 'big') & 0x7FFFFFFF
    return f'{binary % 1_000_000:06d}'


def _verify_totp_code(secret, code, last_used_step=None):
    code = str(code or '').strip()
    if not re.fullmatch(r'\d{6}', code):
        return None
    current_step = int(_totp_timestamp() // 30)
    matching_steps = []
    for step in range(current_step - 1, current_step + 2):
        expected = generate_totp_code(secret, timestamp=step * 30)
        if hmac.compare_digest(expected, code) and (last_used_step is None or step > last_used_step):
            matching_steps.append(step)
    return max(matching_steps) if matching_steps else None


def _totp_cipher():
    jwt_secret = str(current_app.config.get('JWT_SECRET_KEY') or '').encode('utf-8')
    if not jwt_secret:
        raise RuntimeError('JWT_SECRET_KEY must be configured to encrypt TOTP secrets.')
    derived_key = hashlib.sha256(b'EvacWay TOTP encryption v1\0' + jwt_secret).digest()
    return Fernet(base64.urlsafe_b64encode(derived_key))


def _encrypt_totp_secret(secret):
    return _totp_cipher().encrypt(secret.encode('ascii')).decode('ascii')


def _decrypt_totp_secret(encrypted_secret):
    return _totp_cipher().decrypt(encrypted_secret.encode('ascii')).decode('ascii')


def _totp_uri(user, secret):
    issuer = 'EvacWay'
    label = quote(f'{issuer}:{user.email}', safe='')
    return (
        f'otpauth://totp/{label}?secret={quote(secret)}&issuer={quote(issuer)}'
        '&algorithm=SHA1&digits=6&period=30'
    )


def _staff_totp_required(user):
    return (
        user.role == 'admin'
        or bool(current_app.config.get('LGU_TOTP_REQUIRED', False))
        or bool(user.totp_enabled)
    )


def _staff_access_token(user, mfa_verified):
    return create_access_token(
        identity=str(user.id),
        additional_claims={
            'role': user.role,
            'name': user.name,
            'account_type': 'user',
            'resident_id': user.resident_id,
            'mfa_verified': bool(mfa_verified),
            'mfa_version': int(user.mfa_version or 0),
        },
    )


def _mfa_flow_token(user, flow, expires_minutes=10):
    return create_access_token(
        identity=str(user.id),
        expires_delta=timedelta(minutes=expires_minutes),
        additional_claims={
            'role': user.role,
            'account_type': 'user',
            'mfa_flow': flow,
        },
    )


def _resolve_mfa_flow_token(token, expected_flow):
    try:
        claims = decode_token(token)
        if claims.get('account_type') != 'user' or claims.get('mfa_flow') != expected_flow:
            return None
        user = db.session.get(User, int(claims.get('sub')))
        if (
            not user
            or not user.is_active
            or user.role not in ('admin', 'lgu_personnel')
        ):
            return None
        return user
    except Exception:
        return None


def _pending_totp_secret(user):
    now = philippines_now()
    secret = None
    if (
        user.totp_pending_secret_encrypted
        and user.totp_setup_expires_at
        and user.totp_setup_expires_at > now
    ):
        try:
            secret = _decrypt_totp_secret(user.totp_pending_secret_encrypted)
        except (InvalidToken, ValueError):
            secret = None
    if secret is None:
        secret = generate_totp_secret()
        user.totp_pending_secret_encrypted = _encrypt_totp_secret(secret)
        user.totp_setup_expires_at = now + timedelta(minutes=10)
    return secret


def _new_backup_codes(count=10):
    alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    codes = []
    hashes = []
    for _ in range(count):
        raw = ''.join(secrets.choice(alphabet) for _ in range(12))
        code = '-'.join((raw[:4], raw[4:8], raw[8:]))
        codes.append(code)
        hashes.append(hashlib.sha256(b'EvacWay backup code v1\0' + raw.encode('ascii')).hexdigest())
    return codes, hashes


def _backup_code_index(code, hashes):
    normalized = re.sub(r'[-\s]', '', str(code or '')).upper()
    if not re.fullmatch(r'[A-HJ-NP-Z2-9]{12}', normalized):
        return None
    candidate_hash = hashlib.sha256(b'EvacWay backup code v1\0' + normalized.encode('ascii')).hexdigest()
    for index, stored_hash in enumerate(hashes or []):
        if hmac.compare_digest(str(stored_hash), candidate_hash):
            return index
    return None


def _begin_staff_second_factor(user):
    if user.totp_enabled and user.totp_secret_encrypted:
        return jsonify({
            'totp_required': True,
            'challenge_token': _mfa_flow_token(user, 'staff_totp_challenge'),
        }), 200

    secret = _pending_totp_secret(user)
    db.session.commit()
    return jsonify({
        'totp_enrollment_required': True,
        'setup_token': _mfa_flow_token(user, 'staff_totp_enrollment'),
        'totp_secret': secret,
        'otpauth_uri': _totp_uri(user, secret),
    }), 200


def _mfa_failure_or_limit(user=None):
    if user and user.login_locked_until and user.login_locked_until > philippines_now():
        return _generic_login_failure()
    if _login_rate_limited('staff', user.email if user else '', include_email=user is not None):
        return jsonify({"error": "Too many attempts. Please wait a moment and try again."}), 429
    return None


def _clear_login_failures(account):
    account.login_failed_attempts = 0
    account.login_failure_window_started_at = None
    account.login_locked_until = None


def _record_login_failure(account, login_type):
    now = philippines_now()
    window = timedelta(minutes=int(current_app.config.get('LOGIN_FAILURE_WINDOW_MINUTES', 15)))
    lock_duration = timedelta(minutes=int(current_app.config.get('LOGIN_LOCK_MINUTES', 15)))
    max_failures = int(current_app.config.get('LOGIN_MAX_FAILED_ATTEMPTS', 5))

    account_class = type(account)
    locked_account = (
        account_class.query.filter_by(id=account.id)
        .with_for_update()
        .populate_existing()
        .first()
    )
    if not locked_account:
        return

    if locked_account.login_locked_until and locked_account.login_locked_until > now:
        return
    if locked_account.login_locked_until:
        locked_account.login_locked_until = None
        locked_account.login_failed_attempts = 0
        locked_account.login_failure_window_started_at = now
    if (
        locked_account.login_failure_window_started_at is None
        or now - locked_account.login_failure_window_started_at >= window
    ):
        locked_account.login_failed_attempts = 0
        locked_account.login_failure_window_started_at = now

    locked_account.login_failed_attempts += 1
    if locked_account.login_failed_attempts >= max_failures:
        was_locked = bool(locked_account.login_locked_until and locked_account.login_locked_until > now)
        locked_account.login_locked_until = now + lock_duration
        if not was_locked:
            staff_user_id = locked_account.id if isinstance(locked_account, User) else None
            db.session.add(SystemLog(
                user_id=staff_user_id,
                action=(
                    f"Login locked after repeated failures ({login_type}): "
                    f"{locked_account.email}"
                ),
                timestamp=now,
            ))
    db.session.commit()


def _login(expected_type):
    data = request.get_json(silent=True)
    data = data if isinstance(data, dict) else {}
    email = str(data.get('email') or '').strip().lower()
    password = data.get('password')
    password = password if isinstance(password, str) else ''
    login_type = 'resident' if expected_type == 'resident' else 'staff'

    user = User.query.filter(func.lower(User.email) == email).first() if email else None
    resident_account = ResidentAccount.query.filter(
        func.lower(ResidentAccount.email) == email
    ).first() if email else None

    expected_account = resident_account if expected_type == 'resident' else user
    other_account = user if expected_type == 'resident' else resident_account
    account = expected_account or other_account
    registration_request = None
    if expected_type == 'resident' and account is None and email:
        registration_request = ResidentRegistrationRequest.query.filter(
            func.lower(ResidentRegistrationRequest.email) == email,
            ResidentRegistrationRequest.status.in_(('pending', 'rejected')),
        ).order_by(ResidentRegistrationRequest.created_at.desc()).first()
    now = philippines_now()
    if account and account.login_locked_until and account.login_locked_until > now:
        check_password_hash(account.password_hash, password)
        return _generic_login_failure()
    if _login_rate_limited(login_type, email):
        return jsonify({"error": "Too many attempts. Please wait a moment and try again."}), 429

    password_matches = check_password_hash(
        account.password_hash if account else (
            registration_request.password_hash if registration_request else _DUMMY_PASSWORD_HASH
        ),
        password,
    )

    if expected_type == 'resident' and expected_account is not None and password_matches and not expected_account.is_active:
        return jsonify({'error': 'Your account is inactive.', 'status': 'inactive'}), 403

    if expected_type == 'resident' and registration_request and password_matches:
        if registration_request.status == 'pending':
            return jsonify({'error': 'Awaiting verification.', 'status': 'awaiting_verification'}), 403
        reason = registration_request.rejection_reason or 'No reason was provided.'
        return jsonify({
            'error': f'Your registration was rejected: {reason}',
            'status': 'rejected',
        }), 403

    expected_role_matches = (
        expected_type == 'resident'
        or (user is not None and user.role in ('admin', 'lgu_personnel'))
    )
    if (
        expected_account is not None
        and password_matches
        and expected_account.is_active
        and expected_role_matches
    ):
        if expected_type == 'resident':
            _clear_login_failures(resident_account)
            resident_account.last_login_at = now
            db.session.commit()
            access_token = create_access_token(
                identity=str(resident_account.id),
                additional_claims={
                    "role": "resident",
                    "name": resident_account.resident.get_full_name() if resident_account.resident else "Resident",
                    "account_type": "resident_account",
                    "resident_id": resident_account.resident_id,
                },
            )
            response_user = {
                "id": resident_account.id,
                "name": resident_account.resident.get_full_name() if resident_account.resident else "Resident",
                "email": resident_account.email,
                "resident_id": resident_account.resident_id,
                "family_member_count": (
                    max(int(resident_account.resident.family.member_count or 1), 1)
                    if resident_account.resident and resident_account.resident.family
                    else 1
                ),
                "contact_number": (
                    resident_account.resident.contact_number
                    if resident_account.resident
                    else None
                ),
                "role": "resident",
                "is_active": True,
                "last_login_at": resident_account.last_login_at.isoformat() if resident_account.last_login_at else None,
            }
        else:
            if _staff_totp_required(user):
                return _begin_staff_second_factor(user)
            _clear_login_failures(user)
            user.last_login_at = now
            db.session.commit()
            access_token = _staff_access_token(user, mfa_verified=False)
            response_user = user.to_dict()

        return jsonify({"access_token": access_token, "user": response_user}), 200

    if account and account.is_active:
        _record_login_failure(account, login_type)
    return _generic_login_failure()


@auth_bp.route('/api/auth/login', methods=['POST'])
def login():
    """Staff login. Kept on the existing staff route; never authenticates residents."""
    return _login('staff')


@auth_bp.route('/api/auth/resident-login', methods=['POST'])
def resident_login():
    """Resident-only login used by the resident map dialog."""
    return _login('resident')


def _mfa_request_user(data, flow):
    return _resolve_mfa_flow_token(data.get('challenge_token') or data.get('setup_token'), flow)


def _mfa_payload():
    payload = request.get_json(silent=True)
    return payload if isinstance(payload, dict) else {}


def _mfa_rate_and_lock_response(user):
    limited = _mfa_failure_or_limit(user)
    if limited:
        return limited
    return None


def _mfa_success(user, event):
    now = philippines_now()
    _clear_login_failures(user)
    user.last_login_at = now
    db.session.add(SystemLog(user_id=user.id, action=event, timestamp=now))
    db.session.commit()
    return jsonify({
        'access_token': _staff_access_token(user, mfa_verified=True),
        'user': user.to_dict(),
    }), 200


@auth_bp.route('/api/auth/staff/totp/enroll/confirm', methods=['POST'])
def confirm_staff_totp_enrollment():
    data = _mfa_payload()
    user = _mfa_request_user(data, 'staff_totp_enrollment')
    if not user:
        return _generic_login_failure()
    user = User.query.filter_by(id=user.id).with_for_update().populate_existing().first()
    if not user or not user.is_active or user.role not in ('admin', 'lgu_personnel'):
        return _generic_login_failure()
    blocked = _mfa_rate_and_lock_response(user)
    if blocked:
        return blocked
    if not user.totp_pending_secret_encrypted or not user.totp_setup_expires_at or user.totp_setup_expires_at <= philippines_now():
        return _generic_login_failure()
    try:
        secret = _decrypt_totp_secret(user.totp_pending_secret_encrypted)
    except (InvalidToken, ValueError):
        return _generic_login_failure()
    step = _verify_totp_code(secret, data.get('code'))
    if step is None:
        _record_login_failure(user, 'staff_mfa')
        return _generic_login_failure()

    codes, hashes = _new_backup_codes()
    user.totp_secret_encrypted = user.totp_pending_secret_encrypted
    user.totp_pending_secret_encrypted = None
    user.totp_setup_expires_at = None
    user.totp_enabled = True
    user.totp_last_used_step = step
    user.totp_backup_codes_hashes = hashes
    user.mfa_version = int(user.mfa_version or 0) + 1
    now = philippines_now()
    _clear_login_failures(user)
    user.last_login_at = now
    db.session.add(SystemLog(user_id=user.id, action='Staff two-factor authentication enabled', timestamp=now))
    db.session.commit()
    return jsonify({
        'access_token': _staff_access_token(user, mfa_verified=True),
        'user': user.to_dict(),
        'backup_codes': codes,
    }), 200


@auth_bp.route('/api/auth/staff/totp/verify', methods=['POST'])
def verify_staff_totp():
    data = _mfa_payload()
    user = _mfa_request_user(data, 'staff_totp_challenge')
    if not user:
        return _generic_login_failure()
    user = User.query.filter_by(id=user.id).with_for_update().populate_existing().first()
    if not user or not user.is_active or user.role not in ('admin', 'lgu_personnel'):
        return _generic_login_failure()
    blocked = _mfa_rate_and_lock_response(user)
    if blocked:
        return blocked
    if not user.totp_enabled or not user.totp_secret_encrypted:
        return _generic_login_failure()
    try:
        secret = _decrypt_totp_secret(user.totp_secret_encrypted)
    except (InvalidToken, ValueError):
        return _generic_login_failure()

    code = data.get('code')
    step = _verify_totp_code(secret, code, user.totp_last_used_step)
    used_backup = False
    if step is not None:
        user.totp_last_used_step = step
    else:
        hashes = list(user.totp_backup_codes_hashes or [])
        index = _backup_code_index(code, hashes)
        if index is None:
            _record_login_failure(user, 'staff_mfa')
            return _generic_login_failure()
        hashes.pop(index)
        user.totp_backup_codes_hashes = hashes
        used_backup = True
    return _mfa_success(user, 'Staff signed in with backup code' if used_backup else 'Staff two-factor sign-in completed')


@auth_bp.route('/api/auth/staff/totp/recovery', methods=['POST'])
def request_staff_totp_recovery():
    data = _mfa_payload()
    user = _mfa_request_user(data, 'staff_totp_challenge')
    if not user:
        return _generic_login_failure()
    blocked = _mfa_rate_and_lock_response(user)
    if blocked:
        return blocked
    now = philippines_now()
    AdminMfaRecoveryRequest.query.filter(
        AdminMfaRecoveryRequest.user_id == user.id,
        AdminMfaRecoveryRequest.status == 'pending',
        AdminMfaRecoveryRequest.expires_at <= now,
    ).update({'status': 'expired'}, synchronize_session=False)
    existing = AdminMfaRecoveryRequest.query.filter(
        AdminMfaRecoveryRequest.user_id == user.id,
        AdminMfaRecoveryRequest.status == 'pending',
        AdminMfaRecoveryRequest.expires_at > now,
    ).first()
    if not existing:
        db.session.add(AdminMfaRecoveryRequest(
            user_id=user.id,
            status='pending',
            requested_at=now,
            expires_at=now + timedelta(hours=24),
        ))
        db.session.add(SystemLog(user_id=user.id, action='Staff requested two-factor account recovery', timestamp=now))
        db.session.commit()
    return jsonify({'message': 'Recovery request sent for admin approval.'}), 202


@auth_bp.route('/api/admin/mfa-recovery-requests', methods=['GET'])
@role_required('admin')
def list_admin_mfa_recovery_requests():
    now = philippines_now()
    requests_pending = AdminMfaRecoveryRequest.query.filter(
        AdminMfaRecoveryRequest.status == 'pending',
        AdminMfaRecoveryRequest.expires_at > now,
    ).order_by(AdminMfaRecoveryRequest.requested_at.asc()).all()
    payload = []
    for row in requests_pending:
        target = db.session.get(User, row.user_id)
        if target:
            payload.append({
                'id': row.id,
                'user_id': target.id,
                'name': target.name,
                'email': target.email,
                'requested_at': row.requested_at.isoformat() if row.requested_at else None,
            })
    return jsonify({'requests': payload}), 200


@auth_bp.route('/api/admin/mfa-recovery-requests/<int:request_id>/approve', methods=['POST'])
@role_required('admin')
def approve_admin_mfa_recovery_request(request_id):
    approver_id = int(get_jwt_identity())
    recovery = AdminMfaRecoveryRequest.query.filter_by(id=request_id).with_for_update().first()
    now = philippines_now()
    if not recovery or recovery.status != 'pending' or recovery.expires_at <= now or recovery.user_id == approver_id:
        return jsonify({'error': 'Recovery request is unavailable.'}), 404
    target = db.session.get(User, recovery.user_id)
    if not target or target.role not in ('admin', 'lgu_personnel') or not target.totp_enabled:
        return jsonify({'error': 'Recovery request is unavailable.'}), 404
    recovery.status = 'approved'
    recovery.approved_by_user_id = approver_id
    recovery.approved_at = now
    AdminMfaRecoveryRequest.query.filter(
        AdminMfaRecoveryRequest.user_id == target.id,
        AdminMfaRecoveryRequest.id != recovery.id,
        AdminMfaRecoveryRequest.status == 'pending',
    ).update({'status': 'cancelled'}, synchronize_session=False)
    target.totp_enabled = False
    target.totp_secret_encrypted = None
    target.totp_pending_secret_encrypted = None
    target.totp_setup_expires_at = None
    target.totp_last_used_step = None
    target.totp_backup_codes_hashes = None
    target.mfa_version = int(target.mfa_version or 0) + 1
    db.session.add(SystemLog(user_id=approver_id, action=f'Approved two-factor recovery for staff user {target.id}', timestamp=now))
    db.session.commit()
    return jsonify({'message': 'Recovery approved. The staff account must enroll again at next sign in.'}), 200


@auth_bp.route('/api/auth/password/forgot', methods=['POST'])
def request_password_reset():
    data = request.get_json(silent=True) or {}
    email = str(data.get('email') or '').strip().lower()

    if re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', email):
        # Check users table (admin, lgu_personnel)
        user = User.query.filter(func.lower(User.email) == email).first()
        if user and user.is_active:
            try:
                token = create_password_setup_token(user)
                send_password_setup_email(user, token, purpose="reset")
            except Exception:
                current_app.logger.exception("Password reset email delivery failed")
        else:
            # Check resident_accounts table
            resident_account = ResidentAccount.query.filter(
                func.lower(ResidentAccount.email) == email,
                ResidentAccount.is_active == True
            ).first()
            if resident_account:
                try:
                    token = create_password_setup_token(resident_account)
                    send_password_setup_email(resident_account, token, purpose="reset")
                except Exception:
                    current_app.logger.exception("Password reset email delivery failed for resident account")

    return jsonify({
        "message": "If an active account matches that email, a password reset link has been sent."
    }), 202


@auth_bp.route('/api/auth/password/setup', methods=['POST'])
def complete_password_setup():
    data = request.get_json(silent=True) or {}
    token = data.get('token')
    password = data.get('password')

    if not token or not isinstance(password, str):
        return jsonify({"error": "Password link and new password are required"}), 400
    if (
        len(password) < 8
        or not re.search(r"[A-Z]", password)
        or not re.search(r"[a-z]", password)
        or not re.search(r"[0-9]", password)
        or not re.search(r"[^A-Za-z0-9\s]", password)
    ):
        return jsonify({
            "error": "Password must have at least 8 characters, including an uppercase letter, a lowercase letter, a number, and a special character"
        }), 400

    payload, token_error = read_password_setup_token(token)
    if token_error:
        return jsonify({"error": token_error}), 400

    user_id = payload.get("user_id")
    token_email = str(payload.get("email", "")).strip().lower()
    account_type = payload.get("account_type", "user")

    if account_type == "resident_account":
        account = ResidentAccount.query.get(user_id)
        if not account or account.email.strip().lower() != token_email:
            return jsonify({"error": "This password link is no longer valid"}), 400
        if not is_token_password_current(payload, account.password_hash):
            return jsonify({"error": "This password link has already been used or is no longer valid."}), 400

        account.password_hash = generate_password_hash(password)
        db.session.add(SystemLog(user_id=None, action=f"Resident account ({account.email}) set or reset password using email link"))
        db.session.commit()
    else:
        user = User.query.get(user_id)
        if not user or user.email.strip().lower() != token_email:
            return jsonify({"error": "This password link is no longer valid"}), 400
        if not is_token_password_current(payload, user.password_hash):
            return jsonify({"error": "This password link has already been used or is no longer valid."}), 400

        user.password_hash = generate_password_hash(password)
        db.session.add(SystemLog(user_id=user.id, action="Password set or reset using email link"))
        db.session.commit()

    return jsonify({"message": "Password updated. You can now sign in."})

import logging
import os
import re
import secrets
import smtplib
import socket

from flask import Blueprint, current_app, request, jsonify
from models import db, User, ResidentAccount, SystemLog, to_utc_iso
from werkzeug.security import check_password_hash, generate_password_hash
from flask_jwt_extended import get_jwt_identity
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from services.mailer import MailConfigurationError, send_password_setup_email
from services.password_setup import (
    create_password_setup_token,
    generate_unusable_password_hash,
    send_account_setup_link,
)
from utils import role_required

users_bp = Blueprint('users', __name__)
PASSWORD_POLICY_ERROR = (
    'Password must have at least 8 characters, including an uppercase letter, '
    'a lowercase letter, a number, and a special character'
)
SMTP_LOGIN_ERROR = (
    'The mail server rejected the login. Check the mail username and app password.'
)
SMTP_CONNECTION_ERROR = 'Could not reach the mail server. Check the host, port, and network.'
SMTP_DISCONNECTED_ERROR = (
    'The mail server closed the connection while signing in. The app password may be '
    'missing, wrong, or revoked, or an antivirus may be scanning email.'
)


def valid_password(password):
    return (
        isinstance(password, str)
        and len(password) >= 8
        and re.search(r'[A-Z]', password)
        and re.search(r'[a-z]', password)
        and re.search(r'[0-9]', password)
        and re.search(r'[^A-Za-z0-9\s]', password)
    )


_NON_ROUTABLE_EMAIL_SUFFIXES = ('.local', '.localhost', '.invalid', '.internal', '.lan')


def _parse_optional_recovery_email(raw_value):
    val = str(raw_value or '').strip().lower()
    if not val:
        return None, None
    if len(val) > 120 or not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', val):
        return None, 'Enter a valid recovery email address'
    domain = val.rsplit('@', 1)[1]
    if any(domain.endswith(suffix) for suffix in _NON_ROUTABLE_EMAIL_SUFFIXES):
        return None, 'Recovery email must be a deliverable email address (not .local)'
    return val, None


def current_user():
    return db.session.get(User, int(get_jwt_identity()))


def _safe_smtp_error_message(error):
    message = str(error)
    for password in (current_app.config.get('MAIL_PASSWORD'), os.environ.get('MAIL_PASSWORD')):
        if password:
            message = message.replace(password, '[redacted]')
            normalized = password.strip().strip("\"'").replace(' ', '')
            if normalized:
                message = message.replace(normalized, '[redacted]')
    return message


def _password_email_failure(error, message):
    detail = _safe_smtp_error_message(error)
    # Redact the traceback's exception text too, not just the formatted log message.
    logging.exception(
        'Password reset email failed with %s (SMTP code=%s): %s',
        type(error).__name__, getattr(error, 'smtp_code', None), detail,
        exc_info=(RuntimeError, RuntimeError(detail), error.__traceback__),
    )
    return jsonify({'error': message}), 502


@users_bp.route('/api/users', methods=['GET'])
@role_required('admin')
def list_users():
    # Admin sees all LGU personnel accounts (and other admins) so they can manage them
    users = User.query.filter(User.role.in_(['lgu_personnel', 'admin'])).all()
    return jsonify([u.to_dict() for u in users])


@users_bp.route('/api/users/me', methods=['GET'])
@role_required('admin', 'lgu_personnel')
def get_my_profile():
    from routes.auth import _staff_profile_payload
    return jsonify(_staff_profile_payload(current_user()))


@users_bp.route('/api/users/me', methods=['PATCH'])
@role_required('admin', 'lgu_personnel')
def update_my_profile():
    from routes.auth import _is_deliverable_email, _staff_profile_payload
    user = current_user()
    data = request.get_json(silent=True) or {}
    name = str(data.get('name') or '').strip()
    email = str(data.get('email') or '').strip().lower()
    contact_number = str(data.get('contact_number') or '').strip() or None
    recovery_email_provided = 'recovery_email' in data
    recovery_email, recovery_err = (
        _parse_optional_recovery_email(data.get('recovery_email'))
        if recovery_email_provided
        else (user.recovery_email, None)
    )

    if not name or len(name) > 100:
        return jsonify({'error': 'Name is required and must be 100 characters or fewer'}), 400
    if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', email):
        return jsonify({'error': 'Enter a valid email address'}), 400
    if recovery_err:
        return jsonify({'error': recovery_err}), 400
    if contact_number and len(contact_number) > 20:
        return jsonify({'error': 'Contact number must be 20 characters or fewer'}), 400

    next_recovery = recovery_email if recovery_email_provided else user.recovery_email
    has_active_mfa = bool(user.totp_enabled) or user.role == 'admin'
    if has_active_mfa and not _is_deliverable_email(email) and not _is_deliverable_email(next_recovery):
        return jsonify({
            'error': 'Accounts with two-factor authentication enabled must keep a valid deliverable email address.'
        }), 400

    duplicate = User.query.filter(
        func.lower(User.email) == email,
        User.id != user.id,
    ).first()
    if duplicate:
        return jsonify({'error': 'A user with this email already exists'}), 409
    if ResidentAccount.query.filter(
        func.lower(ResidentAccount.email) == email,
        ResidentAccount.is_active == True
    ).first():
        return jsonify({'error': 'A user with this email already exists'}), 409

    user.name = name
    user.email = email
    if recovery_email_provided:
        user.recovery_email = recovery_email
    user.contact_number = contact_number
    db.session.add(SystemLog(user_id=user.id, action='Updated own account details'))
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': 'A user with this email already exists'}), 409
    return jsonify(_staff_profile_payload(user))


@users_bp.route('/api/users/me/password', methods=['POST'])
@role_required('admin', 'lgu_personnel')
def change_my_password():
    user = current_user()
    data = request.get_json(silent=True) or {}
    current_password = data.get('current_password')
    new_password = data.get('new_password')

    if not isinstance(current_password, str) or not isinstance(new_password, str):
        return jsonify({'error': 'Current password and new password are required'}), 400
    if not check_password_hash(user.password_hash, current_password):
        return jsonify({'error': 'Current password is incorrect'}), 403
    if not valid_password(new_password):
        return jsonify({'error': PASSWORD_POLICY_ERROR}), 400

    user.password_hash = generate_password_hash(new_password)
    db.session.add(SystemLog(user_id=user.id, action='Changed own password'))
    db.session.commit()
    return jsonify({'message': 'Password changed successfully.'})


@users_bp.route('/api/users/me/reset-password', methods=['POST'])
@role_required('admin', 'lgu_personnel')
def request_my_password_reset():
    user = current_user()
    try:
        token = create_password_setup_token(user)
        send_password_setup_email(user, token, purpose='reset')
    except Exception:
        current_app.logger.exception('Could not send own password reset email to user %s', user.id)
        return jsonify({'error': 'Password reset email could not be sent. Check backend SMTP settings.'}), 503

    db.session.add(SystemLog(user_id=user.id, action='Requested own password reset email'))
    db.session.commit()
    return jsonify({'message': f'Password reset link sent to {user.email}.'})


@users_bp.route('/api/users/<int:user_id>', methods=['PATCH'])
@role_required('admin')
def update_user(user_id):
    user = User.query.get_or_404(user_id)
    data = request.get_json(silent=True) or {}
    name = str(data.get('name') or '').strip()
    email = str(data.get('email') or '').strip().lower()
    contact_number = str(data.get('contact_number') or '').strip() or None
    role = data.get('role', user.role)
    recovery_email_provided = 'recovery_email' in data
    recovery_email, recovery_err = (
        _parse_optional_recovery_email(data.get('recovery_email'))
        if recovery_email_provided
        else (user.recovery_email, None)
    )

    if not name or len(name) > 100:
        return jsonify({'error': 'Name is required and must be 100 characters or fewer'}), 400
    if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', email):
        return jsonify({'error': 'Enter a valid email address'}), 400
    if recovery_err:
        return jsonify({'error': recovery_err}), 400
    if contact_number and len(contact_number) > 20:
        return jsonify({'error': 'Contact number must be 20 characters or fewer'}), 400
    if role not in ('admin', 'lgu_personnel'):
        return jsonify({'error': "role must be 'admin' or 'lgu_personnel'"}), 400
    if str(user.id) == str(get_jwt_identity()) and role != user.role:
        return jsonify({'error': 'You cannot change your own account role'}), 400

    duplicate = User.query.filter(
        func.lower(User.email) == email,
        User.id != user.id,
    ).first()
    if duplicate:
        return jsonify({'error': 'A user with this email already exists'}), 409
    if ResidentAccount.query.filter(
        func.lower(ResidentAccount.email) == email,
        ResidentAccount.is_active == True
    ).first():
        return jsonify({'error': 'A user with this email already exists'}), 409

    user.name = name
    user.email = email
    if recovery_email_provided:
        user.recovery_email = recovery_email
    user.contact_number = contact_number
    user.role = role
    db.session.add(SystemLog(
        user_id=get_jwt_identity(),
        action=f'Updated account details for user #{user.id}',
    ))
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': 'A user with this email already exists'}), 409
    return jsonify(user.to_dict())


@users_bp.route('/api/users/check-email', methods=['GET'])
@role_required('admin')
def check_user_email():
    email = (request.args.get('email') or '').strip().lower()
    if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', email):
        return jsonify({"error": "Enter a valid email address"}), 400

    exists = User.query.filter(func.lower(User.email) == email).first() is not None
    if not exists:
        exists = ResidentAccount.query.filter(
            func.lower(ResidentAccount.email) == email,
            ResidentAccount.is_active == True
        ).first() is not None
    return jsonify({"exists": exists})


@users_bp.route('/api/users', methods=['POST'])
@role_required('admin')
def create_user():
    data = request.get_json(silent=True) or {}
    required = ['name', 'email', 'role']
    if not all(data.get(f) for f in required):
        return jsonify({"error": "name, email, and role are required"}), 400

    if data['role'] not in ['admin', 'lgu_personnel']:
        return jsonify({"error": "role must be 'admin' or 'lgu_personnel'"}), 400

    email = data['email'].strip().lower()
    if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', email):
        return jsonify({"error": "Enter a valid email address"}), 400

    if User.query.filter(func.lower(User.email) == email).first():
        return jsonify({"error": "A user with this email already exists"}), 409
    if ResidentAccount.query.filter(
        func.lower(ResidentAccount.email) == email,
        ResidentAccount.is_active == True
    ).first():
        return jsonify({"error": "A user with this email already exists"}), 409

    recovery_email, recovery_err = _parse_optional_recovery_email(data.get('recovery_email'))
    if recovery_err:
        return jsonify({"error": recovery_err}), 400

    new_user = User(
        name=data['name'].strip(),
        email=email,
        recovery_email=recovery_email,
        password_hash=generate_unusable_password_hash(),
        contact_number=data.get('contact_number'),
        role=data['role'],
        is_active=True
    )
    db.session.add(new_user)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"error": "A user with this email already exists"}), 409

    admin_id = get_jwt_identity()
    db.session.add(SystemLog(user_id=admin_id, action=f"Created {data['role']} account: {data['email']}"))
    db.session.commit()

    email_sent, message = send_account_setup_link(
        new_user,
        token_creator=create_password_setup_token,
        email_sender=send_password_setup_email,
    )

    return jsonify({
        "user": new_user.to_dict(),
        "email_sent": email_sent,
        "message": message,
    }), 201


@users_bp.route('/api/users/<int:user_id>/reset-password', methods=['POST'])
@role_required('admin')
def reset_user_password(user_id):
    user = User.query.get_or_404(user_id)

    try:
        token = create_password_setup_token(user)
        send_password_setup_email(user, token, purpose="reset")
    except smtplib.SMTPAuthenticationError as error:
        return _password_email_failure(error, SMTP_LOGIN_ERROR)
    except smtplib.SMTPServerDisconnected as error:
        return _password_email_failure(error, SMTP_DISCONNECTED_ERROR)
    except (
        TimeoutError,
        ConnectionRefusedError,
        socket.gaierror,
        smtplib.SMTPConnectError,
    ) as error:
        return _password_email_failure(error, SMTP_CONNECTION_ERROR)
    except smtplib.SMTPRecipientsRefused as error:
        return _password_email_failure(error, 'The recipient address was rejected.')
    except MailConfigurationError as error:
        return _password_email_failure(
            error, 'Email is not configured correctly. Check the backend MAIL_* settings and frontend URLs.'
        )
    except smtplib.SMTPException as error:
        return _password_email_failure(error, 'Could not send the email. The mail server rejected the message.')
    except OSError as error:
        return _password_email_failure(error, SMTP_CONNECTION_ERROR)
    except Exception as error:
        return _password_email_failure(error, 'Could not send the email. Check the backend logs for details.')

    admin_id = get_jwt_identity()
    db.session.add(SystemLog(user_id=admin_id, action=f"Sent password reset email to: {user.email}"))
    db.session.commit()

    return jsonify({"message": f"Password setup link sent to {user.email}.", "email_sent": True})


@users_bp.route('/api/users/<int:user_id>/toggle-active', methods=['PATCH'])
@role_required('admin')
def toggle_user_active(user_id):
    user = User.query.get_or_404(user_id)
    admin_id = int(get_jwt_identity())
    if user.is_active and user.id == admin_id:
        return jsonify({"error": "You cannot deactivate your own account."}), 400
    if user.is_active and user.role == 'admin':
        other_active_admins = User.query.filter(
            User.role == 'admin',
            User.is_active.is_(True),
            User.id != user.id,
        ).count()
        if other_active_admins == 0:
            return jsonify({"error": "Cannot deactivate the last active administrator account."}), 400

    user.is_active = not user.is_active
    db.session.commit()

    action = "Activated" if user.is_active else "Deactivated"
    db.session.add(SystemLog(user_id=admin_id, action=f"{action} user account: {user.email}"))
    db.session.commit()

    return jsonify(user.to_dict())


@users_bp.route('/api/logs', methods=['GET'])
@role_required('admin', 'lgu_personnel')
def get_logs():
    query = SystemLog.query
    if current_user().role != 'admin':
        query = query.filter_by(user_id=current_user().id)
    logs = query.order_by(SystemLog.timestamp.desc()).limit(200).all()
    user_ids = {log.user_id for log in logs if log.user_id}
    users_by_id = {u.id: u for u in User.query.filter(User.id.in_(user_ids)).all()} if user_ids else {}
    return jsonify([
        {
            "id": log.id,
            "user_id": log.user_id,
            "user_name": users_by_id.get(log.user_id).name if users_by_id.get(log.user_id) else None,
            "user_role": users_by_id.get(log.user_id).role if users_by_id.get(log.user_id) else None,
            "action": log.action,
            "timestamp": to_utc_iso(log.timestamp)
        } for log in logs
    ])

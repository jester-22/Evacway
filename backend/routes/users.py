import re
import secrets

from flask import Blueprint, current_app, request, jsonify
from models import db, User, SystemLog
from werkzeug.security import generate_password_hash
from flask_jwt_extended import get_jwt_identity
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from services.mailer import send_password_setup_email
from services.password_setup import create_password_setup_token
from utils import role_required

users_bp = Blueprint('users', __name__)


@users_bp.route('/api/users', methods=['GET'])
@role_required('admin')
def list_users():
    # Admin sees all LGU personnel accounts (and other admins) so they can manage them
    users = User.query.filter(User.role.in_(['lgu_personnel', 'admin'])).all()
    return jsonify([u.to_dict() for u in users])


@users_bp.route('/api/users/check-email', methods=['GET'])
@role_required('admin')
def check_user_email():
    email = (request.args.get('email') or '').strip().lower()
    if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', email):
        return jsonify({"error": "Enter a valid email address"}), 400

    exists = User.query.filter(func.lower(User.email) == email).first() is not None
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

    new_user = User(
        name=data['name'].strip(),
        email=email,
        password_hash=generate_password_hash(secrets.token_urlsafe(48)),
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

    email_sent = False
    try:
        token = create_password_setup_token(new_user)
        send_password_setup_email(new_user, token, purpose="setup")
        email_sent = True
    except Exception:
        current_app.logger.exception("Could not send account setup email to %s", email)

    return jsonify({
        "user": new_user.to_dict(),
        "email_sent": email_sent,
        "message": (
            f"Account created. A password setup link was sent to {email}."
            if email_sent
            else "Account created, but the setup email could not be sent. Check SMTP settings and use Reset password to retry."
        ),
    }), 201


@users_bp.route('/api/users/<int:user_id>/reset-password', methods=['POST'])
@role_required('admin')
def reset_user_password(user_id):
    user = User.query.get_or_404(user_id)

    try:
        token = create_password_setup_token(user)
        send_password_setup_email(user, token, purpose="reset")
    except Exception:
        current_app.logger.exception("Could not send password reset email to %s", user.email)
        return jsonify({"error": "Password email could not be sent. Check backend SMTP settings."}), 503

    admin_id = get_jwt_identity()
    db.session.add(SystemLog(user_id=admin_id, action=f"Sent password reset email to: {user.email}"))
    db.session.commit()

    return jsonify({"message": f"Password setup link sent to {user.email}.", "email_sent": True})


@users_bp.route('/api/users/<int:user_id>/toggle-active', methods=['PATCH'])
@role_required('admin')
def toggle_user_active(user_id):
    user = User.query.get_or_404(user_id)
    user.is_active = not user.is_active
    db.session.commit()

    admin_id = get_jwt_identity()
    action = "Activated" if user.is_active else "Deactivated"
    db.session.add(SystemLog(user_id=admin_id, action=f"{action} user account: {user.email}"))
    db.session.commit()

    return jsonify(user.to_dict())


@users_bp.route('/api/logs', methods=['GET'])
@role_required('admin')
def get_logs():
    logs = SystemLog.query.order_by(SystemLog.timestamp.desc()).limit(200).all()
    return jsonify([
        {
            "id": log.id,
            "user_id": log.user_id,
            "action": log.action,
            "timestamp": log.timestamp.isoformat()
        } for log in logs
    ])

import re

from flask import Blueprint, current_app, request, jsonify
from models import db, User, SystemLog
from werkzeug.security import check_password_hash, generate_password_hash
from flask_jwt_extended import create_access_token
from sqlalchemy import func
from services.mailer import send_password_setup_email
from services.password_setup import (
    create_password_setup_token,
    read_password_setup_token,
)

auth_bp = Blueprint('auth', __name__)


@auth_bp.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json()
    email = (data.get('email') or '').strip().lower()
    password = data.get('password')

    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400

    user = User.query.filter(func.lower(User.email) == email).first()

    if not user or not check_password_hash(user.password_hash, password):
        return jsonify({"error": "Invalid email or password"}), 401

    if not user.is_active:
        return jsonify({"error": "This account has been deactivated. Contact an admin."}), 403

    # identity stored in the token: user id as string, role/name as extra claims
    access_token = create_access_token(
        identity=str(user.id),
        additional_claims={"role": user.role, "name": user.name}
    )

    return jsonify({
        "access_token": access_token,
        "user": user.to_dict()
    })


@auth_bp.route('/api/auth/password/forgot', methods=['POST'])
def request_password_reset():
    data = request.get_json(silent=True) or {}
    email = str(data.get('email') or '').strip().lower()

    if re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', email):
        user = User.query.filter(func.lower(User.email) == email).first()
        if user and user.is_active:
            try:
                token = create_password_setup_token(user)
                send_password_setup_email(user, token, purpose="reset")
            except Exception:
                current_app.logger.exception("Password reset email delivery failed")

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

    user = User.query.get(payload.get("user_id"))
    token_email = str(payload.get("email", "")).strip().lower()
    if not user or user.email.strip().lower() != token_email:
        return jsonify({"error": "This password link is no longer valid"}), 400

    user.password_hash = generate_password_hash(password)
    db.session.add(SystemLog(user_id=user.id, action="Password set or reset using email link"))
    db.session.commit()

    return jsonify({"message": "Password updated. You can now sign in."})

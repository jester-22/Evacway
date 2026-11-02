import re

from flask import Blueprint, current_app, request, jsonify
from models import db, User, ResidentAccount, SystemLog, philippines_now
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

    # Check users table FIRST (admin, lgu_personnel)
    user = User.query.filter(func.lower(User.email) == email).first()

    if user and check_password_hash(user.password_hash, password):
        if not user.is_active:
            return jsonify({"error": "Invalid email or password"}), 401

        # Update last_login_at
        user.last_login_at = philippines_now()
        db.session.commit()

        # identity stored in the token: user id as string, role/name as extra claims
        access_token = create_access_token(
            identity=str(user.id),
            additional_claims={
                "role": user.role,
                "name": user.name,
                "account_type": "user",
                "resident_id": user.resident_id
            }
        )

        return jsonify({
            "access_token": access_token,
            "user": user.to_dict()
        })

    # Check resident_accounts table (resident accounts)
    resident_account = ResidentAccount.query.filter(
        func.lower(ResidentAccount.email) == email
    ).first()

    if resident_account and check_password_hash(resident_account.password_hash, password):
        if not resident_account.is_active:
            return jsonify({"error": "Invalid email or password"}), 401

        # Update last_login_at
        resident_account.last_login_at = philippines_now()
        db.session.commit()

        # identity stored in the token: account id as string, role=resident, resident_id
        access_token = create_access_token(
            identity=str(resident_account.id),
            additional_claims={
                "role": "resident",
                "name": resident_account.resident.get_full_name() if resident_account.resident else "Resident",
                "account_type": "resident_account",
                "resident_id": resident_account.resident_id
            }
        )
        return jsonify({
            "access_token": access_token,
            "user": {
                "id": resident_account.id,
                "name": resident_account.resident.get_full_name() if resident_account.resident else "Resident",
                "email": resident_account.email,
                "resident_id": resident_account.resident_id,
                "role": "resident",
                "is_active": True,
                "last_login_at": resident_account.last_login_at.isoformat() if resident_account.last_login_at else None,
            }
        })

    # Generic error for both cases (wrong email or wrong password)
    return jsonify({"error": "Invalid email or password"}), 401


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

        account.password_hash = generate_password_hash(password)
        db.session.add(SystemLog(user_id=account.id, action="Password set or reset using email link"))
        db.session.commit()
    else:
        user = User.query.get(user_id)
        if not user or user.email.strip().lower() != token_email:
            return jsonify({"error": "This password link is no longer valid"}), 400

        user.password_hash = generate_password_hash(password)
        db.session.add(SystemLog(user_id=user.id, action="Password set or reset using email link"))
        db.session.commit()

    return jsonify({"message": "Password updated. You can now sign in."})

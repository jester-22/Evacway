from functools import wraps

from flask import current_app, jsonify

from flask_jwt_extended import (
    verify_jwt_in_request,
    get_jwt_identity,
    get_jwt,
)
from flask_jwt_extended.exceptions import JWTExtendedException
from models import User, ResidentAccount, Resident, db


# Staff roles that use the users table
STAFF_ROLES = {'admin', 'lgu_personnel'}

# Resident role uses the resident_accounts table
RESIDENT_ROLE = 'resident'


def get_optional_caller():
    """Return the active, database-backed principal for public read routes."""
    try:
        verify_jwt_in_request(optional=True)
        identity = get_jwt_identity()
        claims = get_jwt()
        if identity is None:
            return None

        account_type = claims.get('account_type', 'user')
        if account_type == 'resident_account':
            account = db.session.get(ResidentAccount, int(identity))
            if not account or not account.is_active:
                return None
            resident = db.session.get(Resident, account.resident_id)
            if not resident:
                return None
            return {
                'role': RESIDENT_ROLE,
                'resident_id': resident.id,
                'account_id': account.id,
            }

        if account_type != 'user':
            return None
        if claims.get('mfa_flow'):
            return None
        user = db.session.get(User, int(identity))
        if not user or not user.is_active or user.role not in STAFF_ROLES:
            return None
        if (
            user.role == 'admin'
            or bool(user.totp_enabled)
            or (
                user.role == 'lgu_personnel'
                and current_app.config.get('LGU_TOTP_REQUIRED', False)
            )
        ):
            if (
                claims.get('mfa_verified') is not True
                or claims.get('mfa_version') != int(user.mfa_version or 0)
            ):
                return None
        return {'role': user.role, 'user_id': user.id}
    except Exception:
        return None


def public_room_payload(room, is_my_room=False, usage=None, building=None):
    """Small room projection safe for unauthenticated and resident callers."""
    usage = room.capacity_usage() if usage is None else usage
    building = room.building if building is None else building
    building_status = (building.status or 'open').strip().lower() if building else 'open'
    if not room.is_active or building_status in {'closed', 'under_repair'}:
        status = 'Closed' if building_status == 'closed' or not room.is_active else 'Under repair'
    elif usage['is_full']:
        status = 'Full'
    else:
        status = 'Available'

    payload = {
        'id': room.id,
        'building_id': room.building_id,
        'building_name': (building.name or f'Building #{building.id}') if building else None,
        'room_number': room.room_number,
        'floor': room.floor,
        'available_slots': usage['available_slots'],
        'available_spaces': usage['available_spaces'],
        'status': status,
    }
    if is_my_room:
        payload['is_my_room'] = True
    return payload


def role_required(*allowed_roles):
    """
    Role-based access control decorator.

    Security requirements:
    - Staff routes (allowing 'admin' or 'lgu_personnel'):
      * Reject any token with account_type != 'user' BEFORE loading user
      * Load user from users table by id
      * Check user.is_active and user.role (from DATABASE) against allowed_roles
    - Resident routes (allowing 'resident'):
      * Reject any token with account_type != 'resident_account' BEFORE loading account
      * Load account from resident_accounts table by id
      * Check account.is_active
      * Role is 'resident' from database (not token claim)
    - Resident tokens must never resolve in users table, even if numeric id matches
    """
    # Determine route type from allowed_roles
    is_staff_route = any(r in STAFF_ROLES for r in allowed_roles)
    is_resident_route = RESIDENT_ROLE in allowed_roles

    if not is_staff_route and not is_resident_route:
        raise ValueError(f"role_required: no valid roles in {allowed_roles}")

    def decorator(fn):

        @wraps(fn)
        def wrapper(*args, **kwargs):

            try:
                verify_jwt_in_request()
            except JWTExtendedException as e:
                return jsonify({"error": str(e)}), 401

            identity = get_jwt_identity()
            claims = get_jwt()
            account_type = claims.get("account_type", "user")

            try:
                numeric_id = int(identity)
            except (TypeError, ValueError):
                return jsonify({"error": "You don't have permission to do this"}), 403

            if account_type == "user" and is_staff_route:
                # STAFF ROUTE: Only accept non-challenge user tokens
                if claims.get("mfa_flow"):
                    return jsonify({"error": "You don't have permission to do this"}), 403

                # Load user from users table by id (never from token claims)
                user = db.session.get(User, numeric_id)
                if not user or not user.is_active:
                    return jsonify({"error": "You don't have permission to do this"}), 403

                # Check role against DATABASE value, not token claim
                if user.role not in allowed_roles:
                    return jsonify({"error": "You don't have permission to do this"}), 403

                if (
                    user.role == "admin"
                    or bool(user.totp_enabled)
                    or (
                        user.role == "lgu_personnel"
                        and current_app.config.get("LGU_TOTP_REQUIRED", False)
                    )
                ):
                    if (
                        claims.get("mfa_verified") is not True
                        or claims.get("mfa_version") != int(user.mfa_version or 0)
                    ):
                        return jsonify({"error": "You don't have permission to do this"}), 403

            elif account_type == "resident_account" and is_resident_route:
                # Load account from resident_accounts table by id
                account = db.session.get(ResidentAccount, numeric_id)
                if not account or not account.is_active:
                    return jsonify({"error": "You don't have permission to do this"}), 403

                # Resident role is implicit from account type, not from token claim
                if RESIDENT_ROLE not in allowed_roles:
                    return jsonify({"error": "You don't have permission to do this"}), 403
            else:
                return jsonify({"error": "You don't have permission to do this"}), 403

            return fn(*args, **kwargs)

        return wrapper

    return decorator

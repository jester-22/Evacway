from functools import wraps

from flask import jsonify

from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity, get_jwt
from flask_jwt_extended.exceptions import JWTExtendedException
from models import User, ResidentAccount, db


# Staff roles that use the users table
STAFF_ROLES = {'admin', 'lgu_personnel'}

# Resident role uses the resident_accounts table
RESIDENT_ROLE = 'resident'


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

            if is_staff_route:
                # STAFF ROUTE: Only accept user tokens
                if account_type != "user":
                    return jsonify({"error": "You don't have permission to do this"}), 403

                # Load user from users table by id (never from token claims)
                user = db.session.get(User, int(identity))
                if not user or not user.is_active:
                    return jsonify({"error": "You don't have permission to do this"}), 403

                # Check role against DATABASE value, not token claim
                if user.role not in allowed_roles:
                    return jsonify({"error": "You don't have permission to do this"}), 403

            elif is_resident_route:
                # RESIDENT ROUTE: Only accept resident_account tokens
                if account_type != "resident_account":
                    return jsonify({"error": "You don't have permission to do this"}), 403

                # Load account from resident_accounts table by id
                account = db.session.get(ResidentAccount, int(identity))
                if not account or not account.is_active:
                    return jsonify({"error": "You don't have permission to do this"}), 403

                # Resident role is implicit from account type, not from token claim
                if RESIDENT_ROLE not in allowed_roles:
                    return jsonify({"error": "You don't have permission to do this"}), 403

            return fn(*args, **kwargs)

        return wrapper

    return decorator
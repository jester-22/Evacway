from functools import wraps

from flask import jsonify

from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity
from flask_jwt_extended.exceptions import JWTExtendedException
from models import User, db


def role_required(*allowed_roles):

    def decorator(fn):

        @wraps(fn)
        def wrapper(*args, **kwargs):

            try:
                verify_jwt_in_request()
            except JWTExtendedException as e:
                return jsonify({"error": str(e)}), 401

            user = db.session.get(User, get_jwt_identity())

            if not user or not user.is_active or user.role not in allowed_roles:
                return jsonify({
                    "error": "You don't have permission to do this"
                }), 403

            return fn(*args, **kwargs)

        return wrapper

    return decorator
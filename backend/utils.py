from functools import wraps

from flask import jsonify

from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity
from models import User, db


def role_required(*allowed_roles):

    def decorator(fn):

        @wraps(fn)
        def wrapper(*args, **kwargs):

            try:
                verify_jwt_in_request()

                user = db.session.get(User, get_jwt_identity())

                if not user or not user.is_active or user.role not in allowed_roles:
                    return jsonify({
                        "error": "You don't have permission to do this"
                    }), 403

                return fn(*args, **kwargs)

            except Exception as e:
                print("JWT ERROR:", str(e))

                return jsonify({
                    "error": str(e)
                }), 401

        return wrapper

    return decorator
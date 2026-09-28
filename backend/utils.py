from functools import wraps

from flask import jsonify

from flask_jwt_extended import verify_jwt_in_request, get_jwt


def role_required(*allowed_roles):

    def decorator(fn):

        @wraps(fn)
        def wrapper(*args, **kwargs):

            try:
                verify_jwt_in_request()

                claims = get_jwt()

                if claims.get("role") not in allowed_roles:
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
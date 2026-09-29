from flask import current_app
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer


PASSWORD_SETUP_SALT = "evacway-password-setup"


def _serializer():
    return URLSafeTimedSerializer(
        current_app.config["JWT_SECRET_KEY"],
        salt=PASSWORD_SETUP_SALT,
    )


def create_password_setup_token(user):
    return _serializer().dumps({"user_id": user.id, "email": user.email})


def read_password_setup_token(token):
    try:
        payload = _serializer().loads(
            token,
            max_age=current_app.config.get("PASSWORD_SETUP_TOKEN_MAX_AGE", 3600),
        )
    except SignatureExpired:
        return None, "This password link has expired. Request a new one."
    except BadSignature:
        return None, "This password link is invalid. Request a new one."

    return payload, None
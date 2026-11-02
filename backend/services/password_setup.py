from flask import current_app
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer


PASSWORD_SETUP_SALT = "evacway-password-setup"


def _serializer():
    return URLSafeTimedSerializer(
        current_app.config["JWT_SECRET_KEY"],
        salt=PASSWORD_SETUP_SALT,
    )


def create_password_setup_token(user_or_account):
    """Create a password setup token for either a User or ResidentAccount."""
    if hasattr(user_or_account, 'resident_id'):
        # ResidentAccount
        return _serializer().dumps({
            "user_id": user_or_account.id,
            "email": user_or_account.email,
            "account_type": "resident_account"
        })
    else:
        # User
        return _serializer().dumps({
            "user_id": user_or_account.id,
            "email": user_or_account.email,
            "account_type": "user"
        })


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
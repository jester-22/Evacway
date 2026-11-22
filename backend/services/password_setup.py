import hashlib
import hmac
import secrets

from flask import current_app
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from werkzeug.security import generate_password_hash
from models import ResidentAccount
from services.mailer import send_password_setup_email


PASSWORD_SETUP_SALT = "evacway-password-setup"


def _serializer():
    return URLSafeTimedSerializer(
        current_app.config["JWT_SECRET_KEY"],
        salt=PASSWORD_SETUP_SALT,
    )


def password_fingerprint(password_hash):
    """Short digest of current password hash so tokens become single-use once password changes."""
    return hashlib.sha256(str(password_hash or "").encode("utf-8")).hexdigest()[:16]


def is_token_password_current(payload, current_password_hash):
    """Verify the token's password fingerprint still matches the account's current password hash."""
    token_pfp = (payload or {}).get("pfp")
    if not token_pfp:
        return True
    return hmac.compare_digest(str(token_pfp), password_fingerprint(current_password_hash))


def create_password_setup_token(user_or_account):
    """Create a 60-minute, single-use password setup/reset token for a User or ResidentAccount."""
    payload = {
        "user_id": user_or_account.id,
        "email": user_or_account.email,
        "account_type": "resident_account" if isinstance(user_or_account, ResidentAccount) else "user",
        "pfp": password_fingerprint(getattr(user_or_account, "password_hash", "")),
        "jti": secrets.token_urlsafe(12),
    }
    return _serializer().dumps(payload)


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


def generate_unusable_password_hash():
    """Generate a random unguessable password hash until the user completes setup."""
    return generate_password_hash(secrets.token_urlsafe(48))


def send_account_setup_link(
    user_or_account,
    token_creator=create_password_setup_token,
    email_sender=send_password_setup_email,
):
    """Send a secure password-setup link for a newly created staff or resident account."""
    email = user_or_account.email
    email_sent = False
    try:
        token = token_creator(user_or_account)
        email_sender(user_or_account, token, purpose="setup")
        email_sent = True
    except Exception:
        current_app.logger.exception("Could not send account setup email to %s", email)

    message = (
        f"Account created. A password setup link was sent to {email}."
        if email_sent
        else "Account created, but the setup email could not be sent. Check SMTP settings and use Reset password to retry."
    )
    return email_sent, message

import html
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr

from flask import current_app


def send_password_setup_email(user, token, purpose="setup"):
    mailer = current_app.config.get("MAIL_MAILER", "smtp").lower()
    host = current_app.config.get("MAIL_HOST")
    port = current_app.config.get("MAIL_PORT", 587)
    username = current_app.config.get("MAIL_USERNAME")
    password = current_app.config.get("MAIL_PASSWORD")
    encryption = current_app.config.get("MAIL_ENCRYPTION", "tls").lower()
    from_address = current_app.config.get("MAIL_FROM_ADDRESS") or username
    from_name = current_app.config.get("MAIL_FROM_NAME", "EvacWay System")

    if mailer != "smtp":
        raise RuntimeError("Only SMTP mail delivery is configured.")
    if not host or not from_address or not username or not password:
        raise RuntimeError("SMTP mail settings are incomplete in the backend environment.")
    if encryption not in {"tls", "ssl"}:
        raise RuntimeError("SMTP encryption must be configured as tls or ssl.")

    frontend_url = current_app.config.get("FRONTEND_URL", "http://localhost:5173").rstrip("/")
    setup_url = f"{frontend_url}/set-password?token={token}"
    recipient_name = user.name or "there"
    subject = "Set your EvacWay password" if purpose == "setup" else "Reset your EvacWay password"

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = formataddr((from_name, from_address))
    message["To"] = user.email
    message.set_content(
        f"Hello {recipient_name},\n\n"
        f"Use this secure link to {'set' if purpose == 'setup' else 'reset'} your EvacWay password:\n"
        f"{setup_url}\n\n"
        "This link expires in one hour. If you did not request this, you can ignore this email.\n"
    )
    message.add_alternative(
        "<!doctype html><html><body style='font-family:Arial,sans-serif;color:#17324d'>"
        f"<h2 style='color:#174f88'>EvacWay account</h2><p>Hello {html.escape(recipient_name)},</p>"
        f"<p>Use this secure link to {'set' if purpose == 'setup' else 'reset'} your password.</p>"
        f"<p><a href='{html.escape(setup_url, quote=True)}' "
        "style='display:inline-block;padding:12px 18px;background:#1759a6;color:#fff;"
        "text-decoration:none;border-radius:5px'>Continue to EvacWay</a></p>"
        "<p>This link expires in one hour. If you did not request this, you can ignore this email.</p>"
        "</body></html>",
        subtype="html",
    )

    context = ssl.create_default_context()
    if encryption == "ssl":
        with smtplib.SMTP_SSL(host, port, context=context, timeout=20) as server:
            server.login(username, password)
            server.send_message(message)
        return

    with smtplib.SMTP(host, port, timeout=20) as server:
        server.ehlo()
        server.starttls(context=context)
        server.ehlo()
        server.login(username, password)
        server.send_message(message)
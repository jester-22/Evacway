import html
import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr, parseaddr

import requests
from flask import current_app
from models import ResidentAccount


# Temporary SMTP diagnostic logging; remove after confirming the runtime settings.
logging.basicConfig(level=logging.INFO)


class MailConfigurationError(RuntimeError):
    pass


def _resolve_delivery_email(user_or_account):
    recovery = str(getattr(user_or_account, "recovery_email", None) or "").strip().lower()
    if recovery:
        return recovery
    return str(getattr(user_or_account, "email", None) or "").strip().lower()


def _resolve_mail_transport():
    mailer = str(current_app.config.get("MAIL_MAILER", "smtp") or "smtp").strip().lower()
    brevo_key = str(current_app.config.get("BREVO_API_KEY") or "").strip()
    resend_key = str(current_app.config.get("RESEND_API_KEY") or "").strip()

    if mailer == "brevo" or (brevo_key and mailer in ("smtp", "auto", "")):
        return "brevo"
    if mailer == "resend" or (resend_key and mailer in ("smtp", "auto", "")):
        return "resend"
    return mailer


def _extract_email_parts(message):
    from_name, from_email = parseaddr(message.get("From", ""))
    _, to_email = parseaddr(message.get("To", ""))
    subject = str(message.get("Subject", ""))
    plain_part = message.get_body(preferencelist=("plain",))
    html_part = message.get_body(preferencelist=("html",))
    plain_text = plain_part.get_content() if plain_part is not None else ""
    html_text = html_part.get_content() if html_part is not None else ""
    return {
        "from_name": from_name or str(current_app.config.get("MAIL_FROM_NAME", "EvacWay System")),
        "from_email": from_email,
        "to_email": to_email,
        "subject": subject,
        "plain_text": plain_text,
        "html_text": html_text,
    }


def _send_via_brevo(message):
    api_key = str(current_app.config.get("BREVO_API_KEY") or "").strip()
    if not api_key:
        raise MailConfigurationError("BREVO_API_KEY is missing in the backend environment.")
    parts = _extract_email_parts(message)
    if not parts["from_email"] or not parts["to_email"]:
        raise MailConfigurationError("MAIL_FROM_ADDRESS and recipient email are required for Brevo delivery.")
    payload = {
        "sender": {"name": parts["from_name"], "email": parts["from_email"]},
        "to": [{"email": parts["to_email"]}],
        "subject": parts["subject"],
    }
    if parts["html_text"]:
        payload["htmlContent"] = parts["html_text"]
    if parts["plain_text"]:
        payload["textContent"] = parts["plain_text"]

    resp = requests.post(
        "https://api.brevo.com/v3/smtp/email",
        headers={
            "api-key": api_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        json=payload,
        timeout=20,
    )
    if resp.status_code < 200 or resp.status_code >= 300:
        raise RuntimeError(f"Brevo API error ({resp.status_code}): {resp.text[:250]}")


def _send_via_resend(message):
    api_key = str(current_app.config.get("RESEND_API_KEY") or "").strip()
    if not api_key:
        raise MailConfigurationError("RESEND_API_KEY is missing in the backend environment.")
    parts = _extract_email_parts(message)
    if not parts["from_email"] or not parts["to_email"]:
        raise MailConfigurationError("MAIL_FROM_ADDRESS and recipient email are required for Resend delivery.")
    payload = {
        "from": formataddr((parts["from_name"], parts["from_email"])),
        "to": [parts["to_email"]],
        "subject": parts["subject"],
    }
    if parts["html_text"]:
        payload["html"] = parts["html_text"]
    if parts["plain_text"]:
        payload["text"] = parts["plain_text"]

    resp = requests.post(
        "https://api.resend.com/emails",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=20,
    )
    if resp.status_code < 200 or resp.status_code >= 300:
        raise RuntimeError(f"Resend API error ({resp.status_code}): {resp.text[:250]}")


def _validate_mail_config():
    transport = _resolve_mail_transport()
    username = current_app.config.get("MAIL_USERNAME")
    from_address = current_app.config.get("MAIL_FROM_ADDRESS") or username
    from_name = current_app.config.get("MAIL_FROM_NAME", "EvacWay System")

    if transport == "brevo":
        if not current_app.config.get("BREVO_API_KEY") or not from_address:
            raise MailConfigurationError("BREVO_API_KEY and MAIL_FROM_ADDRESS are required.")
        return from_address, from_name

    if transport == "resend":
        if not current_app.config.get("RESEND_API_KEY") or not from_address:
            raise MailConfigurationError("RESEND_API_KEY and MAIL_FROM_ADDRESS are required.")
        return from_address, from_name

    host = current_app.config.get("MAIL_HOST")
    password = current_app.config.get("MAIL_PASSWORD")
    encryption = current_app.config.get("MAIL_ENCRYPTION", "tls").lower()

    if transport != "smtp":
        raise MailConfigurationError("Only SMTP, Brevo, or Resend mail delivery is configured.")
    if not host or not from_address or not username or not password:
        raise MailConfigurationError("SMTP mail settings are incomplete in the backend environment.")
    if encryption not in {"tls", "ssl"}:
        raise MailConfigurationError("SMTP encryption must be configured as tls or ssl.")
    return from_address, from_name


def _send_smtp_message(message):
    transport = _resolve_mail_transport()
    if transport == "brevo":
        _send_via_brevo(message)
        return
    if transport == "resend":
        _send_via_resend(message)
        return

    host = current_app.config.get("MAIL_HOST")
    port = current_app.config.get("MAIL_PORT", 587)
    username = current_app.config.get("MAIL_USERNAME")
    password = current_app.config.get("MAIL_PASSWORD")
    encryption = current_app.config.get("MAIL_ENCRYPTION", "tls").lower()

    if transport != "smtp":
        raise MailConfigurationError("Only SMTP, Brevo, or Resend mail delivery is configured.")
    if not host or not username or not password:
        raise MailConfigurationError("SMTP mail settings are incomplete in the backend environment.")
    if encryption not in {"tls", "ssl"}:
        raise MailConfigurationError("SMTP encryption must be configured as tls or ssl.")

    context = ssl.create_default_context()
    logging.info("MAIL: host=%r port=%r user=%r encryption=%r pw_len=%s", host, port, username, encryption, len(password or ""))
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


def send_password_setup_email(user_or_account, token, purpose="setup"):
    from_address, from_name = _validate_mail_config()

    public_url = (current_app.config.get("FRONTEND_URL_PUBLIC") or "").strip().rstrip("/")
    frontend_url = (current_app.config.get("FRONTEND_URL") or "").strip().rstrip("/")
    unique_urls = []
    for url in (public_url, frontend_url):
        if url and url not in unique_urls:
            unique_urls.append(url)
    setup_urls = [f"{url}/set-password?token={token}" for url in unique_urls]
    if not setup_urls:
        raise MailConfigurationError("Configure FRONTEND_URL_PUBLIC or FRONTEND_URL for password emails.")
    fallback_note = (
        "Only if the public server is unavailable, try this local link. "
        "It only works on the computer that runs EvacWay."
    )
    plain_links = setup_urls[0]
    if len(setup_urls) > 1:
        plain_links += f"\n\n{fallback_note}\n{setup_urls[1]}"
    html_links = (
        f"<p><a href='{html.escape(setup_urls[0], quote=True)}' "
        "style='display:inline-block;padding:12px 18px;background:#1759a6;color:#fff;"
        "text-decoration:none;border-radius:5px'>Continue to EvacWay</a></p>"
    )
    if len(setup_urls) > 1:
        html_links += (
            f"<p>{fallback_note}</p>"
            f"<p><a href='{html.escape(setup_urls[1], quote=True)}'>{html.escape(setup_urls[1])}</a></p>"
        )

    # Handle both User and ResidentAccount
    if isinstance(user_or_account, ResidentAccount):
        # ResidentAccount - get name from resident
        recipient_name = user_or_account.resident.get_full_name() if user_or_account.resident else "there"
    else:
        # User
        recipient_name = user_or_account.name or "there"

    subject = "Set your EvacWay password" if purpose == "setup" else "Reset your EvacWay password"

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = formataddr((from_name, from_address))
    message["To"] = _resolve_delivery_email(user_or_account)
    message.set_content(
        f"Hello {recipient_name},\n\n"
        f"Use this secure link to {'set' if purpose == 'setup' else 'reset'} your EvacWay password:\n"
        f"{plain_links}\n\n"
        "This link expires in one hour. If you did not request this, you can ignore this email.\n"
    )
    message.add_alternative(
        "<!doctype html><html><body style='font-family:Arial,sans-serif;color:#17324d'>"
        f"<h2 style='color:#174f88'>EvacWay account</h2><p>Hello {html.escape(recipient_name)},</p>"
        f"<p>Use this secure link to {'set' if purpose == 'setup' else 'reset'} your password.</p>"
        f"{html_links}"
        "<p>This link expires in one hour. If you did not request this, you can ignore this email.</p>"
        "</body></html>",
        subtype="html",
    )

    _send_smtp_message(message)


def send_staff_mfa_email_code(user, code, expires_minutes=10):
    from_address, from_name = _validate_mail_config()

    recipient_name = (getattr(user, "name", None) or "there").strip() or "there"
    safe_code = str(code).strip()

    message = EmailMessage()
    message["Subject"] = "Your EvacWay sign-in verification code"
    message["From"] = formataddr((from_name, from_address))
    message["To"] = _resolve_delivery_email(user)
    message.set_content(
        f"Hello {recipient_name},\n\n"
        f"Your EvacWay two-factor sign-in code is: {safe_code}\n\n"
        f"This code expires in {expires_minutes} minutes and can only be used once.\n"
        "If you did not try to sign in, please ignore this email and change your password.\n"
    )
    message.add_alternative(
        "<!doctype html><html><body style='margin:0;padding:24px;font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#17324d'>"
        "<div style='max-width:480px;margin:0 auto'>"
        "<h2 style='margin:0 0 12px;color:#174f88'>EvacWay sign-in verification</h2>"
        f"<p style='margin:0 0 16px'>Hello {html.escape(recipient_name)},</p>"
        "<p style='margin:0 0 16px'>Enter this 6-digit verification code to complete your sign in:</p>"
        "<div style='margin:0 0 20px;padding:16px 20px;background:#f4f7fb;border:1px solid #dbe5f0;border-radius:8px;text-align:center'>"
        f"<span style='font-size:28px;font-weight:700;letter-spacing:6px;color:#0f172a;font-family:monospace'>{html.escape(safe_code)}</span>"
        "</div>"
        f"<p style='margin:0 0 8px;color:#475569;font-size:13px'>This code expires in {int(expires_minutes)} minutes and can only be used once.</p>"
        "<p style='margin:0;color:#64748b;font-size:12px'>If you did not attempt to sign in, you can ignore this email and consider updating your password.</p>"
        "</div></body></html>",
        subtype="html",
    )

    _send_smtp_message(message)


def send_resident_registration_email(registration):
    username = current_app.config.get("MAIL_USERNAME")
    from_address = current_app.config.get("MAIL_FROM_ADDRESS") or username
    from_name = current_app.config.get("MAIL_FROM_NAME", "EvacWay System")
    if not from_address:
        raise RuntimeError("SMTP sender address is not configured.")

    recipient_name = " ".join(
        part
        for part in (
            registration.first_name,
            registration.middle_name,
            registration.last_name,
        )
        if part
    )
    message = EmailMessage()
    message["From"] = formataddr((from_name, from_address))
    message["To"] = registration.email

    if registration.status == "approved":
        public_url = (
            current_app.config.get("APP_URL_PUBLIC")
            or current_app.config.get("FRONTEND_URL_PUBLIC")
            or current_app.config.get("FRONTEND_URL")
            or ""
        ).strip().rstrip("/")
        local_url = (current_app.config.get("APP_URL_LOCAL") or "").strip().rstrip("/")
        if local_url == public_url:
            local_url = ""
        public_map_url = f"{public_url}/map" if public_url else ""
        local_map_url = f"{local_url}/map" if local_url else ""
        forgot_password_url = f"{public_url}/forgot-password" if public_url else (f"{local_url}/forgot-password" if local_url else "")
        logo_url = f"{public_url}/evacway-logo-text.png" if public_url.startswith("https://") else ""
        message["Subject"] = "Your EvacWay account has been approved"
        plain_lines = [
            f"Hello {recipient_name},",
            "",
            "Your EvacWay account has been approved. You can now log in using your email and the password you chose during registration.",
            "",
            "Username: " + registration.email,
            "Password: The password you chose during registration.",
        ]
        if forgot_password_url:
            plain_lines.extend(["", "Forgot your password?", forgot_password_url])
        if public_map_url or local_map_url:
            plain_lines.extend(["", "Open EvacWay:"])
            if public_map_url:
                plain_lines.append(public_map_url)
            if local_map_url:
                plain_lines.extend(["If that does not open, try this link:", local_map_url, "The second link only works on the computer that runs EvacWay."])
        message.set_content("\n".join(plain_lines) + "\n")

        html_parts = [
            "<!doctype html><html><body style='margin:0;padding:24px;font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#17324d'>",
            "<div style='max-width:560px;margin:0 auto'>",
        ]
        if logo_url:
            html_parts.append(f"<p style='margin:0 0 20px'><img src='{html.escape(logo_url, quote=True)}' alt='EvacWay' style='display:block;width:auto;height:40px;border:0'></p>")
        html_parts.extend([
            "<h2 style='margin:0 0 16px;color:#174f88;font-size:22px;line-height:1.25'>Your EvacWay account is approved</h2>",
            f"<p style='margin:0 0 16px'>Hello {html.escape(recipient_name)},</p>",
            "<p style='margin:0 0 16px'>You can now log in using your email and the password you chose during registration.</p>",
            "<div style='margin:0 0 20px;padding:16px;background:#f4f7fb;border:1px solid #dbe5f0;border-radius:8px'>",
            f"<p style='margin:0 0 8px'><strong>Username:</strong> {html.escape(registration.email)}</p>",
            "<p style='margin:0'><strong>Password:</strong> The password you chose during registration.</p>",
            "</div>",
        ])
        if forgot_password_url:
            html_parts.append(
                f"<p style='margin:0 0 20px'><a href='{html.escape(forgot_password_url, quote=True)}' style='color:#2563eb'>Forgot your password?</a></p>"
            )
        if public_map_url:
            html_parts.append(
                f"<p style='margin:0 0 10px'><a href='{html.escape(public_map_url, quote=True)}' style='display:inline-block;height:40px;line-height:40px;padding:0 16px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px'>Open EvacWay</a></p>"
            )
        if local_map_url:
            html_parts.extend([
                f"<p style='margin:0 0 4px'><a href='{html.escape(local_map_url, quote=True)}' style='display:inline-block;height:40px;line-height:40px;padding:0 16px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px'>If that does not open, try this link</a></p>",
                "<p style='margin:0;color:#5b6b82'>The second link only works on the computer that runs EvacWay.</p>",
            ])
        html_parts.extend(["</div></body></html>"])
        message.add_alternative("".join(html_parts), subtype="html")
        return _send_smtp_message(message)

    if registration.status != "rejected":
        raise ValueError("A decision email can only be sent for approved or rejected registrations.")

    reason = registration.rejection_reason or "No reason was provided."
    message["Subject"] = "Your EvacWay registration was not approved"
    message.set_content(
        f"Hello {recipient_name},\n\n"
        "We could not approve your EvacWay registration for the following reason:\n\n"
        f"{reason}\n"
    )
    message.add_alternative(
        "<!doctype html><html><body style='font-family:Arial,sans-serif;color:#17324d'>"
        f"<h2 style='color:#174f88'>EvacWay registration update</h2><p>Hello {html.escape(recipient_name)},</p>"
        "<p>We could not approve your registration for the following reason:</p>"
        f"<p>{html.escape(reason)}</p>"
        "</body></html>",
        subtype="html",
    )
    return _send_smtp_message(message)

import unittest
from unittest.mock import patch

from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token
from werkzeug.security import generate_password_hash

from models import AdminMfaRecoveryRequest, ResidentAccount, SystemLog, User, db
import routes.auth as auth_routes
from routes.auth import auth_bp, generate_totp_code, _login_rate_buckets


class AdminTotpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = Flask(__name__)
        cls.app.config.update(
            TESTING=True,
            SQLALCHEMY_DATABASE_URI="sqlite://",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            JWT_SECRET_KEY="admin-totp-test-secret-long-enough-for-fernet",
            JWT_ACCESS_TOKEN_EXPIRES=3600,
            LOGIN_MAX_FAILED_ATTEMPTS=5,
            LOGIN_FAILURE_WINDOW_MINUTES=15,
            LOGIN_LOCK_MINUTES=15,
            LOGIN_RATE_LIMIT_MAX_REQUESTS=20,
            LOGIN_RATE_LIMIT_WINDOW_SECONDS=900,
            LGU_TOTP_REQUIRED=False,
        )
        db.init_app(cls.app)
        JWTManager(cls.app)
        cls.app.register_blueprint(auth_bp)
        cls.context = cls.app.app_context()
        cls.context.push()
        db.metadata.create_all(bind=db.engine, tables=[
            User.__table__, ResidentAccount.__table__, SystemLog.__table__,
            AdminMfaRecoveryRequest.__table__,
        ])
        cls.client = cls.app.test_client()

    @classmethod
    def tearDownClass(cls):
        db.session.remove()
        db.drop_all()
        cls.context.pop()

    def setUp(self):
        db.session.remove()
        db.session.query(AdminMfaRecoveryRequest).delete()
        db.session.query(SystemLog).delete()
        db.session.query(User).delete()
        db.session.commit()
        _login_rate_buckets.clear()
        self.admin = User(
            name="Test Admin",
            email="admin@example.test",
            password_hash=generate_password_hash("Admin-password-123!"),
            role="admin",
            is_active=True,
        )
        db.session.add(self.admin)
        db.session.commit()

    def _login(self):
        return self.client.post("/api/auth/login", json={
            "email": self.admin.email,
            "password": "Admin-password-123!",
        })

    def _enroll(self):
        setup = self._login()
        self.assertEqual(setup.status_code, 200)
        self.assertTrue(setup.json["totp_enrollment_required"])
        secret = setup.json["totp_secret"]
        code = generate_totp_code(secret, timestamp=6000)
        with patch.object(auth_routes, "_totp_timestamp", return_value=6000):
            confirmed = self.client.post("/api/auth/staff/totp/enroll/confirm", json={
                "setup_token": setup.json["setup_token"], "code": code,
            })
        self.assertEqual(confirmed.status_code, 200)
        return secret, confirmed.json

    def test_enrollment_returns_qr_uri_once_only_backup_codes_and_stores_hashes(self):
        setup = self._login()
        self.assertIn("otpauth://totp/", setup.json["otpauth_uri"])
        self.assertTrue(setup.json["totp_secret"])
        code = generate_totp_code(setup.json["totp_secret"], timestamp=6000)
        with patch.object(auth_routes, "_totp_timestamp", return_value=6000):
            confirmed = self.client.post("/api/auth/staff/totp/enroll/confirm", json={
                "setup_token": setup.json["setup_token"], "code": code,
            })
        self.assertEqual(confirmed.status_code, 200)
        self.assertEqual(len(confirmed.json["backup_codes"]), 10)
        self.assertTrue(db.session.get(User, self.admin.id).totp_enabled)
        for raw_code in confirmed.json["backup_codes"]:
            self.assertNotIn(raw_code, str(db.session.get(User, self.admin.id).totp_backup_codes_hashes))
        self.assertTrue(confirmed.json["access_token"])

    def test_correct_authenticator_code_completes_login(self):
        secret, _ = self._enroll()
        challenge = self._login()
        self.assertTrue(challenge.json["totp_required"])
        code = generate_totp_code(secret, timestamp=6030)
        with patch.object(auth_routes, "_totp_timestamp", return_value=6030):
            result = self.client.post("/api/auth/staff/totp/verify", json={
                "challenge_token": challenge.json["challenge_token"], "code": code,
            })
        self.assertEqual(result.status_code, 200)
        self.assertTrue(result.json["access_token"])

    def test_wrong_authenticator_code_has_generic_failure(self):
        self._enroll()
        challenge = self._login()
        with patch.object(auth_routes, "_totp_timestamp", return_value=6060):
            result = self.client.post("/api/auth/staff/totp/verify", json={
                "challenge_token": challenge.json["challenge_token"], "code": "000000",
            })
        self.assertEqual(result.status_code, 401)
        self.assertEqual(result.json, {"error": "Invalid or expired verification code. Please try again."})

    def test_backup_code_is_single_use(self):
        _, enrollment = self._enroll()
        raw_code = enrollment["backup_codes"][0]
        challenge = self._login()
        used = self.client.post("/api/auth/staff/totp/verify", json={
            "challenge_token": challenge.json["challenge_token"], "code": raw_code,
        })
        self.assertEqual(used.status_code, 200)
        next_challenge = self._login()
        reused = self.client.post("/api/auth/staff/totp/verify", json={
            "challenge_token": next_challenge.json["challenge_token"], "code": raw_code,
        })
        self.assertEqual(reused.status_code, 401)
        self.assertEqual(reused.json, {"error": "Invalid or expired verification code. Please try again."})

    def test_five_failed_codes_lock_account_and_log_event(self):
        self._enroll()
        challenge = self._login().json["challenge_token"]
        for _ in range(5):
            response = self.client.post("/api/auth/staff/totp/verify", json={
                "challenge_token": challenge, "code": "bad-code",
            })
            self.assertEqual(response.status_code, 401)
            self.assertEqual(response.json, {"error": "Invalid or expired verification code. Please try again."})
        locked = db.session.get(User, self.admin.id)
        self.assertIsNotNone(locked.login_locked_until)
        self.assertTrue(SystemLog.query.filter(SystemLog.action.like("Login locked after repeated failures%")).first())

    def test_challenge_token_cannot_access_admin_endpoint(self):
        challenge = self._login().json["setup_token"]
        response = self.client.get("/api/admin/mfa-recovery-requests", headers={
            "Authorization": f"Bearer {challenge}",
        })
        self.assertEqual(response.status_code, 403)

    def test_recovery_requires_and_uses_a_different_admin_approval(self):
        self._enroll()
        challenge = self._login().json["challenge_token"]
        requested = self.client.post("/api/auth/staff/totp/recovery", json={
            "challenge_token": challenge,
        })
        self.assertEqual(requested.status_code, 202)
        recovery = AdminMfaRecoveryRequest.query.one()

        self_token = create_access_token(identity=str(self.admin.id), additional_claims={
            "account_type": "user", "role": "admin", "mfa_verified": True, "mfa_version": self.admin.mfa_version,
        })
        self_approval = self.client.post(
            f"/api/admin/mfa-recovery-requests/{recovery.id}/approve",
            headers={"Authorization": f"Bearer {self_token}"},
        )
        self.assertEqual(self_approval.status_code, 404)

        other_admin = User(
            name="Second Admin",
            email="second-admin@example.test",
            password_hash=generate_password_hash("Admin-password-123!"),
            role="admin",
            is_active=True,
        )
        db.session.add(other_admin)
        db.session.commit()
        other_token = create_access_token(identity=str(other_admin.id), additional_claims={
            "account_type": "user", "role": "admin", "mfa_verified": True, "mfa_version": 0,
        })
        approved = self.client.post(
            f"/api/admin/mfa-recovery-requests/{recovery.id}/approve",
            headers={"Authorization": f"Bearer {other_token}"},
        )
        self.assertEqual(approved.status_code, 200)
        db.session.refresh(self.admin)
        self.assertFalse(self.admin.totp_enabled)
        self.assertEqual(self.admin.mfa_version, 2)

    def test_lgu_totp_is_optional_unless_configured(self):
        lgu = User(
            name="Test LGU", email="lgu@example.test",
            password_hash=generate_password_hash("LGU-password-123!"),
            role="lgu_personnel", is_active=True,
        )
        db.session.add(lgu)
        db.session.commit()
        plain = self.client.post("/api/auth/login", json={
            "email": lgu.email, "password": "LGU-password-123!",
        })
        self.assertIn("access_token", plain.json)
        self.app.config["LGU_TOTP_REQUIRED"] = True
        required = self.client.post("/api/auth/login", json={
            "email": lgu.email, "password": "LGU-password-123!",
        })
        self.assertTrue(required.json["totp_enrollment_required"])
        self.app.config["LGU_TOTP_REQUIRED"] = False

    def test_second_factor_shares_staff_login_rate_limit(self):
        self._enroll()
        _login_rate_buckets.clear()
        previous_limit = self.app.config["LOGIN_RATE_LIMIT_MAX_REQUESTS"]
        self.app.config["LOGIN_RATE_LIMIT_MAX_REQUESTS"] = 1
        try:
            challenge = self._login().json["challenge_token"]
            limited = self.client.post("/api/auth/staff/totp/verify", json={
                "challenge_token": challenge, "code": "000000",
            })
            self.assertEqual(limited.status_code, 429)
            self.assertIn("Too many attempts", limited.json["error"])
        finally:
            self.app.config["LOGIN_RATE_LIMIT_MAX_REQUESTS"] = previous_limit

    def test_email_otp_second_factor_works_and_prevents_replay(self):
        from unittest.mock import patch
        from routes.auth import _consumed_email_otp_jtis, _email_otp_send_times

        _email_otp_send_times.clear()
        _consumed_email_otp_jtis.clear()
        self._enroll()
        _login_rate_buckets.clear()

        login_resp = self._login()
        self.assertTrue(login_resp.json["totp_required"])
        self.assertIn("email_otp", login_resp.json.get("available_methods", []))
        self.assertTrue(login_resp.json.get("masked_email"))
        challenge = login_resp.json["challenge_token"]

        sent_codes = []
        with patch(
            "routes.auth.send_staff_mfa_email_code",
            side_effect=lambda user, code, expires_minutes=10: sent_codes.append(code),
        ):
            send_resp = self.client.post(
                "/api/auth/staff/mfa/email/send",
                json={"challenge_token": challenge},
            )
            self.assertEqual(send_resp.status_code, 200, send_resp.json)
            self.assertEqual(len(sent_codes), 1)
            self.assertRegex(sent_codes[0], r"^\d{6}$")
            email_otp_token = send_resp.json["email_otp_token"]

            # Immediate resend is rate-limited by cooldown
            cooldown_resp = self.client.post(
                "/api/auth/staff/mfa/email/send",
                json={"challenge_token": challenge},
            )
            self.assertEqual(cooldown_resp.status_code, 429)

        # Wrong 6-digit code is rejected
        wrong_code = "000000" if sent_codes[0] != "000000" else "111111"
        bad_verify = self.client.post(
            "/api/auth/staff/mfa/email/verify",
            json={"email_otp_token": email_otp_token, "code": wrong_code},
        )
        self.assertEqual(bad_verify.status_code, 401)

        # Correct 6-digit code signs in with mfa_verified=True
        ok_verify = self.client.post(
            "/api/auth/staff/mfa/email/verify",
            json={"email_otp_token": email_otp_token, "code": sent_codes[0]},
        )
        self.assertEqual(ok_verify.status_code, 200, ok_verify.json)
        access_token = ok_verify.json["access_token"]
        self.assertTrue(access_token)

        # Admin-protected route accepts the email-OTP-verified token
        admin_check = self.client.get(
            "/api/admin/mfa-recovery-requests",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        self.assertEqual(admin_check.status_code, 200)

        # Replaying the same email OTP token is rejected
        replay = self.client.post(
            "/api/auth/staff/mfa/email/verify",
            json={"email_otp_token": email_otp_token, "code": sent_codes[0]},
        )
        self.assertEqual(replay.status_code, 401)

    def test_local_placeholder_email_uses_recovery_email_for_email_otp(self):
        from unittest.mock import patch
        from routes.auth import _consumed_email_otp_jtis, _email_otp_send_times

        _email_otp_send_times.clear()
        _consumed_email_otp_jtis.clear()
        _login_rate_buckets.clear()

        local_admin = User(
            name="Local Admin",
            email="admin@evacway.local",
            recovery_email=None,
            password_hash=generate_password_hash("Admin-password-123!"),
            role="admin",
            is_active=True,
        )
        db.session.add(local_admin)
        db.session.commit()

        # Without recovery_email, email OTP is unavailable and send returns 400
        resp_no_rec = self.client.post("/api/auth/login", json={
            "email": "admin@evacway.local",
            "password": "Admin-password-123!",
        })
        self.assertEqual(resp_no_rec.status_code, 200)
        self.assertFalse(resp_no_rec.json["email_otp_available"])
        send_blocked = self.client.post(
            "/api/auth/staff/mfa/email/send",
            json={"challenge_token": resp_no_rec.json["setup_token"]},
        )
        self.assertEqual(send_blocked.status_code, 400)

        # With recovery_email set to evacway599@gmail.com, email OTP works and masks recovery email
        local_admin.recovery_email = "evacway599@gmail.com"
        db.session.commit()
        _login_rate_buckets.clear()

        resp_with_rec = self.client.post("/api/auth/login", json={
            "email": "admin@evacway.local",
            "password": "Admin-password-123!",
        })
        self.assertEqual(resp_with_rec.status_code, 200)
        self.assertTrue(resp_with_rec.json["email_otp_available"])
        self.assertEqual(resp_with_rec.json["masked_email"], "e***9@gmail.com")

        sent_codes = []
        with patch(
            "routes.auth.send_staff_mfa_email_code",
            side_effect=lambda user, code, expires_minutes=10: sent_codes.append((user.recovery_email, code)),
        ):
            send_ok = self.client.post(
                "/api/auth/staff/mfa/email/send",
                json={"challenge_token": resp_with_rec.json["setup_token"]},
            )
            self.assertEqual(send_ok.status_code, 200, send_ok.json)
            self.assertEqual(send_ok.json["masked_email"], "e***9@gmail.com")
            self.assertEqual(sent_codes[0][0], "evacway599@gmail.com")

            verify_ok = self.client.post(
                "/api/auth/staff/mfa/email/verify",
                json={"email_otp_token": send_ok.json["email_otp_token"], "code": sent_codes[0][1]},
            )
            self.assertEqual(verify_ok.status_code, 200, verify_ok.json)
            self.assertTrue(verify_ok.json.get("access_token"))


if __name__ == "__main__":
    unittest.main()

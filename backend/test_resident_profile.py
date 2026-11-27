import datetime
import unittest
from unittest.mock import patch

from flask import Flask
from flask_jwt_extended import JWTManager
from sqlalchemy import event, text
from werkzeug.security import check_password_hash, generate_password_hash

from models import (
    Barangay,
    EvacuationAssignment,
    EvacuationCenter,
    EvacuationCenterRoom,
    Family,
    Resident,
    ResidentAccount,
    ResidentLookupLog,
    SystemLog,
    User,
    db,
)
from routes.auth import auth_bp, _login_rate_buckets
from routes.residents import residents_bp


class ResidentProfileTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = Flask(__name__)
        cls.app.config.update(
            TESTING=True,
            SQLALCHEMY_DATABASE_URI="sqlite://",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            JWT_SECRET_KEY="resident-profile-test-secret-long-enough",
            JWT_ACCESS_TOKEN_EXPIRES=3600,
            LOGIN_MAX_FAILED_ATTEMPTS=5,
            LOGIN_FAILURE_WINDOW_MINUTES=15,
            LOGIN_LOCK_MINUTES=15,
            LOGIN_RATE_LIMIT_MAX_REQUESTS=50,
            LOGIN_RATE_LIMIT_WINDOW_SECONDS=900,
        )
        db.init_app(cls.app)
        JWTManager(cls.app)
        cls.app.register_blueprint(auth_bp)
        cls.app.register_blueprint(residents_bp)
        cls.context = cls.app.app_context()
        cls.context.push()

        @event.listens_for(db.engine, "connect")
        def _register_spatialite_shims(dbapi_connection, _record):
            dbapi_connection.create_function("AsEWKB", 1, lambda x: x)
            dbapi_connection.create_function("GeomFromEWKT", 1, lambda x: x)
            dbapi_connection.create_function("ST_AsEWKB", 1, lambda x: x)
            dbapi_connection.create_function("ST_GeomFromEWKT", 1, lambda x: x)

        with db.engine.begin() as conn:
            conn.execute(text("CREATE TABLE roster_years (id INTEGER PRIMARY KEY, year INTEGER)"))
            conn.execute(text(
                "CREATE TABLE barangays (id INTEGER PRIMARY KEY, name VARCHAR(100), population INTEGER DEFAULT 0, geom BLOB)"
            ))
            conn.execute(text(
                "CREATE TABLE evacuation_centers (id INTEGER PRIMARY KEY, name VARCHAR(150), center_type VARCHAR(50), owner_name VARCHAR(150))"
            ))
            conn.execute(text(
                "CREATE TABLE evacuation_center_rooms (id INTEGER PRIMARY KEY, evacuation_center_id INTEGER, building_id INTEGER, room_number VARCHAR(50), latitude FLOAT, longitude FLOAT)"
            ))
        db.metadata.create_all(
            bind=db.engine,
            tables=[
                User.__table__,
                Family.__table__,
                Resident.__table__,
                ResidentAccount.__table__,
                EvacuationAssignment.__table__,
                ResidentLookupLog.__table__,
                SystemLog.__table__,
            ],
        )
        cls.client = cls.app.test_client()

    @classmethod
    def tearDownClass(cls):
        db.session.remove()
        cls.context.pop()

    def setUp(self):
        db.session.remove()
        _login_rate_buckets.clear()
        with db.engine.begin() as conn:
            for table in (
                "system_logs",
                "evacuation_assignments",
                "resident_accounts",
                "residents",
                "families",
                "users",
                "evacuation_center_rooms",
                "evacuation_centers",
                "barangays",
            ):
                conn.execute(text(f"DELETE FROM {table}"))
            conn.execute(text("DELETE FROM roster_years"))
            conn.execute(text("INSERT INTO roster_years (id, year) VALUES (1, 2026)"))
            conn.execute(text("INSERT INTO barangays (id, name) VALUES (1, 'Zone I')"))
            conn.execute(text("INSERT INTO evacuation_centers (id, name, center_type) VALUES (10, 'PNHS', 'open_area')"))

        self.family = Family(
            roster_year_id=1,
            barangay_id=1,
            family_code="FM-0001",
            head_name="Juan Dela Cruz",
            member_count=3,
            address="Purok 2",
            contact_number="09171112222",
            searchable=True,
        )
        db.session.add(self.family)
        db.session.flush()

        self.resident = Resident(
            family_id=self.family.id,
            first_name="Juan",
            middle_name="Santos",
            last_name="Dela Cruz",
            date_of_birth=datetime.date(1992, 5, 14),
            contact_number="09171112222",
            relationship_to_head="Household Head",
            is_head_of_family=True,
        )
        db.session.add(self.resident)
        db.session.flush()

        db.session.add(EvacuationAssignment(
            resident_id=self.resident.id,
            evacuation_center_id=10,
        ))

        self.account = ResidentAccount(
            resident_id=self.resident.id,
            email="juan.old@gmail.com",
            password_hash=generate_password_hash("ResidentPass-123!"),
            is_active=True,
        )
        db.session.add(self.account)
        db.session.commit()

    def _login_resident(self, email="juan.old@gmail.com", password="ResidentPass-123!"):
        resp = self.client.post("/api/auth/resident-login", json={
            "email": email,
            "password": password,
        })
        self.assertEqual(resp.status_code, 200, resp.json)
        return resp.json["access_token"]

    def test_get_profile_returns_account_and_read_only_resident_guide(self):
        token = self._login_resident()
        resp = self.client.get(
            "/api/residents/me/profile",
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(resp.status_code, 200, resp.json)
        data = resp.json
        self.assertEqual(data["account"]["email"], "juan.old@gmail.com")
        self.assertEqual(data["account"]["name"], "Juan Santos Dela Cruz")
        self.assertEqual(data["resident_record"]["full_name"], "Juan Santos Dela Cruz")
        self.assertEqual(data["resident_record"]["barangay"], "Zone I")
        self.assertEqual(data["resident_record"]["address"], "Purok 2")
        self.assertEqual(data["resident_record"]["contact_number"], "09171112222")
        self.assertEqual(data["resident_record"]["family_code"], "FM-0001")
        self.assertEqual(data["resident_record"]["evacuation_center_name"], "PNHS")
        self.assertTrue(data["privacy"]["searchable"])

    def test_update_profile_edits_only_resident_account_never_resident_roster(self):
        token = self._login_resident()
        resp = self.client.patch(
            "/api/residents/me/profile",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "display_name": "Johnny Cruz",
                "email": "juan.new@gmail.com",
                "contact_number": "09998887777",
                # Extra roster fields must be ignored completely
                "barangay": "Tampered Barangay",
                "address": "Tampered Address",
                "first_name": "Tampered",
            },
        )
        self.assertEqual(resp.status_code, 200, resp.json)

        db.session.expire_all()
        account = db.session.get(ResidentAccount, self.account.id)
        resident = db.session.get(Resident, self.resident.id)

        # ResidentAccount updated
        self.assertEqual(account.display_name, "Johnny Cruz")
        self.assertEqual(account.email, "juan.new@gmail.com")
        self.assertEqual(account.contact_number, "09998887777")

        # Official Resident roster data UNTOUCHED!
        self.assertEqual(resident.first_name, "Juan")
        self.assertEqual(resident.last_name, "Dela Cruz")
        self.assertEqual(resident.barangay, "Zone I")
        self.assertEqual(resident.address, "Purok 2")
        self.assertEqual(resident.contact_number, "09171112222")

        # Subsequent login uses the updated account email and reflects display_name
        login_new = self.client.post("/api/auth/resident-login", json={
            "email": "juan.new@gmail.com",
            "password": "ResidentPass-123!",
        })
        self.assertEqual(login_new.status_code, 200)
        self.assertEqual(login_new.json["user"]["name"], "Johnny Cruz")
        self.assertEqual(login_new.json["user"]["contact_number"], "09998887777")

    def test_duplicate_email_rejected_and_password_change_works(self):
        other_user = User(
            name="Staff",
            email="staff@gmail.com",
            password_hash=generate_password_hash("StaffPass-123!"),
            role="lgu_personnel",
            is_active=True,
        )
        db.session.add(other_user)
        db.session.commit()

        token = self._login_resident()
        dup = self.client.patch(
            "/api/residents/me/profile",
            headers={"Authorization": f"Bearer {token}"},
            json={"email": "staff@gmail.com"},
        )
        self.assertEqual(dup.status_code, 409)

        # Wrong current password rejected
        bad_pw = self.client.post(
            "/api/residents/me/password",
            headers={"Authorization": f"Bearer {token}"},
            json={"current_password": "WrongPassword!1", "new_password": "NewPassword-123!"},
        )
        self.assertEqual(bad_pw.status_code, 403)

        # Valid password change succeeds
        ok_pw = self.client.post(
            "/api/residents/me/password",
            headers={"Authorization": f"Bearer {token}"},
            json={"current_password": "ResidentPass-123!", "new_password": "NewPassword-123!"},
        )
        self.assertEqual(ok_pw.status_code, 200, ok_pw.json)
        db.session.expire_all()
        self.assertTrue(check_password_hash(db.session.get(ResidentAccount, self.account.id).password_hash, "NewPassword-123!"))

        # Reset email works
        sent = []
        with patch("routes.residents.send_password_setup_email", side_effect=lambda acc, tok, purpose="reset": sent.append((acc.email, purpose))):
            reset_resp = self.client.post(
                "/api/residents/me/reset-password",
                headers={"Authorization": f"Bearer {token}"},
            )
            self.assertEqual(reset_resp.status_code, 200, reset_resp.json)
            self.assertEqual(sent, [("juan.old@gmail.com", "reset")])


if __name__ == "__main__":
    unittest.main()

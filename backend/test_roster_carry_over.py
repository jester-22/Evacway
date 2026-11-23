import unittest
from datetime import date, datetime, timezone
from unittest.mock import patch

from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token
from sqlalchemy import text

from barangays import barangays_bp
from models import (
    Barangay,
    CenterBarangay,
    CenterType,
    EvacuationAssignment,
    EvacuationCenter,
    EvacuationCenterBuilding,
    EvacuationCenterRoom,
    Family,
    Resident,
    ResidentAccount,
    RosterYear,
    SystemLog,
    User,
    db,
)
from routes.families import families_bp


class RosterCarryOverTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config.update(
            TESTING=True,
            SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            JWT_SECRET_KEY="test-carry-over-secret-key-32-bytes-long",
        )
        db.init_app(self.app)
        JWTManager(self.app)
        self.app.register_blueprint(families_bp)
        self.app.register_blueprint(barangays_bp)

        with self.app.app_context():
            raw_conn = db.engine.raw_connection()
            raw_conn.create_function("AsEWKB", 1, lambda val: val)
            raw_conn.create_function("ST_AsEWKB", 1, lambda val: val)
            raw_conn.create_function("GeomFromEWKT", 1, lambda val: val)
            raw_conn.close()

            # Register SQLite dummy GIS functions on every new connection
            from sqlalchemy import event

            @event.listens_for(db.engine, "connect")
            def _register_sqlite_gis(dbapi_conn, _record):
                dbapi_conn.create_function("AsEWKB", 1, lambda val: val)
                dbapi_conn.create_function("ST_AsEWKB", 1, lambda val: val)
                dbapi_conn.create_function("GeomFromEWKT", 1, lambda val: val)
            # Create GIS tables via raw SQL for SQLite, and non-GIS tables via SQLAlchemy metadata
            for sql in (
                """
                CREATE TABLE barangays (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name VARCHAR(100) NOT NULL,
                    population INTEGER DEFAULT 0,
                    geom TEXT
                )
                """,
                """
                CREATE TABLE evacuation_centers (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name VARCHAR(150) NOT NULL,
                    capacity INTEGER DEFAULT 0,
                    center_type_id INTEGER,
                    is_active BOOLEAN DEFAULT 1,
                    geom TEXT
                )
                """,
                """
                CREATE TABLE evacuation_center_buildings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    evacuation_center_id INTEGER NOT NULL,
                    name VARCHAR(100),
                    status VARCHAR(30) DEFAULT 'open',
                    geom TEXT
                )
                """,
            ):
                db.session.execute(text(sql))

            for model_cls in (
                User,
                CenterType,
                CenterBarangay,
                EvacuationCenterRoom,
                RosterYear,
                Family,
                Resident,
                ResidentAccount,
                EvacuationAssignment,
                SystemLog,
            ):
                model_cls.__table__.create(bind=db.engine, checkfirst=True)

            admin = User(
                name="Admin User",
                email="admin@example.com",
                password_hash="hash",
                role="admin",
                is_active=True,
            )
            db.session.add(admin)

            db.session.execute(
                text("INSERT INTO barangays (id, name, population) VALUES (1, 'Hibod-Hibod', 100)")
            )
            brgy_id = 1

            db.session.execute(
                text("INSERT INTO evacuation_centers (id, name, capacity, is_active) VALUES (1, 'PNHS', 200, 1)")
            )

            ry_2025 = RosterYear(year=2025, is_active=False)
            ry_2026 = RosterYear(year=2026, is_active=True)
            db.session.add_all([ry_2025, ry_2026])
            db.session.flush()

            fam_2025 = Family(
                roster_year_id=ry_2025.id,
                barangay_id=brgy_id,
                family_code="FAM-001",
                head_name="Juan Dela Cruz",
                member_count=2,
                contact_number="09171234567",
                evacuation_status="assigned",
                address="Purok 1",
                searchable=True,
            )
            db.session.add(fam_2025)
            db.session.flush()

            head = Resident(
                family_id=fam_2025.id,
                first_name="Juan",
                last_name="Dela Cruz",
                date_of_birth=date(1985, 5, 1),
                gender="Male",
                relationship_to_head="Head",
                is_head_of_family=True,
                is_pwd=True,
                disability_type="Mobility",
            )
            member = Resident(
                family_id=fam_2025.id,
                first_name="Maria",
                last_name="Dela Cruz",
                date_of_birth=date(1988, 6, 15),
                gender="Female",
                relationship_to_head="Spouse",
                is_head_of_family=False,
                is_pregnant=True,
            )
            db.session.add_all([head, member])
            db.session.flush()

            acct = ResidentAccount(
                resident_id=head.id,
                email="juan@example.com",
                password_hash="pw-hash",
                is_active=True,
            )
            db.session.add(acct)

            assign = EvacuationAssignment(
                resident_id=head.id,
                evacuation_center_id=1,
                checked_in_at=datetime(2025, 11, 1, 8, 0, tzinfo=timezone.utc),
            )
            db.session.add(assign)
            db.session.commit()

            self.admin_id = admin.id
            self.ry_2025_id = ry_2025.id
            self.ry_2026_id = ry_2026.id
            self.old_head_id = head.id
            self.token = create_access_token(
                identity=str(admin.id),
                additional_claims={
                    "role": "admin",
                    "account_type": "user",
                    "mfa_verified": True,
                    "mfa_version": 0,
                },
            )

        self.client = self.app.test_client()

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.engine.dispose()

    def test_carry_over_clones_families_relinks_accounts_resets_checkin_and_is_idempotent(self):
        headers = {"Authorization": f"Bearer {self.token}"}

        with self.app.app_context():
            ry_2026 = db.session.get(RosterYear, self.ry_2026_id)

        with patch("routes.families.get_or_create_active_year", side_effect=lambda: RosterYear.query.filter_by(year=2026).first()):
            resp = self.client.post(
                "/api/roster-years/2025/carry-over",
                headers=headers,
                json={"include_assignments": True},
            )
            self.assertEqual(resp.status_code, 200, resp.get_json())
            body = resp.get_json()
            self.assertEqual(body["copied_families"], 1)
            self.assertEqual(body["copied_residents"], 2)
            self.assertEqual(body["skipped_families"], 0)
            self.assertEqual(body["relinked_accounts"], 1)
            self.assertEqual(body["carried_assignments"], 1)

            # Verify new 2026 family, resident account relink, and unchecked-in assignment
            with self.app.app_context():
                new_fam = Family.query.filter_by(roster_year_id=self.ry_2026_id, family_code="FAM-001").first()
                self.assertIsNotNone(new_fam)
                self.assertEqual(new_fam.evacuation_status, "assigned")
                new_residents = Resident.query.filter_by(family_id=new_fam.id).order_by(Resident.id.asc()).all()
                self.assertEqual(len(new_residents), 2)
                self.assertTrue(new_residents[0].is_pwd)
                self.assertTrue(new_residents[1].is_pregnant)

                acct = ResidentAccount.query.filter_by(email="juan@example.com").first()
                self.assertEqual(acct.resident_id, new_residents[0].id)
                self.assertNotEqual(acct.resident_id, self.old_head_id)

                new_assign = EvacuationAssignment.query.filter_by(resident_id=new_residents[0].id).first()
                self.assertIsNotNone(new_assign)
                self.assertEqual(new_assign.evacuation_center_id, 1)
                self.assertIsNone(new_assign.checked_in_at)

            # Verify barangays endpoint counts ONLY active year (1 family, 2 residents — NOT 2 families / 4 residents)
            brgy_resp = self.client.get("/api/barangays", headers=headers)
            self.assertEqual(brgy_resp.status_code, 200)
            brgys = brgy_resp.get_json()
            self.assertEqual(brgys[0]["family_count"], 1)
            self.assertEqual(brgys[0]["resident_count"], 2)

            # Second call is idempotent and skips already-carried families
            resp2 = self.client.post(
                "/api/roster-years/2025/carry-over",
                headers=headers,
                json={"include_assignments": True},
            )
            self.assertEqual(resp2.status_code, 200)
            body2 = resp2.get_json()
            self.assertEqual(body2["copied_families"], 0)
            self.assertEqual(body2["skipped_families"], 1)

    def test_selective_family_ids_carry_over_and_excel_previous_year_comparison(self):
        import io
        from openpyxl import Workbook
        from routes.families import _preview_family_workbook

        headers = {"Authorization": f"Bearer {self.token}"}

        # Add a second 2025 family so we can test selecting ONLY one family
        with self.app.app_context():
            fam2 = Family(
                roster_year_id=self.ry_2025_id,
                barangay_id=1,
                family_code="FAM-002",
                head_name="Pedro Santos",
                member_count=1,
                contact_number="09180000000",
                evacuation_status="unassigned",
                address="Purok 2",
            )
            db.session.add(fam2)
            db.session.flush()
            db.session.add(
                Resident(
                    family_id=fam2.id,
                    first_name="Pedro",
                    last_name="Santos",
                    relationship_to_head="Head",
                    is_head_of_family=True,
                )
            )
            db.session.commit()
            fam2_id = fam2.id

        # 1. Selective carry-over copies ONLY FAM-002, leaving FAM-001 out of 2026
        with patch("routes.families.get_or_create_active_year", side_effect=lambda: RosterYear.query.filter_by(year=2026).first()):
            resp = self.client.post(
                "/api/roster-years/2025/carry-over",
                headers=headers,
                json={"family_ids": [fam2_id], "include_assignments": False},
            )
            self.assertEqual(resp.status_code, 200, resp.get_json())
            data = resp.get_json()
            self.assertEqual(data["copied_families"], 1)
            self.assertEqual(data["copied_residents"], 1)

        with self.app.app_context():
            codes_2026 = {
                f.family_code for f in Family.query.filter_by(roster_year_id=self.ry_2026_id).all()
            }
            self.assertEqual(codes_2026, {"FAM-002"})

        # 2. Excel preview in 2026 compares against 2026 (active) AND tags FAM-001 vs archived 2025
        wb = Workbook()
        ws = wb.active
        ws.append([
            "Family Code", "Barangay", "Household Head", "Contact Number", "Address",
            "First Name", "Last Name", "Relationship", "Is Head",
        ])
        # FAM-001 returns from 2025 with a new 3rd member -> returning 'changed'
        ws.append(["FAM-001", "Hibod-Hibod", "Juan Dela Cruz", "09171234567", "Purok 1", "Juan", "Dela Cruz", "Head", "Yes"])
        ws.append(["FAM-001", "Hibod-Hibod", "Juan Dela Cruz", "09171234567", "Purok 1", "Maria", "Dela Cruz", "Spouse", "No"])
        ws.append(["FAM-001", "Hibod-Hibod", "Juan Dela Cruz", "09171234567", "Purok 1", "Junior", "Dela Cruz", "Child", "No"])
        # FAM-002 already in 2026 unchanged -> 'skipped'
        ws.append(["FAM-002", "Hibod-Hibod", "Pedro Santos", "09180000000", "Purok 2", "Pedro", "Santos", "Head", "Yes"])
        # FAM-999 brand new -> 'new', previous_year_match=None
        ws.append(["FAM-999", "Hibod-Hibod", "Ana Reyes", "09191112222", "Purok 3", "Ana", "Reyes", "Head", "Yes"])
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        buf.filename = "roster_2026.xlsx"

        with self.app.app_context():
            preview = _preview_family_workbook(buf)
            self.assertEqual(preview["errors"], [])
            self.assertEqual(preview["previous_year"], 2025)
            self.assertEqual(preview["new_households"], 2)  # FAM-001 + FAM-999
            self.assertEqual(preview["skipped_households"], 1)  # FAM-002 already in 2026
            self.assertEqual(preview["returning_changed_households"], 1)  # FAM-001
            self.assertEqual(preview["brand_new_households"], 1)  # FAM-999


if __name__ == "__main__":
    unittest.main()

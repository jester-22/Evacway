import unittest
from datetime import date
from unittest.mock import patch

from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token
from sqlalchemy import event, text

from models import (
    Barangay,
    EvacuationAssignment,
    Family,
    Resident,
    ResidentAccount,
    ResidentLookupLog,
    db,
)
from routes import residents as residents_routes
from routes.residents import residents_bp


class FindCenterRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = Flask(__name__)
        cls.app.config.update(
            TESTING=True,
            SQLALCHEMY_DATABASE_URI='sqlite://',
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            JWT_SECRET_KEY='find-center-test-secret-key-at-least-32b',
        )
        db.init_app(cls.app)
        JWTManager(cls.app)
        cls.app.register_blueprint(residents_bp)
        cls.app_context = cls.app.app_context()
        cls.app_context.push()

        @event.listens_for(db.engine, 'connect')
        def _register_sqlite_spatial_funcs(dbapi_connection, _connection_record):
            dbapi_connection.create_function('AsEWKB', 1, lambda x: x)
            dbapi_connection.create_function('GeomFromEWKT', 1, lambda x: x)
            dbapi_connection.create_function('ST_AsEWKB', 1, lambda x: x)
            dbapi_connection.create_function('ST_GeomFromEWKT', 1, lambda x: x)

        with db.engine.begin() as conn:
            conn.execute(text('CREATE TABLE roster_years (id INTEGER PRIMARY KEY, year INTEGER)'))
            conn.execute(text(
                'CREATE TABLE users ('
                'id INTEGER PRIMARY KEY, name VARCHAR(100), email VARCHAR(120), '
                'password_hash VARCHAR(255), contact_number VARCHAR(20), resident_id INTEGER, '
                'role VARCHAR(20), is_active BOOLEAN, created_at DATETIME, last_login_at DATETIME, '
                'login_failed_attempts INTEGER DEFAULT 0, login_failure_window_started_at DATETIME, '
                'login_locked_until DATETIME, totp_enabled BOOLEAN DEFAULT 0, '
                'totp_secret_encrypted TEXT, totp_pending_secret_encrypted TEXT, '
                'totp_setup_expires_at DATETIME, totp_last_used_step BIGINT, '
                'totp_backup_codes_hashes JSON, mfa_version INTEGER DEFAULT 0)'
            ))
            conn.execute(
                text(
                    'CREATE TABLE barangays ('
                    'id INTEGER PRIMARY KEY, name VARCHAR(100), population INTEGER DEFAULT 0, geom BLOB)'
                )
            )
            conn.execute(
                text(
                    'CREATE TABLE evacuation_centers ('
                    'id INTEGER PRIMARY KEY, name VARCHAR(150), center_type VARCHAR(50), owner_name VARCHAR(150))'
                )
            )
            conn.execute(
                text(
                    'CREATE TABLE evacuation_center_rooms ('
                    'id INTEGER PRIMARY KEY, evacuation_center_id INTEGER, building_id INTEGER, '
                    'room_number VARCHAR(50), latitude FLOAT, longitude FLOAT)'
                )
            )

        db.metadata.create_all(
            bind=db.engine,
            tables=[
                Family.__table__,
                Resident.__table__,
                ResidentAccount.__table__,
                EvacuationAssignment.__table__,
                ResidentLookupLog.__table__,
            ],
        )
        cls.client = cls.app.test_client()

    @classmethod
    def tearDownClass(cls):
        cls.app_context.pop()

    def setUp(self):
        db.session.remove()
        residents_routes._lookup_limit_buckets.clear()
        residents_routes._lookup_miss_counts.clear()
        with db.engine.begin() as conn:
            for table in (
                'resident_lookup_logs',
                'evacuation_assignments',
                'resident_accounts',
                'residents',
                'families',
                'barangays',
                'evacuation_centers',
                'users',
            ):
                conn.execute(text(f'DELETE FROM {table}'))

        db.session.add_all([
            Barangay(id=1, name='Poblacion'),
            Barangay(id=2, name='Riverside'),
        ])
        db.session.flush()
        db.session.execute(text(
            "INSERT INTO evacuation_centers (id, name, center_type, owner_name) "
            "VALUES (1, 'North Shelter', 'campus', NULL), (2, 'South Shelter', 'campus', NULL)"
        ))

        self.fam_a = Family(
            id=1, roster_year_id=1, barangay_id=1, head_name='Juan Reyes',
            family_code='FAM-001', member_count=1, searchable=True,
            address='Purok 1, Poblacion',
        )
        self.fam_b = Family(
            id=2, roster_year_id=1, barangay_id=1, head_name='Maria Santos',
            family_code='FAM-002', member_count=1, searchable=True,
            address='Purok 2, Poblacion',
        )
        self.fam_opted_out = Family(
            id=3, roster_year_id=1, barangay_id=2, head_name='Pedro Cruz',
            family_code='FAM-003', member_count=1, find_someone_opt_out=True,
            searchable=False,
        )
        db.session.add_all([self.fam_a, self.fam_b, self.fam_opted_out])
        db.session.flush()

        self.res_a = Resident(
            id=10, family_id=1, first_name='Juan', last_name='Reyes',
            is_head_of_family=True, date_of_birth=date(1980, 2, 3),
        )
        self.res_b = Resident(
            id=20, family_id=2, first_name='Maria', last_name='Santos',
            is_head_of_family=True, date_of_birth=date(1990, 4, 5),
        )
        self.res_opted_out = Resident(
            id=30, family_id=3, first_name='Pedro', last_name='Cruz',
            is_head_of_family=True, date_of_birth=date(1975, 8, 9),
        )
        db.session.add_all([self.res_a, self.res_b, self.res_opted_out])
        db.session.flush()
        self.resident_account = ResidentAccount(
            id=7, resident_id=self.res_a.id, email='juan@example.test',
            password_hash='test-hash', is_active=True,
        )
        db.session.add(self.resident_account)
        with db.engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO users (id, name, email, password_hash, role, is_active) VALUES "
                "(1, 'LGU User', 'lgu@example.test', 'test-hash', 'lgu_personnel', 1), "
                "(2, 'Admin User', 'admin@example.test', 'test-hash', 'admin', 1)"
            ))
        db.session.add_all([
            EvacuationAssignment(resident_id=self.res_a.id, evacuation_center_id=1),
            EvacuationAssignment(resident_id=self.res_b.id, evacuation_center_id=1),
            EvacuationAssignment(resident_id=self.res_opted_out.id, evacuation_center_id=2),
        ])
        db.session.commit()

        self.token_a = create_access_token(
            identity=str(self.resident_account.id),
            additional_claims={
                'role': 'resident',
                'account_type': 'resident_account',
                'resident_id': self.res_a.id,
                'name': 'Juan Reyes',
            },
        )
        self.resident_headers = {'Authorization': f'Bearer {self.token_a}'}
        self.lgu_headers = {
            'Authorization': 'Bearer ' + create_access_token(identity='1')
        }
        self.admin_headers = {
            'Authorization': 'Bearer ' + create_access_token(identity='2')
        }

    def _verify_center(self, full_name='Juan Reyes', barangay_id=1, birthdate='1980-02-03', headers=None):
        return self.client.post(
            '/api/residents/my-center-lookup',
            headers=headers or {},
            json={
                'full_name': full_name,
                'barangay_id': barangay_id,
                'birthdate': birthdate,
            },
        )

    def test_my_center_requires_exact_name_barangay_and_birthdate(self):
        exact = self._verify_center()
        self.assertEqual(exact.status_code, 200)
        self.assertEqual(exact.get_json(), {'center_name': 'North Shelter'})

        failures = [
            self._verify_center(full_name='Juan'),
            self._verify_center(full_name='Juan Reyes', barangay_id=2),
            self._verify_center(full_name='Juan Reyes', birthdate='1980-02-04'),
            self._verify_center(full_name=''),
        ]
        for response in failures:
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.get_json(), {'message': 'No match found.'})

        logs = ResidentLookupLog.query.order_by(ResidentLookupLog.id).all()
        self.assertTrue(logs)
        self.assertTrue(all(log.query_name_masked != 'Juan Reyes' for log in logs))
        self.assertTrue(any(log.query_name_masked == 'J*** R****' for log in logs))
        self.assertTrue(all(log.query_birthdate_masked == '****-**-**' for log in logs if log.query_birthdate_masked))

        for role, headers in (
            ('resident', self.resident_headers),
            ('lgu_personnel', self.lgu_headers),
            ('admin', self.admin_headers),
        ):
            with self.subTest(role=role):
                response = self._verify_center(headers=headers)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.get_json(), {'center_name': 'North Shelter'})
                self.assertNotIn('Juan Reyes', response.get_data(as_text=True))

        duplicate_family = Family(
            id=4, roster_year_id=1, barangay_id=1, head_name='Juan Reyes',
            family_code='FAM-004', member_count=1,
        )
        db.session.add(duplicate_family)
        db.session.flush()
        db.session.add(Resident(
            id=40, family_id=4, first_name='Juan', last_name='Reyes',
            is_head_of_family=True, date_of_birth=date(1980, 2, 3),
        ))
        db.session.commit()
        duplicate = self._verify_center()
        self.assertEqual(duplicate.get_json(), {'message': 'No match found.'})

    def test_find_someone_requires_resident_and_returns_center_name_only(self):
        guest = self.client.post('/api/residents/find-center', json={
            'full_name': 'Maria Santos', 'barangay_id': 1,
        })
        self.assertEqual(guest.status_code, 401)

        resident = self.client.post(
            '/api/residents/find-center',
            headers=self.resident_headers,
            json={'full_name': 'Maria Santos', 'barangay_id': 1},
        )
        self.assertEqual(resident.status_code, 200)
        self.assertEqual(resident.get_json(), {'center_name': 'North Shelter'})
        self.assertNotIn('Maria Santos', resident.get_data(as_text=True))
        self.assertNotIn('resident_id', resident.get_data(as_text=True))
        find_logs = ResidentLookupLog.query.filter_by(lookup_type='find_someone').all()
        self.assertTrue(find_logs)
        self.assertTrue(all(log.query_name_masked != 'Maria Santos' for log in find_logs))

        for role, headers in (
            ('lgu_personnel', self.lgu_headers),
            ('admin', self.admin_headers),
        ):
            with self.subTest(role=role):
                response = self.client.post(
                    '/api/residents/find-center', headers=headers,
                    json={'full_name': 'Maria Santos', 'barangay_id': 1},
                )
                self.assertEqual(response.status_code, 403)
                self.assertNotIn('Maria Santos', response.get_data(as_text=True))

        for role, headers, expected_status in (
            ('guest', {}, 401),
            ('resident', self.resident_headers, 405),
            ('lgu_personnel', self.lgu_headers, 403),
            ('admin', self.admin_headers, 403),
        ):
            with self.subTest(legacy_get_role=role):
                response = self.client.get(
                    '/api/residents/find-center?name=Maria%20Santos', headers=headers,
                )
                self.assertEqual(response.status_code, expected_status)
                self.assertNotIn('Maria Santos', response.get_data(as_text=True))

    def test_my_center_room_endpoint_requires_login_and_returns_own_center(self):
        for role, headers, expected_status in (
            ('guest', {}, 401),
            ('resident', self.resident_headers, 200),
            ('lgu_personnel', self.lgu_headers, 403),
            ('admin', self.admin_headers, 403),
        ):
            with self.subTest(role=role):
                response = self.client.get('/api/residents/my-center', headers=headers)
                self.assertEqual(response.status_code, expected_status)
                self.assertNotIn('Maria Santos', response.get_data(as_text=True))
                if role == 'resident':
                    self.assertEqual(response.get_json()['center_name'], 'North Shelter')
                    self.assertIsNone(response.get_json()['room'])

    def test_opted_out_family_is_not_returned_or_suggested(self):
        self.assertFalse(self.fam_opted_out.searchable)
        result = self.client.post(
            '/api/residents/find-center',
            headers=self.resident_headers,
            json={'full_name': 'Pedro Cruz', 'barangay_id': 2},
        )
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.get_json(), {'message': 'No match found.'})


    def test_missing_barangay_returns_generic_no_match_and_logs_masked_fields(self):
        response = self.client.post(
            '/api/residents/find-center',
            headers=self.resident_headers,
            json={'full_name': 'Maria Santos'},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {'message': 'No match found.'})
        log = ResidentLookupLog.query.filter_by(lookup_type='find_someone').order_by(
            ResidentLookupLog.id.desc()
        ).first()
        self.assertEqual(log.query_name_masked, 'M**** S*****')
        self.assertIsNone(log.query_barangay_masked)
        self.assertFalse(log.found)

    def test_ambiguous_name_returns_no_candidates_and_extra_detail_can_refine(self):
        duplicate_family = Family(
            id=4, roster_year_id=1, barangay_id=1, head_name='Maria Santos',
            family_code='FAM-004', member_count=1, searchable=True,
            address='Purok 3, Poblacion',
        )
        db.session.add(duplicate_family)
        db.session.flush()
        duplicate_resident = Resident(
            id=40, family_id=4, first_name='Maria', last_name='Santos',
            is_head_of_family=True, date_of_birth=date(1985, 1, 2),
        )
        db.session.add(duplicate_resident)
        db.session.add(EvacuationAssignment(resident_id=40, evacuation_center_id=2))
        db.session.commit()

        ambiguous = self.client.post(
            '/api/residents/find-center',
            headers=self.resident_headers,
            json={'full_name': 'Maria Santos', 'barangay_id': 1},
        )
        self.assertEqual(ambiguous.status_code, 200)
        self.assertEqual(ambiguous.get_json(), {'message': 'No match found.'})
        self.assertNotIn('North Shelter', ambiguous.get_data(as_text=True))
        self.assertNotIn('South Shelter', ambiguous.get_data(as_text=True))

        refined = self.client.post(
            '/api/residents/find-center',
            headers=self.resident_headers,
            json={
                'full_name': 'Maria Santos', 'barangay_id': 1,
                'additional_detail': 'Purok 3',
            },
        )
        self.assertEqual(refined.get_json(), {'center_name': 'South Shelter'})
        log = ResidentLookupLog.query.filter_by(lookup_type='find_someone').order_by(
            ResidentLookupLog.id.desc()
        ).first()
        self.assertNotEqual(log.query_extra_masked, 'Purok 3')
        self.assertTrue(log.found)

    def test_guest_autosuggest_is_rejected_and_find_someone_is_rate_limited(self):
        self.assertEqual(self.client.get('/api/residents/autosuggest?q=Maria').status_code, 401)

        with patch.object(residents_routes, 'LOOKUP_RATE_LIMIT_MAX_REQUESTS', 1):
            first = self.client.post(
                '/api/residents/find-center',
                headers={**self.resident_headers, 'X-Real-IP': '192.0.2.20'},
                json={'full_name': 'Maria Santos', 'barangay_id': 1},
            )
            second = self.client.post(
                '/api/residents/find-center',
                headers={**self.resident_headers, 'X-Real-IP': '192.0.2.20'},
                json={'full_name': 'Maria Santos', 'barangay_id': 1},
            )
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 429)
        self.assertIn('wait', second.get_json()['error'].lower())

    def test_my_center_rate_limits_by_ip_and_resident_account(self):
        with patch.object(residents_routes, 'LOOKUP_RATE_LIMIT_MAX_REQUESTS', 1):
            first_guest = self.client.post(
                '/api/residents/my-center-lookup',
                headers={'X-Real-IP': '192.0.2.10'},
                json={'full_name': 'Unknown Person', 'barangay_id': 1, 'birthdate': '2000-01-01'},
            )
            second_guest = self.client.post(
                '/api/residents/my-center-lookup',
                headers={'X-Real-IP': '192.0.2.10'},
                json={'full_name': 'Unknown Person', 'barangay_id': 1, 'birthdate': '2000-01-01'},
            )
        self.assertEqual(first_guest.get_json(), {'message': 'No match found.'})
        self.assertEqual(second_guest.status_code, 429)

        residents_routes._lookup_limit_buckets.clear()
        with patch.object(residents_routes, 'LOOKUP_RATE_LIMIT_MAX_REQUESTS', 1):
            first_resident = self.client.post(
                '/api/residents/find-center', headers={
                    **self.resident_headers, 'X-Real-IP': '192.0.2.11',
                }, json={'full_name': 'Maria Santos', 'barangay_id': 1},
            )
            second_resident = self.client.post(
                '/api/residents/find-center', headers={
                    **self.resident_headers, 'X-Real-IP': '192.0.2.12',
                }, json={'full_name': 'Maria Santos', 'barangay_id': 1},
            )
        self.assertEqual(first_resident.status_code, 200)
        self.assertEqual(second_resident.status_code, 429)

    def test_privacy_toggle_updates_only_signed_in_residents_family(self):
        get_response = self.client.get(
            '/api/residents/profile/find-someone',
            headers=self.resident_headers,
        )
        self.assertEqual(get_response.get_json(), {'searchable': True, 'prompt_pending': True})
        update = self.client.patch(
            '/api/residents/profile/find-someone',
            headers=self.resident_headers,
            json={'searchable': False},
        )
        self.assertEqual(update.status_code, 200)
        self.assertEqual(update.get_json(), {'searchable': False, 'prompt_pending': False})
        self.assertFalse(db.session.get(Family, self.fam_a.id).searchable)
        self.assertTrue(db.session.get(ResidentAccount, self.resident_account.id).find_someone_prompt_seen)

        for role, headers in (
            ('guest', {}),
            ('lgu_personnel', self.lgu_headers),
            ('admin', self.admin_headers),
        ):
            with self.subTest(role=role):
                response = self.client.get(
                    '/api/residents/profile/find-someone', headers=headers,
                )
                self.assertIn(response.status_code, (401, 403))
                update_response = self.client.patch(
                    '/api/residents/profile/find-someone', headers=headers,
                    json={'searchable': True},
                )
                self.assertIn(update_response.status_code, (401, 403))


if __name__ == '__main__':
    unittest.main()

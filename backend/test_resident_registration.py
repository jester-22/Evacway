import unittest
from datetime import date
from unittest.mock import patch

from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token
from sqlalchemy import text, event
from werkzeug.security import check_password_hash, generate_password_hash

import time
from models import (
    db,
    Barangay,
    Family,
    Resident,
    ResidentRegistrationRequest,
    ResidentAccount,
    RosterYear,
    EvacuationAssignment,
    Amenity,
    center_amenities,
    CenterType,
    BuildingMaterial,
    EvacuationCenterRoom,
    StaffNotification,
    SystemLog,
    User,
)
from routes.auth import auth_bp
from routes.families import families_bp
from routes.resident_registrations import _registration_rate_limits, registrations_bp
from routes.residents import residents_bp
from routes.users import users_bp
from barangays import barangays_bp
from services.mailer import send_resident_registration_email


class ResidentRegistrationApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = Flask(__name__)
        cls.app.config.update(
            TESTING=True,
            SQLALCHEMY_DATABASE_URI='sqlite://',
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            JWT_SECRET_KEY='resident-registration-test-key-long-enough',
        )
        db.init_app(cls.app)
        JWTManager(cls.app)
        cls.app.register_blueprint(auth_bp)
        cls.app.register_blueprint(barangays_bp)
        cls.app.register_blueprint(residents_bp)
        cls.app.register_blueprint(registrations_bp)
        cls.app.register_blueprint(users_bp)
        cls.app.register_blueprint(families_bp)
        cls.app_context = cls.app.app_context()
        cls.app_context.push()
        @event.listens_for(db.engine, 'connect')
        def register_sqlite_functions(dbapi_connection, connection_record):
            dbapi_connection.create_function('AsEWKB', 1, lambda x: x)
            dbapi_connection.create_function('GeomFromEWKT', 1, lambda x: x)
            dbapi_connection.create_function('ST_AsEWKB', 1, lambda x: x)
            dbapi_connection.create_function('ST_GeomFromEWKT', 1, lambda x: x)

        db.metadata.create_all(bind=db.engine, tables=[
            User.__table__,
            Amenity.__table__,
            center_amenities,
            CenterType.__table__,
            BuildingMaterial.__table__,
            Family.__table__,
            RosterYear.__table__,
            EvacuationAssignment.__table__,
            EvacuationCenterRoom.__table__,
            Resident.__table__,
            ResidentAccount.__table__,
            ResidentRegistrationRequest.__table__,
            StaffNotification.__table__,
            SystemLog.__table__,
        ])
        with db.engine.begin() as connection:
            connection.execute(text(
                'CREATE TABLE barangays (id INTEGER PRIMARY KEY, name VARCHAR(100) NOT NULL, population INTEGER, geom BLOB)'
            ))
            connection.execute(text(
                'CREATE TABLE evacuation_centers (id INTEGER PRIMARY KEY, name VARCHAR(100) NOT NULL, capacity INTEGER, building_material VARCHAR(50), building_material_id INTEGER, accessibility_notes TEXT, hazard_exposure_score FLOAT, contact_number VARCHAR(20), is_active BOOLEAN DEFAULT 1, center_type VARCHAR(50), center_type_id INTEGER, owner_name VARCHAR(150), evacuation_open_date DATE, evacuation_status VARCHAR(30) DEFAULT \'standby\', evacuation_event_name VARCHAR(150), max_rooms INTEGER, geom BLOB, entrance_geom BLOB, managed_by INTEGER, created_at DATETIME)'
            ))

    @classmethod
    def tearDownClass(cls):
        db.session.remove()
        db.engine.dispose()
        cls.app_context.pop()

    def setUp(self):
        db.session.remove()
        ResidentRegistrationRequest.query.delete(synchronize_session=False)
        SystemLog.query.delete(synchronize_session=False)
        ResidentAccount.query.delete(synchronize_session=False)
        User.query.delete(synchronize_session=False)
        Resident.query.delete(synchronize_session=False)
        Family.query.delete(synchronize_session=False)
        RosterYear.query.delete(synchronize_session=False)
        EvacuationAssignment.query.delete(synchronize_session=False)
        EvacuationCenterRoom.query.delete(synchronize_session=False)
        Barangay.query.delete(synchronize_session=False)
        db.session.commit()
        _registration_rate_limits.clear()
        self.client = self.app.test_client()
        self.staff = self._create_user('admin', 'staff@example.com')
        self.lgu = self._create_user('lgu_personnel', 'lgu@example.com')
        self.resident_user = self._create_user('resident', 'resident@example.com')

    def _create_user(self, role, email, resident_id=None):
        user = User(
            name=f'{role.title()} User',
            email=email,
            password_hash=generate_password_hash('Secret123!'),
            contact_number='09170000000',
            role=role,
            is_active=True,
            resident_id=resident_id,
        )
        db.session.add(user)
        db.session.commit()
        token = create_access_token(
            identity=str(user.id),
            additional_claims={'role': role, 'name': user.name},
        )
        return {'user': user, 'headers': {'Authorization': f'Bearer {token}'}}

    def _create_resident_account(self, resident_id, email, password='Secret123!'):
        """Create a resident account in the new resident_accounts table."""
        account = ResidentAccount(
            resident_id=resident_id,
            email=email,
            password_hash=generate_password_hash(password),
            is_active=True,
        )
        db.session.add(account)
        db.session.commit()
        token = create_access_token(
            identity=str(account.id),
            additional_claims={
                'role': 'resident',
                'name': account.resident.get_full_name() if account.resident else 'Resident',
                'account_type': 'resident_account',
                'resident_id': resident_id
            }
        )
        return {'account': account, 'headers': {'Authorization': f'Bearer {token}'}}

    def _payload(self, **overrides):
        payload = {
            'first_name': 'Jose',
            'middle_name': 'Manuel',
            'last_name': 'Dela Cruz',
            'birthdate': '1990-04-12',
            'barangay': 'San Jose',
            'address': 'Purok 2',
            'contact_number': '09181234567',
            'email': 'jose@example.com',
            'password': 'Secret123!',
        }
        payload.update(overrides)
        return payload

    def _submit(self, **overrides):
        return self.client.post(
            '/api/resident-registrations',
            json=self._payload(**overrides),
        )

    def _create_roster_resident(self, **overrides):
        barangay_name = overrides.pop('barangay', 'San José')
        address = overrides.pop('address', 'Purok 2')
        contact_number = overrides.pop('contact_number', '09181234567')
        head_name = overrides.pop('household_head_name', 'Jose Manuel Dela Cruz')
        family_members = overrides.pop('family_members', 1)

        brgy = Barangay.query.filter_by(name=barangay_name).first()
        if not brgy:
            brgy = Barangay(name=barangay_name)
            db.session.add(brgy)
            db.session.flush()

        family = overrides.pop('family', None)
        if not family:
            family_id = overrides.pop('family_id', None)
            if family_id:
                family = db.session.get(Family, family_id)
        if not family:
            roster_year_id = overrides.pop('roster_year_id', None)
            if not roster_year_id:
                ry = RosterYear.query.filter_by(is_active=True).first()
                if not ry:
                    ry = RosterYear(year=2026, is_active=True)
                    db.session.add(ry)
                    db.session.flush()
                roster_year_id = ry.id
            family = Family(
                roster_year_id=roster_year_id,
                barangay_id=brgy.id,
                family_code=f"FAM-{time.time()}-{id(overrides)}",
                head_name=head_name,
                member_count=family_members,
                contact_number=contact_number,
                address=address,
            )
            db.session.add(family)
            db.session.flush()

        values = {
            'family_id': family.id,
            'first_name': 'Jose',
            'middle_name': 'Manuel',
            'last_name': 'Dela Cruz',
            'date_of_birth': date(1990, 4, 12),
        }
        values.update(overrides)
        resident = Resident(**values)
        db.session.add(resident)
        db.session.commit()
        return resident

    def _staff_headers(self):
        return self.staff['headers']

    def _resident_headers(self):
        return self.resident_user['headers']

    def _resident_account_headers(self):
        """Headers for a resident logged in via resident_accounts table."""
        return self.resident_account['headers']

    def test_public_barangay_list_returns_only_id_and_name_without_token(self):
        with db.engine.begin() as connection:
            first_id = connection.execute(
                text('INSERT INTO barangays (name) VALUES (:name)'),
                {'name': 'San Jose'},
            ).lastrowid
            second_id = connection.execute(
                text('INSERT INTO barangays (name) VALUES (:name)'),
                {'name': 'Zone 2'},
            ).lastrowid

        response = self.client.get('/api/barangays/public')

        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.request.headers.get('Authorization'))
        self.assertEqual(response.get_json(), [
            {'id': first_id, 'name': 'San Jose'},
            {'id': second_id, 'name': 'Zone 2'},
        ])
        self.assertTrue(all(set(item) == {'id', 'name'} for item in response.get_json()))

    def test_roster_search_marks_linked_records_and_allows_staff_and_admin(self):
        resident = self._create_roster_resident()
        self.resident_user['user'].resident_id = resident.id
        db.session.commit()

        admin_response = self.client.get('/api/residents', headers=self._staff_headers())
        lgu_response = self.client.get('/api/residents', headers=self.lgu['headers'])

        self.assertEqual(admin_response.status_code, 200)
        self.assertEqual(lgu_response.status_code, 200)
        for response in (admin_response, lgu_response):
            result = response.get_json()
            self.assertTrue(result[0]['already_linked'])
            self.assertNotIn('email', result[0])
            self.assertNotIn('password_hash', result[0])
            self.assertNotIn('user_id', result[0])

        self.resident_user['user'].resident_id = None
        db.session.commit()
        unlinked = self.client.get('/api/residents', headers=self._staff_headers()).get_json()
        self.assertFalse(unlinked[0]['already_linked'])

    def test_resident_token_gets_forbidden_on_roster_search(self):
        response = self.client.get('/api/residents', headers=self._resident_headers())
        self.assertEqual(response.status_code, 403)

    def test_submit_hashes_password_and_does_not_create_account(self):
        response = self._submit()
        self.assertEqual(response.status_code, 201, response.get_json())
        registration = ResidentRegistrationRequest.query.one()
        self.assertEqual(registration.status, 'pending')
        self.assertTrue(check_password_hash(registration.password_hash, 'Secret123!'))
        self.assertNotEqual(registration.password_hash, 'Secret123!')
        self.assertEqual(User.query.filter_by(email='jose@example.com').count(), 0)
        self.assertNotIn('password_hash', response.get_json()['registration'])

    def test_decision_email_includes_outcome_but_never_password(self):
        self._submit()
        registration = ResidentRegistrationRequest.query.one()
        self.app.config.update(
            MAIL_MAILER='smtp',
            MAIL_HOST='smtp.example.com',
            MAIL_PORT=587,
            MAIL_USERNAME='mailer@example.com',
            MAIL_PASSWORD='smtp-secret',
            MAIL_ENCRYPTION='tls',
            MAIL_FROM_ADDRESS='mailer@example.com',
            MAIL_FROM_NAME='EvacWay',
            FRONTEND_URL='https://evacway.example.com',
        )
        with patch('services.mailer.smtplib.SMTP') as smtp:
            smtp_server = smtp.return_value.__enter__.return_value
            registration.status = 'approved'
            send_resident_registration_email(registration)
            approval_message = smtp_server.send_message.call_args.args[0]
            approval_body = approval_message.get_body(preferencelist=('plain',)).get_content()
            self.assertIn('You can now log in', approval_body)
            self.assertNotIn('Secret123!', approval_body)

            smtp_server.send_message.reset_mock()
            registration.status = 'rejected'
            registration.rejection_reason = 'Please verify your details.'
            send_resident_registration_email(registration)
            rejection_message = smtp_server.send_message.call_args.args[0]
            rejection_body = rejection_message.get_body(preferencelist=('plain',)).get_content()
            self.assertIn('Please verify your details.', rejection_body)
            self.assertNotIn('Secret123!', rejection_body)

    def test_validation_duplicate_email_and_contact(self):
        self.assertEqual(self._submit(birthdate='2099-01-01').status_code, 400)
        self.assertEqual(self._submit(password='weak').status_code, 400)
        self.assertEqual(self._submit().status_code, 201)
        self.assertEqual(self._submit(email='JOSE@example.com').status_code, 409)
        self.assertEqual(
            self._submit(email='other@example.com', contact_number='+63 918 123 4567').status_code,
            409,
        )

    def test_matching_handles_accents_middle_initial_and_existing_link(self):
        resident = self._create_roster_resident()
        self.assertEqual(
            self._submit(
                first_name='José',
                middle_name='M.',
                barangay='San Jose',
            ).status_code,
            201,
        )
        registration = ResidentRegistrationRequest.query.one()
        headers = self._staff_headers()
        result = self.client.get(
            f'/api/resident-registrations/{registration.id}/matches',
            headers=headers,
        ).get_json()
        self.assertEqual(result['status'], 'match')
        self.assertTrue(result['matches'][0]['match_flags']['name'])
        self.assertTrue(result['matches'][0]['match_flags']['birthdate'])
        self.assertTrue(result['matches'][0]['match_flags']['barangay'])
        self.assertTrue(result['matches'][0]['available'])

        linked_user = User(
            name='Linked Resident',
            email='linked@example.com',
            password_hash=generate_password_hash('Secret123!'),
            role='resident',
            is_active=True,
            resident_id=resident.id,
        )
        db.session.add(linked_user)
        db.session.commit()
        result = self.client.get(
            f'/api/resident-registrations/{registration.id}/matches',
            headers=headers,
        ).get_json()
        self.assertTrue(result['matches'][0]['already_linked'])
        self.assertFalse(result['matches'][0]['available'])

    def test_possible_and_none_match_statuses(self):
        self._create_roster_resident(first_name='Josef', date_of_birth=date(1990, 4, 12))
        self._submit().get_json()
        registration = ResidentRegistrationRequest.query.one()
        result = self.client.get(
            f'/api/resident-registrations/{registration.id}/matches',
            headers=self._staff_headers(),
        ).get_json()
        self.assertEqual(result['status'], 'possible')
        self.assertLessEqual(len(result['matches']), 3)

        registration.first_name = 'Unrelated'
        registration.last_name = 'Person'
        db.session.commit()
        result = self.client.get(
            f'/api/resident-registrations/{registration.id}/matches',
            headers=self._staff_headers(),
        ).get_json()
        self.assertEqual(result['status'], 'none')
        self.assertEqual(result['matches'], [])

    def test_list_filter_search_and_resident_token_denial(self):
        self._submit().get_json()
        response = self.client.get(
            '/api/resident-registrations?status=pending&search=jose',
            headers=self._staff_headers(),
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['count'], 1)

        registration = ResidentRegistrationRequest.query.one()
        protected_calls = [
            ('GET', '/api/residents', None),
            ('GET', '/api/resident-registrations', None),
            ('GET', f'/api/resident-registrations/{registration.id}/matches', None),
            ('POST', f'/api/resident-registrations/{registration.id}/approve', {}),
            ('POST', f'/api/resident-registrations/{registration.id}/reject', {'reason': 'test'}),
            ('POST', f'/api/resident-registrations/{registration.id}/resend-email', {}),
        ]
        for method, path, body in protected_calls:
            response = self.client.open(
                path,
                method=method,
                headers=self._resident_headers(),
                json=body,
            )
            self.assertEqual(response.status_code, 403, f'{method} {path}: {response.get_json()}')

    def test_approval_is_atomic_active_and_login_returns_resident_role(self):
        resident = self._create_roster_resident()
        self._submit()
        registration = ResidentRegistrationRequest.query.one()
        with patch('routes.resident_registrations.send_resident_registration_email') as send_email:
            response = self.client.post(
                f'/api/resident-registrations/{registration.id}/approve',
                headers=self._staff_headers(),
                json={'matched_resident_id': resident.id},
            )
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertTrue(response.get_json()['email_sent'])
        account = ResidentAccount.query.filter_by(email='jose@example.com').one()
        self.assertTrue(account.is_active)
        self.assertEqual(account.resident_id, resident.id)
        self.assertEqual(registration.status, 'approved')
        send_email.assert_called_once()

        login = self.client.post('/api/auth/login', json={
            'email': 'jose@example.com',
            'password': 'Secret123!',
        })
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.get_json()['user']['role'], 'resident')

    def test_approval_requires_available_link_and_email_failure_can_retry(self):
        resident = self._create_roster_resident()
        self._submit()
        registration = ResidentRegistrationRequest.query.one()
        headers = self._staff_headers()
        self.assertEqual(
            self.client.post(
                f'/api/resident-registrations/{registration.id}/approve',
                headers=headers,
                json={},
            ).status_code,
            400,
        )

        with patch(
            'routes.resident_registrations.send_resident_registration_email',
            side_effect=RuntimeError('SMTP unavailable'),
        ):
            approved = self.client.post(
                f'/api/resident-registrations/{registration.id}/approve',
                headers=headers,
                json={'matched_resident_id': resident.id},
            )
            resent = self.client.post(
                f'/api/resident-registrations/{registration.id}/resend-email',
                headers=headers,
            )
        self.assertEqual(approved.status_code, 200)
        self.assertFalse(approved.get_json()['email_sent'])
        self.assertEqual(resent.status_code, 200)
        self.assertFalse(resent.get_json()['email_sent'])

    def test_rejection_requires_reason_and_keeps_request(self):
        self._submit()
        registration = ResidentRegistrationRequest.query.one()
        path = f'/api/resident-registrations/{registration.id}/reject'
        headers = self._staff_headers()
        self.assertEqual(self.client.post(path, headers=headers, json={}).status_code, 400)
        with patch('routes.resident_registrations.send_resident_registration_email') as send_email:
            response = self.client.post(path, headers=headers, json={'reason': 'Please verify your details.'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(registration.status, 'rejected')
        self.assertEqual(registration.rejection_reason, 'Please verify your details.')
        self.assertEqual(ResidentRegistrationRequest.query.count(), 1)
        self.assertEqual(User.query.filter_by(email='jose@example.com').count(), 0)
        send_email.assert_called_once()

    def test_submission_rate_limit(self):
        statuses = [
            self._submit(
                email=f'user{index}@example.com',
                contact_number=f'091812345{index:02d}',
            ).status_code
            for index in range(6)
        ]
        self.assertEqual(statuses, [201, 201, 201, 201, 201, 429])

    # ============================================================
    # NEW TESTS FOR resident_accounts TABLE
    # ============================================================

    def test_approval_creates_resident_account_not_user(self):
        """Approval should create a ResidentAccount, not a User with role='resident'."""
        resident = self._create_roster_resident()
        self._submit()
        registration = ResidentRegistrationRequest.query.one()

        with patch('routes.resident_registrations.send_resident_registration_email'):
            response = self.client.post(
                f'/api/resident-registrations/{registration.id}/approve',
                headers=self._staff_headers(),
                json={'matched_resident_id': resident.id},
            )

        self.assertEqual(response.status_code, 200, response.get_json())
        # Verify ResidentAccount was created
        account = ResidentAccount.query.filter_by(resident_id=resident.id).one()
        self.assertEqual(account.email, 'jose@example.com')
        self.assertTrue(account.is_active)
        self.assertTrue(check_password_hash(account.password_hash, 'Secret123!'))
        # Verify NO User was created with role='resident'
        self.assertEqual(User.query.filter_by(email='jose@example.com').count(), 0)
        # Verify response contains account info
        self.assertIn('account', response.get_json())
        self.assertEqual(response.get_json()['account']['resident_id'], resident.id)

    def test_resident_login_uses_resident_accounts_table(self):
        """Login should work with resident_accounts table."""
        resident = self._create_roster_resident()
        self._submit()
        registration = ResidentRegistrationRequest.query.one()

        with patch('routes.resident_registrations.send_resident_registration_email'):
            self.client.post(
                f'/api/resident-registrations/{registration.id}/approve',
                headers=self._staff_headers(),
                json={'matched_resident_id': resident.id},
            )

        # Login with the resident account
        login = self.client.post('/api/auth/login', json={
            'email': 'jose@example.com',
            'password': 'Secret123!',
        })
        self.assertEqual(login.status_code, 200)
        data = login.get_json()
        self.assertEqual(data['user']['role'], 'resident')
        self.assertEqual(data['user']['resident_id'], resident.id)
        self.assertIn('access_token', data)

    def test_resident_token_contains_account_type_and_resident_id(self):
        """JWT token should include account_type=resident_account and resident_id."""
        resident = self._create_roster_resident()
        self._submit()
        registration = ResidentRegistrationRequest.query.one()

        with patch('routes.resident_registrations.send_resident_registration_email'):
            self.client.post(
                f'/api/resident-registrations/{registration.id}/approve',
                headers=self._staff_headers(),
                json={'matched_resident_id': resident.id},
            )

        login = self.client.post('/api/auth/login', json={
            'email': 'jose@example.com',
            'password': 'Secret123!',
        })
        token = login.get_json()['access_token']

        # Decode token to check claims (without verification for test)
        from flask_jwt_extended import decode_token
        decoded = decode_token(token)
        self.assertEqual(decoded['role'], 'resident')
        self.assertEqual(decoded['account_type'], 'resident_account')
        self.assertEqual(decoded['resident_id'], resident.id)

    def test_duplicate_email_blocked_across_both_tables(self):
        """Email uniqueness should be enforced across users and resident_accounts."""
        # Create a user in users table
        user = User(
            name='Admin User',
            email='shared@example.com',
            password_hash=generate_password_hash('Secret123!'),
            role='admin',
            is_active=True,
        )
        db.session.add(user)
        db.session.commit()

        # Try to register with same email - should fail
        response = self._submit(email='shared@example.com')
        self.assertEqual(response.status_code, 409)

        # Clean up user
        db.session.delete(user)
        db.session.commit()

        # Create a resident account
        resident = self._create_roster_resident()
        account = ResidentAccount(
            resident_id=resident.id,
            email='shared2@example.com',
            password_hash=generate_password_hash('Secret123!'),
            is_active=True,
        )
        db.session.add(account)
        db.session.commit()

        # Try to register with same email - should fail
        response = self._submit(email='shared2@example.com')
        self.assertEqual(response.status_code, 409)

    def test_approval_checks_resident_account_already_linked(self):
        """Approval should fail if resident already has a resident_account."""
        resident = self._create_roster_resident()
        # Create existing resident account
        existing_account = ResidentAccount(
            resident_id=resident.id,
            email='existing@example.com',
            password_hash=generate_password_hash('Secret123!'),
            is_active=True,
        )
        db.session.add(existing_account)
        db.session.commit()

        self._submit()
        registration = ResidentRegistrationRequest.query.one()

        response = self.client.post(
            f'/api/resident-registrations/{registration.id}/approve',
            headers=self._staff_headers(),
            json={'matched_resident_id': resident.id},
        )
        self.assertEqual(response.status_code, 409)
        self.assertIn('already linked', response.get_json()['error'])

    def test_role_required_works_with_resident_account_token(self):
        """role_required decorator should work with resident_account tokens."""
        resident = self._create_roster_resident()
        self._submit()
        registration = ResidentRegistrationRequest.query.one()

        with patch('routes.resident_registrations.send_resident_registration_email'):
            self.client.post(
                f'/api/resident-registrations/{registration.id}/approve',
                headers=self._staff_headers(),
                json={'matched_resident_id': resident.id},
            )

        login = self.client.post('/api/auth/login', json={
            'email': 'jose@example.com',
            'password': 'Secret123!',
        })
        token = login.get_json()['access_token']
        headers = {'Authorization': f'Bearer {token}'}

        # Resident should be able to access resident-only endpoints
        # (if any exist - test that the token is valid)
        # For now, test that the token works for login
        self.assertEqual(login.status_code, 200)

        # Resident should NOT be able to access admin endpoints
        response = self.client.get('/api/users', headers=headers)
        self.assertEqual(response.status_code, 403)

    def test_password_reset_works_for_resident_account(self):
        """Password reset should work for resident accounts."""
        resident = self._create_roster_resident()
        self._submit()
        registration = ResidentRegistrationRequest.query.one()

        with patch('routes.resident_registrations.send_resident_registration_email'):
            self.client.post(
                f'/api/resident-registrations/{registration.id}/approve',
                headers=self._staff_headers(),
                json={'matched_resident_id': resident.id},
            )

        # Request password reset
        with patch('routes.auth.send_password_setup_email') as mock_send:
            response = self.client.post('/api/auth/password/forgot', json={
                'email': 'jose@example.com',
            })
        self.assertEqual(response.status_code, 202)
        mock_send.assert_called_once()

    def test_admin_cannot_create_user_with_resident_email(self):
        """Admin creating a user should fail if email exists in resident_accounts."""
        resident = self._create_roster_resident()
        account = ResidentAccount(
            resident_id=resident.id,
            email='resident@example.com',
            password_hash=generate_password_hash('Secret123!'),
            is_active=True,
        )
        db.session.add(account)
        db.session.commit()

        # Try to create user with same email
        response = self.client.post('/api/users', headers=self._staff_headers(), json={
            'name': 'New Admin',
            'email': 'resident@example.com',
            'role': 'admin',
        })
        self.assertEqual(response.status_code, 409)

    def test_check_email_endpoint_checks_both_tables(self):
        """Check email endpoint should check both users and resident_accounts."""
        resident = self._create_roster_resident()
        account = ResidentAccount(
            resident_id=resident.id,
            email='check@example.com',
            password_hash=generate_password_hash('Secret123!'),
            is_active=True,
        )
        db.session.add(account)
        db.session.commit()

        response = self.client.get('/api/users/check-email?email=check@example.com', headers=self._staff_headers())
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()['exists'])

    def test_approval_prevents_inactive_resident_account_conflict(self):
        """Inactive resident account for a DIFFERENT resident with same email should not block new registration."""
        resident = self._create_roster_resident()

        # Create a DIFFERENT resident with an INACTIVE account using the same email
        other_resident = self._create_roster_resident(
            first_name='Maria',
            last_name='Santos',
            contact_number='09191234567',
        )
        inactive_account = ResidentAccount(
            resident_id=other_resident.id,
            email='jose@example.com',  # Same email as the registration
            password_hash=generate_password_hash('Secret123!'),
            is_active=False,
        )
        db.session.add(inactive_account)
        db.session.commit()

        self._submit(email='jose@example.com')
        registration = ResidentRegistrationRequest.query.one()

        # Should succeed because existing account is inactive and for a different resident
        with patch('routes.resident_registrations.send_resident_registration_email'):
            response = self.client.post(
                f'/api/resident-registrations/{registration.id}/approve',
                headers=self._staff_headers(),
                json={'matched_resident_id': resident.id},
            )
        self.assertEqual(response.status_code, 200)



    def test_registration_matching_normalized_schema(self):
        """Registration matching correctly reads barangay, address, contact via family relation."""
        resident = self._create_roster_resident(
            first_name='Maria',
            middle_name='Santos',
            last_name='Reyes',
            household_head_name='Maria Santos Reyes',
            barangay='Santa Cruz',
            address='Sitio Ilaya',
            contact_number='09191112233',
            date_of_birth=date(1995, 8, 20),
        )

        # Confirm resident has no household columns stored directly in table, but accesses them via properties/family
        self.assertEqual(resident.barangay, 'Santa Cruz')
        self.assertEqual(resident.address, 'Sitio Ilaya')
        self.assertEqual(resident.contact_number, '09191112233')

        # Submit registration request
        res = self._submit(
            first_name='Maria',
            middle_name='Santos',
            last_name='Reyes',
            birthdate='1995-08-20',
            barangay='Santa Cruz',
            address='Sitio Ilaya',
            contact_number='09191112233',
            email='maria.reyes@example.com',
        )
        self.assertEqual(res.status_code, 201)
        req_id = res.get_json()['registration']['id']

        # Query matches as staff
        matches_res = self.client.get(
            f'/api/resident-registrations/{req_id}/matches',
            headers=self._staff_headers(),
        )
        self.assertEqual(matches_res.status_code, 200)
        data = matches_res.get_json()
        self.assertEqual(data['status'], 'match')
        self.assertTrue(len(data['matches']) >= 1)
        top_match = data['matches'][0]
        self.assertEqual(top_match['resident']['id'], resident.id)
        self.assertEqual(top_match['resident']['barangay'], 'Santa Cruz')
        self.assertEqual(top_match['resident']['address'], 'Sitio Ilaya')
        self.assertEqual(top_match['resident']['contact_number'], '09191112233')
        self.assertTrue(top_match['match_flags']['name'])
        self.assertTrue(top_match['match_flags']['birthdate'])
        self.assertTrue(top_match['match_flags']['barangay'])

    def test_family_member_count_on_add_move_remove(self):
        """Verify member_count stays strictly accurate when residents are added, moved via existing move route, and removed."""
        brgy = Barangay(name='Poblacion')
        ry = RosterYear(year=2025, is_active=True)
        db.session.add_all([brgy, ry])
        db.session.flush()

        with db.engine.begin() as conn:
            conn.execute(text("INSERT INTO evacuation_centers (id, name, capacity, is_active) VALUES (1, 'Test Center', 100, 1)"))

        room1 = EvacuationCenterRoom(id=1, evacuation_center_id=1, room_number='101', capacity=10, is_active=True)
        room2 = EvacuationCenterRoom(id=2, evacuation_center_id=1, room_number='102', capacity=10, is_active=True)
        db.session.add_all([room1, room2])
        db.session.flush()

        fam_a = Family(
            roster_year_id=ry.id,
            barangay_id=brgy.id,
            family_code='FAM-A',
            head_name='Juan Dela Cruz',
            member_count=1,
            contact_number='09181111111',
            address='Zone 1',
        )
        db.session.add(fam_a)
        db.session.flush()

        head_a = Resident(family_id=fam_a.id, first_name='Juan', last_name='Dela Cruz', is_head_of_family=True)
        db.session.add(head_a)
        db.session.commit()

        self.assertEqual(fam_a.member_count, 1)

        with patch('routes.families._serialize_family_detail', return_value={}):
            # 1. Add resident to Family A
            add_res = self.client.post(
                f'/api/families/{fam_a.id}/members',
                headers=self._staff_headers(),
                json={
                    'first_name': 'Ana',
                    'last_name': 'Dela Cruz',
                    'relationship_to_head': 'Spouse',
                    'is_head_of_family': False,
                }
            )
            self.assertEqual(add_res.status_code, 201)
            ana_id = add_res.get_json()['member']['id']

            db.session.refresh(fam_a)
            self.assertEqual(fam_a.member_count, 2)
            self.assertEqual(Resident.query.filter_by(family_id=fam_a.id).count(), 2)

            # Assign family to Room 1
            assign1 = EvacuationAssignment(resident_id=head_a.id, room_id=room1.id, evacuation_center_id=1)
            assign2 = EvacuationAssignment(resident_id=ana_id, room_id=room1.id, evacuation_center_id=1)
            db.session.add_all([assign1, assign2])
            db.session.commit()

            # 2. Move Family A to Room 2 using existing route POST /api/families/<id>/move
            move_res = self.client.post(
                f'/api/families/{fam_a.id}/move',
                headers=self._staff_headers(),
                json={
                    'room_id': room2.id,
                    'center_id': 1,
                }
            )
            self.assertEqual(move_res.status_code, 200)

            db.session.refresh(fam_a)
            # member_count must remain strictly accurate (2) after room move
            self.assertEqual(fam_a.member_count, 2)
            self.assertEqual(Resident.query.filter_by(family_id=fam_a.id).count(), 2)

            # 3. Remove resident (Ana) from Family A
            del_res = self.client.delete(
                f'/api/families/{fam_a.id}/members/{ana_id}',
                headers=self._staff_headers(),
            )
            self.assertEqual(del_res.status_code, 200)

            db.session.refresh(fam_a)
            self.assertEqual(fam_a.member_count, 1)
            self.assertEqual(Resident.query.filter_by(family_id=fam_a.id).count(), 1)

    def test_residents_query_count_constant_with_joinedload(self):
        """Verify GET /api/residents executes a fixed 3 queries (joinedload) regardless of roster size."""
        brgy = Barangay(name='Query Test Barangay')
        ry = RosterYear(year=2024, is_active=True)
        db.session.add_all([brgy, ry])
        db.session.flush()

        # Seed 10 families and 30 residents
        for f_idx in range(10):
            fam = Family(
                roster_year_id=ry.id,
                barangay_id=brgy.id,
                family_code=f'QFAM-{f_idx}',
                head_name=f'Head {f_idx}',
                member_count=3,
                contact_number='09170000000',
                address=f'Purok {f_idx}',
            )
            db.session.add(fam)
            db.session.flush()
            for r_idx in range(3):
                res = Resident(
                    family_id=fam.id,
                    first_name=f'First{f_idx}_{r_idx}',
                    last_name=f'Last{f_idx}',
                    is_head_of_family=(r_idx == 0),
                )
                db.session.add(res)
        db.session.commit()

        # Measure query count during GET /api/residents
        queries = []
        from sqlalchemy import event
        def before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
            queries.append(statement)

        event.listen(db.engine, 'before_cursor_execute', before_cursor_execute)
        try:
            res = self.client.get('/api/residents', headers=self._staff_headers())
            self.assertEqual(res.status_code, 200)
            items = res.get_json()
            self.assertTrue(len(items) >= 30)
            # Must be exactly 3 queries: (1) joined residents+family+barangay+roster_year, (2) User.resident_id, (3) ResidentAccount.resident_id
            self.assertEqual(len(queries), 3)
        finally:
            event.remove(db.engine, 'before_cursor_execute', before_cursor_execute)

if __name__ == '__main__':
    unittest.main()

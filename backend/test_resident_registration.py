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
    RegistrationLinkOverrideLog,
    ResidentAccount,
    ResidentLookupLog,
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
from routes.auth import _login_rate_buckets, auth_bp
from routes.families import families_bp
from routes.evacuation_centers import centers_bp
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
            LOGIN_MAX_FAILED_ATTEMPTS=5,
            LOGIN_FAILURE_WINDOW_MINUTES=15,
            LOGIN_LOCK_MINUTES=15,
            LOGIN_RATE_LIMIT_MAX_REQUESTS=20,
            LOGIN_RATE_LIMIT_WINDOW_SECONDS=900,
        )
        db.init_app(cls.app)
        JWTManager(cls.app)
        cls.app.register_blueprint(auth_bp)
        cls.app.register_blueprint(barangays_bp)
        cls.app.register_blueprint(residents_bp)
        cls.app.register_blueprint(registrations_bp)
        cls.app.register_blueprint(users_bp)
        cls.app.register_blueprint(families_bp)
        cls.app.register_blueprint(centers_bp)
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
            ResidentLookupLog.__table__,
            ResidentRegistrationRequest.__table__,
            RegistrationLinkOverrideLog.__table__,
            StaffNotification.__table__,
            SystemLog.__table__,
        ])
        with db.engine.begin() as connection:
            connection.execute(text(
                'CREATE TABLE barangays (id INTEGER PRIMARY KEY, name VARCHAR(100) NOT NULL, population INTEGER, geom BLOB)'
            ))
            connection.execute(text(
                'CREATE TABLE evacuation_centers (id INTEGER PRIMARY KEY, name VARCHAR(100) NOT NULL, capacity INTEGER, building_material VARCHAR(50), building_material_id INTEGER, hazard_exposure_score FLOAT, contact_number VARCHAR(20), is_active BOOLEAN DEFAULT 1, center_type VARCHAR(50), center_type_id INTEGER, owner_name VARCHAR(150), evacuation_open_date DATE, evacuation_open_time VARCHAR(10) DEFAULT \'08:00\', evacuation_cutoff_date DATE, evacuation_cutoff_time VARCHAR(10) DEFAULT \'18:00\', evacuation_extension_count INTEGER DEFAULT 0, evacuation_extended_until DATETIME, evacuation_status VARCHAR(30) DEFAULT \'standby\', evacuation_event_name VARCHAR(150), max_rooms INTEGER, geom BLOB, entrance_geom BLOB, managed_by INTEGER, created_at DATETIME)'
            ))
            connection.execute(text(
                'CREATE TABLE evacuation_operations (id INTEGER PRIMARY KEY, center_id INTEGER, event_name VARCHAR(255) NOT NULL, open_date DATE, open_time VARCHAR(10) DEFAULT \'08:00\', cutoff_date DATE, cutoff_time VARCHAR(10) DEFAULT \'18:00\', status VARCHAR(30) DEFAULT \'active\', extension_count INTEGER DEFAULT 0, extended_until DATETIME, created_by_user_id INTEGER, created_at DATETIME, concluded_at DATETIME)'
            ))
            connection.execute(text(
                'CREATE TABLE evacuation_check_in_records (id INTEGER PRIMARY KEY, operation_id INTEGER NOT NULL, resident_id INTEGER NOT NULL, family_id INTEGER, center_id INTEGER NOT NULL, room_id INTEGER, checked_in_at DATETIME, checked_in_by_user_id INTEGER, method VARCHAR(30) DEFAULT \'manual\', status VARCHAR(20) DEFAULT \'checked_in\', checked_out_at DATETIME)'
            ))

    @classmethod
    def tearDownClass(cls):
        db.session.remove()
        db.engine.dispose()
        cls.app_context.pop()

    def setUp(self):
        db.session.remove()
        RegistrationLinkOverrideLog.query.delete(synchronize_session=False)
        ResidentLookupLog.query.delete(synchronize_session=False)
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
        _login_rate_buckets.clear()
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
            additional_claims={'role': role, 'name': user.name, 'account_type': 'user', 'mfa_verified': role == 'admin', 'mfa_version': 0},
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
            'privacy_consent': True,
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

    def test_registration_requires_and_records_privacy_consent(self):
        rejected = self._submit(privacy_consent=False)
        self.assertEqual(rejected.status_code, 400)
        self.assertEqual(
            rejected.get_json()['error'],
            'Consent to the Data Privacy Notice is required.',
        )
        self.assertEqual(ResidentRegistrationRequest.query.count(), 0)

        missing_payload = self._payload()
        missing_payload.pop('privacy_consent')
        missing = self.client.post(
            '/api/resident-registrations',
            json=missing_payload,
        )
        self.assertEqual(missing.status_code, 400)
        self.assertEqual(
            missing.get_json()['error'],
            'Consent to the Data Privacy Notice is required.',
        )
        self.assertEqual(ResidentRegistrationRequest.query.count(), 0)

        accepted = self._submit()
        self.assertEqual(accepted.status_code, 201, accepted.get_json())
        registration = ResidentRegistrationRequest.query.one()
        self.assertTrue(registration.privacy_consent)
        self.assertIsNotNone(registration.privacy_consent_at)
        self.assertEqual(registration.privacy_notice_version, '1')

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

        login = self.client.post('/api/auth/resident-login', json={
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
        resident = self._create_roster_resident()
        self._submit(email='reason-required@example.com', contact_number='09171112233')
        req = ResidentRegistrationRequest.query.filter_by(email='reason-required@example.com').one()
        headers = self._staff_headers()
        with patch('routes.resident_registrations.send_resident_registration_email') as send_email:
            empty_res = self.client.post(
                f'/api/resident-registrations/{req.id}/reject',
                headers=headers,
                json={},
            )
        self.assertEqual(empty_res.status_code, 400, empty_res.get_json())
        self.assertEqual(req.status, 'pending')
        send_email.assert_not_called()

        with patch('routes.resident_registrations.send_resident_registration_email') as send_email:
            rejected = self.client.post(
                f'/api/resident-registrations/{req.id}/reject',
                headers=headers,
                json={'reason': 'Please verify your details.'},
            )
        self.assertEqual(rejected.status_code, 200, rejected.get_json())
        self.assertEqual(req.status, 'rejected')
        self.assertEqual(req.rejection_reason, 'Please verify your details.')
        send_email.assert_called_once()


    def test_resident_login_statuses_require_the_correct_password(self):
        self._submit()
        pending = self.client.post('/api/auth/resident-login', json={
            'email': 'jose@example.com', 'password': 'wrong-password',
        })
        self.assertEqual(pending.status_code, 401)
        self.assertEqual(pending.get_json(), {'error': 'Incorrect email or password'})
        pending = self.client.post('/api/auth/resident-login', json={
            'email': 'jose@example.com', 'password': 'Secret123!',
        })
        self.assertEqual(pending.status_code, 403)
        self.assertEqual(pending.get_json()['status'], 'awaiting_verification')
        self.assertEqual(pending.get_json()['error'], 'Awaiting verification.')

        registration = ResidentRegistrationRequest.query.filter_by(email='jose@example.com').one()
        registration.status = 'rejected'
        registration.rejection_reason = 'Please verify your details.'
        db.session.commit()
        rejected_wrong_password = self.client.post('/api/auth/resident-login', json={
            'email': 'jose@example.com', 'password': 'wrong-password',
        })
        self.assertEqual(rejected_wrong_password.status_code, 401)
        self.assertEqual(rejected_wrong_password.get_json(), {'error': 'Incorrect email or password'})
        rejected = self.client.post('/api/auth/resident-login', json={
            'email': 'jose@example.com', 'password': 'Secret123!',
        })
        self.assertEqual(rejected.status_code, 403)
        self.assertEqual(rejected.get_json()['status'], 'rejected')
        self.assertEqual(
            rejected.get_json()['error'],
            'Your registration was rejected: Please verify your details.',
        )

        resident = self._create_roster_resident(first_name='Inactive', last_name='Resident')
        inactive = ResidentAccount(
            resident_id=resident.id,
            email='inactive@example.com',
            password_hash=generate_password_hash('Secret123!'),
            is_active=False,
        )
        db.session.add(inactive)
        db.session.commit()
        inactive_wrong_password = self.client.post('/api/auth/resident-login', json={
            'email': inactive.email, 'password': 'wrong-password',
        })
        self.assertEqual(inactive_wrong_password.status_code, 401)
        self.assertEqual(inactive_wrong_password.get_json(), {'error': 'Incorrect email or password'})
        inactive_correct_password = self.client.post('/api/auth/resident-login', json={
            'email': inactive.email, 'password': 'Secret123!',
        })
        self.assertEqual(inactive_correct_password.status_code, 403)
        self.assertEqual(inactive_correct_password.get_json()['error'], 'Your account is inactive.')


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
        login = self.client.post('/api/auth/resident-login', json={
            'email': 'jose@example.com',
            'password': 'Secret123!',
        })
        self.assertEqual(login.status_code, 200)
        data = login.get_json()
        self.assertEqual(data['user']['role'], 'resident')
        self.assertEqual(data['user']['resident_id'], resident.id)
        self.assertIn('access_token', data)

    def test_login_forms_reject_the_other_account_type_with_the_same_error(self):
        resident = self._create_roster_resident()
        self._create_resident_account(resident.id, 'jose@example.com')

        resident_on_staff_form = self.client.post('/api/auth/login', json={
            'email': 'jose@example.com', 'password': 'Secret123!',
        })
        wrong_staff_password = self.client.post('/api/auth/login', json={
            'email': 'jose@example.com', 'password': 'wrong-password',
        })
        self.assertEqual(resident_on_staff_form.status_code, 401)
        self.assertEqual(resident_on_staff_form.get_json(), {'error': 'Incorrect email or password'})
        self.assertEqual(resident_on_staff_form.get_json(), wrong_staff_password.get_json())
        self.assertEqual(resident_on_staff_form.status_code, wrong_staff_password.status_code)

        staff_on_resident_form = self.client.post('/api/auth/resident-login', json={
            'email': self.staff['user'].email, 'password': 'Secret123!',
        })
        wrong_resident_password = self.client.post('/api/auth/resident-login', json={
            'email': self.staff['user'].email, 'password': 'wrong-password',
        })
        self.assertEqual(staff_on_resident_form.status_code, 401)
        self.assertEqual(staff_on_resident_form.get_json(), {'error': 'Incorrect email or password'})
        self.assertEqual(staff_on_resident_form.get_json(), wrong_resident_password.get_json())
        self.assertEqual(staff_on_resident_form.status_code, wrong_resident_password.status_code)

        staff_login = self.client.post('/api/auth/login', json={
            'email': self.staff['user'].email, 'password': 'Secret123!',
        })
        self.assertEqual(staff_login.status_code, 200)
        self.assertTrue(staff_login.get_json()['totp_enrollment_required'])
        lgu_login = self.client.post('/api/auth/login', json={
            'email': self.lgu['user'].email, 'password': 'Secret123!',
        })
        self.assertEqual(lgu_login.status_code, 200)
        self.assertEqual(lgu_login.get_json()['user']['role'], 'lgu_personnel')

    def test_resident_login_token_cannot_access_staff_routes_after_role_claim_edit(self):
        resident = self._create_roster_resident()
        account = self._create_resident_account(resident.id, 'jose@example.com')['account']
        login = self.client.post('/api/auth/resident-login', json={
            'email': account.email, 'password': 'Secret123!',
        })
        self.assertEqual(login.status_code, 200)
        resident_token = login.get_json()['access_token']
        edited_role_token = create_access_token(
            identity=str(account.id),
            additional_claims={
                'role': 'admin',
                'account_type': 'resident_account',
                'resident_id': resident.id,
            },
        )

        for token in (resident_token, edited_role_token):
            headers = {'Authorization': f'Bearer {token}'}
            for path in ('/api/users', '/api/families', '/api/residents'):
                with self.subTest(path=path, edited_role=token == edited_role_token):
                    response = self.client.get(path, headers=headers)
                    self.assertEqual(response.status_code, 403, response.get_data(as_text=True))

    def test_automatic_check_in_requires_resident_and_uses_own_identity(self):
        resident = self._create_roster_resident()
        account = self._create_resident_account(resident.id, 'jose@example.com')['account']
        login = self.client.post('/api/auth/resident-login', json={
            'email': account.email, 'password': 'Secret123!',
        })
        headers = {'Authorization': f"Bearer {login.get_json()['access_token']}"}

        guest = self.client.post('/api/evacuation-centers/check-in/auto', json={})
        self.assertEqual(guest.status_code, 401)
        forged_target = self.client.post(
            '/api/evacuation-centers/check-in/auto',
            headers=headers,
            json={'resident_id': resident.id + 100, 'center_id': 1},
        )
        self.assertEqual(forged_target.status_code, 403)

    def test_both_login_endpoints_rate_limit_by_ip_and_email(self):
        resident = self._create_roster_resident()
        self._create_resident_account(resident.id, 'jose@example.com')
        self.app.config['LOGIN_RATE_LIMIT_MAX_REQUESTS'] = 1

        cases = (
            ('/api/auth/login', self.staff['user'].email),
            ('/api/auth/resident-login', 'jose@example.com'),
        )
        for endpoint, email in cases:
            with self.subTest(endpoint=endpoint):
                _login_rate_buckets.clear()
                first = self.client.post(endpoint, json={'email': email, 'password': 'wrong'})
                second = self.client.post(endpoint, json={'email': email, 'password': 'wrong'})
                self.assertEqual(first.status_code, 401)
                self.assertEqual(second.status_code, 429)
        self.app.config['LOGIN_RATE_LIMIT_MAX_REQUESTS'] = 20

    def test_repeated_failures_lock_staff_and_resident_accounts_and_log_for_admins(self):
        resident = self._create_roster_resident()
        resident_account = self._create_resident_account(resident.id, 'jose@example.com')['account']
        cases = (
            ('/api/auth/login', self.staff['user']),
            ('/api/auth/resident-login', resident_account),
        )
        self.app.config.update(
            LOGIN_MAX_FAILED_ATTEMPTS=5,
            LOGIN_FAILURE_WINDOW_MINUTES=15,
            LOGIN_LOCK_MINUTES=15,
        )

        for endpoint, account in cases:
            with self.subTest(endpoint=endpoint):
                _login_rate_buckets.clear()
                for _ in range(5):
                    response = self.client.post(endpoint, json={
                        'email': account.email, 'password': 'wrong-password',
                    })
                    self.assertEqual(response.status_code, 401)
                    self.assertEqual(response.get_json(), {'error': 'Incorrect email or password'})
                db.session.refresh(account)
                self.assertEqual(account.login_failed_attempts, 5)
                self.assertIsNotNone(account.login_locked_until)
                locked_login = self.client.post(endpoint, json={
                    'email': account.email, 'password': 'Secret123!',
                })
                self.assertEqual(locked_login.status_code, 401)
                self.assertEqual(locked_login.get_json(), {'error': 'Incorrect email or password'})

        admin_logs = self.client.get('/api/logs', headers=self._staff_headers())
        lock_entries = [entry for entry in admin_logs.get_json() if 'Login locked after repeated failures' in entry['action']]
        self.assertEqual(len(lock_entries), 2)

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

        login = self.client.post('/api/auth/resident-login', json={
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

        login = self.client.post('/api/auth/resident-login', json={
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

    def test_send_resident_reset_password_email_single_use_and_logged(self):
        resident = self._create_roster_resident()
        self._submit(email='gesulga63@gmail.com')
        registration = ResidentRegistrationRequest.query.one()

        # Pending request cannot send reset email
        pending_res = self.client.post(
            f'/api/resident-registrations/{registration.id}/reset-password',
            headers=self._staff_headers(),
        )
        self.assertEqual(pending_res.status_code, 409)

        # Resident role cannot access endpoint
        res_forbidden = self.client.post(
            f'/api/resident-registrations/{registration.id}/reset-password',
            headers=self._resident_headers(),
        )
        self.assertEqual(res_forbidden.status_code, 403)

        # Approve registration
        with patch('routes.resident_registrations.send_resident_registration_email'):
            approve_res = self.client.post(
                f'/api/resident-registrations/{registration.id}/approve',
                headers=self._staff_headers(),
                json={'matched_resident_id': resident.id},
            )
        self.assertEqual(approve_res.status_code, 200)
        self.assertTrue(approve_res.get_json()['request']['has_account'])

        # List returns has_account=True for approved request with active account
        list_res = self.client.get(
            '/api/resident-registrations?status=approved',
            headers=self._staff_headers(),
        )
        self.assertEqual(list_res.status_code, 200)
        self.assertTrue(list_res.get_json()['requests'][0]['has_account'])
        self.assertEqual(list_res.get_json()['requests'][0]['account_email'], 'gesulga63@gmail.com')

        # SMTP failure keeps logs clean and returns 503
        with patch(
            'routes.resident_registrations.send_password_setup_email',
            side_effect=RuntimeError('SMTP down'),
        ):
            fail_res = self.client.post(
                f'/api/resident-registrations/{registration.id}/reset-password',
                headers=self._staff_headers(),
            )
        self.assertEqual(fail_res.status_code, 503)
        self.assertEqual(
            SystemLog.query.filter(SystemLog.action.ilike('%reset email%')).count(),
            0,
        )

        # Successful send logs in Activity Logs, reveals no password/token, and token is single-use
        captured_tokens = []
        with patch('routes.resident_registrations.send_password_setup_email') as mock_send:
            def capture(acct, tok, purpose='reset'):
                captured_tokens.append((acct.email, tok, purpose))
            mock_send.side_effect = capture

            ok_res = self.client.post(
                f'/api/resident-registrations/{registration.id}/reset-password',
                headers=self._staff_headers(),
            )
        self.assertEqual(ok_res.status_code, 200, ok_res.get_json())
        body = ok_res.get_json()
        self.assertEqual(body['message'], 'Reset link sent to gesulga63@gmail.com')
        self.assertNotIn('password', body)
        self.assertNotIn('password_hash', body)
        self.assertNotIn('token', body)
        self.assertEqual(len(captured_tokens), 1)
        self.assertEqual(captured_tokens[0][0], 'gesulga63@gmail.com')
        self.assertEqual(captured_tokens[0][2], 'reset')

        log_entry = SystemLog.query.filter(SystemLog.action.ilike('%password reset email%')).one()
        self.assertEqual(log_entry.user_id, self.staff['user'].id)
        self.assertIn('gesulga63@gmail.com', log_entry.action)
        self.assertIsNotNone(log_entry.timestamp)

        reset_token = captured_tokens[0][1]
        # First use succeeds
        setup_res = self.client.post('/api/auth/password/setup', json={
            'token': reset_token,
            'password': 'NewPassword123!',
        })
        self.assertEqual(setup_res.status_code, 200, setup_res.get_json())

        # Second use fails because link is single-use
        reuse_res = self.client.post('/api/auth/password/setup', json={
            'token': reset_token,
            'password': 'AnotherPassword123!',
        })
        self.assertEqual(reuse_res.status_code, 400, reuse_res.get_json())

        # New password works for login
        login_res = self.client.post('/api/auth/resident-login', json={
            'email': 'gesulga63@gmail.com',
            'password': 'NewPassword123!',
        })
        self.assertEqual(login_res.status_code, 200)

    def test_birthdate_must_be_past_date_across_registration_and_roster(self):
        from models import philippines_now
        today_iso = philippines_now().date().isoformat()

        # 1. Public registration rejects today's date
        today_res = self._submit(birthdate=today_iso)
        self.assertEqual(today_res.status_code, 400)
        self.assertIn('past date', today_res.get_json()['error'].lower())

        # 2. Staff edit registration rejects today's date
        ok_submit = self._submit(birthdate='1990-04-12')
        self.assertEqual(ok_submit.status_code, 201)
        req_id = ok_submit.get_json()['registration']['id']
        patch_res = self.client.patch(
            f'/api/resident-registrations/{req_id}',
            headers=self._staff_headers(),
            json={'birthdate': today_iso},
        )
        self.assertEqual(patch_res.status_code, 400)
        self.assertIn('past date', patch_res.get_json()['error'].lower())

        # 3. Manual create rejects missing or today birthdate for roster resident
        resident_today = self._create_roster_resident(
            first_name='Today',
            last_name='Tester',
            date_of_birth=philippines_now().date(),
        )
        manual_today = self.client.post(
            '/api/resident-registrations/manual-create',
            headers=self._staff_headers(),
            json={
                'resident_id': resident_today.id,
                'email': 'manual.today@example.com',
                'password': 'Password123',
                'send_email': False,
            },
        )
        self.assertEqual(manual_today.status_code, 400)

        # 4. Roster family member add/update rejects today's date
        family_id = resident_today.family_id
        add_member = self.client.post(
            f'/api/families/{family_id}/members',
            headers=self._staff_headers(),
            json={
                'first_name': 'Baby',
                'last_name': 'Tester',
                'date_of_birth': today_iso,
            },
        )
        self.assertEqual(add_member.status_code, 400)
        self.assertIn('past date', add_member.get_json()['error'].lower())

    def test_approval_blocks_link_unless_name_and_barangay_match(self):
        # Same barangay, different name -> blocked
        wrong_name = self._create_roster_resident(
            first_name='Pedro',
            middle_name='Lopez',
            last_name='Garcia',
            barangay='San Jose',
        )
        # Same name, different barangay -> blocked
        wrong_barangay = self._create_roster_resident(
            first_name='Jose',
            middle_name='Manuel',
            last_name='Dela Cruz',
            barangay='Poblacion',
        )
        # Same name and barangay, different birthdate/address/contact -> allowed
        name_and_brgy_match = self._create_roster_resident(
            first_name='Jose',
            middle_name='Manuel',
            last_name='Dela Cruz',
            barangay='San Jose',
            date_of_birth=date(1985, 1, 1),
            address='Purok 9',
            contact_number='09998887777',
        )

        self.assertEqual(self._submit().status_code, 201)
        registration = ResidentRegistrationRequest.query.one()
        headers = self._staff_headers()

        # Mismatched name -> 400
        res_name = self.client.post(
            f'/api/resident-registrations/{registration.id}/approve',
            headers=headers,
            json={'matched_resident_id': wrong_name.id},
        )
        self.assertEqual(res_name.status_code, 400)
        self.assertIn('name', res_name.get_json()['error'].lower())
        self.assertEqual(registration.status, 'pending')

        # Mismatched barangay -> 400
        res_brgy = self.client.post(
            f'/api/resident-registrations/{registration.id}/approve',
            headers=headers,
            json={'matched_resident_id': wrong_barangay.id},
        )
        self.assertEqual(res_brgy.status_code, 400)
        self.assertIn('barangay', res_brgy.get_json()['error'].lower())
        self.assertEqual(registration.status, 'pending')

        # Mismatched both name and barangay -> 400
        wrong_both = self._create_roster_resident(
            first_name='Ana',
            middle_name='Cruz',
            last_name='Santos',
            barangay='Santa Cruz',
        )
        res_both = self.client.post(
            f'/api/resident-registrations/{registration.id}/approve',
            headers=headers,
            json={'matched_resident_id': wrong_both.id},
        )
        self.assertEqual(res_both.status_code, 400)
        err_both = res_both.get_json()['error'].lower()
        self.assertIn('name', err_both)
        self.assertIn('barangay', err_both)
        self.assertEqual(ResidentAccount.query.count(), 0)

        # Matching name and barangay -> 200
        with patch('routes.resident_registrations.send_resident_registration_email'):
            res_ok = self.client.post(
                f'/api/resident-registrations/{registration.id}/approve',
                headers=headers,
                json={'matched_resident_id': name_and_brgy_match.id},
            )
        self.assertEqual(res_ok.status_code, 200, res_ok.get_json())
        self.assertEqual(registration.status, 'approved')
        self.assertEqual(registration.matched_resident_id, name_and_brgy_match.id)
        self.assertEqual(RegistrationLinkOverrideLog.query.count(), 0)

    def test_admin_override_for_mismatched_link_requires_reason_and_logs(self):
        mismatched = self._create_roster_resident(
            first_name='Pedro',
            middle_name='Lopez',
            last_name='Garcia',
            barangay='Poblacion',
        )
        self.assertEqual(self._submit().status_code, 201)
        registration = ResidentRegistrationRequest.query.one()

        # LGU personnel cannot override even with a reason -> 403
        lgu_res = self.client.post(
            f'/api/resident-registrations/{registration.id}/approve',
            headers=self.lgu['headers'],
            json={
                'matched_resident_id': mismatched.id,
                'override_reason': 'Verified in person at barangay hall',
            },
        )
        self.assertEqual(lgu_res.status_code, 403)
        self.assertIn('admin', lgu_res.get_json()['error'].lower())
        self.assertEqual(registration.status, 'pending')
        self.assertEqual(RegistrationLinkOverrideLog.query.count(), 0)

        # Admin with blank/whitespace override reason -> 400
        blank_res = self.client.post(
            f'/api/resident-registrations/{registration.id}/approve',
            headers=self._staff_headers(),
            json={
                'matched_resident_id': mismatched.id,
                'override_reason': '   ',
            },
        )
        self.assertEqual(blank_res.status_code, 400)
        self.assertIn('override reason', blank_res.get_json()['error'].lower())
        self.assertEqual(RegistrationLinkOverrideLog.query.count(), 0)

        # Admin with typed override reason -> 200 and logged
        reason_text = 'Verified via barangay ID; maiden name listed on roster'
        with patch('routes.resident_registrations.send_resident_registration_email'):
            ok_res = self.client.post(
                f'/api/resident-registrations/{registration.id}/approve',
                headers=self._staff_headers(),
                json={
                    'matched_resident_id': mismatched.id,
                    'override_reason': reason_text,
                },
            )
        self.assertEqual(ok_res.status_code, 200, ok_res.get_json())
        self.assertEqual(registration.status, 'approved')
        self.assertEqual(registration.matched_resident_id, mismatched.id)

        log = RegistrationLinkOverrideLog.query.one()
        self.assertEqual(log.admin_id, self.staff['user'].id)
        self.assertEqual(log.request_id, registration.id)
        self.assertEqual(log.roster_id, mismatched.id)
        self.assertEqual(log.reason, reason_text)
        self.assertIsNotNone(log.timestamp)

    def test_admin_unlink_removes_link_inherited_center_room_and_logs(self):
        resident = self._create_roster_resident()
        with db.engine.begin() as conn:
            conn.execute(text(
                "INSERT OR REPLACE INTO evacuation_centers (id, name, capacity, is_active) "
                "VALUES (10, 'Sogod Gym', 100, 1)"
            ))
        room = EvacuationCenterRoom(
            id=10,
            evacuation_center_id=10,
            room_number='Room 101',
            capacity=10,
            is_active=True,
        )
        assignment = EvacuationAssignment(
            resident_id=resident.id,
            evacuation_center_id=10,
            room_id=10,
        )
        db.session.add_all([room, assignment])
        db.session.commit()

        # Submit & approve registration
        self.assertEqual(self._submit().status_code, 201)
        registration = ResidentRegistrationRequest.query.one()
        with patch('routes.resident_registrations.send_resident_registration_email'):
            approve_res = self.client.post(
                f'/api/resident-registrations/{registration.id}/approve',
                headers=self._staff_headers(),
                json={'matched_resident_id': resident.id},
            )
        self.assertEqual(approve_res.status_code, 200)

        # Linked resident account logs in and inherits the roster family's center & room
        login_res = self.client.post('/api/auth/resident-login', json={
            'email': 'jose@example.com',
            'password': 'Secret123!',
        })
        self.assertEqual(login_res.status_code, 200)
        resident_token = login_res.get_json()['access_token']
        res_headers = {'Authorization': f'Bearer {resident_token}'}

        before_center = self.client.get('/api/residents/my-center', headers=res_headers)
        self.assertEqual(before_center.status_code, 200)
        self.assertEqual(before_center.get_json()['center_name'], 'Sogod Gym')
        self.assertEqual(before_center.get_json()['room']['room_number'], 'Room 101')

        # Non-admin (lgu_personnel) cannot unlink -> 403
        lgu_unlink = self.client.post(
            f'/api/resident-registrations/{registration.id}/unlink',
            headers=self.lgu['headers'],
        )
        self.assertEqual(lgu_unlink.status_code, 403)

        # Admin unlinks the registration
        unlink_res = self.client.post(
            f'/api/resident-registrations/{registration.id}/unlink',
            headers=self._staff_headers(),
        )
        self.assertEqual(unlink_res.status_code, 200, unlink_res.get_json())
        body = unlink_res.get_json()
        self.assertEqual(body['request']['status'], 'pending')
        self.assertIsNone(body['request']['matched_resident_id'])
        self.assertFalse(body['request']['has_account'])
        self.assertEqual(body['unlinked_resident_id'], resident.id)
        self.assertEqual(body['cleared_inherited_assignment']['center_name'], 'Sogod Gym')
        self.assertEqual(body['cleared_inherited_assignment']['room_number'], 'Room 101')

        # Registration is unlinked and linked ResidentAccount is removed
        db.session.refresh(registration)
        self.assertIsNone(registration.matched_resident_id)
        self.assertEqual(registration.status, 'pending')
        self.assertEqual(ResidentAccount.query.filter_by(resident_id=resident.id).count(), 0)

        # Previous resident token no longer inherits center/room, and login is awaiting verification
        after_center = self.client.get('/api/residents/my-center', headers=res_headers)
        self.assertEqual(after_center.status_code, 401)
        after_login = self.client.post('/api/auth/resident-login', json={
            'email': 'jose@example.com',
            'password': 'Secret123!',
        })
        self.assertEqual(after_login.status_code, 403)

        # Roster family's own EvacuationAssignment stays intact and resident is available again
        self.assertEqual(EvacuationAssignment.query.filter_by(resident_id=resident.id).count(), 1)
        matches = self.client.get(
            f'/api/resident-registrations/{registration.id}/matches',
            headers=self._staff_headers(),
        ).get_json()
        self.assertTrue(matches['matches'][0]['available'])

        # Action is logged in SystemLog
        unlink_log = SystemLog.query.filter(SystemLog.action.ilike('%Unlinked resident registration%')).one()
        self.assertEqual(unlink_log.user_id, self.staff['user'].id)
        self.assertIn(f'#{registration.id}', unlink_log.action)
        self.assertIn(f'#{resident.id}', unlink_log.action)
        self.assertIn('Sogod Gym', unlink_log.action)

        # Unlinking again when already unlinked returns 409
        repeat_unlink = self.client.post(
            f'/api/resident-registrations/{registration.id}/unlink',
            headers=self._staff_headers(),
        )
        self.assertEqual(repeat_unlink.status_code, 409)

    def test_manual_resident_create_uses_setup_link_flow_and_never_emails_password(self):
        resident = self._create_roster_resident()
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

        # Even if a client sends a password field, it is ignored and a setup link is sent instead
        with patch('services.mailer.smtplib.SMTP') as smtp:
            smtp_server = smtp.return_value.__enter__.return_value
            res = self.client.post(
                '/api/resident-registrations/manual-create',
                headers=self._staff_headers(),
                json={
                    'resident_id': resident.id,
                    'email': 'manual.setup@example.com',
                    'password': 'IgnoredPassword123!',
                },
            )
            self.assertEqual(res.status_code, 201, res.get_json())
            body = res.get_json()
            self.assertTrue(body['email_sent'])
            self.assertIn('password setup link', body['message'].lower())
            self.assertNotIn('password', body)

            sent_message = smtp_server.send_message.call_args.args[0]
            self.assertEqual(sent_message['Subject'], 'Set your EvacWay password')
            plain_body = sent_message.get_body(preferencelist=('plain',)).get_content()
            self.assertIn('/set-password?token=', plain_body)
            self.assertNotIn('IgnoredPassword123!', plain_body)

        # Ignored password must NOT log the user in
        bad_login = self.client.post('/api/auth/resident-login', json={
            'email': 'manual.setup@example.com',
            'password': 'IgnoredPassword123!',
        })
        self.assertEqual(bad_login.status_code, 401)

        # Extract token from setup email, complete setup, and log in
        import re as _re
        token_match = _re.search(r'/set-password\?token=([^\s]+)', plain_body)
        self.assertIsNotNone(token_match)
        token = token_match.group(1)

        setup_res = self.client.post('/api/auth/password/setup', json={
            'token': token,
            'password': 'ChosenPassword123!',
        })
        self.assertEqual(setup_res.status_code, 200, setup_res.get_json())

        good_login = self.client.post('/api/auth/resident-login', json={
            'email': 'manual.setup@example.com',
            'password': 'ChosenPassword123!',
        })
        self.assertEqual(good_login.status_code, 200)

if __name__ == '__main__':
    unittest.main()

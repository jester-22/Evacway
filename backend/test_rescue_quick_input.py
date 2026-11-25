import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token

from routes.rescue_requests import (
    ALLOWED_RESCUE_NEEDS,
    ALLOWED_VULNERABILITY_FLAGS,
    _parse_json_choices,
    _parse_people_count,
    _rescue_to_dict,
    rescue_bp,
)
from models import db


class RescueQuickInputTests(unittest.TestCase):
    def test_supported_quick_needs_are_accepted_and_deduplicated(self):
        values, error = _parse_json_choices(
            json.dumps(['Trapped', 'Flooding', 'Trapped']),
            ALLOWED_RESCUE_NEEDS,
            'Selected needs',
        )
        self.assertIsNone(error)
        self.assertEqual(values, ['Trapped', 'Flooding'])

    def test_unknown_needs_and_vulnerability_flags_are_rejected(self):
        values, error = _parse_json_choices(
            json.dumps(['Need money']), ALLOWED_RESCUE_NEEDS, 'Selected needs'
        )
        self.assertIsNone(values)
        self.assertIn('unsupported choice', error)

        values, error = _parse_json_choices(
            json.dumps(['VIP']), ALLOWED_VULNERABILITY_FLAGS, 'Vulnerability flags'
        )
        self.assertIsNone(values)
        self.assertIn('unsupported choice', error)

    def test_people_count_defaults_from_family_and_requires_a_whole_number(self):
        self.assertEqual(_parse_people_count(None, 5), (5, None))
        self.assertEqual(_parse_people_count('3', 5), (3, None))
        count, error = _parse_people_count('1.5', 5)
        self.assertIsNone(count)
        self.assertIn('whole number', error)
        count, error = _parse_people_count('0', 5)
        self.assertIsNone(count)
        self.assertIn('whole number', error)

    def test_staff_payload_includes_new_fields_and_legacy_rows_default_to_empty(self):
        base = {
            'id': 17,
            'description': '',
            'location_description': None,
            'latitude': 10.0,
            'longitude': 125.0,
            'accuracy': None,
            'is_manual_pin': False,
            'location_source': 'gps',
            'status': 'pending',
            'requester_name': 'Resident',
            'requester_contact': '',
            'proof_images': None,
            'created_at': None,
            'updated_at': None,
        }
        legacy = _rescue_to_dict(SimpleNamespace(**base, selected_needs=None, people_count=None, vulnerability_flags=None))
        self.assertEqual(legacy['selected_needs'], [])
        self.assertEqual(legacy['vulnerability_flags'], [])
        self.assertIsNone(legacy['people_count'])

        current = _rescue_to_dict(SimpleNamespace(
            **base,
            selected_needs='["Trapped"]',
            people_count=4,
            vulnerability_flags='["PWD", "Child"]',
        ))
        self.assertEqual(current['selected_needs'], ['Trapped'])
        self.assertEqual(current['people_count'], 4)
        self.assertEqual(current['vulnerability_flags'], ['PWD', 'Child'])


class RescueFormContextRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = Flask(__name__)
        cls.app.config.update(
            TESTING=True,
            SQLALCHEMY_DATABASE_URI='sqlite://',
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            JWT_SECRET_KEY='rescue-form-context-test-secret-key',
        )
        db.init_app(cls.app)
        JWTManager(cls.app)
        cls.app.register_blueprint(rescue_bp)
        cls.app_context = cls.app.app_context()
        cls.app_context.push()
        cls.client = cls.app.test_client()

    @classmethod
    def tearDownClass(cls):
        cls.app_context.pop()

    def test_resident_gets_only_their_own_form_prefill_values(self):
        token = create_access_token(
            identity='4',
            additional_claims={
                'role': 'resident',
                'account_type': 'resident_account',
                'resident_id': 9,
            },
        )
        account = SimpleNamespace(id=4, resident_id=9, is_active=True)
        resident = SimpleNamespace(
            family=SimpleNamespace(member_count=5),
            contact_number='09123456893',
        )
        with patch('routes.rescue_requests.db.session.get', side_effect=[account, resident]) as get_record:
            response = self.client.get(
                '/api/rescue-requests/form-context',
                headers={'Authorization': f'Bearer {token}'},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {
            'family_member_count': 5,
            'contact_number': '09123456893',
        })
        self.assertEqual(get_record.call_count, 2)

    def test_staff_cannot_read_resident_form_prefill_values(self):
        token = create_access_token(
            identity='2',
            additional_claims={'role': 'admin', 'account_type': 'user'},
        )
        with patch('routes.rescue_requests.db.session.get') as get_resident:
            response = self.client.get(
                '/api/rescue-requests/form-context',
                headers={'Authorization': f'Bearer {token}'},
            )
        self.assertEqual(response.status_code, 403)
        get_resident.assert_not_called()

    def test_open_rescue_status_excludes_only_resolved_and_closed(self):
        from models import RescueRequest, User
        from services.rescue_status import (
            count_open_rescue_requests,
            is_open_rescue_status,
            open_rescue_requests_query,
        )
        from werkzeug.security import generate_password_hash

        # Pure helper checks
        for open_status in ('pending', 'acknowledged', 'responding', 'open', None, ''):
            self.assertTrue(is_open_rescue_status(open_status), open_status)
        for closed_status in ('resolved', 'Resolved', 'closed', 'CLOSED', ' resolved '):
            self.assertFalse(is_open_rescue_status(closed_status), closed_status)

        # Shared DB query + GET /api/rescue-requests agree on exact open count
        db.metadata.create_all(bind=db.engine, tables=[User.__table__, RescueRequest.__table__])
        admin = User(
            name='Admin User',
            email='admin-rescue@example.com',
            password_hash=generate_password_hash('Secret123!'),
            role='admin',
            is_active=True,
        )
        db.session.add(admin)
        db.session.add_all([
            RescueRequest(description='Pending help', status='pending'),
            RescueRequest(description='Acknowledged help', status='acknowledged'),
            RescueRequest(description='Responding help', status='responding'),
            RescueRequest(description='Resolved help', status='resolved'),
            RescueRequest(description='Closed help', status='closed'),
        ])
        db.session.commit()

        self.assertEqual(count_open_rescue_requests(), 3)
        self.assertEqual(open_rescue_requests_query().count(), 3)

        admin_token = create_access_token(
            identity=str(admin.id),
            additional_claims={
                'role': 'admin',
                'account_type': 'user',
                'mfa_verified': True,
                'mfa_version': 0,
            },
        )
        headers = {'Authorization': f'Bearer {admin_token}'}

        all_res = self.client.get('/api/rescue-requests', headers=headers)
        self.assertEqual(all_res.status_code, 200)
        all_items = all_res.get_json()
        self.assertEqual(len(all_items), 5)
        self.assertEqual(sum(1 for item in all_items if item['is_open']), 3)

        open_res = self.client.get('/api/rescue-requests?status=open', headers=headers)
        self.assertEqual(open_res.status_code, 200)
        open_items = open_res.get_json()
        self.assertEqual(len(open_items), 3)
        self.assertEqual(
            {item['status'] for item in open_items},
            {'pending', 'acknowledged', 'responding'},
        )

    def test_overdue_threshold_and_handoff_agency_notes_update(self):
        from datetime import timedelta
        from models import RescueRequest, SystemLog, User, utc_now
        from services.rescue_status import (
            RESCUE_OVERDUE_THRESHOLD_HOURS,
            is_rescue_overdue,
        )
        from werkzeug.security import generate_password_hash

        self.assertEqual(RESCUE_OVERDUE_THRESHOLD_HOURS, 2)
        db.metadata.create_all(
            bind=db.engine,
            tables=[User.__table__, RescueRequest.__table__, SystemLog.__table__],
        )
        admin = User(
            name='Admin Dispatch',
            email='admin-dispatch@example.com',
            password_hash=generate_password_hash('Secret123!'),
            role='admin',
            is_active=True,
        )
        db.session.add(admin)

        now = utc_now()
        old_time = now - timedelta(hours=RESCUE_OVERDUE_THRESHOLD_HOURS + 1)
        fresh_time = now - timedelta(minutes=30)

        overdue_req = RescueRequest(
            description='Roof rescue needed',
            status='acknowledged',
            created_at=old_time,
            updated_at=old_time,
            status_updated_at=old_time,
        )
        fresh_req = RescueRequest(
            description='Recent request',
            status='pending',
            created_at=fresh_time,
            updated_at=fresh_time,
            status_updated_at=fresh_time,
        )
        resolved_old = RescueRequest(
            description='Already resolved',
            status='resolved',
            created_at=old_time,
            updated_at=old_time,
            status_updated_at=old_time,
        )
        db.session.add_all([overdue_req, fresh_req, resolved_old])
        db.session.commit()

        self.assertTrue(is_rescue_overdue(overdue_req, now=now))
        self.assertFalse(is_rescue_overdue(fresh_req, now=now))
        self.assertFalse(is_rescue_overdue(resolved_old, now=now))

        admin_token = create_access_token(
            identity=str(admin.id),
            additional_claims={
                'role': 'admin',
                'account_type': 'user',
                'mfa_verified': True,
                'mfa_version': 0,
            },
        )
        headers = {'Authorization': f'Bearer {admin_token}'}

        # Updating handed_to_agency & notes works without changing status and preserves status_updated_at
        patch_details = self.client.patch(
            f'/api/rescue-requests/{overdue_req.id}',
            headers=headers,
            json={
                'handed_to_agency': 'MDRRMO Sogod',
                'notes': 'Boat team dispatched via Barangay San Jose',
            },
        )
        self.assertEqual(patch_details.status_code, 200, patch_details.get_json())
        updated = patch_details.get_json()
        self.assertEqual(updated['handed_to_agency'], 'MDRRMO Sogod')
        self.assertEqual(updated['notes'], 'Boat team dispatched via Barangay San Jose')
        self.assertEqual(updated['status'], 'acknowledged')
        self.assertTrue(updated['is_overdue'])
        self.assertEqual(updated['overdue_threshold_hours'], RESCUE_OVERDUE_THRESHOLD_HOURS)

        # Advancing status resets status_updated_at so it is no longer overdue
        patch_status = self.client.patch(
            f'/api/rescue-requests/{overdue_req.id}',
            headers=headers,
            json={'status': 'responding'},
        )
        self.assertEqual(patch_status.status_code, 200, patch_status.get_json())
        advanced = patch_status.get_json()
        self.assertEqual(advanced['status'], 'responding')
        self.assertFalse(advanced['is_overdue'])
        self.assertEqual(advanced['handed_to_agency'], 'MDRRMO Sogod')
        self.assertEqual(advanced['notes'], 'Boat team dispatched via Barangay San Jose')

        # Reverting or reopening a misclicked status is allowed and logged
        patch_resolved = self.client.patch(
            f'/api/rescue-requests/{overdue_req.id}',
            headers=headers,
            json={'status': 'resolved'},
        )
        self.assertEqual(patch_resolved.status_code, 200, patch_resolved.get_json())
        self.assertEqual(patch_resolved.get_json()['status'], 'resolved')
        self.assertFalse(patch_resolved.get_json()['is_open'])

        patch_reopen = self.client.patch(
            f'/api/rescue-requests/{overdue_req.id}',
            headers=headers,
            json={'status': 'responding'},
        )
        self.assertEqual(patch_reopen.status_code, 200, patch_reopen.get_json())
        reopened = patch_reopen.get_json()
        self.assertEqual(reopened['status'], 'responding')
        self.assertTrue(reopened['is_open'])


if __name__ == '__main__':
    unittest.main()

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
        resident = SimpleNamespace(
            family=SimpleNamespace(member_count=5),
            contact_number='09123456893',
        )
        with patch('routes.rescue_requests.db.session.get', return_value=resident) as get_resident:
            response = self.client.get(
                '/api/rescue-requests/form-context',
                headers={'Authorization': f'Bearer {token}'},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {
            'family_member_count': 5,
            'contact_number': '09123456893',
        })
        get_resident.assert_called_once()

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


if __name__ == '__main__':
    unittest.main()

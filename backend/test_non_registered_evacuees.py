"""PostgreSQL integration tests. Set EVACWAY_TEST_DATABASE_URL to an empty evacway_test_* database."""
import io
import os
import unittest
import uuid
from datetime import date, timedelta
from unittest.mock import patch

from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token
from openpyxl import load_workbook
from sqlalchemy import text, inspect
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError

from migrate_non_registered_evacuees import run_migration
from models import (db, User, Resident, ResidentAccount, CenterType, Barangay, RosterYear, Family,
                    EvacuationCenter, EvacuationOperation, EvacuationAssignment, NonRegisteredEvacuee, SystemLog)
from routes.non_registered_evacuees import nre_bp
from routes.evacuation_centers import centers_bp
from services.non_registered_evacuees import center_occupancy


def person(first='Fakename', **kwargs):
    return dict(first_name=first, middle_name='', last_name='Testperson', sex='female', age_years=30,
                contact_number='0912-345-6789', **kwargs)


class NonRegisteredEvacueeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.url = os.environ.get('EVACWAY_TEST_DATABASE_URL')
        if not cls.url:
            raise unittest.SkipTest('Set EVACWAY_TEST_DATABASE_URL to an empty test database.')
        if not make_url(cls.url).database.startswith('evacway_test_'):
            raise RuntimeError('Integration tests require an isolated evacway_test_* database.')
        cls.app = Flask(__name__)
        cls.app.config.update(TESTING=True, SQLALCHEMY_DATABASE_URI=cls.url,
                              SQLALCHEMY_TRACK_MODIFICATIONS=False, JWT_SECRET_KEY='fake-test-signing-key-at-least-32-characters')
        db.init_app(cls.app)
        JWTManager(cls.app)
        cls.app.register_blueprint(nre_bp)
        cls.app.register_blueprint(centers_bp)
        cls.context = cls.app.app_context()
        cls.context.push()
        with db.engine.begin() as conn:
            conn.execute(text('CREATE EXTENSION IF NOT EXISTS postgis'))
        db.metadata.create_all(bind=db.engine, tables=[t for t in db.metadata.sorted_tables if t.name != 'non_registered_evacuees'])
        before = set(inspect(db.engine).get_table_names())
        run_migration(cls.url, 'up')
        run_migration(cls.url, 'up')
        run_migration(cls.url, 'down')
        assert set(inspect(db.engine).get_table_names()) == before
        run_migration(cls.url, 'up')

    @classmethod
    def tearDownClass(cls):
        db.session.remove()
        db.engine.dispose()
        cls.context.pop()

    def setUp(self):
        db.session.remove()
        with db.engine.begin() as conn:
            conn.execute(text('TRUNCATE non_registered_evacuees, users, residents, resident_accounts, evacuation_operations, evacuation_centers, center_types, system_logs, families, barangays, roster_years RESTART IDENTITY CASCADE'))
        self.admin = User(name='Fake Admin', email='admin@example.invalid', password_hash='fake-hash', role='admin', is_active=True)
        self.staff = User(name='Fake Staff', email='staff@example.invalid', password_hash='fake-hash', role='lgu_personnel', is_active=True)
        kind = CenterType(code='fake-open-area', name='Fake Shelter Type', structure_mode='open_area')
        db.session.add_all([self.admin, self.staff, kind]); db.session.flush()
        from geoalchemy2.shape import from_shape
        from shapely.geometry import Polygon
        self.center = EvacuationCenter(
            name='Fake Test Shelter', capacity=4, center_type_id=kind.id,
            evacuation_open_date=date.today(), evacuation_cutoff_date=date.today(),
            evacuation_status='open', is_active=True,
            geom=from_shape(Polygon([(124.98, 10.39), (124.99, 10.39), (124.99, 10.40), (124.98, 10.39)]), srid=4326),
        )
        self.resident = Resident(first_name='Fakeresident', last_name='Testperson', gender='Female', date_of_birth=date(1990, 1, 1))
        db.session.add_all([self.center, self.resident]); db.session.flush()
        self.operation = EvacuationOperation(event_name='Fake Test Operation', open_date=date.today(), cutoff_date=date.today(), status='active')
        self.account = ResidentAccount(resident_id=self.resident.id, email='resident@example.invalid', password_hash='fake-hash', is_active=True)
        db.session.add_all([self.operation, self.account]); db.session.commit()
        self.client = self.app.test_client()
        self.admin_headers = self.headers(self.admin.id)
        self.staff_headers = self.headers(self.staff.id)
        self.resident_headers = self.headers(self.account.id, 'resident_account')

    def headers(self, identity, account_type='user'):
        claims = {'account_type': account_type}
        if account_type == 'user':
            claims.update({'mfa_verified': True, 'mfa_version': 0})
        return {'Authorization': 'Bearer ' + create_access_token(identity=str(identity), additional_claims=claims)}

    def create(self, people=None):
        return self.client.post('/api/non-registered-evacuees', headers=self.staff_headers,
                                json={'center_id': self.center.id, 'people': people or [person(), person('Fakesecond'), person('Fakethird')]})

    def test_group_and_occupancy_departure_undo(self):
        db.session.add(EvacuationAssignment(resident_id=self.resident.id, evacuation_center_id=self.center.id, checked_in_at=__import__('models').philippines_now()))
        db.session.commit()
        response = self.create()
        self.assertEqual(response.status_code, 201, response.json)
        group = response.json['group']
        self.assertEqual(sum(m['is_group_head'] for m in group['members']), 1)
        self.assertEqual(response.json['occupancy'], 4)
        listed = self.client.get('/api/non-registered-evacuees', headers=self.staff_headers).json
        self.assertEqual(listed['total'], 1)
        self.assertEqual(listed['groups'][0]['people_count'], 3)
        self.assertNotIn('contact_number', listed['groups'][0]['members'][0])
        member = group['members'][1]
        response = self.client.post(f"/api/non-registered-evacuees/{member['id']}/departure", headers=self.staff_headers, json={'departed': True})
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(center_occupancy(self.center.id), 3)
        self.client.post(f"/api/non-registered-evacuees/{member['id']}/departure", headers=self.staff_headers, json={'departed': False})
        self.assertEqual(center_occupancy(self.center.id), 4)
        self.client.post(f"/api/non-registered-evacuees/groups/{group['group_code']}/departure", headers=self.staff_headers, json={'departed': True})
        self.assertEqual(center_occupancy(self.center.id), 1)

    def test_validation_is_atomic_and_field_specific(self):
        for key, value in [('contact_number', 'not-a-phone'), ('age_years', 150), ('birthdate', '2999-01-01')]:
            invalid = person('Fakeinvalid'); invalid[key] = value
            response = self.create([person(), invalid])
            self.assertEqual(response.status_code, 422, response.json)
            self.assertIn(f'people.1.{key}', response.json['fields'])
            self.assertEqual(NonRegisteredEvacuee.query.count(), 0)
        invalid = person(); invalid.update(sex='male', is_pregnant=True)
        self.assertEqual(self.create([invalid]).status_code, 422)

    def test_transaction_failure_saves_nobody(self):
        # Force a real database failure during the shared commit, after valid people
        # have been staged, to prove the complete transaction rolls back.
        with patch('routes.non_registered_evacuees.audit', side_effect=lambda action: db.session.add(SystemLog(user_id=-99999, action='Fake failed activity log'))):
            response = self.create()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(NonRegisteredEvacuee.query.count(), 0)
        self.assertEqual(SystemLog.query.count(), 0)

    def test_timestamps_permissions_and_sensitive_audit(self):
        group = self.create().json['group']
        person_id = group['members'][0]['id']
        response = self.client.post(f'/api/non-registered-evacuees/{person_id}/departure', headers=self.staff_headers,
                                    json={'departed': True, 'departed_at': '2000-01-01T00:00:00+08:00'})
        self.assertEqual(response.status_code, 422)
        self.assertIn('departed_at', response.json['fields'])
        for method, path, payload in [('get', '/api/non-registered-evacuees', None), ('post', '/api/non-registered-evacuees', {}),
            ('get', '/api/non-registered-evacuees/duplicates?q=Fake', None),
            ('patch', f'/api/non-registered-evacuees/{person_id}', {}), ('delete', f'/api/non-registered-evacuees/{person_id}', None),
            ('get', '/api/non-registered-evacuees/export', None),
            ('get', f"/api/non-registered-evacuees/groups/{group['group_code']}?include_sensitive=true", None)]:
            response = getattr(self.client, method)(path, headers=self.resident_headers, json=payload)
            self.assertEqual(response.status_code, 403, (path, response.json))
        response = self.client.get(f"/api/non-registered-evacuees/groups/{group['group_code']}?include_sensitive=true", headers=self.staff_headers)
        self.assertEqual(response.json['group']['members'][0]['contact_number'], '+639123456789')
        self.assertEqual(self.client.delete(f'/api/non-registered-evacuees/{person_id}', headers=self.staff_headers).status_code, 403)
        for log in SystemLog.query.all():
            self.assertNotIn('Testperson', log.action)
            self.assertNotIn('+639', log.action)
        self.assertTrue(SystemLog.query.filter(SystemLog.action.ilike('%Viewed non-registered%')).count())

    def test_update_add_member_delete_and_group_head_constraint(self):
        group = self.create().json['group']; head = group['members'][0]['id']
        response = self.client.patch(f'/api/non-registered-evacuees/{head}', headers=self.staff_headers, json={'age_years': 31})
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(self.client.post(f"/api/non-registered-evacuees/groups/{group['group_code']}/members", headers=self.staff_headers, json=person('Fakefourth')).status_code, 201)
        response = self.client.delete(f'/api/non-registered-evacuees/{head}', headers=self.admin_headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(NonRegisteredEvacuee.query.filter_by(is_group_head=True).count(), 1)
        row = NonRegisteredEvacuee.query.filter_by(is_group_head=True).one()
        row.is_group_head = False
        with self.assertRaises(IntegrityError): db.session.commit()
        db.session.rollback()

    def test_search_pagination_duplicates_and_closed_operation(self):
        self.create()
        for q in ('Fakename', 'Testperson', '+639123'):
            response = self.client.get('/api/non-registered-evacuees', query_string={'q': q, 'per_page': 1}, headers=self.staff_headers)
            self.assertEqual(response.status_code, 200, response.json)
            self.assertEqual(response.json['total'], 1)
        response = self.client.get('/api/non-registered-evacuees/duplicates?q=Fakeresident', headers=self.staff_headers)
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json['matches'][0]['source'], 'resident')
        self.operation.status = 'concluded'; db.session.commit()
        self.assertEqual(self.create().status_code, 409)

    def test_existing_arrivals_counts_export_and_public_occupancy(self):
        barangay = Barangay(name='Fake Test Barangay'); roster = RosterYear(year=2090, is_active=True)
        db.session.add_all([barangay, roster]); db.session.flush()
        family = Family(head_name='Fake Registered Head', family_code='FAKE-001', member_count=1, barangay_id=barangay.id, roster_year_id=roster.id)
        db.session.add(family); db.session.flush(); self.resident.family_id = family.id
        db.session.add(EvacuationAssignment(resident_id=self.resident.id, evacuation_center_id=self.center.id))
        db.session.commit()
        response = self.client.post(f'/api/evacuation-centers/{self.center.id}/check-in', headers=self.staff_headers, json={'family_id': family.id, 'action': 'check_in'})
        self.assertEqual(response.status_code, 200, response.json)
        self.create()
        response = self.client.get('/api/evacuation-centers/check-in-list', headers=self.staff_headers)
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json['summary']['total_assigned'], 1)
        self.assertEqual(response.json['summary']['total_checked_in'], 1)
        self.assertEqual(response.json['centers'][0]['current_occupancy'], 4)
        self.assertEqual(response.json['centers'][0]['capacity_warning'], 'Shelter full')
        self.center.capacity = 5; db.session.commit()
        response = self.client.get('/api/evacuation-centers/check-in-list', headers=self.staff_headers)
        self.assertIsNone(response.json['centers'][0]['capacity_warning'])
        response = self.client.get('/api/evacuation-centers/check-in/report', headers=self.staff_headers)
        self.assertEqual(response.status_code, 200)
        workbook = load_workbook(io.BytesIO(response.data))
        self.assertIn('Non-registered arrivals', workbook.sheetnames)
        self.assertEqual(workbook['Non-registered arrivals'].max_row, 4)
        from routes.evacuation_centers import _center_metrics
        metrics = _center_metrics(self.center)
        self.assertEqual(metrics['occupied'], 4)
        self.assertFalse(any('contact_number' in str(value) for value in [metrics.get('non_registered', {})]))

    def test_occupancy_is_scoped_to_operation_and_barangay_counts_are_unchanged(self):
        self.create()
        self.operation.status = 'concluded'
        other = EvacuationOperation(event_name='Fake Second Operation', open_date=date.today(), cutoff_date=date.today(), status='active')
        db.session.add(other); db.session.commit()
        self.assertEqual(center_occupancy(self.center.id), 0)
        self.assertEqual(center_occupancy(self.center.id, self.operation), 3)
        from routes.evacuation_centers import _center_metrics
        metrics = _center_metrics(self.center)
        self.assertEqual(metrics['assigned'], 0)
        self.assertEqual(metrics['barangay_breakdown'], [])

    def test_capacity_threshold_and_limits(self):
        self.center.capacity = 10; db.session.commit()
        self.create([person() for _ in range(9)])
        response = self.client.get('/api/evacuation-centers/check-in-list', headers=self.staff_headers)
        self.assertEqual(response.json['centers'][0]['capacity_warning'], 'Near capacity')
        response = self.create([person() for _ in range(31)])
        self.assertEqual(response.status_code, 422)
        self.assertEqual(NonRegisteredEvacuee.query.count(), 9)


if __name__ == '__main__':
    unittest.main()

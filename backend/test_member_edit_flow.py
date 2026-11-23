import unittest

from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token
from sqlalchemy import event, text
from werkzeug.security import generate_password_hash

from models import (
    Amenity,
    Barangay,
    BuildingMaterial,
    CenterBarangay,
    CenterType,
    EvacuationAssignment,
    EvacuationCheckInRecord,
    EvacuationOperation,
    Family,
    Resident,
    RosterYear,
    SystemLog,
    User,
    db,
)
from routes.families import families_bp


class MemberEditFlowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = Flask(__name__)
        cls.app.config.update(
            TESTING=True,
            SQLALCHEMY_DATABASE_URI='sqlite://',
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            JWT_SECRET_KEY='member-edit-flow-test-secret-at-least-32b',
        )
        db.init_app(cls.app)
        JWTManager(cls.app)
        cls.app.register_blueprint(families_bp)
        cls.app_context = cls.app.app_context()
        cls.app_context.push()

        @event.listens_for(db.engine, 'connect')
        def _register_sqlite_spatial_funcs(dbapi_connection, _connection_record):
            dbapi_connection.create_function('AsEWKB', 1, lambda x: x)
            dbapi_connection.create_function('GeomFromEWKT', 1, lambda x: x)
            dbapi_connection.create_function('ST_AsEWKB', 1, lambda x: x)
            dbapi_connection.create_function('ST_GeomFromEWKT', 1, lambda x: x)

        needed_tables = [
            User.__table__,
            CenterType.__table__,
            BuildingMaterial.__table__,
            Amenity.__table__,
            RosterYear.__table__,
            Family.__table__,
            Resident.__table__,
            EvacuationOperation.__table__,
            EvacuationAssignment.__table__,
            EvacuationCheckInRecord.__table__,
            CenterBarangay.__table__,
            SystemLog.__table__,
        ]
        db.metadata.create_all(bind=db.engine, tables=needed_tables)

        with db.engine.begin() as conn:
            conn.execute(
                text(
                    'CREATE TABLE barangays ('
                    'id INTEGER PRIMARY KEY, '
                    'name VARCHAR(100) UNIQUE NOT NULL, '
                    'population INTEGER DEFAULT 0, '
                    'household_count INTEGER DEFAULT 0, '
                    'geom BLOB, '
                    'created_at DATETIME)'
                )
            )
            conn.execute(
                text(
                    'CREATE TABLE evacuation_centers ('
                    'id INTEGER PRIMARY KEY, '
                    'name VARCHAR(100) NOT NULL, '
                    'capacity INTEGER, '
                    'center_type_id INTEGER NOT NULL DEFAULT 1, '
                    'building_material_id INTEGER, '
                    'hazard_exposure_score FLOAT, '
                    'contact_number VARCHAR(20), '
                    'is_active BOOLEAN DEFAULT 1, '
                    'owner_name VARCHAR(150), '
                    'evacuation_open_date DATE, '
                    "evacuation_open_time VARCHAR(10) DEFAULT '08:00', "
                    'evacuation_cutoff_date DATE, '
                    "evacuation_cutoff_time VARCHAR(10) DEFAULT '18:00', "
                    'evacuation_extension_count INTEGER DEFAULT 0, '
                    'evacuation_extended_until DATETIME, '
                    "evacuation_status VARCHAR(30) DEFAULT 'standby', "
                    'evacuation_event_name VARCHAR(150), '
                    'max_rooms INTEGER, '
                    'geom BLOB, '
                    'entrance_geom BLOB, '
                    'managed_by INTEGER, '
                    'created_at DATETIME)'
                )
            )
            conn.execute(
                text(
                    'CREATE TABLE evacuation_center_buildings ('
                    'id INTEGER PRIMARY KEY, '
                    'evacuation_center_id INTEGER NOT NULL, '
                    'name VARCHAR(100), '
                    'max_rooms INTEGER, '
                    'floors INTEGER, '
                    "status VARCHAR(20) NOT NULL DEFAULT 'open', "
                    'notes TEXT, '
                    'geom BLOB, '
                    'created_at DATETIME, '
                    'updated_at DATETIME)'
                )
            )
            conn.execute(
                text(
                    'CREATE TABLE evacuation_center_rooms ('
                    'id INTEGER PRIMARY KEY, '
                    'evacuation_center_id INTEGER, '
                    'building_id INTEGER, '
                    'room_number VARCHAR(50), '
                    'floor INTEGER, '
                    'capacity INTEGER, '
                    'family_slots INTEGER DEFAULT 5, '
                    'people_spaces INTEGER DEFAULT 25, '
                    'is_active BOOLEAN NOT NULL DEFAULT 1, '
                    'created_at DATETIME)'
                )
            )

        admin = User(
            name='Admin User',
            email='admin-member-test@example.com',
            password_hash=generate_password_hash('Secret123!'),
            role='admin',
            is_active=True,
        )
        year = RosterYear(year=2026, is_active=True)
        db.session.add_all([admin, year])
        db.session.flush()
        db.session.commit()
        cls.admin_id = admin.id
        cls.year_id = year.id
        cls.client = cls.app.test_client()

    @classmethod
    def tearDownClass(cls):
        db.session.remove()
        db.engine.dispose()
        cls.app_context.pop()

    def setUp(self):
        Resident.query.delete()
        Family.query.delete()
        Barangay.query.delete()
        SystemLog.query.delete()
        db.session.commit()

        self.barangay = Barangay(name='Hibod-Hibod')
        db.session.add(self.barangay)
        db.session.flush()

        self.family = Family(
            family_code='FAM-9001',
            head_name='Maria Santos',
            roster_year_id=self.year_id,
            barangay_id=self.barangay.id,
            member_count=2,
            address='Purok 2',
            contact_number='09171112222',
            vulnerable_members='Elderly in wheelchair',
        )
        db.session.add(self.family)
        db.session.flush()

        self.head = Resident(
            family_id=self.family.id,
            first_name='Maria',
            last_name='Santos',
            gender='Female',
            relationship_to_head='Household Head',
            is_head_of_family=True,
            is_pregnant=True,
            needs_assistance=True,
        )
        self.child = Resident(
            family_id=self.family.id,
            first_name='Alex',
            last_name='Santos',
            gender=None,
            relationship_to_head='Child',
            is_head_of_family=False,
            needs_assistance=True,
        )
        db.session.add_all([self.head, self.child])
        db.session.commit()

    def _auth_headers(self):
        token = create_access_token(
            identity=str(self.admin_id),
            additional_claims={'role': 'admin', 'account_type': 'user', 'mfa_verified': True, 'mfa_version': 0},
        )
        return {'Authorization': f'Bearer {token}'}

    def test_edit_head_updates_contact_number_and_syncs_household(self):
        res = self.client.put(
            f'/api/families/{self.family.id}/members/{self.head.id}',
            json={
                'first_name': 'Maria',
                'last_name': 'Santos',
                'gender': 'Female',
                'relationship_to_head': 'Household Head',
                'contact_number': '09179998888',
                'is_head_of_family': True,
                'is_pwd': False,
                'is_pregnant': True,
                'is_lactating': False,
                'is_solo_parent': False,
            },
            headers=self._auth_headers(),
        )
        self.assertEqual(res.status_code, 200, res.get_json())
        payload = res.get_json()
        self.assertEqual(payload['member']['contact_number'], '09179998888')
        self.assertEqual(payload['family']['contact_number'], '09179998888')

        db.session.expire_all()
        updated_family = db.session.get(Family, self.family.id)
        updated_head = db.session.get(Resident, self.head.id)
        self.assertEqual(updated_family.contact_number, '09179998888')
        self.assertEqual(updated_head.contact_number, '09179998888')
        self.assertTrue(updated_head.needs_assistance)
        self.assertEqual(updated_family.vulnerable_members, 'Elderly in wheelchair')

    def test_clearing_head_contact_syncs_none_and_omitted_gender_stays_preserved(self):
        res = self.client.put(
            f'/api/families/{self.family.id}/members/{self.head.id}',
            json={
                'first_name': 'Maria',
                'last_name': 'Santos',
                'contact_number': None,
                'is_head_of_family': True,
            },
            headers=self._auth_headers(),
        )
        self.assertEqual(res.status_code, 200, res.get_json())
        db.session.expire_all()
        updated_family = db.session.get(Family, self.family.id)
        updated_head = db.session.get(Resident, self.head.id)
        self.assertIsNone(updated_family.contact_number)
        self.assertIsNone(updated_head.contact_number)
        self.assertEqual(updated_head.gender, 'Female')

    def test_member_unspecified_gender_never_defaults_to_male_and_preserves_flags(self):
        res = self.client.put(
            f'/api/families/{self.family.id}/members/{self.child.id}',
            json={
                'first_name': 'Alex',
                'last_name': 'Santos',
                'gender': '',
                'relationship_to_head': 'Child',
                'contact_number': '09175554444',
                'is_head_of_family': False,
                'is_pwd': False,
                'is_pregnant': False,
                'is_lactating': False,
                'is_solo_parent': False,
            },
            headers=self._auth_headers(),
        )
        self.assertEqual(res.status_code, 200, res.get_json())
        payload = res.get_json()
        self.assertIsNone(payload['member']['gender'])
        self.assertTrue(payload['member']['needs_assistance'])
        self.assertEqual(payload['family']['contact_number'], '09175554444')

        res_literal = self.client.put(
            f'/api/families/{self.family.id}/members/{self.child.id}',
            json={
                'first_name': 'Alex',
                'last_name': 'Santos',
                'gender': 'Not specified',
                'relationship_to_head': 'Child',
            },
            headers=self._auth_headers(),
        )
        self.assertEqual(res_literal.status_code, 200, res_literal.get_json())
        self.assertIsNone(res_literal.get_json()['member']['gender'])

        res_placeholder = self.client.put(
            f'/api/families/{self.family.id}/members/{self.child.id}',
            json={
                'first_name': 'Alex',
                'last_name': 'Santos',
                'gender': 'Select gender',
                'relationship_to_head': 'Child',
            },
            headers=self._auth_headers(),
        )
        self.assertEqual(res_placeholder.status_code, 200, res_placeholder.get_json())
        self.assertIsNone(res_placeholder.get_json()['member']['gender'])

    def test_changing_gender_to_male_clears_maternal_flags(self):
        res = self.client.put(
            f'/api/families/{self.family.id}/members/{self.head.id}',
            json={
                'first_name': 'Maria',
                'last_name': 'Santos',
                'gender': 'Male',
                'relationship_to_head': 'Household Head',
                'is_head_of_family': True,
                'is_pregnant': True,
                'is_lactating': True,
            },
            headers=self._auth_headers(),
        )
        self.assertEqual(res.status_code, 200, res.get_json())
        member = res.get_json()['member']
        self.assertEqual(member['gender'], 'Male')
        self.assertFalse(member['is_pregnant'])
        self.assertFalse(member['is_lactating'])

    def test_gender_round_trips_on_create_household_and_add_member(self):
        create_res = self.client.post(
            '/api/families',
            json={
                'barangay_id': self.barangay.id,
                'head_name': 'Lorna Reyes',
                'address': 'Purok 5',
                'members': [
                    {
                        'first_name': 'Lorna',
                        'last_name': 'Reyes',
                        'gender': 'Female',
                        'relationship_to_head': 'Household Head',
                        'is_head_of_family': True,
                    },
                    {
                        'first_name': 'Paolo',
                        'last_name': 'Reyes',
                        'gender': 'Male',
                        'relationship_to_head': 'Child',
                        'is_head_of_family': False,
                    },
                ],
            },
            headers=self._auth_headers(),
        )
        self.assertEqual(create_res.status_code, 201, create_res.get_json())
        family_id = create_res.get_json()['family']['id']

        add_res = self.client.post(
            f'/api/families/{family_id}/members',
            json={
                'first_name': 'Ana',
                'last_name': 'Reyes',
                'gender': 'Female',
                'relationship_to_head': 'Child',
            },
            headers=self._auth_headers(),
        )
        self.assertEqual(add_res.status_code, 201, add_res.get_json())

        get_res = self.client.get(f'/api/families/{family_id}', headers=self._auth_headers())
        self.assertEqual(get_res.status_code, 200, get_res.get_json())
        genders = {m['first_name']: m['gender'] for m in get_res.get_json()['members']}
        self.assertEqual(genders, {'Lorna': 'Female', 'Paolo': 'Male', 'Ana': 'Female'})

    def test_invalid_member_update_returns_error(self):
        res = self.client.put(
            f'/api/families/{self.family.id}/members/{self.child.id}',
            json={
                'first_name': '',
                'last_name': 'Santos',
            },
            headers=self._auth_headers(),
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn('error', res.get_json())


if __name__ == '__main__':
    unittest.main()

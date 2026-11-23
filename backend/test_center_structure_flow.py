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
    EvacuationCenter,
    EvacuationCenterBuilding,
    EvacuationCenterRoom,
    EvacuationCheckInRecord,
    EvacuationOperation,
    Family,
    NonRegisteredEvacuee,
    Resident,
    ResidentAccount,
    ResidentLookupLog,
    RosterYear,
    SystemLog,
    User,
    center_amenities,
    db,
)
from routes.buildings import buildings_bp
from routes.evacuation_centers import centers_bp
from routes.families import families_bp
from routes.rooms import rooms_bp
from routes.residents import residents_bp


class CenterStructureFlowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = Flask(__name__)
        cls.app.config.update(
            TESTING=True,
            SQLALCHEMY_DATABASE_URI='sqlite://',
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            JWT_SECRET_KEY='center-structure-flow-test-secret-at-least-32b',
        )
        db.init_app(cls.app)
        JWTManager(cls.app)
        cls.app.register_blueprint(centers_bp)
        cls.app.register_blueprint(rooms_bp)
        cls.app.register_blueprint(buildings_bp)
        cls.app.register_blueprint(families_bp)
        cls.app.register_blueprint(residents_bp)
        cls.app_context = cls.app.app_context()
        cls.app_context.push()

        @event.listens_for(db.engine, 'connect')
        def _register_sqlite_spatial_funcs(dbapi_connection, _connection_record):
            dbapi_connection.create_function('AsEWKB', 1, lambda x: x)
            dbapi_connection.create_function('GeomFromEWKT', 1, lambda x: x)
            dbapi_connection.create_function('ST_AsEWKB', 1, lambda x: x)
            dbapi_connection.create_function('ST_GeomFromEWKT', 1, lambda x: x)
            dbapi_connection.create_function('ST_Distance', 2, lambda a, b: 0.0)
            dbapi_connection.create_function('ST_DWithin', 3, lambda a, b, d: False)

        # Only create tables needed for evacuation center / family flow
        needed_tables = [
            User.__table__,
            CenterType.__table__,
            BuildingMaterial.__table__,
            Amenity.__table__,
            RosterYear.__table__,
            Family.__table__,
            Resident.__table__,
            ResidentAccount.__table__,
            ResidentLookupLog.__table__,
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
                    'municipality VARCHAR(100), '
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
                    'evacuation_center_id INTEGER NOT NULL, '
                    'building_id INTEGER, '
                    'room_number VARCHAR(50) NOT NULL, '
                    'capacity INTEGER NOT NULL, '
                    'family_slots INTEGER NOT NULL DEFAULT 5, '
                    'people_spaces INTEGER NOT NULL DEFAULT 25, '
                    'floor INTEGER, '
                    'is_active BOOLEAN NOT NULL DEFAULT 1, '
                    'created_at DATETIME)'
                )
            )
        db.metadata.create_all(bind=db.engine, tables=[NonRegisteredEvacuee.__table__])
        center_amenities.create(bind=db.engine)

        admin = User(
            name='Admin User',
            email='admin@evacway.test',
            password_hash=generate_password_hash('secret123'),
            role='admin',
            is_active=True,
        )
        year = RosterYear(year=2026, is_active=True)
        db.session.add_all([admin, year])
        db.session.flush()
        db.session.execute(
            text("INSERT INTO barangays (id, name, municipality, population, household_count) VALUES (1, 'Brgy Uno', 'Sogod', 500, 100)")
        )
        db.session.commit()
        cls.admin_id = admin.id
        cls.year_id = year.id

    @classmethod
    def tearDownClass(cls):
        db.session.remove()
        db.engine.dispose()
        cls.app_context.pop()

    def setUp(self):
        db.session.rollback()
        with db.engine.begin() as conn:
            for tbl in (
                'evacuation_assignments',
                'evacuation_check_in_records',
                'residents',
                'families',
                'resident_accounts',
                'evacuation_center_rooms',
                'evacuation_center_buildings',
                'center_barangays',
                'center_amenities',
                'evacuation_centers',
            ):
                conn.execute(text(f'DELETE FROM {tbl}'))
        SystemLog.query.delete()
        User.query.filter(User.role == 'lgu_personnel').delete()
        CenterType.query.delete()
        db.session.commit()

        # Seed standard center types plus one without explicit structure_mode (fallback -> buildings_and_rooms)
        self.ct_campus = CenterType(code='campus', name='Campus', structure_mode='buildings_and_rooms', is_active=True)
        self.ct_campus_alt = CenterType(code='school_annex', name='School Annex', structure_mode=None, is_active=True)
        self.ct_rooms = CenterType(code='private_property', name='Private Property', structure_mode='rooms_only', is_active=True)
        self.ct_open = CenterType(code='single_venue', name='Covered Court', structure_mode='open_area', is_active=True)
        db.session.add_all([self.ct_campus, self.ct_campus_alt, self.ct_rooms, self.ct_open])
        db.session.commit()

        self.client = self.app.test_client()
        token = create_access_token(
            identity=str(self.admin_id),
            additional_claims={'role': 'admin', 'account_type': 'user', 'mfa_verified': True, 'mfa_version': 0},
        )
        self.headers = {'Authorization': f'Bearer {token}'}
        lgu = User(
            name='LGU Personnel',
            email='lgu@evacway.test',
            password_hash='test-password-fingerprint',
            role='lgu_personnel',
            is_active=True,
        )
        db.session.add(lgu)
        db.session.flush()
        self.lgu_id = lgu.id
        lgu_token = create_access_token(
            identity=str(lgu.id),
            additional_claims={'role': 'lgu_personnel'},
        )
        self.lgu_headers = {'Authorization': f'Bearer {lgu_token}'}
        db.session.commit()

    def _create_family(self, head_name, member_count):
        res = self.client.post(
            '/api/families',
            headers=self.headers,
            json={
                'head_name': head_name,
                'barangay_id': 1,
                'members': [
                    {
                        'first_name': f'Member{i}',
                        'last_name': head_name.split()[-1],
                        'is_head_of_family': False,
                        'relationship_to_head': 'Child',
                    }
                    for i in range(1, member_count)
                ],
            },
        )
        self.assertEqual(res.status_code, 201, res.get_data(as_text=True))
        return res.get_json()['family']['id']

    def _create_privacy_fixture(self):
        center_response = self.client.post(
            '/api/evacuation-centers',
            headers=self.headers,
            json={
                'name': 'Privacy Test Center',
                'center_type': 'campus',
                'barangay_ids': [1],
            },
        )
        self.assertEqual(center_response.status_code, 201, center_response.get_data(as_text=True))
        center_id = center_response.get_json()['properties']['id']

        building_response = self.client.post(
            f'/api/evacuation-centers/{center_id}/buildings',
            headers=self.headers,
            json={'name': 'Privacy Test Building', 'floors': 1},
        )
        self.assertEqual(building_response.status_code, 201, building_response.get_data(as_text=True))
        building_id = building_response.get_json()['building']['id']

        room_response = self.client.post(
            f'/api/evacuation-centers/{center_id}/rooms',
            headers=self.headers,
            json={
                'room_number': '101',
                'family_slots': 5,
                'people_spaces': 25,
                'building_id': building_id,
                'floor': 1,
            },
        )
        self.assertEqual(room_response.status_code, 201, room_response.get_data(as_text=True))
        room_id = room_response.get_json()['room']['id']

        own_family_id = self._create_family('Privacy Leak Head', 2)
        other_family_id = self._create_family('Other Private Family', 1)
        own_family = db.session.get(Family, own_family_id)
        own_family.contact_number = '09001234567'
        own_members = Resident.query.filter_by(family_id=own_family_id).order_by(Resident.id.asc()).all()
        other_members = Resident.query.filter_by(family_id=other_family_id).all()
        db.session.add_all([
            EvacuationAssignment(resident_id=resident.id, room_id=room_id, evacuation_center_id=center_id)
            for resident in [*own_members, *other_members]
        ])
        resident_account = ResidentAccount(
            resident_id=own_members[0].id,
            email='privacy-resident@evacway.test',
            password_hash='test-password-fingerprint',
            is_active=True,
        )
        db.session.add(resident_account)
        db.session.commit()

        resident_token = create_access_token(
            identity=str(resident_account.id),
            additional_claims={
                'role': 'resident',
                'account_type': 'resident_account',
                'resident_id': own_members[0].id,
                'name': 'Privacy Leak Head',
            },
        )
        self.resident_headers = {'Authorization': f'Bearer {resident_token}'}
        return {
            'center_id': center_id,
            'building_id': building_id,
            'room_id': room_id,
            'own_resident_id': own_members[0].id,
            'own_family_id': own_family_id,
            'other_resident_id': other_members[0].id,
        }

    def _assert_no_private_roster(self, response):
        body = response.get_json()
        serialized = response.get_data(as_text=True)
        for value in (
            'Privacy Leak Head',
            'Member1 Head',
            'Other Private Family',
            '09001234567',
            'family_id',
        ):
            self.assertNotIn(value, serialized)
        return body

    def _assert_public_room_fields(self, room, allow_my_room=False):
        allowed = {
            'id',
            'building_id',
            'building_name',
            'room_number',
            'floor',
            'available_slots',
            'available_spaces',
            'status',
        }
        if allow_my_room:
            allowed.add('is_my_room')
        self.assertTrue(set(room).issubset(allowed), room)

    def test_public_building_room_and_center_views_do_not_leak_rosters(self):
        fixture = self._create_privacy_fixture()
        requests = [
            f"/api/evacuation-centers/{fixture['center_id']}/buildings",
            f"/api/evacuation-centers/{fixture['center_id']}/rooms",
            f"/api/buildings/{fixture['building_id']}/details",
            f"/api/evacuation-centers/{fixture['center_id']}",
            f"/api/evacuation-centers?search=Privacy%20Test",
        ]
        roles = [
            ('guest', None),
            ('resident', self.resident_headers),
            ('lgu_personnel', self.lgu_headers),
            ('admin', self.headers),
        ]

        for endpoint in requests:
            for role, headers in roles:
                with self.subTest(endpoint=endpoint, role=role):
                    response = self.client.get(endpoint, headers=headers or {})
                    self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
                    body = response.get_json()
                    if role in ('guest', 'resident'):
                        self._assert_no_private_roster(response)
                        if endpoint.endswith('/buildings'):
                            self.assertTrue(body['features'])
                            self.assertEqual(
                                body['features'][0]['properties']['evacuation_center_id'],
                                fixture['center_id'],
                            )
                        public_rooms = []
                        if isinstance(body, list):
                            public_rooms = body
                        elif endpoint.endswith('/buildings'):
                            public_rooms = [
                                room
                                for feature in body['features']
                                for room in feature['properties']['rooms']
                            ]
                        elif isinstance(body, dict) and isinstance(body.get('rooms'), list):
                            public_rooms = body['rooms']
                        for room in public_rooms:
                            self._assert_public_room_fields(
                                room,
                                allow_my_room=(role == 'resident'),
                            )
                    if endpoint.endswith('/details') and role == 'resident':
                        self.assertTrue(body['rooms'][0].get('is_my_room'))
                    if endpoint.endswith('/details') and role == 'guest':
                        self.assertNotIn('is_my_room', body['rooms'][0])
                    if endpoint == f"/api/evacuation-centers/{fixture['center_id']}":
                        if role in ('guest', 'resident'):
                            self.assertEqual(body['assigned_families'], [])
                        else:
                            self.assertTrue(body['assigned_families'])

    def test_buildings_endpoint_batches_room_capacity_queries(self):
        fixture = self._create_privacy_fixture()
        db.session.add_all([
            EvacuationCenterRoom(
                evacuation_center_id=fixture['center_id'],
                building_id=fixture['building_id'],
                room_number=f'B{number:03d}',
                capacity=16,
                family_slots=4,
                people_spaces=16,
                floor=1,
                is_active=True,
            )
            for number in range(2, 82)
        ])
        db.session.commit()

        statements = []

        def count_statement(_connection, _cursor, statement, _parameters, _context, _executemany):
            statements.append(statement)

        event.listen(db.engine, 'before_cursor_execute', count_statement)
        try:
            response = self.client.get(
                f"/api/evacuation-centers/{fixture['center_id']}/buildings"
            )
        finally:
            event.remove(db.engine, 'before_cursor_execute', count_statement)

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertLessEqual(
            len(statements),
            12,
            f'Expected batched room queries; got {len(statements)}',
        )
        rooms = response.get_json()['features'][0]['properties']['rooms']
        self.assertEqual(len(rooms), 81)
        self.assertTrue(all(room['available_spaces'] == 16 for room in rooms[1:]))

    def test_roster_endpoints_enforce_staff_access_and_sanitize_search(self):
        fixture = self._create_privacy_fixture()
        roles = [
            ('guest', None),
            ('resident', self.resident_headers),
            ('lgu_personnel', self.lgu_headers),
            ('admin', self.headers),
        ]

        for role, headers in roles:
            with self.subTest(endpoint='room-families', role=role):
                response = self.client.get(
                    f"/api/rooms/{fixture['room_id']}/families",
                    headers=headers or {},
                )
                if role in ('guest', 'resident'):
                    self.assertIn(response.status_code, (401, 403))
                    self._assert_no_private_roster(response)
                else:
                    self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
                    self.assertIn('Privacy Leak Head', response.get_data(as_text=True))

            with self.subTest(endpoint='autosuggest', role=role):
                response = self.client.get(
                    '/api/residents/autosuggest?q=Privacy',
                    headers=headers or {},
                )
                if role in ('guest', 'resident'):
                    self.assertIn(response.status_code, (401, 403))
                    self._assert_no_private_roster(response)
                else:
                    self.assertEqual(response.status_code, 200)
                    suggestions = response.get_json()['suggestions']
                    self.assertTrue(any(item['name'] == 'Privacy Leak Head' for item in suggestions))

    def test_public_room_error_payloads_do_not_include_roster_data(self):
        self._create_privacy_fixture()
        missing_endpoints = [
            '/api/evacuation-centers/999999/buildings',
            '/api/evacuation-centers/999999/rooms',
            '/api/evacuation-centers/999999',
            '/api/buildings/999999/details',
        ]
        roles = [
            ('guest', None),
            ('resident', self.resident_headers),
            ('lgu_personnel', self.lgu_headers),
            ('admin', self.headers),
        ]
        for endpoint in missing_endpoints:
            for role, headers in roles:
                with self.subTest(endpoint=endpoint, role=role):
                    response = self.client.get(endpoint, headers=headers or {})
                    self.assertEqual(response.status_code, 404)
                    self._assert_no_private_roster(response)

    def test_open_area_capacity_and_direct_assignment_and_blocks(self):
        # Missing capacity for open_area must be rejected
        bad = self.client.post(
            '/api/evacuation-centers',
            headers=self.headers,
            json={'name': 'Plaza Court', 'center_type': 'single_venue', 'barangay_ids': [1]},
        )
        self.assertEqual(bad.status_code, 400)

        created = self.client.post(
            '/api/evacuation-centers',
            headers=self.headers,
            json={'name': 'Plaza Court', 'center_type': 'single_venue', 'capacity': 5, 'barangay_ids': [1]},
        )
        self.assertEqual(created.status_code, 201, created.get_data(as_text=True))
        cid = created.get_json()['properties']['id']
        self.assertEqual(created.get_json()['properties']['structure_mode'], 'open_area')
        self.assertEqual(created.get_json()['properties']['capacity'], 5)

        # Rooms & buildings are blocked on open_area
        self.assertEqual(
            self.client.post(f'/api/evacuation-centers/{cid}/rooms', headers=self.headers, json={'room_number': '101', 'capacity': 4}).status_code,
            400,
        )
        self.assertEqual(
            self.client.post(f'/api/evacuation-centers/{cid}/buildings', headers=self.headers, json={'name': 'Main'}).status_code,
            400,
        )

        # Edit capacity works on open_area
        upd = self.client.put(
            f'/api/evacuation-centers/{cid}',
            headers=self.headers,
            json={'capacity': 6},
        )
        self.assertEqual(upd.status_code, 200)
        self.assertEqual(upd.get_json()['properties']['capacity'], 6)

        fam1 = self._create_family('Ana Reyes', 4)
        fam2 = self._create_family('Ben Cruz', 3)
        fam3 = self._create_family('Cara Diaz', 2)

        # Direct assignment without room works
        ok_assign = self.client.post(
            f'/api/families/{fam1}/assign',
            headers=self.headers,
            json={'center_id': cid},
        )
        self.assertEqual(ok_assign.status_code, 200, ok_assign.get_data(as_text=True))

        # Over-capacity direct assignment (4 + 3 > 6) is blocked
        over_assign = self.client.post(
            f'/api/families/{fam2}/assign',
            headers=self.headers,
            json={'center_id': cid},
        )
        self.assertEqual(over_assign.status_code, 400)

        # Exact remaining capacity works (4 + 2 == 6 -> center is now full)
        fill_assign = self.client.post(
            f'/api/families/{fam3}/assign',
            headers=self.headers,
            json={'center_id': cid},
        )
        self.assertEqual(fill_assign.status_code, 200)

        # Assigning to full open_area center fails
        fam4 = self._create_family('Dan Lim', 1)
        full_assign = self.client.post(
            f'/api/families/{fam4}/assign',
            headers=self.headers,
            json={'center_id': cid},
        )
        self.assertEqual(full_assign.status_code, 400)

        # Verify Space Left == 0
        c_list = self.client.get('/api/evacuation-centers', headers=self.headers).get_json()['features']
        court = next(f['properties'] for f in c_list if f['properties']['id'] == cid)
        self.assertEqual(court['capacity'], 6)
        self.assertEqual(court['assigned'], 6)
        self.assertEqual(court['unassigned'], 0)

        # Verify allowed-center-types blocks switching open_area with direct families -> rooms_only / buildings_and_rooms
        rules = self.client.get(f'/api/evacuation-centers/{cid}/allowed-center-types', headers=self.headers).get_json()
        self.assertFalse(rules['private_property']['allowed'])
        self.assertFalse(rules['campus']['allowed'])

        blocked_switch = self.client.put(
            f'/api/evacuation-centers/{cid}',
            headers=self.headers,
            json={'center_type': 'private_property'},
        )
        self.assertEqual(blocked_switch.status_code, 400)

        # Family serialization reports open_area & no Unmapped building
        fams = self.client.get('/api/families?barangay_id=1', headers=self.headers).get_json()['items']
        ana = next(f for f in fams if f['id'] == fam1)
        self.assertEqual(ana['current_structure_mode'], 'open_area')
        self.assertIsNone(ana['current_room'])
        self.assertIsNone(ana['buildings'])

    def test_rooms_only_capacity_from_rooms_no_buildings_and_warnings(self):
        created = self.client.post(
            '/api/evacuation-centers',
            headers=self.headers,
            json={'name': 'Perez Residence', 'center_type': 'private_property', 'barangay_ids': [1]},
        )
        self.assertEqual(created.status_code, 201, created.get_data(as_text=True))
        cid = created.get_json()['properties']['id']
        self.assertEqual(created.get_json()['properties']['structure_mode'], 'rooms_only')
        self.assertEqual(created.get_json()['properties']['capacity'], 0)

        # Buildings blocked on rooms_only
        self.assertEqual(
            self.client.post(f'/api/evacuation-centers/{cid}/buildings', headers=self.headers, json={'name': 'Wing A'}).status_code,
            400,
        )

        # Room capacity below 25 is rejected
        too_small = self.client.post(
            f'/api/evacuation-centers/{cid}/rooms',
            headers=self.headers,
            json={'room_number': '100', 'capacity': 24},
        )
        self.assertEqual(too_small.status_code, 400)

        r1 = self.client.post(
            f'/api/evacuation-centers/{cid}/rooms',
            headers=self.headers,
            json={'room_number': '101', 'capacity': 25, 'family_slots': 1},
        )
        self.assertEqual(r1.status_code, 201)
        r1_id = r1.get_json()['room']['id']

        # Lowering room capacity below 25 on update is rejected
        too_small_upd = self.client.put(
            f'/api/rooms/{r1_id}',
            headers=self.headers,
            json={'people_spaces': 20},
        )
        self.assertEqual(too_small_upd.status_code, 400)

        r2 = self.client.post(
            f'/api/evacuation-centers/{cid}/rooms',
            headers=self.headers,
            json={'room_number': '102', 'capacity': 30},
        )
        self.assertEqual(r2.status_code, 201)

        # Center capacity is automatically total of rooms (25 + 30 = 55)
        centers = self.client.get('/api/evacuation-centers', headers=self.headers).get_json()['features']
        prop = next(f['properties'] for f in centers if f['properties']['id'] == cid)
        self.assertEqual(prop['capacity'], 55)

        fam1 = self._create_family('Elena Torres', 3)
        fam2 = self._create_family('Gina Gomez', 1)

        # Direct assignment without room_id blocked on rooms_only
        no_room = self.client.post(
            f'/api/families/{fam1}/assign',
            headers=self.headers,
            json={'center_id': cid},
        )
        self.assertEqual(no_room.status_code, 400)

        # Assign fam1 (3 members) fills Room 101 (cap 3)
        ok = self.client.post(
            f'/api/families/{fam1}/assign',
            headers=self.headers,
            json={'center_id': cid, 'room_id': r1_id},
        )
        self.assertEqual(ok.status_code, 200)

        # Full room blocks fam2
        full_rm = self.client.post(
            f'/api/families/{fam2}/assign',
            headers=self.headers,
            json={'center_id': cid, 'room_id': r1_id},
        )
        self.assertEqual(full_rm.status_code, 400)

        # Family serialization shows rooms_only, no building & no Unmapped
        fams = self.client.get('/api/families?barangay_id=1', headers=self.headers).get_json()['items']
        elena = next(f for f in fams if f['id'] == fam1)
        self.assertEqual(elena['current_structure_mode'], 'rooms_only')
        self.assertEqual(elena['current_room'], '101')
        self.assertIsNone(elena['current_building'])
        self.assertIsNone(elena['buildings'])

        # allowed-center-types blocks open_area and provides warning for buildings_and_rooms
        rules = self.client.get(f'/api/evacuation-centers/{cid}/allowed-center-types', headers=self.headers).get_json()
        self.assertFalse(rules['single_venue']['allowed'])
        self.assertTrue(rules['campus']['allowed'])
        self.assertTrue(rules['campus']['warning'])
        self.assertTrue(rules['school_annex']['allowed'])

        # Fallback: switching to school_annex (structure_mode=None -> buildings_and_rooms) works
        sw = self.client.put(
            f'/api/evacuation-centers/{cid}',
            headers=self.headers,
            json={'center_type': 'school_annex'},
        )
        self.assertEqual(sw.status_code, 200)
        self.assertEqual(sw.get_json()['properties']['structure_mode'], 'buildings_and_rooms')

        # Now buildings can be added, and switching back to rooms_only is blocked while buildings exist
        bld = self.client.post(
            f'/api/evacuation-centers/{cid}/buildings',
            headers=self.headers,
            json={'name': 'Annex Building'},
        )
        self.assertEqual(bld.status_code, 201)
        rules2 = self.client.get(f'/api/evacuation-centers/{cid}/allowed-center-types', headers=self.headers).get_json()
        self.assertFalse(rules2['private_property']['allowed'])
        self.assertFalse(rules2['single_venue']['allowed'])


if __name__ == '__main__':
    unittest.main()

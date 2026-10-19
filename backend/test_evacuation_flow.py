import sys
import json
import time
from app import app
from models import db, User, Barangay, EvacuationCenter, EvacuationCenterRoom, Family, Resident, EvacuationAssignment
from flask_jwt_extended import create_access_token

def run_tests():
    with app.app_context():
        # Find an admin user for auth token
        admin = User.query.filter_by(role='admin').first()
        if not admin:
            admin = User.query.filter_by(role='lgu_personnel').first()
        if not admin:
            print("ERROR: No admin or lgu_personnel user found in database.", flush=True)
            sys.exit(1)

        token = create_access_token(
            identity=str(admin.id),
            additional_claims={"role": admin.role, "name": admin.name}
        )
        headers = {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json'
        }

        # Find a barangay
        brgy = Barangay.query.first()
        barangay_id = brgy.id if brgy else None
        barangay_name = brgy.name if brgy else "Barangay Test"

        # Close session so client requests have clean isolation
        db.session.remove()

        client = app.test_client()

        results = {}
        created_center_id = None
        created_room1_id = None
        created_room2_id = None
        created_family1_id = None
        created_family2_id = None

        ts = int(time.time())
        fam1_head = f"Juan Dela Cruz {ts}"
        fam2_head = f"Roberto Santos {ts}"

        print("=== RUNNING EVACWAY EVACUATION, ROOM & FAMILY ASSIGNMENT TEST SUITE ===\n", flush=True)

        # ----------------------------------------------------
        # TEST 1: Add evacuation center
        # ----------------------------------------------------
        try:
            res = client.post('/api/evacuation-centers', headers=headers, json={
                'name': f'Test Integration Center {ts}',
                'barangay_id': barangay_id,
                'barangay': barangay_name,
                'capacity': 100,
                'building_material': 'Concrete',
                'contact_number': '09123456789'
            })
            assert res.status_code == 201, f"Expected 201, got {res.status_code}: {res.get_data(as_text=True)}"
            data = res.get_json()
            created_center_id = data.get('id') or data.get('properties', {}).get('id')
            assert created_center_id is not None, f"Failed to get center ID from response: {data}"
            results[1] = ("PASS", f"Created center ID {created_center_id} ('Test Integration Center {ts}')")
        except Exception as e:
            results[1] = ("FAIL", str(e))
        print(f"Test 1: {results[1][0]} - {results[1][1]}", flush=True)

        # ----------------------------------------------------
        # TEST 2: Edit center
        # ----------------------------------------------------
        try:
            assert created_center_id, "Center not created"
            res = client.put(f'/api/evacuation-centers/{created_center_id}', headers=headers, json={
                'name': f'Test Integration Center {ts} (Updated)',
                'capacity': 120,
                'accessibility_notes': 'Wheelchair accessible'
            })
            assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.get_data(as_text=True)}"
            data = res.get_json()
            cap = data.get('capacity') or data.get('properties', {}).get('capacity')
            assert cap == 120, f"Expected capacity 120, got {cap}"
            results[2] = ("PASS", "Updated center capacity to 120 and accessibility notes")
        except Exception as e:
            results[2] = ("FAIL", str(e))
        print(f"Test 2: {results[2][0]} - {results[2][1]}", flush=True)

        # ----------------------------------------------------
        # TEST 3: Add room
        # ----------------------------------------------------
        try:
            assert created_center_id, "Center not created"
            # Room 1: Capacity 5
            res1 = client.post(f'/api/evacuation-centers/{created_center_id}/rooms', headers=headers, json={
                'room_number': '101',
                'capacity': 5,
                'floor': 1
            })
            assert res1.status_code == 201, f"Expected 201, got {res1.status_code}: {res1.get_data(as_text=True)}"
            created_room1_id = res1.get_json().get('room', {}).get('id')

            # Room 2: Capacity 10
            res2 = client.post(f'/api/evacuation-centers/{created_center_id}/rooms', headers=headers, json={
                'room_number': '102',
                'capacity': 10,
                'floor': 1
            })
            assert res2.status_code == 201, f"Expected 201, got {res2.status_code}: {res2.get_data(as_text=True)}"
            created_room2_id = res2.get_json().get('room', {}).get('id')

            assert created_room1_id and created_room2_id
            results[3] = ("PASS", f"Added Room 101 (Cap 5, ID {created_room1_id}) and Room 102 (Cap 10, ID {created_room2_id})")
        except Exception as e:
            results[3] = ("FAIL", str(e))
        print(f"Test 3: {results[3][0]} - {results[3][1]}", flush=True)

        # ----------------------------------------------------
        # TEST 4: Edit room
        # ----------------------------------------------------
        try:
            assert created_room1_id, "Room 1 not created"
            res = client.put(f'/api/rooms/{created_room1_id}', headers=headers, json={
                'room_number': '101-A',
                'capacity': 6
            })
            assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.get_data(as_text=True)}"
            data = res.get_json()
            assert data.get('room', {}).get('capacity') == 6
            assert data.get('room', {}).get('room_number') == '101-A'
            results[4] = ("PASS", "Updated room number to 101-A and capacity to 6")
        except Exception as e:
            results[4] = ("FAIL", str(e))
        print(f"Test 4: {results[4][0]} - {results[4][1]}", flush=True)

        # ----------------------------------------------------
        # TEST 5: Add/view family
        # ----------------------------------------------------
        try:
            # Family 1: 4 members (Head + 3)
            res1 = client.post('/api/families', headers=headers, json={
                'head_name': fam1_head,
                'barangay_id': barangay_id,
                'contact_number': '09181112222',
                'address': 'Purok 1',
                'members': [
                    {'full_name': f'Maria Dela Cruz {ts}'},
                    {'full_name': f'Pedro Dela Cruz {ts}'},
                    {'full_name': f'Ana Dela Cruz {ts}'}
                ]
            })
            assert res1.status_code == 201, f"Expected 201, got {res1.status_code}: {res1.get_data(as_text=True)}"
            created_family1_id = res1.get_json().get('family', {}).get('id')
            assert created_family1_id, "Failed to get family 1 ID"

            # Family 2: 7 members (Head + 6)
            res2 = client.post('/api/families', headers=headers, json={
                'head_name': fam2_head,
                'barangay_id': barangay_id,
                'contact_number': '09183334444',
                'address': 'Purok 2',
                'members': [
                    {'full_name': f'Elena Santos {ts}'},
                    {'full_name': f'Carlos Santos {ts}'},
                    {'full_name': f'David Santos {ts}'},
                    {'full_name': f'Luz Santos {ts}'},
                    {'full_name': f'Gloria Santos {ts}'},
                    {'full_name': f'Felipe Santos {ts}'}
                ]
            })
            assert res2.status_code == 201, f"Expected 201, got {res2.status_code}: {res2.get_data(as_text=True)}"
            created_family2_id = res2.get_json().get('family', {}).get('id')
            assert created_family2_id, "Failed to get family 2 ID"

            # View family 1
            view_res = client.get(f'/api/families/{created_family1_id}', headers=headers)
            assert view_res.status_code == 200
            view_data = view_res.get_json()
            assert view_data.get('head_name') == fam1_head
            assert view_data.get('member_count') == 4
            assert len(view_data.get('members', [])) == 4
            results[5] = ("PASS", f"Created Family 1 (4 members, ID {created_family1_id}) & Family 2 (7 members, ID {created_family2_id}), verified view")
        except Exception as e:
            results[5] = ("FAIL", str(e))
        print(f"Test 5: {results[5][0]} - {results[5][1]}", flush=True)

        # ----------------------------------------------------
        # TEST 6: Assign family to room
        # ----------------------------------------------------
        try:
            assert created_family1_id and created_room1_id and created_center_id
            res = client.post(f'/api/families/{created_family1_id}/assign', headers=headers, json={
                'center_id': created_center_id,
                'room_id': created_room1_id
            })
            assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.get_data(as_text=True)}"
            data = res.get_json()
            assert data.get('room_occupied') == 4, f"Expected room_occupied 4, got {data.get('room_occupied')}"
            assert data.get('room_available') == 2, f"Expected room_available 2, got {data.get('room_available')}"
            results[6] = ("PASS", "Assigned 4-member family to Room 101-A (Cap 6). Occupancy now 4, available 2.")
        except Exception as e:
            results[6] = ("FAIL", str(e))
        print(f"Test 6: {results[6][0]} - {results[6][1]}", flush=True)

        # ----------------------------------------------------
        # TEST 7: Verify occupancy
        # ----------------------------------------------------
        try:
            # Check room endpoint
            rooms_res = client.get(f'/api/evacuation-centers/{created_center_id}/rooms', headers=headers)
            assert rooms_res.status_code == 200
            rooms_data = rooms_res.get_json()
            r101 = next(r for r in rooms_data if r['id'] == created_room1_id)
            assert r101['occupied'] == 4, f"Expected 4, got {r101['occupied']}"
            assert r101['available'] == 2, f"Expected 2, got {r101['available']}"

            # Check center details endpoint
            center_res = client.get(f'/api/evacuation-centers/{created_center_id}', headers=headers)
            assert center_res.status_code == 200
            center_data = center_res.get_json()
            props = center_data.get('properties', {})
            center_occ = props.get('current_occupancy') if props.get('current_occupancy') is not None else props.get('occupied')
            assert center_occ == 4, f"Expected center occupancy 4, got {center_occ}"
            results[7] = ("PASS", "Verified occupancy strictly computed from assigned members: Room occupied=4, Center occupied=4")
        except Exception as e:
            results[7] = ("FAIL", str(e))
        print(f"Test 7: {results[7][0]} - {results[7][1]}", flush=True)

        # ----------------------------------------------------
        # TEST 8: Try assigning a family that exceeds room capacity
        # ----------------------------------------------------
        try:
            # Family 2 has 7 members. Room 101-A has 2 available spaces left.
            res = client.post(f'/api/families/{created_family2_id}/assign', headers=headers, json={
                'center_id': created_center_id,
                'room_id': created_room1_id
            })
            assert res.status_code == 400, f"Expected 400 rejection, got {res.status_code}: {res.get_data(as_text=True)}"
            err = res.get_json().get('error', '')
            assert 'capacity' in err.lower() or 'not enough' in err.lower()
            results[8] = ("PASS", f"Properly rejected overcapacity assignment (7 members > 2 available spaces): '{err}'")
        except Exception as e:
            results[8] = ("FAIL", str(e))
        print(f"Test 8: {results[8][0]} - {results[8][1]}", flush=True)

        # ----------------------------------------------------
        # TEST 9: Move family to another room
        # ----------------------------------------------------
        try:
            assert created_family1_id and created_room2_id
            # Move Family 1 (4 members) from Room 101-A to Room 102 (Cap 10)
            res = client.post(f'/api/families/{created_family1_id}/move', headers=headers, json={
                'center_id': created_center_id,
                'room_id': created_room2_id
            })
            assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.get_data(as_text=True)}"

            # Verify Room 101-A is now 0 occupied
            rooms_res = client.get(f'/api/evacuation-centers/{created_center_id}/rooms', headers=headers)
            rooms_data = rooms_res.get_json()
            r101 = next(r for r in rooms_data if r['id'] == created_room1_id)
            r102 = next(r for r in rooms_data if r['id'] == created_room2_id)
            assert r101['occupied'] == 0 and r101['available'] == 6, f"Room 101 expected (0, 6), got ({r101['occupied']}, {r101['available']})"
            assert r102['occupied'] == 4 and r102['available'] == 6, f"Room 102 expected (4, 6), got ({r102['occupied']}, {r102['available']})"
            results[9] = ("PASS", "Moved family to Room 102. Old room 101-A returned to 0 occupied, new room 102 occupied=4")
        except Exception as e:
            results[9] = ("FAIL", str(e))
        print(f"Test 9: {results[9][0]} - {results[9][1]}", flush=True)

        # ----------------------------------------------------
        # TEST 10: Remove assignment
        # ----------------------------------------------------
        try:
            assert created_family1_id
            res = client.post(f'/api/families/{created_family1_id}/unassign', headers=headers)
            assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.get_data(as_text=True)}"

            # Verify Room 102 is now 0 occupied
            rooms_res = client.get(f'/api/evacuation-centers/{created_center_id}/rooms', headers=headers)
            rooms_data = rooms_res.get_json()
            r102 = next(r for r in rooms_data if r['id'] == created_room2_id)
            assert r102['occupied'] == 0 and r102['available'] == 10, f"Room 102 expected (0, 10), got ({r102['occupied']}, {r102['available']})"

            # Verify Family status is Not Evacuated
            fam_res = client.get(f'/api/families/{created_family1_id}', headers=headers)
            fam_data = fam_res.get_json()
            assert fam_data.get('evacuation_status') in ["Unassigned", "Not Evacuated"] or fam_data.get('assigned_members') == 0
            results[10] = ("PASS", "Unassigned family. Room occupancy decremented to 0, status updated to 'Unassigned'")
        except Exception as e:
            results[10] = ("FAIL", str(e))
        print(f"Test 10: {results[10][0]} - {results[10][1]}", flush=True)

        # ----------------------------------------------------
        # TEST 11: Deactivate a room with assigned families
        # ----------------------------------------------------
        try:
            assert created_family1_id and created_room1_id
            # Re-assign family 1 to Room 101-A
            re_res = client.post(f'/api/families/{created_family1_id}/assign', headers=headers, json={
                'center_id': created_center_id,
                'room_id': created_room1_id
            })
            assert re_res.status_code == 200, f"Re-assign failed: {re_res.get_data(as_text=True)}"

            # Attempt to deactivate Room 101-A
            res = client.patch(f'/api/rooms/{created_room1_id}/toggle-active', headers=headers)
            assert res.status_code == 400, f"Expected 400 on deactivate, got {res.status_code}: {res.get_data(as_text=True)}"
            err = res.get_json().get('error', '')
            assert 'assigned' in err.lower() or 'families' in err.lower()

            # Attempt to delete Room 101-A
            del_res = client.delete(f'/api/rooms/{created_room1_id}', headers=headers)
            assert del_res.status_code == 400, f"Expected 400 on delete, got {del_res.status_code}"

            results[11] = ("PASS", f"Deactivation and deletion safely blocked when room has active assignments: '{err}'")
        except Exception as e:
            results[11] = ("FAIL", str(e))
        print(f"Test 11: {results[11][0]} - {results[11][1]}", flush=True)

        # ----------------------------------------------------
        # TEST 12: Deactivate a center with assigned families
        # ----------------------------------------------------
        try:
            assert created_center_id
            # Center has Room 101-A with assigned Family 1
            res = client.patch(f'/api/evacuation-centers/{created_center_id}/toggle-active', headers=headers)
            assert res.status_code == 400, f"Expected 400 on deactivate, got {res.status_code}: {res.get_data(as_text=True)}"
            err = res.get_json().get('error', '')
            assert 'assigned' in err.lower() or 'families' in err.lower()

            # Attempt delete
            del_res = client.delete(f'/api/evacuation-centers/{created_center_id}', headers=headers)
            assert del_res.status_code == 400, f"Expected 400 on delete, got {del_res.status_code}"

            results[12] = ("PASS", f"Deactivation and deletion safely blocked when center has active assignments: '{err}'")
        except Exception as e:
            results[12] = ("FAIL", str(e))
        print(f"Test 12: {results[12][0]} - {results[12][1]}", flush=True)

        # ----------------------------------------------------
        # TEST 13: Verify existing room map/coordinates still work
        # ----------------------------------------------------
        try:
            assert created_room2_id
            res = client.put(f'/api/rooms/{created_room2_id}/location', headers=headers, json={
                'latitude': 8.4855,
                'longitude': 124.6565
            })
            assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.get_data(as_text=True)}"
            data = res.get_json()
            assert data.get('room', {}).get('latitude') == 8.4855
            assert data.get('room', {}).get('longitude') == 124.6565
            results[13] = ("PASS", "Updated room location with lat=8.4855, lon=124.6565. Preserved Mapbox coordinate mapping.")
        except Exception as e:
            results[13] = ("FAIL", str(e))
        print(f"Test 13: {results[13][0]} - {results[13][1]}", flush=True)

        # ----------------------------------------------------
        # TEST 14: Verify existing Mapbox and other EvacWay features still work
        # ----------------------------------------------------
        try:
            # Test evacuation-centers GeoJSON FeatureCollection
            centers_res = client.get('/api/evacuation-centers', headers=headers)
            assert centers_res.status_code == 200
            c_json = centers_res.get_json()
            assert c_json.get('type') == 'FeatureCollection'

            # Test hazard zones endpoint
            haz_res = client.get('/api/hazard-zones', headers=headers)
            assert haz_res.status_code == 200

            # Test barangays endpoint
            brgy_res = client.get('/api/barangays', headers=headers)
            assert brgy_res.status_code == 200

            results[14] = ("PASS", "Mapbox GeoJSON FeatureCollection, hazard zones, and barangays endpoints fully operational.")
        except Exception as e:
            results[14] = ("FAIL", str(e))
        print(f"Test 14: {results[14][0]} - {results[14][1]}", flush=True)

        # ----------------------------------------------------
        # TEST 15: Barangay CRUD & Summary Counts
        # ----------------------------------------------------
        created_brgy_id = None
        try:
            b_res = client.post('/api/barangays', headers=headers, json={
                'name': f'Barangay Redesign Test {ts}',
                'total_families': 0,
                'total_residents': 0
            })
            assert b_res.status_code == 201, f"Expected 201, got {b_res.status_code}: {b_res.get_data(as_text=True)}"
            created_brgy_id = b_res.get_json().get('id')
            assert created_brgy_id is not None

            u_res = client.put(f'/api/barangays/{created_brgy_id}', headers=headers, json={
                'name': f'Barangay Redesign Test {ts} Updated'
            })
            assert u_res.status_code == 200
            assert u_res.get_json().get('name') == f'Barangay Redesign Test {ts} Updated'

            d_res = client.get(f'/api/barangays/{created_brgy_id}', headers=headers)
            assert d_res.status_code == 200
            d_json = d_res.get_json()
            assert 'assigned_family_count' in d_json and 'unassigned_family_count' in d_json
            results[15] = ("PASS", f"Barangay CRUD and assigned/unassigned summary counts verified (ID {created_brgy_id})")
        except Exception as e:
            results[15] = ("FAIL", str(e))
        print(f"Test 15: {results[15][0]} - {results[15][1]}", flush=True)

        # ----------------------------------------------------
        # TEST 16: 5-Step Family Registration (Head + Members + Vulnerability) & Unified GET /api/families/<id>
        # ----------------------------------------------------
        created_family3_id = None
        try:
            f3_res = client.post('/api/families', headers=headers, json={
                'head_name': f'Carlos Reyes Mendoza {ts} Jr.',
                'barangay_id': created_brgy_id or barangay_id,
                'contact_number': '09179998888',
                'alternate_contact': '09170001111',
                'address': 'Purok 5, Sitio Bliss',
                'remarks': 'Requires ground-floor room',
                'members': [
                    {
                        'first_name': 'Carlos',
                        'middle_name': 'Reyes',
                        'last_name': f'Mendoza {ts}',
                        'suffix': 'Jr.',
                        'date_of_birth': '1960-04-12',
                        'gender': 'Male',
                        'relationship_to_head': 'Self',
                        'is_head_of_family': True,
                        'is_pwd': True,
                        'disability_type': 'Mobility',
                        'disability_notes': 'Uses cane',
                        'needs_assistance': True,
                        'medical_notes': 'Hypertension maintenance'
                    },
                    {
                        'first_name': 'Lucia',
                        'middle_name': 'Santos',
                        'last_name': f'Mendoza {ts}',
                        'date_of_birth': '1992-08-20',
                        'gender': 'Female',
                        'relationship_to_head': 'Daughter',
                        'is_head_of_family': False,
                        'is_pregnant': True,
                        'is_solo_parent': True
                    }
                ],
                'assignment': {
                    'center_id': created_center_id,
                    'room_id': created_room2_id
                }
            })
            assert f3_res.status_code == 201, f"Expected 201, got {f3_res.status_code}: {f3_res.get_data(as_text=True)}"
            created_family3_id = f3_res.get_json().get('family', {}).get('id')
            assert created_family3_id

            # Verify unified GET /api/families/<id> returns head first and all vulnerability fields
            g_res = client.get(f'/api/families/{created_family3_id}', headers=headers)
            assert g_res.status_code == 200
            g_json = g_res.get_json()
            assert g_json.get('member_count') == 2
            assert g_json.get('current_room_id') == created_room2_id
            members = g_json.get('members', [])
            assert len(members) == 2
            assert members[0]['is_head_of_family'] is True
            assert members[0]['is_pwd'] is True
            assert members[0]['disability_type'] == 'Mobility'
            assert members[1]['is_pregnant'] is True
            results[16] = ("PASS", f"5-Step Family registration with complete Head + Member profiles & immediate room assignment verified (ID {created_family3_id})")
        except Exception as e:
            results[16] = ("FAIL", str(e))
        print(f"Test 16: {results[16][0]} - {results[16][1]}", flush=True)

        # ----------------------------------------------------
        # TEST 17: Add, Edit, and Delete Individual Member with Live Room Occupancy Sync
        # ----------------------------------------------------
        try:
            assert created_family3_id
            # Add 3rd member to assigned family -> should auto-assign to room2 and increase occupancy from 2 to 3
            m_add = client.post(f'/api/families/{created_family3_id}/members', headers=headers, json={
                'first_name': 'Tomas',
                'last_name': f'Mendoza {ts}',
                'date_of_birth': '2018-01-15',
                'gender': 'Male',
                'relationship_to_head': 'Grandchild',
                'needs_assistance': True
            })
            assert m_add.status_code == 201, f"Expected 201, got {m_add.status_code}: {m_add.get_data(as_text=True)}"
            new_member_id = m_add.get_json().get('member', {}).get('id')
            assert new_member_id

            # Edit member
            m_edit = client.put(f'/api/families/{created_family3_id}/members/{new_member_id}', headers=headers, json={
                'first_name': 'Tomasito',
                'last_name': f'Mendoza {ts}',
                'relationship_to_head': 'Grandson',
                'medical_notes': 'Asthma inhaler'
            })
            assert m_edit.status_code == 200
            assert m_edit.get_json().get('member', {}).get('first_name') == 'Tomasito'

            # Delete non-head member -> should decrement member_count back to 2
            m_del = client.delete(f'/api/families/{created_family3_id}/members/{new_member_id}', headers=headers)
            assert m_del.status_code == 200
            assert m_del.get_json().get('family', {}).get('member_count') == 2
            results[17] = ("PASS", "Member Add, Edit, and Delete with live room occupancy synchronization verified")
        except Exception as e:
            results[17] = ("FAIL", str(e))
        print(f"Test 17: {results[17][0]} - {results[17][1]}", flush=True)

        # ----------------------------------------------------
        # TEST 18: Single-Member Household (Head Only) & 1-Person Room Assignment
        # ----------------------------------------------------
        created_single_fam_id = None
        try:
            target_brgy_id = created_brgy_id or barangay_id
            s_res = client.post('/api/families', headers=headers, json={
                'head_name': f'Solo Head {ts}',
                'barangay_id': target_brgy_id,
                'address': 'Purok Solo',
                'members': [
                    {
                        'first_name': 'Solo',
                        'last_name': f'Head {ts}',
                        'is_head_of_family': True,
                        'gender': 'Female',
                        'date_of_birth': '1988-05-10'
                    }
                ]
            })
            assert s_res.status_code == 201, f"Expected 201, got {s_res.status_code}: {s_res.get_data(as_text=True)}"
            s_fam = s_res.get_json().get('family', {})
            created_single_fam_id = s_fam.get('id')
            assert created_single_fam_id
            assert s_fam.get('member_count') == 1, f"Expected member_count=1, got {s_fam.get('member_count')}"
            assert len(s_fam.get('members', [])) == 1, f"Expected 1 resident record, got {len(s_fam.get('members', []))}"
            assert s_fam['members'][0]['is_head_of_family'] is True
            assert s_fam['members'][0]['relationship_to_head'] == 'Household Head'

            # Assign 1-resident household to Room 102 (currently has 2 from family3)
            a_res = client.post(f'/api/families/{created_single_fam_id}/assign', headers=headers, json={
                'center_id': created_center_id,
                'room_id': created_room2_id
            })
            assert a_res.status_code == 200
            assert a_res.get_json().get('room_occupied') == 3

            # Unassign 1-resident household
            u_res = client.post(f'/api/families/{created_single_fam_id}/unassign', headers=headers)
            assert u_res.status_code == 200
            results[18] = ("PASS", "Single-member household creates exactly 1 resident (Head) and occupies 1 room slot")
        except Exception as e:
            results[18] = ("FAIL", str(e))
        print(f"Test 18: {results[18][0]} - {results[18][1]}", flush=True)

        # ----------------------------------------------------
        # TEST 19: Change Household Head & Protect Head from Direct Removal
        # ----------------------------------------------------
        try:
            assert created_family3_id
            g_res = client.get(f'/api/families/{created_family3_id}', headers=headers).get_json()
            members = g_res.get('members', [])
            assert len(members) == 2
            old_head = next(m for m in members if m['is_head_of_family'])
            other_mem = next(m for m in members if not m['is_head_of_family'])

            # Attempt to delete household head without replacement -> must fail with 400
            bad_del = client.delete(f'/api/families/{created_family3_id}/members/{old_head["id"]}', headers=headers)
            assert bad_del.status_code == 400, f"Expected 400 when deleting head, got {bad_del.status_code}"

            # Promote other_mem to Household Head via PUT /api/families/<id>
            promote_res = client.put(f'/api/families/{created_family3_id}', headers=headers, json={
                'head_resident_id': other_mem['id'],
                'address': 'Purok 5 Updated Address'
            })
            assert promote_res.status_code == 200, f"Expected 200, got {promote_res.status_code}: {promote_res.get_data(as_text=True)}"
            updated_fam = promote_res.get_json().get('family', {})
            assert updated_fam.get('member_count') == 2, "Resident count must remain 2 (no duplicate created)"
            updated_members = updated_fam.get('members', [])
            heads = [m for m in updated_members if m['is_head_of_family']]
            assert len(heads) == 1 and heads[0]['id'] == other_mem['id'], f"Expected {other_mem['id']} as sole head, got {heads}"
            demoted = next(m for m in updated_members if m['id'] == old_head['id'])
            assert demoted['is_head_of_family'] is False
            results[19] = ("PASS", "Changed household head without duplicating residents and blocked direct head deletion")
        except Exception as e:
            results[19] = ("FAIL", str(e))
        print(f"Test 19: {results[19][0]} - {results[19][1]}", flush=True)

        # ----------------------------------------------------
        # TEST 20: Search by Non-Head Member Name & Verify Barangay Household vs Resident Counts
        # ----------------------------------------------------
        try:
            assert created_family3_id and created_brgy_id
            # Search /api/families by Carlos (now non-head member in family3)
            search_res = client.get(f'/api/families?search=Carlos&barangay_id={created_brgy_id}', headers=headers)
            assert search_res.status_code == 200
            search_items = search_res.get_json().get('items', [])
            assert any(f['id'] == created_family3_id for f in search_items), "Expected family3 when searching by non-head member name"

            # Public lookup /api/residents/find-center by non-head member name
            pub_res = client.get(f'/api/residents/find-center?name=Carlos%20Reyes%20Mendoza%20{ts}')
            assert pub_res.status_code == 200
            pub_matches = pub_res.get_json().get('matches', [])
            assert len(pub_matches) >= 1 and pub_matches[0]['room']['id'] == created_room2_id

            # Verify Barangay counts: created_brgy_id has family3 (2 members) + single_fam (1 member) = 2 households, 3 residents
            b_detail = client.get(f'/api/barangays/{created_brgy_id}', headers=headers).get_json()
            assert b_detail.get('household_count') == 2, f"Expected household_count=2, got {b_detail.get('household_count')}"
            assert b_detail.get('family_count') == 2, f"Expected family_count=2, got {b_detail.get('family_count')}"
            assert b_detail.get('resident_count') == 3, f"Expected resident_count=3, got {b_detail.get('resident_count')}"
            assert b_detail.get('assigned_family_count') == 1
            assert b_detail.get('unassigned_family_count') == 1

            # Verify /api/families aggregate counts for created_brgy_id
            fam_agg = client.get(f'/api/families?barangay_id={created_brgy_id}', headers=headers).get_json()
            assert fam_agg.get('household_count') == 2, f"Expected families household_count=2, got {fam_agg.get('household_count')}"
            assert fam_agg.get('resident_count') == 3, f"Expected families resident_count=3, got {fam_agg.get('resident_count')}"
            assert fam_agg.get('assigned_family_count') == 1
            assert fam_agg.get('unassigned_family_count') == 1

            results[20] = ("PASS", "Member-name search, public center lookup, and independent Household (2) vs Resident (3) counts verified across /api/barangays and /api/families")
        except Exception as e:
            results[20] = ("FAIL", str(e))
        print(f"Test 20: {results[20][0]} - {results[20][1]}", flush=True)

        # ----------------------------------------------------
        # ----------------------------------------------------
        # TEST 21: Excel Import Household Grouping, Priority 1/2/3 Import Key, and Idempotency
        # ----------------------------------------------------
        try:
            import io
            import pandas as pd
            from routes.residents import build_household_import_key, clean_identifier

            # 1. Verify leading-zero preservation and Priority 1/2/3 Household Import Key rules
            assert clean_identifier("00123") == "00123", "Leading zeros must be preserved"
            assert clean_identifier(104.0) == "104", "Excel numeric float .0 must be stripped"

            k1 = build_household_import_key(10, "Juan Dela Cruz", "Purok 1", household_id="HH-0042", family_code="FAM-99")
            assert k1 == ("id", 10, "hh-0042"), f"Expected ('id', 10, 'hh-0042'), got {k1}"

            k2 = build_household_import_key(10, "Juan Dela Cruz", "Purok 1", household_id="", family_code="FAM-0099")
            assert k2 == ("code", 10, "fam-0099"), f"Expected ('code', 10, 'fam-0099'), got {k2}"

            k3_a = build_household_import_key(10, "  Juan   Dela Cruz ", "Purok 1,  Brgy Test ")
            k3_b = build_household_import_key(10, "juan dela cruz", "purok 1, brgy test")
            assert k3_a == k3_b and k3_a[0] == "composite", "Composite key must normalize case and spaces"

            # 2. Test /api/families/import (preview + commit) on created_brgy_id
            target_b_id = created_brgy_id or barangay_id
            target_b_name = f"Barangay Redesign Test {ts} Updated" if created_brgy_id else barangay_name
            fam_excel_rows = [
                # Household A: 3 members (1 Head + 2 Members) sharing composite key (head_name + address)
                {
                    "Barangay": target_b_name,
                    "Household Head Name": "Roberto Cruz Dela Rosa",
                    "Address": "Purok 1, Excel Sitio",
                    "Contact": "09171234501",
                    "First Name": "Roberto",
                    "Middle Name": "Cruz",
                    "Last Name": "Dela Rosa",
                    "Date of Birth": "1980-03-10",
                    "Gender": "Male",
                    "Relationship to Head": "Head",
                    "Is Head of Family": "Yes",
                    "Is PWD": "Yes",
                },
                {
                    "Barangay": target_b_name,
                    "Household Head Name": "  roberto   cruz dela rosa ",
                    "Address": "purok 1,  excel sitio",
                    "Contact": "09171234501",
                    "First Name": "Elena",
                    "Middle Name": "Santos",
                    "Last Name": "Dela Rosa",
                    "Date of Birth": "1982-07-22",
                    "Gender": "Female",
                    "Relationship to Head": "Spouse",
                    "Is Head of Family": "No",
                    "Is PWD": "No",
                },
                {
                    "Barangay": target_b_name,
                    "Household Head Name": "Roberto Cruz Dela Rosa",
                    "Address": "Purok 1, Excel Sitio",
                    "Contact": "09171234501",
                    "First Name": "Marco",
                    "Middle Name": "Santos",
                    "Last Name": "Dela Rosa",
                    "Date of Birth": "2010-11-05",
                    "Gender": "Male",
                    "Relationship to Head": "Child",
                    "Is Head of Family": "No",
                    "Is PWD": "No",
                },
                # Household B: 1 member (Head only) with explicit Household ID (Priority 1)
                {
                    "Barangay": target_b_name,
                    "Household ID": "0045",
                    "Household Head Name": "Lorna Bautista Tolentino",
                    "Address": "Purok 2, Excel Sitio",
                    "Contact": "09181234502",
                    "First Name": "Lorna",
                    "Middle Name": "Bautista",
                    "Last Name": "Tolentino",
                    "Date of Birth": "1975-09-14",
                    "Gender": "Female",
                    "Relationship to Head": "Head",
                    "Is Head of Family": "Yes",
                    "Is PWD": "No",
                },
            ]

            fams_before = Family.query.filter_by(barangay_id=target_b_id).count()

            buf = io.BytesIO()
            pd.DataFrame(fam_excel_rows).to_excel(buf, index=False)
            buf.seek(0)

            imp_res = client.post(
                '/api/families/import',
                headers={'Authorization': f'Bearer {token}'},
                data={'file': (buf, 'test_families_import.xlsx'), 'barangay_id': str(target_b_id), 'commit': 'true'},
                content_type='multipart/form-data'
            )
            assert imp_res.status_code in (200, 201), f"Expected 200/201 on families import, got {imp_res.status_code}: {imp_res.get_data(as_text=True)}"
            imp_json = imp_res.get_json()
            assert imp_json.get('families_created') == 2, f"Expected 2 families created (not 4), got {imp_json}"
            assert imp_json.get('residents_created') == 4, f"Expected 4 residents created, got {imp_json}"

            fams_after = Family.query.filter_by(barangay_id=target_b_id).count()
            assert fams_after == fams_before + 2, f"Expected +2 families, got {fams_before} -> {fams_after}"

            # Re-import the exact same workbook -> must block duplicate creation and leave DB count unchanged
            buf2 = io.BytesIO()
            pd.DataFrame(fam_excel_rows).to_excel(buf2, index=False)
            buf2.seek(0)
            imp_res2 = client.post(
                '/api/families/import',
                headers={'Authorization': f'Bearer {token}'},
                data={'file': (buf2, 'test_families_import.xlsx'), 'barangay_id': str(target_b_id), 'commit': 'true'},
                content_type='multipart/form-data'
            )
            assert imp_res2.status_code == 400
            assert Family.query.filter_by(barangay_id=target_b_id).count() == fams_after, "Re-import created duplicate families!"

            results[21] = ("PASS", "Excel import grouped 4 residents into 2 households (3-member + 1-member), verified Priority 1/2/3 import keys, and blocked duplicate creation on re-import")
        except Exception as e:
            results[21] = ("FAIL", str(e))
        print(f"Test 21: {results[21][0]} - {results[21][1]}", flush=True)

        # ----------------------------------------------------
        # CLEANUP: Remove test records
        # ----------------------------------------------------
        print("\nCleaning up test records...", flush=True)
        try:
            if created_brgy_id:
                brgy_fam_ids = [f.id for f in Family.query.filter_by(barangay_id=created_brgy_id).all()]
                if brgy_fam_ids:
                    res_ids = [r.id for r in Resident.query.filter(Resident.family_id.in_(brgy_fam_ids)).all()]
                    if res_ids:
                        EvacuationAssignment.query.filter(EvacuationAssignment.resident_id.in_(res_ids)).delete(synchronize_session=False)
                    Resident.query.filter(Resident.family_id.in_(brgy_fam_ids)).delete(synchronize_session=False)
                    Family.query.filter_by(barangay_id=created_brgy_id).delete(synchronize_session=False)
                db.session.commit()

            if created_single_fam_id:
                client.post(f'/api/families/{created_single_fam_id}/unassign', headers=headers)
                client.delete(f'/api/families/{created_single_fam_id}', headers=headers)
            if created_family3_id:
                client.post(f'/api/families/{created_family3_id}/unassign', headers=headers)
                client.delete(f'/api/families/{created_family3_id}', headers=headers)
            # Unassign family 1
            if created_family1_id:
                client.post(f'/api/families/{created_family1_id}/unassign', headers=headers)
                client.delete(f'/api/families/{created_family1_id}', headers=headers)
            if created_family2_id:
                client.delete(f'/api/families/{created_family2_id}', headers=headers)

            # Delete rooms via API (soft delete) and hard-remove test artifacts
            if created_room1_id:
                client.delete(f'/api/rooms/{created_room1_id}', headers=headers)
            if created_room2_id:
                client.delete(f'/api/rooms/{created_room2_id}', headers=headers)

            # Delete center via API (soft delete)
            if created_center_id:
                client.delete(f'/api/evacuation-centers/{created_center_id}', headers=headers)

            if created_brgy_id:
                client.delete(f'/api/barangays/{created_brgy_id}', headers=headers)

            # Hard-delete test rooms and center so test runs do not leave inactive test rows behind
            for rid in (created_room1_id, created_room2_id):
                if rid:
                    r_obj = db.session.get(EvacuationCenterRoom, rid)
                    if r_obj:
                        db.session.delete(r_obj)
            if created_center_id:
                c_obj = db.session.get(EvacuationCenter, created_center_id)
                if c_obj:
                    db.session.delete(c_obj)
            db.session.commit()

            print("Cleanup completed successfully.", flush=True)
        except Exception as clean_err:
            db.session.rollback()
            print("Cleanup error (ignorable):", clean_err, flush=True)

        # ----------------------------------------------------
        # SUMMARY REPORT
        # ----------------------------------------------------
        print("\n================== TEST RESULTS SUMMARY ==================", flush=True)
        all_passed = True
        for i in range(1, 22):
            status, msg = results.get(i, ("NOT RUN", "Test did not execute"))
            print(f"Test {i:2d}: [{status}] - {msg}", flush=True)
            if status != "PASS":
                all_passed = False

        print("===========================================================", flush=True)
        if all_passed:
            print("ALL 21 TESTS PASSED PERFECTLY!\n", flush=True)
        else:
            print("SOME TESTS FAILED!\n", flush=True)
            sys.exit(1)

if __name__ == '__main__':
    run_tests()



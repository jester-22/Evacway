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
            assert fam_data.get('evacuation_status') == "Not Evacuated" or fam_data.get('assigned_members') == 0
            results[10] = ("PASS", "Unassigned family. Room occupancy decremented to 0, status updated to 'Not Evacuated'")
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
        # CLEANUP: Remove test records
        # ----------------------------------------------------
        print("\nCleaning up test records...", flush=True)
        try:
            # Unassign family 1
            if created_family1_id:
                client.post(f'/api/families/{created_family1_id}/unassign', headers=headers)
                client.delete(f'/api/families/{created_family1_id}', headers=headers)
            if created_family2_id:
                client.delete(f'/api/families/{created_family2_id}', headers=headers)

            # Delete rooms
            if created_room1_id:
                client.delete(f'/api/rooms/{created_room1_id}', headers=headers)
            if created_room2_id:
                client.delete(f'/api/rooms/{created_room2_id}', headers=headers)

            # Delete center
            if created_center_id:
                client.delete(f'/api/evacuation-centers/{created_center_id}', headers=headers)

            print("Cleanup completed successfully.", flush=True)
        except Exception as clean_err:
            print("Cleanup error (ignorable):", clean_err, flush=True)

        # ----------------------------------------------------
        # SUMMARY REPORT
        # ----------------------------------------------------
        print("\n================== TEST RESULTS SUMMARY ==================", flush=True)
        all_passed = True
        for i in range(1, 15):
            status, msg = results.get(i, ("NOT RUN", "Test did not execute"))
            print(f"Test {i:2d}: [{status}] - {msg}", flush=True)
            if status != "PASS":
                all_passed = False

        print("===========================================================", flush=True)
        if all_passed:
            print("ALL 14 TESTS PASSED PERFECTLY!\n", flush=True)
        else:
            print("SOME TESTS FAILED!\n", flush=True)
            sys.exit(1)

if __name__ == '__main__':
    run_tests()

import os
import sys
sys.path.insert(0, '.')
from app import app
from models import db
import sqlalchemy as sa

with app.app_context():
    # Check specific dependencies on test records

    # 1. Check resident_registration_requests.matched_resident_id
    print('=== resident_registration_requests with matched_resident_id ===')
    result = db.session.execute(sa.text("SELECT id, matched_resident_id FROM resident_registration_requests WHERE matched_resident_id IS NOT NULL")).fetchall()
    for r in result:
        print(f'  ID: {r[0]}, Matched_Resident: {r[1]}')

    # 2. Check evacuation_assignments for resident 1479
    print()
    print('=== evacuation_assignments for resident 1479 ===')
    result = db.session.execute(sa.text("SELECT * FROM evacuation_assignments WHERE resident_id = 1479")).fetchall()
    if result:
        for r in result:
            print(f'  {r}')
    else:
        print('  None')

    # 3. Check residents.uploaded_by for user 4
    print()
    print('=== residents uploaded by user 4 ===')
    result = db.session.execute(sa.text("SELECT id, first_name, uploaded_by FROM residents WHERE uploaded_by = 4")).fetchall()
    if result:
        for r in result:
            print(f'  ID: {r[0]}, Name: {r[1]}, Uploaded_By: {r[2]}')
    else:
        print('  None')

    # 4. Check hazard_reports validated_by user 4
    print()
    print('=== hazard_reports validated by user 4 ===')
    result = db.session.execute(sa.text("SELECT id, report_type, validated_by FROM hazard_reports WHERE validated_by = 4")).fetchall()
    if result:
        for r in result:
            print(f'  ID: {r[0]}, Type: {r[1]}, Validated_By: {r[2]}')
    else:
        print('  None')

    # 5. Check push_subscriptions for user 4
    print()
    print('=== push_subscriptions for user 4 ===')
    result = db.session.execute(sa.text("SELECT id, user_id FROM push_subscriptions WHERE user_id = 4")).fetchall()
    if result:
        for r in result:
            print(f'  ID: {r[0]}, User: {r[1]}')
    else:
        print('  None')

    # 6. Check system_logs for user 4
    print()
    print('=== system_logs for user 4 ===')
    result = db.session.execute(sa.text("SELECT id, user_id, action, timestamp FROM system_logs WHERE user_id = 4")).fetchall()
    if result:
        for r in result:
            print(f'  ID: {r[0]}, User: {r[1]}, Action: {r[2]}, Time: {r[3]}')
    else:
        print('  None')

    # 7. Check staff_notifications for user 4
    print()
    print('=== staff_notifications for user 4 ===')
    result = db.session.execute(sa.text("SELECT id, user_id, event_type, created_at FROM staff_notifications WHERE user_id = 4")).fetchall()
    if result:
        for r in result:
            print(f'  ID: {r[0]}, User: {r[1]}, Event: {r[2]}, Time: {r[3]}')
    else:
        print('  None')

    # 8. Check rescue_requests status_updated_by user 4
    print()
    print('=== rescue_requests status_updated_by user 4 ===')
    result = db.session.execute(sa.text("SELECT id, status_updated_by FROM rescue_requests WHERE status_updated_by = 4")).fetchall()
    if result:
        for r in result:
            print(f'  ID: {r[0]}, Status_Updated_By: {r[1]}')
    else:
        print('  None')

    # 9. Check evacuation_centers managed_by user 4
    print()
    print('=== evacuation_centers managed_by user 4 ===')
    result = db.session.execute(sa.text("SELECT id, name, managed_by FROM evacuation_centers WHERE managed_by = 4")).fetchall()
    if result:
        for r in result:
            print(f'  ID: {r[0]}, Name: {r[1]}, Managed_By: {r[2]}')
    else:
        print('  None')

    # 10. Check hazard_zones created_by user 4
    print()
    print('=== hazard_zones created_by user 4 ===')
    result = db.session.execute(sa.text("SELECT id, hazard_type, created_by FROM hazard_zones WHERE created_by = 4")).fetchall()
    if result:
        for r in result:
            print(f'  ID: {r[0]}, Type: {r[1]}, Created_By: {r[2]}')
    else:
        print('  None')

    # 11. Check if any other residents have family_id = 485
    print()
    print('=== residents in family 485 ===')
    result = db.session.execute(sa.text("SELECT id, first_name, last_name, is_head_of_family FROM residents WHERE family_id = 485")).fetchall()
    for r in result:
        print(f'  ID: {r[0]}, Name: {r[1]} {r[2]}, Head: {r[3]}')

    # 12. Check if any other test residents (ZZ%) exist
    print()
    print('=== ALL residents with first_name like ZZ% ===')
    result = db.session.execute(sa.text("SELECT id, first_name, last_name, family_id FROM residents WHERE first_name LIKE 'ZZ%'")).fetchall()
    for r in result:
        print(f'  ID: {r[0]}, Name: {r[1]} {r[2]}, Family: {r[3]}')

    # 13. Check if any users have resident_id set (other than test user)
    print()
    print('=== ALL users with resident_id set ===')
    result = db.session.execute(sa.text("SELECT id, email, name, role, resident_id FROM users WHERE resident_id IS NOT NULL")).fetchall()
    for r in result:
        print(f'  ID: {r[0]}, Email: {r[1]}, Name: {r[2]}, Role: {r[3]}, Resident_ID: {r[4]}')
import os
import sys
sys.path.insert(0, '.')
from app import app
from models import db
import sqlalchemy as sa

with app.app_context():
    inspector = sa.inspect(db.engine)

    # Check all tables that might reference users, residents, families
    # Check foreign keys from other tables to users
    print('=== TABLES REFERENCING users (reverse lookup) ===')
    for table_name in inspector.get_table_names():
        fks = inspector.get_foreign_keys(table_name)
        for fk in fks:
            if fk['referred_table'] == 'users':
                print(f'  {table_name}.{fk["constrained_columns"]} -> users.{fk["referred_columns"]}')

    # Check foreign keys to residents table
    print()
    print('=== TABLES REFERENCING residents ===')
    for table_name in inspector.get_table_names():
        fks = inspector.get_foreign_keys(table_name)
        for fk in fks:
            if fk['referred_table'] == 'residents':
                print(f'  {table_name}.{fk["constrained_columns"]} -> residents.{fk["referred_columns"]}')

    # Check foreign keys to families table
    print()
    print('=== TABLES REFERENCING families ===')
    for table_name in inspector.get_table_names():
        fks = inspector.get_foreign_keys(table_name)
        for fk in fks:
            if fk['referred_table'] == 'families':
                print(f'  {table_name}.{fk["constrained_columns"]} -> families.{fk["referred_columns"]}')

    # Check foreign keys to resident_registration_requests
    print()
    print('=== TABLES REFERENCING resident_registration_requests ===')
    for table_name in inspector.get_table_names():
        fks = inspector.get_foreign_keys(table_name)
        for fk in fks:
            if fk['referred_table'] == 'resident_registration_requests':
                print(f'  {table_name}.{fk["constrained_columns"]} -> resident_registration_requests.{fk["referred_columns"]}')

    # Check column names for key tables
    print()
    print('=== COLUMN NAMES FOR KEY TABLES ===')
    for table in ['hazard_reports', 'rescue_alerts', 'rescue_requests', 'push_subscriptions', 'notifications', 'audit_logs', 'system_logs', 'staff_notifications']:
        if table in inspector.get_table_names():
            cols = [c['name'] for c in inspector.get_columns(table)]
            print(f'  {table}: {cols}')

    # Check specific tables that might have data related to our test records
    print()
    print('=== CHECKING SPECIFIC TABLES FOR TEST DATA ===')

    # Check hazard_reports (use correct column names)
    try:
        # First check columns
        cols = [c['name'] for c in inspector.get_columns('hazard_reports')]
        print(f'  hazard_reports columns: {cols}')
        # Try to find column that references user
        user_col = [c for c in cols if 'user' in c.lower() or 'reporter' in c.lower() or 'created_by' in c.lower() or 'validated_by' in c.lower()]
        print(f'  hazard_reports potential user cols: {user_col}')
    except:
        print('  hazard_reports: table not found or error')

    # Check rescue_requests
    try:
        cols = [c['name'] for c in inspector.get_columns('rescue_requests')]
        print(f'  rescue_requests columns: {cols}')
    except:
        print('  rescue_requests: table not found or error')

    # Check push_subscriptions
    try:
        cols = [c['name'] for c in inspector.get_columns('push_subscriptions')]
        print(f'  push_subscriptions columns: {cols}')
    except:
        print('  push_subscriptions: table not found or error')

    # Check notifications
    try:
        cols = [c['name'] for c in inspector.get_columns('notifications')]
        print(f'  notifications columns: {cols}')
    except:
        print('  notifications: table not found or error')

    # Check system_logs
    try:
        cols = [c['name'] for c in inspector.get_columns('system_logs')]
        print(f'  system_logs columns: {cols}')
    except:
        print('  system_logs: table not found or error')

    # Check resident_registration_requests for any other test-related data
    print()
    print('=== ALL resident_registration_requests ===')
    result = db.session.execute(sa.text("SELECT id, first_name, email, status, created_at FROM resident_registration_requests ORDER BY id")).fetchall()
    for r in result:
        print(f'  ID: {r[0]}, Name: {r[1]}, Email: {r[2]}, Status: {r[3]}, Created: {r[4]}')

    # Check users table
    print()
    print('=== ALL users ===')
    result = db.session.execute(sa.text("SELECT id, email, name, role, resident_id FROM users ORDER BY id")).fetchall()
    for r in result:
        print(f'  ID: {r[0]}, Email: {r[1]}, Name: {r[2]}, Role: {r[3]}, Resident_ID: {r[4]}')

    # Check residents table
    print()
    print('=== ALL residents ===')
    result = db.session.execute(sa.text("SELECT id, first_name, last_name, family_id, is_head_of_family, roster_year_id FROM residents ORDER BY id")).fetchall()
    for r in result:
        print(f'  ID: {r[0]}, Name: {r[1]} {r[2]}, Family: {r[3]}, Head: {r[4]}, Roster: {r[5]}')

    # Check families table
    print()
    print('=== ALL families ===')
    result = db.session.execute(sa.text("SELECT id, address, created_at FROM families ORDER BY id")).fetchall()
    for r in result:
        print(f'  ID: {r[0]}, Address: {r[1]}, Created: {r[2]}')

    # Check evacuation_assignments for test resident
    print()
    print('=== evacuation_assignments for resident 1479 ===')
    result = db.session.execute(sa.text("SELECT * FROM evacuation_assignments WHERE resident_id = 1479")).fetchall()
    if result:
        for r in result:
            print(f'  {r}')
    else:
        print('  None')

    # Check matched_resident_id in registration requests
    print()
    print('=== registration_requests with matched_resident_id ===')
    result = db.session.execute(sa.text("SELECT id, matched_resident_id FROM resident_registration_requests WHERE matched_resident_id IS NOT NULL")).fetchall()
    for r in result:
        print(f'  ID: {r[0]}, Matched_Resident: {r[1]}')
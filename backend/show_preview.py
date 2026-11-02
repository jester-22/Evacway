import sys
sys.path.insert(0, '.')
from app import app
from models import db

with app.app_context():
    print('=== PREVIEW: Rows to be deleted ===')

    # registration requests
    r = db.session.execute(db.text("""SELECT id, first_name, last_name, email, status, matched_resident_id, created_at
FROM resident_registration_requests WHERE id IN (1,2,3,4,5,6) ORDER BY id""")).fetchall()
    print('resident_registration_requests (6 rows):')
    for row in r:
        print(f'  {row}')

    # users
    r = db.session.execute(db.text("""SELECT id, email, name, role, resident_id FROM users WHERE id = 4""")).fetchall()
    print('users (1 row):')
    for row in r:
        print(f'  {row}')

    # residents
    r = db.session.execute(db.text("""SELECT id, first_name, last_name, family_id, is_head_of_family FROM residents WHERE id = 1479""")).fetchall()
    print('residents (1 row):')
    for row in r:
        print(f'  {row}')

    # families - check columns first
    from sqlalchemy import inspect
    inspector = inspect(db.engine)
    cols = [c['name'] for c in inspector.get_columns('families')]
    print(f'families columns: {cols}')
    r = db.session.execute(db.text("""SELECT id FROM families WHERE id = 485""")).fetchall()
    print('families (1 row):')
    for row in r:
        print(f'  {row}')

    # family members
    r = db.session.execute(db.text("""SELECT COUNT(*) FROM residents WHERE family_id = 485""")).fetchall()
    print(f'family 485 member count: {r[0][0]}')

    # dependency checks
    checks = [
        ('evacuation_assignments', 'resident_id = 1479'),
        ('residents', 'uploaded_by = 4'),
        ('hazard_reports', 'validated_by = 4'),
        ('push_subscriptions', 'user_id = 4'),
        ('system_logs', 'user_id = 4'),
        ('staff_notifications', 'user_id = 4'),
        ('rescue_requests', 'status_updated_by = 4'),
        ('evacuation_centers', 'managed_by = 4'),
        ('hazard_zones', 'created_by = 4'),
    ]
    print()
    print('=== Dependency checks (should all be 0) ===')
    for table, where in checks:
        r = db.session.execute(db.text(f'SELECT COUNT(*) FROM {table} WHERE {where}')).fetchall()
        print(f'  {table}: {r[0][0]}')

    print()
    print('=== Current counts BEFORE any changes ===')
    for table in ['resident_registration_requests', 'users', 'residents', 'families']:
        r = db.session.execute(db.text(f'SELECT COUNT(*) FROM {table}')).fetchall()
        print(f'  {table}: {r[0][0]}')

    print()
    print('=== Expected counts AFTER deletes (before commit) ===')
    print('  resident_registration_requests: 0 (was 6)')
    print('  users: 3 (was 4, minus 1 test user)')
    print('  residents: 1055 (was 1056, minus 1 test resident)')
    print('  families: 347 (was 348, minus 1 test family)')
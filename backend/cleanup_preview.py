import os
import sys
sys.path.insert(0, '.')
from app import app
from models import db, ResidentRegistrationRequest, User, Resident, Family
import sqlalchemy as sa

with app.app_context():
    # 1. Find all test registration requests
    print('=== RESIDENT_REGISTRATION_REQUESTS (ZZ test records) ===')
    test_requests = ResidentRegistrationRequest.query.filter(
        sa.or_(
            ResidentRegistrationRequest.first_name.like('ZZ%'),
            ResidentRegistrationRequest.email == 'bossviper43@gmail.com',
            ResidentRegistrationRequest.email.like('gesulgajester22+zz%@gmail.com')
        )
    ).all()

    for r in test_requests:
        print(f'  ID: {r.id}, Name: {r.first_name} {r.middle_name or ""} {r.last_name}, Email: {r.email}, Status: {r.status}, Created: {r.created_at}')

    # 2. Find users with those emails or linked to test residents
    print()
    print('=== USERS (test records) ===')
    test_emails = [r.email for r in test_requests]
    test_users = User.query.filter(
        sa.or_(
            User.email.in_(test_emails),
            User.email == 'bossviper43@gmail.com',
            User.email.like('gesulgajester22+zz%@gmail.com'),
            User.resident_id.isnot(None)
        )
    ).all()

    for u in test_users:
        print(f'  ID: {u.id}, Email: {u.email}, Name: {u.name}, Role: {u.role}, Resident_ID: {u.resident_id}')

    # 3. Find ZZ residents and families
    print()
    print('=== RESIDENTS (ZZ test records) ===')
    test_residents = Resident.query.filter(Resident.first_name.like('ZZ%')).all()
    for r in test_residents:
        print(f'  ID: {r.id}, Name: {r.first_name} {r.middle_name or ""} {r.last_name}, Barangay: {r.barangay}, Family_ID: {r.family_id}, Is_Head: {r.is_head_of_family}, Roster_Year_ID: {r.roster_year_id}')

    print()
    print('=== FAMILIES (ZZ test records) ===')
    test_families = Family.query.join(Resident, Family.id == Resident.family_id).filter(Resident.first_name.like('ZZ%')).all()
    for f in test_families:
        members = Resident.query.filter_by(family_id=f.id).all()
        print(f'  ID: {f.id}, Members: {len(members)}')
        for m in members:
            print(f'    Member: ID={m.id}, Name={m.first_name} {m.middle_name or ""} {m.last_name}, Head={m.is_head_of_family}')
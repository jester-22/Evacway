"""
seed.py — Creates the initial admin/LGU login accounts for EvacWay.

All other data (barangays, hazard zones, evacuation centers, roads)
comes from the real import scripts (import_hazards.py, import_roads.py,
etc.) — this file only needs to exist so you have accounts to log in with.

Usage:
    python seed.py
"""

from app import app
from models import db, User
from werkzeug.security import generate_password_hash

with app.app_context():

    print("Clearing existing users...")
    User.query.delete()
    db.session.commit()

    print("Seeding users...")
    admin = User(
        name="EvacWay Admin",
        email="admin@evacway.local",
        password_hash=generate_password_hash("admin123"),
        contact_number="09171234567",
        role="admin"
    )

    lgu_staff = User(
        name="Juan Dela Cruz",
        email="lgu@evacway.local",
        password_hash=generate_password_hash("lgu123"),
        contact_number="09179876543",
        role="lgu_personnel"
    )

    db.session.add_all([admin, lgu_staff])
    db.session.commit()

    print("\nSeeding complete!")
    print(f"  Users: {User.query.count()}")
    print("  Login: admin@evacway.local / admin123")
    print("  Login: lgu@evacway.local / lgu123")
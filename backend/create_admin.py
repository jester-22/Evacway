"""
create_admin.py — Creates the very first Admin account.
Run this once, after your tables exist, so you have a way to log in
and start adding LGU personnel accounts through the actual UI.

Usage:
    python create_admin.py
"""

import os
import sys
from app import app
from models import db, User
from werkzeug.security import generate_password_hash

with app.app_context():
    email = (os.environ.get("INITIAL_ADMIN_EMAIL") or "").strip()
    name = (os.environ.get("INITIAL_ADMIN_NAME") or "EvacWay Admin").strip()
    password = (os.environ.get("INITIAL_ADMIN_PASSWORD") or "").strip()

    if not (email and password):
        try:
            if sys.stdin.isatty():
                email = input("Admin email: ").strip()
                name = input("Admin name: ").strip() or "EvacWay Admin"
                password = input("Admin password: ").strip()
            else:
                print("Error: Set INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD environment variables for non-interactive setup.")
                sys.exit(1)
        except (EOFError, KeyboardInterrupt):
            print("\nAborted.")
            sys.exit(1)

    if User.query.filter_by(email=email).first():
        print("A user with that email already exists.")
    else:
        admin = User(
            name=name,
            email=email,
            password_hash=generate_password_hash(password),
            role="admin",
            is_active=True
        )
        db.session.add(admin)
        db.session.commit()
        print(f"Admin account created: {email}")

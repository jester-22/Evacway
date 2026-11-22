"""Create registration_link_override_logs table.

Additive and idempotent. Run from backend/ with the project virtualenv active:
    python migrate_registration_override_log.py
"""

from sqlalchemy import inspect

from models import RegistrationLinkOverrideLog


def ensure_registration_link_override_logs_table(db_instance):
    """Ensure the `registration_link_override_logs` table exists."""
    RegistrationLinkOverrideLog.__table__.create(bind=db_instance.engine, checkfirst=True)


if __name__ == "__main__":
    from app import app
    from models import db

    with app.app_context():
        ensure_registration_link_override_logs_table(db)
        cols = sorted(
            col["name"]
            for col in inspect(db.engine).get_columns("registration_link_override_logs")
        )
        print("registration_link_override_logs columns:", cols)

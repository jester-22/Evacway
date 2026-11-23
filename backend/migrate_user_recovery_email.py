"""Add optional recovery_email column to users for 2FA & password reset delivery.

Additive and idempotent. Run from backend/ with the project virtualenv active:
    python migrate_user_recovery_email.py
"""

from sqlalchemy import inspect, text


def ensure_user_recovery_email_column(db_instance):
    """Ensure `users` has the nullable `recovery_email` column."""
    engine = db_instance.engine
    inspector = inspect(engine)
    if not inspector.has_table("users"):
        return

    cols = {col["name"] for col in inspector.get_columns("users")}
    if "recovery_email" not in cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN recovery_email VARCHAR(120)"))


if __name__ == "__main__":
    from app import app
    from models import db

    with app.app_context():
        ensure_user_recovery_email_column(db)
        cols = sorted(col["name"] for col in inspect(db.engine).get_columns("users"))
        print("users columns:", cols)

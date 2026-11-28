"""Add email confirmation columns and pending_confirmation status to resident_registration_requests.

Additive and idempotent. Run from backend/ with the project virtualenv active:
    python migrate_registration_confirmation.py
"""

from sqlalchemy import inspect, text


def ensure_registration_confirmation_columns(db_instance):
    """Ensure resident_registration_requests supports email-confirmation activation."""
    engine = db_instance.engine
    inspector = inspect(engine)
    if not inspector.has_table("resident_registration_requests"):
        return

    cols = {col["name"]: col for col in inspector.get_columns("resident_registration_requests")}
    dialect = engine.dialect.name
    timestamp_type = "TIMESTAMP" if dialect == "postgresql" else "DATETIME"

    with engine.begin() as conn:
        if "confirmation_token_hash" not in cols:
            conn.execute(text(
                "ALTER TABLE resident_registration_requests "
                "ADD COLUMN confirmation_token_hash VARCHAR(128)"
            ))
        if "confirmation_expires_at" not in cols:
            conn.execute(text(
                f"ALTER TABLE resident_registration_requests "
                f"ADD COLUMN confirmation_expires_at {timestamp_type}"
            ))
        if "confirmation_sent_at" not in cols:
            conn.execute(text(
                f"ALTER TABLE resident_registration_requests "
                f"ADD COLUMN confirmation_sent_at {timestamp_type}"
            ))
        if "confirmed_at" not in cols:
            conn.execute(text(
                f"ALTER TABLE resident_registration_requests "
                f"ADD COLUMN confirmed_at {timestamp_type}"
            ))

        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_resident_registration_requests_confirmation_token_hash "
            "ON resident_registration_requests (confirmation_token_hash)"
        ))

        if dialect == "postgresql":
            status_col = cols.get("status")
            status_len = getattr(status_col.get("type"), "length", None) if status_col else None
            if status_len is not None and status_len < 30:
                conn.execute(text(
                    "ALTER TABLE resident_registration_requests "
                    "ALTER COLUMN status TYPE VARCHAR(30)"
                ))

            # Ensure status check constraint includes 'pending_confirmation'
            existing_def = conn.execute(text(
                "SELECT pg_get_constraintdef(c.oid) "
                "FROM pg_constraint c "
                "JOIN pg_class t ON t.oid = c.conrelid "
                "WHERE t.relname = 'resident_registration_requests' "
                "  AND c.conname = 'ck_resident_registration_request_status'"
            )).scalar()
            if existing_def is None or "pending_confirmation" not in existing_def:
                conn.execute(text(
                    "ALTER TABLE resident_registration_requests "
                    "DROP CONSTRAINT IF EXISTS ck_resident_registration_request_status"
                ))
                conn.execute(text(
                    "ALTER TABLE resident_registration_requests "
                    "ADD CONSTRAINT ck_resident_registration_request_status "
                    "CHECK (status IN ('pending', 'pending_confirmation', 'approved', 'rejected'))"
                ))


if __name__ == "__main__":
    from app import app
    from models import db

    with app.app_context():
        ensure_registration_confirmation_columns(db)
        cols = sorted(
            col["name"]
            for col in inspect(db.engine).get_columns("resident_registration_requests")
        )
        print("resident_registration_requests columns:", cols)

"""Add handed_to_agency, notes, and status_updated_at columns to rescue_requests.

Additive and idempotent. Run from backend/ with the project virtualenv active:
    python migrate_rescue_handoff_notes.py
"""

from sqlalchemy import inspect, text


def ensure_rescue_handoff_notes_columns(db_instance):
    """Ensure `rescue_requests` has handed_to_agency, notes, and status_updated_at columns."""
    engine = db_instance.engine
    inspector = inspect(engine)
    if not inspector.has_table("rescue_requests"):
        return

    cols = {col["name"] for col in inspector.get_columns("rescue_requests")}
    with engine.begin() as conn:
        if "handed_to_agency" not in cols:
            conn.execute(text("ALTER TABLE rescue_requests ADD COLUMN handed_to_agency VARCHAR(150)"))
        if "notes" not in cols:
            conn.execute(text("ALTER TABLE rescue_requests ADD COLUMN notes TEXT"))
        if "status_updated_at" not in cols:
            conn.execute(text("ALTER TABLE rescue_requests ADD COLUMN status_updated_at TIMESTAMP"))
            conn.execute(
                text(
                    "UPDATE rescue_requests "
                    "SET status_updated_at = COALESCE(updated_at, created_at) "
                    "WHERE status_updated_at IS NULL"
                )
            )


if __name__ == "__main__":
    from app import app
    from models import db

    with app.app_context():
        ensure_rescue_handoff_notes_columns(db)
        columns = sorted(
            col["name"] for col in inspect(db.engine).get_columns("rescue_requests")
        )
        print("rescue_requests columns:", columns)

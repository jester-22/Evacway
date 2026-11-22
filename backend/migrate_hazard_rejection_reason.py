"""Add rejection_reason column to hazard_reports.

Additive and idempotent. Run from backend/ with the project virtualenv active:
    python migrate_hazard_rejection_reason.py
"""

from sqlalchemy import inspect, text


def ensure_hazard_report_rejection_reason_column(db_instance):
    """Ensure `hazard_reports` has the rejection_reason column."""
    engine = db_instance.engine
    inspector = inspect(engine)
    if not inspector.has_table("hazard_reports"):
        return

    cols = {col["name"] for col in inspector.get_columns("hazard_reports")}
    if "rejection_reason" not in cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE hazard_reports ADD COLUMN rejection_reason TEXT"))


if __name__ == "__main__":
    from app import app
    from models import db

    with app.app_context():
        ensure_hazard_report_rejection_reason_column(db)
        columns = sorted(
            col["name"] for col in inspect(db.engine).get_columns("hazard_reports")
        )
        print("hazard_reports columns:", columns)

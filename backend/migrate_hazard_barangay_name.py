"""Add barangay_name column to hazard_reports.

Additive and idempotent. Run from backend/ with the project virtualenv active:
    python migrate_hazard_barangay_name.py
"""

from sqlalchemy import inspect, text


def ensure_hazard_report_barangay_name_column(db_instance):
    """Ensure `hazard_reports` has the barangay_name column."""
    engine = db_instance.engine
    inspector = inspect(engine)
    if not inspector.has_table("hazard_reports"):
        return

    cols = {col["name"] for col in inspector.get_columns("hazard_reports")}
    if "barangay_name" not in cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE hazard_reports ADD COLUMN barangay_name VARCHAR(100)"))


if __name__ == "__main__":
    from app import app
    from models import db

    with app.app_context():
        ensure_hazard_report_barangay_name_column(db)
        columns = sorted(
            col["name"] for col in inspect(db.engine).get_columns("hazard_reports")
        )
        print("hazard_reports columns:", columns)

"""Add duplicate_of column to hazard_reports.

Additive and idempotent. Run from backend/ with the project virtualenv active:
    python migrate_hazard_duplicate_of.py
"""

from sqlalchemy import inspect, text


def ensure_hazard_report_duplicate_of_column(db_instance):
    """Ensure `hazard_reports` has the duplicate_of column referencing hazard_reports(id)."""
    engine = db_instance.engine
    inspector = inspect(engine)
    if not inspector.has_table("hazard_reports"):
        return

    cols = {col["name"] for col in inspector.get_columns("hazard_reports")}
    if "duplicate_of" not in cols:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "ALTER TABLE hazard_reports "
                    "ADD COLUMN duplicate_of INTEGER REFERENCES hazard_reports(id) ON DELETE SET NULL"
                )
            )


if __name__ == "__main__":
    from app import app
    from models import db

    with app.app_context():
        ensure_hazard_report_duplicate_of_column(db)
        columns = sorted(
            col["name"] for col in inspect(db.engine).get_columns("hazard_reports")
        )
        print("hazard_reports columns:", columns)

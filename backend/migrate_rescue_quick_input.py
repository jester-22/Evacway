"""Additive fields for quick rescue request details.

Usage (from inside backend/, with venv activated):
    python migrate_rescue_quick_input.py
"""
from sqlalchemy import inspect, text

from app import app
from models import db

STATEMENTS = [
    "ALTER TABLE rescue_requests ADD COLUMN IF NOT EXISTS selected_needs TEXT",
    "ALTER TABLE rescue_requests ADD COLUMN IF NOT EXISTS people_count INTEGER",
    "ALTER TABLE rescue_requests ADD COLUMN IF NOT EXISTS vulnerability_flags TEXT",
]


if __name__ == "__main__":
    with app.app_context():
        with db.engine.begin() as conn:
            for stmt in STATEMENTS:
                conn.execute(text(stmt))

        cols = {column["name"] for column in inspect(db.engine).get_columns("rescue_requests")}
        missing = {"selected_needs", "people_count", "vulnerability_flags"} - cols
        print("Missing:", sorted(missing) if missing else "none - migration complete.")

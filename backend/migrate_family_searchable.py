"""Default Find someone family search to hidden.

Existing families are hidden when the searchable column is first added. On a
later run, existing opt-in choices are preserved.

Usage (from inside backend/, with the project environment active):
    python migrate_family_searchable.py
"""
from sqlalchemy import inspect, text

from app import app
from models import db


if __name__ == "__main__":
    with app.app_context():
        existing_columns = {
            column["name"] for column in inspect(db.engine).get_columns("families")
        }
        with db.engine.begin() as connection:
            if "searchable" not in existing_columns:
                connection.execute(text(
                    "ALTER TABLE families ADD COLUMN searchable BOOLEAN NOT NULL DEFAULT FALSE"
                ))
                connection.execute(text("UPDATE families SET searchable = FALSE"))
            connection.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_families_searchable_barangay "
                "ON families (searchable, barangay_id)"
            ))

        columns = {column["name"] for column in inspect(db.engine).get_columns("families")}
        missing = {"searchable"} - columns
        print("Missing:", sorted(missing) if missing else "none - migration complete.")

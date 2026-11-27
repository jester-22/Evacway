"""Default family center search visibility to opt-out (searchable=TRUE).

Residents can turn off family search visibility from their own account
(find_someone_opt_out=TRUE, searchable=FALSE). Existing explicit opt-out
choices are preserved.

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
                    "ALTER TABLE families ADD COLUMN searchable BOOLEAN NOT NULL DEFAULT TRUE"
                ))
            else:
                connection.execute(text(
                    "ALTER TABLE families ALTER COLUMN searchable SET DEFAULT TRUE"
                ))
            if "find_someone_opt_out" in existing_columns:
                connection.execute(text(
                    "UPDATE families SET searchable = TRUE "
                    "WHERE COALESCE(find_someone_opt_out, FALSE) = FALSE"
                ))
                connection.execute(text(
                    "UPDATE families SET searchable = FALSE "
                    "WHERE find_someone_opt_out = TRUE"
                ))
            connection.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_families_searchable_barangay "
                "ON families (searchable, barangay_id)"
            ))

        columns = {column["name"] for column in inspect(db.engine).get_columns("families")}
        missing = {"searchable"} - columns
        print("Missing:", sorted(missing) if missing else "none - migration complete.")

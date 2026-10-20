"""
migrate_rescue_requester.py - Adds the requester/proof columns to rescue_requests.

Additive and idempotent (ADD COLUMN IF NOT EXISTS). Existing rows get '' for
name/contact and NULL for proof_images. No data is modified or deleted.

Usage (from inside backend/, with venv activated):
    python migrate_rescue_requester.py
"""

from sqlalchemy import inspect, text

from app import app
from models import db

STATEMENTS = [
    "ALTER TABLE rescue_requests ADD COLUMN IF NOT EXISTS requester_name VARCHAR(100) NOT NULL DEFAULT ''",
    "ALTER TABLE rescue_requests ADD COLUMN IF NOT EXISTS requester_contact VARCHAR(20) NOT NULL DEFAULT ''",
    "ALTER TABLE rescue_requests ADD COLUMN IF NOT EXISTS proof_images TEXT",
]


if __name__ == "__main__":
    with app.app_context():
        with db.engine.begin() as conn:
            for stmt in STATEMENTS:
                conn.execute(text(stmt))

        cols = [c["name"] for c in inspect(db.engine).get_columns("rescue_requests")]
        print("rescue_requests columns:", cols)
        missing = {"requester_name", "requester_contact", "proof_images"} - set(cols)
        print("Missing:", sorted(missing) if missing else "none - migration complete.")


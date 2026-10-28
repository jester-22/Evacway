"""
migrate_checkin.py — Idempotent migration to add `checked_in_at` to `evacuation_assignments`.
Existing rows default to NULL ("not checked in"), and no existing data is modified.
"""

import os
import sys
import psycopg2
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL is not set in .env")
    sys.exit(1)


def run_migration():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    cur = conn.cursor()

    try:
        cur.execute("""
            ALTER TABLE evacuation_assignments
            ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NULL;
        """)
        conn.commit()
        print("Migration completed successfully: checked_in_at added to evacuation_assignments.")
    except Exception as exc:
        conn.rollback()
        print(f"Migration failed: {exc}")
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    run_migration()


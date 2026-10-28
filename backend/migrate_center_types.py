"""
migrate_center_types.py — Migration to support:
1. center_type ('campus', 'single_venue', 'private_property') on evacuation_centers
2. owner_name on evacuation_centers
3. evacuation_center_id on evacuation_assignments
4. room_id nullable on evacuation_assignments
5. Backfill evacuation_center_id on existing assignments from room_id -> evacuation_center_rooms.evacuation_center_id
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
        # 1. Add center_type and owner_name to evacuation_centers
        cur.execute("""
            ALTER TABLE evacuation_centers
            ADD COLUMN IF NOT EXISTS center_type VARCHAR(50) NOT NULL DEFAULT 'campus';
        """)
        cur.execute("""
            ALTER TABLE evacuation_centers
            ADD COLUMN IF NOT EXISTS owner_name VARCHAR(150) DEFAULT NULL;
        """)

        # 2. Add evacuation_center_id to evacuation_assignments
        cur.execute("""
            ALTER TABLE evacuation_assignments
            ADD COLUMN IF NOT EXISTS evacuation_center_id INTEGER REFERENCES evacuation_centers(id) ON DELETE CASCADE;
        """)

        # 3. Drop NOT NULL on room_id so assignments can be center-level directly
        cur.execute("""
            ALTER TABLE evacuation_assignments
            ALTER COLUMN room_id DROP NOT NULL;
        """)

        # 4. Backfill evacuation_center_id for existing assignments
        cur.execute("""
            UPDATE evacuation_assignments ea
            SET evacuation_center_id = ecr.evacuation_center_id
            FROM evacuation_center_rooms ecr
            WHERE ea.room_id = ecr.id
              AND ea.evacuation_center_id IS NULL;
        """)

        conn.commit()
        print("Migration successful: center_type, owner_name, and direct evacuation_center_id added & backfilled.")
    except Exception as exc:
        conn.rollback()
        print(f"Migration failed: {exc}")
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    run_migration()


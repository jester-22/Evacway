"""
Migration: Add building limits and details (idempotent)
Upgrade:
- evacuation_center_buildings: max_rooms INTEGER (NULL = no limit), floors INTEGER (nullable, no default),
  status VARCHAR(20) (backfill NULL to 'open', then DEFAULT 'open' NOT NULL), notes TEXT
- evacuation_centers: max_rooms INTEGER (only meaningful for private_property)
- CHECK constraints: status IN ('open','closed','under_repair'), max_rooms >= 1 when not NULL,
  floors >= 1 when not NULL, center max_rooms >= 1 when not NULL
Rollback: drop constraints, then columns (deletes any values entered after migration)
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
        # ============================================================
        # evacuation_center_buildings: add columns
        # ============================================================
        cur.execute("""
            ALTER TABLE evacuation_center_buildings
            ADD COLUMN IF NOT EXISTS max_rooms INTEGER
        """)

        cur.execute("""
            ALTER TABLE evacuation_center_buildings
            ADD COLUMN IF NOT EXISTS floors INTEGER
        """)

        cur.execute("""
            ALTER TABLE evacuation_center_buildings
            ADD COLUMN IF NOT EXISTS status VARCHAR(20)
        """)

        cur.execute("""
            ALTER TABLE evacuation_center_buildings
            ADD COLUMN IF NOT EXISTS notes TEXT
        """)

        # Backfill status: NULL -> 'open'
        cur.execute("""
            UPDATE evacuation_center_buildings
            SET status = 'open'
            WHERE status IS NULL
        """)
        print(f"  Backfilled status for {cur.rowcount} building(s)")

        # Set default and NOT NULL for status
        cur.execute("""
            ALTER TABLE evacuation_center_buildings
            ALTER COLUMN status SET DEFAULT 'open'
        """)
        cur.execute("""
            ALTER TABLE evacuation_center_buildings
            ALTER COLUMN status SET NOT NULL
        """)

        # ============================================================
        # evacuation_centers: add max_rooms (for private_property)
        # ============================================================
        cur.execute("""
            ALTER TABLE evacuation_centers
            ADD COLUMN IF NOT EXISTS max_rooms INTEGER
        """)

        # ============================================================
        # CHECK constraints (idempotent: DROP IF EXISTS then ADD)
        # ============================================================

        # Building status
        cur.execute("""
            ALTER TABLE evacuation_center_buildings
            DROP CONSTRAINT IF EXISTS chk_building_status
        """)
        cur.execute("""
            ALTER TABLE evacuation_center_buildings
            ADD CONSTRAINT chk_building_status
            CHECK (status IN ('open', 'closed', 'under_repair'))
        """)

        # Building max_rooms
        cur.execute("""
            ALTER TABLE evacuation_center_buildings
            DROP CONSTRAINT IF EXISTS chk_building_max_rooms
        """)
        cur.execute("""
            ALTER TABLE evacuation_center_buildings
            ADD CONSTRAINT chk_building_max_rooms
            CHECK (max_rooms IS NULL OR max_rooms >= 1)
        """)

        # Building floors
        cur.execute("""
            ALTER TABLE evacuation_center_buildings
            DROP CONSTRAINT IF EXISTS chk_building_floors
        """)
        cur.execute("""
            ALTER TABLE evacuation_center_buildings
            ADD CONSTRAINT chk_building_floors
            CHECK (floors IS NULL OR floors >= 1)
        """)

        # Center max_rooms (for private_property)
        cur.execute("""
            ALTER TABLE evacuation_centers
            DROP CONSTRAINT IF EXISTS chk_center_max_rooms
        """)
        cur.execute("""
            ALTER TABLE evacuation_centers
            ADD CONSTRAINT chk_center_max_rooms
            CHECK (max_rooms IS NULL OR max_rooms >= 1)
        """)

        conn.commit()
        print("Migration applied successfully.")

        # Verification
        cur.execute("""
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_name = 'evacuation_center_buildings'
            AND column_name IN ('max_rooms', 'floors', 'status', 'notes')
            ORDER BY column_name
        """)
        print("\nBuilding columns:")
        for r in cur.fetchall():
            print(f"  {r[0]}: {r[1]} | nullable={r[2]} | default={r[3]}")

        cur.execute("""
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_name = 'evacuation_centers'
            AND column_name = 'max_rooms'
        """)
        print("\nCenter columns:")
        for r in cur.fetchall():
            print(f"  {r[0]}: {r[1]} | nullable={r[2]} | default={r[3]}")

        cur.execute("""
            SELECT conname, contype, pg_get_constraintdef(oid)
            FROM pg_constraint
            WHERE conrelid IN (
                'evacuation_center_buildings'::regclass,
                'evacuation_centers'::regclass
            )
            AND conname IN ('chk_building_status', 'chk_building_max_rooms', 'chk_building_floors', 'chk_center_max_rooms')
        """)
        print("\nConstraints:")
        for r in cur.fetchall():
            print(f"  {r[0]}: {r[2]}")

        cur.execute("""
            SELECT id, name, max_rooms, floors, status, notes
            FROM evacuation_center_buildings
            ORDER BY id
        """)
        print("\nBuildings data:")
        for r in cur.fetchall():
            print(f"  {r[0]}: {r[1]} | max_rooms={r[2]} | floors={r[3]} | status={r[4]} | notes={r[5]}")

    except Exception as exc:
        conn.rollback()
        print(f"Migration failed: {exc}")
        raise
    finally:
        cur.close()
        conn.close()


def rollback_migration():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    cur = conn.cursor()

    try:
        # Drop constraints
        cur.execute("ALTER TABLE evacuation_center_buildings DROP CONSTRAINT IF EXISTS chk_building_status")
        cur.execute("ALTER TABLE evacuation_center_buildings DROP CONSTRAINT IF EXISTS chk_building_max_rooms")
        cur.execute("ALTER TABLE evacuation_center_buildings DROP CONSTRAINT IF EXISTS chk_building_floors")
        cur.execute("ALTER TABLE evacuation_centers DROP CONSTRAINT IF EXISTS chk_center_max_rooms")

        # Drop columns (NOTE: this deletes any values entered after migration)
        cur.execute("ALTER TABLE evacuation_center_buildings DROP COLUMN IF EXISTS max_rooms")
        cur.execute("ALTER TABLE evacuation_center_buildings DROP COLUMN IF EXISTS floors")
        cur.execute("ALTER TABLE evacuation_center_buildings DROP COLUMN IF EXISTS status")
        cur.execute("ALTER TABLE evacuation_center_buildings DROP COLUMN IF EXISTS notes")
        cur.execute("ALTER TABLE evacuation_centers DROP COLUMN IF EXISTS max_rooms")

        conn.commit()
        print("Rollback successful.")
    except Exception as exc:
        conn.rollback()
        print(f"Rollback failed: {exc}")
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--rollback":
        rollback_migration()
    else:
        run_migration()
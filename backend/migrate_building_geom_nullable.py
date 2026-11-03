"""
Migration: Make building geom column nullable (idempotent)
Allows creating buildings without geometry initially, then mapping them later.
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
        # Check if geom column is already nullable
        cur.execute("""
            SELECT is_nullable
            FROM information_schema.columns
            WHERE table_name = 'evacuation_center_buildings'
            AND column_name = 'geom'
        """)
        result = cur.fetchone()

        if result and result[0] == 'YES':
            print("geom column is already nullable. No changes needed.")
        else:
            print("Making geom column nullable...")
            # Drop the NOT NULL constraint on geom column
            cur.execute("""
                ALTER TABLE evacuation_center_buildings
                ALTER COLUMN geom DROP NOT NULL
            """)
            print("geom column is now nullable.")

        conn.commit()
        print("Migration applied successfully.")

        # Verification
        cur.execute("""
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_name = 'evacuation_center_buildings'
            AND column_name = 'geom'
        """)
        print("\nBuilding geom column:")
        for r in cur.fetchall():
            print(f"  {r[0]}: {r[1]} | nullable={r[2]} | default={r[3]}")

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
        # Make geom column NOT NULL again (requires all existing rows to have geom)
        cur.execute("""
            ALTER TABLE evacuation_center_buildings
            ALTER COLUMN geom SET NOT NULL
        """)

        conn.commit()
        print("Rollback successful - geom column is now NOT NULL.")
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
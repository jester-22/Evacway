"""
migrate_finalize_evacuation_centers.py — Fully transitions evacuation_centers:
1. Replaces raw text building_material VARCHAR(50) with building_material_id INTEGER (FK)
2. Replaces raw text center_type VARCHAR(50) with center_type_id INTEGER (FK)
3. Moves accessibility from raw text accessibility_notes to center_accessibility_features M2M table
4. Drops the legacy text columns so the table schema matches the relational design.
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
        # Step 1: Ensure center_type_id and building_material_id columns exist
        cur.execute("""
            ALTER TABLE evacuation_centers
            ADD COLUMN IF NOT EXISTS center_type_id INTEGER REFERENCES center_types(id) ON DELETE SET NULL;
        """)
        cur.execute("""
            ALTER TABLE evacuation_centers
            ADD COLUMN IF NOT EXISTS building_material_id INTEGER REFERENCES building_materials(id) ON DELETE SET NULL;
        """)

        # Step 2: Ensure center_accessibility_features table exists
        cur.execute("""
            CREATE TABLE IF NOT EXISTS center_accessibility_features (
                center_id INTEGER NOT NULL REFERENCES evacuation_centers(id) ON DELETE CASCADE,
                feature_id INTEGER NOT NULL REFERENCES accessibility_features(id) ON DELETE CASCADE,
                PRIMARY KEY (center_id, feature_id)
            );
        """)

        # Step 3: Backfill center_type_id from center_type column if it exists
        cur.execute("""
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'evacuation_centers' AND column_name = 'center_type';
        """)
        if cur.fetchone():
            cur.execute("""
                UPDATE evacuation_centers ec
                SET center_type_id = ct.id
                FROM center_types ct
                WHERE (ec.center_type = ct.code OR lower(ec.center_type) = lower(ct.name))
                  AND ec.center_type_id IS NULL;
            """)
            # Default any remaining to 'campus' (id=1)
            cur.execute("""
                UPDATE evacuation_centers
                SET center_type_id = (SELECT id FROM center_types WHERE code = 'campus' LIMIT 1)
                WHERE center_type_id IS NULL;
            """)

        # Step 4: Backfill building_material_id from building_material column if it exists
        cur.execute("""
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'evacuation_centers' AND column_name = 'building_material';
        """)
        if cur.fetchone():
            # Specific mappings for existing text
            cur.execute("""
                UPDATE evacuation_centers
                SET building_material_id = (SELECT id FROM building_materials WHERE code = 'reinforced_concrete' LIMIT 1)
                WHERE building_material_id IS NULL AND (
                    lower(building_material) LIKE '%reinforced%' OR lower(building_material) = 'concrete'
                );
            """)
            cur.execute("""
                UPDATE evacuation_centers
                SET building_material_id = (SELECT id FROM building_materials WHERE code = 'concrete_steel_frame' LIMIT 1)
                WHERE building_material_id IS NULL AND (
                    lower(building_material) LIKE '%hollow block%' OR lower(building_material) LIKE '%steel%'
                );
            """)
            cur.execute("""
                UPDATE evacuation_centers
                SET building_material_id = (SELECT id FROM building_materials WHERE code = 'semi_permanent' LIMIT 1)
                WHERE building_material_id IS NULL AND (
                    lower(building_material) LIKE '%timber%' OR lower(building_material) LIKE '%masonry%'
                );
            """)

        # Step 5: Backfill center_accessibility_features from accessibility_notes column if it exists
        cur.execute("""
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'evacuation_centers' AND column_name = 'accessibility_notes';
        """)
        if cur.fetchone():
            cur.execute("""
                INSERT INTO center_accessibility_features (center_id, feature_id)
                SELECT ec.id, af.id
                FROM evacuation_centers ec
                CROSS JOIN accessibility_features af
                WHERE ec.accessibility_notes IS NOT NULL
                  AND (
                    (lower(ec.accessibility_notes) LIKE '%ramp%' AND af.code = 'wheelchair_ramp')
                    OR (lower(ec.accessibility_notes) LIKE '%ground%' AND af.code = 'ground_floor_access')
                    OR (lower(ec.accessibility_notes) LIKE '%restroom%' AND af.code = 'pwd_restroom')
                    OR (lower(ec.accessibility_notes) LIKE '%door%' AND af.code = 'wide_doorways')
                    OR (lower(ec.accessibility_notes) LIKE '%rail%' AND af.code = 'handrails')
                  )
                ON CONFLICT DO NOTHING;
            """)

        # Step 6: DROP the legacy text columns
        cur.execute("""
            ALTER TABLE evacuation_centers DROP COLUMN IF EXISTS building_material CASCADE;
        """)
        cur.execute("""
            ALTER TABLE evacuation_centers DROP COLUMN IF EXISTS accessibility_notes CASCADE;
        """)
        cur.execute("""
            ALTER TABLE evacuation_centers DROP COLUMN IF EXISTS center_type CASCADE;
        """)

        # Make center_type_id NOT NULL with default to 1 (campus)
        cur.execute("""
            ALTER TABLE evacuation_centers
            ALTER COLUMN center_type_id SET NOT NULL;
        """)

        conn.commit()
        print("Successfully migrated evacuation_centers: text columns dropped, FKs and M2M table now active!")
    except Exception as exc:
        conn.rollback()
        print(f"Migration failed: {exc}")
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    run_migration()


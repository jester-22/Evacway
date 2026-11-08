"""
migrate_evacuation_centers_relations.py — Links evacuation_centers to:
1. center_types via center_type_id (FK)
2. building_materials via building_material_id (FK)
3. accessibility_features via center_accessibility_features junction table (M2M)
and backfills existing center data.
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
        # 1. Add center_type_id to evacuation_centers
        cur.execute("""
            ALTER TABLE evacuation_centers
            ADD COLUMN IF NOT EXISTS center_type_id INTEGER REFERENCES center_types(id) ON DELETE SET NULL;
        """)

        # 2. Add building_material_id to evacuation_centers
        cur.execute("""
            ALTER TABLE evacuation_centers
            ADD COLUMN IF NOT EXISTS building_material_id INTEGER REFERENCES building_materials(id) ON DELETE SET NULL;
        """)

        # 3. Create junction table for many-to-many center accessibility features
        cur.execute("""
            CREATE TABLE IF NOT EXISTS center_accessibility_features (
                center_id INTEGER NOT NULL REFERENCES evacuation_centers(id) ON DELETE CASCADE,
                feature_id INTEGER NOT NULL REFERENCES accessibility_features(id) ON DELETE CASCADE,
                PRIMARY KEY (center_id, feature_id)
            );
        """)

        # 4. Backfill center_type_id based on center_type code or name
        cur.execute("""
            UPDATE evacuation_centers ec
            SET center_type_id = ct.id
            FROM center_types ct
            WHERE (ec.center_type = ct.code OR lower(ec.center_type) = lower(ct.name))
              AND ec.center_type_id IS NULL;
        """)

        # Default any remaining centers without a type to 'campus' (id 1 or first active)
        cur.execute("""
            UPDATE evacuation_centers
            SET center_type_id = (SELECT id FROM center_types WHERE code = 'campus' LIMIT 1)
            WHERE center_type_id IS NULL;
        """)

        # 5. Backfill building_material_id based on building_material text match
        cur.execute("""
            UPDATE evacuation_centers ec
            SET building_material_id = bm.id
            FROM building_materials bm
            WHERE (lower(ec.building_material) = lower(bm.name) OR lower(ec.building_material) = lower(bm.code) OR lower(ec.building_material) LIKE '%' || lower(bm.name) || '%')
              AND ec.building_material_id IS NULL;
        """)

        # 6. Backfill junction table from accessibility_notes text
        cur.execute("""
            INSERT INTO center_accessibility_features (center_id, feature_id)
            SELECT ec.id, af.id
            FROM evacuation_centers ec
            CROSS JOIN accessibility_features af
            WHERE ec.accessibility_notes IS NOT NULL
              AND (
                lower(ec.accessibility_notes) LIKE '%' || lower(af.name) || '%'
                OR lower(ec.accessibility_notes) LIKE '%' || lower(af.code) || '%'
              )
            ON CONFLICT DO NOTHING;
        """)

        conn.commit()
        print("Migration successful: evacuation_centers updated with foreign keys and junction table!")
    except Exception as exc:
        conn.rollback()
        print(f"Migration failed: {exc}")
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    run_migration()


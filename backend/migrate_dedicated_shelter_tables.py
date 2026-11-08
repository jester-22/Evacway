"""
migrate_dedicated_shelter_tables.py — Creates dedicated tables:
1. center_types
2. building_materials
3. accessibility_features
and migrates/seeds the initial data for each.
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

INITIAL_CENTER_TYPES = [
    ("campus", "Campus / Multi-Building", "Multi-building campus with rooms organized across distinct buildings.", True, 1),
    ("single_venue", "Single Venue", "One large unified venue or hall with direct open-floor family assignments.", True, 2),
    ("private_property", "Private Property", "Single private residence or designated property with direct rooms.", True, 3),
    ("covered_court", "Covered Court / Gymnasium", "Covered sports gymnasium or municipal court configured for emergency evacuation.", True, 4),
    ("multi_purpose_hall", "Barangay Multi-Purpose Hall", "Barangay or community multi-purpose hall serving neighborhood families.", True, 5),
    ("school_facility", "School / Educational Facility", "Elementary, high school, or college classrooms converted for disaster shelter.", True, 6),
    ("church_facility", "Religious / Church Facility", "Parish hall, worship facility, or religious convent providing humanitarian refuge.", True, 7),
]

INITIAL_BUILDING_MATERIALS = [
    ("reinforced_concrete", "Reinforced Concrete", "Heavy load-bearing concrete structure designed for high typhoon wind and seismic resistance.", True, 1),
    ("concrete_steel_frame", "Concrete & Steel Frame", "Masonry concrete hollow blocks with reinforced structural steel columns and rafters.", True, 2),
    ("structural_steel", "Structural Steel", "Rigid structural steel framing with galvanized metal cladding.", True, 3),
    ("semi_permanent", "Semi-Permanent (Masonry & Timber)", "Mixed concrete foundation/lower perimeter with hardwood upper framing.", True, 4),
    ("wood_lightweight", "Lightweight Wood / Timber", "Treated timber framing structure with corrugated metal roofing.", True, 5),
]

INITIAL_ACCESSIBILITY = [
    ("wheelchair_ramp", "Wheelchair Ramps", "Ramps installed at entrance pathways and hall transitions with gentle slope.", True, 1),
    ("pwd_restroom", "PWD-Accessible Restrooms", "Spacious sanitation cubicles with grab bars, low fixtures, and roll-in wheelchair access.", True, 2),
    ("ground_floor_access", "Ground Floor Access Only", "Step-free single-level layout ensuring easy movement for seniors and mobility-impaired.", True, 3),
    ("wide_doorways", "Wide Doorways (90cm+)", "Clear doorway openings accommodating standard wheelchairs, walkers, and stretchers.", True, 4),
    ("tactile_braille", "Tactile Paving & Braille Signage", "High-contrast tactile guiding floor tiles and Braille labels for visually impaired.", True, 5),
    ("handrails", "Handrails & Grab Bars", "Continuous safety railings along ramps, corridors, and sanitary areas.", True, 6),
    ("emergency_backup_power", "Emergency Power / Solar Backup", "Generator or solar battery system providing continuous power for medical devices.", True, 7),
]


def run_migration():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    cur = conn.cursor()

    try:
        # 1. Create center_types table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS center_types (
                id SERIAL PRIMARY KEY,
                code VARCHAR(50) NOT NULL UNIQUE,
                name VARCHAR(100) NOT NULL,
                description TEXT,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                display_order INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        """)

        # 2. Create building_materials table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS building_materials (
                id SERIAL PRIMARY KEY,
                code VARCHAR(50) NOT NULL UNIQUE,
                name VARCHAR(100) NOT NULL,
                description TEXT,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                display_order INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        """)

        # 3. Create accessibility_features table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS accessibility_features (
                id SERIAL PRIMARY KEY,
                code VARCHAR(50) NOT NULL UNIQUE,
                name VARCHAR(100) NOT NULL,
                description TEXT,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                display_order INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        """)

        # Seed center_types
        for code, name, desc, is_act, order in INITIAL_CENTER_TYPES:
            cur.execute("""
                INSERT INTO center_types (code, name, description, is_active, display_order)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (code) DO UPDATE
                SET name = EXCLUDED.name,
                    description = EXCLUDED.description,
                    display_order = EXCLUDED.display_order;
            """, (code, name, desc, is_act, order))

        # Seed building_materials
        for code, name, desc, is_act, order in INITIAL_BUILDING_MATERIALS:
            cur.execute("""
                INSERT INTO building_materials (code, name, description, is_active, display_order)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (code) DO UPDATE
                SET name = EXCLUDED.name,
                    description = EXCLUDED.description,
                    display_order = EXCLUDED.display_order;
            """, (code, name, desc, is_act, order))

        # Seed accessibility_features
        for code, name, desc, is_act, order in INITIAL_ACCESSIBILITY:
            cur.execute("""
                INSERT INTO accessibility_features (code, name, description, is_active, display_order)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (code) DO UPDATE
                SET name = EXCLUDED.name,
                    description = EXCLUDED.description,
                    display_order = EXCLUDED.display_order;
            """, (code, name, desc, is_act, order))

        conn.commit()
        print("Dedicated tables (center_types, building_materials, accessibility_features) successfully created and seeded!")
    except Exception as exc:
        conn.rollback()
        print(f"Migration failed: {exc}")
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    run_migration()


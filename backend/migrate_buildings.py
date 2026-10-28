import sqlalchemy
from app import app
from models import db, EvacuationCenterBuilding

def run_migration():
    with app.app_context():
        conn = db.session.connection()

        print("Running building migration...")

        # 1. Create evacuation_center_buildings table
        conn.execute(sqlalchemy.text("""
            CREATE TABLE IF NOT EXISTS evacuation_center_buildings (
                id SERIAL PRIMARY KEY,
                evacuation_center_id INTEGER NOT NULL REFERENCES evacuation_centers(id) ON DELETE CASCADE,
                name VARCHAR(100),
                geom geometry(Polygon, 4326) NOT NULL,
                created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        """))

        # Create spatial index if not exists
        conn.execute(sqlalchemy.text("""
            CREATE INDEX IF NOT EXISTS idx_evacuation_center_buildings_geom
            ON evacuation_center_buildings USING GIST (geom);
        """))

        conn.execute(sqlalchemy.text("""
            CREATE INDEX IF NOT EXISTS idx_evacuation_center_buildings_center_id
            ON evacuation_center_buildings(evacuation_center_id);
        """))

        # 2. Add building_id column to evacuation_center_rooms if not exists
        res = conn.execute(sqlalchemy.text("""
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'evacuation_center_rooms' AND column_name = 'building_id';
        """)).fetchone()

        if not res:
            print("Adding building_id column to evacuation_center_rooms...")
            conn.execute(sqlalchemy.text("""
                ALTER TABLE evacuation_center_rooms 
                ADD COLUMN building_id INTEGER REFERENCES evacuation_center_buildings(id) ON DELETE SET NULL;
            """))
            conn.execute(sqlalchemy.text("""
                CREATE INDEX IF NOT EXISTS idx_evacuation_center_rooms_building_id
                ON evacuation_center_rooms(building_id);
            """))
        else:
            print("Column building_id already exists on evacuation_center_rooms.")

        db.session.commit()
        print("Building migration completed successfully.")

if __name__ == '__main__':
    run_migration()

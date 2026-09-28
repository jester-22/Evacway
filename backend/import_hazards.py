"""
import_hazards.py — Imports real hazard zone GeoJSON (from Project NOAH,
clipped to Sogod in QGIS) into the EvacWay database.

Place this file in your backend/ folder, alongside app.py and models.py.

Usage (run from inside backend/, with venv activated):
    python import_hazards.py data/flood_sogod.geojson flood
    python import_hazards.py data/landslide_sogod.geojson landslide
"""

import sys
import json
from app import app
from models import db, HazardZone
from geoalchemy2.shape import from_shape
from shapely.geometry import shape

# Project NOAH field names + value mapping (confirmed from dataset docs)
FIELD_MAP = {
    "flood": "Var",   # 1=Low, 2=Medium, 3=High
    "landslide": "LH"  # 1=Low, 2=Medium, 3=High (confirmed from actual file)
}

VALUE_TO_RISK = {
    1: "low",
    2: "medium",
    3: "high"
}


def import_hazard_file(filepath, hazard_type):
    if hazard_type not in FIELD_MAP:
        print(f"Unknown hazard_type '{hazard_type}'. Use 'flood' or 'landslide'.")
        sys.exit(1)

    field_name = FIELD_MAP[hazard_type]

    with open(filepath, 'r', encoding='utf-8') as f:
        geojson_data = json.load(f)

    with app.app_context():
        count = 0
        skipped = 0

        for feature in geojson_data['features']:
            props = feature.get('properties', {})
            raw_value = props.get(field_name)

            if raw_value is None:
                # Field name might differ after QGIS export — try common variants
                for alt in [field_name.lower(), field_name.upper(), field_name.capitalize()]:
                    if alt in props:
                        raw_value = props[alt]
                        break

            if raw_value is None:
                skipped += 1
                continue

            try:
                risk_level = VALUE_TO_RISK.get(int(raw_value), "medium")
            except (ValueError, TypeError):
                skipped += 1
                continue

            geom = shape(feature['geometry'])

            # Skip empty/invalid geometries (can happen after clipping)
            if geom.is_empty:
                skipped += 1
                continue

            zone = HazardZone(
                name=f"{hazard_type.capitalize()} Zone {count + 1}",
                hazard_type=hazard_type,
                risk_level=risk_level,
                geom=from_shape(geom, srid=4326)
            )
            db.session.add(zone)
            count += 1

            # Commit in batches of 200 to avoid one giant transaction on large files
            if count % 200 == 0:
                db.session.commit()
                print(f"  ...{count} imported so far")

        db.session.commit()
        print(f"\nDone. Imported {count} {hazard_type} zones. Skipped {skipped} (missing field or empty geometry).")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python import_hazards.py <geojson_file> <hazard_type>")
        print("  hazard_type must be 'flood' or 'landslide'")
        sys.exit(1)

    import_hazard_file(sys.argv[1], sys.argv[2])
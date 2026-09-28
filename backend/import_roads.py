"""
import_roads.py — Imports real Sogod road network (from OpenStreetMap via
osmnx) into the EvacWay database.

Usage (from inside backend/, with venv activated):
    python import_roads.py
"""

import json
from app import app
from models import db, RoadSegment
from geoalchemy2.shape import from_shape
from shapely.geometry import shape

FILEPATH = "data/roads_sogod.geojson"

with app.app_context():
    print("Clearing existing road segments...")
    RoadSegment.query.delete()
    db.session.commit()

    with open(FILEPATH, 'r', encoding='utf-8') as f:
        geojson_data = json.load(f)

    count = 0
    skipped = 0

    for feature in geojson_data['features']:
        props = feature.get('properties', {})
        geom = shape(feature['geometry'])

        if geom.is_empty or geom.geom_type != 'LineString':
            skipped += 1
            continue

       # OSM fields can sometimes be lists (e.g. a road with two official
        # names, or multiple highway classifications on one segment) —
        # join them into a single string so they fit a plain VARCHAR column.
        def flatten(value, fallback):
            if value is None:
                return fallback
            if isinstance(value, list):
                return ", ".join(str(v) for v in value)
            return str(value)

        raw_name = props.get('name')
        road_name = flatten(raw_name, f"Unnamed {flatten(props.get('highway'), 'road')}")
        road_type = flatten(props.get('highway'), 'unclassified')

        segment = RoadSegment(
            road_name=road_name,
            road_type=road_type,
            base_weight=1.0,   # distance itself comes from geometry length in routing.py;
                                # this stays a multiplier, adjust per-road later if needed
                                # (e.g. rough terrain = higher weight)
            is_closed=False,
            hazard_zone_id=None,
            geom=from_shape(geom, srid=4326)
        )
        db.session.add(segment)
        count += 1

        if count % 200 == 0:
            db.session.commit()
            print(f"  ...{count} imported so far")

    db.session.commit()
    print(f"\nDone. Imported {count} road segments. Skipped {skipped} (empty or non-LineString geometry).")
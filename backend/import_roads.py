"""
import_roads.py — Imports real Sogod road network (from OpenStreetMap via
osmnx) into the EvacWay database, split at all intersections so that
road segments span only between adjacent intersections.

Usage (from inside backend/, with venv activated):
    python import_roads.py
"""

import os
import json
from app import app
from models import db, RoadSegment
from geoalchemy2.shape import from_shape
from shapely.geometry import shape, LineString
from shapely.ops import unary_union
from shapely.strtree import STRtree
from services.pathfinding import invalidate_road_network_cache

FILEPATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "roads_sogod.geojson")


def flatten(value, fallback):
    if value is None:
        return fallback
    if isinstance(value, list):
        return ", ".join(str(v) for v in value)
    return str(value)


with app.app_context():
    print("Clearing existing road segments...")
    RoadSegment.query.delete()
    db.session.commit()

    with open(FILEPATH, "r", encoding="utf-8") as f:
        geojson_data = json.load(f)

    orig_lines = []
    orig_props = []

    for feature in geojson_data["features"]:
        props = feature.get("properties", {})
        geom = shape(feature["geometry"])

        if geom.is_empty or geom.geom_type != "LineString":
            continue

        orig_lines.append(geom)
        raw_name = props.get("name")
        road_name = flatten(raw_name, f"Unnamed {flatten(props.get('highway'), 'road')}")
        road_type = flatten(props.get("highway"), "unclassified")
        orig_props.append(
            {
                "road_name": road_name,
                "road_type": road_type,
            }
        )

    print(f"Loaded {len(orig_lines)} raw road features. Splitting at intersections...")
    union_result = unary_union(orig_lines)
    split_segments = (
        list(union_result.geoms)
        if union_result.geom_type == "MultiLineString"
        else [union_result]
    )

    tree = STRtree(orig_lines)
    count = 0

    for seg in split_segments:
        if seg.is_empty or seg.geom_type != "LineString":
            continue

        # Find original feature for attributes by checking midpoint
        mid = seg.interpolate(0.5, normalized=True)
        nearest_idx = tree.nearest(mid)
        matched_prop = orig_props[nearest_idx]

        segment = RoadSegment(
            road_name=matched_prop["road_name"],
            road_type=matched_prop["road_type"],
            base_weight=1.0,
            is_closed=False,
            hazard_zone_id=None,
            geom=from_shape(seg, srid=4326),
        )
        db.session.add(segment)
        count += 1

        if count % 200 == 0:
            db.session.commit()
            print(f"  ...{count} imported so far")

    db.session.commit()
    invalidate_road_network_cache()
    print(f"\nDone. Imported {count} intersection-bounded road segments.")

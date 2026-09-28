from flask import Blueprint, jsonify
from models import HazardZone
from geoalchemy2.shape import to_shape
from shapely.geometry import mapping

hazards_bp = Blueprint('hazards', __name__)

@hazards_bp.route('/api/hazard-zones')
def get_hazard_zones():
    zones = HazardZone.query.all()

    features = []
    for zone in zones:
        shapely_geom = to_shape(zone.geom)  # convert PostGIS geometry to Shapely
        features.append({
            "type": "Feature",
            "geometry": mapping(shapely_geom),  # convert Shapely to GeoJSON geometry
            "properties": {
                "id": zone.id,
                "name": zone.name,
                "hazard_type": zone.hazard_type,
                "risk_level": zone.risk_level
            }
        })

    geojson = {
        "type": "FeatureCollection",
        "features": features
    }

    return jsonify(geojson)
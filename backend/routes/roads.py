from flask import Blueprint, jsonify
from models import RoadSegment
from geoalchemy2.shape import to_shape
from shapely.geometry import mapping

roads_bp = Blueprint('roads', __name__)


def road_to_feature(road):
    shapely_geom = to_shape(road.geom)
    return {
        "type": "Feature",
        "geometry": mapping(shapely_geom),
        "properties": {
            "id": road.id,
            "road_name": road.road_name,
            "road_type": road.road_type,
            "is_closed": road.is_closed
        }
    }


@roads_bp.route('/api/road-segments', methods=['GET'])
def get_road_segments():
    roads = RoadSegment.query.all()
    return jsonify({
        "type": "FeatureCollection",
        "features": [road_to_feature(r) for r in roads]
    })
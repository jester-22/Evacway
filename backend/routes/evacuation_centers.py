from flask import Blueprint, request, jsonify
from models import db, EvacuationCenter, SystemLog
from geoalchemy2.shape import to_shape, from_shape
from shapely.geometry import mapping, Polygon, MultiPoint
from flask_jwt_extended import get_jwt_identity
from utils import role_required

centers_bp = Blueprint('centers', __name__)


def center_to_feature(center):
    geometry = None

    # Imported centers may not have a map polygon yet.
    # The polygon will be added later from the map.
    if center.geom is not None:
        try:
            geometry = mapping(to_shape(center.geom))
        except (TypeError, ValueError):
            geometry = None

    entrances = []

    # Imported centers may also have no entrance yet.
    if center.entrance_geom is not None:
        try:
            entrance_shape = to_shape(center.entrance_geom)

            if hasattr(entrance_shape, "geoms"):
                entrances = [
                    {
                        "lat": point.y,
                        "lng": point.x
                    }
                    for point in entrance_shape.geoms
                ]
            elif hasattr(entrance_shape, "y") and hasattr(entrance_shape, "x"):
                entrances = [
                    {
                        "lat": entrance_shape.y,
                        "lng": entrance_shape.x
                    }
                ]

        except (TypeError, ValueError):
            entrances = []

    return {
        "type": "Feature",
        "geometry": geometry,
        "properties": {
            "id": center.id,
            "name": center.name,
            "barangay": center.barangay,
            "barangay_id": center.barangay_id,
            "capacity": center.capacity,
            "building_material": center.building_material,
            "accessibility_notes": center.accessibility_notes,
            "hazard_exposure_score": center.hazard_exposure_score,
            "contact_number": center.contact_number,
            "is_active": center.is_active,
            "entrances": entrances
        }
    }


def build_polygon(points):
    if not points or len(points) < 3:
        raise ValueError("A footprint needs at least 3 points.")
    coords = [(p['lng'], p['lat']) for p in points]
    return Polygon(coords)


def build_multipoint(points):
    if not points or len(points) < 1:
        raise ValueError("At least one entrance point is required.")
    return MultiPoint([(p['lng'], p['lat']) for p in points])


@centers_bp.route('/api/evacuation-centers', methods=['GET'])
def get_evacuation_centers():
    include_inactive = request.args.get('include_inactive') == 'true'
    query = EvacuationCenter.query
    if not include_inactive:
        query = query.filter_by(is_active=True)
    centers = query.all()

    return jsonify({
        "type": "FeatureCollection",
        "features": [center_to_feature(c) for c in centers]
    })


@centers_bp.route('/api/evacuation-centers', methods=['POST'])
@role_required('admin', 'lgu_personnel')
def create_evacuation_center():
    data = request.get_json()

    if not data.get('name'):
        return jsonify({"error": "name is required"}), 400
    if not data.get('polygon'):
        return jsonify({"error": "polygon (building footprint) is required"}), 400
    if not data.get('entrances'):
        return jsonify({"error": "at least one entrance point is required"}), 400

    try:
        polygon = build_polygon(data['polygon'])
        multipoint = build_multipoint(data['entrances'])
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    user_id = get_jwt_identity()

    center = EvacuationCenter(
        name=data['name'],
        barangay=data.get('barangay'),
        capacity=data.get('capacity'),
        building_material=data.get('building_material'),
        accessibility_notes=data.get('accessibility_notes'),
        hazard_exposure_score=data.get('hazard_exposure_score'),
        contact_number=data.get('contact_number'),
        is_active=True,
        geom=from_shape(polygon, srid=4326),
        entrance_geom=from_shape(multipoint, srid=4326),
        managed_by=user_id
    )
    db.session.add(center)
    db.session.commit()

    db.session.add(SystemLog(user_id=user_id, action=f"Added evacuation center: {center.name}"))
    db.session.commit()

    return jsonify(center_to_feature(center)), 201


@centers_bp.route('/api/evacuation-centers/<int:center_id>', methods=['PUT'])
@role_required('admin', 'lgu_personnel')
def update_evacuation_center(center_id):
    center = EvacuationCenter.query.get_or_404(center_id)
    data = request.get_json()

    for field in ['name', 'barangay', 'capacity', 'building_material',
                  'accessibility_notes', 'hazard_exposure_score', 'contact_number']:
        if field in data:
            setattr(center, field, data[field])

    if data.get('polygon'):
        try:
            polygon = build_polygon(data['polygon'])
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        center.geom = from_shape(polygon, srid=4326)

    if data.get('entrances'):
        try:
            multipoint = build_multipoint(data['entrances'])
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        center.entrance_geom = from_shape(multipoint, srid=4326)

    db.session.commit()

    user_id = get_jwt_identity()
    db.session.add(SystemLog(user_id=user_id, action=f"Edited evacuation center: {center.name}"))
    db.session.commit()

    return jsonify(center_to_feature(center))


@centers_bp.route('/api/evacuation-centers/<int:center_id>/toggle-active', methods=['PATCH'])
@role_required('admin')
def toggle_center_active(center_id):
    center = EvacuationCenter.query.get_or_404(center_id)
    center.is_active = not center.is_active
    db.session.commit()

    user_id = get_jwt_identity()
    action = "Reactivated" if center.is_active else "Deactivated"
    db.session.add(SystemLog(user_id=user_id, action=f"{action} evacuation center: {center.name}"))
    db.session.commit()

    return jsonify(center_to_feature(center))
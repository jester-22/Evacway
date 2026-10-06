from flask import Blueprint, request, jsonify
from sqlalchemy import func, or_
from models import (
    db,
    EvacuationCenter,
    EvacuationCenterRoom,
    EvacuationAssignment,
    Barangay,
    Family,
    Resident,
    SystemLog,
)
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

    # Calculate actual occupancy from assigned individuals in all rooms of this center
    occupied = (
        db.session.query(func.count(EvacuationAssignment.id))
        .join(EvacuationCenterRoom, EvacuationAssignment.room_id == EvacuationCenterRoom.id)
        .filter(EvacuationCenterRoom.evacuation_center_id == center.id)
        .scalar() or 0
    )

    # Active room count
    active_rooms = (
        EvacuationCenterRoom.query.filter_by(
            evacuation_center_id=center.id,
            is_active=True
        ).all()
    )
    room_count = len(active_rooms)

    # If center capacity is not explicitly set, sum room capacities
    capacity = center.capacity
    if capacity is None and room_count > 0:
        capacity = sum(r.capacity for r in active_rooms if r.capacity)

    available = max((capacity or 0) - occupied, 0) if capacity is not None else 0

    return {
        "type": "Feature",
        "geometry": geometry,
        "properties": {
            "id": center.id,
            "name": center.name,
            "barangay": center.barangay,
            "barangay_id": center.barangay_id,
            "capacity": capacity,
            "occupied": occupied,
            "current_occupancy": occupied,
            "available": available,
            "room_count": room_count,
            "building_material": center.building_material,
            "accessibility_notes": center.accessibility_notes,
            "hazard_exposure_score": center.hazard_exposure_score,
            "contact_number": center.contact_number,
            "is_active": center.is_active,
            "has_map": geometry is not None,
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
    search = request.args.get('search', '').strip()
    barangay_id = request.args.get('barangay_id', '').strip()
    status = request.args.get('status', '').strip().lower()
    include_inactive = request.args.get('include_inactive') == 'true'

    query = EvacuationCenter.query

    if status == 'active':
        query = query.filter_by(is_active=True)
    elif status == 'inactive':
        query = query.filter_by(is_active=False)
    elif not include_inactive and status != 'all':
        query = query.filter_by(is_active=True)

    if barangay_id:
        try:
            query = query.filter(EvacuationCenter.barangay_id == int(barangay_id))
        except (ValueError, TypeError):
            pass

    if search:
        search_pattern = f"%{search}%"
        query = query.filter(
            or_(
                EvacuationCenter.name.ilike(search_pattern),
                EvacuationCenter.barangay.ilike(search_pattern)
            )
        )

    centers = query.order_by(EvacuationCenter.name.asc()).all()

    return jsonify({
        "type": "FeatureCollection",
        "features": [center_to_feature(c) for c in centers]
    })


@centers_bp.route('/api/evacuation-centers/<int:center_id>', methods=['GET'])
def get_evacuation_center_details(center_id):
    center = EvacuationCenter.query.get(center_id)
    if not center:
        return jsonify({"error": "Evacuation center not found"}), 404

    feature = center_to_feature(center)

    # Load rooms
    rooms = EvacuationCenterRoom.query.filter_by(
        evacuation_center_id=center_id
    ).order_by(EvacuationCenterRoom.room_number.asc()).all()

    rooms_data = []
    for room in rooms:
        occupied = EvacuationAssignment.query.filter_by(room_id=room.id).count()
        room_dict = room.to_dict()
        room_dict["occupied"] = occupied
        room_dict["available"] = max(room.capacity - occupied, 0)
        rooms_data.append(room_dict)

    # Load distinct assigned families across all rooms of this center
    assigned_families_query = (
        db.session.query(
            Family.id,
            Family.family_code,
            Family.head_name,
            Family.contact_number,
            Family.evacuation_status,
            EvacuationCenterRoom.id.label('room_id'),
            EvacuationCenterRoom.room_number,
            func.count(EvacuationAssignment.id).label('assigned_members')
        )
        .join(Resident, Resident.family_id == Family.id)
        .join(EvacuationAssignment, EvacuationAssignment.resident_id == Resident.id)
        .join(EvacuationCenterRoom, EvacuationAssignment.room_id == EvacuationCenterRoom.id)
        .filter(EvacuationCenterRoom.evacuation_center_id == center_id)
        .group_by(Family.id, Family.family_code, Family.head_name, Family.contact_number, Family.evacuation_status, EvacuationCenterRoom.id, EvacuationCenterRoom.room_number)
        .all()
    )

    families_data = [
        {
            "family_id": row.id,
            "family_code": row.family_code,
            "head_name": row.head_name,
            "contact_number": row.contact_number,
            "evacuation_status": row.evacuation_status,
            "room_id": row.room_id,
            "room_number": row.room_number,
            "assigned_members": row.assigned_members
        }
        for row in assigned_families_query
    ]

    return jsonify({
        **feature,
        "rooms": rooms_data,
        "assigned_families": families_data
    })


@centers_bp.route('/api/evacuation-centers', methods=['POST'])
@role_required('admin', 'lgu_personnel')
def create_evacuation_center():
    data = request.get_json() or {}

    name = str(data.get('name') or '').strip()
    if not name:
        return jsonify({"error": "Center name is required"}), 400

    barangay_id = data.get('barangay_id')
    barangay_name = str(data.get('barangay') or '').strip()

    if barangay_id:
        try:
            barangay_id = int(barangay_id)
            brgy_obj = Barangay.query.get(barangay_id)
            if brgy_obj and not barangay_name:
                barangay_name = brgy_obj.name
        except (ValueError, TypeError):
            barangay_id = None

    capacity = data.get('capacity')
    if capacity is not None and str(capacity).strip() != "":
        try:
            capacity = int(capacity)
            if capacity < 0:
                return jsonify({"error": "Capacity must be 0 or greater"}), 400
        except (ValueError, TypeError):
            return jsonify({"error": "Capacity must be a number"}), 400
    else:
        capacity = None

    geom = None
    if data.get('polygon'):
        try:
            polygon = build_polygon(data['polygon'])
            geom = from_shape(polygon, srid=4326)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    entrance_geom = None
    if data.get('entrances'):
        try:
            multipoint = build_multipoint(data['entrances'])
            entrance_geom = from_shape(multipoint, srid=4326)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    user_id = get_jwt_identity()

    center = EvacuationCenter(
        name=name,
        barangay_id=barangay_id,
        barangay=barangay_name or None,
        capacity=capacity,
        building_material=data.get('building_material'),
        accessibility_notes=data.get('accessibility_notes'),
        hazard_exposure_score=data.get('hazard_exposure_score'),
        contact_number=data.get('contact_number'),
        is_active=True,
        geom=geom,
        entrance_geom=entrance_geom,
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
    data = request.get_json() or {}

    if 'name' in data:
        name = str(data['name'] or '').strip()
        if not name:
            return jsonify({"error": "Center name cannot be empty"}), 400
        center.name = name

    if 'barangay_id' in data:
        bid = data.get('barangay_id')
        if bid:
            try:
                center.barangay_id = int(bid)
                brgy = Barangay.query.get(center.barangay_id)
                if brgy:
                    center.barangay = brgy.name
            except (ValueError, TypeError):
                pass
        else:
            center.barangay_id = None

    if 'barangay' in data and not data.get('barangay_id'):
        center.barangay = str(data['barangay'] or '').strip() or None

    if 'capacity' in data:
        cap = data.get('capacity')
        if cap is not None and str(cap).strip() != "":
            try:
                parsed_cap = int(cap)
                if parsed_cap < 0:
                    return jsonify({"error": "Capacity must be 0 or greater"}), 400
                center.capacity = parsed_cap
            except (ValueError, TypeError):
                return jsonify({"error": "Capacity must be a number"}), 400
        else:
            center.capacity = None

    for field in ['building_material', 'accessibility_notes', 'hazard_exposure_score', 'contact_number']:
        if field in data:
            setattr(center, field, data[field])

    if data.get('polygon'):
        try:
            polygon = build_polygon(data['polygon'])
            center.geom = from_shape(polygon, srid=4326)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    if data.get('entrances'):
        try:
            multipoint = build_multipoint(data['entrances'])
            center.entrance_geom = from_shape(multipoint, srid=4326)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    db.session.commit()

    user_id = get_jwt_identity()
    db.session.add(SystemLog(user_id=user_id, action=f"Edited evacuation center: {center.name}"))
    db.session.commit()

    return jsonify(center_to_feature(center))


@centers_bp.route('/api/evacuation-centers/<int:center_id>/toggle-active', methods=['PATCH'])
@role_required('admin', 'lgu_personnel')
def toggle_center_active(center_id):
    center = EvacuationCenter.query.get_or_404(center_id)

    # Check for active assignments before deactivating
    if center.is_active:
        active_assignments = (
            db.session.query(func.count(EvacuationAssignment.id))
            .join(EvacuationCenterRoom, EvacuationAssignment.room_id == EvacuationCenterRoom.id)
            .filter(EvacuationCenterRoom.evacuation_center_id == center.id)
            .scalar() or 0
        )
        if active_assignments > 0:
            return jsonify({
                "error": f"Cannot deactivate evacuation center with {active_assignments} assigned resident(s). Please move or unassign families first."
            }), 400

    center.is_active = not center.is_active
    db.session.commit()

    user_id = get_jwt_identity()
    action = "Reactivated" if center.is_active else "Deactivated"
    db.session.add(SystemLog(user_id=user_id, action=f"{action} evacuation center: {center.name}"))
    db.session.commit()

    return jsonify(center_to_feature(center))


@centers_bp.route('/api/evacuation-centers/<int:center_id>', methods=['DELETE'])
@role_required('admin', 'lgu_personnel')
def delete_evacuation_center(center_id):
    center = EvacuationCenter.query.get_or_404(center_id)

    # Check for active assignments
    active_assignments = (
        db.session.query(func.count(EvacuationAssignment.id))
        .join(EvacuationCenterRoom, EvacuationAssignment.room_id == EvacuationCenterRoom.id)
        .filter(EvacuationCenterRoom.evacuation_center_id == center.id)
        .scalar() or 0
    )
    if active_assignments > 0:
        return jsonify({
            "error": f"Cannot delete evacuation center with {active_assignments} assigned resident(s). Please move or unassign families first."
        }), 400

    # Soft delete to preserve historical data
    center.is_active = False

    # Also deactivate rooms
    rooms = EvacuationCenterRoom.query.filter_by(evacuation_center_id=center.id).all()
    for room in rooms:
        room.is_active = False

    db.session.commit()

    user_id = get_jwt_identity()
    db.session.add(SystemLog(user_id=user_id, action=f"Safely deactivated/deleted evacuation center: {center.name}"))
    db.session.commit()

    return jsonify({
        "message": f"Evacuation center '{center.name}' deactivated safely.",
        "center_id": center.id
    }), 200
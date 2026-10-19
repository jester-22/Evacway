from flask import Blueprint, request, jsonify
from sqlalchemy import func, or_
from models import (
    db,
    EvacuationCenter,
    EvacuationCenterRoom,
    EvacuationAssignment,
    Barangay,
    CenterBarangay,
    Family,
    Resident,
    SystemLog,
)
from geoalchemy2.shape import to_shape, from_shape
from shapely.geometry import mapping, Polygon, MultiPoint
from flask_jwt_extended import get_jwt_identity
from utils import role_required

centers_bp = Blueprint('centers', __name__)


def _parse_barangay_ids(raw_ids, fallback_id=None, fallback_name=None):
    candidates = raw_ids
    if not isinstance(candidates, list) or not candidates:
        if fallback_id is not None and str(fallback_id).strip() != "":
            candidates = [fallback_id]
        elif fallback_name and str(fallback_name).strip():
            matched = Barangay.query.filter(
                func.lower(Barangay.name) == str(fallback_name).strip().casefold()
            ).first()
            if matched:
                candidates = [matched.id]

    if not isinstance(candidates, list) or not candidates:
        return None, "Select at least one barangay for this evacuation center"

    barangay_ids = []
    for raw_id in candidates:
        try:
            barangay_id = int(raw_id)
        except (TypeError, ValueError):
            return None, f"Invalid barangay id: {raw_id}"
        if barangay_id not in barangay_ids:
            barangay_ids.append(barangay_id)

    barangays = Barangay.query.filter(Barangay.id.in_(barangay_ids)).all()
    found_ids = {barangay.id for barangay in barangays}
    missing_ids = [barangay_id for barangay_id in barangay_ids if barangay_id not in found_ids]
    if missing_ids:
        return None, f"Barangay id(s) not found: {', '.join(map(str, missing_ids))}"
    return barangay_ids, None


def _center_barangays(center):
    return [
        {
            "id": link.barangay.id,
            "name": link.barangay.name,
            "color": link.color
        }
        for link in sorted(
            center.barangay_links,
            key=lambda item: (
                item.barangay.name.casefold()
                if item.barangay and item.barangay.name
                else ""
            )
        )
        if link.barangay is not None
    ]


def _center_metrics(center):
    rooms = EvacuationCenterRoom.query.filter_by(
        evacuation_center_id=center.id,
        is_active=True
    ).all()
    room_ids = [room.id for room in rooms]
    rooms_by_id = {room.id: room for room in rooms}
    assigned_by_barangay = {}
    family_count_by_barangay = {}
    rooms_by_barangay = {}
    total_assigned = 0

    if room_ids:
        total_assigned = (
            db.session.query(func.count(EvacuationAssignment.id))
            .filter(EvacuationAssignment.room_id.in_(room_ids))
            .scalar()
        ) or 0

        assignment_rows = (
            db.session.query(
                Family.barangay_id,
                func.count(EvacuationAssignment.id),
                func.count(func.distinct(Family.id))
            )
            .join(
                Resident,
                Resident.id == EvacuationAssignment.resident_id
            )
            .join(
                Family,
                Family.id == Resident.family_id
            )
            .filter(EvacuationAssignment.room_id.in_(room_ids))
            .group_by(Family.barangay_id)
            .all()
        )
        assigned_by_barangay = {
            barangay_id: assigned_count
            for barangay_id, assigned_count, _ in assignment_rows
            if barangay_id is not None
        }
        family_count_by_barangay = {
            barangay_id: family_count
            for barangay_id, _, family_count in assignment_rows
            if barangay_id is not None
        }

        room_barangay_rows = (
            db.session.query(
                EvacuationAssignment.room_id,
                Family.barangay_id
            )
            .join(
                Resident,
                Resident.id == EvacuationAssignment.resident_id
            )
            .join(
                Family,
                Family.id == Resident.family_id
            )
            .filter(
                EvacuationAssignment.room_id.in_(room_ids),
                Family.barangay_id.isnot(None)
            )
            .distinct()
            .all()
        )
        for rid, bid in room_barangay_rows:
            rooms_by_barangay.setdefault(bid, set()).add(rid)

    linked_barangays = _center_barangays(center)
    total_room_capacity = sum(room.capacity or 0 for room in rooms)
    total_capacity = center.capacity
    effective_capacity = (
        total_capacity if total_capacity is not None else total_room_capacity
    )
    center_available = max(effective_capacity - total_assigned, 0)

    breakdown = []
    for barangay in linked_barangays:
        barangay_id = barangay["id"]
        used_room_ids = rooms_by_barangay.get(barangay_id, set())
        used_room_capacity = sum(
            rooms_by_id[rid].capacity or 0
            for rid in used_room_ids
            if rid in rooms_by_id
        )
        assigned = assigned_by_barangay.get(barangay_id, 0)
        breakdown.append({
            **barangay,
            "rooms": len(used_room_ids) if used_room_ids else len(rooms),
            "assigned": assigned,
            "assigned_families": family_count_by_barangay.get(barangay_id, 0),
            "available": (
                max(used_room_capacity - assigned, 0)
                if used_room_ids
                else center_available
            )
        })

    return {
        "barangays": linked_barangays,
        "barangay": ", ".join(item["name"] for item in linked_barangays) or None,
        "barangay_ids": [item["id"] for item in linked_barangays],
        "barangay_id": linked_barangays[0]["id"] if linked_barangays else None,
        "barangay_breakdown": breakdown,
        "capacity": total_capacity,
        "occupied": total_assigned,
        "current_occupancy": total_assigned,
        "available": (
            max(total_capacity - total_assigned, 0)
            if total_capacity is not None
            else center_available
        ),
        "room_count": len(rooms),
        "total_rooms": len(rooms),
        "total_assigned": total_assigned
    }


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

    metrics = _center_metrics(center)

    return {
        "type": "Feature",
        "geometry": geometry,
        "properties": {
            "id": center.id,
            "name": center.name,
            **metrics,
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
            barangay_id = int(barangay_id)
        except (ValueError, TypeError):
            return jsonify({"error": "barangay_id must be a valid integer"}), 400
        query = query.filter(
            EvacuationCenter.barangay_links.any(
                CenterBarangay.barangay_id == barangay_id
            )
        )

    if search:
        search_pattern = f"%{search}%"
        query = query.filter(
            or_(
                EvacuationCenter.name.ilike(search_pattern),
                EvacuationCenter.barangay_links.any(
                    CenterBarangay.barangay.has(
                        Barangay.name.ilike(search_pattern)
                    )
                )
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

    linked_by_id = {
        item["id"]: item for item in _center_barangays(center)
    }
    rooms_data = []
    for room in rooms:
        occupied = EvacuationAssignment.query.filter_by(room_id=room.id).count()
        is_assigned = occupied > 0
        room_dict = room.to_dict()
        room_dict["occupied"] = occupied
        room_dict["available"] = max(room.capacity - occupied, 0)
        room_dict["is_assigned"] = is_assigned
        room_dict["assignment_status"] = "Assigned" if is_assigned else "Unassigned"
        assigned_bid = (
            db.session.query(Family.barangay_id)
            .join(Resident, Resident.family_id == Family.id)
            .join(EvacuationAssignment, EvacuationAssignment.resident_id == Resident.id)
            .filter(EvacuationAssignment.room_id == room.id)
            .first()
        )
        room_bid = assigned_bid[0] if assigned_bid else (
            next(iter(linked_by_id.keys()), None) if len(linked_by_id) == 1 else None
        )
        room_dict["barangay_id"] = room_bid
        room_dict["barangay"] = linked_by_id.get(room_bid) if room_bid else None
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
            "evacuation_status": "Assigned",
            "assignment_status": "Assigned",
            "is_assigned": True,
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

    barangay_ids, barangay_error = _parse_barangay_ids(
        data.get('barangay_ids'),
        fallback_id=data.get('barangay_id'),
        fallback_name=data.get('barangay')
    )
    if barangay_error:
        return jsonify({"error": barangay_error}), 400
    duplicate = EvacuationCenter.query.filter(
        func.lower(EvacuationCenter.name) == name.casefold()
    ).first()
    if duplicate:
        return jsonify({"error": f"An evacuation center named '{duplicate.name}' already exists"}), 409

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
    db.session.flush()
    db.session.add_all(
        CenterBarangay(center_id=center.id, barangay_id=barangay_id)
        for barangay_id in barangay_ids
    )
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
        duplicate = EvacuationCenter.query.filter(
            func.lower(EvacuationCenter.name) == name.casefold(),
            EvacuationCenter.id != center.id
        ).first()
        if duplicate:
            return jsonify({"error": f"An evacuation center named '{duplicate.name}' already exists"}), 409
        center.name = name

    if 'barangay_ids' in data or 'barangay_id' in data or 'barangay' in data:
        barangay_ids, barangay_error = _parse_barangay_ids(
            data.get('barangay_ids'),
            fallback_id=data.get('barangay_id'),
            fallback_name=data.get('barangay')
        )
        if barangay_error:
            return jsonify({"error": barangay_error}), 400
        existing_links = {
            link.barangay_id: link
            for link in center.barangay_links
        }
        selected_ids = set(barangay_ids)
        for barangay_id, link in existing_links.items():
            if barangay_id not in selected_ids:
                center.barangay_links.remove(link)
        for barangay_id in barangay_ids:
            if barangay_id not in existing_links:
                center.barangay_links.append(
                    CenterBarangay(barangay_id=barangay_id)
                )

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
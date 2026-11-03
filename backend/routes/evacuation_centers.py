from flask import Blueprint, request, jsonify
from sqlalchemy import func, or_
from collections import defaultdict
from datetime import date
from models import (
    db,
    EvacuationCenter,
    EvacuationCenterBuilding,
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
    occupied_by_barangay = {}
    family_count_by_barangay = {}
    rooms_by_barangay = {}
    total_assigned = 0
    total_occupied = 0

    center_filter = or_(
        EvacuationAssignment.evacuation_center_id == center.id,
        EvacuationAssignment.room_id.in_(room_ids) if room_ids else False
    )
    totals_row = (
        db.session.query(
            func.count(EvacuationAssignment.id).label("assigned"),
            func.count(EvacuationAssignment.checked_in_at).label("occupied"),
        )
        .filter(center_filter)
        .first()
    )
    total_assigned = int((totals_row.assigned if totals_row else 0) or 0)
    total_occupied = int((totals_row.occupied if totals_row else 0) or 0)

    assignment_rows = (
        db.session.query(
            Family.barangay_id,
            func.count(EvacuationAssignment.id),
            func.count(EvacuationAssignment.checked_in_at),
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
        .filter(center_filter)
        .group_by(Family.barangay_id)
        .all()
    )
    assigned_by_barangay = {
        barangay_id: assigned_count
        for barangay_id, assigned_count, _, _ in assignment_rows
        if barangay_id is not None
    }
    occupied_by_barangay = {
        barangay_id: occupied_count
        for barangay_id, _, occupied_count, _ in assignment_rows
        if barangay_id is not None
    }
    family_count_by_barangay = {
        barangay_id: family_count
        for barangay_id, _, _, family_count in assignment_rows
        if barangay_id is not None
    }

    if room_ids:
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
    center_available = max(effective_capacity - total_occupied, 0)
    center_unassigned = max(effective_capacity - total_assigned, 0)

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
        occupied = occupied_by_barangay.get(barangay_id, 0)
        breakdown.append({
            **barangay,
            "rooms": len(used_room_ids) if used_room_ids else len(rooms),
            "assigned": assigned,
            "occupied": occupied,
            "assigned_families": family_count_by_barangay.get(barangay_id, 0),
            "available": (
                max(used_room_capacity - occupied, 0)
                if used_room_ids
                else center_available
            ),
            "unassigned": (
                max(used_room_capacity - assigned, 0)
                if used_room_ids
                else center_unassigned
            ),
        })

    center_buildings = (
        EvacuationCenterBuilding.query.filter_by(evacuation_center_id=center.id)
        .order_by(EvacuationCenterBuilding.name.asc())
        .all()
    )
    is_venue_or_private = (center.center_type or "campus") in ("single_venue", "private_property")
    building_count = len(center_buildings)
    unmapped_room_count = 0 if is_venue_or_private else sum(1 for room in rooms if room.building_id is None)
    mapped_room_count = 0 if is_venue_or_private else sum(1 for room in rooms if room.building_id is not None)

    return {
        "center_type": center.center_type or "campus",
        "owner_name": center.owner_name,
        "barangays": linked_barangays,
        "barangay": ", ".join(item["name"] for item in linked_barangays) or None,
        "barangay_ids": [item["id"] for item in linked_barangays],
        "barangay_id": linked_barangays[0]["id"] if linked_barangays else None,
        "barangay_breakdown": breakdown,
        "capacity": total_capacity,
        "occupied": total_occupied,
        "current_occupancy": total_occupied,
        "assigned": total_assigned,
        "total_assigned": total_assigned,
        "available": (
            max(total_capacity - total_occupied, 0)
            if total_capacity is not None
            else center_available
        ),
        "unassigned": (
            max(total_capacity - total_assigned, 0)
            if total_capacity is not None
            else center_unassigned
        ),
        "is_fully_assigned": bool(effective_capacity > 0 and total_assigned >= effective_capacity),
        "building_count": building_count,
        "buildings": [
            {
                "id": b.id,
                "name": b.name,
                "evacuation_center_id": center.id,
                "center_name": center.name,
            }
            for b in center_buildings
        ],
        "room_count": len(rooms),
        "total_rooms": len(rooms),
        "unmapped_room_count": unmapped_room_count,
        "mapped_room_count": mapped_room_count,
    }


# =========================================================
# CENTER TYPE CHANGE VALIDATION
# =========================================================
VALID_CENTER_TYPES = {'campus', 'single_venue', 'private_property'}

def validate_center_type_change(center, new_type, current_type=None):
    """
    Validate if a center can change to new_type.
    Returns (allowed: bool, reason: str or None, blocked_types: dict)
    """
    if current_type is None:
        current_type = center.center_type or "campus"

    # Compute blocked types with reasons
    blocked_types = {}

    # Count buildings
    building_count = EvacuationCenterBuilding.query.filter_by(evacuation_center_id=center.id).count()

    # Count rooms (active and inactive)
    room_count = EvacuationCenterRoom.query.filter_by(evacuation_center_id=center.id).count()
    active_room_count = EvacuationCenterRoom.query.filter_by(
        evacuation_center_id=center.id, is_active=True
    ).count()

    # Count households assigned through rooms (campus/private_property)
    room_assigned_families = db.session.query(func.count(func.distinct(Family.id))) \
        .join(Resident, Resident.family_id == Family.id) \
        .join(EvacuationAssignment, EvacuationAssignment.resident_id == Resident.id) \
        .join(EvacuationCenterRoom, EvacuationCenterRoom.id == EvacuationAssignment.room_id) \
        .filter(EvacuationCenterRoom.evacuation_center_id == center.id) \
        .scalar() or 0

    # Count households assigned directly to venue (single_venue)
    venue_assigned_families = db.session.query(func.count(func.distinct(Family.id))) \
        .join(Resident, Resident.family_id == Family.id) \
        .join(EvacuationAssignment, EvacuationAssignment.resident_id == Resident.id) \
        .filter(EvacuationAssignment.evacuation_center_id == center.id) \
        .filter(EvacuationAssignment.room_id.is_(None)) \
        .scalar() or 0

    # Rules for each target type
    for t in VALID_CENTER_TYPES:
        reason = None
        if t == 'campus':
            # Always allowed
            pass
        elif t == 'private_property':
            if building_count > 0:
                reason = f"This center still has {building_count} building(s). Remove them first."
        elif t == 'single_venue':
            if room_count > 0:
                reason = f"This center still has {room_count} room(s) ({active_room_count} active). Remove them first."
            elif building_count > 0:
                reason = f"This center still has {building_count} building(s). Remove them first."
            elif room_assigned_families > 0:
                reason = f"This center has {room_assigned_families} household(s) assigned through rooms. Move or unassign them first."
            elif (center.capacity or 0) < 1:
                reason = "Single venue centers require a capacity of at least 1."

        if reason:
            blocked_types[t] = {"allowed": False, "reason": reason}
        else:
            blocked_types[t] = {"allowed": True, "reason": None}

    # Current type is always allowed
    blocked_types[current_type] = {"allowed": True, "reason": None}

    # Check if new_type is allowed
    if new_type in blocked_types:
        return blocked_types[new_type]["allowed"], blocked_types[new_type]["reason"], blocked_types

    return False, "Invalid center type", blocked_types


def get_allowed_center_types(center):
    """
    Get allowed center types with reasons for a center.
    Returns dict of type -> {allowed: bool, reason: str or None}
    """
    _, _, blocked = validate_center_type_change(center, center.center_type or "campus")
    return blocked


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
            from services.pathfinding import snap_point_to_road, MAX_ENTRANCE_SNAP_DISTANCE_METERS

            entrance_shape = to_shape(center.entrance_geom)
            raw_pts = []
            if hasattr(entrance_shape, "geoms"):
                raw_pts = list(entrance_shape.geoms)
            elif hasattr(entrance_shape, "y") and hasattr(entrance_shape, "x"):
                raw_pts = [entrance_shape]

            for idx, point in enumerate(raw_pts):
                snap_pt, edge_dist_m, sub_info, is_conn = snap_point_to_road(point.y, point.x)
                reasons = []
                if edge_dist_m > MAX_ENTRANCE_SNAP_DISTANCE_METERS:
                    reasons.append(f"Snap distance is {edge_dist_m:.1f}m (> 25m threshold)")
                if not is_conn:
                    reasons.append("Road segment is not connected to the walkable network")

                entrances.append({
                    "index": idx + 1,
                    "name": f"Entrance {idx + 1}",
                    "lat": point.y,
                    "lng": point.x,
                    "snap_distance_m": round(edge_dist_m, 1),
                    "nearest_road": sub_info["road_name"] if sub_info else "Unknown",
                    "is_connected": is_conn,
                    "has_warning": bool(reasons),
                    "warning": "; ".join(reasons) if reasons else None,
                })

        except (TypeError, ValueError):
            entrances = []

    metrics = _center_metrics(center)

    return {
        "type": "Feature",
        "geometry": geometry,
        "properties": {
            "id": center.id,
            "name": center.name,
            "center_type": center.center_type or "campus",
            "owner_name": center.owner_name,
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
    coords = []
    for p in points:
        if isinstance(p, (list, tuple)) and len(p) >= 2:
            coords.append((float(p[0]), float(p[1])))
        elif isinstance(p, dict):
            lng = p.get('lng') if p.get('lng') is not None else p.get('longitude')
            lat = p.get('lat') if p.get('lat') is not None else p.get('latitude')
            if lng is None or lat is None:
                raise ValueError("Each point must have lat and lng coordinates.")
            coords.append((float(lng), float(lat)))
        else:
            raise ValueError("Invalid point format in footprint.")

    # Check distinct points count for real point-count validation
    distinct_coords = coords[:-1] if (len(coords) >= 2 and coords[0] == coords[-1]) else coords
    if len(distinct_coords) < 3:
        raise ValueError("A footprint needs at least 3 points.")

    try:
        poly = Polygon(coords)
    except Exception:
        raise ValueError("A footprint needs at least 3 points.")

    if not poly.is_valid:
        raise ValueError("The outline crosses itself. Please redraw it so the lines do not cross.")
    return poly


def build_multipoint(points):
    if not points or len(points) < 1:
        raise ValueError("At least one entrance point is required.")
    coords = []
    for p in points:
        if isinstance(p, (list, tuple)) and len(p) >= 2:
            coords.append((float(p[0]), float(p[1])))
        elif isinstance(p, dict):
            lng = p.get('lng') if p.get('lng') is not None else p.get('longitude')
            lat = p.get('lat') if p.get('lat') is not None else p.get('latitude')
            if lng is None or lat is None:
                raise ValueError("Each entrance must have lat and lng coordinates.")
            coords.append((float(lng), float(lat)))
        else:
            raise ValueError("Invalid entrance point format.")
    return MultiPoint(coords)


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
        assigned = EvacuationAssignment.query.filter_by(room_id=room.id).count()
        occupied = EvacuationAssignment.query.filter(
            EvacuationAssignment.room_id == room.id,
            EvacuationAssignment.checked_in_at.isnot(None)
        ).count()
        is_assigned = assigned > 0
        room_dict = room.to_dict()
        room_dict["occupied"] = occupied
        room_dict["assigned"] = assigned
        room_dict["available"] = max((room.capacity or 0) - occupied, 0)
        room_dict["unassigned"] = max((room.capacity or 0) - assigned, 0)
        room_dict["is_assigned"] = is_assigned
        room_dict["is_fully_assigned"] = bool((room.capacity or 0) > 0 and assigned >= (room.capacity or 0))
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

    # Load distinct assigned families across all rooms or direct assignments of this center
    center_assignment_filter = or_(
        EvacuationAssignment.evacuation_center_id == center_id,
        EvacuationCenterRoom.evacuation_center_id == center_id
    )
    assigned_families_query = (
        db.session.query(
            Family.id,
            Family.family_code,
            Family.head_name,
            Family.member_count,
            Family.contact_number,
            Family.evacuation_status,
            EvacuationCenterRoom.id.label('room_id'),
            EvacuationCenterRoom.room_number,
            EvacuationCenterRoom.building_id,
            EvacuationCenterBuilding.name.label('building_name'),
            func.count(EvacuationAssignment.id).label('assigned_members'),
            func.count(EvacuationAssignment.checked_in_at).label('checked_in_members')
        )
        .join(Resident, Resident.family_id == Family.id)
        .join(EvacuationAssignment, EvacuationAssignment.resident_id == Resident.id)
        .outerjoin(EvacuationCenterRoom, EvacuationAssignment.room_id == EvacuationCenterRoom.id)
        .outerjoin(EvacuationCenterBuilding, EvacuationCenterRoom.building_id == EvacuationCenterBuilding.id)
        .filter(center_assignment_filter)
        .group_by(
            Family.id,
            Family.family_code,
            Family.head_name,
            Family.member_count,
            Family.contact_number,
            Family.evacuation_status,
            EvacuationCenterRoom.id,
            EvacuationCenterRoom.room_number,
            EvacuationCenterRoom.building_id,
            EvacuationCenterBuilding.name,
        )
        .all()
    )

    # Precompute special-needs chips per (family_id, room_id) from assigned residents
    special_needs_by_family_room = defaultdict(list)
    assigned_residents_rows = (
        db.session.query(Resident, EvacuationAssignment.room_id)
        .join(EvacuationAssignment, EvacuationAssignment.resident_id == Resident.id)
        .outerjoin(EvacuationCenterRoom, EvacuationAssignment.room_id == EvacuationCenterRoom.id)
        .filter(center_assignment_filter)
        .all()
    )
    today = date.today()
    for res, r_id in assigned_residents_rows:
        if not res.family_id:
            continue
        age = None
        if res.date_of_birth:
            age = today.year - res.date_of_birth.year - (
                (today.month, today.day) < (res.date_of_birth.month, res.date_of_birth.day)
            )
        flags = []
        if res.is_pwd:
            flags.append("PWD")
        if age is not None and age >= 60:
            flags.append("Senior")
        if age is not None and age <= 2:
            flags.append("Infant")
        if res.is_pregnant:
            flags.append("Pregnant")
        if res.is_lactating:
            flags.append("Lactating")
        if res.is_solo_parent:
            flags.append("Solo Parent")
        if res.needs_assistance:
            flags.append("Needs Assistance")
        key = (res.family_id, r_id)
        for fl in flags:
            if fl not in special_needs_by_family_room[key]:
                special_needs_by_family_room[key].append(fl)

    families_data = [
        {
            "family_id": row.id,
            "family_code": row.family_code,
            "head_name": row.head_name,
            "member_count": row.member_count or row.assigned_members,
            "contact_number": row.contact_number,
            "evacuation_status": "Assigned",
            "assignment_status": "Assigned",
            "is_assigned": True,
            "room_id": row.room_id,
            "room_number": row.room_number,
            "building_id": row.building_id,
            "building_name": (row.building_name or f"Building #{row.building_id}") if row.building_id else None,
            "assigned_members": row.assigned_members,
            "checked_in_members": int(row.checked_in_members or 0),
            "is_checked_in": int(row.checked_in_members or 0) > 0,
            "checkin_status": "Checked in" if int(row.checked_in_members or 0) > 0 else "Not yet arrived",
            "special_needs": special_needs_by_family_room.get((row.id, row.room_id), []),
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
    polygon_data = data.get('polygon')
    if polygon_data is None and isinstance(data.get('geometry'), dict):
        geom_val = data['geometry']
        if geom_val.get('type') == 'Polygon' and geom_val.get('coordinates'):
            polygon_data = geom_val['coordinates'][0]

    if polygon_data:
        try:
            polygon = build_polygon(polygon_data)
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

    raw_center_type = str(data.get('center_type') or '').strip().lower()
    valid_types = {'campus', 'single_venue', 'private_property'}
    if not raw_center_type or raw_center_type not in valid_types:
        return jsonify({"error": "center_type is required and must be one of: campus, single_venue, private_property"}), 400
    center_type = raw_center_type
    owner_name = str(data.get('owner_name') or '').strip() or None

    center = EvacuationCenter(
        name=name,
        center_type=center_type,
        owner_name=owner_name,
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
@centers_bp.route('/api/evacuation-centers/<int:center_id>/mapping', methods=['PATCH', 'PUT'])
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

    for field in ['building_material', 'accessibility_notes', 'hazard_exposure_score', 'contact_number', 'owner_name']:
        if field in data:
            setattr(center, field, data[field])

    if 'center_type' in data:
        raw_type = str(data.get('center_type') or '').strip().lower()
        if raw_type not in VALID_CENTER_TYPES:
            return jsonify({"error": "Invalid center type"}), 400

        # Validate the type change
        current_type = center.center_type or "campus"
        if raw_type != current_type:
            allowed, reason, blocked = validate_center_type_change(center, raw_type, current_type)
            if not allowed:
                return jsonify({
                    "error": f"Cannot change center type to '{raw_type}': {reason}",
                    "blocked_types": blocked
                }), 400

        center.center_type = raw_type

    polygon_data = data.get('polygon')
    if polygon_data is None and isinstance(data.get('geometry'), dict):
        geom_val = data['geometry']
        if geom_val.get('type') == 'Polygon' and geom_val.get('coordinates'):
            polygon_data = geom_val['coordinates'][0]

    if polygon_data is not None:
        try:
            polygon = build_polygon(polygon_data)
            center.geom = from_shape(polygon, srid=4326)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    if 'entrances' in data:
        entrances_data = data['entrances']
        if entrances_data:
            try:
                multipoint = build_multipoint(entrances_data)
                center.entrance_geom = from_shape(multipoint, srid=4326)
            except ValueError as e:
                return jsonify({"error": str(e)}), 400
        else:
            center.entrance_geom = None

    db.session.commit()

    user_id = get_jwt_identity()
    db.session.add(SystemLog(user_id=user_id, action=f"Edited evacuation center: {center.name}"))
    db.session.commit()

    return jsonify(center_to_feature(center))


@centers_bp.route('/api/evacuation-centers/<int:center_id>/allowed-center-types', methods=['GET'])
@role_required('admin', 'lgu_personnel')
def get_allowed_center_types(center_id):
    """Get allowed center types with reasons for a center."""
    center = EvacuationCenter.query.get_or_404(center_id)
    allowed = get_allowed_center_types(center)
    return jsonify(allowed)


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
        .outerjoin(EvacuationCenterRoom, EvacuationAssignment.room_id == EvacuationCenterRoom.id)
        .filter(or_(
            EvacuationAssignment.evacuation_center_id == center.id,
            EvacuationCenterRoom.evacuation_center_id == center.id
        ))
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

    return jsonify({"message": f"Evacuation center '{center.name}' successfully deleted"}), 200


@centers_bp.route('/api/evacuation-centers/<int:center_id>/available-families', methods=['GET'])
@role_required('admin', 'lgu_personnel')
def get_center_available_families(center_id):
    center = EvacuationCenter.query.get_or_404(center_id)

    assigned_family_ids = (
        db.session.query(Resident.family_id)
        .join(EvacuationAssignment, EvacuationAssignment.resident_id == Resident.id)
        .filter(Resident.family_id.is_not(None))
        .distinct()
        .all()
    )
    assigned_ids = [row[0] for row in assigned_family_ids]

    linked_barangay_ids = [link.barangay_id for link in center.barangay_links] if center.barangay_links else []

    query = Family.query
    if linked_barangay_ids:
        query = query.filter(Family.barangay_id.in_(linked_barangay_ids))
    if assigned_ids:
        query = query.filter(~Family.id.in_(assigned_ids))

    unassigned_families = query.options(joinedload(Family.barangay)).order_by(Family.head_name.asc()).all()

    result = []
    for fam in unassigned_families:
        member_count = fam.member_count or 1
        address = fam.address
        contact = fam.contact_number
        result.append({
            "id": fam.id,
            "family_id": fam.id,
            "family_code": fam.family_code,
            "household_head_name": fam.head_name,
            "head_name": fam.head_name,
            "barangay": fam.barangay.name if fam.barangay else None,
            "barangay_id": fam.barangay_id,
            "address": address,
            "contact_number": contact,
            "family_members": member_count,
            "member_count": member_count,
            "evacuation_status": "Unassigned",
            "assignment_status": "Unassigned"
        })

    return jsonify(result), 200

    return jsonify({
        "message": f"Evacuation center '{center.name}' deactivated safely.",
        "center_id": center.id
    }), 200
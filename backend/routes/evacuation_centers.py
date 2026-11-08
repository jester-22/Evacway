from flask import Blueprint, request, jsonify
from sqlalchemy import func, or_
from sqlalchemy.orm import joinedload
from collections import defaultdict
from datetime import date
from models import (
    Amenity,
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
    philippines_now,
)
from geoalchemy2.shape import to_shape, from_shape
from shapely.geometry import mapping, Polygon, MultiPoint, Point
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
                "status": b.status or "open",
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
def get_valid_center_types():
    try:
        types = [
            ct.code for ct in CenterType.query.filter_by(is_active=True).all()
        ]
        if types:
            return set(types)
    except Exception:
        pass
    return {'campus', 'single_venue', 'private_property'}

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

    amenities_list = [a.to_dict() for a in center.amenities] if hasattr(center, 'amenities') and center.amenities else []
    amenity_ids = [a["id"] for a in amenities_list]
    return {
        "type": "Feature",
        "geometry": geometry,
        "properties": {
            "id": center.id,
            "name": center.name,
            "center_type": center.center_type or "campus",
            "center_type_id": center.center_type_id,
            "center_type_name": center.center_type_name,
            "owner_name": center.owner_name,
            **metrics,
            "building_material": center.building_material,
            "building_material_id": center.building_material_id,
            "amenities": amenities_list,
            "amenity_ids": amenity_ids,
            "accessibility_features": amenities_list,
            "accessibility_feature_ids": amenity_ids,
            "accessibility_notes": ", ".join(a["name"] for a in amenities_list),
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

    center_type_id = data.get('center_type_id')
    if not center_type_id and center_type:
        ct = CenterType.query.filter_by(code=center_type).first()
        if ct:
            center_type_id = ct.id

    building_material_id = data.get('building_material_id')
    if not building_material_id and data.get('building_material'):
        bm = BuildingMaterial.query.filter(
            (BuildingMaterial.name.ilike(str(data.get('building_material')).strip())) |
            (BuildingMaterial.code == str(data.get('building_material')).strip().lower())
        ).first()
        if bm:
            building_material_id = bm.id

    center = EvacuationCenter(
        name=name,
        center_type_id=center_type_id,
        owner_name=owner_name,
        capacity=capacity,
        building_material_id=building_material_id,
        hazard_exposure_score=data.get('hazard_exposure_score'),
        contact_number=data.get('contact_number'),
        is_active=True,
        geom=geom,
        entrance_geom=entrance_geom,
        managed_by=user_id
    )
    raw_amenities = data.get('amenity_ids') or data.get('accessibility_feature_ids') or []
    amenity_ids = [int(x) for x in raw_amenities if str(x).isdigit()]
    if amenity_ids:
        center.amenities = Amenity.query.filter(Amenity.id.in_(amenity_ids)).all()
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

    if 'amenity_ids' in data or 'accessibility_feature_ids' in data:
        raw_amenities = data.get('amenity_ids') if 'amenity_ids' in data else data.get('accessibility_feature_ids')
        amenity_ids = [int(x) for x in (raw_amenities or []) if str(x).isdigit()]
        center.amenities = Amenity.query.filter(Amenity.id.in_(amenity_ids)).all() if amenity_ids else []

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


# ---------------------------------------------------------------------------
# EVACUEE ARRIVAL & CHECK-IN ENDPOINTS
# ---------------------------------------------------------------------------

@centers_bp.route('/api/evacuation-centers/<int:center_id>/check-in', methods=['POST'])
@role_required('admin', 'lgu_personnel')
def update_evacuee_check_in(center_id):
    center = EvacuationCenter.query.get(center_id)
    if not center:
        return jsonify({"error": "Evacuation center not found"}), 404

    data = request.get_json() or {}
    family_id = data.get('family_id')
    resident_id = data.get('resident_id')
    resident_ids = data.get('resident_ids')  # Optional list of resident IDs specifically checked in
    action = data.get('action', 'check_in')  # 'check_in', 'check_out', or 'partial'
    method = data.get('method', 'manual')    # 'manual' or 'geofence'

    if not family_id and not resident_id and not resident_ids:
        return jsonify({"error": "family_id, resident_id, or resident_ids is required"}), 400

    target_resident_ids = []
    family = None
    if family_id:
        family = Family.query.get(family_id)
        if not family:
            return jsonify({"error": "Family not found"}), 404
        residents = Resident.query.filter_by(family_id=family_id).all()
        target_resident_ids = [r.id for r in residents]
    elif resident_id:
        res = Resident.query.get(resident_id)
        if not res:
            return jsonify({"error": "Resident not found"}), 404
        target_resident_ids = [res.id]
        if res.family_id:
            family = Family.query.get(res.family_id)

    # Find assignments in this center (direct or via room)
    assignments = (
        EvacuationAssignment.query
        .filter(EvacuationAssignment.resident_id.in_(target_resident_ids))
        .filter(
            or_(
                EvacuationAssignment.evacuation_center_id == center_id,
                EvacuationAssignment.room_id.in_(
                    db.session.query(EvacuationCenterRoom.id).filter_by(evacuation_center_id=center_id)
                )
            )
        )
        .all()
    )

    if not assignments:
        return jsonify({"error": "No assignments found for this resident/family in this evacuation center"}), 404

    current_user_id = None
    try:
        identity = get_jwt_identity()
        if isinstance(identity, dict):
            current_user_id = identity.get('id')
        elif identity:
            current_user_id = int(identity)
    except Exception:
        pass

    now = philippines_now()
    head_name = family.head_name if family else f"Resident #{resident_id}"
    fam_code = f" ({family.family_code})" if family and family.family_code else ""

    # Specific member selection check-in (Partial or Full member checklist)
    if resident_ids is not None:
        present_set = set(int(rid) for rid in resident_ids)
        for a in assignments:
            if a.resident_id in present_set:
                if not a.checked_in_at:
                    a.checked_in_at = now
            else:
                a.checked_in_at = None

        checked_count = sum(1 for a in assignments if a.checked_in_at is not None)
        total_assigned = len(assignments)

        if family:
            if checked_count >= total_assigned and total_assigned > 0:
                family.evacuation_status = "Evacuated"
            elif checked_count > 0:
                family.evacuation_status = "Partially Evacuated"
            else:
                family.evacuation_status = "Assigned"

        log_action = f"Updated check-in for {head_name}{fam_code}: {checked_count}/{total_assigned} members present at {center.name}"
        db.session.add(SystemLog(user_id=current_user_id, action=log_action, timestamp=now))
        db.session.commit()

        checkin_state = "full" if (checked_count >= total_assigned and total_assigned > 0) else ("partial" if checked_count > 0 else "none")

        return jsonify({
            "success": True,
            "message": f"Updated check-in: {checked_count} of {total_assigned} members present.",
            "checked_in_members": checked_count,
            "assigned_members": total_assigned,
            "is_checked_in": checked_count > 0,
            "checkin_state": checkin_state,
            "family_id": family_id,
            "action": "partial_check_in"
        }), 200

    elif action == 'check_in':
        for a in assignments:
            if not a.checked_in_at:
                a.checked_in_at = now
        if family:
            family.evacuation_status = "Evacuated"

        log_action = f"Checked in {head_name}{fam_code} at {center.name} via {method}"
        db.session.add(SystemLog(user_id=current_user_id, action=log_action, timestamp=now))
        db.session.commit()

        return jsonify({
            "success": True,
            "message": f"Successfully checked in {head_name} (all members).",
            "is_checked_in": True,
            "checkin_state": "full",
            "checked_in_members": len(assignments),
            "assigned_members": len(assignments),
            "checked_in_at": now.isoformat(),
            "family_id": family_id,
            "resident_id": resident_id,
            "action": "check_in"
        }), 200

    elif action == 'check_out':
        for a in assignments:
            a.checked_in_at = None
        if family:
            family.evacuation_status = "Assigned"

        log_action = f"Undid check-in for {head_name}{fam_code} at {center.name}"
        db.session.add(SystemLog(user_id=current_user_id, action=log_action, timestamp=now))
        db.session.commit()

        return jsonify({
            "success": True,
            "message": f"Check-in undone for {head_name}.",
            "is_checked_in": False,
            "checkin_state": "none",
            "checked_in_members": 0,
            "assigned_members": len(assignments),
            "family_id": family_id,
            "resident_id": resident_id,
            "action": "check_out"
        }), 200
    else:
        return jsonify({"error": f"Invalid action: {action}"}), 400


@centers_bp.route('/api/evacuation-centers/check-in/auto', methods=['POST'])
def auto_geofence_check_in():
    data = request.get_json() or {}
    resident_id = data.get('resident_id')
    family_id = data.get('family_id')
    center_id = data.get('center_id')
    lat = data.get('latitude')
    lng = data.get('longitude')

    if not center_id or (not resident_id and not family_id):
        return jsonify({"error": "center_id and resident_id or family_id required"}), 400

    center = EvacuationCenter.query.get(center_id)
    if not center:
        return jsonify({"error": "Evacuation center not found"}), 404

    # Validate coordinate overlap / proximity
    is_inside = False
    if lat is not None and lng is not None:
        if center.geom is not None:
            try:
                pt = Point(float(lng), float(lat))
                center_shape = to_shape(center.geom)
                if center_shape.contains(pt) or center_shape.distance(pt) < 0.00065:
                    is_inside = True
            except Exception:
                pass

        if not is_inside and center.latitude and center.longitude:
            import math
            R = 6371000
            dlat = math.radians(float(center.latitude) - float(lat))
            dlng = math.radians(float(center.longitude) - float(lng))
            a = (math.sin(dlat/2)**2 +
                 math.cos(math.radians(float(lat))) * math.cos(math.radians(float(center.latitude))) *
                 math.sin(dlng/2)**2)
            c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
            if R * c <= 75:  # within 75 meters
                is_inside = True

    if lat is not None and lng is not None and not is_inside:
        return jsonify({
            "success": False,
            "message": "Current location is not inside the evacuation center boundary.",
            "is_inside": False
        }), 400

    # Collect target resident IDs
    target_resident_ids = []
    family = None
    if family_id:
        family = Family.query.get(family_id)
        if family:
            residents = Resident.query.filter_by(family_id=family.id).all()
            target_resident_ids = [r.id for r in residents]
    elif resident_id:
        res = Resident.query.get(resident_id)
        if res:
            target_resident_ids = [res.id]
            if res.family_id:
                family = Family.query.get(res.family_id)

    assignments = (
        EvacuationAssignment.query
        .filter(EvacuationAssignment.resident_id.in_(target_resident_ids))
        .filter(
            or_(
                EvacuationAssignment.evacuation_center_id == center_id,
                EvacuationAssignment.room_id.in_(
                    db.session.query(EvacuationCenterRoom.id).filter_by(evacuation_center_id=center_id)
                )
            )
        )
        .all()
    )

    if not assignments:
        return jsonify({"error": "No assignment found for this center"}), 404

    now = philippines_now()
    already_checked_in = all(a.checked_in_at is not None for a in assignments)
    if not already_checked_in:
        for a in assignments:
            if not a.checked_in_at:
                a.checked_in_at = now
        if family:
            family.evacuation_status = "Evacuated"

        head_name = family.head_name if family else f"Resident #{resident_id}"
        fam_code = f" ({family.family_code})" if family and family.family_code else ""
        db.session.add(SystemLog(action=f"Auto checked in {head_name}{fam_code} at {center.name} via GPS geofence", timestamp=now))
        db.session.commit()

    # Find assigned room if any
    first_room_assignment = next((a for a in assignments if a.room_id is not None), None)
    room_number = None
    if first_room_assignment:
        room_obj = EvacuationCenterRoom.query.get(first_room_assignment.room_id)
        if room_obj:
            room_number = room_obj.room_number

    return jsonify({
        "success": True,
        "already_checked_in": already_checked_in,
        "message": f"Welcome! You have arrived at {center.name}." + (f" Your assigned room is {room_number}." if room_number else ""),
        "is_checked_in": True,
        "checked_in_at": now.isoformat(),
        "center_name": center.name,
        "room_number": room_number
    }), 200


@centers_bp.route('/api/evacuation-centers/check-in-list', methods=['GET'])
@role_required('admin', 'lgu_personnel')
def get_check_in_list():
    center_id_param = request.args.get('center_id')
    search_query = request.args.get('q', '').strip().lower()
    status_filter = request.args.get('status', 'all')  # 'all', 'checked_in', 'pending'

    # 1. Fetch active centers with live counts
    active_centers = EvacuationCenter.query.filter_by(is_active=True).order_by(EvacuationCenter.name.asc()).all()
    centers_summary = []
    
    # Precompute center stats
    center_assigned_totals = dict(
        db.session.query(
            EvacuationAssignment.evacuation_center_id,
            func.count(EvacuationAssignment.id)
        ).group_by(EvacuationAssignment.evacuation_center_id).all()
    )
    center_checked_totals = dict(
        db.session.query(
            EvacuationAssignment.evacuation_center_id,
            func.count(EvacuationAssignment.id)
        ).filter(EvacuationAssignment.checked_in_at.isnot(None))
        .group_by(EvacuationAssignment.evacuation_center_id).all()
    )

    for c in active_centers:
        tot_assigned = center_assigned_totals.get(c.id, 0)
        tot_checked = center_checked_totals.get(c.id, 0)
        cap = int(c.capacity or 0)
        centers_summary.append({
            "id": c.id,
            "name": c.name,
            "center_type": c.center_type or "campus",
            "capacity": cap,
            "assigned": tot_assigned,
            "checked_in": tot_checked,
            "space_left": max(cap - tot_assigned, 0),
        })

    # 2. Query assigned families with assignments
    base_filter = []
    if center_id_param and center_id_param != "all":
        try:
            cid = int(center_id_param)
            base_filter.append(or_(
                EvacuationAssignment.evacuation_center_id == cid,
                EvacuationCenterRoom.evacuation_center_id == cid
            ))
        except ValueError:
            pass

    assigned_query = (
        db.session.query(
            Family.id.label('family_id'),
            Family.family_code,
            Family.head_name,
            Family.member_count,
            Family.contact_number,
            Family.address,
            Barangay.id.label('barangay_id'),
            Barangay.name.label('barangay_name'),
            EvacuationCenter.id.label('center_id'),
            EvacuationCenter.name.label('center_name'),
            EvacuationCenterRoom.id.label('room_id'),
            EvacuationCenterRoom.room_number,
            EvacuationCenterBuilding.name.label('building_name'),
            func.count(EvacuationAssignment.id).label('assigned_members'),
            func.count(EvacuationAssignment.checked_in_at).label('checked_in_members'),
            func.max(EvacuationAssignment.checked_in_at).label('latest_checked_in_at')
        )
        .join(Resident, Resident.family_id == Family.id)
        .join(EvacuationAssignment, EvacuationAssignment.resident_id == Resident.id)
        .outerjoin(Barangay, Family.barangay_id == Barangay.id)
        .outerjoin(EvacuationCenterRoom, EvacuationAssignment.room_id == EvacuationCenterRoom.id)
        .outerjoin(EvacuationCenterBuilding, EvacuationCenterRoom.building_id == EvacuationCenterBuilding.id)
        .outerjoin(
            EvacuationCenter,
            or_(
                EvacuationAssignment.evacuation_center_id == EvacuationCenter.id,
                EvacuationCenterRoom.evacuation_center_id == EvacuationCenter.id
            )
        )
    )

    if base_filter:
        assigned_query = assigned_query.filter(*base_filter)

    assigned_rows = (
        assigned_query
        .group_by(
            Family.id,
            Family.family_code,
            Family.head_name,
            Family.member_count,
            Family.contact_number,
            Family.address,
            Barangay.id,
            Barangay.name,
            EvacuationCenter.id,
            EvacuationCenter.name,
            EvacuationCenterRoom.id,
            EvacuationCenterRoom.room_number,
            EvacuationCenterBuilding.name,
        )
        .order_by(Family.head_name.asc())
        .all()
    )

    # 3. Precompute vulnerable flags and members per family
    family_ids = [r.family_id for r in assigned_rows]
    special_needs_map = defaultdict(list)
    members_map = defaultdict(list)

    if family_ids:
        today = date.today()
        residents = (
            Resident.query
            .filter(Resident.family_id.in_(family_ids))
            .order_by(Resident.is_head_of_family.desc(), Resident.first_name.asc())
            .all()
        )
        all_res_ids = [res.id for res in residents]

        # Get assignment checkin timestamps for each resident in this center
        assignment_checkin_map = {}
        if all_res_ids:
            ass_records = EvacuationAssignment.query.filter(EvacuationAssignment.resident_id.in_(all_res_ids)).all()
            for a in ass_records:
                assignment_checkin_map[a.resident_id] = a.checked_in_at

        for res in residents:
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

            for fl in flags:
                if fl not in special_needs_map[res.family_id]:
                    special_needs_map[res.family_id].append(fl)

            chk_time = assignment_checkin_map.get(res.id)
            members_map[res.family_id].append({
                "id": res.id,
                "name": f"{res.first_name} {res.last_name}".strip(),
                "first_name": res.first_name,
                "last_name": res.last_name,
                "relationship": res.relationship_to_head or ("Head" if res.is_head_of_family else "Member"),
                "is_head": bool(res.is_head_of_family),
                "is_checked_in": chk_time is not None,
                "checked_in_at": chk_time.isoformat() if chk_time else None,
                "special_needs": flags,
            })

    # 4. Build evacuees list and calculate summary
    evacuees = []
    tot_fully_checked_in = 0
    tot_partially_checked_in = 0
    tot_pending = 0
    tot_assigned = 0

    for r in assigned_rows:
        tot_assigned += 1
        m_list = members_map.get(r.family_id, [])
        m_count = len(m_list) if m_list else int(r.assigned_members or r.member_count or 1)
        chk_count = sum(1 for m in m_list if m["is_checked_in"]) if m_list else int(r.checked_in_members or 0)
        latest_at = r.latest_checked_in_at.isoformat() if r.latest_checked_in_at else None

        # Determine checkin state
        if chk_count >= m_count and m_count > 0:
            checkin_state = "full"
            tot_fully_checked_in += 1
        elif chk_count > 0:
            checkin_state = "partial"
            tot_partially_checked_in += 1
        else:
            checkin_state = "none"
            tot_pending += 1

        # Apply status filter
        if status_filter == 'checked_in' and checkin_state != 'full':
            continue
        if status_filter == 'partial' and checkin_state != 'partial':
            continue
        if status_filter == 'pending' and checkin_state != 'none':
            continue

        # Apply search query
        if search_query:
            member_names = " ".join(m["name"] for m in m_list).lower()
            target_str = f"{r.head_name or ''} {r.family_code or ''} {r.contact_number or ''} {r.room_number or ''} {r.barangay_name or ''} {r.center_name or ''} {member_names}".lower()
            if search_query not in target_str:
                continue

        evacuees.append({
            "family_id": r.family_id,
            "family_code": r.family_code,
            "head_name": r.head_name or "Unnamed Household",
            "member_count": m_count,
            "contact_number": r.contact_number,
            "address": r.address,
            "barangay_id": r.barangay_id,
            "barangay_name": r.barangay_name or "Unknown",
            "center_id": r.center_id,
            "center_name": r.center_name or "Evacuation Center",
            "room_id": r.room_id,
            "room_number": r.room_number,
            "building_name": r.building_name,
            "assigned_members": m_count,
            "checked_in_members": chk_count,
            "is_checked_in": chk_count > 0,
            "checkin_state": checkin_state,  # "full" | "partial" | "none"
            "checked_in_at": latest_at,
            "checkin_status": (
                "Fully arrived" if checkin_state == "full"
                else (f"{chk_count} of {m_count} arrived" if checkin_state == "partial" else "Pending arrival")
            ),
            "special_needs": special_needs_map.get(r.family_id, []),
            "members": m_list,
        })

    return jsonify({
        "centers": centers_summary,
        "evacuees": evacuees,
        "summary": {
            "total_assigned": tot_assigned,
            "total_checked_in": tot_fully_checked_in,
            "total_partial": tot_partially_checked_in,
            "total_pending": tot_pending,
            "total_residents_assigned": sum(e.get("assigned_members", 0) for e in evacuees),
            "total_residents_checked_in": sum(e.get("checked_in_members", 0) for e in evacuees),
            "occupancy_rate": round(((tot_fully_checked_in + tot_partially_checked_in) / tot_assigned * 100), 1) if tot_assigned > 0 else 0
        }
    }), 200

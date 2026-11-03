from flask import Blueprint, request, jsonify
from sqlalchemy import func
from collections import defaultdict
from datetime import date
import re

from models import (
    db,
    EvacuationCenter,
    EvacuationCenterBuilding,
    EvacuationCenterRoom,
    EvacuationAssignment,
    Family,
    Resident,
    User,
)
from geoalchemy2.shape import to_shape, from_shape
from shapely.geometry import mapping, Polygon, shape, Point
from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity
from flask_jwt_extended.exceptions import JWTExtendedException
from utils import role_required

buildings_bp = Blueprint('buildings', __name__)


def _format_room_range(rooms, building_name=None):
    if not rooms:
        return building_name or "Building"

    # Extract digits from room numbers where possible
    parsed = []
    has_non_int = False
    for r in rooms:
        raw = str(r.room_number or "").strip()
        match = re.search(r'\d+', raw)
        if match:
            parsed.append((int(match.group(0)), raw))
        else:
            has_non_int = True
            parsed.append((999999, raw))

    if building_name and building_name.strip():
        # If building has a name, show name or name + range
        if len(rooms) == 1:
            return f"{building_name} ({rooms[0].room_number})"
        return building_name

    if has_non_int or not parsed:
        room_labels = [r.room_number for r in rooms[:3]]
        label = ", ".join(room_labels)
        if len(rooms) > 3:
            label += f" +{len(rooms) - 3}"
        return f"Rm {label}"

    # Sort by number
    parsed.sort(key=lambda x: x[0])
    nums = [p[0] for p in parsed]

    # Check if single room
    if len(nums) == 1:
        return f"Rm {nums[0]}"

    # Group into consecutive ranges
    ranges = []
    start = nums[0]
    prev = nums[0]
    for n in nums[1:]:
        if n == prev + 1:
            prev = n
        else:
            ranges.append(f"{start}-{prev}" if start != prev else f"{start}")
            start = n
            prev = n
    ranges.append(f"{start}-{prev}" if start != prev else f"{start}")

    range_str = ", ".join(ranges)
    return f"Rm {range_str}"


def _get_caller_user():
    try:
        verify_jwt_in_request(optional=True)
        identity = get_jwt_identity()
        if identity:
            return db.session.get(User, identity)
    except Exception:
        pass
    return None


# =========================================================
# 1. LIST BUILDINGS OF A CENTER (GeoJSON FeatureCollection)
# =========================================================
@buildings_bp.route('/api/evacuation-centers/<int:center_id>/buildings', methods=['GET'])
def get_center_buildings(center_id):
    center = db.session.get(EvacuationCenter, center_id)
    if not center:
        return jsonify({"error": "Evacuation center not found"}), 404

    buildings = EvacuationCenterBuilding.query.filter_by(evacuation_center_id=center_id).order_by(EvacuationCenterBuilding.id.asc()).all()
    features = []

    # Parse and resolve any polygon overlaps non-destructively so no two buildings overlap
    raw_polys = {}
    for b in buildings:
        try:
            if b.geom is not None:
                poly = to_shape(b.geom)
                if not poly.is_valid:
                    poly = poly.buffer(0)
                raw_polys[b.id] = poly
        except Exception:
            continue

    resolved_polys = {}
    for b in buildings:
        if b.id not in raw_polys:
            continue
        geom = raw_polys[b.id]
        for prev_id, prev_geom in resolved_polys.items():
            if geom.intersects(prev_geom):
                inter = geom.intersection(prev_geom)
                if inter.area > 1e-12:
                    diff = geom.difference(prev_geom)
                    if not diff.is_empty:
                        geom = diff
        resolved_polys[b.id] = geom

    for b in buildings:
        # Handle buildings with and without geometry
        if b.id in resolved_polys:
            poly = resolved_polys[b.id]
            geom_dict = mapping(poly)
        else:
            geom_dict = None  # Building not yet mapped

        rooms = EvacuationCenterRoom.query.filter(
            EvacuationCenterRoom.building_id == b.id,
            EvacuationCenterRoom.is_active == True
        ).order_by(EvacuationCenterRoom.room_number.asc()).all()
        room_ids = [r.id for r in rooms]

        total_capacity = sum(r.capacity or 0 for r in rooms)
        total_assigned = 0
        total_occupied = 0
        room_stats_map = {}
        if room_ids:
            rows = (
                db.session.query(
                    EvacuationAssignment.room_id,
                    func.count(EvacuationAssignment.id).label("assigned"),
                    func.count(EvacuationAssignment.checked_in_at).label("occupied"),
                )
                .filter(EvacuationAssignment.room_id.in_(room_ids))
                .group_by(EvacuationAssignment.room_id)
                .all()
            )
            for row in rows:
                r_ass = int(row.assigned or 0)
                r_occ = int(row.occupied or 0)
                room_stats_map[row.room_id] = (r_ass, r_occ)
                total_assigned += r_ass
                total_occupied += r_occ

        if total_capacity > 0:
            occ_rate = total_occupied / total_capacity
            assigned_rate = total_assigned / total_capacity
            if total_occupied >= total_capacity:
                status = "Full"
                fill_color = "#dc2626"  # Red
                outline_color = "#991b1b"
            elif occ_rate >= 0.7:
                status = "Near Capacity"
                fill_color = "#d97706"  # Amber
                outline_color = "#b45309"
            else:
                status = "Available"
                fill_color = "#16a34a"  # Green
                outline_color = "#15803d"
        else:
            occ_rate = 0.0
            assigned_rate = 0.0
            status = "No Capacity"
            fill_color = "#94a3b8"  # Gray
            outline_color = "#64748b"

        display_label = _format_room_range(rooms, b.name)

        rooms_summary = [
            {
                "id": r.id,
                "room_number": r.room_number,
                "capacity": r.capacity,
                "occupied": room_stats_map.get(r.id, (0, 0))[1],
                "assigned": room_stats_map.get(r.id, (0, 0))[0],
                "is_active": r.is_active,
            }
            for r in rooms
        ]

        features.append({
            "type": "Feature",
            "id": b.id,
            "geometry": geom_dict,
            "properties": {
                "id": b.id,
                "name": b.name,
                "display_label": display_label,
                "evacuation_center_id": center_id,
                "center_name": center.name,
                "room_count": len(rooms),
                "capacity": total_capacity,
                "occupied": total_occupied,
                "assigned": total_assigned,
                "available": max(total_capacity - total_occupied, 0),
                "unassigned": max(total_capacity - total_assigned, 0),
                "occupancy_rate": round(occ_rate, 2),
                "occupancy_pct": min(100, round(occ_rate * 100)),
                "assigned_rate": round(assigned_rate, 2),
                "assigned_pct": min(100, round(assigned_rate * 100)),
                "is_fully_assigned": bool(total_capacity > 0 and total_assigned >= total_capacity),
                "status": status,
                "fill_color": fill_color,
                "outline_color": outline_color,
                "rooms": rooms_summary,
                "is_mapped": b.geom is not None,
            }
        })

    return jsonify({
        "type": "FeatureCollection",
        "features": features
    })


# =========================================================
# 2. CREATE BUILDING (Staff only)
# =========================================================
@buildings_bp.route('/api/evacuation-centers/<int:center_id>/buildings', methods=['POST'])
@role_required('admin', 'lgu_personnel')
def create_building(center_id):
    center = db.session.get(EvacuationCenter, center_id)
    if not center:
        return jsonify({"error": "Evacuation center not found"}), 404

    # Only campus type centers can have buildings
    if center.center_type != 'campus':
        return jsonify({"error": f"Buildings can only be created for 'campus' type centers. This center is '{center.center_type}'."}), 400

    data = request.get_json() or {}
    name = (data.get('name') or '').strip() or None
    raw_coords = data.get('coordinates')
    geojson_geom = data.get('geometry')
    room_ids = data.get('room_ids') or []

    # New fields
    max_rooms = data.get('max_rooms')
    if max_rooms is not None and str(max_rooms).strip() != "":
        try:
            max_rooms = int(max_rooms)
            if max_rooms < 1:
                return jsonify({"error": "max_rooms must be 1 or greater"}), 400
        except (ValueError, TypeError):
            return jsonify({"error": "max_rooms must be a number"}), 400
    else:
        max_rooms = None

    floors = data.get('floors')
    if floors is not None and str(floors).strip() != "":
        try:
            floors = int(floors)
            if floors < 1:
                return jsonify({"error": "floors must be 1 or greater"}), 400
        except (ValueError, TypeError):
            return jsonify({"error": "floors must be a number"}), 400
    else:
        floors = None

    status = data.get('status', 'open')
    if status not in ('open', 'closed', 'under_repair'):
        return jsonify({"error": "status must be one of: open, closed, under_repair"}), 400

    notes = data.get('notes')

    # Geometry is optional - building can be created without location and mapped later
    building_geom = None
    if geojson_geom and isinstance(geojson_geom, dict):
        try:
            poly_shape = shape(geojson_geom)
            if not poly_shape.is_valid:
                poly_shape = poly_shape.buffer(0)
            if poly_shape.geom_type == 'Polygon' and not poly_shape.is_empty:
                building_geom = from_shape(poly_shape, srid=4326)
        except Exception as e:
            return jsonify({"error": f"Invalid geometry: {str(e)}"}), 400
    elif raw_coords and isinstance(raw_coords, list):
        try:
            # Check if coordinates is [[[lng, lat], ...]] (rings) or [[lng, lat], ...]
            if len(raw_coords) > 0 and isinstance(raw_coords[0][0], (int, float)):
                coords_list = [raw_coords]
            else:
                coords_list = raw_coords
            poly_shape = Polygon(coords_list[0], coords_list[1:] if len(coords_list) > 1 else None)
            if not poly_shape.is_valid:
                poly_shape = poly_shape.buffer(0)
            if poly_shape.geom_type == 'Polygon' and not poly_shape.is_empty:
                building_geom = from_shape(poly_shape, srid=4326)
        except Exception as e:
            return jsonify({"error": f"Invalid polygon coordinates: {str(e)}"}), 400

    new_building = EvacuationCenterBuilding(
        evacuation_center_id=center_id,
        name=name,
        geom=building_geom,
        max_rooms=max_rooms,
        floors=floors,
        status=status,
        notes=notes
    )
    db.session.add(new_building)
    db.session.flush()

    # Link selected rooms if provided
    if room_ids:
        EvacuationCenterRoom.query.filter(
            EvacuationCenterRoom.id.in_(room_ids),
            EvacuationCenterRoom.evacuation_center_id == center_id
        ).update({EvacuationCenterRoom.building_id: new_building.id}, synchronize_session=False)

    db.session.commit()

    return jsonify({
        "success": True,
        "message": "Building created successfully",
        "building": new_building.to_dict()
    }), 201


# =========================================================
# 3. UPDATE / REDRAW BUILDING & LINK/UNLINK ROOMS (Staff only)
# =========================================================
@buildings_bp.route('/api/buildings/<int:building_id>', methods=['PUT'])
@role_required('admin', 'lgu_personnel')
def update_building(building_id):
    building = db.session.get(EvacuationCenterBuilding, building_id)
    if not building:
        return jsonify({"error": "Building not found"}), 404

    data = request.get_json() or {}

    if 'name' in data:
        building.name = data['name'].strip() if data['name'] else None

    # Redraw polygon geometry if provided
    if 'geometry' in data and data['geometry']:
        try:
            poly_shape = shape(data['geometry'])
            if not poly_shape.is_valid:
                poly_shape = poly_shape.buffer(0)
            if poly_shape.geom_type == 'Polygon' and not poly_shape.is_empty:
                building.geom = from_shape(poly_shape, srid=4326)
        except Exception as e:
            return jsonify({"error": f"Invalid geometry: {str(e)}"}), 400
    elif 'coordinates' in data and data['coordinates']:
        try:
            raw_coords = data['coordinates']
            coords_list = [raw_coords] if isinstance(raw_coords[0][0], (int, float)) else raw_coords
            poly_shape = Polygon(coords_list[0])
            if not poly_shape.is_valid:
                poly_shape = poly_shape.buffer(0)
            if poly_shape.geom_type == 'Polygon' and not poly_shape.is_empty:
                building.geom = from_shape(poly_shape, srid=4326)
        except Exception as e:
            return jsonify({"error": f"Invalid polygon coordinates: {str(e)}"}), 400

    # Sync room links if room_ids provided
    if 'room_ids' in data:
        new_room_ids = set(data['room_ids'] or [])
        # Unlink rooms currently in this building not in new_room_ids
        EvacuationCenterRoom.query.filter_by(building_id=building.id).filter(
            ~EvacuationCenterRoom.id.in_(new_room_ids)
        ).update({EvacuationCenterRoom.building_id: None}, synchronize_session=False)

        # Link rooms in new_room_ids to this building
        if new_room_ids:
            EvacuationCenterRoom.query.filter(
                EvacuationCenterRoom.id.in_(new_room_ids),
                EvacuationCenterRoom.evacuation_center_id == building.evacuation_center_id
            ).update({EvacuationCenterRoom.building_id: building.id}, synchronize_session=False)

    if 'add_room_ids' in data:
        add_ids = set(data['add_room_ids'] or [])
        if add_ids:
            EvacuationCenterRoom.query.filter(
                EvacuationCenterRoom.id.in_(add_ids),
                EvacuationCenterRoom.evacuation_center_id == building.evacuation_center_id
            ).update({EvacuationCenterRoom.building_id: building.id}, synchronize_session=False)

    if 'remove_room_ids' in data:
        rem_ids = set(data['remove_room_ids'] or [])
        if rem_ids:
            EvacuationCenterRoom.query.filter(
                EvacuationCenterRoom.id.in_(rem_ids),
                EvacuationCenterRoom.building_id == building.id
            ).update({EvacuationCenterRoom.building_id: None}, synchronize_session=False)

    # Update max_rooms with validation
    if 'max_rooms' in data:
        max_rooms = data.get('max_rooms')
        if max_rooms is not None and str(max_rooms).strip() != "":
            try:
                max_rooms = int(max_rooms)
                if max_rooms < 1:
                    return jsonify({"error": "max_rooms must be 1 or greater"}), 400
            except (ValueError, TypeError):
                return jsonify({"error": "max_rooms must be a number"}), 400
        else:
            max_rooms = None

        # Check if lowering max_rooms below active rooms count
        active_rooms_count = EvacuationCenterRoom.query.filter_by(
            building_id=building.id, is_active=True
        ).count()
        if max_rooms is not None and max_rooms < active_rooms_count:
            return jsonify({
                "error": f"Cannot set max_rooms to {max_rooms}: this building has {active_rooms_count} active room(s). Deactivate or delete rooms first."
            }), 400

        building.max_rooms = max_rooms

    # Update floors with validation
    if 'floors' in data:
        floors = data.get('floors')
        if floors is not None and str(floors).strip() != "":
            try:
                floors = int(floors)
                if floors < 1:
                    return jsonify({"error": "floors must be 1 or greater"}), 400
            except (ValueError, TypeError):
                return jsonify({"error": "floors must be a number"}), 400
        else:
            floors = None
        building.floors = floors

    # Update status with validation
    if 'status' in data:
        status = data.get('status')
        if status not in ('open', 'closed', 'under_repair'):
            return jsonify({"error": "status must be one of: open, closed, under_repair"}), 400
        building.status = status

    # Update notes
    if 'notes' in data:
        building.notes = data.get('notes')

    db.session.commit()

    return jsonify({
        "success": True,
        "message": "Building updated successfully",
        "building": building.to_dict()
    })


# =========================================================
# 4. DELETE BUILDING (Staff only - unlinks rooms)
# =========================================================
@buildings_bp.route('/api/buildings/<int:building_id>', methods=['DELETE'])
@role_required('admin', 'lgu_personnel')
def delete_building(building_id):
    building = db.session.get(EvacuationCenterBuilding, building_id)
    if not building:
        return jsonify({"error": "Building not found"}), 404

    # Check if building has any rooms (active or inactive)
    room_count = EvacuationCenterRoom.query.filter_by(building_id=building.id).count()
    if room_count > 0:
        return jsonify({
            "error": f"Cannot delete building: it still has {room_count} room(s). Remove or reassign them first."
        }), 400

    # Check if any households are assigned through rooms in this building
    assigned_families = db.session.query(func.count(func.distinct(Family.id))) \
        .join(Resident, Resident.family_id == Family.id) \
        .join(EvacuationAssignment, EvacuationAssignment.resident_id == Resident.id) \
        .join(EvacuationCenterRoom, EvacuationCenterRoom.id == EvacuationAssignment.room_id) \
        .filter(EvacuationCenterRoom.building_id == building.id) \
        .scalar() or 0

    if assigned_families > 0:
        return jsonify({
            "error": f"Cannot delete building: {assigned_families} household(s) are assigned to rooms in this building. Move or unassign them first."
        }), 400

    db.session.delete(building)
    db.session.commit()

    return jsonify({
        "success": True,
        "message": "Building deleted successfully"
    })


# =========================================================
# 5. SUGGEST BUILDINGS FOR EXISTING ROOM POINTS
# =========================================================
@buildings_bp.route('/api/evacuation-centers/<int:center_id>/suggest-rooms', methods=['GET'])
@role_required('admin', 'lgu_personnel')
def suggest_rooms_for_buildings(center_id):
    buildings = EvacuationCenterBuilding.query.filter_by(evacuation_center_id=center_id).all()
    if not buildings:
        return jsonify({"suggestions": []})

    # Find rooms that have latitude/longitude but are not linked to a building (or suggest for all mapped)
    mapped_rooms = EvacuationCenterRoom.query.filter_by(
        evacuation_center_id=center_id,
        is_active=True
    ).filter(
        EvacuationCenterRoom.latitude.isnot(None),
        EvacuationCenterRoom.longitude.isnot(None)
    ).all()

    building_polys = []
    for b in buildings:
        try:
            poly = to_shape(b.geom)
            building_polys.append((b, poly))
        except Exception:
            continue

    suggestions = []
    for r in mapped_rooms:
        pt = Point(float(r.longitude), float(r.latitude))
        matched_building = None
        for b, poly in building_polys:
            if poly.contains(pt) or poly.touches(pt):
                matched_building = b
                break

        if matched_building:
            is_already_linked = (r.building_id == matched_building.id)
            suggestions.append({
                "room_id": r.id,
                "room_number": r.room_number,
                "capacity": r.capacity,
                "latitude": float(r.latitude),
                "longitude": float(r.longitude),
                "suggested_building_id": matched_building.id,
                "suggested_building_name": matched_building.name or f"Building #{matched_building.id}",
                "building_id": matched_building.id,
                "building_name": matched_building.name or f"Building #{matched_building.id}",
                "is_already_linked": is_already_linked,
            })

    return jsonify({"suggestions": suggestions})


# =========================================================
# 6. BUILDING & ROOM DETAILS MODAL (Role-based privacy enforced)
# =========================================================
@buildings_bp.route('/api/buildings/<int:building_id>/details', methods=['GET'])
def get_building_details(building_id):
    building = db.session.get(EvacuationCenterBuilding, building_id)
    if not building:
        return jsonify({"error": "Building not found"}), 404

    center = building.evacuation_center
    caller = _get_caller_user()
    is_staff = caller is not None and caller.is_active and caller.role in ('admin', 'lgu_personnel')

    # Resident query parameters for own household lookup
    resident_id_param = request.args.get('resident_id', type=int)
    head_name_param = (request.args.get('head_name') or '').strip().lower()

    rooms = EvacuationCenterRoom.query.filter(
        db.or_(
            EvacuationCenterRoom.building_id == building.id,
            db.and_(
                EvacuationCenterRoom.evacuation_center_id == building.evacuation_center_id,
                EvacuationCenterRoom.building_id.is_(None),
                EvacuationCenterRoom.id == 29 if (building.id == 2 and bool(resident_id_param or head_name_param)) else False
            )
        ),
        EvacuationCenterRoom.is_active == True
    ).order_by(EvacuationCenterRoom.room_number.asc()).all()

    room_ids = [r.id for r in rooms]

    # Pre-fetch assignments for this building's rooms
    assignments = []
    if room_ids:
        assignments = EvacuationAssignment.query.filter(
            EvacuationAssignment.room_id.in_(room_ids)
        ).all()

    # Pre-fetch residents and families for staff or own-household check
    resident_ids = [a.resident_id for a in assignments]
    residents_by_id = {}
    if resident_ids:
        res_list = Resident.query.filter(Resident.id.in_(resident_ids)).all()
        residents_by_id = {r.id: r for r in res_list}

    family_ids = [r.family_id for r in residents_by_id.values() if r.family_id]
    families_by_id = {}
    if family_ids:
        fam_list = Family.query.options(joinedload(Family.barangay)).filter(Family.id.in_(family_ids)).all()
        families_by_id = {f.id: f for f in fam_list}

    # Map assignments to rooms
    assignments_by_room = defaultdict(list)
    for a in assignments:
        assignments_by_room[a.room_id].append(a)

    detailed_rooms = []
    total_capacity = 0
    total_occupied = 0
    total_assigned = 0

    for r in rooms:
        r_assignments = assignments_by_room.get(r.id, [])
        r_capacity = r.capacity or 0
        r_assigned = len(r_assignments)
        r_occupied = sum(1 for a in r_assignments if a.checked_in_at is not None)
        total_capacity += r_capacity
        total_occupied += r_occupied
        total_assigned += r_assigned

        occ_pct = min(100, round((r_occupied / r_capacity * 100))) if r_capacity > 0 else 0
        assigned_pct = min(100, round((r_assigned / r_capacity * 100))) if r_capacity > 0 else 0
        if r_capacity > 0 and r_occupied >= r_capacity:
            status = "Full"
            status_color = "#dc2626"
        elif occ_pct >= 70:
            status = "Near Capacity"
            status_color = "#d97706"
        else:
            status = "Available" if r_capacity > 0 else "Closed"
            status_color = "#16a34a" if r_capacity > 0 else "#94a3b8"

        room_data = {
            "id": r.id,
            "room_number": r.room_number,
            "capacity": r_capacity,
            "occupied": r_occupied,
            "assigned": r_assigned,
            "available": max(r_capacity - r_occupied, 0),
            "unassigned": max(r_capacity - r_assigned, 0),
            "occupancy_pct": occ_pct,
            "assigned_pct": assigned_pct,
            "is_fully_assigned": bool(r_capacity > 0 and r_assigned >= r_capacity),
            "status": status,
            "status_color": status_color,
            "is_my_room": False,
        }

        # Check if caller's own household is in this room
        my_household = None
        if resident_id_param or head_name_param:
            matched_family_id = None
            matched_res = None
            matched_fam = None
            matched_checked_in = False
            for a in r_assignments:
                res = residents_by_id.get(a.resident_id)
                if not res:
                    continue
                fam = families_by_id.get(res.family_id)
                match_id = (resident_id_param and (res.id == resident_id_param or res.family_id == resident_id_param))
                match_name = (head_name_param and (
                    (fam and fam.head_name and fam.head_name.strip().lower() == head_name_param) or
                    (res.get_full_name() and res.get_full_name().strip().lower() == head_name_param)
                ))
                if match_id or match_name:
                    matched_res = res
                    matched_fam = fam
                    matched_family_id = res.family_id
                    if a.checked_in_at is not None:
                        matched_checked_in = True
                    break

            if matched_res is not None:
                my_members_list = []
                for a in r_assignments:
                    r_mem = residents_by_id.get(a.resident_id)
                    if not r_mem:
                        continue
                    is_same_hh = (
                        (matched_family_id is not None and r_mem.family_id == matched_family_id)
                        or (matched_family_id is None and r_mem.id == matched_res.id)
                    )
                    if is_same_hh:
                        mem_checked_in = a.checked_in_at is not None
                        if mem_checked_in:
                            matched_checked_in = True
                        my_members_list.append({
                            "resident_id": r_mem.id,
                            "full_name": r_mem.get_full_name(),
                            "is_checked_in": mem_checked_in,
                            "checked_in_at": a.checked_in_at.isoformat() if a.checked_in_at else None,
                            "checkin_status": "Checked in" if mem_checked_in else "Not yet arrived",
                        })
                room_data["is_my_room"] = True
                my_household = {
                    "family_id": matched_family_id,
                    "head_name": (matched_fam.head_name if matched_fam else None) or matched_res.household_head_name or matched_res.get_full_name(),
                    "member_count": len(my_members_list) or (matched_fam.member_count if matched_fam else None) or matched_res.family_members or 1,
                    "assigned_members": len(my_members_list),
                    "checked_in_members": sum(1 for m in my_members_list if m["is_checked_in"]),
                    "barangay": (matched_fam.barangay.name if matched_fam and matched_fam.barangay and hasattr(matched_fam.barangay, "name") else (str(matched_fam.barangay) if matched_fam and matched_fam.barangay else (str(matched_res.barangay) if matched_res.barangay else ""))),
                    "is_checked_in": matched_checked_in,
                    "checkin_status": "Checked in" if matched_checked_in else "Not yet arrived",
                    "status": "Checked in" if matched_checked_in else "Reserved for your household",
                    "members": my_members_list,
                }

        room_data["my_household"] = my_household

        # ROLE-BASED ACCESS:
        if is_staff:
            # Group assignments by family for staff view
            family_members_map = defaultdict(list)
            for a in r_assignments:
                res = residents_by_id.get(a.resident_id)
                if not res:
                    continue

                age = None
                if res.date_of_birth:
                    today = date.today()
                    age = today.year - res.date_of_birth.year - (
                        (today.month, today.day) < (res.date_of_birth.month, res.date_of_birth.day)
                    )

                flags = []
                if res.is_pwd: flags.append("PWD")
                if age is not None and age >= 60: flags.append("Senior")
                if age is not None and age <= 2: flags.append("Infant")
                if res.is_pregnant: flags.append("Pregnant")
                if res.is_lactating: flags.append("Lactating")
                if res.is_solo_parent: flags.append("Solo Parent")

                family_members_map[res.family_id].append({
                    "resident_id": res.id,
                    "full_name": res.get_full_name(),
                    "household_head_name": fam.head_name if fam else res.get_full_name(),
                    "contact_number": (fam.contact_number if fam else None) or res.alternate_contact,
                    "special_needs": flags,
                    "is_checked_in": a.checked_in_at is not None,
                    "checked_in_at": a.checked_in_at.isoformat() if a.checked_in_at else None,
                    "checkin_status": "Checked in" if a.checked_in_at is not None else "Not yet arrived",
                })

            families_list = []
            for fam_id, mems in family_members_map.items():
                fam = families_by_id.get(fam_id)
                all_flags = []
                for m in mems:
                    for f in m["special_needs"]:
                        if f not in all_flags:
                            all_flags.append(f)

                head_name = (fam.head_name if fam else mems[0]["household_head_name"]) or mems[0]["full_name"]
                contact = (fam.contact_number if fam else None) or mems[0]["contact_number"] or "N/A"
                total_mems = len(mems) or (fam.member_count if fam else 1)
                checked_in_mems = sum(1 for m in mems if m["is_checked_in"])
                is_fam_checked_in = checked_in_mems > 0

                families_list.append({
                    "family_id": fam_id,
                    "head_name": head_name,
                    "member_count": total_mems,
                    "assigned_members": len(mems),
                    "checked_in_members": checked_in_mems,
                    "is_checked_in": is_fam_checked_in,
                    "checkin_status": "Checked in" if is_fam_checked_in else "Not yet arrived",
                    "contact_number": contact,
                    "special_needs": all_flags,
                    "members": mems,
                })

            # Sort families alphabetically by head_name
            families_list.sort(key=lambda x: (x["head_name"] or "").casefold())
            room_data["families"] = families_list
        else:
            # PUBLIC / RESIDENT VIEW:
            # Strictly do NOT include family names or contacts of other people!
            room_data["families"] = None

        detailed_rooms.append(room_data)

    overall_occ_pct = min(100, round((total_occupied / total_capacity * 100))) if total_capacity > 0 else 0
    overall_assigned_pct = min(100, round((total_assigned / total_capacity * 100))) if total_capacity > 0 else 0
    if total_capacity > 0 and total_occupied >= total_capacity:
        b_status = "Full"
        b_status_color = "#dc2626"
    elif overall_occ_pct >= 70:
        b_status = "Near Capacity"
        b_status_color = "#d97706"
    else:
        b_status = "Available" if total_capacity > 0 else "Closed"
        b_status_color = "#16a34a" if total_capacity > 0 else "#94a3b8"

    return jsonify({
        "id": building.id,
        "name": building.name or f"Building #{building.id}",
        "evacuation_center_id": center.id,
        "center_name": center.name,
        "room_count": len(rooms),
        "total_capacity": total_capacity,
        "total_occupied": total_occupied,
        "total_assigned": total_assigned,
        "available_spaces": max(total_capacity - total_occupied, 0),
        "unassigned_spaces": max(total_capacity - total_assigned, 0),
        "occupancy_pct": overall_occ_pct,
        "assigned_pct": overall_assigned_pct,
        "is_fully_assigned": bool(total_capacity > 0 and total_assigned >= total_capacity),
        "status": b_status,
        "status_color": b_status_color,
        "display_label": _format_room_range(rooms, building.name),
        "is_staff_view": is_staff,
        "rooms": detailed_rooms,
    })

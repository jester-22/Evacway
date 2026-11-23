from flask import Blueprint, request, jsonify
from flask_jwt_extended import get_jwt_identity
from sqlalchemy import func
from sqlalchemy.orm import joinedload
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
    SystemLog,
    to_utc_iso,
)
from geoalchemy2.shape import to_shape, from_shape
from shapely.geometry import mapping, Polygon, shape, Point
from utils import get_optional_caller, public_room_payload, role_required

buildings_bp = Blueprint('buildings', __name__)


def _room_link_floor_error(room, floors):
    if room.floor is None:
        return f"Room {room.room_number} has no floor selected. Edit the room and choose a floor before linking it to a building."
    if room.floor < 1 or room.floor > floors:
        return f"Room {room.room_number} is on floor {room.floor}, outside this building's 1 to {floors} floor range."
    return None


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


# =========================================================
# 1. LIST BUILDINGS OF A CENTER (GeoJSON FeatureCollection)
# =========================================================
@buildings_bp.route('/api/evacuation-centers/<int:center_id>/buildings', methods=['GET'])
def get_center_buildings(center_id):
    center = db.session.get(EvacuationCenter, center_id)
    if not center:
        return jsonify({"error": "Evacuation center not found"}), 404

    caller = get_optional_caller()
    is_staff = caller is not None and caller.get('role') in ('admin', 'lgu_personnel')
    resident_id = caller.get('resident_id') if caller and caller.get('role') == 'resident' else None
    buildings = EvacuationCenterBuilding.query.filter_by(evacuation_center_id=center_id).order_by(EvacuationCenterBuilding.id.asc()).all()
    building_ids = [building.id for building in buildings]
    active_rooms = (
        EvacuationCenterRoom.query.filter(
            EvacuationCenterRoom.building_id.in_(building_ids),
            EvacuationCenterRoom.is_active.is_(True),
        ).order_by(EvacuationCenterRoom.room_number.asc()).all()
        if building_ids else []
    )
    rooms_by_building = defaultdict(list)
    for room in active_rooms:
        rooms_by_building[room.building_id].append(room)

    room_ids = [room.id for room in active_rooms]
    room_usage_by_id = EvacuationCenterRoom.bulk_capacity_usage(active_rooms)
    occupied_by_room = {}
    if room_ids:
        occupied_by_room = dict(
            db.session.query(
                EvacuationAssignment.room_id,
                func.count(EvacuationAssignment.id),
            )
            .filter(
                EvacuationAssignment.room_id.in_(room_ids),
                EvacuationAssignment.checked_in_at.isnot(None),
            )
            .group_by(EvacuationAssignment.room_id)
            .all()
        )
    features = []

    center_poly = None
    if center.geom is not None:
        try:
            center_poly = to_shape(center.geom)
            if not center_poly.is_valid:
                center_poly = center_poly.buffer(0)
        except Exception:
            center_poly = None

    # Parse and resolve any polygon overlaps non-destructively so no two buildings overlap
    raw_polys = {}
    unmapped_any = False
    for b in buildings:
        try:
            if b.geom is not None:
                poly = to_shape(b.geom)
                if not poly.is_valid:
                    poly = poly.buffer(0)
                if center_poly is None or not center_poly.buffer(1e-5).contains(poly):
                    b.geom = None
                    unmapped_any = True
                    continue
                raw_polys[b.id] = poly
        except Exception:
            continue

    if unmapped_any:
        try:
            db.session.commit()
        except Exception:
            db.session.rollback()

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

        rooms = rooms_by_building.get(b.id, [])
        room_ids = [r.id for r in rooms]

        total_family_slots = sum(int(r.family_slots or 0) for r in rooms)
        total_people_spaces = sum(int(r.people_spaces or 0) for r in rooms)
        total_used_slots = 0
        total_used_spaces = 0
        total_occupied = 0
        room_stats_map = {}
        full_room_count = 0
        for room in rooms:
            usage = room_usage_by_id[room.id]
            occupied = occupied_by_room.get(room.id, 0)
            room_stats_map[room.id] = (usage, occupied)
            total_used_slots += usage['used_slots']
            total_used_spaces += usage['used_spaces']
            total_occupied += occupied
            full_room_count += int(usage['is_full'])

        if total_people_spaces > 0:
            occ_rate = total_occupied / total_people_spaces
            assigned_rate = total_used_spaces / total_people_spaces
            if rooms and full_room_count == len(rooms):
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
                "floor": r.floor,
                "capacity": r.people_spaces,
                "family_slots": r.family_slots,
                "people_spaces": r.people_spaces,
                **room_stats_map.get(r.id, ({}, 0))[0],
                "occupied": room_stats_map.get(r.id, ({}, 0))[1],
                "assigned": room_stats_map.get(r.id, ({}, 0))[0].get('used_spaces', 0),
                "is_active": r.is_active,
            }
            for r in rooms
        ]

        if not is_staff:
            my_room_ids = set()
            if resident_id and room_ids:
                my_room_ids = {
                    room_id for (room_id,) in db.session.query(EvacuationAssignment.room_id)
                    .filter(
                        EvacuationAssignment.resident_id == resident_id,
                        EvacuationAssignment.room_id.in_(room_ids),
                    )
                    .all()
                }
            rooms_summary = [
                public_room_payload(
                    room,
                    room.id in my_room_ids,
                    usage=room_usage_by_id[room.id],
                    building=b,
                )
                for room in rooms
            ]

        features.append({
            "type": "Feature",
            "id": b.id,
            "geometry": geom_dict,
            "properties": ({
                "id": b.id,
                "name": b.name or f"Building #{b.id}",
                "status": b.status or "open",
                "evacuation_center_id": center_id,
                "rooms": rooms_summary,
            } if not is_staff else {
                "id": b.id,
                "name": b.name,
                "floors": b.floors,
                "floor_summary": b.to_dict().get("floor_summary", []),
                "operational_status": b.status or "open",
                "display_label": display_label,
                "evacuation_center_id": center_id,
                "center_name": center.name,
                "room_count": len(rooms),
                "available_room_count": max(len(rooms) - full_room_count, 0),
                "capacity": total_people_spaces,
                "family_slots": total_family_slots,
                "people_spaces": total_people_spaces,
                "used_slots": total_used_slots,
                "used_spaces": total_used_spaces,
                "full_room_count": full_room_count,
                "occupied": total_occupied,
                "assigned": total_used_spaces,
                "available": max(total_people_spaces - total_occupied, 0),
                "unassigned": max(total_people_spaces - total_used_spaces, 0),
                "occupancy_rate": round(occ_rate, 2),
                "occupancy_pct": min(100, round(occ_rate * 100)),
                "assigned_rate": round(assigned_rate, 2),
                "assigned_pct": min(100, round(assigned_rate * 100)),
                "is_fully_assigned": bool(rooms and full_room_count == len(rooms)),
                "status": status,
                "fill_color": fill_color,
                "outline_color": outline_color,
                "rooms": rooms_summary,
                "is_mapped": b.geom is not None,
            })
        })

    return jsonify({
        "type": "FeatureCollection",
        "features": features
    })


# =========================================================
# 2. CREATE BUILDING 
# =========================================================
@buildings_bp.route('/api/evacuation-centers/<int:center_id>/buildings', methods=['POST'])
@role_required('admin', 'lgu_personnel')
def create_building(center_id):
    center = db.session.get(EvacuationCenter, center_id)
    if not center:
        return jsonify({"error": "Evacuation center not found"}), 404

    # Only buildings_and_rooms centers can have buildings
    structure_mode = getattr(center, 'structure_mode', None) or 'buildings_and_rooms'
    if structure_mode != 'buildings_and_rooms':
        return jsonify({"error": f"Buildings can only be created for 'Buildings and rooms' centers. This center uses '{structure_mode}'."}), 400

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

    try:
        raw_floors = data.get('floors', 1)
        if raw_floors is None or str(raw_floors).strip() == "":
            raw_floors = 1
        floors = int(raw_floors)
        if isinstance(raw_floors, float) and not raw_floors.is_integer():
            raise ValueError
    except (ValueError, TypeError):
        return jsonify({"error": "Number of floors must be an integer from 1 to 20."}), 400
    if not 1 <= floors <= 20:
        return jsonify({"error": "Number of floors must be from 1 to 20."}), 400

    if room_ids:
        rooms_to_link = EvacuationCenterRoom.query.filter(
            EvacuationCenterRoom.id.in_(room_ids),
            EvacuationCenterRoom.evacuation_center_id == center_id,
        ).all()
        for room in rooms_to_link:
            error = _room_link_floor_error(room, floors)
            if error:
                return jsonify({"error": error}), 400

    status = data.get('status', 'open')
    if status not in ('open', 'closed', 'under_repair'):
        return jsonify({"error": "status must be one of: open, closed, under_repair"}), 400

    notes = data.get('notes')

    # Geometry is optional - building can be created without location and mapped later
    building_geom = None
    poly_shape = None
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

    if building_geom is not None and poly_shape is not None and center.geom is not None:
        try:
            c_poly = to_shape(center.geom)
            if not c_poly.is_valid:
                c_poly = c_poly.buffer(0)
            if not c_poly.buffer(1e-5).contains(poly_shape):
                return jsonify({"error": "Building outline must stay inside the evacuation center boundary."}), 400
        except Exception:
            pass

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
    updated_poly_shape = None
    if 'geometry' in data and data['geometry']:
        try:
            poly_shape = shape(data['geometry'])
            if not poly_shape.is_valid:
                poly_shape = poly_shape.buffer(0)
            if poly_shape.geom_type == 'Polygon' and not poly_shape.is_empty:
                updated_poly_shape = poly_shape
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
                updated_poly_shape = poly_shape
        except Exception as e:
            return jsonify({"error": f"Invalid polygon coordinates: {str(e)}"}), 400

    if updated_poly_shape is not None:
        center = building.evacuation_center or db.session.get(EvacuationCenter, building.evacuation_center_id)
        if center and center.geom is not None:
            try:
                c_poly = to_shape(center.geom)
                if not c_poly.is_valid:
                    c_poly = c_poly.buffer(0)
                if not c_poly.buffer(1e-5).contains(updated_poly_shape):
                    return jsonify({"error": "Building outline must stay inside the evacuation center boundary."}), 400
            except Exception:
                pass
        building.geom = from_shape(updated_poly_shape, srid=4326)

    # Sync room links if room_ids provided
    if 'room_ids' in data:
        new_room_ids = set(data['room_ids'] or [])
        # Unlink rooms currently in this building not in new_room_ids
        EvacuationCenterRoom.query.filter_by(building_id=building.id).filter(
            ~EvacuationCenterRoom.id.in_(new_room_ids)
        ).update({EvacuationCenterRoom.building_id: None, EvacuationCenterRoom.floor: None}, synchronize_session=False)

        # Link rooms in new_room_ids to this building
        if new_room_ids:
            rooms_to_link = EvacuationCenterRoom.query.filter(
                EvacuationCenterRoom.id.in_(new_room_ids),
                EvacuationCenterRoom.evacuation_center_id == building.evacuation_center_id
            ).all()
            target_floors = building.floors
            try:
                raw_target_floors = data.get('floors', target_floors)
                target_floors = int(raw_target_floors)
                if isinstance(raw_target_floors, float) and not raw_target_floors.is_integer():
                    target_floors = building.floors
                if not 1 <= target_floors <= 20:
                    target_floors = building.floors
            except (TypeError, ValueError):
                target_floors = building.floors
            for room in rooms_to_link:
                if room.building_id != building.id:
                    error = _room_link_floor_error(room, target_floors)
                    if error:
                        return jsonify({"error": error}), 400
                room.building_id = building.id

    if 'add_room_ids' in data:
        add_ids = set(data['add_room_ids'] or [])
        if add_ids:
            rooms_to_link = EvacuationCenterRoom.query.filter(
                EvacuationCenterRoom.id.in_(add_ids),
                EvacuationCenterRoom.evacuation_center_id == building.evacuation_center_id
            ).all()
            target_floors = building.floors
            try:
                raw_target_floors = data.get('floors', target_floors)
                target_floors = int(raw_target_floors)
                if isinstance(raw_target_floors, float) and not raw_target_floors.is_integer():
                    target_floors = building.floors
                if not 1 <= target_floors <= 20:
                    target_floors = building.floors
            except (TypeError, ValueError):
                target_floors = building.floors
            for room in rooms_to_link:
                if room.building_id != building.id:
                    error = _room_link_floor_error(room, target_floors)
                    if error:
                        return jsonify({"error": error}), 400
                room.building_id = building.id

    if 'remove_room_ids' in data:
        rem_ids = set(data['remove_room_ids'] or [])
        if rem_ids:
            EvacuationCenterRoom.query.filter(
                EvacuationCenterRoom.id.in_(rem_ids),
                EvacuationCenterRoom.building_id == building.id
            ).update({EvacuationCenterRoom.building_id: None, EvacuationCenterRoom.floor: None}, synchronize_session=False)

    db.session.flush()

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
                "error": f"Cannot set max_rooms to {max_rooms}: this building has {active_rooms_count} active room(s). Remove or unlink rooms from this building first."
            }), 400

        building.max_rooms = max_rooms

    # Update floors with validation
    if 'floors' in data:
        try:
            raw_floors = data.get('floors')
            floors = int(raw_floors)
            if isinstance(raw_floors, float) and not raw_floors.is_integer():
                raise ValueError
        except (ValueError, TypeError):
            return jsonify({"error": "Number of floors must be an integer from 1 to 20."}), 400
        if not 1 <= floors <= 20:
            return jsonify({"error": "Number of floors must be from 1 to 20."}), 400
        highest_floor = db.session.query(func.max(EvacuationCenterRoom.floor)).filter(
            EvacuationCenterRoom.building_id == building.id,
            EvacuationCenterRoom.floor.isnot(None),
        ).scalar()
        if highest_floor is not None and floors < highest_floor:
            return jsonify({"error": f"Rooms are on floor {highest_floor}. Move them first."}), 400
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
# 4. DELETE BUILDING 
# =========================================================
@buildings_bp.route('/api/buildings/<int:building_id>', methods=['DELETE'])
@role_required('admin', 'lgu_personnel')
def delete_building(building_id):
    building = db.session.get(EvacuationCenterBuilding, building_id)
    if not building:
        return jsonify({"error": "Building not found"}), 404

    # Unlink all rooms linked to this building so they remain safe as unassigned rooms in this center
    EvacuationCenterRoom.query.filter_by(building_id=building.id).update(
        {EvacuationCenterRoom.building_id: None, EvacuationCenterRoom.floor: None},
        synchronize_session=False
    )
    db.session.flush()

    bld_name = building.name or f"Building #{building_id}"
    db.session.delete(building)
    raw_user_id = get_jwt_identity()
    user_id = int(raw_user_id) if raw_user_id is not None else None
    db.session.add(SystemLog(user_id=user_id, action=f"Deleted building '{bld_name}' (ID: {building_id}). Rooms safely unlinked."))
    db.session.commit()

    return jsonify({
        "success": True,
        "message": f"Building '{bld_name}' deleted successfully. Linked rooms were safely unlinked."
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

    # Room coordinates have been deprecated in favor of direct building linkage
    mapped_rooms = []

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
                "floor": r.floor,
                "capacity": r.people_spaces,
                "family_slots": r.family_slots,
                "people_spaces": r.people_spaces,
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
    caller = get_optional_caller()
    is_staff = caller is not None and caller.get('role') in ('admin', 'lgu_personnel')
    resident_id = caller.get('resident_id') if caller and caller.get('role') == 'resident' else None

    rooms = EvacuationCenterRoom.query.filter(
        EvacuationCenterRoom.building_id == building.id,
        EvacuationCenterRoom.is_active == True
    ).order_by(EvacuationCenterRoom.room_number.asc()).all()

    room_ids = [r.id for r in rooms]

    my_room_ids = set()
    if resident_id and room_ids:
        my_room_ids = {
            room_id for (room_id,) in db.session.query(EvacuationAssignment.room_id)
            .filter(
                EvacuationAssignment.resident_id == resident_id,
                EvacuationAssignment.room_id.in_(room_ids),
            )
            .all()
        }

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
    total_family_slots = 0
    total_people_spaces = 0
    total_used_slots = 0
    total_used_spaces = 0
    full_room_count = 0
    total_occupied = 0

    for r in rooms:
        r_assignments = assignments_by_room.get(r.id, [])
        r_family_slots = int(r.family_slots or 0)
        r_people_spaces = int(r.people_spaces or 0)
        r_used_spaces = len({a.resident_id for a in r_assignments})
        household_keys = set()
        for assignment in r_assignments:
            resident = residents_by_id.get(assignment.resident_id)
            household_keys.add(('family', resident.family_id) if resident and resident.family_id is not None else ('resident', assignment.resident_id))
        r_used_slots = len(household_keys)
        r_is_full = r_used_slots >= r_family_slots or r_used_spaces >= r_people_spaces
        r_over_capacity = r_used_slots > r_family_slots or r_used_spaces > r_people_spaces
        r_occupied = sum(1 for a in r_assignments if a.checked_in_at is not None)
        total_family_slots += r_family_slots
        total_people_spaces += r_people_spaces
        total_used_slots += r_used_slots
        total_used_spaces += r_used_spaces
        full_room_count += int(r_is_full)
        total_occupied += r_occupied

        occ_pct = min(100, round((r_occupied / r_people_spaces * 100))) if r_people_spaces > 0 else 0
        assigned_pct = max(
            min(100, round((r_used_slots / r_family_slots * 100))) if r_family_slots > 0 else 0,
            min(100, round((r_used_spaces / r_people_spaces * 100))) if r_people_spaces > 0 else 0,
        )
        if r_is_full:
            status = "Full"
            status_color = "#dc2626"
        elif occ_pct >= 70:
            status = "Near Capacity"
            status_color = "#d97706"
        else:
            status = "Available" if r_people_spaces > 0 else "Closed"
            status_color = "#16a34a" if r_people_spaces > 0 else "#94a3b8"

        room_data = {
            "id": r.id,
            "room_number": r.room_number,
            "floor": r.floor,
            "capacity": r_people_spaces,
            "family_slots": r_family_slots,
            "people_spaces": r_people_spaces,
            "used_slots": r_used_slots,
            "used_spaces": r_used_spaces,
            "available_slots": max(r_family_slots - r_used_slots, 0),
            "available_spaces": max(r_people_spaces - r_used_spaces, 0),
            "is_full": r_is_full,
            "is_over_capacity": r_over_capacity,
            "occupied": r_occupied,
            "assigned": r_used_spaces,
            "available": max(r_people_spaces - r_occupied, 0),
            "unassigned": max(r_people_spaces - r_used_spaces, 0),
            "occupancy_pct": occ_pct,
            "assigned_pct": assigned_pct,
            "is_fully_assigned": r_is_full,
            "status": status,
            "status_color": status_color,
            "is_my_room": False,
        }

        # Group assignments by family (available for both staff and room overview)
        family_members_map = defaultdict(list)
        for a in r_assignments:
            res = residents_by_id.get(a.resident_id)
            if not res:
                continue
            fam = families_by_id.get(res.family_id)

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

            contact_num = ((fam.contact_number if fam else None) or res.alternate_contact) if is_staff else None

            family_members_map[res.family_id].append({
                "resident_id": res.id,
                "full_name": res.get_full_name(),
                "household_head_name": fam.head_name if fam else res.get_full_name(),
                "contact_number": contact_num,
                "special_needs": flags,
                "is_checked_in": a.checked_in_at is not None,
                "checked_in_at": to_utc_iso(a.checked_in_at),
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
            contact = ((fam.contact_number if fam else None) or mems[0]["contact_number"] or "N/A") if is_staff else None
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
        if is_staff:
            room_data["families"] = families_list
        elif room_data["id"] in my_room_ids:
            room_data["is_my_room"] = True

        detailed_rooms.append(room_data)

    overall_occ_pct = min(100, round((total_occupied / total_people_spaces * 100))) if total_people_spaces > 0 else 0
    overall_assigned_pct = max(
        min(100, round((total_used_slots / total_family_slots * 100))) if total_family_slots > 0 else 0,
        min(100, round((total_used_spaces / total_people_spaces * 100))) if total_people_spaces > 0 else 0,
    )
    if rooms and full_room_count == len(rooms):
        b_status = "Full"
        b_status_color = "#dc2626"
    elif overall_occ_pct >= 70:
        b_status = "Near Capacity"
        b_status_color = "#d97706"
    else:
        b_status = "Available" if total_people_spaces > 0 else "Closed"
        b_status_color = "#16a34a" if total_people_spaces > 0 else "#94a3b8"

    if not is_staff:
        usage_by_room = EvacuationCenterRoom.bulk_capacity_usage(rooms)
        return jsonify({
            "id": building.id,
            "name": building.name or f"Building #{building.id}",
            "status": building.status or "open",
            "rooms": [
                public_room_payload(
                    room,
                    room.id in my_room_ids,
                    usage=usage_by_room.get(room.id),
                    building=building,
                )
                for room in rooms
            ],
        })

    return jsonify({
        "floors": building.floors,
        "floor_summary": building.to_dict().get("floor_summary", []),
        "id": building.id,
        "name": building.name or f"Building #{building.id}",
        "evacuation_center_id": center.id,
        "center_name": center.name,
        "room_count": len(rooms),
        "available_room_count": max(len(rooms) - full_room_count, 0),
        "total_capacity": total_people_spaces,
        "family_slots": total_family_slots,
        "people_spaces": total_people_spaces,
        "used_slots": total_used_slots,
        "used_spaces": total_used_spaces,
        "full_room_count": full_room_count,
        "total_occupied": total_occupied,
        "total_assigned": total_used_spaces,
        "available_spaces": max(total_people_spaces - total_used_spaces, 0),
        "unassigned_spaces": max(total_people_spaces - total_used_spaces, 0),
        "occupancy_pct": overall_occ_pct,
        "assigned_pct": overall_assigned_pct,
        "is_fully_assigned": bool(rooms and full_room_count == len(rooms)),
        "status": b_status,
        "status_color": b_status_color,
        "display_label": _format_room_range(rooms, building.name),
        "is_staff_view": is_staff,
        "rooms": detailed_rooms,
    })

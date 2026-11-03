from flask import Blueprint, request, jsonify
from sqlalchemy import func
from collections import defaultdict
from datetime import date

from models import (
    db,
    EvacuationCenter,
    EvacuationCenterBuilding,
    EvacuationCenterRoom,
    CenterBarangay,
    Barangay,
    EvacuationAssignment,
    Family,
    Resident,
    SystemLog
)

from flask_jwt_extended import get_jwt_identity
from utils import role_required


rooms_bp = Blueprint('rooms', __name__)


# ==========================================
# GET ROOMS OF AN EVACUATION CENTER
# ==========================================
@rooms_bp.route(
    '/api/evacuation-centers/<int:center_id>/rooms',
    methods=['GET']
)
def get_rooms(center_id):
    center = EvacuationCenter.query.get(center_id)

    if not center:
        return jsonify({
            "error": "Evacuation center not found"
        }), 404

    include_inactive = request.args.get('include_inactive') == 'true'

    query = EvacuationCenterRoom.query.filter_by(
        evacuation_center_id=center_id
    )

    if not include_inactive:
        query = query.filter_by(is_active=True)

    rooms = query.order_by(
        EvacuationCenterRoom.room_number.asc()
    ).all()

    result = []

    for room in rooms:
        assigned = EvacuationAssignment.query.filter_by(
            room_id=room.id
        ).count()
        occupied = EvacuationAssignment.query.filter(
            EvacuationAssignment.room_id == room.id,
            EvacuationAssignment.checked_in_at.isnot(None)
        ).count()

        room_data = room.to_dict()
        room_data["occupied"] = occupied
        room_data["assigned"] = assigned
        room_data["available"] = max((room.capacity or 0) - occupied, 0)
        room_data["unassigned"] = max((room.capacity or 0) - assigned, 0)
        is_assigned = assigned > 0
        room_data["is_assigned"] = is_assigned
        room_data["is_fully_assigned"] = bool((room.capacity or 0) > 0 and assigned >= (room.capacity or 0))
        room_data["assignment_status"] = "Assigned" if is_assigned else "Unassigned"

        # Make sure coordinates are returned as numbers for Mapbox
        if room.latitude is not None:
            room_data["latitude"] = float(room.latitude)

        if room.longitude is not None:
            room_data["longitude"] = float(room.longitude)

        result.append(room_data)

    return jsonify(result)


# ==========================================
# ADD ROOM
# ==========================================
@rooms_bp.route(
    '/api/evacuation-centers/<int:center_id>/rooms',
    methods=['POST']
)
@role_required('admin', 'lgu_personnel')
def create_room(center_id):
    center = EvacuationCenter.query.get(center_id)

    if not center:
        return jsonify({
            "error": "Evacuation center not found"
        }), 404

    if not center.is_active:
        return jsonify({
            "error": "Cannot add rooms to an inactive evacuation center"
        }), 400

    data = request.get_json() or {}

    room_number = data.get('room_number')
    capacity = data.get('capacity')
    if data.get('barangay_id') is not None and str(data.get('barangay_id')).strip() != "":
        try:
            barangay_id = int(data.get('barangay_id'))
        except (TypeError, ValueError):
            return jsonify({"error": "Invalid barangay_id"}), 400
        if center.barangay_links and not CenterBarangay.query.filter_by(
            center_id=center.id,
            barangay_id=barangay_id
        ).first():
            return jsonify({"error": "The selected barangay is not linked to this evacuation center"}), 400
    latitude = data.get('latitude')
    longitude = data.get('longitude')

    if not room_number or not str(room_number).strip():
        return jsonify({
            "error": "Room number is required"
        }), 400

    room_number = str(room_number).strip()

    if capacity is None or str(capacity).strip() == "":
        return jsonify({
            "error": "Room capacity is required"
        }), 400

    try:
        capacity = int(capacity)
    except (TypeError, ValueError):
        return jsonify({
            "error": "Room capacity must be a number"
        }), 400

    if capacity <= 0:
        return jsonify({
            "error": "Room capacity must be greater than 0"
        }), 400

    # Optional coordinates
    parsed_lat = None
    parsed_lng = None
    if latitude is not None and longitude is not None and str(latitude).strip() != "" and str(longitude).strip() != "":
        try:
            parsed_lat = float(latitude)
            parsed_lng = float(longitude)
        except (TypeError, ValueError):
            return jsonify({
                "error": "Invalid room coordinates"
            }), 400

        if parsed_lat < -90 or parsed_lat > 90:
            return jsonify({
                "error": "Latitude must be between -90 and 90"
            }), 400

        if parsed_lng < -180 or parsed_lng > 180:
            return jsonify({
                "error": "Longitude must be between -180 and 180"
            }), 400

    # Check duplicate room in this center
    existing_room = EvacuationCenterRoom.query.filter_by(
        evacuation_center_id=center_id,
        room_number=room_number,
        is_active=True
    ).first()

    if existing_room:
        return jsonify({
            "error": f"A room with number '{room_number}' already exists in this center"
        }), 400

    # Optional building_id
    parsed_building_id = None
    raw_building_id = data.get('building_id')

    # Enforce building_id rules based on center_type
    center_type = center.center_type or 'campus'
    if center_type == 'campus':
        # Campus: building_id is REQUIRED
        if raw_building_id is None or str(raw_building_id).strip() == "":
            return jsonify({"error": "building_id is required for campus type centers"}), 400
        try:
            b_id = int(raw_building_id)
        except (TypeError, ValueError):
            return jsonify({"error": "Invalid building_id"}), 400
        building = db.session.get(EvacuationCenterBuilding, b_id)
        if not building or building.evacuation_center_id != center_id:
            return jsonify({"error": "Selected building does not belong to this evacuation center"}), 400

        # Check building status - cannot add rooms to closed/under_repair buildings
        if building.status != 'open':
            return jsonify({"error": f"Cannot add rooms to a building with status '{building.status}'. Only 'open' buildings can have rooms added."}), 400

        # Check building max_rooms limit
        if building.max_rooms is not None:
            active_rooms_in_building = EvacuationCenterRoom.query.filter_by(
                building_id=building.id, is_active=True
            ).count()
            if active_rooms_in_building >= building.max_rooms:
                return jsonify({"error": f"Building has reached its maximum room limit of {building.max_rooms}"}), 400

        parsed_building_id = building.id
    elif center_type in ('private_property', 'single_venue'):
        # private_property and single_venue: building_id MUST BE NULL
        if raw_building_id is not None and str(raw_building_id).strip() != "":
            return jsonify({"error": f"building_id must not be provided for {center_type} type centers"}), 400
        parsed_building_id = None
    else:
        # Fallback for any unknown type - treat as campus (require building)
        if raw_building_id is not None and str(raw_building_id).strip() != "":
            try:
                b_id = int(raw_building_id)
            except (TypeError, ValueError):
                return jsonify({"error": "Invalid building_id"}), 400
            building = db.session.get(EvacuationCenterBuilding, b_id)
            if not building or building.evacuation_center_id != center_id:
                return jsonify({"error": "Selected building does not belong to this evacuation center"}), 400
            parsed_building_id = building.id

    room = EvacuationCenterRoom(
        evacuation_center_id=center_id,
        building_id=parsed_building_id,
        room_number=room_number,
        capacity=capacity,
        latitude=parsed_lat,
        longitude=parsed_lng,
        is_active=True
    )

    db.session.add(room)
    db.session.commit()

    user_id = get_jwt_identity()
    db.session.add(
        SystemLog(
            user_id=user_id,
            action=f"Added room {room.room_number} to evacuation center: {center.name}"
        )
    )
    db.session.commit()

    room_data = room.to_dict()
    room_data["occupied"] = 0
    room_data["assigned"] = 0
    room_data["available"] = capacity
    room_data["unassigned"] = capacity

    return jsonify({
        "message": "Room added successfully",
        "room": room_data
    }), 201


# ==========================================
# UPDATE ROOM
# ==========================================
@rooms_bp.route(
    '/api/rooms/<int:room_id>',
    methods=['PUT']
)
@role_required('admin', 'lgu_personnel')
def update_room(room_id):
    room = EvacuationCenterRoom.query.get(room_id)
    if not room:
        return jsonify({"error": "Room not found"}), 404

    data = request.get_json() or {}

    current_assigned = EvacuationAssignment.query.filter_by(room_id=room.id).count()
    current_occupied = EvacuationAssignment.query.filter(
        EvacuationAssignment.room_id == room.id,
        EvacuationAssignment.checked_in_at.isnot(None)
    ).count()

    if 'capacity' in data:
        cap = data.get('capacity')
        if cap is None or str(cap).strip() == "":
            return jsonify({"error": "Room capacity is required"}), 400
        try:
            parsed_cap = int(cap)
            if parsed_cap <= 0:
                return jsonify({"error": "Room capacity must be greater than 0"}), 400
            if parsed_cap < current_assigned:
                return jsonify({
                    "error": f"Room capacity ({parsed_cap}) cannot be less than current assigned count ({current_assigned})"
                }), 400
            room.capacity = parsed_cap
        except (TypeError, ValueError):
            return jsonify({"error": "Room capacity must be a number"}), 400

    if 'room_number' in data:
        num = str(data.get('room_number') or '').strip()
        if not num:
            return jsonify({"error": "Room number cannot be empty"}), 400
        # Check duplicate
        duplicate = EvacuationCenterRoom.query.filter(
            EvacuationCenterRoom.evacuation_center_id == room.evacuation_center_id,
            EvacuationCenterRoom.room_number == num,
            EvacuationCenterRoom.id != room.id,
            EvacuationCenterRoom.is_active == True
        ).first()
        if duplicate:
            return jsonify({"error": f"A room with number '{num}' already exists in this center"}), 400
        room.room_number = num

    if 'building_id' in data:
        raw_building_id = data.get('building_id')
        center_type = room.evacuation_center.center_type or 'campus'

        if center_type == 'campus':
            # Campus: building_id is REQUIRED (cannot be set to null)
            if raw_building_id is None or str(raw_building_id).strip() == "":
                return jsonify({"error": "building_id is required for campus type centers"}), 400
            try:
                b_id = int(raw_building_id)
            except (TypeError, ValueError):
                return jsonify({"error": "Invalid building_id"}), 400
            building = db.session.get(EvacuationCenterBuilding, b_id)
            if not building or building.evacuation_center_id != room.evacuation_center_id:
                return jsonify({"error": "Selected building does not belong to this evacuation center"}), 400

            # Check building status
            if building.status != 'open':
                return jsonify({"error": f"Cannot assign room to a building with status '{building.status}'. Only 'open' buildings can have rooms."}), 400

            # Check building max_rooms limit
            if building.max_rooms is not None:
                active_rooms_in_building = EvacuationCenterRoom.query.filter_by(
                    building_id=building.id, is_active=True
                ).count()
                if active_rooms_in_building >= building.max_rooms:
                    return jsonify({"error": f"Building has reached its maximum room limit of {building.max_rooms}"}), 400

            room.building_id = building.id
        elif center_type in ('private_property', 'single_venue'):
            # private_property and single_venue: building_id MUST BE NULL
            if raw_building_id is not None and str(raw_building_id).strip() != "":
                return jsonify({"error": f"building_id must not be provided for {center_type} type centers"}), 400
            room.building_id = None
        else:
            # Fallback
            if raw_building_id is None or str(raw_building_id).strip() == "":
                room.building_id = None
            else:
                try:
                    b_id = int(raw_building_id)
                except (TypeError, ValueError):
                    return jsonify({"error": "Invalid building_id"}), 400
                building = db.session.get(EvacuationCenterBuilding, b_id)
                if not building or building.evacuation_center_id != room.evacuation_center_id:
                    return jsonify({"error": "Selected building does not belong to this evacuation center"}), 400
                room.building_id = building.id

    if 'latitude' in data and 'longitude' in data:
        lat = data.get('latitude')
        lng = data.get('longitude')
        if lat is not None and lng is not None and str(lat).strip() != "" and str(lng).strip() != "":
            try:
                room.latitude = float(lat)
                room.longitude = float(lng)
            except (TypeError, ValueError):
                return jsonify({"error": "Invalid room coordinates"}), 400
        else:
            room.latitude = None
            room.longitude = None

    db.session.commit()

    user_id = get_jwt_identity()
    db.session.add(
        SystemLog(
            user_id=user_id,
            action=f"Updated room {room.room_number} (ID: {room.id})"
        )
    )
    db.session.commit()

    is_assigned = current_assigned > 0
    room_data = room.to_dict()
    room_data["occupied"] = current_occupied
    room_data["assigned"] = current_assigned
    room_data["available"] = max(room.capacity - current_occupied, 0)
    room_data["unassigned"] = max(room.capacity - current_assigned, 0)
    room_data["is_assigned"] = is_assigned
    room_data["is_fully_assigned"] = bool(room.capacity > 0 and current_assigned >= room.capacity)
    room_data["assignment_status"] = "Assigned" if is_assigned else "Unassigned"

    return jsonify({
        "message": "Room updated successfully",
        "room": room_data
    }), 200


# ==========================================
# UPDATE ROOM LOCATION (Mapbox click)
# ==========================================
@rooms_bp.route(
    '/api/rooms/<int:room_id>/location',
    methods=['PUT']
)
@role_required('admin', 'lgu_personnel')
def update_room_location(room_id):
    room = EvacuationCenterRoom.query.get(room_id)
    if not room:
        return jsonify({"error": "Room not found"}), 404

    data = request.get_json() or {}
    latitude = data.get("latitude")
    longitude = data.get("longitude")

    if latitude is None and longitude is None:
        center = EvacuationCenter.query.get(room.evacuation_center_id)
        room.latitude = None
        room.longitude = None

        user_id = get_jwt_identity()
        db.session.add(
            SystemLog(
                user_id=user_id,
                action=f"Removed room {room.room_number} location in center: {center.name if center else room.evacuation_center_id}"
            )
        )
        db.session.commit()

        assigned = EvacuationAssignment.query.filter_by(room_id=room.id).count()
        occupied = EvacuationAssignment.query.filter(
            EvacuationAssignment.room_id == room.id,
            EvacuationAssignment.checked_in_at.isnot(None)
        ).count()
        is_assigned = assigned > 0
        room_data = room.to_dict()
        room_data["occupied"] = occupied
        room_data["assigned"] = assigned
        room_data["available"] = max(room.capacity - occupied, 0)
        room_data["unassigned"] = max(room.capacity - assigned, 0)
        room_data["is_assigned"] = is_assigned
        room_data["is_fully_assigned"] = bool(room.capacity > 0 and assigned >= room.capacity)
        room_data["assignment_status"] = "Assigned" if is_assigned else "Unassigned"

        return jsonify({
            "message": "Room location removed successfully",
            "room": room_data
        }), 200

    if latitude is None or longitude is None:
        return jsonify({"error": "Room location is required"}), 400

    try:
        latitude = float(latitude)
        longitude = float(longitude)
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid room coordinates"}), 400

    if latitude < -90 or latitude > 90:
        return jsonify({"error": "Latitude must be between -90 and 90"}), 400

    if longitude < -180 or longitude > 180:
        return jsonify({"error": "Longitude must be between -180 and 180"}), 400

    center = EvacuationCenter.query.get(room.evacuation_center_id)
    room.latitude = latitude
    room.longitude = longitude

    user_id = get_jwt_identity()
    db.session.add(
        SystemLog(
            user_id=user_id,
            action=f"Mapped room {room.room_number} location in center: {center.name if center else room.evacuation_center_id}"
        )
    )
    db.session.commit()

    assigned = EvacuationAssignment.query.filter_by(room_id=room.id).count()
    occupied = EvacuationAssignment.query.filter(
        EvacuationAssignment.room_id == room.id,
        EvacuationAssignment.checked_in_at.isnot(None)
    ).count()
    is_assigned = assigned > 0
    room_data = room.to_dict()
    room_data["occupied"] = occupied
    room_data["assigned"] = assigned
    room_data["available"] = max(room.capacity - occupied, 0)
    room_data["unassigned"] = max(room.capacity - assigned, 0)
    room_data["is_assigned"] = is_assigned
    room_data["is_fully_assigned"] = bool(room.capacity > 0 and assigned >= room.capacity)
    room_data["assignment_status"] = "Assigned" if is_assigned else "Unassigned"

    return jsonify({
        "message": "Room location updated successfully",
        "room": room_data
    }), 200


# ==========================================
# TOGGLE ROOM ACTIVE (Safe deactivation)
# ==========================================
@rooms_bp.route(
    '/api/rooms/<int:room_id>/toggle-active',
    methods=['PATCH']
)
@role_required('admin', 'lgu_personnel')
def toggle_room_active(room_id):
    room = EvacuationCenterRoom.query.get_or_404(room_id)

    # Check for assigned families before deactivating
    if room.is_active:
        active_assignments = EvacuationAssignment.query.filter_by(room_id=room.id).count()
        if active_assignments > 0:
            return jsonify({
                "error": f"Cannot deactivate room with {active_assignments} assigned resident(s). Please move or unassign families first."
            }), 400

    room.is_active = not room.is_active
    db.session.commit()

    user_id = get_jwt_identity()
    action = "Reactivated" if room.is_active else "Deactivated"
    db.session.add(SystemLog(user_id=user_id, action=f"{action} room: {room.room_number} (ID: {room.id})"))
    db.session.commit()

    assigned = EvacuationAssignment.query.filter_by(room_id=room.id).count()
    occupied = EvacuationAssignment.query.filter(
        EvacuationAssignment.room_id == room.id,
        EvacuationAssignment.checked_in_at.isnot(None)
    ).count()
    is_assigned = assigned > 0
    room_data = room.to_dict()
    room_data["occupied"] = occupied
    room_data["assigned"] = assigned
    room_data["available"] = max(room.capacity - occupied, 0)
    room_data["unassigned"] = max(room.capacity - assigned, 0)
    room_data["is_assigned"] = is_assigned
    room_data["is_fully_assigned"] = bool(room.capacity > 0 and assigned >= room.capacity)
    room_data["assignment_status"] = "Assigned" if is_assigned else "Unassigned"

    return jsonify(room_data), 200


# ==========================================
# DELETE ROOM (Safe soft-delete)
# ==========================================
@rooms_bp.route(
    '/api/rooms/<int:room_id>',
    methods=['DELETE']
)
@role_required('admin', 'lgu_personnel')
def delete_room(room_id):
    room = EvacuationCenterRoom.query.get_or_404(room_id)

    # Check for active assignments
    active_assignments = EvacuationAssignment.query.filter_by(room_id=room.id).count()
    if active_assignments > 0:
        return jsonify({
            "error": f"Cannot delete room with {active_assignments} assigned resident(s). Please move or unassign families first."
        }), 400

    # Soft delete to preserve historical references
    room.is_active = False
    db.session.commit()

    user_id = get_jwt_identity()
    db.session.add(SystemLog(user_id=user_id, action=f"Safely deactivated/deleted room: {room.room_number} (ID: {room.id})"))
    db.session.commit()

    return jsonify({
        "message": f"Room '{room.room_number}' deactivated safely.",
        "room_id": room.id
    }), 200


# ==========================================
# GET ASSIGNED FAMILIES IN A ROOM
# ==========================================
@rooms_bp.route(
    '/api/rooms/<int:room_id>/families',
    methods=['GET']
)
@role_required('admin', 'lgu_personnel')
def get_room_families(room_id):
    room = EvacuationCenterRoom.query.get(room_id)
    if not room:
        return jsonify({"error": "Room not found"}), 404

    assignments = EvacuationAssignment.query.filter_by(room_id=room_id).all()

    total_assigned = len(assignments)
    total_occupied = sum(1 for a in assignments if a.checked_in_at is not None)

    # Group by family
    family_members_map = defaultdict(list)
    for assignment in assignments:
        resident = Resident.query.get(assignment.resident_id)
        if not resident:
            continue
        family_id = resident.family_id

        age = None
        if resident.date_of_birth:
            today = date.today()
            age = today.year - resident.date_of_birth.year - (
                (today.month, today.day) < (resident.date_of_birth.month, resident.date_of_birth.day)
            )

        is_senior = bool(age is not None and age >= 60)
        is_infant = bool(age is not None and age <= 2)
        is_pwd = bool(resident.is_pwd)
        is_pregnant = bool(resident.is_pregnant)
        is_lactating = bool(resident.is_lactating)
        is_solo_parent = bool(resident.is_solo_parent)

        member_flags = []
        if is_pwd:
            member_flags.append("PWD")
        if is_senior:
            member_flags.append("Senior")
        if is_infant:
            member_flags.append("Infant")
        if is_pregnant:
            member_flags.append("Pregnant")
        if is_lactating:
            member_flags.append("Lactating")
        if is_solo_parent:
            member_flags.append("Solo Parent")

        family_members_map[family_id].append({
            "assignment_id": assignment.id,
            "resident_id": resident.id,
            "full_name": resident.get_full_name(),
            "first_name": resident.first_name,
            "last_name": resident.last_name,
            "household_head_name": resident.household_head_name,
            "barangay": resident.barangay,
            "address": resident.address,
            "contact_number": resident.contact_number,
            "vulnerable_members": resident.vulnerable_members,
            "is_pwd": is_pwd,
            "is_pregnant": is_pregnant,
            "is_lactating": is_lactating,
            "is_solo_parent": is_solo_parent,
            "is_senior": is_senior,
            "is_infant": is_infant,
            "age": age,
            "special_needs": member_flags,
            "remarks": resident.remarks,
            "is_checked_in": assignment.checked_in_at is not None,
            "checked_in_at": assignment.checked_in_at.isoformat() if assignment.checked_in_at else None,
            "checkin_status": "Checked in" if assignment.checked_in_at is not None else "Not yet arrived",
        })

    def extract_family_special_needs(members_list):
        tags = []
        for m in members_list:
            for flag in m.get("special_needs", []):
                if flag not in tags:
                    tags.append(flag)
        return tags

    families = []
    for family_id, residents_in_room in family_members_map.items():
        fam_flags = extract_family_special_needs(residents_in_room)
        checked_in_mems = sum(1 for m in residents_in_room if m.get("is_checked_in"))
        is_fam_checked_in = checked_in_mems > 0
        checkin_status = "Checked in" if is_fam_checked_in else "Not yet arrived"
        if family_id:
            fam = Family.query.get(family_id)
            if fam:
                families.append({
                    "family_id": fam.id,
                    "family_code": fam.family_code,
                    "household_head_name": fam.head_name,
                    "head_name": fam.head_name,
                    "barangay": fam.barangay.name if fam.barangay else residents_in_room[0]["barangay"],
                    "barangay_id": fam.barangay_id,
                    "address": residents_in_room[0]["address"],
                    "contact_number": fam.contact_number or residents_in_room[0]["contact_number"],
                    "family_members": len(residents_in_room),
                    "assigned_members": len(residents_in_room),
                    "checked_in_members": checked_in_mems,
                    "is_checked_in": is_fam_checked_in,
                    "checkin_status": checkin_status,
                    "total_members": fam.member_count or len(residents_in_room),
                    "special_needs": fam_flags,
                    "evacuation_status": "Assigned",
                    "assignment_status": "Assigned",
                    "members": residents_in_room
                })
                continue

        # Fallback if resident has no family_id
        representative = residents_in_room[0]
        families.append({
            "family_id": None,
            "family_code": "N/A",
            "household_head_name": representative["household_head_name"],
            "head_name": representative["household_head_name"],
            "barangay": representative["barangay"],
            "barangay_id": None,
            "address": representative["address"],
            "contact_number": representative["contact_number"],
            "family_members": len(residents_in_room),
            "assigned_members": len(residents_in_room),
            "checked_in_members": checked_in_mems,
            "is_checked_in": is_fam_checked_in,
            "checkin_status": checkin_status,
            "total_members": len(residents_in_room),
            "special_needs": fam_flags,
            "evacuation_status": "Assigned",
            "assignment_status": "Assigned",
            "members": residents_in_room
        })

    center = EvacuationCenter.query.get(room.evacuation_center_id)
    is_assigned = total_assigned > 0

    return jsonify({
        "room_id": room.id,
        "room_number": room.room_number,
        "building_id": room.building_id,
        "building_name": (room.building.name or f"Building #{room.building.id}") if room.building else None,
        "center_id": room.evacuation_center_id,
        "center_name": center.name if center else "Unknown",
        "capacity": room.capacity,
        "occupied": total_occupied,
        "assigned": total_assigned,
        "available": max((room.capacity or 0) - total_occupied, 0),
        "unassigned": max((room.capacity or 0) - total_assigned, 0),
        "is_active": room.is_active,
        "is_assigned": is_assigned,
        "is_fully_assigned": bool((room.capacity or 0) > 0 and total_assigned >= (room.capacity or 0)),
        "assignment_status": "Assigned" if is_assigned else "Unassigned",
        "families": families
    })


# ==========================================
# GET AVAILABLE FAMILIES (Unassigned)
# ==========================================
@rooms_bp.route(
    '/api/rooms/<int:room_id>/available-families',
    methods=['GET']
)
@role_required('admin', 'lgu_personnel')
def get_available_families(room_id):
    room = EvacuationCenterRoom.query.get(room_id)
    if not room:
        return jsonify({"error": "Room not found"}), 404

    # Find families that currently have active evacuation assignments
    assigned_family_ids = (
        db.session.query(Resident.family_id)
        .join(EvacuationAssignment, EvacuationAssignment.resident_id == Resident.id)
        .filter(Resident.family_id.is_not(None))
        .distinct()
        .all()
    )
    assigned_ids = [row[0] for row in assigned_family_ids]

    center = EvacuationCenter.query.get(room.evacuation_center_id)
    linked_barangay_ids = (
        [link.barangay_id for link in center.barangay_links]
        if center and center.barangay_links
        else []
    )

    query = Family.query
    if linked_barangay_ids:
        query = query.filter(Family.barangay_id.in_(linked_barangay_ids))
    if assigned_ids:
        query = query.filter(~Family.id.in_(assigned_ids))

    unassigned_families = query.options(joinedload(Family.barangay)).order_by(
        Family.head_name.asc()
    ).all()

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

    return jsonify(result)


# ==========================================
# ASSIGN FAMILIES TO ROOM
# ==========================================
@rooms_bp.route(
    '/api/rooms/<int:room_id>/assign-families',
    methods=['POST']
)
@role_required('admin', 'lgu_personnel')
def assign_families(room_id):
    room = EvacuationCenterRoom.query.get(room_id)
    if not room:
        return jsonify({"error": "Room not found"}), 404

    if not room.is_active:
        return jsonify({"error": "Cannot assign families to an inactive room"}), 400

    center = EvacuationCenter.query.get(room.evacuation_center_id)
    if not center or not center.is_active:
        return jsonify({"error": "Cannot assign families to a room in an inactive evacuation center"}), 400

    linked_barangay_ids = {
        link.barangay_id for link in center.barangay_links
    }
    linked_barangay_names = {
        link.barangay.name.strip().casefold()
        for link in center.barangay_links
        if link.barangay and link.barangay.name
    }

    data = request.get_json() or {}

    # Support either family_ids or resident_ids
    family_ids = data.get('family_ids', [])
    resident_ids = data.get('resident_ids', [])

    if not family_ids and not resident_ids:
        return jsonify({"error": "Select at least one family to assign"}), 400

    # Current room occupancy
    current_occupied = EvacuationAssignment.query.filter_by(room_id=room.id).count()
    remaining_space = max(room.capacity - current_occupied, 0)

    families_to_assign = []

    if family_ids:
        if not isinstance(family_ids, list):
            return jsonify({"error": "family_ids must be a list"}), 400
        try:
            family_ids = [int(fid) for fid in set(family_ids)]
        except (TypeError, ValueError):
            return jsonify({"error": "Invalid family ID"}), 400

        families = Family.query.filter(Family.id.in_(family_ids)).all()
        if len(families) != len(family_ids):
            return jsonify({"error": "One or more selected families were not found"}), 404
        if linked_barangay_ids and any(
            family.barangay_id not in linked_barangay_ids for family in families
        ):
            return jsonify({"error": "All selected families must belong to a barangay served by this evacuation center"}), 400
        families_to_assign = families

    elif resident_ids:
        if not isinstance(resident_ids, list):
            return jsonify({"error": "resident_ids must be a list"}), 400
        try:
            resident_ids = [int(rid) for rid in set(resident_ids)]
        except (TypeError, ValueError):
            return jsonify({"error": "Invalid resident ID"}), 400

        residents = Resident.query.filter(Resident.id.in_(resident_ids)).all()
        found_fids = set(r.family_id for r in residents if r.family_id)
        if found_fids:
            families_to_assign = Family.query.filter(Family.id.in_(found_fids)).all()
            if linked_barangay_ids and any(
                family.barangay_id not in linked_barangay_ids for family in families_to_assign
            ):
                return jsonify({"error": "All selected families must belong to a barangay served by this evacuation center"}), 400
        elif linked_barangay_names:
            if any(
                (resident.barangay or "").strip().casefold() not in linked_barangay_names
                for resident in residents
            ):
                return jsonify({"error": "All selected residents must belong to a barangay served by this evacuation center"}), 400

    # Validate that none of the families are already assigned
    for fam in families_to_assign:
        already_assigned = (
            db.session.query(EvacuationAssignment)
            .join(Resident, EvacuationAssignment.resident_id == Resident.id)
            .filter(Resident.family_id == fam.id)
            .first()
        )
        if already_assigned:
            return jsonify({
                "error": f"Family '{fam.head_name}' ({fam.family_code}) is already assigned to a room. Use the move option to change rooms."
            }), 400

    # Calculate total members needed
    total_members_needed = 0
    family_residents_map = {}
    for fam in families_to_assign:
        residents = Resident.query.filter_by(family_id=fam.id).all()
        if not residents:
            # Ensure at least one resident record for the head
            head_resident = Resident(
                family_id=fam.id,
                first_name=fam.head_name.split()[0] if fam.head_name else "Head",
                last_name=" ".join(fam.head_name.split()[1:]) if fam.head_name and len(fam.head_name.split()) > 1 else "",
                household_head_name=fam.head_name,
                barangay=fam.barangay.name if fam.barangay else "",
                contact_number=fam.contact_number,
                family_members=fam.member_count or 1
            )
            db.session.add(head_resident)
            db.session.flush()
            residents = [head_resident]

        family_residents_map[fam.id] = residents
        total_members_needed += len(residents)

    # Check room capacity
    if current_occupied + total_members_needed > room.capacity:
        return jsonify({
            "error": (
                f"Room only has {remaining_space} available space(s). "
                f"The selected families need {total_members_needed} space(s)."
            ),
            "capacity": room.capacity,
            "occupied": current_occupied,
            "available": remaining_space,
            "needed": total_members_needed
        }), 400

    # Create assignments
    for fam in families_to_assign:
        for resident in family_residents_map[fam.id]:
            assignment = EvacuationAssignment(
                resident_id=resident.id,
                room_id=room.id
            )
            db.session.add(assignment)
        fam.evacuation_status = "Assigned"

    user_id = get_jwt_identity()
    db.session.add(
        SystemLog(
            user_id=user_id,
            action=f"Assigned {len(families_to_assign)} families ({total_members_needed} members) to {center.name} - Room {room.room_number}"
        )
    )
    db.session.commit()

    new_assigned = current_occupied + total_members_needed
    current_checked_in = EvacuationAssignment.query.filter(
        EvacuationAssignment.room_id == room.id,
        EvacuationAssignment.checked_in_at.isnot(None)
    ).count()
    is_assigned = new_assigned > 0

    return jsonify({
        "message": "Families assigned successfully",
        "room_id": room.id,
        "families_assigned": len(families_to_assign),
        "total_members": total_members_needed,
        "room_occupied": current_checked_in,
        "room_assigned": new_assigned,
        "room_capacity": room.capacity,
        "room_available": max(room.capacity - current_checked_in, 0),
        "room_unassigned": max(room.capacity - new_assigned, 0),
        "is_assigned": is_assigned,
        "is_fully_assigned": bool(room.capacity > 0 and new_assigned >= room.capacity),
        "assignment_status": "Assigned" if is_assigned else "Unassigned"
    }), 201


# ==========================================
# REMOVE / UNASSIGN FAMILY FROM ROOM
# ==========================================
@rooms_bp.route(
    '/api/rooms/<int:room_id>/families/<int:resident_or_family_id>',
    methods=['DELETE']
)
@role_required('admin', 'lgu_personnel')
def remove_family_from_room(room_id, resident_or_family_id):
    room = EvacuationCenterRoom.query.get(room_id)
    if not room:
        return jsonify({"error": "Room not found"}), 404

    # Check if id refers to a Family
    family = Family.query.get(resident_or_family_id)
    if family:
        assignments = (
            db.session.query(EvacuationAssignment)
            .join(Resident, EvacuationAssignment.resident_id == Resident.id)
            .filter(
                Resident.family_id == family.id,
                EvacuationAssignment.room_id == room_id
            )
            .all()
        )
        if not assignments:
            return jsonify({"error": "Family is not assigned to this room"}), 404

        for a in assignments:
            db.session.delete(a)

        family.evacuation_status = "Unassigned"
        household_name = family.head_name
    else:
        # Check if id refers to a Resident
        assignment = EvacuationAssignment.query.filter_by(
            room_id=room_id,
            resident_id=resident_or_family_id
        ).first()

        if not assignment:
            return jsonify({"error": "Assignment not found in this room"}), 404

        resident = Resident.query.get(resident_or_family_id)
        if resident and resident.family_id:
            # Remove all members of the family
            family = Family.query.get(resident.family_id)
            assignments = (
                db.session.query(EvacuationAssignment)
                .join(Resident, EvacuationAssignment.resident_id == Resident.id)
                .filter(
                    Resident.family_id == family.id,
                    EvacuationAssignment.room_id == room_id
                )
                .all()
            )
            for a in assignments:
                db.session.delete(a)
            if family:
                family.evacuation_status = "Unassigned"
            household_name = resident.household_head_name
        else:
            db.session.delete(assignment)
            household_name = resident.household_head_name if resident else f"Resident {resident_or_family_id}"

    user_id = get_jwt_identity()
    db.session.add(
        SystemLog(
            user_id=user_id,
            action=f"Removed family '{household_name}' from Room {room.room_number}"
        )
    )
    db.session.commit()

    current_assigned = EvacuationAssignment.query.filter_by(room_id=room.id).count()
    current_occupied = EvacuationAssignment.query.filter(
        EvacuationAssignment.room_id == room.id,
        EvacuationAssignment.checked_in_at.isnot(None)
    ).count()
    is_assigned = current_assigned > 0

    return jsonify({
        "message": f"Family '{household_name}' unassigned from room successfully",
        "room_occupied": current_occupied,
        "room_assigned": current_assigned,
        "room_available": max(room.capacity - current_occupied, 0),
        "room_unassigned": max(room.capacity - current_assigned, 0),
        "is_assigned": is_assigned,
        "is_fully_assigned": bool(room.capacity > 0 and current_assigned >= room.capacity),
        "assignment_status": "Assigned" if is_assigned else "Unassigned"
    }), 200
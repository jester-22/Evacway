from flask import Blueprint, request, jsonify
from sqlalchemy import func
from sqlalchemy.orm import joinedload
from collections import defaultdict
from datetime import date

from models import (
    db,
    EvacuationCenter,
    EvacuationCenterBuilding,
    EvacuationCenterRoom,
    EvacuationOperation,
    CenterBarangay,
    Barangay,
    EvacuationAssignment,
    Family,
    NonRegisteredEvacuee,
    Resident,
    SystemLog,
    to_utc_iso,
)

from flask_jwt_extended import get_jwt_identity
from utils import get_optional_caller, public_room_payload, role_required


rooms_bp = Blueprint('rooms', __name__)
MIN_ROOM_PEOPLE_SPACES = 25


def _positive_room_limit(data, key, default, label, legacy_key=None, minimum=1):
    value = data.get(key, data.get(legacy_key) if legacy_key else None)
    if value is None or str(value).strip() == '':
        value = default
    try:
        parsed = int(value)
        if isinstance(value, float) and not value.is_integer():
            raise ValueError
    except (TypeError, ValueError):
        if minimum > 1:
            raise ValueError(f'{label} must be a whole number of at least {minimum}')
        raise ValueError(f'{label} must be a whole number greater than 0')
    if parsed < minimum:
        if minimum > 1:
            raise ValueError(f'{label} must be at least {minimum}')
        raise ValueError(f'{label} must be greater than 0')
    return parsed


def _room_capacity_payload(room, usage=None):
    usage = room.capacity_usage() if usage is None else usage
    return {
        'family_slots': int(room.family_slots or 0),
        'people_spaces': int(room.people_spaces or 0),
        # Temporary API alias for clients being updated in the next task part.
        'capacity': int(room.people_spaces or 0),
        **usage,
    }


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

    caller = get_optional_caller()
    is_staff = caller is not None and caller.get('role') in ('admin', 'lgu_personnel')
    resident_id = caller.get('resident_id') if caller and caller.get('role') == 'resident' else None
    include_inactive = is_staff and request.args.get('include_inactive') == 'true'

    query = EvacuationCenterRoom.query.options(
        joinedload(EvacuationCenterRoom.building)
    ).filter_by(
        evacuation_center_id=center_id
    )

    if not include_inactive:
        query = query.filter_by(is_active=True)

    rooms = query.order_by(
        EvacuationCenterRoom.room_number.asc()
    ).all()

    room_ids = [room.id for room in rooms]
    usage_by_room = EvacuationCenterRoom.bulk_capacity_usage(rooms)

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
        result = [
            public_room_payload(
                room,
                room.id in my_room_ids,
                usage=usage_by_room.get(room.id),
                building=room.building,
            )
            for room in rooms
        ]
        return jsonify(result)

    occupied_by_room = (
        dict(
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
        if room_ids
        else {}
    )

    result = []

    for room in rooms:
        usage = usage_by_room.get(room.id) or room.capacity_usage()
        assigned = usage['used_spaces']
        occupied = int(occupied_by_room.get(room.id, 0) or 0)

        room_data = room.to_dict(usage=usage)
        room_data["occupied"] = occupied
        room_data["assigned"] = assigned
        # Capacity is consumed by assigned residents, whether or not they have
        # checked in yet. Keep `occupied` as arrivals and expose remaining
        # assignment capacity separately.
        room_data.update(_room_capacity_payload(room, usage=usage))
        room_data["available"] = usage['available_spaces']
        room_data["unassigned"] = usage['available_spaces']
        is_assigned = assigned > 0
        room_data["is_assigned"] = is_assigned
        room_data["is_fully_assigned"] = usage['is_full']
        room_data["assignment_status"] = "Assigned" if is_assigned else "Unassigned"

        room_data["latitude"] = None
        room_data["longitude"] = None

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

    structure_mode = getattr(center, 'structure_mode', None) or 'buildings_and_rooms'
    if structure_mode == 'open_area':
        return jsonify({
            "error": "Rooms cannot be added to an open area evacuation center"
        }), 400

    data = request.get_json() or {}

    room_number = data.get('room_number')
    try:
        family_slots = _positive_room_limit(data, 'family_slots', 5, 'Family slots')
        people_spaces = _positive_room_limit(
            data, 'people_spaces', MIN_ROOM_PEOPLE_SPACES, 'People spaces', 'capacity', minimum=MIN_ROOM_PEOPLE_SPACES
        )
    except ValueError as err:
        return jsonify({'error': str(err)}), 400
    raw_floor = data.get('floor')
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

    # Enforce building_id rules based on center structure_mode
    structure_mode = getattr(center, 'structure_mode', None) or 'buildings_and_rooms'
    if structure_mode != 'buildings_and_rooms':
        # open_area and rooms_only: building_id MUST BE NULL
        if raw_building_id is not None and str(raw_building_id).strip() != "":
            return jsonify({"error": f"building_id must not be provided for {structure_mode} structure"}), 400
        parsed_building_id = None
    else:
        # Campus or other: building_id is optional (can be assigned to building or unassigned)
        if raw_building_id is not None and str(raw_building_id).strip() != "":
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
        else:
            parsed_building_id = None

    parsed_floor = None
    if raw_floor is not None and str(raw_floor).strip() != "":
        try:
            parsed_floor = int(raw_floor)
            if isinstance(raw_floor, float) and not raw_floor.is_integer():
                raise ValueError
        except (TypeError, ValueError):
            return jsonify({"error": "Floor must be a whole number"}), 400
        if parsed_floor < 1:
            return jsonify({"error": "Floor must be 1 or greater"}), 400
    floor_building = db.session.get(EvacuationCenterBuilding, parsed_building_id) if parsed_building_id else None
    if floor_building:
        if parsed_floor is None:
            return jsonify({"error": "Choose a floor for this room."}), 400
        if parsed_floor > (floor_building.floors or 1):
            return jsonify({"error": f"Floor {parsed_floor} is outside this building's 1 to {floor_building.floors} floor range."}), 400
    elif parsed_floor is not None:
        return jsonify({"error": "A room without a building cannot have a floor assigned."}), 400

    room = EvacuationCenterRoom(
        evacuation_center_id=center_id,
        building_id=parsed_building_id,
        room_number=room_number,
        capacity=people_spaces,
        family_slots=family_slots,
        people_spaces=people_spaces,
        floor=parsed_floor,
        latitude=parsed_lat,
        longitude=parsed_lng,
        is_active=True
    )

    db.session.add(room)
    db.session.commit()

    # Keep the legacy center people-capacity field in sync with room spaces.
    active_rooms = EvacuationCenterRoom.query.filter_by(
        evacuation_center_id=center_id, is_active=True
    ).all()
    center.capacity = sum(r.people_spaces or 0 for r in active_rooms)
    db.session.commit()

    user_id = get_jwt_identity()
    db.session.add(
        SystemLog(
            user_id=user_id,
            action=f"Added room {room.room_number}" + (f", floor {room.floor}" if room.floor is not None else "") + f" to evacuation center: {center.name}"
        )
    )
    db.session.commit()

    room_data = room.to_dict()
    room_data["occupied"] = 0
    room_data["assigned"] = 0
    room_data.update(_room_capacity_payload(room))
    room_data["available"] = people_spaces
    room_data["unassigned"] = people_spaces

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
    # This SELECT starts the assignment transaction and holds the room row lock
    # through the capacity check and assignment commit.
    room = EvacuationCenterRoom.query.filter_by(id=room_id).with_for_update().first()
    if not room:
        return jsonify({"error": "Room not found"}), 404

    original_building_id = room.building_id
    data = request.get_json() or {}

    usage = room.capacity_usage()
    current_assigned = usage['used_spaces']
    current_occupied = EvacuationAssignment.query.filter(
        EvacuationAssignment.room_id == room.id,
        EvacuationAssignment.checked_in_at.isnot(None)
    ).count()

    current_usage = room.capacity_usage()
    for key, label, used_key, current_limit, minimum in (
        ('family_slots', 'Family slots', 'used_slots', int(room.family_slots or 5), 1),
        ('people_spaces', 'People spaces', 'used_spaces', int(room.people_spaces or MIN_ROOM_PEOPLE_SPACES), MIN_ROOM_PEOPLE_SPACES),
    ):
        legacy_value = data.get('capacity') if key == 'people_spaces' and key not in data else None
        if key not in data and legacy_value is None:
            continue
        try:
            parsed_limit = _positive_room_limit(
                {key: data.get(key, legacy_value)}, key, current_limit, label, minimum=minimum
            )
        except ValueError as err:
            return jsonify({'error': str(err)}), 400
        used = current_usage[used_key]
        if parsed_limit < used and parsed_limit < current_limit:
            limit_name = 'family slots' if key == 'family_slots' else 'people spaces'
            return jsonify({
                'error': f'Cannot lower {limit_name} to {parsed_limit}; {used} are currently used. Increase capacity or move/unassign occupants first.'
            }), 400
        setattr(room, key, parsed_limit)
        if key == 'people_spaces':
            room.capacity = parsed_limit

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
        structure_mode = getattr(room.evacuation_center, 'structure_mode', None) or 'buildings_and_rooms'

        if structure_mode != 'buildings_and_rooms':
            # open_area and rooms_only: building_id MUST BE NULL
            if raw_building_id is not None and str(raw_building_id).strip() != "":
                return jsonify({"error": f"building_id must not be provided for {structure_mode} structure"}), 400
            room.building_id = None
        else:
            # Campus or other: None/empty unlinks the room from building
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

                # Check building status
                if building.status != 'open':
                    return jsonify({"error": f"Cannot assign room to a building with status '{building.status}'. Only 'open' buildings can have rooms."}), 400

                # Check building max_rooms limit (exclude current room if already in this building)
                if building.max_rooms is not None:
                    active_rooms_in_building = EvacuationCenterRoom.query.filter(
                        EvacuationCenterRoom.building_id == building.id,
                        EvacuationCenterRoom.is_active == True,
                        EvacuationCenterRoom.id != room.id
                    ).count()
                    if active_rooms_in_building >= building.max_rooms:
                        return jsonify({"error": f"Building has reached its maximum room limit of {building.max_rooms}"}), 400

                room.building_id = building.id

    building_changed = 'building_id' in data and original_building_id != room.building_id
    raw_floor = data.get(
        'floor',
        (1 if room.building_id else None) if building_changed else room.floor
    )
    if raw_floor is None or str(raw_floor).strip() == "":
        parsed_floor = None
    else:
        try:
            parsed_floor = int(raw_floor)
            if isinstance(raw_floor, float) and not raw_floor.is_integer():
                raise ValueError
        except (TypeError, ValueError):
            return jsonify({"error": "Floor must be a whole number"}), 400
        if parsed_floor < 1:
            return jsonify({"error": "Floor must be 1 or greater"}), 400
    floor_building = db.session.get(EvacuationCenterBuilding, room.building_id) if room.building_id else None
    preserve_legacy_null = bool(
        floor_building and parsed_floor is None and room.floor is None
        and not building_changed and 'floor' not in data
    )
    if floor_building and not preserve_legacy_null:
        if parsed_floor is None:
            return jsonify({"error": "Choose a floor for this room."}), 400
        if parsed_floor > (floor_building.floors or 1):
            return jsonify({"error": f"Floor {parsed_floor} is outside this building's 1 to {floor_building.floors} floor range."}), 400
    elif not floor_building and parsed_floor is not None:
        return jsonify({"error": "A room without a building cannot have a floor assigned."}), 400
    if not preserve_legacy_null:
        room.floor = parsed_floor

# Room coordinates are deprecated in favor of building mapping

    db.session.commit()

    # Automatically keep center.capacity in sync with rooms
    active_rooms = EvacuationCenterRoom.query.filter_by(
        evacuation_center_id=room.evacuation_center_id, is_active=True
    ).all()
    room.evacuation_center.capacity = sum(r.people_spaces or 0 for r in active_rooms)
    db.session.commit()

    user_id = get_jwt_identity()
    db.session.add(
        SystemLog(
            user_id=user_id,
            action=f"Updated room {room.room_number}" + (f", floor {room.floor}" if room.floor is not None else "") + f" (ID: {room.id})"
        )
    )
    db.session.commit()

    is_assigned = current_assigned > 0
    room_data = room.to_dict()
    room_data["occupied"] = current_occupied
    room_data["assigned"] = current_assigned
    room_data.update(_room_capacity_payload(room))
    room_data["available"] = room_data["available_spaces"]
    room_data["unassigned"] = room_data["available_spaces"]
    room_data["is_assigned"] = is_assigned
    room_data["is_fully_assigned"] = room_data['is_full']
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
                action=f"Removed room {room.room_number}" + (f" (floor {room.floor})" if room.floor is not None else "") + f" location in center: {center.name if center else room.evacuation_center_id}"
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
        room_data.update(_room_capacity_payload(room))
        room_data["available"] = room_data['available_spaces']
        room_data["unassigned"] = room_data['available_spaces']
        room_data["is_assigned"] = is_assigned
        room_data["is_fully_assigned"] = room_data['is_full']
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
        action=f"Mapped room {room.room_number}" + (f" (floor {room.floor})" if room.floor is not None else "") + f" location in center: {center.name if center else room.evacuation_center_id}"
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
    room_data.update(_room_capacity_payload(room))
    room_data["available"] = room_data['available_spaces']
    room_data["unassigned"] = room_data['available_spaces']
    room_data["is_assigned"] = is_assigned
    room_data["is_fully_assigned"] = room_data['is_full']
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

    # Check for assigned families or present walk-ins before deactivating
    if room.is_active:
        active_assignments = EvacuationAssignment.query.filter_by(room_id=room.id).count()
        if active_assignments > 0:
            return jsonify({
                "error": f"Cannot deactivate room with {active_assignments} assigned resident(s). Please move or unassign families first."
            }), 400
        active_walkins = (
            db.session.query(func.count(NonRegisteredEvacuee.id))
            .join(EvacuationOperation, NonRegisteredEvacuee.operation_id == EvacuationOperation.id)
            .filter(
                NonRegisteredEvacuee.room_id == room.id,
                NonRegisteredEvacuee.departed_at.is_(None),
                EvacuationOperation.status == 'active',
            )
            .scalar() or 0
        )
        if active_walkins > 0:
            return jsonify({
                "error": f"Cannot deactivate room with {active_walkins} active non-registered evacuee(s). Please mark them departed first."
            }), 400

    room.is_active = not room.is_active
    db.session.flush()

    center = room.evacuation_center
    if center:
        active_rooms = EvacuationCenterRoom.query.filter_by(
            evacuation_center_id=room.evacuation_center_id, is_active=True
        ).all()
        center.capacity = sum(r.people_spaces or 0 for r in active_rooms)

    db.session.commit()

    user_id = get_jwt_identity()
    action = "Reactivated" if room.is_active else "Deactivated"
    db.session.add(SystemLog(user_id=user_id, action=f"{action} room: {room.room_number}" + (f" (floor {room.floor})" if room.floor is not None else "") + f" (ID: {room.id})"))
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
    room_data.update(_room_capacity_payload(room))
    room_data["available"] = room_data['available_spaces']
    room_data["unassigned"] = room_data['available_spaces']
    room_data["is_assigned"] = is_assigned
    room_data["is_fully_assigned"] = room_data['is_full']
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

    # Keep assigned households attached to their room. Once cleared, remove the
    # room row instead of leaving an inactive record behind.
    active_assignments = EvacuationAssignment.query.filter_by(room_id=room.id).count()
    if active_assignments > 0:
        return jsonify({
            "error": f"Cannot delete room with {active_assignments} assigned resident(s). Please move or unassign families first."
        }), 400
    active_walkins = (
        db.session.query(func.count(NonRegisteredEvacuee.id))
        .join(EvacuationOperation, NonRegisteredEvacuee.operation_id == EvacuationOperation.id)
        .filter(
            NonRegisteredEvacuee.room_id == room.id,
            NonRegisteredEvacuee.departed_at.is_(None),
            EvacuationOperation.status == 'active',
        )
        .scalar() or 0
    )
    if active_walkins > 0:
        return jsonify({
            "error": f"Cannot delete room with {active_walkins} active non-registered evacuee(s). Please mark them departed first."
        }), 400

    center = room.evacuation_center
    center_id = room.evacuation_center_id
    room_number = room.room_number
    db.session.delete(room)
    db.session.flush()

    # Keep the legacy center people-capacity field in sync with room spaces.
    active_rooms = EvacuationCenterRoom.query.filter_by(
        evacuation_center_id=center_id, is_active=True
    ).all()
    if center:
        center.capacity = sum(r.people_spaces or 0 for r in active_rooms)

    user_id = get_jwt_identity()
    db.session.add(SystemLog(user_id=user_id, action=f"Deleted room: {room_number}" + (f" (floor {room.floor})" if room.floor is not None else "") + f" (ID: {room_id})"))
    db.session.commit()

    return jsonify({
        "message": f"Room '{room_number}' deleted.",
        "room_id": room_id
    }), 200


# ==========================================
# UNLINK ROOM FROM BUILDING
# ==========================================
@rooms_bp.route(
    '/api/rooms/<int:room_id>/unlink-building',
    methods=['POST']
)
@role_required('admin', 'lgu_personnel')
def unlink_room_building(room_id):
    room = EvacuationCenterRoom.query.get_or_404(room_id)
    old_building_id = room.building_id
    old_floor = room.floor
    room.building_id = None
    room.floor = None
    db.session.commit()

    user_id = get_jwt_identity()
    db.session.add(SystemLog(user_id=user_id, action=f"Unlinked room '{room.room_number}'" + (f" (floor {old_floor})" if old_floor is not None else "") + f" (ID: {room.id}) from building (ID: {old_building_id})"))
    db.session.commit()

    return jsonify({
        "success": True,
        "message": f"Room '{room.room_number}' unlinked from building successfully.",
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
            "checked_in_at": to_utc_iso(assignment.checked_in_at),
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
    room_usage = room.capacity_usage()

    return jsonify({
        "room_id": room.id,
        "room_number": room.room_number,
        "building_id": room.building_id,
        "building_name": (room.building.name or f"Building #{room.building.id}") if room.building else None,
        "building_floors": room.building.floors if room.building else None,
        "floor": room.floor,
        "center_id": room.evacuation_center_id,
        "center_name": center.name if center else "Unknown",
        "capacity": room.people_spaces,
        "family_slots": room.family_slots,
        "people_spaces": room.people_spaces,
        **room_usage,
        "occupied": total_occupied,
        "assigned": total_assigned,
        "available": room_usage['available_spaces'],
        "unassigned": room_usage['available_spaces'],
        "is_active": room.is_active,
        "is_assigned": is_assigned,
        "is_fully_assigned": room_usage['is_full'],
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
    # Keep this lock until all assignments are committed. Concurrent requests
    # for the same room will recalculate usage after the first transaction.
    room = EvacuationCenterRoom.query.filter_by(id=room_id).with_for_update().first()
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
    current_usage = room.capacity_usage()

    families_to_assign = []
    standalone_residents = []

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
        if len(residents) != len(resident_ids):
            return jsonify({"error": "One or more selected residents were not found"}), 404
        found_fids = set(r.family_id for r in residents if r.family_id)
        standalone_residents = [resident for resident in residents if resident.family_id is None]
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

    for resident in standalone_residents:
        if EvacuationAssignment.query.filter_by(resident_id=resident.id).first():
            return jsonify({"error": f"Resident '{resident.get_full_name()}' is already assigned to a room."}), 400

    # Calculate both limits before creating any fallback resident rows.
    total_members_needed = 0
    family_residents_map = {}
    for fam in families_to_assign:
        residents = Resident.query.filter_by(family_id=fam.id).all()
        family_residents_map[fam.id] = residents
        total_members_needed += len(residents) if residents else max(int(fam.member_count or 1), 1)

    total_members_needed += len(standalone_residents)
    slots_needed = len(families_to_assign) + len(standalone_residents)
    if current_usage['available_slots'] < slots_needed:
        db.session.rollback()
        return jsonify({
            "error": f"Room has only {current_usage['available_slots']} family slot(s) available; the selection needs {slots_needed} slot(s).",
            "limit": "family_slots",
            "available_slots": current_usage['available_slots'],
            "needed_slots": slots_needed,
        }), 400
    if current_usage['available_spaces'] < total_members_needed:
        db.session.rollback()
        return jsonify({
            "error": f"Room has only {current_usage['available_spaces']} people space(s) available; the selection needs {total_members_needed} space(s).",
            "limit": "people_spaces",
            "available_spaces": current_usage['available_spaces'],
            "needed_spaces": total_members_needed,
        }), 400

    # Create assignments
    for fam in families_to_assign:
        residents = family_residents_map[fam.id]
        if not residents:
            # Ensure at least one resident record for a family without a roster.
            name_parts = (fam.head_name or 'Head').split()
            resident = Resident(
                family_id=fam.id,
                first_name=name_parts[0],
                last_name=' '.join(name_parts[1:]),
                is_head_of_family=True,
                relationship_to_head='Household Head',
            )
            db.session.add(resident)
            db.session.flush()
            residents = [resident]
        for resident in residents:
            assignment = EvacuationAssignment(
                resident_id=resident.id,
                evacuation_center_id=room.evacuation_center_id,
                room_id=room.id,
            )
            db.session.add(assignment)
        fam.evacuation_status = "Assigned"

    for resident in standalone_residents:
        db.session.add(
            EvacuationAssignment(
                resident_id=resident.id,
                evacuation_center_id=room.evacuation_center_id,
                room_id=room.id,
            )
        )

    user_id = get_jwt_identity()
    db.session.add(
        SystemLog(
            user_id=user_id,
            action=f"Assigned {len(families_to_assign)} families ({total_members_needed} members) to {center.name} - Room {room.room_number}" + (f" (floor {room.floor})" if room.floor is not None else "")
        )
    )
    db.session.commit()

    db.session.expire(room, ['assignments'])
    new_usage = room.capacity_usage()
    current_checked_in = EvacuationAssignment.query.filter(
        EvacuationAssignment.room_id == room.id,
        EvacuationAssignment.checked_in_at.isnot(None)
    ).count()
    is_assigned = new_usage['used_spaces'] > 0

    return jsonify({
        "message": "Families assigned successfully",
        "room_id": room.id,
        "families_assigned": len(families_to_assign),
        "total_members": total_members_needed,
        "room_occupied": current_checked_in,
        "room_assigned": new_usage['used_spaces'],
        "room_family_slots": room.family_slots,
        "room_people_spaces": room.people_spaces,
        **new_usage,
        "room_available": new_usage['available_spaces'],
        "room_unassigned": new_usage['available_spaces'],
        "is_assigned": is_assigned,
        "is_fully_assigned": new_usage['is_full'],
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

    # Check if id refers to a Family assigned to this room first; otherwise fall back to Resident
    family = Family.query.get(resident_or_family_id)
    family_assignments = (
        db.session.query(EvacuationAssignment)
        .join(Resident, EvacuationAssignment.resident_id == Resident.id)
        .filter(
            Resident.family_id == family.id,
            EvacuationAssignment.room_id == room_id
        )
        .all()
        if family else []
    )
    if family and family_assignments:
        for a in family_assignments:
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
            error_msg = "Family is not assigned to this room" if family else "Assignment not found in this room"
            return jsonify({"error": error_msg}), 404

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
            action=f"Removed family '{household_name}' from Room {room.room_number}" + (f" (floor {room.floor})" if room.floor is not None else "")
        )
    )
    db.session.commit()

    current_usage = room.capacity_usage()
    current_assigned = current_usage['used_spaces']
    current_occupied = EvacuationAssignment.query.filter(
        EvacuationAssignment.room_id == room.id,
        EvacuationAssignment.checked_in_at.isnot(None)
    ).count()
    is_assigned = current_assigned > 0

    return jsonify({
        "message": f"Family '{household_name}' unassigned from room successfully",
        "room_occupied": current_occupied,
        "room_assigned": current_assigned,
        "room_available": room.capacity_usage()['available_spaces'],
        "room_unassigned": room.capacity_usage()['available_spaces'],
        "is_assigned": is_assigned,
        "is_fully_assigned": room.capacity_usage()['is_full'],
        "family_slots": room.family_slots,
        "people_spaces": room.people_spaces,
        **room.capacity_usage(),
        "assignment_status": "Assigned" if is_assigned else "Unassigned"
    }), 200

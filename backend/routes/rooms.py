from flask import Blueprint, request, jsonify

from models import (
    db,
    EvacuationCenter,
    EvacuationCenterRoom,
    EvacuationAssignment,
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

    center = EvacuationCenter.query.get(center_id)

    if not center:
        return jsonify({
            "error": "Evacuation center not found"
        }), 404

    rooms = EvacuationCenterRoom.query.filter_by(
        evacuation_center_id=center_id
    ).order_by(
        EvacuationCenterRoom.room_number
    ).all()

    result = []

    for room in rooms:

        room_data = room.to_dict()

        # Make sure coordinates are returned as numbers
        # for Mapbox.
        if room.latitude is not None:
            room_data["latitude"] = float(
                room.latitude
            )

        if room.longitude is not None:
            room_data["longitude"] = float(
                room.longitude
            )

        result.append(room_data)

    return jsonify(result)


# ==========================================
# ADD ROOM
# ==========================================
# Kept for compatibility with existing
# functionality.
#
# The new room-mapping workflow does NOT
# create rooms here.
#
# Rooms imported from Excel already contain:
# - room number
# - capacity
# - family assignments
#
# This endpoint is only retained in case
# another part of the system still uses it.
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

    data = request.get_json() or {}

    room_number = data.get('room_number')
    capacity = data.get('capacity')
    latitude = data.get('latitude')
    longitude = data.get('longitude')

    # ==========================================
    # CHECK ROOM NUMBER
    # ==========================================
    if not room_number:
        return jsonify({
            "error": "Room number is required"
        }), 400

    room_number = str(room_number).strip()

    if not room_number:
        return jsonify({
            "error": "Room number is required"
        }), 400

    # ==========================================
    # CHECK CAPACITY
    # ==========================================
    if capacity is None:
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

    # ==========================================
    # CHECK MAP LOCATION
    # ==========================================
    if latitude is None or longitude is None:
        return jsonify({
            "error": "Room location is required"
        }), 400

    try:
        latitude = float(latitude)
        longitude = float(longitude)
    except (TypeError, ValueError):
        return jsonify({
            "error": "Invalid room coordinates"
        }), 400

    # ==========================================
    # VALIDATE LATITUDE
    # ==========================================
    if latitude < -90 or latitude > 90:
        return jsonify({
            "error": "Latitude must be between -90 and 90"
        }), 400

    # ==========================================
    # VALIDATE LONGITUDE
    # ==========================================
    if longitude < -180 or longitude > 180:
        return jsonify({
            "error": "Longitude must be between -180 and 180"
        }), 400

    # ==========================================
    # CHECK DUPLICATE ROOM
    # ==========================================
    existing_room = EvacuationCenterRoom.query.filter_by(
        evacuation_center_id=center_id,
        room_number=room_number
    ).first()

    if existing_room:
        return jsonify({
            "error": "A room with this room number already exists"
        }), 400

    # ==========================================
    # CREATE ROOM
    # ==========================================
    room = EvacuationCenterRoom(
        evacuation_center_id=center_id,
        room_number=room_number,
        capacity=capacity,
        latitude=latitude,
        longitude=longitude
    )

    db.session.add(room)

    db.session.flush()

    # ==========================================
    # SAVE SYSTEM LOG
    # ==========================================
    user_id = get_jwt_identity()

    db.session.add(
        SystemLog(
            user_id=user_id,
            action=(
                f"Added room {room.room_number} "
                f"to evacuation center: {center.name}"
            )
        )
    )

    db.session.commit()

    room_data = room.to_dict()

    if room.latitude is not None:
        room_data["latitude"] = float(
            room.latitude
        )

    if room.longitude is not None:
        room_data["longitude"] = float(
            room.longitude
        )

    return jsonify({
        "message": "Room added successfully",
        "room": room_data
    }), 201


# ==========================================
# UPDATE ROOM LOCATION
# ==========================================
# This is the endpoint used by the new
# "Map Room" workflow.
#
# It ONLY changes:
# - latitude
# - longitude
#
# It does NOT change:
# - room number
# - room capacity
# - family assignments
# ==========================================
@rooms_bp.route(
    '/api/rooms/<int:room_id>/location',
    methods=['PUT']
)
@role_required('admin', 'lgu_personnel')
def update_room_location(room_id):

    room = EvacuationCenterRoom.query.get(
        room_id
    )

    if not room:
        return jsonify({
            "error": "Room not found"
        }), 404

    data = request.get_json() or {}

    latitude = data.get("latitude")
    longitude = data.get("longitude")

    # ==========================================
    # CHECK LOCATION
    # ==========================================
    if latitude is None or longitude is None:
        return jsonify({
            "error": "Room location is required"
        }), 400

    # ==========================================
    # CONVERT COORDINATES
    # ==========================================
    try:
        latitude = float(latitude)
        longitude = float(longitude)
    except (TypeError, ValueError):
        return jsonify({
            "error": "Invalid room coordinates"
        }), 400

    # ==========================================
    # VALIDATE LATITUDE
    # ==========================================
    if latitude < -90 or latitude > 90:
        return jsonify({
            "error": "Latitude must be between -90 and 90"
        }), 400

    # ==========================================
    # VALIDATE LONGITUDE
    # ==========================================
    if longitude < -180 or longitude > 180:
        return jsonify({
            "error": "Longitude must be between -180 and 180"
        }), 400

    # ==========================================
    # GET EVACUATION CENTER
    # ==========================================
    center = EvacuationCenter.query.get(
        room.evacuation_center_id
    )

    if not center:
        return jsonify({
            "error": "Evacuation center not found"
        }), 404

    # ==========================================
    # SAVE ONLY ROOM LOCATION
    # ==========================================
    room.latitude = latitude
    room.longitude = longitude

    # ==========================================
    # SAVE SYSTEM LOG
    # ==========================================
    user_id = get_jwt_identity()

    db.session.add(
        SystemLog(
            user_id=user_id,
            action=(
                f"Mapped room {room.room_number} "
                f"to evacuation center: {center.name}"
            )
        )
    )

    db.session.commit()

    # ==========================================
    # RETURN UPDATED ROOM
    # ==========================================
    room_data = room.to_dict()

    if room.latitude is not None:
        room_data["latitude"] = float(
            room.latitude
        )

    if room.longitude is not None:
        room_data["longitude"] = float(
            room.longitude
        )

    return jsonify({
        "message": "Room location updated successfully",
        "room": room_data
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

    room = EvacuationCenterRoom.query.get(
        room_id
    )

    if not room:
        return jsonify({
            "error": "Room not found"
        }), 404

    assignments = EvacuationAssignment.query.filter_by(
        room_id=room_id
    ).all()

    families = []

    total_members = 0

    for assignment in assignments:

        resident = Resident.query.get(
            assignment.resident_id
        )

        if not resident:
            continue

        family_members = resident.family_members or 0

        total_members += family_members

        families.append({
            "assignment_id": assignment.id,
            "resident_id": resident.id,
            "household_head_name": resident.household_head_name,
            "barangay": resident.barangay,
            "address": resident.address,
            "contact_number": resident.contact_number,
            "family_members": family_members,
            "vulnerable_members": resident.vulnerable_members,
            "remarks": resident.remarks
        })

    return jsonify({
        "room_id": room.id,
        "room_number": room.room_number,
        "capacity": room.capacity,
        "occupied": total_members,
        "available": max(
            room.capacity - total_members,
            0
        ),
        "families": families
    })


# ==========================================
# GET AVAILABLE FAMILIES
# ==========================================
@rooms_bp.route(
    '/api/rooms/<int:room_id>/available-families',
    methods=['GET']
)
@role_required('admin', 'lgu_personnel')
def get_available_families(room_id):

    room = EvacuationCenterRoom.query.get(
        room_id
    )

    if not room:
        return jsonify({
            "error": "Room not found"
        }), 404

    # Get residents that already have
    # an evacuation room assignment.
    assigned_ids = db.session.query(
        EvacuationAssignment.resident_id
    ).all()

    assigned_ids = [
        row[0]
        for row in assigned_ids
    ]

    query = Resident.query

    if assigned_ids:
        query = query.filter(
            ~Resident.id.in_(assigned_ids)
        )

    residents = query.order_by(
        Resident.barangay,
        Resident.household_head_name
    ).all()

    return jsonify([
        {
            "id": resident.id,
            "household_head_name": resident.household_head_name,
            "barangay": resident.barangay,
            "address": resident.address,
            "contact_number": resident.contact_number,
            "family_members": resident.family_members,
            "vulnerable_members": resident.vulnerable_members,
            "remarks": resident.remarks
        }
        for resident in residents
    ])


# ==========================================
# ASSIGN FAMILIES TO ROOM
# ==========================================
# Kept for existing manual assignment
# functionality.
#
# This is NOT used by the Map Room workflow.
# ==========================================
@rooms_bp.route(
    '/api/rooms/<int:room_id>/assign-families',
    methods=['POST']
)
@role_required('admin', 'lgu_personnel')
def assign_families(room_id):

    room = EvacuationCenterRoom.query.get(
        room_id
    )

    if not room:
        return jsonify({
            "error": "Room not found"
        }), 404

    data = request.get_json() or {}

    resident_ids = data.get(
        'resident_ids',
        []
    )

    if not resident_ids:
        return jsonify({
            "error": "Select at least one family"
        }), 400

    # ==========================================
    # MAKE SURE resident_ids IS A LIST
    # ==========================================
    if not isinstance(resident_ids, list):
        return jsonify({
            "error": "resident_ids must be a list"
        }), 400

    # ==========================================
    # CONVERT IDS TO INTEGER
    # ==========================================
    try:
        resident_ids = [
            int(resident_id)
            for resident_id in resident_ids
        ]
    except (TypeError, ValueError):
        return jsonify({
            "error": "Invalid resident ID"
        }), 400

    # Remove duplicate IDs
    resident_ids = list(set(resident_ids))

    # ==========================================
    # GET SELECTED FAMILIES
    # ==========================================
    residents = Resident.query.filter(
        Resident.id.in_(resident_ids)
    ).all()

    if len(residents) != len(resident_ids):
        return jsonify({
            "error": (
                "One or more selected families "
                "were not found"
            )
        }), 400

    # ==========================================
    # CHECK EXISTING ASSIGNMENTS
    # ==========================================
    already_assigned = EvacuationAssignment.query.filter(
        EvacuationAssignment.resident_id.in_(
            resident_ids
        )
    ).first()

    if already_assigned:
        return jsonify({
            "error": (
                "One or more selected families "
                "are already assigned to a room"
            )
        }), 400

    # ==========================================
    # GET CURRENT ROOM ASSIGNMENTS
    # ==========================================
    current_assignments = (
        EvacuationAssignment.query.filter_by(
            room_id=room.id
        ).all()
    )

    current_resident_ids = [
        assignment.resident_id
        for assignment in current_assignments
    ]

    current_members = 0

    if current_resident_ids:

        current_residents = Resident.query.filter(
            Resident.id.in_(current_resident_ids)
        ).all()

        current_members = sum(
            resident.family_members or 0
            for resident in current_residents
        )

    # ==========================================
    # CALCULATE SELECTED MEMBERS
    # ==========================================
    selected_members = sum(
        resident.family_members or 0
        for resident in residents
    )

    new_total = (
        current_members +
        selected_members
    )

    # ==========================================
    # CHECK ROOM CAPACITY
    # ==========================================
    if new_total > room.capacity:

        available_space = max(
            room.capacity - current_members,
            0
        )

        return jsonify({
            "error": (
                f"Room only has {available_space} "
                f"available spaces. "
                f"The selected families need "
                f"{selected_members} spaces."
            ),
            "capacity": room.capacity,
            "occupied": current_members,
            "available": available_space,
            "selected_members": selected_members
        }), 400

    # ==========================================
    # CREATE ASSIGNMENTS
    # ==========================================
    for resident in residents:

        assignment = EvacuationAssignment(
            resident_id=resident.id,
            room_id=room.id
        )

        db.session.add(assignment)

    db.session.flush()

    # ==========================================
    # SAVE SYSTEM LOG
    # ==========================================
    user_id = get_jwt_identity()

    db.session.add(
        SystemLog(
            user_id=user_id,
            action=(
                f"Assigned {len(residents)} families "
                f"to room {room.room_number}"
            )
        )
    )

    db.session.commit()

    return jsonify({
        "message": "Families assigned successfully",
        "room_id": room.id,
        "families_assigned": len(residents),
        "total_members": selected_members,
        "room_occupied": new_total,
        "room_capacity": room.capacity,
        "room_available": (
            room.capacity - new_total
        )
    }), 201


# ==========================================
# REMOVE FAMILY FROM ROOM
# ==========================================
@rooms_bp.route(
    '/api/rooms/<int:room_id>/families/<int:resident_id>',
    methods=['DELETE']
)
@role_required('admin', 'lgu_personnel')
def remove_family_from_room(
    room_id,
    resident_id
):

    room = EvacuationCenterRoom.query.get(
        room_id
    )

    if not room:
        return jsonify({
            "error": "Room not found"
        }), 404

    assignment = (
        EvacuationAssignment.query.filter_by(
            room_id=room_id,
            resident_id=resident_id
        ).first()
    )

    if not assignment:
        return jsonify({
            "error": "Family is not assigned to this room"
        }), 404

    resident = Resident.query.get(
        resident_id
    )

    household_name = (
        resident.household_head_name
        if resident
        else f"Resident ID {resident_id}"
    )

    room_number = room.room_number

    db.session.delete(assignment)

    # ==========================================
    # SAVE SYSTEM LOG
    # ==========================================
    user_id = get_jwt_identity()

    db.session.add(
        SystemLog(
            user_id=user_id,
            action=(
                f"Removed family {household_name} "
                f"from room {room_number}"
            )
        )
    )

    db.session.commit()

    return jsonify({
        "message": "Family removed from room successfully"
    })
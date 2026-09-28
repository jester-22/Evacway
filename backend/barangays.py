from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from sqlalchemy import func

from models import (
    db,
    Barangay,
    Family,
    Resident,
    EvacuationAssignment,
    EvacuationCenterRoom,
    EvacuationCenter
)

from utils import role_required


barangays_bp = Blueprint('barangays', __name__)


# =========================================================
# GET ALL BARANGAYS
# Counts are computed with 3 grouped queries in total,
# instead of 3 queries per barangay.
# =========================================================
@barangays_bp.route('/api/barangays', methods=['GET'])
@jwt_required()
@role_required('admin', 'lgu_personnel')
def get_barangays():

    barangays = Barangay.query.order_by(
        Barangay.name.asc()
    ).all()

    family_counts = dict(
        db.session.query(
            Family.barangay_id,
            func.count(Family.id)
        )
        .group_by(Family.barangay_id)
        .all()
    )

    resident_counts = dict(
        db.session.query(
            Family.barangay_id,
            func.count(Resident.id)
        )
        .join(Resident, Resident.family_id == Family.id)
        .group_by(Family.barangay_id)
        .all()
    )

    center_counts = dict(
        db.session.query(
            EvacuationCenter.barangay_id,
            func.count(EvacuationCenter.id)
        )
        .group_by(EvacuationCenter.barangay_id)
        .all()
    )

    result = []

    for barangay in barangays:
        result.append({
            "id": barangay.id,
            "name": barangay.name,
            "population": barangay.population,
            "family_count": family_counts.get(barangay.id, 0),
            "resident_count": resident_counts.get(barangay.id, 0),
            "evacuation_center_count": center_counts.get(barangay.id, 0)
        })

    return jsonify(result), 200


# =========================================================
# GET ONE BARANGAY
# Summary + families only (no members, no centers).
# Members load from /api/families/<id> and centers load from
# /api/barangays/<id>/evacuation-centers when they are needed.
# =========================================================
@barangays_bp.route(
    '/api/barangays/<int:barangay_id>',
    methods=['GET']
)
@jwt_required()
@role_required('admin', 'lgu_personnel')
def get_barangay(barangay_id):

    barangay = Barangay.query.get(barangay_id)

    if not barangay:
        return jsonify({
            "error": "Barangay not found"
        }), 404

    families = Family.query.filter(
        Family.barangay_id == barangay.id
    ).order_by(
        Family.family_code.asc()
    ).all()

    resident_count = (
        db.session.query(func.count(Resident.id))
        .join(Family, Resident.family_id == Family.id)
        .filter(Family.barangay_id == barangay.id)
        .scalar()
    ) or 0

    evacuation_center_count = EvacuationCenter.query.filter(
        EvacuationCenter.barangay_id == barangay.id
    ).count()

    return jsonify({
        "id": barangay.id,
        "name": barangay.name,
        "population": barangay.population,
        "family_count": len(families),
        "resident_count": resident_count,
        "evacuation_center_count": evacuation_center_count,

        "families": [
            {
                "id": family.id,
                "family_code": family.family_code,
                "head_name": family.head_name,
                "member_count": family.member_count,
                "contact_number": family.contact_number,
                "evacuation_status": family.evacuation_status
            }
            for family in families
        ]
    }), 200


# =========================================================
# GET EVACUATION CENTERS OF ONE BARANGAY
# Centers -> rooms -> assigned families, loaded in a fixed
# number of queries no matter how many rooms or residents exist.
# =========================================================
@barangays_bp.route(
    '/api/barangays/<int:barangay_id>/evacuation-centers',
    methods=['GET']
)
@jwt_required()
@role_required('admin', 'lgu_personnel')
def get_barangay_evacuation_centers(barangay_id):

    barangay = Barangay.query.get(barangay_id)

    if not barangay:
        return jsonify({
            "error": "Barangay not found"
        }), 404

    # Query 1: centers
    centers = EvacuationCenter.query.filter(
        EvacuationCenter.barangay_id == barangay_id
    ).order_by(
        EvacuationCenter.name.asc()
    ).all()

    center_ids = [center.id for center in centers]

    # Query 2: all rooms of those centers
    rooms = []

    if center_ids:
        rooms = EvacuationCenterRoom.query.filter(
            EvacuationCenterRoom.evacuation_center_id.in_(center_ids)
        ).order_by(
            EvacuationCenterRoom.room_number.asc()
        ).all()

    room_ids = [room.id for room in rooms]

    # Query 3: assigned members per (room, family)
    rows = []

    if room_ids:
        rows = (
            db.session.query(
                EvacuationAssignment.room_id,
                Resident.family_id,
                func.count(EvacuationAssignment.id)
            )
            .join(
                Resident,
                Resident.id == EvacuationAssignment.resident_id
            )
            .filter(EvacuationAssignment.room_id.in_(room_ids))
            .group_by(
                EvacuationAssignment.room_id,
                Resident.family_id
            )
            .all()
        )

    # Query 4: the families that appear in those rooms
    family_ids = {family_id for _, family_id, _ in rows}

    families_by_id = {}

    if family_ids:
        families_by_id = {
            family.id: family
            for family in Family.query.filter(
                Family.id.in_(family_ids)
            ).all()
        }

    room_assigned_count = {}
    room_families = {}

    for room_id, family_id, assigned_members in rows:

        family = families_by_id.get(family_id)

        if not family:
            continue

        room_assigned_count[room_id] = (
            room_assigned_count.get(room_id, 0) + assigned_members
        )

        room_families.setdefault(room_id, []).append({
            "id": family.id,
            "family_code": family.family_code,
            "head_name": family.head_name,
            "member_count": family.member_count,
            "contact_number": family.contact_number,
            "evacuation_status": (
                family.evacuation_status
                or "Not Evacuated"
            ),
            "assigned_members": assigned_members
        })

    for room_id in room_families:
        room_families[room_id].sort(
            key=lambda item: item["family_code"] or ""
        )

    rooms_by_center = {}

    for room in rooms:

        rooms_by_center.setdefault(
            room.evacuation_center_id,
            []
        ).append({
            "id": room.id,
            "room_number": room.room_number,
            "capacity": room.capacity,

            "latitude": (
                float(room.latitude)
                if room.latitude is not None
                else None
            ),

            "longitude": (
                float(room.longitude)
                if room.longitude is not None
                else None
            ),

            "assigned_count": room_assigned_count.get(room.id, 0),
            "families": room_families.get(room.id, [])
        })

    return jsonify([
        {
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
            "rooms": rooms_by_center.get(center.id, [])
        }
        for center in centers
    ]), 200


# =========================================================
# ADD BARANGAY
# =========================================================
@barangays_bp.route('/api/barangays', methods=['POST'])
@jwt_required()
@role_required('admin', 'lgu_personnel')
def add_barangay():

    data = request.get_json()

    if not data:
        return jsonify({
            "error": "No data provided"
        }), 400

    name = data.get("name")

    if not name or not name.strip():
        return jsonify({
            "error": "Barangay name is required"
        }), 400

    name = name.strip()

    existing = Barangay.query.filter(
        func.lower(Barangay.name) == name.lower()
    ).first()

    if existing:
        return jsonify({
            "error": "Barangay already exists"
        }), 409

    population = data.get("population")

    # geom is required by your database.
    # For now, the frontend must provide it when creating
    # a barangay.
    geom = data.get("geom")

    if not geom:
        return jsonify({
            "error": "Barangay boundary is required"
        }), 400

    barangay = Barangay(
        name=name,
        population=population,
        geom=geom
    )

    db.session.add(barangay)
    db.session.commit()

    return jsonify({
        "message": "Barangay added successfully",
        "barangay": {
            "id": barangay.id,
            "name": barangay.name,
            "population": barangay.population,
            "family_count": 0,
            "resident_count": 0,
            "evacuation_center_count": 0
        }
    }), 201


# =========================================================
# GET FAMILIES OF ONE BARANGAY
# Family summaries only. Use /api/families/<id> for members.
# =========================================================
@barangays_bp.route(
    '/api/barangays/<int:barangay_id>/families',
    methods=['GET']
)
@jwt_required()
@role_required('admin', 'lgu_personnel')
def get_barangay_families(barangay_id):

    barangay = Barangay.query.get(barangay_id)

    if not barangay:
        return jsonify({
            "error": "Barangay not found"
        }), 404

    families = Family.query.filter(
        Family.barangay_id == barangay_id
    ).order_by(
        Family.family_code.asc()
    ).all()

    return jsonify([
        {
            "id": family.id,
            "family_code": family.family_code,
            "head_name": family.head_name,
            "member_count": family.member_count,
            "contact_number": family.contact_number,
            "evacuation_status": family.evacuation_status
        }
        for family in families
    ]), 200


# =========================================================
# GET ONE FAMILY
# Includes members and evacuation information.
# Assignments are fetched with one joined query instead of
# 3 queries per resident.
# =========================================================
@barangays_bp.route(
    '/api/families/<int:family_id>',
    methods=['GET']
)
@jwt_required()
@role_required('admin', 'lgu_personnel')
def get_family(family_id):

    family = Family.query.get(family_id)

    if not family:
        return jsonify({
            "error": "Family not found"
        }), 404

    residents = Resident.query.filter(
        Resident.family_id == family.id
    ).order_by(
        Resident.id.asc()
    ).all()

    resident_ids = [resident.id for resident in residents]

    evacuation_by_resident = {}

    if resident_ids:

        rows = (
            db.session.query(
                EvacuationAssignment,
                EvacuationCenterRoom,
                EvacuationCenter
            )
            .join(
                EvacuationCenterRoom,
                EvacuationCenterRoom.id == EvacuationAssignment.room_id
            )
            .join(
                EvacuationCenter,
                EvacuationCenter.id == EvacuationCenterRoom.evacuation_center_id
            )
            .filter(
                EvacuationAssignment.resident_id.in_(resident_ids)
            )
            .order_by(EvacuationAssignment.id.asc())
            .all()
        )

        for assignment, room, center in rows:

            # keep the first assignment per resident,
            # same as the previous .first() behavior
            if assignment.resident_id in evacuation_by_resident:
                continue

            evacuation_by_resident[assignment.resident_id] = {
                "assignment_id": assignment.id,
                "room_id": room.id,
                "room_number": room.room_number,
                "center_id": center.id,
                "center_name": center.name,
                "assigned_at": (
                    assignment.assigned_at.isoformat()
                    if assignment.assigned_at
                    else None
                )
            }

    members = []

    for resident in residents:

        member_data = resident.to_dict()
        member_data["evacuation"] = evacuation_by_resident.get(
            resident.id
        )

        members.append(member_data)

    return jsonify({
        "id": family.id,
        "family_code": family.family_code,
        "head_name": family.head_name,
        "member_count": family.member_count,
        "contact_number": family.contact_number,
        "evacuation_status": family.evacuation_status,

        "barangay": {
            "id": family.barangay.id,
            "name": family.barangay.name
        },

        "members": members
    }), 200
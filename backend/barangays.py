from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from sqlalchemy import func

from models import (
    db,
    Barangay,
    Family,
    Resident,
    EvacuationAssignment,
    EvacuationCenterRoom,
    EvacuationCenter,
    SystemLog,
)

from utils import role_required


barangays_bp = Blueprint('barangays', __name__)


# =========================================================
# GET ALL BARANGAYS
# Counts are computed with grouped queries in total,
# instead of N+1 queries per barangay.
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
            func.count(func.distinct(Family.id))
        )
        .group_by(Family.barangay_id)
        .all()
    )

    resident_counts = dict(
        db.session.query(
            Family.barangay_id,
            func.count(func.distinct(Resident.id))
        )
        .join(Resident, Resident.family_id == Family.id)
        .group_by(Family.barangay_id)
        .all()
    )

    center_counts = dict(
        db.session.query(
            EvacuationCenter.barangay_id,
            func.count(func.distinct(EvacuationCenter.id))
        )
        .filter(EvacuationCenter.is_active.is_(True))
        .group_by(EvacuationCenter.barangay_id)
        .all()
    )

    assigned_family_counts = dict(
        db.session.query(
            Family.barangay_id,
            func.count(func.distinct(Family.id))
        )
        .join(Resident, Resident.family_id == Family.id)
        .join(EvacuationAssignment, EvacuationAssignment.resident_id == Resident.id)
        .group_by(Family.barangay_id)
        .all()
    )

    result = []

    for barangay in barangays:
        f_count = family_counts.get(barangay.id, 0)
        a_count = assigned_family_counts.get(barangay.id, 0)
        r_count = resident_counts.get(barangay.id, 0)
        result.append({
            "id": barangay.id,
            "name": barangay.name,
            "population": barangay.population,
            "household_count": f_count,
            "family_count": f_count,
            "assigned_family_count": a_count,
            "unassigned_family_count": max(f_count - a_count, 0),
            "resident_count": r_count,
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

    barangay = db.session.get(Barangay, barangay_id)

    if not barangay:
        return jsonify({
            "error": "Barangay not found"
        }), 404

    families = Family.query.filter(
        Family.barangay_id == barangay.id
    ).order_by(
        Family.family_code.asc()
    ).all()

    family_count = (
        db.session.query(func.count(func.distinct(Family.id)))
        .filter(Family.barangay_id == barangay.id)
        .scalar()
    ) or 0

    resident_count = (
        db.session.query(func.count(func.distinct(Resident.id)))
        .join(Family, Resident.family_id == Family.id)
        .filter(Family.barangay_id == barangay.id)
        .scalar()
    ) or 0

    evacuation_center_count = EvacuationCenter.query.filter(
        EvacuationCenter.barangay_id == barangay.id,
        EvacuationCenter.is_active.is_(True)
    ).count()

    from routes.families import _family_list_rows
    family_rows = _family_list_rows(families)

    assigned_count = sum(
        1 for f in family_rows
        if (f.get("assigned_members") or 0) > 0 or f.get("current_room_id")
    )

    return jsonify({
        "id": barangay.id,
        "name": barangay.name,
        "population": barangay.population,
        "household_count": family_count,
        "family_count": family_count,
        "assigned_family_count": assigned_count,
        "unassigned_family_count": max(family_count - assigned_count, 0),
        "resident_count": resident_count,
        "evacuation_center_count": evacuation_center_count,
        "families": family_rows
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

    barangay = db.session.get(Barangay, barangay_id)

    if not barangay:
        return jsonify({
            "error": "Barangay not found"
        }), 404

    include_inactive = request.args.get('include_inactive') == 'true'

    # Query 1: centers
    center_query = EvacuationCenter.query.filter(
        EvacuationCenter.barangay_id == barangay_id
    )
    if not include_inactive:
        center_query = center_query.filter(EvacuationCenter.is_active.is_(True))
    centers = center_query.order_by(
        EvacuationCenter.name.asc()
    ).all()

    center_ids = [center.id for center in centers]

    # Query 2: all rooms of those centers
    rooms = []

    if center_ids:
        room_query = EvacuationCenterRoom.query.filter(
            EvacuationCenterRoom.evacuation_center_id.in_(center_ids)
        )
        if not include_inactive:
            room_query = room_query.filter(EvacuationCenterRoom.is_active.is_(True))
        rooms = room_query.order_by(
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
    family_ids = {family_id for _, family_id, _ in rows if family_id is not None}

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
            "family_id": family.id,
            "family_code": family.family_code,
            "head_name": family.head_name,
            "member_count": family.member_count,
            "contact_number": family.contact_number,
            "evacuation_status": "Assigned",
            "assigned_members": assigned_members
        })

    for room_id in room_families:
        room_families[room_id].sort(
            key=lambda item: item["family_code"] or ""
        )

    rooms_by_center = {}

    for room in rooms:
        assigned = room_assigned_count.get(room.id, 0)
        cap = room.capacity or 0
        rooms_by_center.setdefault(
            room.evacuation_center_id,
            []
        ).append({
            "id": room.id,
            "evacuation_center_id": room.evacuation_center_id,
            "room_number": room.room_number,
            "capacity": room.capacity,
            "is_active": room.is_active,

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

            "assigned_count": assigned,
            "occupied": assigned,
            "available": max(cap - assigned, 0),
            "families": room_families.get(room.id, [])
        })

    result = []
    for center in centers:
        c_rooms = rooms_by_center.get(center.id, [])
        active_c_rooms = [r for r in c_rooms if r.get("is_active", True)]
        room_cap_sum = sum((r.get("capacity") or 0) for r in active_c_rooms)
        center_occ = sum((r.get("assigned_count") or 0) for r in c_rooms)
        eff_cap = center.capacity if center.capacity is not None else room_cap_sum
        result.append({
            "id": center.id,
            "name": center.name,
            "barangay": center.barangay or barangay.name,
            "barangay_id": center.barangay_id,
            "capacity": eff_cap,
            "occupied": center_occ,
            "available": max((eff_cap or 0) - center_occ, 0),
            "room_count": len(active_c_rooms),
            "building_material": center.building_material,
            "accessibility_notes": center.accessibility_notes,
            "hazard_exposure_score": center.hazard_exposure_score,
            "contact_number": center.contact_number,
            "is_active": center.is_active,
            "rooms": c_rooms
        })

    return jsonify(result), 200


# =========================================================
# ADD BARANGAY
# =========================================================
@barangays_bp.route('/api/barangays', methods=['POST'])
@jwt_required()
@role_required('admin', 'lgu_personnel')
def add_barangay():

    data = request.get_json(silent=True)

    if not data:
        return jsonify({
            "error": "No data provided"
        }), 400

    name = data.get("name")

    if not name or not str(name).strip():
        return jsonify({
            "error": "Barangay name is required"
        }), 400

    name = str(name).strip()

    existing = Barangay.query.filter(
        func.lower(Barangay.name) == name.lower()
    ).first()

    if existing:
        return jsonify({
            "error": "Barangay already exists"
        }), 409

    raw_pop = data.get("population")
    population = 0
    if raw_pop is not None and str(raw_pop).strip() != "":
        try:
            population = int(raw_pop)
            if population < 0:
                return jsonify({"error": "Population cannot be negative"}), 400
        except (TypeError, ValueError):
            return jsonify({"error": "Population must be a valid integer"}), 400

    geom = data.get("geom") or None

    barangay = Barangay(
        name=name,
        population=population,
        geom=geom
    )

    db.session.add(barangay)
    db.session.add(SystemLog(
        user_id=get_jwt_identity(),
        action=f"Added barangay '{barangay.name}'"
    ))
    db.session.commit()

    return jsonify({
        "message": "Barangay added successfully",
        "id": barangay.id,
        "name": barangay.name,
        "barangay": {
            "id": barangay.id,
            "name": barangay.name,
            "population": barangay.population,
            "family_count": 0,
            "assigned_family_count": 0,
            "unassigned_family_count": 0,
            "resident_count": 0,
            "evacuation_center_count": 0
        }
    }), 201


# =========================================================
# UPDATE BARANGAY
# =========================================================
@barangays_bp.route('/api/barangays/<int:barangay_id>', methods=['PUT'])
@jwt_required()
@role_required('admin', 'lgu_personnel')
def update_barangay(barangay_id):
    barangay = db.session.get(Barangay, barangay_id)
    if not barangay:
        return jsonify({"error": "Barangay not found"}), 404

    data = request.get_json(silent=True) or {}

    if "name" in data:
        new_name = str(data.get("name") or "").strip()
        if not new_name:
            return jsonify({"error": "Barangay name cannot be empty"}), 400
        duplicate = Barangay.query.filter(
            func.lower(Barangay.name) == new_name.lower(),
            Barangay.id != barangay.id
        ).first()
        if duplicate:
            return jsonify({"error": f"Barangay '{new_name}' already exists"}), 409

        old_name = barangay.name
        barangay.name = new_name

        if old_name != new_name:
            family_ids = [f.id for f in Family.query.filter_by(barangay_id=barangay.id).all()]
            if family_ids:
                Resident.query.filter(Resident.family_id.in_(family_ids)).update(
                    {Resident.barangay: new_name},
                    synchronize_session=False
                )
            EvacuationCenter.query.filter_by(barangay_id=barangay.id).update(
                {EvacuationCenter.barangay: new_name},
                synchronize_session=False
            )

    if "population" in data:
        raw_pop = data.get("population")
        if raw_pop is None or str(raw_pop).strip() == "":
            barangay.population = 0
        else:
            try:
                pop_val = int(raw_pop)
                if pop_val < 0:
                    return jsonify({"error": "Population cannot be negative"}), 400
                barangay.population = pop_val
            except (TypeError, ValueError):
                return jsonify({"error": "Population must be a valid integer"}), 400

    db.session.add(SystemLog(
        user_id=get_jwt_identity(),
        action=f"Updated barangay '{barangay.name}' (ID: {barangay.id})"
    ))
    db.session.commit()

    f_count = (
        db.session.query(func.count(func.distinct(Family.id)))
        .filter(Family.barangay_id == barangay.id)
        .scalar()
    ) or 0
    r_count = (
        db.session.query(func.count(func.distinct(Resident.id)))
        .join(Family, Resident.family_id == Family.id)
        .filter(Family.barangay_id == barangay.id)
        .scalar()
    ) or 0
    c_count = EvacuationCenter.query.filter(
        EvacuationCenter.barangay_id == barangay.id,
        EvacuationCenter.is_active.is_(True)
    ).count()

    return jsonify({
        "message": f"Barangay '{barangay.name}' updated successfully.",
        "id": barangay.id,
        "name": barangay.name,
        "barangay": {
            "id": barangay.id,
            "name": barangay.name,
            "population": barangay.population,
            "household_count": f_count,
            "family_count": f_count,
            "resident_count": r_count,
            "evacuation_center_count": c_count
        }
    }), 200


# =========================================================
# DELETE BARANGAY (SAFE CHECK)
# =========================================================
@barangays_bp.route('/api/barangays/<int:barangay_id>', methods=['DELETE'])
@jwt_required()
@role_required('admin', 'lgu_personnel')
def delete_barangay(barangay_id):
    barangay = db.session.get(Barangay, barangay_id)
    if not barangay:
        return jsonify({"error": "Barangay not found"}), 404

    family_count = Family.query.filter_by(barangay_id=barangay.id).count()
    if family_count > 0:
        return jsonify({
            "error": f"Cannot delete '{barangay.name}' because it has {family_count} registered household(s). Remove or transfer households first."
        }), 400

    center_count = EvacuationCenter.query.filter_by(barangay_id=barangay.id).count()
    if center_count > 0:
        return jsonify({
            "error": f"Cannot delete '{barangay.name}' because it has {center_count} linked evacuation center(s)."
        }), 400

    name = barangay.name
    db.session.delete(barangay)
    db.session.add(SystemLog(
        user_id=get_jwt_identity(),
        action=f"Deleted barangay '{name}' (ID: {barangay_id})"
    ))
    db.session.commit()

    return jsonify({
        "message": f"Barangay '{name}' deleted successfully.",
        "id": barangay_id
    }), 200


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

    barangay = db.session.get(Barangay, barangay_id)

    if not barangay:
        return jsonify({
            "error": "Barangay not found"
        }), 404

    families = Family.query.filter(
        Family.barangay_id == barangay_id
    ).order_by(
        Family.family_code.asc()
    ).all()

    from routes.families import _family_list_rows
    return jsonify(_family_list_rows(families)), 200
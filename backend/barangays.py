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
    CenterBarangay,
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
            CenterBarangay.barangay_id,
            func.count(func.distinct(EvacuationCenter.id))
        )
        .join(EvacuationCenter, EvacuationCenter.id == CenterBarangay.center_id)
        .filter(EvacuationCenter.is_active.is_(True))
        .group_by(CenterBarangay.barangay_id)
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

    evacuation_center_count = CenterBarangay.query.join(
        EvacuationCenter,
        EvacuationCenter.id == CenterBarangay.center_id
    ).filter(
        CenterBarangay.barangay_id == barangay.id,
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
        "families": family_rows,
        "evacuation_centers": _barangay_center_rows(barangay, False)
    }), 200


# =========================================================
# GET EVACUATION CENTERS OF ONE BARANGAY
# Centers are linked through center_barangays; only rooms
# allocated to the requested barangay are included.
# =========================================================
def _barangay_center_rows(barangay, include_inactive):
    center_query = (
        EvacuationCenter.query
        .join(CenterBarangay, CenterBarangay.center_id == EvacuationCenter.id)
        .filter(CenterBarangay.barangay_id == barangay.id)
    )
    if not include_inactive:
        center_query = center_query.filter(EvacuationCenter.is_active.is_(True))
    centers = center_query.order_by(EvacuationCenter.name.asc()).all()
    center_ids = [center.id for center in centers]

    rooms = []
    if center_ids:
        room_query = EvacuationCenterRoom.query.filter(
            EvacuationCenterRoom.evacuation_center_id.in_(center_ids)
        )
        if not include_inactive:
            room_query = room_query.filter(EvacuationCenterRoom.is_active.is_(True))
        rooms = room_query.order_by(EvacuationCenterRoom.room_number.asc()).all()

    room_ids = [room.id for room in rooms]
    family_rows = []
    room_occupancy = {}
    center_occupancy = {}
    if center_ids:
        totals = (
            db.session.query(
                EvacuationCenterRoom.evacuation_center_id,
                func.count(EvacuationAssignment.id)
            )
            .outerjoin(
                EvacuationAssignment,
                EvacuationAssignment.room_id == EvacuationCenterRoom.id
            )
            .filter(
                EvacuationCenterRoom.evacuation_center_id.in_(center_ids),
                EvacuationCenterRoom.is_active.is_(True)
            )
            .group_by(EvacuationCenterRoom.evacuation_center_id)
            .all()
        )
        center_occupancy = dict(totals)

    if room_ids:
        room_occupancy = dict(
            db.session.query(
                EvacuationCenterRoom.id,
                func.count(EvacuationAssignment.id)
            )
            .outerjoin(
                EvacuationAssignment,
                EvacuationAssignment.room_id == EvacuationCenterRoom.id
            )
            .filter(EvacuationCenterRoom.id.in_(room_ids))
            .group_by(EvacuationCenterRoom.id)
            .all()
        )
        family_rows = (
            db.session.query(
                EvacuationAssignment.room_id,
                Resident.family_id,
                func.count(EvacuationAssignment.id)
            )
            .join(Resident, Resident.id == EvacuationAssignment.resident_id)
            .filter(
                EvacuationAssignment.room_id.in_(room_ids),
                Resident.family_id.isnot(None)
            )
            .group_by(EvacuationAssignment.room_id, Resident.family_id)
            .all()
        )

    family_ids = {family_id for _, family_id, _ in family_rows}
    families_by_id = {
        family.id: family
        for family in Family.query.filter(Family.id.in_(family_ids)).all()
    } if family_ids else {}
    families_by_room = {}

    for room_id, family_id, assigned_members in family_rows:
        family = families_by_id.get(family_id)
        if family is None:
            continue
        families_by_room.setdefault(room_id, []).append({
            "id": family.id,
            "family_id": family.id,
            "barangay_id": family.barangay_id,
            "family_code": family.family_code,
            "head_name": family.head_name,
            "member_count": family.member_count,
            "contact_number": family.contact_number,
            "evacuation_status": "Assigned",
            "assigned_members": assigned_members
        })

    for values in families_by_room.values():
        values.sort(key=lambda item: item["family_code"] or "")

    rooms_by_center = {}
    for room in rooms:
        occupied = room_occupancy.get(room.id, 0)
        room_families = families_by_room.get(room.id, [])
        room_dict = room.to_dict()
        room_dict.update({
            "barangay_id": barangay.id,
            "barangay": {
                "id": barangay.id,
                "name": barangay.name,
                "color": next(
                    (link.color for link in room.evacuation_center.barangay_links
                     if link.barangay_id == barangay.id),
                    None
                )
            },
            "assigned_count": occupied,
            "occupied": occupied,
            "available": max((room.capacity or 0) - occupied, 0),
            "families": room_families
        })
        rooms_by_center.setdefault(room.evacuation_center_id, []).append(room_dict)

    result = []
    for center in centers:
        center_links = sorted(
            center.barangay_links,
            key=lambda link: (
                link.barangay.name.casefold()
                if link.barangay and link.barangay.name
                else ""
            )
        )
        linked_barangays = [
            {"id": link.barangay.id, "name": link.barangay.name, "color": link.color}
            for link in center_links
            if link.barangay is not None
        ]
        center_rooms = rooms_by_center.get(center.id, [])
        assigned_in_barangay = sum(
            family["assigned_members"]
            for room in center_rooms
            for family in room["families"]
            if family.get("barangay_id") == barangay.id
        )
        assigned_families = {
            family["family_id"]
            for room in center_rooms
            for family in room["families"]
            if family.get("barangay_id") == barangay.id
        }
        total_room_capacity = sum(room["capacity"] or 0 for room in center_rooms)
        occupied_center = center_occupancy.get(center.id, 0)
        total_capacity = center.capacity
        effective_capacity = (
            total_capacity if total_capacity is not None else total_room_capacity
        )
        center_available = max(effective_capacity - occupied_center, 0)
        result.append({
            "id": center.id,
            "name": center.name,
            "barangays": linked_barangays,
            "barangay": ", ".join(item["name"] for item in linked_barangays) or None,
            "shared_with": [
                linked for linked in linked_barangays if linked["id"] != barangay.id
            ],
            "capacity": total_capacity,
            "total_capacity": total_capacity,
            "occupied": occupied_center,
            "total_assigned": occupied_center,
            "available": (
                max(total_capacity - occupied_center, 0)
                if total_capacity is not None
                else center_available
            ),
            "room_count": len(center_rooms),
            "total_rooms": len(center_rooms),
            "barangay_room_count": len(center_rooms),
            "barangay_assigned": assigned_in_barangay,
            "barangay_assigned_families": len(assigned_families),
            "barangay_available": center_available,
            "building_material": center.building_material,
            "accessibility_notes": center.accessibility_notes,
            "hazard_exposure_score": center.hazard_exposure_score,
            "contact_number": center.contact_number,
            "is_active": center.is_active,
            "rooms": center_rooms
        })
    return result


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
    return jsonify(_barangay_center_rows(barangay, include_inactive)), 200


# =========================================================
# ADD BARANGAY
# =========================================================
@barangays_bp.route('/api/barangays', methods=['POST'])
@jwt_required()
@role_required('admin')
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
@role_required('admin')
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
    c_count = CenterBarangay.query.join(
        EvacuationCenter,
        EvacuationCenter.id == CenterBarangay.center_id
    ).filter(
        CenterBarangay.barangay_id == barangay.id,
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
@role_required('admin')
def delete_barangay(barangay_id):
    barangay = db.session.get(Barangay, barangay_id)
    if not barangay:
        return jsonify({"error": "Barangay not found"}), 404

    family_count = Family.query.filter_by(barangay_id=barangay.id).count()
    if family_count > 0:
        return jsonify({
            "error": f"Cannot delete '{barangay.name}' because it has {family_count} registered household(s). Remove or transfer households first."
        }), 400

    center_count = CenterBarangay.query.filter_by(barangay_id=barangay.id).count()
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
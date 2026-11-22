from datetime import date
from flask import Blueprint, jsonify
from flask_jwt_extended import get_jwt_identity
from sqlalchemy import case, func

from models import (
    Barangay,
    CenterType,
    EvacuationAssignment,
    EvacuationCenter,
    EvacuationCenterRoom,
    EvacuationOperation,
    Family,
    NonRegisteredEvacuee,
    Resident,
    User,
    db,
)
from services.non_registered_evacuees import table_ready
from services.rescue_status import count_open_rescue_requests
from utils import role_required


dashboard_bp = Blueprint("dashboard", __name__)


def _sixty_years_ago(today):
    try:
        return date(today.year - 60, today.month, today.day)
    except ValueError:
        # Handle Feb 29 on leap years
        return date(today.year - 60, today.month, 28)


def _resolve_structure_mode(center_type_code, raw_structure_mode):
    mode_val = (raw_structure_mode or "").strip().lower()
    if mode_val in ("open_area", "rooms_only", "buildings_and_rooms"):
        return mode_val
    code_val = (center_type_code or "campus").strip().lower()
    if code_val == "single_venue":
        return "open_area"
    if code_val == "private_property":
        return "rooms_only"
    return "buildings_and_rooms"


@dashboard_bp.route("/api/dashboard/summary", methods=["GET"])
@role_required("admin", "lgu_personnel")
def get_dashboard_summary():
    """
    Lightweight, SQL-aggregated summary for the admin/LGU Dashboard.
    Minimizes network round-trips to remote Postgres (e.g. Supabase) by
    aggregating directly in SQL with CTEs/subqueries instead of downloading
    full family/resident/room/check-in lists.
    """
    today = date.today()
    senior_cutoff = _sixty_years_ago(today)

    # 1. Barangays + household counts + resident demographics in 1 SQL round-trip
    fam_subq = (
        db.session.query(
            Family.barangay_id.label("barangay_id"),
            func.count(Family.id).label("household_count"),
        )
        .group_by(Family.barangay_id)
        .subquery()
    )
    demo_subq = (
        db.session.query(
            Family.barangay_id.label("barangay_id"),
            func.count(Resident.id).label("resident_count"),
            func.coalesce(func.sum(case((Resident.is_pwd.is_(True), 1), else_=0)), 0).label("pwd"),
            func.coalesce(func.sum(case((Resident.is_pregnant.is_(True), 1), else_=0)), 0).label("pregnant"),
            func.coalesce(func.sum(case((Resident.date_of_birth <= senior_cutoff, 1), else_=0)), 0).label("senior"),
            func.coalesce(func.sum(case((Resident.is_solo_parent.is_(True), 1), else_=0)), 0).label("solo_parent"),
            func.coalesce(func.sum(case((Resident.needs_assistance.is_(True), 1), else_=0)), 0).label("needs_assistance"),
        )
        .join(Family, Resident.family_id == Family.id)
        .group_by(Family.barangay_id)
        .subquery()
    )
    brgy_rows = (
        db.session.query(
            Barangay.id,
            Barangay.name,
            Barangay.population,
            func.coalesce(fam_subq.c.household_count, 0),
            func.coalesce(demo_subq.c.resident_count, 0),
            func.coalesce(demo_subq.c.pwd, 0),
            func.coalesce(demo_subq.c.pregnant, 0),
            func.coalesce(demo_subq.c.senior, 0),
            func.coalesce(demo_subq.c.solo_parent, 0),
            func.coalesce(demo_subq.c.needs_assistance, 0),
        )
        .outerjoin(fam_subq, fam_subq.c.barangay_id == Barangay.id)
        .outerjoin(demo_subq, demo_subq.c.barangay_id == Barangay.id)
        .order_by(Barangay.name.asc())
        .all()
    )

    total_households = 0
    total_residents = 0
    barangay_payload = []
    for bid, bname, bpop, hh_cnt, res_cnt, pwd_cnt, preg_cnt, sen_cnt, solo_cnt, assist_cnt in brgy_rows:
        hh_int = int(hh_cnt or 0)
        res_int = int(res_cnt or 0)
        total_households += hh_int
        total_residents += res_int
        barangay_payload.append({
            "id": bid,
            "name": bname,
            "population": bpop,
            "household_count": hh_int,
            "family_count": hh_int,
            "resident_count": res_int,
            "demographics": {
                "households": hh_int,
                "residents": res_int,
                "pwd": int(pwd_cnt or 0),
                "pregnant": int(preg_cnt or 0),
                "senior": int(sen_cnt or 0),
                "soloParent": int(solo_cnt or 0),
                "needsAssistance": int(assist_cnt or 0),
            },
        })

    # 2. Family & resident arrival status (1 SQL round-trip)
    family_arrival_rows = (
        db.session.query(
            Resident.family_id,
            func.count(Resident.id).label("member_count"),
            func.count(EvacuationAssignment.id).label("assigned_count"),
            func.count(EvacuationAssignment.checked_in_at).label("checked_in_count"),
        )
        .outerjoin(EvacuationAssignment, EvacuationAssignment.resident_id == Resident.id)
        .filter(Resident.family_id.isnot(None))
        .group_by(Resident.family_id)
        .having(func.count(EvacuationAssignment.id) > 0)
        .all()
    )

    assigned_families = len(family_arrival_rows)
    unassigned_families = max(0, total_households - assigned_families)
    arrived_families = 0
    partial_families = 0
    pending_arrival_families = 0
    assigned_residents = 0
    arrived_residents = 0

    for _fid, m_count, a_count, chk_count in family_arrival_rows:
        m_int = int(m_count or a_count or 0)
        chk_int = int(chk_count or 0)
        assigned_residents += m_int
        arrived_residents += chk_int
        if chk_int >= m_int and m_int > 0:
            arrived_families += 1
        elif chk_int > 0:
            partial_families += 1
        else:
            pending_arrival_families += 1

    total_arrived_families = arrived_families + partial_families
    pending_residents = max(0, assigned_residents - arrived_residents)

    # 3. Active centers + room capacity + assignment/occupancy totals in 1 SQL round-trip
    room_subq = (
        db.session.query(
            EvacuationCenterRoom.evacuation_center_id.label("center_id"),
            func.count(EvacuationCenterRoom.id).label("room_count"),
            func.coalesce(func.sum(EvacuationCenterRoom.people_spaces), 0).label("room_capacity"),
        )
        .filter(EvacuationCenterRoom.is_active.is_(True))
        .group_by(EvacuationCenterRoom.evacuation_center_id)
        .subquery()
    )
    effective_center_id = func.coalesce(
        EvacuationAssignment.evacuation_center_id,
        EvacuationCenterRoom.evacuation_center_id,
    )
    assign_subq = (
        db.session.query(
            effective_center_id.label("center_id"),
            func.count(EvacuationAssignment.id).label("assigned_count"),
            func.count(EvacuationAssignment.checked_in_at).label("checked_in_count"),
        )
        .outerjoin(EvacuationCenterRoom, EvacuationAssignment.room_id == EvacuationCenterRoom.id)
        .group_by(effective_center_id)
        .subquery()
    )

    center_rows = (
        db.session.query(
            EvacuationCenter.id,
            EvacuationCenter.name,
            EvacuationCenter.capacity,
            CenterType.code,
            CenterType.structure_mode,
            func.coalesce(room_subq.c.room_count, 0),
            func.coalesce(room_subq.c.room_capacity, 0),
            func.coalesce(assign_subq.c.assigned_count, 0),
            func.coalesce(assign_subq.c.checked_in_count, 0),
        )
        .outerjoin(CenterType, EvacuationCenter.center_type_id == CenterType.id)
        .outerjoin(room_subq, room_subq.c.center_id == EvacuationCenter.id)
        .outerjoin(assign_subq, assign_subq.c.center_id == EvacuationCenter.id)
        .filter(EvacuationCenter.is_active.is_(True))
        .order_by(EvacuationCenter.name.asc())
        .all()
    )
    center_ids = [row[0] for row in center_rows]

    # 4. Walk-in non-registered occupancy for active operations (1 SQL round-trip if enabled)
    walkin_by_center = {}
    if center_ids and table_ready():
        walkin_rows = (
            db.session.query(
                EvacuationOperation.id,
                EvacuationOperation.center_id,
                NonRegisteredEvacuee.center_id,
                func.count(NonRegisteredEvacuee.id),
            )
            .outerjoin(
                NonRegisteredEvacuee,
                (NonRegisteredEvacuee.operation_id == EvacuationOperation.id)
                & (NonRegisteredEvacuee.departed_at.is_(None))
                & (NonRegisteredEvacuee.center_id.in_(center_ids)),
            )
            .filter(EvacuationOperation.status == "active")
            .group_by(
                EvacuationOperation.id,
                EvacuationOperation.center_id,
                NonRegisteredEvacuee.center_id,
            )
            .order_by(EvacuationOperation.id.desc())
            .all()
        )
        op_scope = {}
        op_order = []
        walkin_by_op = {}
        for op_id, op_center_id, nre_center_id, cnt in walkin_rows:
            if op_id not in op_scope:
                op_scope[op_id] = op_center_id
                op_order.append(op_id)
            if nre_center_id is not None:
                walkin_by_op[(op_id, nre_center_id)] = int(cnt or 0)
        for cid in center_ids:
            matched_op_id = next(
                (oid for oid in op_order if op_scope[oid] is None or op_scope[oid] == cid),
                None,
            )
            if matched_op_id is not None:
                walkin_by_center[cid] = walkin_by_op.get((matched_op_id, cid), 0)

    centers_payload = []
    total_capacity = 0
    total_occupied_people = 0
    total_assigned_people = 0
    total_rooms = 0

    for cid, cname, raw_cap, ct_code, ct_mode, room_cnt, room_cap, assigned_cnt, checked_cnt in center_rows:
        room_cnt_int = int(room_cnt or 0)
        structure_mode = _resolve_structure_mode(ct_code, ct_mode)
        if structure_mode == "open_area":
            cap = int(raw_cap or 0)
        elif room_cnt_int > 0:
            cap = int(room_cap or 0)
        else:
            cap = int(raw_cap or 0)

        assigned_int = int(assigned_cnt or 0)
        occupied_int = int(checked_cnt or 0) + walkin_by_center.get(cid, 0)

        total_capacity += cap
        total_occupied_people += occupied_int
        total_assigned_people += assigned_int
        total_rooms += room_cnt_int

        occupied_pct = min(100, round((occupied_int / cap) * 100)) if cap > 0 else 0
        assigned_pct = min(100, round((assigned_int / cap) * 100)) if cap > 0 else 0
        arrival_pct = min(100, round((occupied_int / assigned_int) * 100)) if assigned_int > 0 else 0

        centers_payload.append({
            "id": cid,
            "name": cname or "Unnamed center",
            "capacity": cap,
            "checkedInCount": occupied_int,
            "assignedCount": assigned_int,
            "occupiedPeople": occupied_int,
            "assignedPeople": assigned_int,
            "occupiedPercent": occupied_pct,
            "assignedPercent": assigned_pct,
            "arrivalPercent": arrival_pct,
            "total": room_cnt_int,
        })

    # 5. Staff summary (admin only, 1 tiny SQL round-trip)
    total_staff = 0
    active_staff = 0
    caller_id = get_jwt_identity()
    caller = db.session.get(User, int(caller_id)) if caller_id is not None else None
    if caller and caller.role == "admin":
        staff_row = (
            db.session.query(
                func.count(User.id),
                func.coalesce(func.sum(case((User.is_active.is_(True), 1), else_=0)), 0),
            )
            .filter(User.role == "lgu_personnel")
            .first()
        )
        if staff_row:
            total_staff = int(staff_row[0] or 0)
            active_staff = int(staff_row[1] or 0)

    open_rescues = count_open_rescue_requests()

    return jsonify({
        "stats": {
            "barangays": len(barangay_payload),
            "families": total_households,
            "assignedFamilies": assigned_families,
            "unassignedFamilies": unassigned_families,
            "arrivedFamilies": arrived_families,
            "partialFamilies": partial_families,
            "pendingArrivalFamilies": pending_arrival_families,
            "totalArrivedFamilies": total_arrived_families,
            "residents": total_residents,
            "arrivedResidents": arrived_residents,
            "assignedResidents": assigned_residents,
            "pendingResidents": pending_residents,
            "centers": len(centers_payload),
            "totalCapacity": total_capacity,
            "totalOccupiedPeople": total_occupied_people,
            "totalAssignedPeople": total_assigned_people,
            "totalRooms": total_rooms,
            "centerRooms": centers_payload,
            "openRescues": open_rescues,
            "totalStaff": total_staff,
            "activeStaff": active_staff,
        },
        "barangays": barangay_payload,
    }), 200

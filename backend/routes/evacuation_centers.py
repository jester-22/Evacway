import io
import re
from flask import Blueprint, request, jsonify, Response
from sqlalchemy import func, or_
from sqlalchemy.orm import joinedload
from collections import defaultdict
from datetime import date, datetime, time as dtime, timedelta
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from models import (
    Amenity,
    CenterType,
    BuildingMaterial,
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
    EvacuationOperation,
    EvacuationCheckInRecord,
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
    if len(rooms) > 0 and (center.center_type != 'single_venue' or total_room_capacity > (center.capacity or 0)):
        total_capacity = total_room_capacity
        if center.capacity != total_capacity:
            center.capacity = total_capacity
            try:
                db.session.commit()
            except Exception:
                db.session.rollback()
    else:
        total_capacity = center.capacity if center.capacity is not None else total_room_capacity

    effective_capacity = total_capacity
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
        "available": center_available,
        "unassigned": center_unassigned,
        "is_fully_assigned": bool(effective_capacity > 0 and total_assigned >= effective_capacity),
        "building_count": building_count,
        "buildings": [
            {
                "id": b.id,
                "name": b.name,
                "status": b.status or "open",
                "evacuation_center_id": center.id,
                "center_name": center.name,
                "is_mapped": b.geom is not None,
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


# ---------------------------------------------------------
# EVACUATION CENTERS EXCEL TEMPLATE, EXPORT & IMPORT
# ---------------------------------------------------------
CENTER_IMPORT_HEADERS = {
    'name': {'center_name', 'name', 'evacuation_center', 'center', 'shelter_name'},
    'barangays': {'barangays_served', 'barangay', 'barangays', 'barangay_names', 'covered_barangays'},
    'capacity': {'capacity', 'max_capacity', 'target_capacity', 'total_capacity'},
    'center_type': {'center_type', 'type', 'facility_type', 'center_type_code'},
    'building_material': {'building_material', 'material', 'structure_material'},
    'amenities': {'amenities', 'accessibility_features', 'features', 'facilities', 'amenity_names'},
    'contact_number': {'contact_number', 'contact', 'phone', 'telephone', 'mobile_number'},
    'owner_name': {'owner_name', 'owner', 'property_owner'},
    'hazard_score': {'hazard_score', 'hazard_exposure_score', 'hazard_exposure'},
}


@centers_bp.route('/api/evacuation-centers/template', methods=['GET'])
@role_required('admin')
def download_center_template():
    wb = Workbook()
    ws = wb.active
    ws.title = 'Evacuation Centers'

    headers = [
        'Center Name', 'Barangays Served', 'Capacity', 'Center Type',
        'Building Material', 'Amenities', 'Contact Number', 'Owner Name', 'Hazard Exposure Score'
    ]
    ws.append(headers)

    # Sample rows for user guidance
    ws.append([
        'Sogod Central School', 'San Jose, Poblacion', 450, 'Campus',
        'Reinforced Concrete', 'Wheelchair Ramp, PWD Restroom, First Aid Station, Kitchen',
        '09171234567', '', 2.0
    ])
    ws.append([
        'Municipal Multi-Purpose Gymnasium', 'Poblacion', 350, 'Single Venue',
        'Steel Frame', 'Wheelchair Ramp, Emergency Generator, Potable Water, PWD Restroom',
        '09181234567', '', 1.5
    ])
    ws.append([
        'St. Joseph Parish Social Hall', 'San Jose', 120, 'Private Property',
        'Reinforced Concrete', 'Wheelchair Ramp, Kitchen',
        '09191234567', 'Diocese of Maasin', 2.0
    ])

    # Reference sheet with active DB options
    ws_ref = wb.create_sheet('Allowed Values & Guide')
    ws_ref.append(['EVACUATION CENTERS IMPORT REFERENCE GUIDE'])
    ws_ref.append([''])
    ws_ref.append(['INSTRUCTIONS:'])
    ws_ref.append(['1. Center Name: Required unique name of the shelter facility.'])
    ws_ref.append(['2. Barangays Served: Comma-separated names of barangays this center caters to.'])
    ws_ref.append(['3. Capacity: Maximum evacuee capacity (positive integer).'])
    ws_ref.append(['4. Center Type: Enter one from the available Center Types list below.'])
    ws_ref.append(['5. Building Material: (Optional) Enter one from the Building Materials list below.'])
    ws_ref.append(['6. Amenities: (Optional) Comma-separated list of amenities/features from the Amenities list below.'])
    ws_ref.append(['7. Contact Number & Owner: (Optional) Contact information and owner name (especially for private property).'])
    ws_ref.append(['8. Map Placement: After importing, centers will appear as Active and can have their GPS polygon/rooms placed on the Map.'])
    ws_ref.append([''])

    # Section: Active Center Types
    ws_ref.append(['AVAILABLE CENTER TYPES:'])
    ws_ref.append(['Type Name', 'Code', 'Description'])
    for ct in CenterType.query.filter_by(is_active=True).order_by(CenterType.display_order.asc(), CenterType.name.asc()).all():
        ws_ref.append([ct.name, ct.code, ct.description or ''])
    ws_ref.append([''])

    # Section: Active Building Materials
    ws_ref.append(['AVAILABLE BUILDING MATERIALS:'])
    ws_ref.append(['Material Name', 'Code', 'Description'])
    for bm in BuildingMaterial.query.filter_by(is_active=True).order_by(BuildingMaterial.display_order.asc(), BuildingMaterial.name.asc()).all():
        ws_ref.append([bm.name, bm.code, bm.description or ''])
    ws_ref.append([''])

    # Section: Active Amenities
    ws_ref.append(['AVAILABLE AMENITIES & ACCESSIBILITY:'])
    ws_ref.append(['Amenity Name', 'Code', 'Description'])
    for a in Amenity.query.filter_by(is_active=True).order_by(Amenity.display_order.asc(), Amenity.name.asc()).all():
        ws_ref.append([a.name, a.code, a.description or ''])
    ws_ref.append([''])

    # Section: Registered Barangays
    ws_ref.append(['REGISTERED BARANGAYS:'])
    ws_ref.append(['Barangay Name'])
    for b in Barangay.query.order_by(Barangay.name.asc()).all():
        ws_ref.append([b.name])

    output = io.BytesIO()
    wb.save(output)
    return Response(
        output.getvalue(),
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers={'Content-Disposition': 'attachment; filename="evacway-centers-template.xlsx"'},
    )


@centers_bp.route('/api/evacuation-centers/export', methods=['GET'])
@role_required('admin')
def export_evacuation_centers():
    wb = Workbook()
    ws = wb.active
    ws.title = 'Evacuation Centers'

    headers = [
        'Center Name', 'Barangays Served', 'Capacity', 'Center Type',
        'Building Material', 'Amenities', 'Rooms Count', 'Contact Number',
        'Owner Name', 'Hazard Exposure Score', 'Status', 'Mapped on Map'
    ]
    ws.append(headers)

    centers = EvacuationCenter.query.order_by(EvacuationCenter.name.asc()).all()
    for c in centers:
        brgys = ', '.join(cb.barangay.name for cb in c.barangay_links if cb.barangay)
        ct_name = c.center_type_ref.name if c.center_type_ref else (c.center_type or 'Campus')
        bm_name = c.building_material_ref.name if c.building_material_ref else (c.building_material or '—')
        amenities = ', '.join(a.name for a in c.amenities) if hasattr(c, 'amenities') and c.amenities else '—'
        rooms_count = len(c.rooms) if c.rooms else 0
        has_geom = 'Yes' if c.geom is not None else 'No'

        ws.append([
            c.name,
            brgys or 'None',
            c.capacity or 0,
            ct_name,
            bm_name,
            amenities,
            rooms_count,
            c.contact_number or '',
            c.owner_name or '',
            c.hazard_exposure_score if c.hazard_exposure_score is not None else '',
            'Active' if c.is_active else 'Inactive',
            has_geom
        ])

    output = io.BytesIO()
    wb.save(output)
    return Response(
        output.getvalue(),
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers={'Content-Disposition': 'attachment; filename="EvacWay-Evacuation-Centers.xlsx"'},
    )


@centers_bp.route('/api/evacuation-centers/upload', methods=['POST'])
@role_required('admin')
def upload_evacuation_centers():
    if 'file' not in request.files:
        return jsonify({'error': 'Please select an Excel file (.xlsx) to upload.'}), 400

    file_storage = request.files['file']
    filename = file_storage.filename or ''
    if not (filename.lower().endswith('.xlsx') or filename.lower().endswith('.xls')):
        return jsonify({'error': 'Please upload an Excel file (.xlsx).'}), 400

    try:
        wb = load_workbook(io.BytesIO(file_storage.read()), read_only=True, data_only=True)
        ws = wb.active
        rows_iter = ws.iter_rows(values_only=True)
        raw_headers = next(rows_iter, None)
    except Exception as e:
        return jsonify({'error': f'Could not read Excel workbook: {str(e)}'}), 400

    if not raw_headers:
        return jsonify({'error': 'The uploaded Excel file has no headers or data.'}), 400

    col_map = {}
    for idx, h in enumerate(raw_headers):
        if not h:
            continue
        norm_h = re.sub(r'[^a-z0-9]+', '_', str(h).strip().casefold()).strip('_')
        for field, aliases in CENTER_IMPORT_HEADERS.items():
            if norm_h in aliases:
                col_map[field] = idx

    if 'name' not in col_map:
        return jsonify({'error': 'Missing required column: "Center Name"'}), 400

    # Preload reference lookups
    center_types = CenterType.query.all()
    ct_lookup = {}
    default_ct_id = 1
    for ct in center_types:
        ct_lookup[ct.code.casefold()] = ct.id
        ct_lookup[ct.name.casefold()] = ct.id
        if ct.code.casefold() == 'campus':
            default_ct_id = ct.id
    if not default_ct_id and center_types:
        default_ct_id = center_types[0].id

    building_materials = BuildingMaterial.query.all()
    bm_lookup = {}
    for bm in building_materials:
        bm_lookup[bm.code.casefold()] = bm.id
        bm_lookup[bm.name.casefold()] = bm.id

    amenities = Amenity.query.all()
    amenity_lookup = {}
    for a in amenities:
        amenity_lookup[a.code.casefold()] = a
        amenity_lookup[a.name.casefold()] = a

    barangays = Barangay.query.all()
    barangay_lookup = {}
    for b in barangays:
        barangay_lookup[b.name.casefold()] = b.id
        clean_name = re.sub(r'[^a-z0-9]+', '', b.name.casefold())
        barangay_lookup[clean_name] = b.id

    user_id = get_jwt_identity()
    created_count = 0
    updated_count = 0
    errors = []
    warnings = []
    row_num = 1

    idx_name = col_map.get('name')
    idx_brgy = col_map.get('barangays')
    idx_cap = col_map.get('capacity')
    idx_type = col_map.get('center_type')
    idx_mat = col_map.get('building_material')
    idx_amen = col_map.get('amenities')
    idx_phone = col_map.get('contact_number')
    idx_owner = col_map.get('owner_name')
    idx_score = col_map.get('hazard_score')

    for row in rows_iter:
        row_num += 1
        raw_name = str(row[idx_name] or '').strip() if idx_name is not None and idx_name < len(row) else ''
        if not raw_name:
            continue

        # Capacity
        cap_val = 0
        if idx_cap is not None and idx_cap < len(row) and row[idx_cap] is not None:
            try:
                cap_val = max(0, int(float(str(row[idx_cap]).strip())))
            except (ValueError, TypeError):
                cap_val = 0

        # Center Type
        ct_id = default_ct_id
        if idx_type is not None and idx_type < len(row) and row[idx_type]:
            type_str = str(row[idx_type]).strip().casefold()
            if type_str in ct_lookup:
                ct_id = ct_lookup[type_str]
            else:
                warnings.append(f"Row {row_num} ('{raw_name}'): Unknown center type '{row[idx_type]}', defaulted to Campus.")

        # Building Material
        bm_id = None
        if idx_mat is not None and idx_mat < len(row) and row[idx_mat]:
            mat_str = str(row[idx_mat]).strip().casefold()
            if mat_str in bm_lookup:
                bm_id = bm_lookup[mat_str]
            else:
                # Fuzzy partial match
                for key, val in bm_lookup.items():
                    if key in mat_str or mat_str in key:
                        bm_id = val
                        break

        # Contact & Owner
        phone = str(row[idx_phone] or '').strip() if idx_phone is not None and idx_phone < len(row) and row[idx_phone] else None
        owner = str(row[idx_owner] or '').strip() if idx_owner is not None and idx_owner < len(row) and row[idx_owner] else None

        # Hazard Score
        hazard_score = None
        if idx_score is not None and idx_score < len(row) and row[idx_score] is not None:
            try:
                hazard_score = float(str(row[idx_score]).strip())
            except (ValueError, TypeError):
                hazard_score = None

        # Amenities
        matched_amenities = []
        if idx_amen is not None and idx_amen < len(row) and row[idx_amen]:
            raw_amen_tokens = re.split(r'[,;\n]+', str(row[idx_amen]).strip())
            seen_amen_ids = set()
            for token in raw_amen_tokens:
                token_clean = token.strip().casefold()
                if not token_clean:
                    continue
                matched_a = amenity_lookup.get(token_clean)
                if not matched_a:
                    for a_key, a_obj in amenity_lookup.items():
                        if a_key in token_clean or token_clean in a_key:
                            matched_a = a_obj
                            break
                if matched_a and matched_a.id not in seen_amen_ids:
                    matched_amenities.append(matched_a)
                    seen_amen_ids.add(matched_a.id)

        # Barangays Served
        matched_brgy_ids = []
        if idx_brgy is not None and idx_brgy < len(row) and row[idx_brgy]:
            raw_brgy_tokens = re.split(r'[,;\n]+', str(row[idx_brgy]).strip())
            seen_b_ids = set()
            for b_token in raw_brgy_tokens:
                b_clean = b_token.strip().casefold()
                if not b_clean:
                    continue
                b_id = barangay_lookup.get(b_clean)
                if not b_id:
                    b_id = barangay_lookup.get(re.sub(r'[^a-z0-9]+', '', b_clean))
                if b_id and b_id not in seen_b_ids:
                    matched_brgy_ids.append(b_id)
                    seen_b_ids.add(b_id)

        # Check existing center by name
        existing_center = EvacuationCenter.query.filter(
            func.lower(EvacuationCenter.name) == raw_name.casefold()
        ).first()

        if existing_center:
            existing_center.capacity = cap_val
            existing_center.center_type_id = ct_id
            if bm_id is not None:
                existing_center.building_material_id = bm_id
            if phone:
                existing_center.contact_number = phone
            if owner:
                existing_center.owner_name = owner
            if hazard_score is not None:
                existing_center.hazard_exposure_score = hazard_score
            if matched_amenities:
                existing_center.amenities = matched_amenities
            if matched_brgy_ids:
                CenterBarangay.query.filter_by(center_id=existing_center.id).delete()
                for b_id in matched_brgy_ids:
                    db.session.add(CenterBarangay(center_id=existing_center.id, barangay_id=b_id))
            updated_count += 1
        else:
            new_center = EvacuationCenter(
                name=raw_name,
                capacity=cap_val,
                center_type_id=ct_id,
                building_material_id=bm_id,
                contact_number=phone,
                owner_name=owner,
                hazard_exposure_score=hazard_score,
                is_active=True,
                managed_by=user_id,
            )
            if matched_amenities:
                new_center.amenities = matched_amenities
            db.session.add(new_center)
            db.session.flush()

            for b_id in matched_brgy_ids:
                db.session.add(CenterBarangay(center_id=new_center.id, barangay_id=b_id))
            created_count += 1

    db.session.commit()

    if user_id:
        db.session.add(SystemLog(
            user_id=user_id,
            action=f"Imported evacuation centers via Excel: created {created_count}, updated {updated_count}"
        ))
        db.session.commit()

    return jsonify({
        'success': True,
        'created_count': created_count,
        'updated_count': updated_count,
        'total_processed': created_count + updated_count,
        'warnings': warnings,
        'errors': errors,
    }), 200


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

    reset_buildings_count = 0
    if polygon_data is not None:
        try:
            old_poly = None
            if center.geom is not None:
                try:
                    old_poly = to_shape(center.geom)
                except Exception:
                    old_poly = None

            polygon = build_polygon(polygon_data)
            polygon_changed = old_poly is None or not old_poly.equals_exact(polygon, 1e-7)
            center.geom = from_shape(polygon, srid=4326)

            if polygon_changed:
                center_buildings = EvacuationCenterBuilding.query.filter_by(
                    evacuation_center_id=center.id
                ).all()
                for b in center_buildings:
                    if b.geom is not None:
                        b.geom = None
                        reset_buildings_count += 1
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

    feature = center_to_feature(center)
    if reset_buildings_count > 0 and isinstance(feature.get("properties"), dict):
        feature["properties"]["reset_buildings_count"] = reset_buildings_count
    return jsonify(feature)


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


def _compute_center_cutoff_dt(center):
    if not center or not center.evacuation_open_date:
        return None
    cutoff_date = center.evacuation_cutoff_date or center.evacuation_open_date
    cutoff_time_str = center.evacuation_cutoff_time or "18:00"
    try:
        parts = str(cutoff_time_str).strip().split(":")
        hour = int(parts[0])
        minute = int(parts[1]) if len(parts) > 1 else 0
        dt = datetime.combine(cutoff_date, dtime(hour, minute))
        if center.evacuation_extended_until:
            ext = center.evacuation_extended_until
            if getattr(ext, 'tzinfo', None) is not None:
                ext = ext.replace(tzinfo=None)
            if ext > dt:
                dt = ext
        return dt
    except Exception:
        return None


def _validate_center_evacuation_schedule(center, action='check_in'):
    """
    Enforces check-in requirements:
    1) An evacuation opening date must be configured by an administrator.
    2) Center operational status must not be 'closed'.
    Advisory cutoff times do not lock staff out from checking in arriving evacuees.
    """
    if action in ('check_out', 'undo'):
        return True, None

    if not center.evacuation_open_date:
        return False, (
            f"Cannot mark as arrived: No evacuation operation schedule has been set for '{center.name}'. "
            "An administrator must set an opening date before evacuees can be checked in."
        )

    status = (center.evacuation_status or 'standby').lower()
    if status == 'closed':
        return False, f"Cannot mark as arrived: Evacuation center '{center.name}' is currently closed for evacuation operations."

    return True, None


def _sync_operation_check_in_records(center, assignments, resident_ids_present=None, action='check_in', current_user_id=None, method='manual', now=None):
    if not center or not assignments:
        return
    if now is None:
        now = philippines_now()

    try:
        active_op = EvacuationOperation.query.filter(
            or_(EvacuationOperation.center_id == center.id, EvacuationOperation.center_id.is_(None)),
            EvacuationOperation.status == 'active'
        ).first()

        if not active_op and center.evacuation_open_date:
            active_op = EvacuationOperation(
                center_id=center.id,
                event_name=center.evacuation_event_name or "Active Evacuation Operation",
                open_date=center.evacuation_open_date or date.today(),
                open_time=center.evacuation_open_time or "08:00",
                cutoff_date=center.evacuation_cutoff_date or center.evacuation_open_date or date.today(),
                cutoff_time=center.evacuation_cutoff_time or "18:00",
                status="active",
                created_by_user_id=current_user_id
            )
            db.session.add(active_op)
            db.session.flush()

        if not active_op:
            return

        present_set = set(int(rid) for rid in resident_ids_present) if resident_ids_present is not None else None

        for a in assignments:
            is_checked_in = (a.resident_id in present_set) if present_set is not None else (action == 'check_in')
            rec = EvacuationCheckInRecord.query.filter_by(
                operation_id=active_op.id,
                resident_id=a.resident_id
            ).first()

            if is_checked_in:
                if not rec:
                    res = Resident.query.get(a.resident_id)
                    fam_id = res.family_id if res else None
                    new_rec = EvacuationCheckInRecord(
                        operation_id=active_op.id,
                        resident_id=a.resident_id,
                        family_id=fam_id,
                        center_id=center.id,
                        room_id=a.room_id,
                        checked_in_at=a.checked_in_at or now,
                        checked_in_by_user_id=current_user_id,
                        method=method or 'manual',
                        status='checked_in'
                    )
                    db.session.add(new_rec)
                else:
                    rec.status = 'checked_in'
                    rec.checked_in_at = a.checked_in_at or now
                    rec.checked_out_at = None
                    rec.room_id = a.room_id
                    rec.method = method or rec.method
            else:
                if rec:
                    rec.status = 'checked_out'
                    rec.checked_out_at = now
    except Exception as e:
        print(f"Warning: error syncing operation check-in records: {e}")


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

    # Enforce active schedule and valid arrival window
    is_valid, err_msg = _validate_center_evacuation_schedule(center, action=action)
    if not is_valid:
        return jsonify({"error": err_msg}), 400

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
        _sync_operation_check_in_records(center, assignments, resident_ids_present=present_set, action='partial', current_user_id=current_user_id, method=method, now=now)
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
        _sync_operation_check_in_records(center, assignments, resident_ids_present=None, action='check_in', current_user_id=current_user_id, method=method, now=now)
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
        _sync_operation_check_in_records(center, assignments, resident_ids_present=None, action='check_out', current_user_id=current_user_id, method=method, now=now)
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

    is_valid, err_msg = _validate_center_evacuation_schedule(center, action='check_in')
    if not is_valid:
        return jsonify({"success": False, "message": err_msg, "error": err_msg}), 400

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
        _sync_operation_check_in_records(center, assignments, resident_ids_present=None, action='check_in', current_user_id=None, method='geofence', now=now)
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


def _get_checkin_dataset(center_id_param=None, search_query='', status_filter='all', date_filter=None, operation_id_param=None):
    active_centers = EvacuationCenter.query.filter_by(is_active=True).order_by(EvacuationCenter.name.asc()).all()
    operations = EvacuationOperation.query.order_by(EvacuationOperation.open_date.desc(), EvacuationOperation.id.desc()).all()

    target_op = None
    is_historical = False

    if operation_id_param and str(operation_id_param).strip().lower() not in ('all', 'active', 'none', ''):
        try:
            op_id_int = int(operation_id_param)
            target_op = next((o for o in operations if o.id == op_id_int), None)
            if not target_op:
                target_op = EvacuationOperation.query.get(op_id_int)
        except (ValueError, TypeError):
            pass

    if not target_op:
        target_op = next((o for o in operations if o.status == 'active'), None)

    if target_op and target_op.status == 'concluded':
        is_historical = True

    center_assigned_totals = dict(
        db.session.query(
            EvacuationAssignment.evacuation_center_id,
            func.count(EvacuationAssignment.id)
        ).group_by(EvacuationAssignment.evacuation_center_id).all()
    )

    if is_historical and target_op:
        hist_checked_by_center = dict(
            db.session.query(
                EvacuationCheckInRecord.center_id,
                func.count(EvacuationCheckInRecord.id)
            ).filter(
                EvacuationCheckInRecord.operation_id == target_op.id,
                EvacuationCheckInRecord.status == 'checked_in'
            ).group_by(EvacuationCheckInRecord.center_id).all()
        )
        center_checked_totals = hist_checked_by_center
    else:
        center_checked_totals = dict(
            db.session.query(
                EvacuationAssignment.evacuation_center_id,
                func.count(EvacuationAssignment.id)
            ).filter(EvacuationAssignment.checked_in_at.isnot(None))
            .group_by(EvacuationAssignment.evacuation_center_id).all()
        )

    now = philippines_now()
    centers_summary = []
    for c in active_centers:
        tot_assigned = center_assigned_totals.get(c.id, 0)
        tot_checked = center_checked_totals.get(c.id, 0)
        cap = int(c.capacity or 0)
        if is_historical and target_op:
            centers_summary.append({
                "id": c.id,
                "name": c.name,
                "center_type": c.center_type or "campus",
                "capacity": cap,
                "assigned": tot_assigned,
                "checked_in": tot_checked,
                "space_left": max(cap - tot_assigned, 0),
                "evacuation_open_date": target_op.open_date.isoformat() if target_op.open_date else None,
                "evacuation_open_time": target_op.open_time or "08:00",
                "evacuation_cutoff_date": target_op.cutoff_date.isoformat() if target_op.cutoff_date else (target_op.open_date.isoformat() if target_op.open_date else None),
                "evacuation_cutoff_time": target_op.cutoff_time or "18:00",
                "evacuation_extension_count": int(target_op.extension_count or 0),
                "evacuation_extended_until": target_op.extended_until.isoformat() if target_op.extended_until else None,
                "evacuation_status": "concluded",
                "evacuation_event_name": target_op.event_name or "",
                "is_schedule_set": True,
                "is_expired": True,
                "can_check_in": False,
                "is_historical": True,
            })
        else:
            cutoff_dt = _compute_center_cutoff_dt(c)
            is_expired = (now > cutoff_dt) if cutoff_dt else False
            can_check_in = bool(c.evacuation_open_date) and (c.evacuation_status or 'standby') != 'closed'
            centers_summary.append({
                "id": c.id,
                "name": c.name,
                "center_type": c.center_type or "campus",
                "capacity": cap,
                "assigned": tot_assigned,
                "checked_in": tot_checked,
                "space_left": max(cap - tot_assigned, 0),
                "evacuation_open_date": c.evacuation_open_date.isoformat() if c.evacuation_open_date else None,
                "evacuation_open_time": c.evacuation_open_time or "08:00",
                "evacuation_cutoff_date": c.evacuation_cutoff_date.isoformat() if c.evacuation_cutoff_date else (c.evacuation_open_date.isoformat() if c.evacuation_open_date else None),
                "evacuation_cutoff_time": c.evacuation_cutoff_time or "18:00",
                "evacuation_extension_count": int(c.evacuation_extension_count or 0),
                "evacuation_extended_until": c.evacuation_extended_until.isoformat() if c.evacuation_extended_until else None,
                "evacuation_status": c.evacuation_status or "standby",
                "evacuation_event_name": c.evacuation_event_name or "",
                "is_schedule_set": bool(c.evacuation_open_date),
                "is_expired": is_expired,
                "can_check_in": can_check_in,
                "is_historical": False,
            })

    if is_historical and target_op:
        active_sched = {
            "operation_id": target_op.id,
            "center_id": target_op.center_id or "all",
            "center_name": target_op.center.name if target_op.center else "All Evacuation Centers",
            "evacuation_open_date": target_op.open_date.isoformat() if target_op.open_date else None,
            "evacuation_open_time": target_op.open_time or "08:00",
            "evacuation_cutoff_date": target_op.cutoff_date.isoformat() if target_op.cutoff_date else (target_op.open_date.isoformat() if target_op.open_date else None),
            "evacuation_cutoff_time": target_op.cutoff_time or "18:00",
            "evacuation_extension_count": int(target_op.extension_count or 0),
            "evacuation_extended_until": target_op.extended_until.isoformat() if target_op.extended_until else None,
            "evacuation_status": "concluded",
            "evacuation_event_name": target_op.event_name or "Historical Evacuation Operation",
            "is_schedule_set": True,
            "is_expired": True,
            "remaining_seconds": 0,
            "can_check_in": False,
            "is_historical": True,
            "concluded_at": target_op.concluded_at.isoformat() if target_op.concluded_at else None,
        }
    else:
        target_c = None
        if center_id_param and str(center_id_param).strip() != "all":
            try:
                cid = int(center_id_param)
                target_c = next((c for c in active_centers if c.id == cid), None)
            except (ValueError, TypeError):
                pass

        if not target_c:
            open_c = next((c for c in active_centers if c.evacuation_status == "open"), None)
            target_c = open_c or next((c for c in active_centers if c.evacuation_open_date), None)

        if target_c:
            cutoff_dt = _compute_center_cutoff_dt(target_c)
            is_expired = (now > cutoff_dt) if cutoff_dt else False
            remaining_secs = int((cutoff_dt - now).total_seconds()) if cutoff_dt else None
            can_check_in = bool(target_c.evacuation_open_date) and (target_c.evacuation_status or 'standby') != 'closed'

            active_sched = {
                "operation_id": target_op.id if target_op else None,
                "center_id": target_c.id if (center_id_param and str(center_id_param).strip() != "all") else "all",
                "center_name": target_c.name if (center_id_param and str(center_id_param).strip() != "all") else "All Evacuation Centers",
                "evacuation_open_date": target_c.evacuation_open_date.isoformat() if target_c.evacuation_open_date else None,
                "evacuation_open_time": target_c.evacuation_open_time or "08:00",
                "evacuation_cutoff_date": target_c.evacuation_cutoff_date.isoformat() if target_c.evacuation_cutoff_date else (target_c.evacuation_open_date.isoformat() if target_c.evacuation_open_date else None),
                "evacuation_cutoff_time": target_c.evacuation_cutoff_time or "18:00",
                "evacuation_extension_count": int(target_c.evacuation_extension_count or 0),
                "evacuation_extended_until": target_c.evacuation_extended_until.isoformat() if target_c.evacuation_extended_until else None,
                "evacuation_status": target_c.evacuation_status or "standby",
                "evacuation_event_name": target_c.evacuation_event_name or "",
                "is_schedule_set": bool(target_c.evacuation_open_date),
                "is_expired": is_expired,
                "remaining_seconds": remaining_secs,
                "can_check_in": can_check_in,
                "is_historical": False,
            }
        else:
            active_sched = {
                "operation_id": target_op.id if target_op else None,
                "center_id": "all",
                "center_name": "All Evacuation Centers",
                "evacuation_open_date": None,
                "evacuation_open_time": "08:00",
                "evacuation_cutoff_date": None,
                "evacuation_cutoff_time": "18:00",
                "evacuation_extension_count": 0,
                "evacuation_extended_until": None,
                "evacuation_status": "standby",
                "evacuation_event_name": "",
                "is_schedule_set": False,
                "is_expired": False,
                "remaining_seconds": None,
                "can_check_in": False,
                "is_historical": False,
            }

    base_filter = []
    if center_id_param and str(center_id_param).strip() != "all":
        try:
            cid = int(center_id_param)
            base_filter.append(or_(
                EvacuationAssignment.evacuation_center_id == cid,
                EvacuationCenterRoom.evacuation_center_id == cid
            ))
        except (ValueError, TypeError):
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

        assignment_checkin_map = {}
        if is_historical and target_op:
            hist_records = EvacuationCheckInRecord.query.filter_by(
                operation_id=target_op.id
            ).all()
            for hr in hist_records:
                if hr.status == 'checked_in':
                    assignment_checkin_map[hr.resident_id] = hr.checked_in_at
        else:
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
                "checked_in_dt": chk_time,
                "special_needs": flags,
            })

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

        if chk_count >= m_count and m_count > 0:
            checkin_state = "full"
            tot_fully_checked_in += 1
        elif chk_count > 0:
            checkin_state = "partial"
            tot_partially_checked_in += 1
        else:
            checkin_state = "none"
            tot_pending += 1

        if status_filter == 'checked_in' and checkin_state != 'full':
            continue
        if status_filter == 'partial' and checkin_state != 'partial':
            continue
        if status_filter == 'pending' and checkin_state != 'none':
            continue

        if date_filter:
            has_date_match = False
            for m in m_list:
                dt_val = m.get("checked_in_dt")
                if dt_val and dt_val.strftime("%Y-%m-%d") == date_filter:
                    has_date_match = True
                    break

            center_date_match = False
            if r.center_id:
                c_obj = next((c for c in active_centers if c.id == r.center_id), None)
                if c_obj and c_obj.evacuation_open_date and c_obj.evacuation_open_date.isoformat() == date_filter:
                    center_date_match = True

            if status_filter == 'checked_in':
                if not has_date_match:
                    continue
            elif status_filter == 'pending':
                if not center_date_match or checkin_state != 'none':
                    continue
            else:
                if not has_date_match and not center_date_match:
                    continue

        if search_query:
            member_names = " ".join(m["name"] for m in m_list).lower()
            target_str = f"{r.head_name or ''} {r.family_code or ''} {r.contact_number or ''} {r.room_number or ''} {r.barangay_name or ''} {r.center_name or ''} {member_names}".lower()
            if search_query not in target_str:
                continue

        for m in m_list:
            m_dt = m.get("checked_in_dt")
            m["checked_in_time_formatted"] = m_dt.strftime("%I:%M %p") if m_dt else None
            m["checked_in_date_formatted"] = m_dt.strftime("%b %d, %Y") if m_dt else None
            m["checked_in_full_formatted"] = m_dt.strftime("%b %d, %Y %I:%M %p") if m_dt else None

        m_checked_times = [m["checked_in_dt"] for m in m_list if m.get("checked_in_dt")]
        latest_dt = max(m_checked_times) if m_checked_times else (r.latest_checked_in_at if not is_historical else None)
        latest_formatted = latest_dt.strftime("%b %d, %Y %I:%M %p") if latest_dt else None
        latest_time_only = latest_dt.strftime("%I:%M %p") if latest_dt else None
        latest_date_only = latest_dt.strftime("%b %d, %Y") if latest_dt else None

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
            "checkin_state": checkin_state,
            "checked_in_at": latest_at,
            "checked_in_at_formatted": latest_formatted,
            "checked_in_time_only": latest_time_only,
            "checked_in_date_only": latest_date_only,
            "checkin_status": (
                "Fully arrived" if checkin_state == "full"
                else (f"{chk_count} of {m_count} arrived" if checkin_state == "partial" else "Pending arrival")
            ),
            "special_needs": special_needs_map.get(r.family_id, []),
            "members": m_list,
        })

    summary = {
        "total_assigned": tot_assigned,
        "total_checked_in": tot_fully_checked_in,
        "total_partial": tot_partially_checked_in,
        "total_pending": tot_pending,
        "total_residents_assigned": sum(e.get("assigned_members", 0) for e in evacuees),
        "total_residents_checked_in": sum(e.get("checked_in_members", 0) for e in evacuees),
        "occupancy_rate": round(((tot_fully_checked_in + tot_partially_checked_in) / tot_assigned * 100), 1) if tot_assigned > 0 else 0
    }

    return centers_summary, evacuees, summary, active_sched, active_centers, operations, is_historical


@centers_bp.route('/api/evacuation-centers/check-in-list', methods=['GET'])
@role_required('admin', 'lgu_personnel')
def get_check_in_list():
    center_id_param = request.args.get('center_id')
    search_query = request.args.get('q', '').strip().lower()
    status_filter = request.args.get('status', 'all')
    date_filter = request.args.get('date')
    operation_id_param = request.args.get('operation_id')

    centers_summary, evacuees, summary, active_sched, _, operations, is_historical = _get_checkin_dataset(
        center_id_param=center_id_param,
        search_query=search_query,
        status_filter=status_filter,
        date_filter=date_filter,
        operation_id_param=operation_id_param
    )

    return jsonify({
        "centers": centers_summary,
        "evacuees": evacuees,
        "evacuation_schedule": active_sched,
        "summary": summary,
        "operations": [op.to_dict() for op in operations],
        "is_historical": is_historical
    }), 200


@centers_bp.route('/api/evacuation-operations', methods=['GET'])
@role_required('admin', 'lgu_personnel')
def get_evacuation_operations():
    operations = EvacuationOperation.query.order_by(
        EvacuationOperation.open_date.desc(),
        EvacuationOperation.id.desc()
    ).all()
    return jsonify({
        "operations": [op.to_dict() for op in operations]
    }), 200


@centers_bp.route('/api/evacuation-centers/schedule', methods=['GET', 'POST', 'PUT'])
@role_required('admin', 'lgu_personnel')
def manage_evacuation_schedule():
    active_centers = EvacuationCenter.query.filter_by(is_active=True).order_by(EvacuationCenter.name.asc()).all()

    if request.method == 'GET':
        center_id_param = request.args.get('center_id')
        target_center = None
        if center_id_param and str(center_id_param).strip() != 'all':
            try:
                target_center = next((c for c in active_centers if c.id == int(center_id_param)), None)
            except (ValueError, TypeError):
                pass

        open_c = next((c for c in active_centers if c.evacuation_status == "open"), None)
        active_c = target_center or open_c or next((c for c in active_centers if c.evacuation_open_date), None)

        now = philippines_now()
        cutoff_dt = _compute_center_cutoff_dt(active_c) if active_c else None
        is_expired = (now > cutoff_dt) if cutoff_dt else False
        can_check_in = bool(active_c and active_c.evacuation_open_date and active_c.evacuation_status != 'closed')

        return jsonify({
            "schedule": {
                "center_id": target_center.id if target_center else "all",
                "center_name": target_center.name if target_center else ("All Evacuation Centers" if open_c else "All Centers"),
                "evacuation_open_date": active_c.evacuation_open_date.isoformat() if (active_c and active_c.evacuation_open_date) else None,
                "evacuation_open_time": active_c.evacuation_open_time or "08:00" if active_c else "08:00",
                "evacuation_cutoff_date": active_c.evacuation_cutoff_date.isoformat() if (active_c and active_c.evacuation_cutoff_date) else (active_c.evacuation_open_date.isoformat() if (active_c and active_c.evacuation_open_date) else None),
                "evacuation_cutoff_time": active_c.evacuation_cutoff_time or "18:00" if active_c else "18:00",
                "evacuation_extension_count": int(active_c.evacuation_extension_count or 0) if active_c else 0,
                "evacuation_extended_until": active_c.evacuation_extended_until.isoformat() if (active_c and active_c.evacuation_extended_until) else None,
                "evacuation_status": active_c.evacuation_status if active_c else "standby",
                "evacuation_event_name": active_c.evacuation_event_name if active_c else "",
                "is_expired": is_expired,
                "can_check_in": can_check_in,
            },
            "centers": [
                {
                    "id": c.id,
                    "name": c.name,
                    "evacuation_open_date": c.evacuation_open_date.isoformat() if c.evacuation_open_date else None,
                    "evacuation_open_time": c.evacuation_open_time or "08:00",
                    "evacuation_cutoff_date": c.evacuation_cutoff_date.isoformat() if c.evacuation_cutoff_date else None,
                    "evacuation_cutoff_time": c.evacuation_cutoff_time or "18:00",
                    "evacuation_extension_count": int(c.evacuation_extension_count or 0),
                    "evacuation_extended_until": c.evacuation_extended_until.isoformat() if c.evacuation_extended_until else None,
                    "evacuation_status": c.evacuation_status or "standby",
                    "evacuation_event_name": c.evacuation_event_name or "",
                    "is_expired": (now > _compute_center_cutoff_dt(c)) if _compute_center_cutoff_dt(c) else False,
                    "can_check_in": bool(c.evacuation_open_date and c.evacuation_status != 'closed'),
                }
                for c in active_centers
            ]
        }), 200

    # Write operations require admin role
    identity = get_jwt_identity()
    user_role = identity.get('role') if isinstance(identity, dict) else None
    current_uid = identity.get('user_id') if isinstance(identity, dict) else (int(identity) if str(identity).isdigit() else None)
    if not user_role:
        from models import User
        u = User.query.get(current_uid)
        if u:
            user_role = u.role
    if user_role != 'admin':
        return jsonify({"error": "Admin role required to configure evacuation opening date."}), 403

    data = request.get_json() or {}
    center_id_target = data.get('center_id', 'all')
    raw_date = data.get('evacuation_open_date')
    raw_open_time = (data.get('evacuation_open_time') or '08:00').strip()
    raw_cutoff_date = data.get('evacuation_cutoff_date')
    raw_cutoff_time = (data.get('evacuation_cutoff_time') or '18:00').strip()
    evac_status = (data.get('evacuation_status') or 'standby').strip().lower()
    event_name = (data.get('evacuation_event_name') or '').strip()

    parsed_date = None
    if raw_date:
        try:
            if isinstance(raw_date, str):
                parsed_date = date.fromisoformat(raw_date.strip())
            elif isinstance(raw_date, date):
                parsed_date = raw_date
        except Exception as e:
            return jsonify({"error": f"Invalid opening date format (expected YYYY-MM-DD): {e}"}), 400

    parsed_cutoff_date = None
    if raw_cutoff_date:
        try:
            if isinstance(raw_cutoff_date, str):
                parsed_cutoff_date = date.fromisoformat(raw_cutoff_date.strip())
            elif isinstance(raw_cutoff_date, date):
                parsed_cutoff_date = raw_cutoff_date
        except Exception as e:
            return jsonify({"error": f"Invalid cutoff date format (expected YYYY-MM-DD): {e}"}), 400
    else:
        parsed_cutoff_date = parsed_date

    if evac_status not in ['open', 'standby', 'closed']:
        evac_status = 'standby'

    updated_count = 0
    targets = []
    if str(center_id_target).strip() == 'all':
        targets = active_centers
    else:
        try:
            cid = int(center_id_target)
            target = EvacuationCenter.query.get(cid)
            if not target:
                return jsonify({"error": f"Evacuation center #{cid} not found."}), 404
            targets = [target]
        except (ValueError, TypeError):
            return jsonify({"error": "Invalid center_id."}), 400

    for c in targets:
        c.evacuation_open_date = parsed_date
        c.evacuation_open_time = raw_open_time
        c.evacuation_cutoff_date = parsed_cutoff_date
        c.evacuation_cutoff_time = raw_cutoff_time
        c.evacuation_status = evac_status
        if event_name or 'evacuation_event_name' in data:
            c.evacuation_event_name = event_name
        # Reset extension markers on new schedule definition
        c.evacuation_extension_count = 0
        c.evacuation_extended_until = None
        updated_count += 1

    if current_uid:
        log_center = "all centers" if str(center_id_target).strip() == 'all' else targets[0].name
        db.session.add(SystemLog(
            user_id=current_uid,
            action=f"Set evacuation schedule for {log_center}: {parsed_date} {raw_open_time} - {parsed_cutoff_date} {raw_cutoff_time} ({evac_status})",
            timestamp=philippines_now()
        ))

    # Synchronize active evacuation operation
    start_new_op = bool(data.get('start_new_operation', False))
    if start_new_op:
        existing_actives = EvacuationOperation.query.filter_by(status='active').all()
        for old_op in existing_actives:
            old_op.status = 'concluded'
            old_op.concluded_at = philippines_now()
        # Reset live assignment check-ins so new disaster starts with a clean roster
        EvacuationAssignment.query.update({EvacuationAssignment.checked_in_at: None})
        target_op = EvacuationOperation(
            center_id=int(center_id_target) if str(center_id_target).strip() != 'all' else None,
            event_name=event_name or 'Evacuation Operation',
            open_date=parsed_date or date.today(),
            open_time=raw_open_time,
            cutoff_date=parsed_cutoff_date or parsed_date or date.today(),
            cutoff_time=raw_cutoff_time,
            status=evac_status if evac_status != 'closed' else 'standby',
            created_by_user_id=current_uid
        )
        db.session.add(target_op)
    elif parsed_date:
        existing_actives = EvacuationOperation.query.filter_by(status='active').all()
        for old_op in existing_actives:
            if old_op.open_date != parsed_date:
                old_op.status = 'concluded'
                old_op.concluded_at = philippines_now()

        target_op = EvacuationOperation.query.filter_by(open_date=parsed_date, status='active').first()
        if not target_op:
            target_op = EvacuationOperation(
                center_id=int(center_id_target) if str(center_id_target).strip() != 'all' else None,
                event_name=event_name or 'Evacuation Operation',
                open_date=parsed_date,
                open_time=raw_open_time,
                cutoff_date=parsed_cutoff_date,
                cutoff_time=raw_cutoff_time,
                status=evac_status if evac_status != 'closed' else 'standby',
                created_by_user_id=current_uid
            )
            db.session.add(target_op)
        else:
            if event_name:
                target_op.event_name = event_name
            target_op.open_time = raw_open_time
            target_op.cutoff_date = parsed_cutoff_date
            target_op.cutoff_time = raw_cutoff_time
            if evac_status == 'closed':
                target_op.status = 'concluded'
                target_op.concluded_at = philippines_now()
            else:
                target_op.status = evac_status

    db.session.commit()

    return jsonify({
        "message": f"Evacuation schedule saved for {updated_count} center(s).",
        "schedule": {
            "center_id": center_id_target,
            "evacuation_open_date": parsed_date.isoformat() if parsed_date else None,
            "evacuation_open_time": raw_open_time,
            "evacuation_cutoff_date": parsed_cutoff_date.isoformat() if parsed_cutoff_date else None,
            "evacuation_cutoff_time": raw_cutoff_time,
            "evacuation_status": evac_status,
            "evacuation_event_name": event_name,
            "evacuation_extension_count": 0,
        }
    }), 200


@centers_bp.route('/api/evacuation-centers/schedule/extend', methods=['POST'])
@role_required('admin')
def extend_evacuation_schedule():
    """
    Extends the evacuee arrival deadline for a center or all centers.
    Accepts:
      center_id: 'all' or integer ID
      extend_hours: integer hours to add (e.g., 2, 4, 8, 24)
      custom_cutoff_date: optional 'YYYY-MM-DD'
      custom_cutoff_time: optional 'HH:MM'
    """
    identity = get_jwt_identity()
    current_uid = identity.get('user_id') if isinstance(identity, dict) else (int(identity) if str(identity).isdigit() else None)

    data = request.get_json() or {}
    center_id_target = data.get('center_id', 'all')
    extend_hours = data.get('extend_hours')
    custom_cutoff_date = data.get('custom_cutoff_date')
    custom_cutoff_time = data.get('custom_cutoff_time')

    active_centers = EvacuationCenter.query.filter_by(is_active=True).all()
    targets = []
    if str(center_id_target).strip() == 'all':
        targets = [c for c in active_centers if c.evacuation_open_date]
        if not targets:
            return jsonify({"error": "No centers have an active schedule to extend."}), 400
    else:
        try:
            cid = int(center_id_target)
            target = EvacuationCenter.query.get(cid)
            if not target:
                return jsonify({"error": f"Evacuation center #{cid} not found."}), 404
            if not target.evacuation_open_date:
                return jsonify({"error": f"Cannot extend arrival deadline: No schedule is set for '{target.name}'."}), 400
            targets = [target]
        except (ValueError, TypeError):
            return jsonify({"error": "Invalid center_id."}), 400

    now = philippines_now()
    extended_count = 0
    new_deadline_formatted = ""

    for c in targets:
        curr_cutoff = _compute_center_cutoff_dt(c)
        base_dt = curr_cutoff if (curr_cutoff and curr_cutoff > now) else now

        if extend_hours:
            try:
                hrs = float(extend_hours)
                new_dt = base_dt + timedelta(hours=hrs)
            except (ValueError, TypeError):
                return jsonify({"error": "Invalid extend_hours value."}), 400
        elif custom_cutoff_date:
            try:
                c_date = date.fromisoformat(str(custom_cutoff_date).strip())
                time_str = (custom_cutoff_time or "18:00").strip()
                t_parts = time_str.split(":")
                new_dt = datetime.combine(c_date, dtime(int(t_parts[0]), int(t_parts[1]) if len(t_parts) > 1 else 0))
            except Exception as e:
                return jsonify({"error": f"Invalid custom date/time: {e}"}), 400
        else:
            new_dt = base_dt + timedelta(hours=2)

        c.evacuation_cutoff_date = new_dt.date()
        c.evacuation_cutoff_time = new_dt.strftime("%H:%M")
        c.evacuation_extended_until = new_dt
        c.evacuation_extension_count = (c.evacuation_extension_count or 0) + 1
        c.evacuation_status = "open"  # Re-open facility if it had lapsed
        extended_count += 1
        new_deadline_formatted = new_dt.strftime("%b %d, %Y at %I:%M %p")

    if current_uid:
        log_label = "all centers" if str(center_id_target).strip() == 'all' else targets[0].name
        hrs_label = f"+{extend_hours}h" if extend_hours else f"to {new_deadline_formatted}"
        db.session.add(SystemLog(
            user_id=current_uid,
            action=f"Extended arrival deadline for {log_label} {hrs_label} (New deadline: {new_deadline_formatted})",
            timestamp=now
        ))

    # Synchronize extension on active operations
    active_ops = EvacuationOperation.query.filter_by(status='active').all()
    for op in active_ops:
        op.extended_until = new_dt
        op.extension_count = (op.extension_count or 0) + 1

    db.session.commit()

    return jsonify({
        "success": True,
        "message": f"Evacuation arrival deadline extended until {new_deadline_formatted} for {extended_count} center(s).",
        "new_cutoff": new_deadline_formatted,
        "extension_count": targets[0].evacuation_extension_count if targets else 1
    }), 200


@centers_bp.route('/api/evacuation-centers/check-in/report', methods=['GET'])
@centers_bp.route('/api/evacuation-centers/check-in/export', methods=['GET'])
@role_required('admin', 'lgu_personnel')
def export_check_in_report():
    center_id_param = request.args.get('center_id', 'all')
    status_filter = request.args.get('status', 'all')
    date_filter = request.args.get('date')
    search_query = request.args.get('q', '').strip().lower()
    operation_id_param = request.args.get('operation_id')

    centers_summary, evacuees, summary, active_sched, active_centers, operations, is_historical = _get_checkin_dataset(
        center_id_param=center_id_param,
        search_query=search_query,
        status_filter=status_filter,
        date_filter=date_filter,
        operation_id_param=operation_id_param
    )

    wb = Workbook()

    # -------------------------------------------------------------
    # Sheet 1: Arrivals & Check-In Roster
    # -------------------------------------------------------------
    ws1 = wb.active
    ws1.title = "Arrivals & Check-In Roster"
    ws1.views.sheetView[0].showGridLines = True

    font_title = Font(name="Calibri", size=14, bold=True, color="1E3A8A")
    font_subtitle = Font(name="Calibri", size=10, italic=True, color="475569")
    font_meta = Font(name="Calibri", size=10, color="334155")
    font_header = Font(name="Calibri", size=10, bold=True, color="FFFFFF")
    font_data = Font(name="Calibri", size=10, color="0F172A")
    font_checked = Font(name="Calibri", size=10, bold=True, color="166534")
    font_pending = Font(name="Calibri", size=10, color="64748B")

    fill_header = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid")
    fill_zebra = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")
    fill_checked = PatternFill(start_color="DCFCE7", end_color="DCFCE7", fill_type="solid")
    fill_pending = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")

    thin_border_side = Side(border_style="thin", color="CBD5E1")
    border_cell = Border(left=thin_border_side, right=thin_border_side, top=thin_border_side, bottom=thin_border_side)

    align_center = Alignment(horizontal="center", vertical="center")
    align_left = Alignment(horizontal="left", vertical="center")

    center_name_label = "All Evacuation Centers"
    if center_id_param and str(center_id_param).strip() != "all":
        try:
            cid = int(center_id_param)
            c_match = next((c for c in active_centers if c.id == cid), None)
            if c_match:
                center_name_label = c_match.name
        except Exception:
            pass

    open_date_str = active_sched.get("evacuation_open_date") or "Not set"
    open_time_str = active_sched.get("evacuation_open_time") or "08:00"
    cutoff_date_str = active_sched.get("evacuation_cutoff_date") or open_date_str
    cutoff_time_str = active_sched.get("evacuation_cutoff_time") or "18:00"
    ext_count = active_sched.get("evacuation_extension_count") or 0
    evac_status_str = (active_sched.get("evacuation_status") or "Standby").title()
    event_label = active_sched.get("evacuation_event_name") or "Standard Evacuation Operation"
    now_str = philippines_now().strftime("%B %d, %Y %I:%M %p")

    sched_line = f"Opening: {open_date_str} at {open_time_str} • Cutoff: {cutoff_date_str} at {cutoff_time_str}"
    if ext_count > 0:
        sched_line += f" (Extended {ext_count}x)"

    archive_tag = " (ARCHIVE / HISTORICAL RECORD)" if active_sched.get("is_historical") else ""

    # Title block
    ws1["A1"] = f"EVACWAY — EVACUEE ARRIVAL & CHECK-IN REPORT{archive_tag}"
    ws1["A1"].font = font_title
    ws1["A2"] = f"Municipality of Sogod, Southern Leyte • MDRRMO Roster • Generated: {now_str}"
    ws1["A2"].font = font_subtitle
    ws1["A3"] = f"Center: {center_name_label} | Event: {event_label}{archive_tag} | Schedule: {sched_line} ({evac_status_str}) | Filter: {status_filter.title()}"
    ws1["A3"].font = font_meta

    headers1 = [
        "#",
        "Family Code",
        "Head of Household",
        "Member Full Name",
        "Relationship",
        "Arrival Status",
        "Arrival Time",
        "Assigned Shelter",
        "Building & Room",
        "Origin Barangay",
        "Purok / Address",
        "Special Needs / Health",
        "Contact Number"
    ]

    for col_idx, h in enumerate(headers1, start=1):
        cell = ws1.cell(row=5, column=col_idx, value=h)
        cell.font = font_header
        cell.fill = fill_header
        cell.alignment = align_center if col_idx in [1, 6, 7] else align_left
        cell.border = border_cell

    row_num = 6
    record_idx = 1
    for ev in evacuees:
        members = ev.get("members") or []
        bldg_room = ""
        if ev.get("building_name") or ev.get("room_number"):
            parts = []
            if ev.get("building_name"):
                parts.append(ev.get("building_name"))
            if ev.get("room_number"):
                parts.append(f"Room {ev.get('room_number')}")
            bldg_room = " · ".join(parts)
        else:
            bldg_room = "General Venue"

        if members:
            for m in members:
                is_chk = m.get("is_checked_in")
                chk_dt = m.get("checked_in_dt")
                time_str = chk_dt.strftime("%Y-%m-%d %I:%M %p") if chk_dt else "—"
                needs_str = ", ".join(m.get("special_needs") or []) or "—"

                row_values = [
                    record_idx,
                    ev.get("family_code"),
                    ev.get("head_name"),
                    m.get("name"),
                    m.get("relationship"),
                    "Checked In" if is_chk else "Pending Arrival",
                    time_str,
                    ev.get("center_name"),
                    bldg_room,
                    ev.get("barangay_name"),
                    ev.get("address") or "—",
                    needs_str,
                    ev.get("contact_number") or "—"
                ]

                is_even = (row_num % 2 == 0)
                current_fill = fill_zebra if is_even else None

                for col_idx, val in enumerate(row_values, start=1):
                    cell = ws1.cell(row=row_num, column=col_idx, value=val)
                    cell.font = font_data
                    cell.border = border_cell
                    if current_fill:
                        cell.fill = current_fill
                    if col_idx in [1, 7]:
                        cell.alignment = align_center
                    elif col_idx == 6:
                        cell.alignment = align_center
                        if is_chk:
                            cell.fill = fill_checked
                            cell.font = font_checked
                        else:
                            cell.fill = fill_pending
                            cell.font = font_pending
                    else:
                        cell.alignment = align_left

                row_num += 1
                record_idx += 1
        else:
            is_chk = ev.get("checkin_state") == "full"
            time_str = ev.get("checked_in_at") or "—"
            row_values = [
                record_idx,
                ev.get("family_code"),
                ev.get("head_name"),
                ev.get("head_name"),
                "Head",
                "Checked In" if is_chk else "Pending Arrival",
                time_str,
                ev.get("center_name"),
                bldg_room,
                ev.get("barangay_name"),
                ev.get("address") or "—",
                ", ".join(ev.get("special_needs") or []) or "—",
                ev.get("contact_number") or "—"
            ]
            for col_idx, val in enumerate(row_values, start=1):
                cell = ws1.cell(row=row_num, column=col_idx, value=val)
                cell.font = font_data
                cell.border = border_cell
                if col_idx in [1, 7]:
                    cell.alignment = align_center
                elif col_idx == 6:
                    cell.alignment = align_center
                    cell.fill = fill_checked if is_chk else fill_pending
                    cell.font = font_checked if is_chk else font_pending
                else:
                    cell.alignment = align_left
            row_num += 1
            record_idx += 1

    # Auto-adjust column widths for Sheet 1
    for col in ws1.columns:
        max_len = 0
        col_letter = get_column_letter(col[0].column)
        for cell in col:
            if cell.row < 5:
                continue
            val_str = str(cell.value or "")
            if len(val_str) > max_len:
                max_len = len(val_str)
        ws1.column_dimensions[col_letter].width = max(max_len + 3, 11)

    # -------------------------------------------------------------
    # Sheet 2: Centers Overview & Status
    # -------------------------------------------------------------
    ws2 = wb.create_sheet(title="Centers Schedule & Capacity")
    ws2.views.sheetView[0].showGridLines = True

    ws2["A1"] = "EVACUATION CENTERS SCHEDULE & CAPACITY SUMMARY"
    ws2["A1"].font = font_title
    ws2["A2"] = f"Municipality of Sogod • Generated: {now_str}"
    ws2["A2"].font = font_subtitle

    headers2 = [
        "Center Name",
        "Center Type",
        "Total Capacity",
        "Assigned Households",
        "Checked In (Arrived)",
        "Space Remaining",
        "Occupancy Rate",
        "Scheduled Open Date",
        "Open Time",
        "Arrival Deadline",
        "Extensions",
        "Evacuation Status",
        "Event / Purpose"
    ]

    for col_idx, h in enumerate(headers2, start=1):
        cell = ws2.cell(row=4, column=col_idx, value=h)
        cell.font = font_header
        cell.fill = fill_header
        cell.alignment = align_center if col_idx in [3, 4, 5, 6, 7, 8, 9, 10, 11, 12] else align_left
        cell.border = border_cell

    for s_idx, cs in enumerate(centers_summary, start=5):
        assigned_val = cs.get("assigned", 0)
        checked_val = cs.get("checked_in", 0)
        cap_val = cs.get("capacity", 0)
        occ_rate = f"{round((checked_val / cap_val * 100), 1)}%" if cap_val > 0 else "0.0%"
        cutoff_d = cs.get("evacuation_cutoff_date") or cs.get("evacuation_open_date") or "—"
        cutoff_t = cs.get("evacuation_cutoff_time") or "18:00"
        deadline_display = f"{cutoff_d} {cutoff_t}" if cs.get("evacuation_open_date") else "—"

        row_vals = [
            cs.get("name"),
            (cs.get("center_type") or "Campus").title(),
            cap_val,
            assigned_val,
            checked_val,
            cs.get("space_left", 0),
            occ_rate,
            cs.get("evacuation_open_date") or "—",
            cs.get("evacuation_open_time") or "08:00",
            deadline_display,
            f"{cs.get('evacuation_extension_count', 0)}x" if cs.get("evacuation_extension_count") else "None",
            (cs.get("evacuation_status") or "Standby").title(),
            cs.get("evacuation_event_name") or "—"
        ]

        is_even = (s_idx % 2 == 0)
        current_fill = fill_zebra if is_even else None

        for col_idx, val in enumerate(row_vals, start=1):
            cell = ws2.cell(row=s_idx, column=col_idx, value=val)
            cell.font = font_data
            cell.border = border_cell
            if current_fill:
                cell.fill = current_fill
            if col_idx in [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]:
                cell.alignment = align_center
            else:
                cell.alignment = align_left

    for col in ws2.columns:
        max_len = 0
        col_letter = get_column_letter(col[0].column)
        for cell in col:
            if cell.row < 4:
                continue
            val_str = str(cell.value or "")
            if len(val_str) > max_len:
                max_len = len(val_str)
        ws2.column_dimensions[col_letter].width = max(max_len + 4, 12)

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)

    filename_center = re.sub(r'[^a-zA-Z0-9_\-]', '_', center_name_label.replace(" ", "_"))
    date_slug = philippines_now().strftime("%Y%m%d")
    safe_filename = f"EvacWay-Arrival-Report-{filename_center}-{date_slug}.xlsx"

    return Response(
        output.getvalue(),
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={safe_filename}"}
    )

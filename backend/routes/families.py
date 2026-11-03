import csv
import io
import re
import uuid
import time
from datetime import date, datetime
from zoneinfo import ZoneInfo
from collections import defaultdict

from flask import Blueprint, request, jsonify, Response
from flask_jwt_extended import jwt_required
from openpyxl import Workbook
from openpyxl import load_workbook
from sqlalchemy import false, func, or_
from sqlalchemy.orm import selectinload, joinedload
from sqlalchemy.exc import IntegrityError
from flask_jwt_extended import get_jwt_identity

WHITESPACE_RE = re.compile(r'\s+')

from models import (
    db,
    Barangay,
    Family,
    Resident,
    EvacuationAssignment,
    EvacuationCenterBuilding,
    EvacuationCenterRoom,
    EvacuationCenter,
    SystemLog,
    RosterYear,
)

from utils import role_required


# ---------------------------------------------------------
# STAGING STORE FOR VALIDATED-BUT-UNCOMMITTED IMPORTS
# ---------------------------------------------------------
# token -> {preview, filename, expires_at, created_by}
STAGED_IMPORTS = {}
STAGING_TTL_SECONDS = 900          # 15 minutes
MAX_FILE_SIZE = 10 * 1024 * 1024   # 10 MB

# Excel files (OOXML) are ZIP archives and start with 'PK' magic bytes.
# We check content by magic bytes, not just the file extension.
EXCEL_MAGIC = b'PK\x03\x04'


def _cleanup_staged_imports():
    """Remove expired entries from the in-memory staging store."""
    now = time.time()
    for token in list(STAGED_IMPORTS.keys()):
        if STAGED_IMPORTS[token]['expires_at'] < now:
            del STAGED_IMPORTS[token]


class _BytesFileWrapper:
    """Minimal file-like wrapper so _preview_family_workbook can read from raw bytes."""
    def __init__(self, data, name):
        self._data = data
        self.filename = name

    def read(self):
        return self._data


families_bp = Blueprint('families', __name__)

FAMILY_EXPORT_FIELDS = [
    'family_code', 'head_name', 'member_count', 'barangay',
    'contact_number', 'address', 'evacuation_center',
    'buildings', 'rooms', 'assigned_members', 'evacuation_status',
]


def get_or_create_active_year():
    """
    Get or create the roster year corresponding to current calendar year in Asia/Manila.
    Ensures that this row has is_active=True and all other rows False in one transaction.
    Handles unique constraint race conditions where two requests create the same year at once.
    """
    current_year = datetime.now(ZoneInfo("Asia/Manila")).year
    try:
        year_row = RosterYear.query.filter_by(year=current_year).first()
        if not year_row:
            year_row = RosterYear(year=current_year, is_active=True)
            db.session.add(year_row)
            db.session.flush()

        year_row.is_active = True
        RosterYear.query.filter(RosterYear.id != year_row.id).update(
            {'is_active': False},
            synchronize_session=False
        )
        db.session.commit()
        return year_row
    except IntegrityError:
        db.session.rollback()
        year_row = RosterYear.query.filter_by(year=current_year).first()
        if year_row:
            if not year_row.is_active or RosterYear.query.filter(RosterYear.id != year_row.id, RosterYear.is_active == True).first():
                year_row.is_active = True
                RosterYear.query.filter(RosterYear.id != year_row.id).update(
                    {'is_active': False},
                    synchronize_session=False
                )
                db.session.commit()
            return year_row
        return RosterYear.query.filter_by(is_active=True).first()
    except Exception:
        db.session.rollback()
        return RosterYear.query.filter_by(year=current_year).first() or RosterYear.query.filter_by(is_active=True).first()


def _normalize_text(value):
    return re.sub(r'\s+', ' ', str(value or '').strip()).casefold()


def _sync_barangay_population(barangay_id):
    """
    Deprecated / No-op: Do NOT overwrite the official census population (Barangay.population)
    with the count of registered roster residents. Registered residents count is computed
    live from Resident and Family queries without mutating the admin-entered census population.
    """
    return


def _sync_household_and_barangay(family, old_barangay_id=None):
    if not family:
        return []
    residents = (
        Resident.query.filter_by(family_id=family.id)
        .order_by(Resident.is_head_of_family.desc(), Resident.id.asc())
        .all()
    )
    barangay_name = family.barangay.name if family.barangay else ''

    if not residents and family.head_name:
        parts = re.sub(r'\s+', ' ', str(family.head_name).strip()).split(' ')
        first_name = parts[0] if parts else 'Head'
        middle_name = ' '.join(parts[1:-1]) if len(parts) > 2 else None
        last_name = parts[-1] if len(parts) > 1 else ''
        head_res = Resident(
            family_id=family.id,
            first_name=first_name,
            middle_name=middle_name,
            last_name=last_name,
            is_head_of_family=True,
            relationship_to_head='Household Head',
        )
        db.session.add(head_res)
        db.session.flush()
        residents = [head_res]

    if residents:
        heads = [r for r in residents if r.is_head_of_family]
        if len(heads) == 0:
            norm_head = _normalize_text(family.head_name)
            matched = next(
                (r for r in residents if _normalize_text(r.get_full_name()) == norm_head),
                None,
            )
            if not matched and norm_head:
                matched = next(
                    (
                        r for r in residents
                        if _normalize_text(f"{r.first_name} {r.last_name}") == norm_head
                    ),
                    None,
                )
            chosen = matched or residents[0]
            chosen.is_head_of_family = True
            if not chosen.relationship_to_head:
                chosen.relationship_to_head = 'Household Head'
            heads = [chosen]
        elif len(heads) > 1:
            norm_head = _normalize_text(family.head_name)
            primary = next(
                (r for r in heads if _normalize_text(r.get_full_name()) == norm_head),
                heads[0],
            )
            for r in heads:
                if r.id != primary.id:
                    r.is_head_of_family = False
                    if _normalize_text(r.relationship_to_head) in {'self', 'household head', ''}:
                        r.relationship_to_head = 'Family Member'
            heads = [primary]

        head_resident = heads[0]
        if _normalize_text(head_resident.relationship_to_head) in {'', 'self'}:
            head_resident.relationship_to_head = 'Household Head'
        computed_head_name = head_resident.get_full_name()
        if computed_head_name:
            family.head_name = computed_head_name

        count = len(residents)
        family.member_count = count
    else:
        family.member_count = 0

    _sync_barangay_population(family.barangay_id)
    if old_barangay_id and int(old_barangay_id) != int(family.barangay_id or 0):
        _sync_barangay_population(old_barangay_id)

    return residents


def _family_query(search='', barangay_id='', assignment_status='', building_id=''):
    query = Family.query.join(Barangay, Family.barangay_id == Barangay.id)
    search = str(search or '').strip()

    if search:
        pattern = f'%{search}%'
        query = query.filter(or_(
            Family.family_code.ilike(pattern),
            Family.head_name.ilike(pattern),
            Family.contact_number.ilike(pattern),
            Barangay.name.ilike(pattern),
            Family.id.in_(
                db.session.query(Resident.family_id).filter(
                    Resident.family_id.is_not(None),
                    or_(
                        Resident.address.ilike(pattern),
                        Resident.first_name.ilike(pattern),
                        Resident.middle_name.ilike(pattern),
                        Resident.last_name.ilike(pattern),
                        func.concat_ws(
                            ' ',
                            Resident.first_name,
                            Resident.middle_name,
                            Resident.last_name,
                            Resident.suffix,
                        ).ilike(pattern),
                        func.concat_ws(
                            ' ',
                            Resident.first_name,
                            Resident.last_name,
                        ).ilike(pattern),
                    ),
                )
            ),
        ))

    if barangay_id:
        try:
            query = query.filter(Family.barangay_id == int(barangay_id))
        except (TypeError, ValueError):
            query = query.filter(false())

    if assignment_status == 'assigned':
        query = query.filter(Family.id.in_(
            db.session.query(Resident.family_id)
            .join(EvacuationAssignment, EvacuationAssignment.resident_id == Resident.id)
            .filter(Resident.family_id.is_not(None))
        ))
    elif assignment_status == 'unassigned':
        query = query.filter(~Family.id.in_(
            db.session.query(Resident.family_id)
            .join(EvacuationAssignment, EvacuationAssignment.resident_id == Resident.id)
            .filter(Resident.family_id.is_not(None))
        ))

    raw_b_id = str(building_id or '').strip().lower()
    if raw_b_id:
        if raw_b_id in ('unmapped', 'none', 'null'):
            query = query.filter(Family.id.in_(
                db.session.query(Resident.family_id)
                .join(EvacuationAssignment, EvacuationAssignment.resident_id == Resident.id)
                .join(EvacuationCenterRoom, EvacuationAssignment.room_id == EvacuationCenterRoom.id)
                .filter(
                    Resident.family_id.is_not(None),
                    EvacuationCenterRoom.building_id.is_(None),
                )
            ))
        else:
            try:
                parsed_b_id = int(raw_b_id)
                query = query.filter(Family.id.in_(
                    db.session.query(Resident.family_id)
                    .join(EvacuationAssignment, EvacuationAssignment.resident_id == Resident.id)
                    .join(EvacuationCenterRoom, EvacuationAssignment.room_id == EvacuationCenterRoom.id)
                    .filter(
                        Resident.family_id.is_not(None),
                        EvacuationCenterRoom.building_id == parsed_b_id,
                    )
                ))
            except (TypeError, ValueError):
                query = query.filter(false())

    return query


def _family_list_rows(families):
    family_ids = [family.id for family in families]
    if not family_ids:
        return []

    members = Resident.query.filter(Resident.family_id.in_(family_ids)).order_by(Resident.id.asc()).all()
    members_by_family = defaultdict(list)
    for member in members:
        members_by_family[member.family_id].append(member)

    assignment_rows = (
        db.session.query(
            Resident.family_id,
            EvacuationCenter.id.label('center_id'),
            EvacuationCenter.name,
            EvacuationCenterRoom.id.label('room_id'),
            EvacuationCenterRoom.room_number,
            EvacuationCenterRoom.capacity,
            EvacuationCenterRoom.building_id,
            EvacuationCenterBuilding.name.label('building_name'),
            func.count(EvacuationAssignment.id),
            func.count(EvacuationAssignment.checked_in_at),
        )
        .join(EvacuationAssignment, EvacuationAssignment.resident_id == Resident.id)
        .outerjoin(EvacuationCenterRoom, EvacuationAssignment.room_id == EvacuationCenterRoom.id)
        .join(
            EvacuationCenter,
            or_(
                EvacuationAssignment.evacuation_center_id == EvacuationCenter.id,
                EvacuationCenterRoom.evacuation_center_id == EvacuationCenter.id
            )
        )
        .outerjoin(EvacuationCenterBuilding, EvacuationCenterRoom.building_id == EvacuationCenterBuilding.id)
        .filter(Resident.family_id.in_(family_ids))
        .group_by(
            Resident.family_id,
            EvacuationCenter.id,
            EvacuationCenter.name,
            EvacuationCenterRoom.id,
            EvacuationCenterRoom.room_number,
            EvacuationCenterRoom.capacity,
            EvacuationCenterRoom.building_id,
            EvacuationCenterBuilding.name,
        )
        .all()
    )
    assignments_by_family = defaultdict(list)
    for (
        family_id,
        center_id,
        center_name,
        room_id,
        room_number,
        room_capacity,
        building_id,
        building_name,
        assigned_count,
        checked_in_count,
    ) in assignment_rows:
        c_in = int(checked_in_count or 0)
        resolved_b_name = (building_name or f'Building #{building_id}') if building_id else None
        assignments_by_family[family_id].append({
            'center_id': center_id,
            'center': center_name,
            'building_id': building_id,
            'building': resolved_b_name,
            'building_name': resolved_b_name,
            'room_id': room_id,
            'room': room_number,
            'room_capacity': room_capacity,
            'assigned_members': assigned_count,
            'checked_in_members': c_in,
            'is_checked_in': c_in > 0,
            'checkin_status': 'Checked in' if c_in > 0 else 'Not yet arrived',
        })

    result = []
    for family in families:
        family_members = members_by_family.get(family.id, [])
        assignments = assignments_by_family.get(family.id, [])
        head_member = next((m for m in family_members if m.is_head_of_family), None)
        first_member = head_member or (family_members[0] if family_members else None)
        primary_assignment = assignments[0] if assignments else None
        total_checked_in = sum(item['checked_in_members'] for item in assignments)
        is_checked_in = total_checked_in > 0
        result.append({
            **family.to_dict(),
            'barangay': family.barangay.name if family.barangay else None,
            'member_count': len(family_members),
            'resident_count': len(family_members),
            'contact_number': family.contact_number or (first_member.contact_number if first_member else None),
            'alternate_contact': next((m.alternate_contact for m in family_members if m.alternate_contact), None),
            'address': next((member.address for member in family_members if member.address), None),
            'remarks': (head_member.remarks if head_member and head_member.remarks else next((m.remarks for m in family_members if m.remarks), None)),
            'assignments': assignments,
            'evacuation_center': ', '.join(dict.fromkeys(item['center'] for item in assignments if item.get('center'))) or None,
            'buildings': ', '.join(dict.fromkeys((item['building'] or 'Unmapped') for item in assignments if item.get('building') or item.get('center'))) or None,
            'rooms': ', '.join(dict.fromkeys(str(item['room']) for item in assignments if item.get('room'))) or None,
            'current_center_id': primary_assignment['center_id'] if primary_assignment else None,
            'current_building_id': primary_assignment['building_id'] if primary_assignment else None,
            'current_room_id': primary_assignment['room_id'] if primary_assignment else None,
            'current_center': primary_assignment['center'] if primary_assignment else None,
            'current_center_name': primary_assignment['center'] if primary_assignment else None,
            'current_building': primary_assignment['building'] if primary_assignment else None,
            'current_building_name': primary_assignment['building'] if primary_assignment else None,
            'current_room': primary_assignment['room'] if primary_assignment else None,
            'current_room_name': primary_assignment['room'] if primary_assignment else None,
            'current_room_capacity': primary_assignment['room_capacity'] if primary_assignment else None,
            'assigned_members': sum(item['assigned_members'] for item in assignments),
            'checked_in_members': total_checked_in,
            'is_checked_in': is_checked_in,
            'checkin_status': ('Checked in' if is_checked_in else 'Not yet arrived') if assignments else None,
            'is_assigned': bool(assignments),
            'assignment_status': 'Assigned' if assignments else 'Unassigned',
            'evacuation_status': 'Assigned' if assignments else 'Unassigned',
        })
    return result


@families_bp.route('/api/families', methods=['GET'])
@role_required('admin', 'lgu_personnel')
def list_families():
    search = request.args.get('search', '')
    barangay_id = request.args.get('barangay_id', '')
    assignment_status = request.args.get('assignment_status', '')
    building_id = request.args.get('building_id', '')
    sort_by = request.args.get('sort_by', 'family_code')
    direction = request.args.get('direction', 'asc')
    allowed_sorts = {
        'family_code': Family.family_code,
        'head_name': Family.head_name,
        'member_count': Family.member_count,
        'created_at': Family.created_at,
        'evacuation_status': Family.evacuation_status,
        'barangay': Barangay.name,
    }
    sort_column = allowed_sorts.get(sort_by, Family.family_code)
    order = sort_column.desc() if direction == 'desc' else sort_column.asc()
    query = _family_query(search, barangay_id, assignment_status, building_id)

    matching_ids_subq = query.with_entities(Family.id).subquery()
    total = (
        db.session.query(func.count(func.distinct(matching_ids_subq.c.id))).scalar()
    ) or 0
    resident_count = (
        db.session.query(func.count(func.distinct(Resident.id)))
        .filter(Resident.family_id.in_(db.session.query(matching_ids_subq.c.id)))
        .scalar()
    ) or 0
    assigned_family_count = (
        db.session.query(func.count(func.distinct(Family.id)))
        .join(Resident, Resident.family_id == Family.id)
        .join(EvacuationAssignment, EvacuationAssignment.resident_id == Resident.id)
        .filter(Family.id.in_(db.session.query(matching_ids_subq.c.id)))
        .scalar()
    ) or 0
    unassigned_family_count = max(total - assigned_family_count, 0)

    if request.args.get('all') == 'true':
        families = query.order_by(order, Family.id.asc()).all()
        return jsonify({
            'items': _family_list_rows(families),
            'total': total,
            'household_count': total,
            'resident_count': resident_count,
            'assigned_family_count': assigned_family_count,
            'unassigned_family_count': unassigned_family_count,
        })

    try:
        page = max(1, int(request.args.get('page', 1)))
        per_page = min(100, max(1, int(request.args.get('per_page', 20))))
    except (TypeError, ValueError):
        return jsonify({'error': 'page and per_page must be integers'}), 400

    families = query.order_by(order, Family.id.asc()).offset((page - 1) * per_page).limit(per_page).all()
    return jsonify({
        'items': _family_list_rows(families),
        'total': total,
        'household_count': total,
        'resident_count': resident_count,
        'assigned_family_count': assigned_family_count,
        'unassigned_family_count': unassigned_family_count,
        'page': page,
        'per_page': per_page,
        'pages': (total + per_page - 1) // per_page,
    })


@families_bp.route('/api/families/export', methods=['GET'])
@role_required('admin', 'lgu_personnel')
def export_families():
    query = _family_query(
        request.args.get('search', ''),
        request.args.get('barangay_id', ''),
        request.args.get('assignment_status', ''),
        request.args.get('building_id', ''),
    )
    families = query.order_by(Family.family_code.asc(), Family.id.asc()).all()
    rows = _family_list_rows(families)
    output = io.StringIO(newline='')
    writer = csv.DictWriter(output, fieldnames=FAMILY_EXPORT_FIELDS)
    writer.writeheader()
    for row in rows:
        writer.writerow({key: row.get(key) or '' for key in FAMILY_EXPORT_FIELDS})
    return Response(
        output.getvalue(),
        mimetype='text/csv; charset=utf-8',
        headers={'Content-Disposition': 'attachment; filename="evacway-families.csv"'},
    )


@families_bp.route('/api/families/template', methods=['GET'])
@role_required('admin', 'lgu_personnel')
def download_family_template():
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = 'Families'
    sheet.append([
        'Family Code', 'Head of Family', 'Barangay', 'Contact Number',
        'Address', 'Member First Name', 'Member Middle Name',
        'Member Last Name', 'Member Contact Number',
    ])
    instructions = workbook.create_sheet('Instructions')
    instructions.append(['One row per family member; repeat the family fields for each member.'])
    instructions.append(['Family Code must be unique and identical for all rows belonging to one family.'])
    instructions.append(['Required on every row: Family Code, Head of Family, Barangay, Member First Name, Member Last Name.'])
    output = io.BytesIO()
    workbook.save(output)
    return Response(
        output.getvalue(),
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers={'Content-Disposition': 'attachment; filename="evacway-family-template.xlsx"'},
    )


def _split_full_name(full_name):
    parts = re.sub(r'\s+', ' ', str(full_name or '').strip()).split(' ')
    if not parts or not parts[0]:
        return None
    return parts[0], ' '.join(parts[1:-1]) or None, parts[-1]


def _member_name(member):
    first_name = str(member.get('first_name') or '').strip()
    middle_name = str(member.get('middle_name') or '').strip() or None
    last_name = str(member.get('last_name') or '').strip()
    suffix = str(member.get('suffix') or '').strip() or None

    if first_name or last_name:
        return first_name, middle_name, last_name, suffix

    parsed = _split_full_name(member.get('full_name'))
    return (*parsed, None) if parsed else (None, None, None, None)


def _parse_optional_bool(value, label):
    if value is None or value == '':
        return False
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and value in (0, 1):
        return bool(value)
    normalized = str(value).strip().casefold()
    if normalized in {'true', '1', 'yes', 'y'}:
        return True
    if normalized in {'false', '0', 'no', 'n'}:
        return False
    raise ValueError(f'{label} must be true or false')


def _make_family_code(barangay_name, head_name):
    """
    Generate the standard base Family.family_code when not supplied explicitly.
    Matches the database format generated by routes/residents.py without artificial truncation.
    """
    b_part = re.sub(r'[^A-Za-z0-9]+', '', str(barangay_name or '')).upper() or 'BRGY'
    h_part = re.sub(r'[^A-Za-z0-9]+', '', str(head_name or '')).upper() or 'FAMILY'
    return f'{b_part}-{h_part}'[:90]


def _normalize_suffix(val):
    if not val:
        return None
    s = re.sub(r'[^a-zA-Z0-9]+', '', str(val).strip().casefold())
    return s if s else None


def _normalize_dob(val):
    if not val:
        return None
    if isinstance(val, (date, datetime)):
        return val.date().isoformat() if isinstance(val, datetime) else val.isoformat()
    s = str(val).strip()
    if not s:
        return None
    s = s.split('T')[0].split(' ')[0]
    return s


def _member_matches(m1, m2):
    """
    Compare two members within the same household:
    - first name and last name must match (normalized).
    - middle name compared leniently: if either is missing, matches;
      if both are present, exact match or initial prefix matches.
    - suffix compared where available: if both have suffix, must match (normalized).
    - date of birth compared where available: if both have date of birth, must match (normalized).
    """
    f1 = _normalize_text(m1.get('first_name') if isinstance(m1, dict) else m1.first_name)
    l1 = _normalize_text(m1.get('last_name') if isinstance(m1, dict) else m1.last_name)
    f2 = _normalize_text(m2.get('first_name') if isinstance(m2, dict) else m2.first_name)
    l2 = _normalize_text(m2.get('last_name') if isinstance(m2, dict) else m2.last_name)

    if f1 != f2 or l1 != l2:
        return False

    mid1 = _normalize_text(m1.get('middle_name') if isinstance(m1, dict) else m1.middle_name)
    mid2 = _normalize_text(m2.get('middle_name') if isinstance(m2, dict) else m2.middle_name)

    if mid1 and mid2:
        if not (mid1 == mid2 or mid1.startswith(mid2) or mid2.startswith(mid1)):
            return False

    s1 = _normalize_suffix(m1.get('suffix') if isinstance(m1, dict) else m1.suffix)
    s2 = _normalize_suffix(m2.get('suffix') if isinstance(m2, dict) else m2.suffix)
    if s1 and s2:
        if s1 != s2:
            return False

    dob1 = _normalize_dob(m1.get('date_of_birth') if isinstance(m1, dict) else m1.date_of_birth)
    dob2 = _normalize_dob(m2.get('date_of_birth') if isinstance(m2, dict) else m2.date_of_birth)
    if dob1 and dob2:
        if dob1 != dob2:
            return False

    return True


def _normalize_header(value):
    return re.sub(r'[^a-z0-9]+', '_', str(value or '').strip().casefold()).strip('_')


FAMILY_IMPORT_HEADERS = {
    'household_id': {'household_id', 'family_id', 'household_no', 'household_number'},
    'family_code': {'family_code', 'household_code'},
    'head_name': {'head_of_family', 'head_name', 'household_head_name', 'household_head', 'family_head_name'},
    'barangay': {'barangay', 'barangay_name'},
    'contact_number': {'contact_number', 'contact', 'family_contact', 'mobile_number'},
    'address': {'address', 'purok', 'address_purok'},
    'family_members': {'family_members', 'number_of_family_members', 'family_member_count', 'count_of_family_members'},
    'first_name': {'member_first_name', 'first_name'},
    'middle_name': {'member_middle_name', 'middle_name'},
    'last_name': {'member_last_name', 'last_name'},
    'suffix': {'suffix', 'member_suffix', 'name_suffix'},
    'date_of_birth': {'date_of_birth', 'birthdate', 'birth_date', 'dob'},
    'member_contact': {'member_contact_number', 'member_contact'},
    'gender': {'gender', 'sex'},
    'alternate_contact': {'alternate_contact', 'alt_contact', 'emergency_contact'},
    'relationship_to_head': {'relationship_to_head', 'relation_to_head', 'relationship'},
    'is_head_of_family': {'is_head_of_family', 'is_head', 'head_flag'},
    'is_pwd': {'is_pwd', 'pwd', 'person_with_disability'},
    'disability_type': {'disability_type', 'type_of_disability'},
    'disability_notes': {'disability_notes', 'disability_details'},
    'is_pregnant': {'is_pregnant', 'pregnant'},
    'is_lactating': {'is_lactating', 'lactating', 'breastfeeding'},
    'is_solo_parent': {'is_solo_parent', 'solo_parent', 'single_parent'},
    'needs_assistance': {'needs_assistance', 'assistance_needed', 'requires_assistance'},
    'medical_notes': {'medical_notes', 'medical_condition', 'medical_conditions', 'health_notes'},
    'notes': {'notes', 'additional_notes'},
    'remarks': {'remarks', 'comment', 'comments'},
    'vulnerable_members': {'vulnerable_members', 'vulnerable_count'},
}


def _parse_boolean_cell(val, field_label, row_number, warnings_list):
    """Parse boolean values (Yes/No/True/False/1/0, case-insensitive).
    Invalid non-empty values log a row warning and return None without crashing.
    """
    if val is None:
        return None
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        if val == 1:
            return True
        if val == 0:
            return False
    s = str(val).strip().casefold()
    if not s:
        return None
    if s in {'true', 't', 'yes', 'y', '1'}:
        return True
    if s in {'false', 'f', 'no', 'n', '0'}:
        return False
    warnings_list.append(
        f'Row {row_number}: Invalid value "{val}" for {field_label}. Expected Yes/No, True/False, or 1/0.'
    )
    return None


def _normalize_contact_cell(val):
    """Read contact cells (family contact, member contact, alternate contact) as text.
    If a numeric cell has 10 digits and starts with 9, restore the leading 0.
    Do not change numbers that start with + or 63.
    """
    if val is None:
        return ''
    if isinstance(val, float) and val.is_integer():
        s = str(int(val)).strip()
    elif isinstance(val, int) and not isinstance(val, bool):
        s = str(val).strip()
    else:
        s = str(val).strip()

    if not s:
        return ''

    # Do not change numbers that start with + or 63
    if s.startswith('+') or s.startswith('63'):
        return s

    digits_only = re.sub(r'\D', '', s)
    if len(digits_only) == 10 and digits_only.startswith('9'):
        return '0' + digits_only

    return s



def _compute_resident_fill(dm, fm):
    """Compare matched database resident with file member dictionary.
    Returns dict of {field_name: new_value} for fields that are currently blank or false/empty in the database.
    Never overwrites a field that already has a value.
    """
    updates = {}
    text_fields = [
        'gender', 'suffix', 'alternate_contact', 'relationship_to_head',
        'disability_type', 'disability_notes', 'medical_notes', 'notes',
        'remarks', 'vulnerable_members', 'address', 'contact_number',
    ]
    for tf in text_fields:
        file_val = fm.get(tf)
        if file_val is not None and str(file_val).strip() != '':
            db_val = getattr(dm, tf, None)
            if db_val is None or str(db_val).strip() == '':
                updates[tf] = str(file_val).strip()

    file_dob = fm.get('date_of_birth')
    if file_dob:
        db_dob = getattr(dm, 'date_of_birth', None)
        if db_dob is None:
            iso_str = file_dob.isoformat() if isinstance(file_dob, (date, datetime)) else str(file_dob)
            updates['date_of_birth'] = iso_str

    bool_fields = [
        'is_pwd', 'is_pregnant', 'is_lactating', 'is_solo_parent', 'needs_assistance'
    ]
    for bf in bool_fields:
        file_val = fm.get(bf)
        if file_val is True:
            db_val = getattr(dm, bf, None)
            if db_val is None or db_val is False:
                updates[bf] = True

    return updates


def _make_resident_model(member, family, head_name, barangay_name, default_address, uploaded_by):
    """Instantiate a new Resident model populated with all supported personal and vulnerability fields."""
    is_head = _normalize_text(member.get('full_name', '')) == _normalize_text(head_name)
    dob_val = member.get('date_of_birth')
    if isinstance(dob_val, str):
        try:
            dob_val = datetime.strptime(dob_val, '%Y-%m-%d').date()
        except Exception:
            dob_val = None
    elif not isinstance(dob_val, (date, type(None))):
        dob_val = None

    rel = member.get('relationship_to_head')
    if not rel and is_head:
        rel = 'Household Head'

    is_head_flag = member.get('is_head_of_family')
    if is_head_flag is None:
        is_head_flag = is_head

    return Resident(
        family_id=family.id,
        first_name=member['first_name'],
        middle_name=member.get('middle_name'),
        last_name=member['last_name'],
        suffix=member.get('suffix'),
        date_of_birth=dob_val,
        gender=member.get('gender'),
        alternate_contact=member.get('alternate_contact'),
        relationship_to_head=rel,
        is_head_of_family=bool(is_head_flag),
        is_pwd=bool(member.get('is_pwd')),
        disability_type=member.get('disability_type'),
        disability_notes=member.get('disability_notes'),
        is_pregnant=bool(member.get('is_pregnant')),
        is_lactating=bool(member.get('is_lactating')),
        is_solo_parent=bool(member.get('is_solo_parent')),
        needs_assistance=bool(member.get('needs_assistance')),
        medical_notes=member.get('medical_notes'),
        notes=member.get('notes'),
    )


def _preview_family_workbook(file_storage):
    filename = str(file_storage.filename or '')
    if filename.casefold().endswith('.xls'):
        return {
            'families': [],
            'errors': [{'row': 0, 'message': 'Please save the file as .xlsx and upload again.'}],
            'warnings': [],
            'rows': 0,
            'new_households': 0,
            'updated_households': 0,
            'skipped_households': 0,
            'new_members_to_add': 0,
            'members_to_fill': 0,
            'can_import': False,
        }
    if not filename.casefold().endswith('.xlsx'):
        return {
            'families': [],
            'errors': [{'row': 0, 'message': 'Upload an Excel (.xlsx) file.'}],
            'warnings': [],
            'rows': 0,
            'new_households': 0,
            'updated_households': 0,
            'skipped_households': 0,
            'new_members_to_add': 0,
            'members_to_fill': 0,
            'can_import': False,
        }

    try:
        workbook = load_workbook(io.BytesIO(file_storage.read()), read_only=True, data_only=True)
        worksheet = workbook.active
        values = worksheet.iter_rows(values_only=True)
        headers = next(values, None)
    except Exception:
        return {
            'families': [],
            'errors': [{'row': 0, 'message': 'The workbook could not be read.'}],
            'warnings': [],
            'rows': 0,
            'new_households': 0,
            'updated_households': 0,
            'skipped_households': 0,
            'new_members_to_add': 0,
            'can_import': False,
        }

    if not headers:
        return {
            'families': [],
            'errors': [{'row': 1, 'message': 'The worksheet is empty.'}],
            'warnings': [],
            'rows': 0,
            'new_households': 0,
            'updated_households': 0,
            'skipped_households': 0,
            'new_members_to_add': 0,
            'can_import': False,
        }

    column_indexes = {}
    for index, header in enumerate(headers):
        normalized = _normalize_header(header)
        for field, aliases in FAMILY_IMPORT_HEADERS.items():
            if normalized in aliases:
                column_indexes[field] = index

    required = {'head_name', 'barangay', 'first_name', 'last_name'}
    missing = sorted(required - set(column_indexes))
    if missing:
        return {
            'families': [],
            'errors': [{'row': 1, 'message': f'Missing required columns: {", ".join(missing)}'}],
            'warnings': [],
            'rows': 0,
            'new_households': 0,
            'updated_households': 0,
            'skipped_households': 0,
            'new_members_to_add': 0,
            'can_import': False,
        }

    errors = []
    warnings = []
    families_by_key = {}
    row_count = 0

    def _clean_cell(val):
        if val is None:
            return ''
        if isinstance(val, float) and val.is_integer():
            return str(int(val))
        if isinstance(val, int) and not isinstance(val, bool):
            return str(val)
        s = str(val).strip()
        if '  ' in s or '\t' in s or '\n' in s:
            return WHITESPACE_RE.sub(' ', s)
        return s

    # Cache column index lookups to avoid repeated dictionary lookups per row
    idx_household_id = column_indexes.get('household_id')
    idx_family_code = column_indexes.get('family_code')
    idx_head_name = column_indexes.get('head_name')
    idx_barangay = column_indexes.get('barangay')
    idx_address = column_indexes.get('address')
    idx_first_name = column_indexes.get('first_name')
    idx_middle_name = column_indexes.get('middle_name')
    idx_last_name = column_indexes.get('last_name')
    idx_suffix = column_indexes.get('suffix')
    idx_dob = column_indexes.get('date_of_birth')
    idx_fam_members = column_indexes.get('family_members')
    idx_contact = column_indexes.get('contact_number')
    idx_alt_contact = column_indexes.get('alternate_contact')
    idx_rel = column_indexes.get('relationship_to_head')
    idx_is_head = column_indexes.get('is_head_of_family')
    idx_is_pwd = column_indexes.get('is_pwd')
    idx_disability_type = column_indexes.get('disability_type')
    idx_disability_notes = column_indexes.get('disability_notes')
    idx_is_pregnant = column_indexes.get('is_pregnant')
    idx_is_lactating = column_indexes.get('is_lactating')
    idx_is_solo_parent = column_indexes.get('is_solo_parent')
    idx_needs_assistance = column_indexes.get('needs_assistance')
    idx_medical_notes = column_indexes.get('medical_notes')
    idx_notes = column_indexes.get('notes')
    idx_remarks = column_indexes.get('remarks')
    idx_vulnerable = column_indexes.get('vulnerable_members')
    idx_gender = column_indexes.get('gender')
    idx_member_contact = column_indexes.get('member_contact')

    def cell_at(row, idx):
        if idx is None or idx >= len(row):
            return ''
        return _clean_cell(row[idx])

    def cell_raw_at(row, idx):
        if idx is None or idx >= len(row):
            return None
        return row[idx]

    def cell_contact_at(row, idx):
        if idx is None or idx >= len(row):
            return ''
        return _normalize_contact_cell(row[idx])

    # Pre-fetch all barangays once into a case-insensitive lookup table to avoid N database queries in loop
    all_barangays = Barangay.query.all()
    barangays_by_name = {b.name.strip().casefold(): b for b in all_barangays}

    for row_number, row in enumerate(values, start=2):
        if not row or not any(value is not None and str(value).strip() for value in row):
            continue
        row_count += 1
        household_id = cell_at(row, idx_household_id)
        explicit_code = cell_at(row, idx_family_code) or household_id
        head_name = cell_at(row, idx_head_name)
        barangay_name = cell_at(row, idx_barangay)
        address = cell_at(row, idx_address)
        first_name = cell_at(row, idx_first_name)
        middle_name = cell_at(row, idx_middle_name)
        last_name = cell_at(row, idx_last_name)
        suffix = cell_at(row, idx_suffix) or None
        dob = _normalize_dob(cell_raw_at(row, idx_dob))
        raw_fam_count = cell_at(row, idx_fam_members)

        missing_fields = [
            label for value, label in (
                (head_name, 'Head of Family'),
                (barangay_name, 'Barangay'),
                (first_name, 'Member First Name'),
                (last_name, 'Member Last Name'),
            ) if not value
        ]
        if missing_fields:
            errors.append({'row': row_number, 'message': f'Missing required values: {", ".join(missing_fields)}'})
            continue

        barangay = barangays_by_name.get(barangay_name.casefold())
        if not barangay:
            errors.append({'row': row_number, 'message': f'Barangay "{barangay_name}" has not been added yet. Add it in the Barangays tab first.'})
            continue

        if explicit_code:
            family_code = explicit_code
            import_key = ('code', explicit_code.casefold())
        else:
            family_code = _make_family_code(barangay.name, head_name)
            import_key = ('derived', barangay.id, _normalize_text(head_name))

        if len(family_code) > 90 or len(head_name) > 150:
            errors.append({'row': row_number, 'message': 'Family Code or Head of Family exceeds maximum allowed length.'})
            continue

        existing_group = families_by_key.get(import_key)
        if existing_group is None:
            metadata = {
                'family_code': family_code,
                'has_explicit_code': bool(explicit_code),
                'head_name': head_name,
                'barangay_id': barangay.id,
                'barangay': barangay.name,
                'contact_number': cell_contact_at(row, idx_contact) or None,
                'address': address or None,
                'declared_count': int(raw_fam_count) if (raw_fam_count and raw_fam_count.isdigit()) else None,
                'members': [],
                'source_rows': [row_number],
            }
            families_by_key[import_key] = metadata
            existing_group = metadata
        else:
            existing_group['source_rows'].append(row_number)
            # Rule: If two different-looking households in the file resolve to the same derived key, show a warning and do not merge them silently.
            if existing_group['barangay_id'] != barangay.id:
                errors.append({'row': row_number, 'message': f'Rows sharing Family Code "{family_code}" have different barangays.'})
                continue
            if _normalize_text(existing_group['head_name']) != _normalize_text(head_name):
                warnings.append(
                    f'Rows for "{head_name}" and "{existing_group["head_name"]}" in {barangay.name} look like the same household, so they were grouped together. Please check.'
                )
            if existing_group.get('declared_count') is None and raw_fam_count and raw_fam_count.isdigit():
                existing_group['declared_count'] = int(raw_fam_count)

        gender = cell_at(row, idx_gender) or None
        alternate_contact = cell_contact_at(row, idx_alt_contact) or None
        relationship_to_head = cell_at(row, idx_rel) or None
        is_head_flag = _parse_boolean_cell(cell_raw_at(row, idx_is_head), 'Is Head of Family', row_number, warnings)
        is_pwd = _parse_boolean_cell(cell_raw_at(row, idx_is_pwd), 'Is PWD', row_number, warnings)
        disability_type = cell_at(row, idx_disability_type) or None
        disability_notes = cell_at(row, idx_disability_notes) or None
        is_pregnant = _parse_boolean_cell(cell_raw_at(row, idx_is_pregnant), 'Is Pregnant', row_number, warnings)
        is_lactating = _parse_boolean_cell(cell_raw_at(row, idx_is_lactating), 'Is Lactating', row_number, warnings)
        is_solo_parent = _parse_boolean_cell(cell_raw_at(row, idx_is_solo_parent), 'Is Solo Parent', row_number, warnings)
        needs_assistance = _parse_boolean_cell(cell_raw_at(row, idx_needs_assistance), 'Needs Assistance', row_number, warnings)
        medical_notes = cell_at(row, idx_medical_notes) or None
        notes = cell_at(row, idx_notes) or None
        remarks = cell_at(row, idx_remarks) or None
        vulnerable_members = cell_at(row, idx_vulnerable) or None
        member_contact = cell_contact_at(row, idx_member_contact) or None

        member_name = ' '.join(part for part in (first_name, middle_name, last_name, suffix) if part)
        member_dict = {
            'first_name': first_name,
            'middle_name': middle_name or None,
            'last_name': last_name,
            'suffix': suffix,
            'date_of_birth': dob,
            'full_name': member_name,
            'contact_number': member_contact or cell_contact_at(row, idx_contact) or existing_group['contact_number'],
            'address': address or existing_group['address'],
            'gender': gender,
            'alternate_contact': alternate_contact,
            'relationship_to_head': relationship_to_head,
            'is_head_of_family': is_head_flag,
            'is_pwd': is_pwd,
            'disability_type': disability_type,
            'disability_notes': disability_notes,
            'is_pregnant': is_pregnant,
            'is_lactating': is_lactating,
            'is_solo_parent': is_solo_parent,
            'needs_assistance': needs_assistance,
            'medical_notes': medical_notes,
            'notes': notes,
            'remarks': remarks,
            'vulnerable_members': vulnerable_members,
            'row': row_number,
        }

        # Rule: If the same first + last name appears twice inside one household in the file, do not merge them. Show a warning so I can review it.
        has_dup_in_file = any(
            _member_matches(item, member_dict)
            for item in existing_group['members']
        )
        if has_dup_in_file:
            warnings.append(
                f'"{member_name}" appears twice in the household of "{head_name}" (row {row_number}). Both rows were kept. Please check.'
            )

        existing_group['members'].append(member_dict)

    families = list(families_by_key.values())

    # Validate household row counts against "Family Members" declared count
    for family in families:
        if family.get('declared_count') is not None and family['declared_count'] != len(family['members']):
            warnings.append(
                f'The file says "{family["head_name"]}" has {family["declared_count"]} family members, but {len(family["members"])} row(s) were found.'
            )

        # Check if head appears as a member
        if not any(
            _normalize_text(m['full_name']) == _normalize_text(family['head_name']) or
            _normalize_text(f"{m['first_name']} {m['last_name']}") == _normalize_text(family['head_name'])
            for m in family['members']
        ):
            warnings.append(
                f'The head "{family["head_name"]}" is not listed as a member row. A record for the head will be added automatically.'
            )

    # -------------------------------------------------------------------------
    # CLASSIFY AGAINST DATABASE: NEW / UPDATED / SKIPPED / CONFLICT
    # Eager load residents and barangays to prevent N+1 queries during matching
    # -------------------------------------------------------------------------
    db_families = Family.query.options(
        selectinload(Family.residents),
        joinedload(Family.barangay)
    ).all()
    db_by_code = {f.family_code.casefold(): f for f in db_families}
    db_by_head_brgy = {(f.barangay_id, _normalize_text(f.head_name)): f for f in db_families}

    for family in families:
        code_str = family['family_code'].strip()
        matched_db = None

        # 1. Primary key: Family code
        if code_str.casefold() in db_by_code:
            candidate = db_by_code[code_str.casefold()]
            same_head = _normalize_text(candidate.head_name) == _normalize_text(family['head_name'])
            same_brgy = candidate.barangay_id == family['barangay_id']

            if same_head and same_brgy:
                matched_db = candidate
            else:
                # Real conflict: family code matches BUT head or barangay is different
                cand_brgy_name = candidate.barangay.name if candidate.barangay else ''
                errors.append({
                    'row': family['source_rows'][0],
                    'message': (
                        f'Family code "{family["family_code"]}" already belongs to "{candidate.head_name}" in {cand_brgy_name}, '
                        f'but this file uses it for "{family["head_name"]}" in {family["barangay"]}. Please correct the family code in the file.'
                    )
                })
                family['status'] = 'conflict'
                family['db_family_id'] = candidate.id
                family['new_members'] = []
                family['members_to_fill'] = []
                continue
        else:
            # 2. Secondary check: Head + Barangay
            head_key = (family['barangay_id'], _normalize_text(family['head_name']))
            if head_key in db_by_head_brgy:
                candidate = db_by_head_brgy[head_key]
                # Head + barangay match BUT the family code is different: do not auto-merge
                warnings.append(
                    f'The household of "{family["head_name"]}" in {family["barangay"]} is already registered under a different family code ("{family["family_code"]}" vs "{candidate.family_code}"). This household was not changed. Please check it.'
                )
                family['status'] = 'skipped'
                family['db_family_id'] = candidate.id
                family['new_members'] = []
                family['members_to_fill'] = []
                family['existing_members'] = [r.get_full_name() for r in candidate.residents]
                continue

        if matched_db:
            # Matched existing household: check members and compute fields to fill
            db_residents = matched_db.residents
            new_members_for_household = []
            members_to_fill_for_household = []

            for fm in family['members']:
                matched_dm = next((dm for dm in db_residents if _member_matches(fm, dm)), None)
                if matched_dm is None:
                    new_members_for_household.append(fm)
                else:
                    upd = _compute_resident_fill(matched_dm, fm)
                    if upd:
                        members_to_fill_for_household.append({
                            'resident_id': matched_dm.id,
                            'name': matched_dm.get_full_name(),
                            'updates': upd,
                        })

            family['db_family_id'] = matched_db.id
            family['new_members'] = new_members_for_household
            family['members_to_fill'] = members_to_fill_for_household
            family['existing_members'] = [r.get_full_name() for r in db_residents]

            # A household with no new members but with blank fields to fill must NOT be "skipped"
            if new_members_for_household or members_to_fill_for_household:
                family['status'] = 'updated'
            else:
                family['status'] = 'skipped'
        else:
            family['status'] = 'new'
            family['db_family_id'] = None
            family['new_members'] = family['members']
            family['members_to_fill'] = []
            family['existing_members'] = []

        family['member_count'] = len(family['members'])

    new_households = sum(1 for f in families if f.get('status') == 'new')
    updated_households = sum(1 for f in families if f.get('status') == 'updated')
    skipped_households = sum(1 for f in families if f.get('status') == 'skipped')
    new_members_to_add = sum(len(f.get('new_members', [])) for f in families if f.get('status') == 'updated')
    members_to_fill = sum(len(f.get('members_to_fill', [])) for f in families)

    if skipped_households > 0:
        warnings.insert(
            0,
            f'{skipped_households} household{"" if skipped_households == 1 else "s"} are already registered with the same members. They will be left unchanged.'
        )

    can_import = (len(errors) == 0 and (new_households > 0 or new_members_to_add > 0 or members_to_fill > 0))

    serialized_families = [
        {
            'family_code': f['family_code'],
            'head_name': f['head_name'],
            'barangay': f['barangay'],
            'barangay_id': f['barangay_id'],
            'contact_number': f['contact_number'],
            'address': f['address'],
            'member_count': f['member_count'],
            'status': f.get('status', 'new'),
            'db_family_id': f.get('db_family_id'),
            'new_members': f.get('new_members', []),
            'members_to_fill': f.get('members_to_fill', []),
            'existing_members': f.get('existing_members', []),
            'members': f.get('members', []),
        }
        for f in families
    ]

    return {
        'families': serialized_families,
        'errors': errors,
        'warnings': warnings,
        'rows': row_count,
        'new_households': new_households,
        'updated_households': updated_households,
        'skipped_households': skipped_households,
        'new_members_to_add': new_members_to_add,
        'members_to_fill': members_to_fill,
        'can_import': can_import,
    }


@families_bp.route('/api/families/import', methods=['POST'])
@role_required('admin')
def import_families():
    file_storage = request.files.get('file')
    if not file_storage:
        return jsonify({'error': 'Choose an .xlsx file to import.'}), 400

    filename = str(file_storage.filename or '')
    if filename.casefold().endswith('.xls'):
        return jsonify({'error': 'Please save the file as .xlsx and upload again.'}), 400
    if not filename.casefold().endswith('.xlsx'):
        return jsonify({'error': 'Upload an Excel (.xlsx) file.'}), 400

    file_bytes = file_storage.read()
    if len(file_bytes) == 0:
        return jsonify({'error': 'The uploaded file is empty.'}), 400
    file_storage.seek(0)

    preview = _preview_family_workbook(file_storage)
    commit_requested = str(request.form.get('commit', '')).casefold() == 'true'

    if not commit_requested:
        return jsonify(preview), 200
    if not preview['can_import']:
        return jsonify({**preview, 'error': 'Resolve all import errors or ensure there are new records to commit.'}), 400

    active_year = get_or_create_active_year()
    if not active_year:
        return jsonify({'error': 'No active roster year found. Please configure an active roster year first.'}), 400

    # Execute commit inside single transaction
    created_count = 0
    updated_count = 0
    skipped_count = 0
    residents_created = 0
    members_filled_count = 0
    affected_barangay_ids = set()

    try:
        for item in preview['families']:
            status = item.get('status')
            if status == 'new':
                family = Family(
                    roster_year_id=active_year.id,
                    barangay_id=item['barangay_id'],
                    family_code=item['family_code'],
                    head_name=item['head_name'],
                    member_count=len(item['members']),
                    contact_number=item['contact_number'],
                    evacuation_status='Unassigned',
                )
                db.session.add(family)
                db.session.flush()
                affected_barangay_ids.add(item['barangay_id'])

                for member in item['members']:
                    res = _make_resident_model(
                        member, family, item['head_name'], item['barangay'], item['address'], get_jwt_identity()
                    )
                    db.session.add(res)
                    residents_created += 1

                db.session.flush()
                _sync_household_and_barangay(family)
                created_count += 1

            elif status == 'updated':
                family = db.session.get(Family, item['db_family_id'])
                if not family:
                    continue
                affected_barangay_ids.add(family.barangay_id)

                for member in item.get('new_members', []):
                    res = _make_resident_model(
                        member, family, family.head_name, item['barangay'], item['address'], get_jwt_identity()
                    )
                    db.session.add(res)
                    residents_created += 1

                for fill in item.get('members_to_fill', []):
                    res = db.session.get(Resident, fill['resident_id'])
                    if res:
                        for field, val in fill.get('updates', {}).items():
                            if field == 'date_of_birth' and isinstance(val, str):
                                try:
                                    val = datetime.strptime(val, '%Y-%m-%d').date()
                                except Exception:
                                    val = None
                            setattr(res, field, val)
                        members_filled_count += 1

                db.session.flush()
                _sync_household_and_barangay(family)
                updated_count += 1

            elif status == 'skipped':
                skipped_count += 1

        for bid in affected_barangay_ids:
            _sync_barangay_population(bid)

        db.session.add(SystemLog(
            user_id=get_jwt_identity(),
            action=(
                f'Imported Excel roster: {created_count} created, {updated_count} updated '
                f'({residents_created} residents added, {members_filled_count} members with blank fields filled), '
                f'{skipped_count} skipped'
            ),
        ))
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': f'Import failed: {str(e)}'}), 500

    return jsonify({
        'message': f'Import completed: {created_count} created, {updated_count} updated, {skipped_count} skipped.',
        'families_created': created_count,
        'families_updated': updated_count,
        'families_skipped': skipped_count,
        'residents_created': residents_created,
        'members_filled': members_filled_count,
        'failed_rows': 0,
    }), 201


# ---------------------------------------------------------
# STAGE: Upload + validate, save nothing to live data
# ---------------------------------------------------------
@families_bp.route('/api/families/import/stage', methods=['POST'])
@role_required('admin')
def stage_family_import():
    file_storage = request.files.get('file')
    if not file_storage:
        return jsonify({'error': 'Choose an .xlsx file to import.'}), 400

    filename = str(file_storage.filename or '')
    if filename.casefold().endswith('.xls'):
        return jsonify({'error': 'Please save the file as .xlsx and upload again.'}), 400
    if not filename.casefold().endswith('.xlsx'):
        return jsonify({'error': 'Upload an Excel (.xlsx) file.'}), 400

    file_bytes = file_storage.read()

    if len(file_bytes) == 0:
        return jsonify({'error': 'The uploaded file is empty.'}), 400

    if len(file_bytes) > MAX_FILE_SIZE:
        return jsonify({
            'error': f'File too large. Maximum size is {MAX_FILE_SIZE // (1024 * 1024)} MB.'
        }), 400

    if not file_bytes.startswith(EXCEL_MAGIC):
        return jsonify({
            'error': 'The file does not appear to be a valid Excel (.xlsx) file.'
        }), 400

    try:
        wrapper = _BytesFileWrapper(file_bytes, file_storage.filename or 'import.xlsx')
        preview = _preview_family_workbook(wrapper)
    except Exception as e:
        return jsonify({
            'error': f'The workbook could not be read: {str(e)}'
        }), 400

    current_user = str(get_jwt_identity())
    for old_token in [
        key for key, value in STAGED_IMPORTS.items()
        if str(value.get('created_by')) == current_user
    ]:
        del STAGED_IMPORTS[old_token]

    token = str(uuid.uuid4())
    STAGED_IMPORTS[token] = {
        'file_bytes': file_bytes,
        'preview': preview,
        'filename': file_storage.filename or 'import.xlsx',
        'expires_at': time.time() + STAGING_TTL_SECONDS,
        'created_by': current_user,
    }
    _cleanup_staged_imports()

    # Send optimized family payload to the frontend for the review UI
    slim_families = [
        {
            'family_code': f['family_code'],
            'head_name': f['head_name'],
            'barangay': f['barangay'],
            'barangay_id': f['barangay_id'],
            'contact_number': f.get('contact_number'),
            'address': f.get('address'),
            'member_count': f['member_count'],
            'status': f.get('status', 'new'),
            'db_family_id': f.get('db_family_id'),
            'new_members': [
                {'full_name': m.get('full_name') or f"{m.get('first_name', '')} {m.get('last_name', '')}".strip()}
                for m in f.get('new_members', [])
            ],
            'members_to_fill': [
                {'name': m.get('name', '')}
                for m in f.get('members_to_fill', [])
            ],
            'existing_members': f.get('existing_members', []),
            'members': [
                {'full_name': m.get('full_name') or f"{m.get('first_name', '')} {m.get('last_name', '')}".strip()}
                for m in f.get('members', [])
            ] if f.get('status') == 'new' else [],
        }
        for f in preview['families']
    ]

    return jsonify({
        'staging_token': token,
        'expires_in': STAGING_TTL_SECONDS,
        'filename': file_storage.filename,
        'families': slim_families,
        'errors': preview['errors'],
        'warnings': preview['warnings'],
        'rows': preview['rows'],
        'new_households': preview['new_households'],
        'updated_households': preview['updated_households'],
        'skipped_households': preview['skipped_households'],
        'new_members_to_add': preview['new_members_to_add'],
        'members_to_fill': preview['members_to_fill'],
        'can_import': preview['can_import'],
    }), 200


# ---------------------------------------------------------
# COMMIT: Require a valid staging token, re-validate, save in one transaction
# ---------------------------------------------------------
@families_bp.route('/api/families/import/commit', methods=['POST'])
@role_required('admin')
def commit_family_import():
    data = request.get_json(silent=True) or {}
    token = data.get('staging_token') or data.get('token')

    if not token:
        return jsonify({
            'error': 'This upload has expired. Please upload the file again.'
        }), 400

    staged = STAGED_IMPORTS.get(token)
    if not staged:
        return jsonify({
            'error': 'This upload has expired. Please upload the file again.'
        }), 400

    if time.time() > staged['expires_at']:
        del STAGED_IMPORTS[token]
        return jsonify({
            'error': 'This upload has expired. Please upload the file again.'
        }), 400

    if str(staged.get('created_by')) != str(get_jwt_identity()):
        return jsonify({
            'error': 'This upload has expired. Please upload the file again.'
        }), 400

    # Re-validate on the server against the live database state
    try:
        wrapper = _BytesFileWrapper(staged['file_bytes'], staged.get('filename', 'import.xlsx'))
        preview = _preview_family_workbook(wrapper)
    except Exception as e:
        return jsonify({'error': f'Failed to check file before saving: {str(e)}'}), 400

    if preview['errors']:
        return jsonify({'error': 'Errors found in the file. Cannot proceed.'}), 400

    if not preview['can_import']:
        return jsonify({'error': 'Nothing to add. Everyone in this file is already registered.'}), 400

    active_year = get_or_create_active_year()
    if not active_year:
        return jsonify({'error': 'No active roster year found. Please configure an active roster year first.'}), 400

    created_count = 0
    updated_count = 0
    skipped_count = 0
    residents_created = 0
    members_filled_count = 0
    affected_barangay_ids = set()

    try:
        for item in preview['families']:
            status = item.get('status')
            if status == 'new':
                family = Family(
                    roster_year_id=active_year.id,
                    barangay_id=item['barangay_id'],
                    family_code=item['family_code'],
                    head_name=item['head_name'],
                    member_count=len(item['members']),
                    contact_number=item['contact_number'],
                    evacuation_status='Unassigned',
                )
                db.session.add(family)
                db.session.flush()
                affected_barangay_ids.add(item['barangay_id'])

                for member in item['members']:
                    res = _make_resident_model(
                        member, family, item['head_name'], item['barangay'], item['address'], get_jwt_identity()
                    )
                    db.session.add(res)
                    residents_created += 1

                db.session.flush()
                _sync_household_and_barangay(family)
                created_count += 1

            elif status == 'updated':
                family = db.session.get(Family, item['db_family_id'])
                if not family:
                    continue
                affected_barangay_ids.add(family.barangay_id)

                for member in item.get('new_members', []):
                    res = _make_resident_model(
                        member, family, family.head_name, item['barangay'], item['address'], get_jwt_identity()
                    )
                    db.session.add(res)
                    residents_created += 1

                for fill in item.get('members_to_fill', []):
                    res = db.session.get(Resident, fill['resident_id'])
                    if res:
                        for field, val in fill.get('updates', {}).items():
                            if field == 'date_of_birth' and isinstance(val, str):
                                try:
                                    val = datetime.strptime(val, '%Y-%m-%d').date()
                                except Exception:
                                    val = None
                            setattr(res, field, val)
                        members_filled_count += 1

                db.session.flush()
                _sync_household_and_barangay(family)
                updated_count += 1

            elif status == 'skipped':
                skipped_count += 1

        for bid in affected_barangay_ids:
            _sync_barangay_population(bid)

        db.session.add(SystemLog(
            user_id=get_jwt_identity(),
            action=(
                f'Imported Excel roster: {created_count} created, {updated_count} updated '
                f'({residents_created} residents added, {members_filled_count} members with blank fields filled), '
                f'{skipped_count} skipped'
            ),
        ))
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': f'Import failed: {str(e)}'}), 500

    del STAGED_IMPORTS[token]
    _cleanup_staged_imports()

    return jsonify({
        'message': f'Import completed: {created_count} created, {updated_count} updated, {skipped_count} skipped.',
        'families_created': created_count,
        'families_updated': updated_count,
        'families_skipped': skipped_count,
        'residents_created': residents_created,
        'members_filled': members_filled_count,
        'failed_rows': 0,
    }), 201


def _serialize_family_detail(family):
    residents = (
        Resident.query.filter_by(family_id=family.id)
        .order_by(Resident.is_head_of_family.desc(), Resident.id.asc())
        .all()
    )
    if residents and (not any(r.is_head_of_family for r in residents) or family.member_count != len(residents)):
        residents = _sync_household_and_barangay(family)
        db.session.commit()
    result = _family_list_rows([family])[0]
    resident_ids = [r.id for r in residents]
    evacuation_by_resident = {}
    if resident_ids:
        rows = (
            db.session.query(EvacuationAssignment, EvacuationCenterRoom, EvacuationCenter)
            .join(EvacuationCenterRoom, EvacuationCenterRoom.id == EvacuationAssignment.room_id)
            .join(EvacuationCenter, EvacuationCenter.id == EvacuationCenterRoom.evacuation_center_id)
            .filter(EvacuationAssignment.resident_id.in_(resident_ids))
            .order_by(EvacuationAssignment.id.asc())
            .all()
        )
        for assignment, room, center in rows:
            if assignment.resident_id not in evacuation_by_resident:
                evacuation_by_resident[assignment.resident_id] = {
                    'assignment_id': assignment.id,
                    'room_id': room.id,
                    'room_number': room.room_number,
                    'center_id': center.id,
                    'center_name': center.name,
                    'assigned_at': assignment.assigned_at.isoformat() if assignment.assigned_at else None,
                    'checked_in_at': assignment.checked_in_at.isoformat() if assignment.checked_in_at else None,
                    'is_checked_in': assignment.checked_in_at is not None,
                }
    members_list = []
    for member in residents:
        m_dict = member.to_dict()
        m_dict['evacuation'] = evacuation_by_resident.get(member.id)
        members_list.append(m_dict)
    result['members'] = members_list
    if result.get('current_room_id'):
        room_assigned = EvacuationAssignment.query.filter_by(room_id=result['current_room_id']).count()
        room_occ = EvacuationAssignment.query.filter(
            EvacuationAssignment.room_id == result['current_room_id'],
            EvacuationAssignment.checked_in_at.isnot(None)
        ).count()
        result['current_room_occupied'] = room_occ
        result['current_room_assigned'] = room_assigned
        result['current_room_available'] = max((result.get('current_room_capacity') or 0) - room_occ, 0)
        result['current_room_unassigned'] = max((result.get('current_room_capacity') or 0) - room_assigned, 0)
    return result


@families_bp.route('/api/families/<int:family_id>', methods=['GET'])
@role_required('admin', 'lgu_personnel')
def get_family(family_id):
    family = db.session.get(Family, family_id)
    if not family:
        return jsonify({'error': 'Family not found'}), 404
    return jsonify(_serialize_family_detail(family))


def _family_duplicate(barangay_id, family_code, head_name):
    active_year = get_or_create_active_year()
    if not active_year:
        return None
    if family_code:
        existing_code = Family.query.filter_by(
            roster_year_id=active_year.id,
            family_code=family_code
        ).first()
        if existing_code:
            return f"Family code '{family_code}' already exists for this roster year."
    if head_name and barangay_id:
        existing_head = Family.query.filter(
            Family.roster_year_id == active_year.id,
            Family.barangay_id == barangay_id,
            func.lower(Family.head_name) == func.lower(head_name)
        ).first()
        if existing_head:
            return f"Family with head '{head_name}' already exists in this barangay for this roster year."
    return None


@families_bp.route('/api/families', methods=['POST'])
@role_required('admin', 'lgu_personnel')
def add_family():
    data = request.get_json(silent=True) or {}
    try:
        barangay_id = int(data.get('barangay_id'))
    except (TypeError, ValueError):
        return jsonify({'error': 'Barangay is required'}), 400

    barangay = db.session.get(Barangay, barangay_id)
    if not barangay:
        return jsonify({'error': 'Barangay not found'}), 404

    head_name = re.sub(r'\s+', ' ', str(data.get('head_name') or '').strip())
    members = data.get('members') or []
    if not isinstance(members, list) or len(members) > 100:
        return jsonify({'error': 'Members must be a list of no more than 100 people'}), 400

    if not head_name and members:
        head_candidate = next((m for m in members if isinstance(m, dict) and m.get('is_head_of_family')), members[0] if isinstance(members[0], dict) else None)
        if head_candidate:
            fn, mn, ln, sf = _member_name(head_candidate)
            head_name = ' '.join(part for part in (fn, mn, ln, sf) if part)

    if not head_name or len(head_name) > 150:
        return jsonify({'error': 'Head of family is required and must be 150 characters or fewer'}), 400

    family_code = re.sub(r'\s+', ' ', str(data.get('family_code') or '').strip())
    if not family_code:
        family_code = f'FAM-{barangay_id}-{uuid.uuid4().hex[:8].upper()}'
    if len(family_code) > 100:
        return jsonify({'error': 'Family code must be 100 characters or fewer'}), 400

    contact_number = str(data.get('contact_number') or '').strip() or None
    address = str(data.get('address') or '').strip() or None
    if contact_number and len(contact_number) > 20:
        return jsonify({'error': 'Contact number must be 20 characters or fewer'}), 400
    if address and len(address) > 255:
        return jsonify({'error': 'Address must be 255 characters or fewer'}), 400

    parsed_members = []
    member_keys = set()
    head_data = None
    for index, member in enumerate(members, start=1):
        if not isinstance(member, dict):
            return jsonify({'error': f'Member {index} must be an object'}), 400
        first_name, middle_name, last_name, suffix = _member_name(member)
        if not first_name or not last_name:
            return jsonify({'error': f'Member {index} needs first and last names'}), 400
        if any(len(part) > 100 for part in (first_name, middle_name, last_name) if part):
            return jsonify({'error': f'Member {index} has a name field longer than 100 characters'}), 400
        if suffix and len(suffix) > 20:
            return jsonify({'error': f'Member {index} suffix must be 20 characters or fewer'}), 400
        name = ' '.join(part for part in (first_name, middle_name, last_name, suffix) if part)
        member_contact = str(member.get('contact_number') or '').strip()
        if len(member_contact) > 20:
            return jsonify({'error': f'Member {index} contact number must be 20 characters or fewer'}), 400
        normalized_name = _normalize_text(name)
        if normalized_name in member_keys:
            return jsonify({'error': f'Duplicate member name: {name}'}), 400
        member_keys.add(normalized_name)

        try:
            dob = date.fromisoformat(str(member.get('date_of_birth'))) if member.get('date_of_birth') else None
            flags = {
                field: _parse_optional_bool(member.get(field), field.replace('_', ' '))
                for field in (
                    'is_head_of_family', 'is_pwd', 'is_pregnant',
                    'is_lactating', 'is_solo_parent', 'needs_assistance',
                )
            }
        except (TypeError, ValueError) as error:
            return jsonify({'error': f'Member {index}: {error}'}), 400
        if dob and dob > date.today():
            return jsonify({'error': f'Member {index} date of birth cannot be in the future'}), 400

        member_data = {
            'first_name': first_name,
            'middle_name': middle_name,
            'last_name': last_name,
            'suffix': suffix,
            'date_of_birth': dob,
            'gender': str(member.get('gender') or '').strip() or None,
            'relationship_to_head': str(member.get('relationship_to_head') or '').strip() or None,
            'contact_number': member_contact or None,
            'disability_type': str(member.get('disability_type') or '').strip() or None,
            'disability_notes': str(member.get('disability_notes') or '').strip() or None,
            'medical_notes': str(member.get('medical_notes') or '').strip() or None,
            'notes': str(member.get('notes') or '').strip() or None,
            'vulnerable_members': str(member.get('vulnerable_members') or '').strip() or None,
            **flags,
        }
        if member_data['gender'] and len(member_data['gender']) > 20:
            return jsonify({'error': f'Member {index} gender must be 20 characters or fewer'}), 400
        if member_data['relationship_to_head'] and len(member_data['relationship_to_head']) > 50:
            return jsonify({'error': f'Member {index} relationship must be 50 characters or fewer'}), 400
        if member_data['disability_type'] and len(member_data['disability_type']) > 100:
            return jsonify({'error': f'Member {index} disability type must be 100 characters or fewer'}), 400
        if member_data['vulnerable_members'] and len(member_data['vulnerable_members']) > 255:
            return jsonify({'error': f'Member {index} vulnerability details must be 255 characters or fewer'}), 400
        if member_data['contact_number'] and len(member_data['contact_number']) > 20:
            return jsonify({'error': f'Member {index} contact number must be 20 characters or fewer'}), 400

        if member_data['is_head_of_family'] or normalized_name == _normalize_text(head_name):
            if head_data is not None:
                return jsonify({'error': 'Only one family member can be marked as the household head'}), 400
            member_data['is_head_of_family'] = True
            if not member_data['relationship_to_head'] or _normalize_text(member_data['relationship_to_head']) == 'self':
                member_data['relationship_to_head'] = 'Household Head'
            head_data = member_data
        else:
            parsed_members.append(member_data)

    if head_data is None:
        head_name_parts = _split_full_name(head_name)
        head_data = {
            'first_name': head_name_parts[0],
            'middle_name': head_name_parts[1],
            'last_name': head_name_parts[2],
            'suffix': None,
            'date_of_birth': None,
            'gender': None,
            'relationship_to_head': 'Household Head',
            'contact_number': contact_number,
            'disability_type': None,
            'disability_notes': None,
            'medical_notes': None,
            'notes': None,
            'vulnerable_members': None,
            'is_head_of_family': True,
            'is_pwd': False,
            'is_pregnant': False,
            'is_lactating': False,
            'is_solo_parent': False,
            'needs_assistance': False,
        }
    else:
        computed_head_name = ' '.join(part for part in (
            head_data['first_name'], head_data['middle_name'],
            head_data['last_name'], head_data['suffix']
        ) if part)
        if _normalize_text(computed_head_name) != _normalize_text(head_name):
            return jsonify({'error': 'Household head details must match the household head name'}), 400
        head_name = computed_head_name

    assignment = data.get('assignment')
    assignment_room = None
    assignment_center = None
    if assignment:
        if not isinstance(assignment, dict):
            return jsonify({'error': 'Assignment must include a center and room'}), 400
        try:
            assignment_center = db.session.get(EvacuationCenter, int(assignment.get('center_id')))
            assignment_room = db.session.get(EvacuationCenterRoom, int(assignment.get('room_id')))
        except (TypeError, ValueError):
            assignment_center = assignment_room = None
        if not assignment_center or not assignment_room:
            return jsonify({'error': 'Selected evacuation center or room was not found'}), 404
        if not assignment_center.is_active or not assignment_room.is_active:
            return jsonify({'error': 'Cannot assign a family to an inactive center or room'}), 400
        if assignment_room.evacuation_center_id != assignment_center.id:
            return jsonify({'error': 'Selected room does not belong to the selected center'}), 400
        occupancy = EvacuationAssignment.query.filter_by(room_id=assignment_room.id).count()
        if occupancy + len(parsed_members) + 1 > assignment_room.capacity:
            return jsonify({
                'error': f'Room does not have enough capacity. Available: {max(assignment_room.capacity - occupancy, 0)}, Needed: {len(parsed_members) + 1}'
            }), 400

    duplicate_error = _family_duplicate(barangay_id, family_code, head_name)
    if duplicate_error:
        return jsonify({'error': duplicate_error}), 409

    active_year = get_or_create_active_year()
    if not active_year:
        return jsonify({'error': 'No active roster year found. Please configure an active roster year first.'}), 400

    member_count = len(parsed_members) + 1
    family = Family(
        roster_year_id=active_year.id,
        barangay_id=barangay_id,
        family_code=family_code,
        head_name=head_name,
        member_count=member_count,
        contact_number=contact_number or head_data.get('contact_number'),
        address=address,
        remarks=str(data.get('remarks') or head_data.get('remarks') or '').strip() or None,
        uploaded_by=get_jwt_identity(),
        evacuation_status='Assigned' if assignment_room else 'Unassigned',
    )

    try:
        db.session.add(family)
        db.session.flush()
        resident_data = [head_data, *parsed_members]
        residents = []
        for member_data in resident_data:
            resident = Resident(
                family_id=family.id,
                first_name=member_data['first_name'],
                middle_name=member_data['middle_name'],
                last_name=member_data['last_name'],
                suffix=member_data['suffix'],
                date_of_birth=member_data['date_of_birth'],
                gender=member_data['gender'],
                relationship_to_head=member_data['relationship_to_head'],
                is_head_of_family=member_data['is_head_of_family'],
                is_pwd=member_data['is_pwd'],
                disability_type=member_data['disability_type'],
                disability_notes=member_data['disability_notes'],
                is_pregnant=member_data['is_pregnant'],
                is_lactating=member_data['is_lactating'],
                is_solo_parent=member_data['is_solo_parent'],
                needs_assistance=member_data['needs_assistance'],
                medical_notes=member_data['medical_notes'],
                notes=member_data['notes'],
                alternate_contact=(
                    str(data.get('alternate_contact') or member_data.get('alternate_contact') or '').strip() or None
                    if member_data['is_head_of_family'] else None
                ),
            )
            db.session.add(resident)
            residents.append(resident)
        if assignment_room:
            db.session.flush()
            db.session.add_all(
                EvacuationAssignment(resident_id=resident.id, room_id=assignment_room.id)
                for resident in residents
            )
        db.session.flush()
        _sync_household_and_barangay(family)
        db.session.add(SystemLog(
            user_id=get_jwt_identity(),
            action=f'Added family {family.family_code} in {barangay.name}',
        ))
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': 'A duplicate family record was detected; review the list and try again.'}), 409

    return jsonify({
        'message': 'Family added successfully',
        'family': _serialize_family_detail(family),
    }), 201


def _parse_member_payload(data, default_is_head=False):
    first_name = str(data.get('first_name') or '').strip()
    middle_name = str(data.get('middle_name') or '').strip() or None
    last_name = str(data.get('last_name') or '').strip()
    suffix = str(data.get('suffix') or '').strip() or None

    if not first_name and not last_name:
        fallback_name = data.get('full_name') or data.get('household_head_name')
        parsed = _split_full_name(fallback_name)
        if parsed:
            first_name, middle_name, last_name = parsed

    if not first_name or not last_name:
        raise ValueError('First name and last name are required')
    if any(len(part) > 100 for part in (first_name, middle_name, last_name) if part):
        raise ValueError('Name fields must be 100 characters or fewer')
    if suffix and len(suffix) > 20:
        raise ValueError('Suffix must be 20 characters or fewer')

    raw_dob = data.get('date_of_birth')
    dob = None
    if raw_dob:
        try:
            dob = date.fromisoformat(str(raw_dob))
        except (TypeError, ValueError):
            raise ValueError('Date of birth must be a valid YYYY-MM-DD date')
        if dob > date.today():
            raise ValueError('Date of birth cannot be in the future')
        if dob.year < 1900:
            raise ValueError('Date of birth must be in or after 1900')

    flags = {}
    for field in (
        'is_head_of_family', 'is_pwd', 'is_pregnant',
        'is_lactating', 'is_solo_parent', 'needs_assistance',
    ):
        if field in data:
            flags[field] = _parse_optional_bool(data.get(field), field.replace('_', ' '))
        elif field == 'is_head_of_family':
            flags[field] = default_is_head
        else:
            flags[field] = False

    contact_number = str(data.get('contact_number') or '').strip() or None
    if contact_number and len(contact_number) > 20:
        raise ValueError('Contact number must be 20 characters or fewer')

    alternate_contact = str(data.get('alternate_contact') or '').strip() or None
    if alternate_contact and len(alternate_contact) > 50:
        raise ValueError('Alternate contact must be 50 characters or fewer')

    gender = str(data.get('gender') or '').strip() or None
    if gender and len(gender) > 20:
        raise ValueError('Gender must be 20 characters or fewer')

    relationship_to_head = str(data.get('relationship_to_head') or '').strip() or None
    if relationship_to_head and len(relationship_to_head) > 50:
        raise ValueError('Relationship must be 50 characters or fewer')

    disability_type = str(data.get('disability_type') or '').strip() or None
    if disability_type and len(disability_type) > 100:
        raise ValueError('Disability type must be 100 characters or fewer')

    vulnerable_members = str(data.get('vulnerable_members') or '').strip() or None
    if vulnerable_members and len(vulnerable_members) > 255:
        raise ValueError('Vulnerability summary must be 255 characters or fewer')

    return {
        'first_name': first_name,
        'middle_name': middle_name,
        'last_name': last_name,
        'suffix': suffix,
        'date_of_birth': dob,
        'gender': gender,
        'relationship_to_head': relationship_to_head,
        'contact_number': contact_number,
        'alternate_contact': alternate_contact,
        'disability_type': disability_type,
        'disability_notes': str(data.get('disability_notes') or '').strip() or None,
        'medical_notes': str(data.get('medical_notes') or '').strip() or None,
        'notes': str(data.get('notes') or '').strip() or None,
        'remarks': str(data.get('remarks') or '').strip() or None,
        'vulnerable_members': vulnerable_members,
        **flags,
    }


# =========================================================
# ADD FAMILY MEMBER
# =========================================================
@families_bp.route(
    '/api/families/<int:family_id>/members',
    methods=['POST']
)
@jwt_required()
@role_required('admin', 'lgu_personnel')
def add_family_member(family_id):
    family = db.session.get(Family, family_id)
    if not family:
        return jsonify({"error": "Family not found"}), 404

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "No data provided"}), 400

    try:
        parsed = _parse_member_payload(data, default_is_head=False)
    except ValueError as err:
        return jsonify({"error": str(err)}), 400

    existing_members = Resident.query.filter_by(family_id=family.id).all()
    new_full_name = ' '.join(part for part in (
        parsed['first_name'], parsed['middle_name'], parsed['last_name'], parsed['suffix']
    ) if part)
    if any(_normalize_text(m.get_full_name()) == _normalize_text(new_full_name) for m in existing_members):
        return jsonify({"error": f"A family member named '{new_full_name}' already exists in this household."}), 409

    has_head = any(m.is_head_of_family for m in existing_members)
    promote_to_head = bool(parsed['is_head_of_family'])
    is_head = promote_to_head or not has_head

    shared_address = (
        str(data.get("address") or "").strip()
        or next((m.address for m in existing_members if m.address), None)
    )
    barangay_name = family.barangay.name if family.barangay else str(data.get("barangay") or "")

    # Check if family currently has an active room assignment
    existing_assignment = (
        db.session.query(EvacuationAssignment)
        .join(Resident, EvacuationAssignment.resident_id == Resident.id)
        .filter(Resident.family_id == family.id)
        .first()
    )
    assigned_room = None
    if existing_assignment:
        assigned_room = db.session.get(EvacuationCenterRoom, existing_assignment.room_id)
        if assigned_room:
            current_occ = EvacuationAssignment.query.filter_by(room_id=assigned_room.id).count()
            if current_occ + 1 > assigned_room.capacity:
                return jsonify({
                    "error": f"Cannot add member while family is assigned to Room {assigned_room.room_number}, which is at full capacity ({current_occ}/{assigned_room.capacity}). Move the family to a larger room first."
                }), 400

    if is_head and has_head:
        for m in existing_members:
            if m.is_head_of_family:
                m.is_head_of_family = False
                if _normalize_text(m.relationship_to_head) in {'self', 'household head', ''}:
                    m.relationship_to_head = str(data.get('previous_head_relationship') or 'Family Member')

    new_count = len(existing_members) + 1
    if shared_address and not family.address:
        family.address = shared_address
    resident = Resident(
        family_id=family.id,
        first_name=parsed['first_name'],
        middle_name=parsed['middle_name'],
        last_name=parsed['last_name'],
        suffix=parsed['suffix'],
        alternate_contact=parsed['alternate_contact'],
        date_of_birth=parsed['date_of_birth'],
        gender=parsed['gender'],
        relationship_to_head='Household Head' if is_head else parsed['relationship_to_head'],
        is_head_of_family=is_head,
        is_pwd=parsed['is_pwd'],
        disability_type=parsed['disability_type'],
        disability_notes=parsed['disability_notes'],
        is_pregnant=parsed['is_pregnant'],
        is_lactating=parsed['is_lactating'],
        is_solo_parent=parsed['is_solo_parent'],
        needs_assistance=parsed['needs_assistance'],
        medical_notes=parsed['medical_notes'],
        notes=parsed['notes'],
    )

    db.session.add(resident)
    db.session.flush()

    if assigned_room:
        db.session.add(EvacuationAssignment(
            resident_id=resident.id,
            room_id=assigned_room.id
        ))
        db.session.flush()

    _sync_household_and_barangay(family)

    db.session.add(SystemLog(
        user_id=get_jwt_identity(),
        action=f"Added member '{resident.get_full_name()}' to family {family.family_code}"
    ))
    db.session.commit()

    return jsonify({
        "message": "Family member added successfully",
        "member": resident.to_dict(),
        "family": _serialize_family_detail(family),
    }), 201


# =========================================================
# UPDATE FAMILY MEMBER
# =========================================================
@families_bp.route(
    '/api/families/<int:family_id>/members/<int:member_id>',
    methods=['PUT']
)
@jwt_required()
@role_required('admin', 'lgu_personnel')
def update_family_member(family_id, member_id):
    family = db.session.get(Family, family_id)
    if not family:
        return jsonify({"error": "Family not found"}), 404

    resident = Resident.query.filter_by(id=member_id, family_id=family.id).first()
    if not resident:
        return jsonify({"error": "Family member not found"}), 404

    data = request.get_json(silent=True) or {}
    try:
        parsed = _parse_member_payload(data, default_is_head=resident.is_head_of_family)
    except ValueError as err:
        return jsonify({"error": str(err)}), 400

    other_members = Resident.query.filter(
        Resident.family_id == family.id,
        Resident.id != resident.id
    ).all()
    updated_full_name = ' '.join(part for part in (
        parsed['first_name'], parsed['middle_name'], parsed['last_name'], parsed['suffix']
    ) if part)
    if any(_normalize_text(m.get_full_name()) == _normalize_text(updated_full_name) for m in other_members):
        return jsonify({"error": f"Another member in this household already has the name '{updated_full_name}'."}), 409

    # Handle household head promotion / demotion rules
    wants_to_be_head = bool(parsed['is_head_of_family'])
    if resident.is_head_of_family and not wants_to_be_head:
        if not any(m.is_head_of_family for m in other_members):
            return jsonify({
                "error": "Every household must have a designated household head. Select another member as the household head instead."
            }), 400

    if wants_to_be_head and not resident.is_head_of_family:
        prev_rel = str(data.get('previous_head_relationship') or 'Family Member').strip() or 'Family Member'
        for m in other_members:
            if m.is_head_of_family:
                m.is_head_of_family = False
                if _normalize_text(m.relationship_to_head) in {'self', 'household head', ''}:
                    m.relationship_to_head = prev_rel
        resident.is_head_of_family = True

    resident.first_name = parsed['first_name']
    resident.middle_name = parsed['middle_name']
    resident.last_name = parsed['last_name']
    resident.suffix = parsed['suffix']
    resident.date_of_birth = parsed['date_of_birth']
    resident.gender = parsed['gender']
    resident.relationship_to_head = (
        'Household Head'
        if resident.is_head_of_family
        else parsed['relationship_to_head']
    )
    if 'contact_number' in data:
        resident.contact_number = parsed['contact_number']
    if 'alternate_contact' in data:
        resident.alternate_contact = parsed['alternate_contact']
    resident.is_pwd = parsed['is_pwd']
    resident.disability_type = parsed['disability_type'] if parsed['is_pwd'] else None
    resident.disability_notes = parsed['disability_notes'] if parsed['is_pwd'] else None
    resident.is_pregnant = parsed['is_pregnant']
    resident.is_lactating = parsed['is_lactating']
    resident.is_solo_parent = parsed['is_solo_parent']
    resident.needs_assistance = parsed['needs_assistance']
    resident.medical_notes = parsed['medical_notes']
    resident.notes = parsed['notes']
    # Vulnerability and remarks now belong to the family level

    if resident.is_head_of_family and parsed['contact_number']:
        family.contact_number = parsed['contact_number']

    db.session.flush()
    _sync_household_and_barangay(family)

    db.session.add(SystemLog(
        user_id=get_jwt_identity(),
        action=f"Updated member '{resident.get_full_name()}' in family {family.family_code}"
    ))
    db.session.commit()

    return jsonify({
        "message": "Member details updated successfully.",
        "member": resident.to_dict(),
        "family": _serialize_family_detail(family),
    }), 200


# =========================================================
# DELETE FAMILY MEMBER
# =========================================================

# =========================================================
# MOVE FAMILY MEMBER TO ANOTHER HOUSEHOLD
# =========================================================
@families_bp.route(
    '/api/families/<int:family_id>/members/<int:member_id>/move',
    methods=['POST']
)
@jwt_required()
@role_required('admin', 'lgu_personnel')
def move_family_member(family_id, member_id):
    source_family = db.session.get(Family, family_id)
    if not source_family:
        return jsonify({"error": "Source family not found"}), 404

    data = request.get_json(silent=True) or {}
    target_family_id = data.get('target_family_id')
    if not target_family_id:
        return jsonify({"error": "target_family_id is required"}), 400

    target_family = db.session.get(Family, int(target_family_id))
    if not target_family:
        return jsonify({"error": "Target family not found"}), 404

    resident = Resident.query.filter_by(id=member_id, family_id=source_family.id).first()
    if not resident:
        return jsonify({"error": "Family member not found in source family"}), 404

    source_members = Resident.query.filter_by(family_id=source_family.id).all()
    if len(source_members) <= 1:
        return jsonify({"error": "Cannot move the only member of a household. Delete the household instead."}), 400

    if resident.is_head_of_family:
        replacement_head_id = data.get('replacement_head_id')
        if not replacement_head_id:
            return jsonify({"error": "replacement_head_id is required when moving the household head"}), 400
        replacement = next((m for m in source_members if m.id == int(replacement_head_id) and m.id != resident.id), None)
        if not replacement:
            return jsonify({"error": "Valid replacement household head from source household is required"}), 400
        replacement.is_head_of_family = True
        replacement.relationship_to_head = 'Household Head'
        source_family.head_name = replacement.get_full_name()

    resident.is_head_of_family = False
    resident.relationship_to_head = str(data.get('relationship_to_head') or 'Family Member')
    resident.family_id = target_family.id

    db.session.flush()
    _sync_household_and_barangay(source_family)
    _sync_household_and_barangay(target_family)

    db.session.add(SystemLog(
        user_id=get_jwt_identity(),
        action=f"Moved member '{resident.get_full_name()}' from family {source_family.family_code} to {target_family.family_code}"
    ))
    db.session.commit()

    return jsonify({
        "message": f"Moved '{resident.get_full_name()}' to family {target_family.family_code} successfully.",
        "source_family": _serialize_family_detail(source_family),
        "target_family": _serialize_family_detail(target_family),
    }), 200

@families_bp.route(
    '/api/families/<int:family_id>/members/<int:member_id>',
    methods=['DELETE']
)
@jwt_required()
@role_required('admin', 'lgu_personnel')
def delete_family_member(family_id, member_id):
    family = db.session.get(Family, family_id)
    if not family:
        return jsonify({"error": "Family not found"}), 404

    resident = Resident.query.filter_by(id=member_id, family_id=family.id).first()
    if not resident:
        return jsonify({"error": "Family member not found"}), 404

    total_members = Resident.query.filter_by(family_id=family.id).count()
    if total_members <= 1:
        return jsonify({
            "error": "A household must have at least one member. Delete the household record if you want to remove the entire household."
        }), 400

    if resident.is_head_of_family:
        body = request.get_json(silent=True) or {}
        replacement_head_id = request.args.get('replacement_head_id') or body.get('replacement_head_id')
        if not replacement_head_id:
            return jsonify({
                "error": "Cannot remove the household head while other members remain. Designate another member as the household head first."
            }), 400
        try:
            replacement = Resident.query.filter_by(
                id=int(replacement_head_id),
                family_id=family.id
            ).first()
        except (TypeError, ValueError):
            replacement = None
        if not replacement or replacement.id == resident.id:
            return jsonify({
                "error": "Valid replacement household head from the same household is required."
            }), 400
        replacement.is_head_of_family = True
        replacement.relationship_to_head = 'Household Head'
        resident.is_head_of_family = False

    member_name = resident.get_full_name()
    EvacuationAssignment.query.filter_by(resident_id=resident.id).delete()
    db.session.delete(resident)
    db.session.flush()

    _sync_household_and_barangay(family)

    db.session.add(SystemLog(
        user_id=get_jwt_identity(),
        action=f"Removed member '{member_name}' from family {family.family_code}"
    ))
    db.session.commit()

    return jsonify({
        "message": f"Removed '{member_name}' from the household.",
        "family": _serialize_family_detail(family),
    }), 200


# =========================================================
# GET FAMILY MEMBERS
# =========================================================
@families_bp.route(
    '/api/families/<int:family_id>/members',
    methods=['GET']
)
@jwt_required()
@role_required('admin', 'lgu_personnel')
def get_family_members(family_id):

    family = db.session.get(Family, family_id)

    if not family:
        return jsonify({
            "error": "Family not found"
        }), 404

    members = Resident.query.filter_by(
        family_id=family_id
    ).order_by(
        Resident.is_head_of_family.desc(),
        Resident.id.asc()
    ).all()

    return jsonify([
        member.to_dict()
        for member in members
    ]), 200


# =========================================================
# ASSIGN FAMILY TO EVACUATION CENTER ROOM
# =========================================================
@families_bp.route('/api/families/<int:family_id>/assign', methods=['POST'])
@role_required('admin', 'lgu_personnel')
def assign_family(family_id):
    family = Family.query.get_or_404(family_id)
    data = request.get_json() or {}

    center_id = data.get('center_id')
    room_id = data.get('room_id')

    if not center_id:
        return jsonify({"error": "Center ID is required"}), 400

    center = EvacuationCenter.query.get(center_id)
    if not center:
        return jsonify({"error": "Evacuation center not found"}), 404
    if not center.is_active:
        return jsonify({"error": "Cannot assign to an inactive evacuation center"}), 400

    # Enforce center_type rules for room_id
    center_type = center.center_type or 'campus'
    if center_type in ('campus', 'private_property'):
        # campus and private_property: room_id is REQUIRED
        if not room_id:
            return jsonify({"error": f"Room ID is required for {center_type} type centers"}), 400
    elif center_type == 'single_venue':
        # single_venue: room_id is OPTIONAL (direct assignment to center)
        # room_id can be None for direct venue assignment
        pass
    else:
        # Fallback: require room_id
        if not room_id:
            return jsonify({"error": "Room ID is required"}), 400

    room = None
    if room_id:
        room = EvacuationCenterRoom.query.get(room_id)
        if not room:
            return jsonify({"error": "Room not found"}), 404
        if not room.is_active:
            return jsonify({"error": "Cannot assign to an inactive room"}), 400
        if room.evacuation_center_id != center.id:
            return jsonify({"error": "Room does not belong to the selected evacuation center"}), 400

        # Check building status for campus type
        if center_type == 'campus' and room.building:
            if room.building.status != 'open':
                return jsonify({"error": f"Cannot assign to a room in a building with status '{room.building.status}'. Only 'open' buildings can receive new assignments."}), 400

    # A family must not have multiple active assignments
    existing_assignment = (
        db.session.query(EvacuationAssignment)
        .join(Resident, EvacuationAssignment.resident_id == Resident.id)
        .filter(Resident.family_id == family.id)
        .first()
    )
    if existing_assignment:
        return jsonify({"error": "Family already has an active assignment. Use the move option to change rooms or shelters."}), 400

    residents = _sync_household_and_barangay(family)
    needed_spaces = len(residents)

    if room:
        current_occupancy = EvacuationAssignment.query.filter_by(room_id=room.id).count()
        remaining = max(room.capacity - current_occupancy, 0)
        if current_occupancy + needed_spaces > room.capacity:
            return jsonify({
                "error": f"Room does not have enough capacity. Available: {remaining}, Needed: {needed_spaces}",
                "capacity": room.capacity,
                "occupied": current_occupancy,
                "available": remaining,
                "needed": needed_spaces
            }), 400
    else:
        # Direct venue assignment (single_venue)
        current_center_assigned = (
            db.session.query(func.count(EvacuationAssignment.id))
            .outerjoin(EvacuationCenterRoom, EvacuationAssignment.room_id == EvacuationCenterRoom.id)
            .filter(or_(
                EvacuationAssignment.evacuation_center_id == center.id,
                EvacuationCenterRoom.evacuation_center_id == center.id
            ))
            .scalar() or 0
        )
        effective_cap = center.capacity if center.capacity is not None else sum(r.capacity or 0 for r in center.rooms)
        if effective_cap > 0 and current_center_assigned + needed_spaces > effective_cap:
            remaining = max(effective_cap - current_center_assigned, 0)
            return jsonify({
                "error": f"Center does not have enough capacity. Available: {remaining}, Needed: {needed_spaces}",
                "capacity": effective_cap,
                "occupied": current_center_assigned,
                "available": remaining,
                "needed": needed_spaces
            }), 400

    for resident in residents:
        db.session.add(EvacuationAssignment(
            resident_id=resident.id,
            room_id=room.id if room else None,
            evacuation_center_id=center.id
        ))

    family.evacuation_status = "Assigned"
    user_id = get_jwt_identity()
    target_desc = f"{center.name} - Room {room.room_number}" if room else center.name
    db.session.add(SystemLog(
        user_id=user_id,
        action=f"Assigned family '{family.head_name}' ({family.family_code}) to {target_desc}"
    ))
    db.session.commit()

    return jsonify({
        "message": f"Family '{family.head_name}' successfully assigned to {target_desc}.",
        "family_id": family.id,
        "center_id": center.id,
        "center_name": center.name,
        "room_id": room.id if room else None,
        "room_number": room.room_number if room else None,
        "is_assigned": True,
        "assignment_status": "Assigned"
    }), 200


# =========================================================
# MOVE FAMILY TO ANOTHER ROOM / CENTER
# =========================================================
@families_bp.route('/api/families/<int:family_id>/move', methods=['POST'])
@role_required('admin', 'lgu_personnel')
def move_family(family_id):
    family = Family.query.get_or_404(family_id)
    data = request.get_json() or {}

    new_room_id = data.get('room_id')
    new_center_id = data.get('center_id')

    if not new_room_id and not new_center_id:
        return jsonify({"error": "Target center or room ID is required"}), 400

    target_center = None
    new_room = None

    if new_room_id:
        new_room = EvacuationCenterRoom.query.get(new_room_id)
        if not new_room:
            return jsonify({"error": "Target room not found"}), 404
        if not new_room.is_active:
            return jsonify({"error": "Cannot move to an inactive room"}), 400

        target_center = EvacuationCenter.query.get(new_room.evacuation_center_id)
        if not target_center or not target_center.is_active:
            return jsonify({"error": "Target evacuation center is inactive or not found"}), 400

        if new_center_id and int(new_center_id) != target_center.id:
            return jsonify({"error": "Target room does not belong to the selected evacuation center"}), 400
    else:
        target_center = EvacuationCenter.query.get(new_center_id)
        if not target_center or not target_center.is_active:
            return jsonify({"error": "Target evacuation center is inactive or not found"}), 400

    # Enforce center_type rules for room_id
    target_center_type = target_center.center_type or 'campus'
    if target_center_type in ('campus', 'private_property'):
        # campus and private_property: room_id is REQUIRED
        if not new_room:
            return jsonify({"error": f"Room ID is required for {target_center_type} type centers"}), 400
    elif target_center_type == 'single_venue':
        # single_venue: room_id is OPTIONAL (direct assignment to center)
        pass
    else:
        # Fallback: require room_id
        if not new_room:
            return jsonify({"error": "Room ID is required"}), 400

    # Check building status for campus type
    if target_center_type == 'campus' and new_room and new_room.building:
        if new_room.building.status != 'open':
            return jsonify({"error": f"Cannot move to a room in a building with status '{new_room.building.status}'. Only 'open' buildings can receive new assignments."}), 400

    current_assignments = (
        db.session.query(EvacuationAssignment)
        .join(Resident, EvacuationAssignment.resident_id == Resident.id)
        .filter(Resident.family_id == family.id)
        .all()
    )
    if not current_assignments:
        return jsonify({"error": "Family has no active assignments to move. Use assign instead."}), 400

    old_room_id = current_assignments[0].room_id
    old_center_id = current_assignments[0].evacuation_center_id
    if new_room and old_room_id == new_room.id:
        return jsonify({"error": "Family is already in this room."}), 400
    if not new_room and old_room_id is None and old_center_id == target_center.id:
        return jsonify({"error": "Family is already assigned directly to this shelter."}), 400

    old_room = EvacuationCenterRoom.query.get(old_room_id) if old_room_id else None
    old_center = EvacuationCenter.query.get(old_center_id) if old_center_id else (old_room.evacuation_center if old_room else None)

    members_count = len(current_assignments)

    if new_room:
        target_occupancy = EvacuationAssignment.query.filter_by(room_id=new_room.id).count()
        remaining = max(new_room.capacity - target_occupancy, 0)
        if target_occupancy + members_count > new_room.capacity:
            return jsonify({
                "error": f"Target room does not have enough capacity. Available: {remaining}, Needed: {members_count}",
                "capacity": new_room.capacity,
                "occupied": target_occupancy,
                "available": remaining,
                "needed": members_count
            }), 400
    else:
        target_occupancy = (
            db.session.query(func.count(EvacuationAssignment.id))
            .outerjoin(EvacuationCenterRoom, EvacuationAssignment.room_id == EvacuationCenterRoom.id)
            .filter(or_(
                EvacuationAssignment.evacuation_center_id == target_center.id,
                EvacuationCenterRoom.evacuation_center_id == target_center.id
            ))
            .scalar() or 0
        )
        effective_cap = target_center.capacity if target_center.capacity is not None else sum(r.capacity or 0 for r in target_center.rooms)
        if effective_cap > 0 and target_occupancy + members_count > effective_cap:
            remaining = max(effective_cap - target_occupancy, 0)
            return jsonify({
                "error": f"Target shelter does not have enough capacity. Available: {remaining}, Needed: {members_count}",
                "capacity": effective_cap,
                "occupied": target_occupancy,
                "available": remaining,
                "needed": members_count
            }), 400

    for assignment in current_assignments:
        assignment.room_id = new_room.id if new_room else None
        assignment.evacuation_center_id = target_center.id

    family.evacuation_status = "Assigned"
    user_id = get_jwt_identity()
    old_desc = f"{old_center.name} - Room {old_room.room_number}" if (old_center and old_room) else (f"Room {old_room.room_number}" if old_room else (old_center.name if old_center else "previous shelter"))
    new_desc = f"{target_center.name} - Room {new_room.room_number}" if new_room else target_center.name
    db.session.add(SystemLog(
        user_id=user_id,
        action=f"Moved family '{family.head_name}' ({family.family_code}) from {old_desc} to {new_desc}"
    ))
    db.session.commit()

    return jsonify({
        "message": f"Family '{family.head_name}' moved to {new_desc} successfully.",
        "family_id": family.id,
        "center_id": target_center.id,
        "center_name": target_center.name,
        "room_id": new_room.id if new_room else None,
        "room_number": new_room.room_number if new_room else None,
        "is_assigned": True,
        "assignment_status": "Assigned"
    }), 200


# =========================================================
# UNASSIGN / REMOVE FAMILY FROM ROOM
# =========================================================
@families_bp.route('/api/families/<int:family_id>/unassign', methods=['POST', 'DELETE'])
@role_required('admin', 'lgu_personnel')
def unassign_family(family_id):
    family = Family.query.get_or_404(family_id)

    current_assignments = (
        db.session.query(EvacuationAssignment)
        .join(Resident, EvacuationAssignment.resident_id == Resident.id)
        .filter(Resident.family_id == family.id)
        .all()
    )

    if not current_assignments:
        return jsonify({"message": "Family is not currently assigned to any room."}), 200

    room_id = current_assignments[0].room_id
    center_id = current_assignments[0].evacuation_center_id
    room = EvacuationCenterRoom.query.get(room_id) if room_id else None
    center = EvacuationCenter.query.get(center_id) if center_id else (room.evacuation_center if room else None)
    shelter_desc = f"{center.name} - Room {room.room_number}" if (center and room) else (f"Room {room.room_number}" if room else (center.name if center else "assigned shelter"))

    for assignment in current_assignments:
        db.session.delete(assignment)

    family.evacuation_status = "Unassigned"

    user_id = get_jwt_identity()
    db.session.add(SystemLog(
        user_id=user_id,
        action=f"Unassigned family '{family.head_name}' ({family.family_code}) from {shelter_desc}"
    ))
    db.session.commit()

    return jsonify({
        "message": f"Family '{family.head_name}' has been unassigned successfully.",
        "family_id": family.id,
        "is_assigned": False,
        "assignment_status": "Unassigned"
    }), 200


# =========================================================
# UPDATE FAMILY DETAILS
# =========================================================
@families_bp.route('/api/families/<int:family_id>', methods=['PUT'])
@role_required('admin', 'lgu_personnel')
def update_family(family_id):
    family = Family.query.get_or_404(family_id)
    data = request.get_json() or {}
    old_barangay_id = family.barangay_id

    if 'barangay_id' in data:
        try:
            bid = int(data['barangay_id'])
            brgy = db.session.get(Barangay, bid)
            if brgy:
                family.barangay_id = brgy.id
        except (ValueError, TypeError):
            pass

    if 'contact_number' in data:
        family.contact_number = str(data['contact_number'] or '').strip() or None

    residents = (
        Resident.query.filter_by(family_id=family.id)
        .order_by(Resident.is_head_of_family.desc(), Resident.id.asc())
        .all()
    )

    # Support changing the designated household head to an existing resident of this household
    head_resident_id = data.get('head_resident_id')
    if head_resident_id is not None and str(head_resident_id).strip() != '':
        try:
            target_head = next(
                (r for r in residents if r.id == int(head_resident_id)),
                None,
            )
        except (TypeError, ValueError):
            target_head = None
        if not target_head:
            return jsonify({"error": "Selected household head does not belong to this household."}), 400
        prev_rel = str(data.get('previous_head_relationship') or 'Family Member').strip() or 'Family Member'
        for r in residents:
            if r.id == target_head.id:
                r.is_head_of_family = True
                r.relationship_to_head = 'Household Head'
            elif r.is_head_of_family:
                r.is_head_of_family = False
                if _normalize_text(r.relationship_to_head) in {'self', 'household head', ''}:
                    r.relationship_to_head = prev_rel
        family.head_name = target_head.get_full_name()
    elif 'head_name' in data:
        head_name = re.sub(r'\s+', ' ', str(data.get('head_name') or '').strip())
        if head_name:
            # Check if head_name matches another existing member of this household
            matching_member = next(
                (r for r in residents if _normalize_text(r.get_full_name()) == _normalize_text(head_name)),
                None,
            )
            if matching_member and not matching_member.is_head_of_family:
                for r in residents:
                    if r.id == matching_member.id:
                        r.is_head_of_family = True
                        r.relationship_to_head = 'Household Head'
                    elif r.is_head_of_family:
                        r.is_head_of_family = False
                        if _normalize_text(r.relationship_to_head) in {'self', 'household head', ''}:
                            r.relationship_to_head = 'Family Member'
                family.head_name = matching_member.get_full_name()
            else:
                head_res = next((r for r in residents if r.is_head_of_family), residents[0] if residents else None)
                if head_res and _normalize_text(head_res.get_full_name()) != _normalize_text(head_name):
                    parsed_parts = _split_full_name(head_name)
                    if parsed_parts:
                        head_res.first_name = parsed_parts[0]
                        head_res.middle_name = parsed_parts[1]
                        head_res.last_name = parsed_parts[2]
                        head_res.suffix = None
                family.head_name = head_name

    if 'address' in data:
        family.address = str(data.get('address') or '').strip() or None
    if 'remarks' in data:
        family.remarks = str(data.get('remarks') or '').strip() or None
    if 'vulnerable_members' in data:
        family.vulnerable_members = str(data.get('vulnerable_members') or '').strip() or None

    head_resident = next(
        (resident for resident in residents if resident.is_head_of_family),
        residents[0] if residents else None,
    )
    if head_resident and 'alternate_contact' in data:
        head_resident.alternate_contact = str(data.get('alternate_contact') or '').strip() or None

    db.session.flush()
    _sync_household_and_barangay(family, old_barangay_id=old_barangay_id)

    user_id = get_jwt_identity()
    db.session.add(SystemLog(
        user_id=user_id,
        action=f"Updated family details for '{family.head_name}' ({family.family_code})"
    ))
    db.session.commit()

    return jsonify({
        "message": "Family details updated successfully.",
        "family": _serialize_family_detail(family)
    }), 200


# =========================================================
# DELETE FAMILY (SAFE CHECK)
# =========================================================
@families_bp.route('/api/families/<int:family_id>', methods=['DELETE'])
@role_required('admin', 'lgu_personnel')
def delete_family(family_id):
    family = Family.query.get_or_404(family_id)

    active_assignments = (
        db.session.query(EvacuationAssignment)
        .join(Resident, EvacuationAssignment.resident_id == Resident.id)
        .filter(Resident.family_id == family.id)
        .count()
    )
    if active_assignments > 0:
        return jsonify({
            "error": "Cannot delete family with active room assignment. Please unassign the family first."
        }), 400

    barangay_id = family.barangay_id
    head_name = family.head_name
    family_code = family.family_code

    Resident.query.filter_by(family_id=family.id).delete()
    db.session.delete(family)
    db.session.flush()

    _sync_barangay_population(barangay_id)

    user_id = get_jwt_identity()
    db.session.add(SystemLog(
        user_id=user_id,
        action=f"Deleted family '{head_name}' ({family_code})"
    ))
    db.session.commit()

    return jsonify({"message": f"Family '{head_name}' deleted successfully."}), 200


# =========================================================
# GET ROSTER YEARS (ADMIN-ONLY)
# =========================================================
@families_bp.route('/api/roster-years', methods=['GET'])
@jwt_required()
@role_required('admin')
def get_roster_years():
    get_or_create_active_year()

    counts = dict(
        db.session.query(
            Family.roster_year_id,
            func.count(Family.id)
        )
        .group_by(Family.roster_year_id)
        .all()
    )

    years = RosterYear.query.order_by(RosterYear.year.desc()).all()
    return jsonify([
        {
            'id': y.id,
            'year': y.year,
            'is_active': bool(y.is_active),
            'households': counts.get(y.id, 0),
            'household_count': counts.get(y.id, 0),
        }
        for y in years
    ]), 200


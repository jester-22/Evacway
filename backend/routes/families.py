import csv
import io
import re
import uuid
import time
from datetime import date
from collections import defaultdict

from flask import Blueprint, request, jsonify, Response
from flask_jwt_extended import jwt_required
from openpyxl import Workbook
from openpyxl import load_workbook
from sqlalchemy import false, func, or_
from sqlalchemy.exc import IntegrityError
from flask_jwt_extended import get_jwt_identity

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
    'rooms', 'assigned_members', 'evacuation_status',
]


def _normalize_text(value):
    return re.sub(r'\s+', ' ', str(value or '').strip()).casefold()


def _sync_barangay_population(barangay_id):
    if not barangay_id:
        return
    barangay = db.session.get(Barangay, int(barangay_id))
    if not barangay:
        return
    pop_count = (
        db.session.query(func.count(Resident.id))
        .join(Family, Resident.family_id == Family.id)
        .filter(Family.barangay_id == barangay.id)
        .scalar()
    ) or 0
    barangay.population = pop_count


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
            household_head_name=family.head_name,
            barangay=barangay_name,
            contact_number=family.contact_number,
            family_members=1,
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
        for r in residents:
            r.family_members = count
            if family.head_name:
                r.household_head_name = family.head_name
            if barangay_name:
                r.barangay = barangay_name
    else:
        family.member_count = 0

    _sync_barangay_population(family.barangay_id)
    if old_barangay_id and int(old_barangay_id) != int(family.barangay_id or 0):
        _sync_barangay_population(old_barangay_id)

    return residents


def _family_query(search='', barangay_id='', assignment_status=''):
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
            func.count(EvacuationAssignment.id),
        )
        .join(EvacuationAssignment, EvacuationAssignment.resident_id == Resident.id)
        .join(EvacuationCenterRoom, EvacuationAssignment.room_id == EvacuationCenterRoom.id)
        .join(EvacuationCenter, EvacuationCenterRoom.evacuation_center_id == EvacuationCenter.id)
        .filter(Resident.family_id.in_(family_ids))
        .group_by(
            Resident.family_id,
            EvacuationCenter.id,
            EvacuationCenter.name,
            EvacuationCenterRoom.id,
            EvacuationCenterRoom.room_number,
            EvacuationCenterRoom.capacity,
        )
        .all()
    )
    assignments_by_family = defaultdict(list)
    for family_id, center_id, center_name, room_id, room_number, room_capacity, assigned_count in assignment_rows:
        assignments_by_family[family_id].append({
            'center_id': center_id,
            'center': center_name,
            'room_id': room_id,
            'room': room_number,
            'room_capacity': room_capacity,
            'assigned_members': assigned_count,
        })

    result = []
    for family in families:
        family_members = members_by_family.get(family.id, [])
        assignments = assignments_by_family.get(family.id, [])
        head_member = next((m for m in family_members if m.is_head_of_family), None)
        first_member = head_member or (family_members[0] if family_members else None)
        primary_assignment = assignments[0] if assignments else None
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
            'evacuation_center': ', '.join(dict.fromkeys(item['center'] for item in assignments)) or None,
            'rooms': ', '.join(dict.fromkeys(item['room'] for item in assignments)) or None,
            'current_center_id': primary_assignment['center_id'] if primary_assignment else None,
            'current_room_id': primary_assignment['room_id'] if primary_assignment else None,
            'current_center': primary_assignment['center'] if primary_assignment else None,
            'current_room': primary_assignment['room'] if primary_assignment else None,
            'current_room_capacity': primary_assignment['room_capacity'] if primary_assignment else None,
            'assigned_members': sum(item['assigned_members'] for item in assignments),
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
    query = _family_query(search, barangay_id, assignment_status)

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


def _family_duplicate(barangay_id, family_code, head_name):
    if Family.query.filter(func.lower(Family.family_code) == family_code.casefold()).first():
        return 'Family code already exists.'

    possible = Family.query.filter_by(barangay_id=barangay_id).all()
    if any(_normalize_text(item.head_name) == _normalize_text(head_name) for item in possible):
        return 'A family with this head already exists in the selected barangay.'
    return None


def _normalize_header(value):
    return re.sub(r'[^a-z0-9]+', '_', str(value or '').strip().casefold()).strip('_')


FAMILY_IMPORT_HEADERS = {
    'household_id': {'household_id', 'family_id', 'household_no', 'household_number'},
    'family_code': {'family_code', 'household_code'},
    'head_name': {'head_of_family', 'head_name', 'household_head_name', 'household_head', 'family_head_name'},
    'barangay': {'barangay', 'barangay_name'},
    'contact_number': {'contact_number', 'contact', 'family_contact', 'mobile_number'},
    'address': {'address', 'purok', 'address_purok'},
    'first_name': {'member_first_name', 'first_name'},
    'middle_name': {'member_middle_name', 'middle_name'},
    'last_name': {'member_last_name', 'last_name'},
    'member_contact': {'member_contact_number', 'member_contact'},
}


def _preview_family_workbook(file_storage):
    filename = str(file_storage.filename or '')
    if not filename.casefold().endswith('.xlsx'):
        return {'families': [], 'errors': [{'row': 0, 'message': 'Upload an .xlsx file.'}], 'rows': 0}

    try:
        workbook = load_workbook(io.BytesIO(file_storage.read()), read_only=True, data_only=True)
        worksheet = workbook.active
        values = worksheet.iter_rows(values_only=True)
        headers = next(values, None)
    except Exception:
        return {'families': [], 'errors': [{'row': 0, 'message': 'The workbook could not be read.'}], 'rows': 0}

    if not headers:
        return {'families': [], 'errors': [{'row': 1, 'message': 'The worksheet is empty.'}], 'rows': 0}

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
            'rows': 0,
        }

    errors = []
    families_by_key = {}
    row_count = 0

    def cell(row, key):
        index = column_indexes.get(key)
        if index is None or index >= len(row):
            return ''
        val = row[index]
        if val is None:
            return ''
        if isinstance(val, float) and val.is_integer():
            return str(int(val))
        if isinstance(val, int) and not isinstance(val, bool):
            return str(val)
        return re.sub(r'\s+', ' ', str(val).strip())

    for row_number, row in enumerate(values, start=2):
        if not row or not any(value is not None and str(value).strip() for value in row):
            continue
        row_count += 1
        household_id = cell(row, 'household_id')
        family_code = cell(row, 'family_code') or household_id
        head_name = cell(row, 'head_name')
        barangay_name = cell(row, 'barangay')
        address = cell(row, 'address')
        first_name = cell(row, 'first_name')
        middle_name = cell(row, 'middle_name')
        last_name = cell(row, 'last_name')

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

        barangay = Barangay.query.filter(func.lower(Barangay.name) == barangay_name.casefold()).first()
        if not barangay:
            errors.append({'row': row_number, 'message': f'Barangay "{barangay_name}" is not registered.'})
            continue

        if not family_code:
            brgy_part = (re.sub(r'[^A-Za-z0-9]+', '', barangay.name).upper() or 'BRGY')[:18]
            head_part = (re.sub(r'[^A-Za-z0-9]+', '', head_name).upper() or 'FAMILY')[:24]
            family_code = f'{brgy_part}-{head_part}'[:50]

        if len(family_code) > 50 or len(head_name) > 150:
            errors.append({'row': row_number, 'message': 'Family Code or Head of Family exceeds its maximum length.'})
            continue

        if household_id:
            import_key = ('id', barangay.id, household_id.casefold())
        elif cell(row, 'family_code'):
            import_key = ('code', barangay.id, family_code.casefold())
        else:
            import_key = ('composite', barangay.id, _normalize_text(head_name), _normalize_text(address))

        metadata = {
            'family_code': family_code,
            'head_name': head_name,
            'barangay_id': barangay.id,
            'barangay': barangay.name,
            'contact_number': cell(row, 'contact_number') or None,
            'address': address or None,
            'members': [],
            'source_rows': [],
        }
        existing_group = families_by_key.get(import_key)
        if existing_group is None:
            families_by_key[import_key] = metadata
            existing_group = metadata
        elif (
            existing_group['barangay_id'] != barangay.id
            or _normalize_text(existing_group['head_name']) != _normalize_text(head_name)
        ):
            errors.append({'row': row_number, 'message': 'Rows sharing a Family Code must have the same head and barangay.'})
            continue

        member_name = ' '.join(part for part in (first_name, middle_name, last_name) if part)
        member_key = _normalize_text(member_name)
        if any(_normalize_text(item['full_name']) == member_key for item in existing_group['members']):
            errors.append({'row': row_number, 'message': f'Duplicate member "{member_name}" for Family Code {family_code}.'})
            continue

        existing_group['members'].append({
            'first_name': first_name,
            'middle_name': middle_name or None,
            'last_name': last_name,
            'full_name': member_name,
            'contact_number': cell(row, 'member_contact') or existing_group['contact_number'],
        })
        existing_group['source_rows'].append(row_number)

    families = list(families_by_key.values())
    seen_identities = set()
    for family in families:
        identity = (family['barangay_id'], _normalize_text(family['head_name']), _normalize_text(family.get('address') or ''))
        if identity in seen_identities:
            errors.append({'row': family['source_rows'][0], 'message': 'Duplicate head and barangay found with another Family Code in this workbook.'})
        seen_identities.add(identity)

        if not any(_normalize_text(member['full_name']) == _normalize_text(family['head_name']) for member in family['members']):
            errors.append({'row': family['source_rows'][0], 'message': 'The household head must also appear among this family’s member rows.'})

        duplicate = _family_duplicate(family['barangay_id'], family['family_code'], family['head_name'])
        if duplicate:
            errors.append({'row': family['source_rows'][0], 'message': duplicate})

        family['member_count'] = len(family['members'])

    return {'families': families, 'errors': errors, 'rows': row_count}


@families_bp.route('/api/families/import', methods=['POST'])
@role_required('admin')
def import_families():
    file_storage = request.files.get('file')
    if not file_storage:
        return jsonify({'error': 'Choose an .xlsx file to import.'}), 400

    preview = _preview_family_workbook(file_storage)
    commit_requested = str(request.form.get('commit', '')).casefold() == 'true'
    result = {
        'families': [
            {key: family[key] for key in ('family_code', 'head_name', 'barangay', 'contact_number', 'address', 'member_count')}
            for family in preview['families']
        ],
        'errors': preview['errors'],
        'rows': preview['rows'],
        'can_import': bool(preview['families']) and not preview['errors'],
    }

    if not commit_requested:
        return jsonify(result), 200
    if not result['can_import']:
        return jsonify({**result, 'error': 'Resolve all import errors before committing.'}), 400

    created_count = 0
    affected_barangay_ids = set()
    try:
        for item in preview['families']:
            family = Family(
                barangay_id=item['barangay_id'],
                family_code=item['family_code'],
                head_name=item['head_name'],
                member_count=item['member_count'],
                contact_number=item['contact_number'],
                evacuation_status='Unassigned',
            )
            db.session.add(family)
            db.session.flush()
            affected_barangay_ids.add(item['barangay_id'])
            for member in item['members']:
                is_head = _normalize_text(member['full_name']) == _normalize_text(item['head_name'])
                db.session.add(Resident(
                    family_id=family.id,
                    first_name=member['first_name'],
                    middle_name=member['middle_name'],
                    last_name=member['last_name'],
                    household_head_name=item['head_name'],
                    barangay=item['barangay'],
                    address=item['address'],
                    contact_number=member['contact_number'],
                    family_members=item['member_count'],
                    is_head_of_family=is_head,
                    relationship_to_head='Household Head' if is_head else None,
                    uploaded_by=get_jwt_identity(),
                ))
            db.session.flush()
            _sync_household_and_barangay(family)
            created_count += 1
        for bid in affected_barangay_ids:
            _sync_barangay_population(bid)
        db.session.add(SystemLog(
            user_id=get_jwt_identity(),
            action=f'Imported {created_count} families from Excel',
        ))
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({'error': 'Import failed. No family records were committed.'}), 500

    return jsonify({
        'message': f'Imported {created_count} families ({preview["rows"]} member rows).',
        'successful_families': created_count,
        'successful_rows': preview['rows'],
        'families_created': created_count,
        'residents_created': preview['rows'],
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

    file_bytes = file_storage.read()

    # File: not empty
    if len(file_bytes) == 0:
        return jsonify({'error': 'The uploaded file is empty.'}), 400

    # File: size limit
    if len(file_bytes) > MAX_FILE_SIZE:
        return jsonify({
            'error': f'File too large. Maximum size is {MAX_FILE_SIZE // (1024 * 1024)} MB.'
        }), 400

    # File: content type by magic bytes (not just extension)
    if not file_bytes.startswith(EXCEL_MAGIC):
        return jsonify({
            'error': 'The file does not appear to be a valid Excel (.xlsx) file.'
        }), 400

    # File: readable encoding / parseable as a workbook
    try:
        wrapper = _BytesFileWrapper(file_bytes, file_storage.filename or 'import.xlsx')
        preview = _preview_family_workbook(wrapper)
    except Exception:
        return jsonify({
            'error': 'The workbook could not be read. It may be corrupted or use an unsupported format.'
        }), 400

    # Stage the validated data (nothing written to live database yet)
    token = str(uuid.uuid4())
    STAGED_IMPORTS[token] = {
        'preview': preview,
        'filename': file_storage.filename or 'import.xlsx',
        'expires_at': time.time() + STAGING_TTL_SECONDS,
        'created_by': get_jwt_identity(),
    }
    _cleanup_staged_imports()

    return jsonify({
        'staging_token': token,
        'expires_in': STAGING_TTL_SECONDS,
        'filename': file_storage.filename,
        'families': preview['families'],
        'errors': preview['errors'],
        'rows': preview['rows'],
        'can_import': bool(preview['families']) and not preview['errors'],
    }), 200


# ---------------------------------------------------------
# COMMIT: Require a valid staging token, re-validate, save in one transaction
# ---------------------------------------------------------
@families_bp.route('/api/families/import/commit', methods=['POST'])
@role_required('admin')
def commit_family_import():
    data = request.get_json(silent=True) or {}
    token = data.get('staging_token')

    if not token:
        return jsonify({
            'error': 'A staging token is required. Please validate the file first.'
        }), 400

    staged = STAGED_IMPORTS.get(token)
    if not staged:
        return jsonify({
            'error': 'Import session not found or has expired. Please re-upload the file.'
        }), 400

    # Check expiry
    if time.time() > staged['expires_at']:
        del STAGED_IMPORTS[token]
        return jsonify({
            'error': 'Import session has expired. Please re-upload the file.'
        }), 400

    preview = staged['preview']

    # Re-validate: any error blocks the commit
    if preview['errors']:
        return jsonify({'error': 'Validation errors found. Cannot commit.'}), 400

    if not preview['families']:
        return jsonify({'error': 'No valid families to import.'}), 400

    # Save in a single database transaction: all or nothing
    created_count = 0
    affected_barangay_ids = set()
    try:
        for item in preview['families']:
            family = Family(
                barangay_id=item['barangay_id'],
                family_code=item['family_code'],
                head_name=item['head_name'],
                member_count=item['member_count'],
                contact_number=item['contact_number'],
                evacuation_status='Unassigned',
            )
            db.session.add(family)
            db.session.flush()
            affected_barangay_ids.add(item['barangay_id'])
            for member in item['members']:
                is_head = _normalize_text(member['full_name']) == _normalize_text(item['head_name'])
                db.session.add(Resident(
                    family_id=family.id,
                    first_name=member['first_name'],
                    middle_name=member['middle_name'],
                    last_name=member['last_name'],
                    household_head_name=item['head_name'],
                    barangay=item['barangay'],
                    address=item['address'],
                    contact_number=member['contact_number'],
                    family_members=item['member_count'],
                    is_head_of_family=is_head,
                    relationship_to_head='Household Head' if is_head else None,
                    uploaded_by=get_jwt_identity(),
                ))
            db.session.flush()
            _sync_household_and_barangay(family)
            created_count += 1
        for bid in affected_barangay_ids:
            _sync_barangay_population(bid)
        db.session.add(SystemLog(
            user_id=get_jwt_identity(),
            action=f'Imported {created_count} families from Excel',
        ))
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({'error': 'Import failed. No family records were committed.'}), 500

    # Remove the staged import after successful commit
    del STAGED_IMPORTS[token]
    _cleanup_staged_imports()

    return jsonify({
        'message': f'Imported {created_count} families ({preview["rows"]} member rows).',
        'successful_families': created_count,
        'successful_rows': preview['rows'],
        'families_created': created_count,
        'residents_created': preview['rows'],
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
                }
    members_list = []
    for member in residents:
        m_dict = member.to_dict()
        m_dict['evacuation'] = evacuation_by_resident.get(member.id)
        members_list.append(m_dict)
    result['members'] = members_list
    if result.get('current_room_id'):
        room_occ = EvacuationAssignment.query.filter_by(room_id=result['current_room_id']).count()
        result['current_room_occupied'] = room_occ
        result['current_room_available'] = max((result.get('current_room_capacity') or 0) - room_occ, 0)
    return result


@families_bp.route('/api/families/<int:family_id>', methods=['GET'])
@role_required('admin', 'lgu_personnel')
def get_family(family_id):
    family = db.session.get(Family, family_id)
    if not family:
        return jsonify({'error': 'Family not found'}), 404
    return jsonify(_serialize_family_detail(family))


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

    member_count = len(parsed_members) + 1
    family = Family(
        barangay_id=barangay_id,
        family_code=family_code,
        head_name=head_name,
        member_count=member_count,
        contact_number=contact_number or head_data.get('contact_number'),
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
                household_head_name=head_name,
                barangay=barangay.name,
                address=address,
                contact_number=member_data['contact_number'] or contact_number,
                family_members=member_count,
                uploaded_by=get_jwt_identity(),
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
                vulnerable_members=member_data['vulnerable_members'],
                alternate_contact=(
                    str(data.get('alternate_contact') or member_data.get('alternate_contact') or '').strip() or None
                    if member_data['is_head_of_family'] else None
                ),
                remarks=(
                    str(data.get('remarks') or member_data.get('remarks') or '').strip() or None
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
    resident = Resident(
        family_id=family.id,
        first_name=parsed['first_name'],
        middle_name=parsed['middle_name'],
        last_name=parsed['last_name'],
        suffix=parsed['suffix'],
        household_head_name=family.head_name,
        barangay=barangay_name,
        address=shared_address,
        contact_number=parsed['contact_number'] or family.contact_number,
        alternate_contact=parsed['alternate_contact'],
        family_members=new_count,
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
        vulnerable_members=parsed['vulnerable_members'],
        remarks=parsed['remarks'],
        uploaded_by=get_jwt_identity(),
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
    resident.vulnerable_members = parsed['vulnerable_members']
    if 'remarks' in data:
        resident.remarks = parsed['remarks']

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

    if not center_id or not room_id:
        return jsonify({"error": "Center ID and Room ID are required"}), 400

    center = EvacuationCenter.query.get(center_id)
    if not center:
        return jsonify({"error": "Evacuation center not found"}), 404
    if not center.is_active:
        return jsonify({"error": "Cannot assign to an inactive evacuation center"}), 400

    room = EvacuationCenterRoom.query.get(room_id)
    if not room:
        return jsonify({"error": "Room not found"}), 404
    if not room.is_active:
        return jsonify({"error": "Cannot assign to an inactive room"}), 400
    if room.evacuation_center_id != center.id:
        return jsonify({"error": "Room does not belong to the selected evacuation center"}), 400

    # A family must not have multiple active room assignments
    existing_assignment = (
        db.session.query(EvacuationAssignment)
        .join(Resident, EvacuationAssignment.resident_id == Resident.id)
        .filter(Resident.family_id == family.id)
        .first()
    )
    if existing_assignment:
        return jsonify({"error": "Family already has an active room assignment. Use the move option to change rooms."}), 400

    residents = _sync_household_and_barangay(family)

    needed_spaces = len(residents)
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

    for resident in residents:
        db.session.add(EvacuationAssignment(resident_id=resident.id, room_id=room.id))

    family.evacuation_status = "Assigned"
    user_id = get_jwt_identity()
    db.session.add(SystemLog(
        user_id=user_id,
        action=f"Assigned family '{family.head_name}' ({family.family_code}) to {center.name} - Room {room.room_number}"
    ))
    db.session.commit()

    return jsonify({
        "message": f"Family '{family.head_name}' successfully assigned to Room {room.room_number}.",
        "family_id": family.id,
        "center_id": center.id,
        "center_name": center.name,
        "room_id": room.id,
        "room_number": room.room_number,
        "room_capacity": room.capacity,
        "room_occupied": current_occupancy + needed_spaces,
        "room_available": max(room.capacity - (current_occupancy + needed_spaces), 0),
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

    if not new_room_id:
        return jsonify({"error": "Target room ID is required"}), 400

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

    current_assignments = (
        db.session.query(EvacuationAssignment)
        .join(Resident, EvacuationAssignment.resident_id == Resident.id)
        .filter(Resident.family_id == family.id)
        .all()
    )
    if not current_assignments:
        return jsonify({"error": "Family has no active assignments to move. Use assign instead."}), 400

    if current_assignments[0].room_id == new_room.id:
        return jsonify({"error": "Family is already in this room."}), 400

    old_room = EvacuationCenterRoom.query.get(current_assignments[0].room_id)

    members_count = len(current_assignments)
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

    for assignment in current_assignments:
        assignment.room_id = new_room.id

    family.evacuation_status = "Assigned"
    user_id = get_jwt_identity()
    old_room_desc = f"Room {old_room.room_number}" if old_room else "previous room"
    db.session.add(SystemLog(
        user_id=user_id,
        action=f"Moved family '{family.head_name}' ({family.family_code}) from {old_room_desc} to {target_center.name} - Room {new_room.room_number}"
    ))
    db.session.commit()

    return jsonify({
        "message": f"Family '{family.head_name}' moved to Room {new_room.room_number} successfully.",
        "family_id": family.id,
        "center_id": target_center.id,
        "center_name": target_center.name,
        "room_id": new_room.id,
        "room_number": new_room.room_number,
        "new_room_occupied": target_occupancy + members_count,
        "new_room_available": max(new_room.capacity - (target_occupancy + members_count), 0),
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
    room = EvacuationCenterRoom.query.get(room_id)
    room_number = room.room_number if room else "Room"

    for assignment in current_assignments:
        db.session.delete(assignment)

    family.evacuation_status = "Unassigned"

    user_id = get_jwt_identity()
    db.session.add(SystemLog(
        user_id=user_id,
        action=f"Unassigned family '{family.head_name}' ({family.family_code}) from {room_number}"
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

    address = str(data.get('address') or '').strip() or None
    head_resident = next(
        (resident for resident in residents if resident.is_head_of_family),
        residents[0] if residents else None,
    )
    for resident in residents:
        if 'address' in data:
            resident.address = address
        if family.barangay:
            resident.barangay = family.barangay.name
        if family.head_name:
            resident.household_head_name = family.head_name
    if head_resident and 'alternate_contact' in data:
        head_resident.alternate_contact = str(data.get('alternate_contact') or '').strip() or None
    if head_resident and 'remarks' in data:
        head_resident.remarks = str(data.get('remarks') or '').strip() or None

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
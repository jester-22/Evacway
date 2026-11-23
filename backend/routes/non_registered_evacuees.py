import io
import uuid
from datetime import datetime, timezone
from functools import wraps

from flask import Blueprint, jsonify, request, Response
from flask_jwt_extended import get_jwt_identity
from openpyxl import Workbook
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError

from models import db, NonRegisteredEvacuee, EvacuationCenter, EvacuationCenterRoom, Resident, SystemLog, PHILIPPINES_TZ, to_utc_iso
from services.non_registered_evacuees import (
    PERSON_FIELDS, table_ready, resolve_operation, validate_person, parse_timestamp, center_occupancy,
)
from utils import role_required

nre_bp = Blueprint('non_registered_evacuees', __name__)


class InvalidInput(Exception):
    def __init__(self, fields, status=422):
        self.fields, self.status = fields, status


def staff_endpoint(function):
    @wraps(function)
    def wrapped(*args, **kwargs):
        if not table_ready():
            return jsonify(error='Apply the non-registered arrivals and room-assignment migrations first.'), 503
        try:
            return function(*args, **kwargs)
        except InvalidInput as error:
            db.session.rollback()
            return jsonify(error='Please correct the highlighted fields.', fields=error.fields), error.status
        except IntegrityError:
            db.session.rollback()
            return jsonify(error='The group changed or contains invalid values. Refresh and retry.'), 409
    return role_required('admin', 'lgu_personnel')(wrapped)


def audit(action):
    db.session.add(SystemLog(user_id=int(get_jwt_identity()), action=action))


def positive_id(value, field):
    try:
        if isinstance(value, bool) or str(int(value)) != str(value) or int(value) < 1:
            raise ValueError()
        return int(value)
    except (TypeError, ValueError):
        raise InvalidInput({field: 'Select a valid record.'})


def operation_for(value=None, center_id=None, writable=False):
    if value not in (None, '', 'active', 'all'):
        value = positive_id(value, 'operation_id')
    operation = resolve_operation(value, center_id)
    if writable and (not operation or operation.status != 'active'):
        raise InvalidInput({'operation_id': 'Select an active operation first.'}, 409)
    if operation and center_id and operation.center_id not in (None, center_id):
        raise InvalidInput({'center_id': 'This shelter is not part of the selected operation.'})
    return operation


def body():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise InvalidInput({'request': 'Send a JSON object.'})
    return data


def group_rows(code, lock=False):
    try:
        code = str(uuid.UUID(str(code)))
    except ValueError:
        raise InvalidInput({'group_code': 'Invalid group code.'}, 404)
    query = NonRegisteredEvacuee.query.filter_by(group_code=code).order_by(
        NonRegisteredEvacuee.is_group_head.desc(), NonRegisteredEvacuee.id.asc())
    rows = (query.with_for_update() if lock else query).all()
    if not rows:
        raise InvalidInput({'group_code': 'Group not found.'}, 404)
    return rows


def serialize_group(rows, sensitive=False):
    head = next(row for row in rows if row.is_group_head)
    present = sum(row.departed_at is None for row in rows)
    return {
        'group_code': str(head.group_code), 'head_name': head.to_dict()['name'],
        'people_count': len(rows), 'present_count': present,
        'center_id': head.center_id, 'center_name': head.center.name,
        'room_id': head.room_id,
        'room_name': head.room.room_number if head.room else None,
        'building_name': head.room.building.name if head.room and head.room.building else None,
        'floor': head.room.floor if head.room else None,
        'operation_id': head.operation_id, 'operation_name': head.operation.event_name,
        'arrived_at': to_utc_iso(min(row.arrived_at for row in rows)),
        'status': 'present' if present == len(rows) else ('departed' if not present else 'partial'),
        'members': [row.to_dict(sensitive) for row in rows],
    }


def filtered_query():
    center = request.args.get('center_id')
    center = positive_id(center, 'center_id') if center not in (None, '', 'all') else None
    operation = operation_for(request.args.get('operation_id'), center)
    query = NonRegisteredEvacuee.query
    if not operation:
        return query.filter(False), None
    query = query.filter_by(operation_id=operation.id)
    if center:
        query = query.filter_by(center_id=center)
    status = request.args.get('status', 'all')
    if status not in ('all', 'present', 'departed'):
        raise InvalidInput({'status': 'Choose all, present or departed.'})
    if status == 'present':
        query = query.filter(NonRegisteredEvacuee.departed_at.is_(None))
    elif status == 'departed':
        query = query.filter(NonRegisteredEvacuee.departed_at.isnot(None))
    search = request.args.get('q', '').strip()[:200]
    if search:
        name = NonRegisteredEvacuee.first_name + ' ' + func.coalesce(NonRegisteredEvacuee.middle_name, '') + ' ' + NonRegisteredEvacuee.last_name
        query = query.filter(or_(
            name.icontains(search, autoescape=True),
            (NonRegisteredEvacuee.first_name + ' ' + NonRegisteredEvacuee.last_name).icontains(search, autoescape=True),
            NonRegisteredEvacuee.contact_number.icontains(search.replace(' ', '').replace('-', ''), autoescape=True),
            NonRegisteredEvacuee.address.icontains(search, autoescape=True),
        ))
    return query, operation


@nre_bp.route('/api/non-registered-evacuees', methods=['POST'])
@staff_endpoint
def create_group():
    data = body()
    center_id = positive_id(data.get('center_id'), 'center_id')
    center = db.session.get(EvacuationCenter, center_id)
    if not center or not center.is_active or center.evacuation_status in ('closed', 'concluded'):
        raise InvalidInput({'center_id': 'Select an open, active shelter.'})
    if center.geom is None:
        raise InvalidInput({'center_id': 'This shelter is not mapped yet. Place the shelter on the map before assigning evacuees.'})
    structure_mode = getattr(center, 'structure_mode', None) or 'buildings_and_rooms'
    if structure_mode == 'buildings_and_rooms' and not any(
        b.geom is not None and (b.status or 'open') == 'open' for b in (center.buildings or [])
    ):
        raise InvalidInput({'center_id': 'This shelter has no mapped buildings yet. Place at least one open building on the map first.'})
    operation = operation_for(data.get('operation_id'), center_id, writable=True)
    people = data.get('people')
    if not isinstance(people, list) or not 1 <= len(people) <= 30:
        raise InvalidInput({'people': 'Add between 1 and 30 people.'})
    validated, errors = [], {}
    for index, person in enumerate(people):
        values, fields = validate_person(person)
        validated.append(values)
        errors.update({f'people.{index}.{key}': value for key, value in fields.items()})
    if errors:
        raise InvalidInput(errors)
    room_id = positive_id(data.get('room_id'), 'room_id') if data.get('room_id') not in (None, '') else None
    room = None
    if room_id is not None:
        room = EvacuationCenterRoom.query.filter_by(id=room_id, evacuation_center_id=center_id, is_active=True).with_for_update().first()
        if room is None:
            raise InvalidInput({'room_id': 'Choose an active room in the selected shelter.'})
        if structure_mode == 'buildings_and_rooms':
            if room.building is None:
                raise InvalidInput({'room_id': 'Choose a room that belongs to a mapped building.'})
            if room.building.status != 'open':
                raise InvalidInput({'room_id': 'Choose a room in an open building.'})
            if room.building.geom is None:
                raise InvalidInput({'room_id': 'This room’s building is not mapped yet. Choose a room in a mapped building.'})
        elif room.building is not None and room.building.status != 'open':
            raise InvalidInput({'room_id': 'Choose a room in an open building.'})
        usage = room.capacity_usage()
        needed_slots = 1 if len(validated) > 1 else 0
        if usage['available_slots'] < needed_slots:
            raise InvalidInput({'room_id': 'This room has no available family slots. Choose another room.'})
        if usage['available_spaces'] < len(validated):
            raise InvalidInput({'room_id': f"This room has only {usage['available_spaces']} people spaces left; {len(validated)} are needed."})
    now = datetime.now(timezone.utc)
    code = str(uuid.uuid4())
    rows = [NonRegisteredEvacuee(**person, group_code=code, is_group_head=index == 0,
            operation_id=operation.id, center_id=center_id, room_id=room.id if room else None, arrived_at=now,
            recorded_by=int(get_jwt_identity())) for index, person in enumerate(validated)]
    db.session.add_all(rows)
    audit(f'Created non-registered arrival group ({len(rows)} people), operation #{operation.id}')
    db.session.commit()
    return jsonify(group=serialize_group(rows), occupancy=center_occupancy(center_id, operation), capacity=center.capacity), 201


@nre_bp.route('/api/non-registered-evacuees', methods=['GET'])
@staff_endpoint
def list_groups():
    query, operation = filtered_query()
    try:
        page, per_page = int(request.args.get('page', 1)), int(request.args.get('per_page', 10))
        if page < 1 or not 1 <= per_page <= 100:
            raise ValueError()
    except ValueError:
        raise InvalidInput({'page': 'Use a positive page and 1–100 rows per page.'})
    grouped = query.with_entities(NonRegisteredEvacuee.group_code, func.min(NonRegisteredEvacuee.arrived_at).label('arrival')).group_by(NonRegisteredEvacuee.group_code)
    total = grouped.count()
    selected = grouped.order_by(db.desc('arrival'), NonRegisteredEvacuee.group_code).offset((page - 1) * per_page).limit(per_page).all()
    codes = [row.group_code for row in selected]
    rows = NonRegisteredEvacuee.query.filter(NonRegisteredEvacuee.group_code.in_(codes)).order_by(NonRegisteredEvacuee.is_group_head.desc(), NonRegisteredEvacuee.id).all() if codes else []
    groups = {code: [] for code in codes}
    for row in rows:
        groups[row.group_code].append(row)
    # Summary ignores search/status, but respects the selected shelter and operation.
    base = NonRegisteredEvacuee.query.filter_by(operation_id=operation.id) if operation else NonRegisteredEvacuee.query.filter(False)
    center = request.args.get('center_id')
    if center not in (None, '', 'all'):
        base = base.filter_by(center_id=int(center))
    return jsonify(groups=[serialize_group(groups[code]) for code in codes], total=total, page=page, per_page=per_page,
                   summary={'people': base.count(), 'groups': base.with_entities(NonRegisteredEvacuee.group_code).distinct().count(),
                            'present': base.filter(NonRegisteredEvacuee.departed_at.is_(None)).count()})


@nre_bp.route('/api/non-registered-evacuees/groups/<code>', methods=['GET'])
@staff_endpoint
def get_group(code):
    rows = group_rows(code)
    sensitive = request.args.get('include_sensitive') == 'true'
    if sensitive:
        audit(f'Viewed non-registered contact numbers and medical needs, operation #{rows[0].operation_id}')
        db.session.commit()
    return jsonify(group=serialize_group(rows, sensitive))


@nre_bp.route('/api/non-registered-evacuees/<int:person_id>', methods=['PATCH'])
@staff_endpoint
def update_person(person_id):
    person = db.get_or_404(NonRegisteredEvacuee, person_id)
    group_rows(person.group_code, lock=True)
    operation_for(person.operation_id, person.center_id, writable=True)
    data = body()
    if set(data) - set(PERSON_FIELDS):
        raise InvalidInput({'request': 'Only personal details may be edited here.'})
    values, fields = validate_person(data, person)
    if fields:
        raise InvalidInput(fields)
    for key, value in values.items():
        setattr(person, key, value)
    audit(f'Updated non-registered arrival record #{person.id}')
    db.session.commit()
    return jsonify(person=person.to_dict())


@nre_bp.route('/api/non-registered-evacuees/groups/<code>/members', methods=['POST'])
@staff_endpoint
def add_member(code):
    rows = group_rows(code, lock=True)
    head = rows[0]
    operation_for(head.operation_id, head.center_id, writable=True)
    if len(rows) >= 30:
        raise InvalidInput({'people': 'A group may contain at most 30 people.'})
    values, fields = validate_person(body())
    if fields:
        raise InvalidInput(fields)
    if head.room_id:
        room = EvacuationCenterRoom.query.filter_by(id=head.room_id, is_active=True).with_for_update().first()
        if not room:
            raise InvalidInput({'room_id': 'The assigned room is no longer available.'})
        if room.building is not None and room.building.status != 'open':
            raise InvalidInput({'room_id': 'The assigned room is in a building that is closed or under repair.'})
        usage = room.capacity_usage()
        present_in_room = sum(1 for row in rows if row.room_id == head.room_id and row.departed_at is None)
        if present_in_room == 1 and usage['available_slots'] < 1:
            raise InvalidInput({'room_id': 'Adding a member turns this individual arrival into a family, and this room has no available family slots.'})
        if usage['available_spaces'] < 1:
            raise InvalidInput({'room_id': 'This room has no remaining people spaces. Move the group or choose another room before adding a member.'})
    person = NonRegisteredEvacuee(**values, group_code=head.group_code, is_group_head=False,
        center_id=head.center_id, room_id=head.room_id, operation_id=head.operation_id, arrived_at=datetime.now(timezone.utc), recorded_by=int(get_jwt_identity()))
    db.session.add(person)
    audit(f'Added a member to non-registered group, operation #{head.operation_id}')
    db.session.commit()
    return jsonify(person=person.to_dict()), 201


def change_departure(rows, data):
    operation_for(rows[0].operation_id, rows[0].center_id, writable=True)
    if type(data.get('departed')) is not bool:
        raise InvalidInput({'departed': 'Use true to mark departed or false to undo.'})
    if not data['departed']:
        returning = [row for row in rows if row.departed_at is not None]
        room_id = next((row.room_id for row in rows if row.room_id is not None), None)
        if returning and room_id is not None:
            room = EvacuationCenterRoom.query.filter_by(id=room_id, is_active=True).with_for_update().first()
            if room is None:
                raise InvalidInput({'room_id': 'The assigned room is no longer available.'})
            if room.building is not None and room.building.status != 'open':
                raise InvalidInput({'room_id': 'The assigned room is in a building that is closed or under repair.'})
            usage = room.capacity_usage()
            all_group_rows = NonRegisteredEvacuee.query.filter_by(group_code=rows[0].group_code).all()
            present_before = sum(1 for row in all_group_rows if row.room_id == room_id and row.departed_at is None)
            present_after = present_before + len(returning)
            slots_before = 1 if present_before > 1 else 0
            slots_after = 1 if present_after > 1 else 0
            needed_slots = max(0, slots_after - slots_before)
            if usage['available_slots'] < needed_slots:
                raise InvalidInput({'room_id': 'This room has no available family slots. Choose another room before restoring this arrival.'})
            if usage['available_spaces'] < len(returning):
                raise InvalidInput({'room_id': f"This room has only {usage['available_spaces']} people spaces left; {len(returning)} are needed to restore this arrival."})
    timestamp = None
    if data['departed']:
        try:
            timestamp = parse_timestamp(data['departed_at']) if data.get('departed_at') else datetime.now(timezone.utc)
        except (TypeError, ValueError, AttributeError):
            raise InvalidInput({'departed_at': 'Enter a valid date and time including timezone.'})
        for row in rows:
            arrival = row.arrived_at if row.arrived_at.tzinfo else row.arrived_at.replace(tzinfo=timezone.utc)
            if timestamp < arrival:
                raise InvalidInput({'departed_at': 'Departure must not be earlier than arrival.'})
    for row in rows:
        row.departed_at = timestamp
    audit(f'{"Departed" if timestamp else "Undid departure for"} non-registered arrivals ({len(rows)} people), operation #{rows[0].operation_id}')
    db.session.commit()
    return jsonify(message='Departure saved.' if timestamp else 'Arrival restored.')


@nre_bp.route('/api/non-registered-evacuees/<int:person_id>/departure', methods=['POST'])
@staff_endpoint
def depart_person(person_id):
    person = db.get_or_404(NonRegisteredEvacuee, person_id)
    rows = group_rows(person.group_code, lock=True)
    return change_departure([next(row for row in rows if row.id == person_id)], body())


@nre_bp.route('/api/non-registered-evacuees/groups/<code>/departure', methods=['POST'])
@staff_endpoint
def depart_group(code):
    return change_departure(group_rows(code, lock=True), body())


@nre_bp.route('/api/non-registered-evacuees/<int:person_id>', methods=['DELETE'])
@role_required('admin')
@staff_endpoint
def delete_person(person_id):
    person = db.get_or_404(NonRegisteredEvacuee, person_id)
    rows = group_rows(person.group_code, lock=True)
    if person.is_group_head and len(rows) > 1:
        person.is_group_head = False
        db.session.flush()
        next(row for row in rows if row.id != person.id).is_group_head = True
    db.session.delete(person)
    audit(f'Deleted non-registered arrival record #{person_id}')
    db.session.commit()
    return jsonify(message='Record deleted.')


@nre_bp.route('/api/non-registered-evacuees/duplicates', methods=['GET'])
@staff_endpoint
def duplicate_names():
    search = request.args.get('q', '').strip()[:120]
    operation = operation_for(request.args.get('operation_id'))
    if len(search) < 2 or not operation:
        return jsonify(matches=[])
    terms = search.split()
    query = NonRegisteredEvacuee.query.filter_by(operation_id=operation.id)
    residents = Resident.query
    for term in terms:
        query = query.filter(or_(*[getattr(NonRegisteredEvacuee, key).icontains(term, autoescape=True) for key in ('first_name', 'middle_name', 'last_name')]))
        residents = residents.filter(or_(*[getattr(Resident, key).icontains(term, autoescape=True) for key in ('first_name', 'middle_name', 'last_name')]))
    matches = [{**row.to_dict(), 'source': 'non_registered'} for row in query.order_by(NonRegisteredEvacuee.id).limit(5).all()]
    for row in residents.order_by(Resident.id).limit(5 - len(matches)).all():
        birthday = row.date_of_birth
        today = datetime.now(PHILIPPINES_TZ).date()
        age = today.year - birthday.year - ((today.month, today.day) < (birthday.month, birthday.day)) if birthday else None
        matches.append({'id': row.id, 'source': 'resident', 'name': row.get_full_name(),
            'first_name': row.first_name, 'middle_name': row.middle_name, 'last_name': row.last_name,
            'sex': (row.gender or '').lower(), 'age_years': age, 'birthdate': birthday.isoformat() if birthday else None})
    return jsonify(matches=matches)


def add_export_sheet(workbook, operation_id=None, center_id=None, search='', status='all'):
    if not table_ready():
        return
    operation = resolve_operation(operation_id, int(center_id) if str(center_id).isdigit() else None)
    sheet = workbook.create_sheet('Non-registered arrivals')
    sheet.append(['Category', 'First name', 'Middle name', 'Last name', 'Sex', 'Age', 'Address', 'Shelter',
                  'Operation', 'Arrival', 'Departure', 'Group', 'Contact number', 'PWD', 'Pregnant', 'Lactating',
                  'Solo parent', 'Needs assistance', 'Needs medical', 'Notes'])
    query = NonRegisteredEvacuee.query.filter_by(operation_id=operation.id) if operation else NonRegisteredEvacuee.query.filter(False)
    if str(center_id).isdigit():
        query = query.filter_by(center_id=int(center_id))
    if search:
        name = NonRegisteredEvacuee.first_name + ' ' + NonRegisteredEvacuee.last_name
        query = query.filter(or_(name.icontains(search, autoescape=True), NonRegisteredEvacuee.address.icontains(search, autoescape=True), NonRegisteredEvacuee.contact_number.icontains(search, autoescape=True)))
    if status in ('present', 'checked_in'):
        query = query.filter(NonRegisteredEvacuee.departed_at.is_(None))
    elif status == 'departed':
        query = query.filter(NonRegisteredEvacuee.departed_at.isnot(None))
    for row in query.order_by(NonRegisteredEvacuee.group_code, NonRegisteredEvacuee.is_group_head.desc(), NonRegisteredEvacuee.id).all():
        values = ['Non-registered', row.first_name, row.middle_name, row.last_name, row.sex, row.age_years,
            row.address, row.center.name, row.operation.event_name, to_utc_iso(row.arrived_at),
            to_utc_iso(row.departed_at) or '', str(row.group_code), row.contact_number,
            row.is_pwd, row.is_pregnant, row.is_lactating, row.is_solo_parent, row.needs_assistance,
            row.needs_medical, row.notes]
        sheet.append(values)
        # Preserve exact strings (including +63 contacts) without executing formulas.
        for cell in sheet[sheet.max_row]:
            if isinstance(cell.value, str):
                cell.data_type = 's'
    sheet.freeze_panes = 'A2'
    sheet.auto_filter.ref = sheet.dimensions
    for column in sheet.columns:
        sheet.column_dimensions[column[0].column_letter].width = 24
    audit(f'Exported non-registered contacts and medical needs, operation #{operation.id if operation else "none"}')
    db.session.commit()


@nre_bp.route('/api/non-registered-evacuees/export', methods=['GET'])
@staff_endpoint
def export_groups():
    _, operation = filtered_query()
    workbook = Workbook()
    workbook.remove(workbook.active)
    add_export_sheet(workbook, operation.id if operation else None, request.args.get('center_id'), request.args.get('q', ''), request.args.get('status', 'all'))
    output = io.BytesIO()
    workbook.save(output)
    return Response(output.getvalue(), mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    headers={'Content-Disposition': 'attachment; filename=EvacWay-Non-registered-Arrival-Report.xlsx'})

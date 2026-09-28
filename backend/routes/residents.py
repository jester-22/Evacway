import re

import pandas as pd

from flask import Blueprint, request, jsonify
from flask_jwt_extended import get_jwt_identity

from models import (
    db,
    Resident,
    Family,
    Barangay,
    EvacuationCenter,
    EvacuationCenterRoom,
    EvacuationAssignment,
    SystemLog
)

from utils import role_required


residents_bp = Blueprint('residents', __name__)


# =========================================================
# EXCEL COLUMN MAP
# =========================================================

COLUMN_MAP = {

    # -----------------------------------------------------
    # RESIDENT
    # -----------------------------------------------------

    "first name": "first_name",
    "first_name": "first_name",

    "middle name": "middle_name",
    "middle_name": "middle_name",

    "last name": "last_name",
    "last_name": "last_name",

    "household head name": "household_head_name",
    "household_head_name": "household_head_name",

    "barangay": "barangay",

    "address / purok": "address",
    "address": "address",
    "purok": "address",

    "contact": "contact_number",
    "contact number": "contact_number",
    "contact_number": "contact_number",

    "family members": "family_members",
    "family_members": "family_members",

    "vulnerable members": "vulnerable_members",
    "vulnerable_members": "vulnerable_members",

    "remarks": "remarks",

    # -----------------------------------------------------
    # EVACUATION CENTER
    # -----------------------------------------------------

    "evacuation center": "evacuation_center",
    "evacuation_center": "evacuation_center",
    "center": "evacuation_center",
    "center name": "evacuation_center",
    "center_name": "evacuation_center",

    "center capacity": "center_capacity",
    "center_capacity": "center_capacity",

    "building material": "building_material",
    "building_material": "building_material",

    "accessibility notes": "accessibility_notes",
    "accessibility_notes": "accessibility_notes",

    "center contact": "center_contact",
    "center_contact": "center_contact",

    # -----------------------------------------------------
    # ROOM
    # -----------------------------------------------------

    "room number": "room_number",
    "room_number": "room_number",
    "room": "room_number",

    "room capacity": "room_capacity",
    "room_capacity": "room_capacity"
}


# =========================================================
# CLEAN CELL VALUE
# =========================================================

def clean_value(value):

    if value is None:
        return None

    if pd.isna(value):
        return None

    value = str(value).strip()

    if not value:
        return None

    # Remove Excel .0 from numbers
    if value.endswith(".0"):

        try:

            number = float(value)

            if number.is_integer():
                value = str(int(number))

        except (ValueError, TypeError):
            pass

    return value


# =========================================================
# NORMALIZE EXCEL COLUMN NAMES
# =========================================================

def normalize_columns(df):

    normalized_columns = []

    for column in df.columns:

        column_name = str(column).strip().lower()

        column_name = re.sub(
            r"\s+",
            " ",
            column_name
        )

        normalized_columns.append(
            column_name
        )

    df.columns = normalized_columns

    rename_map = {}

    for column in df.columns:

        if column in COLUMN_MAP:

            rename_map[column] = COLUMN_MAP[column]

    return df.rename(
        columns=rename_map
    )


# =========================================================
# NORMALIZE BARANGAY
# =========================================================

def normalize_barangay_name(name):

    value = clean_value(name)

    if not value:
        return None

    value = re.sub(
        r"\s+",
        " ",
        value
    )

    return value.strip().lower()


# =========================================================
# NORMALIZE NAME
# =========================================================

def normalize_name(name):

    value = clean_value(name)

    if not value:
        return None

    value = re.sub(
        r"\s+",
        " ",
        value
    )

    return value.strip().lower()


# =========================================================
# NORMALIZE TEXT
# =========================================================

def normalize_text(value):

    value = clean_value(value)

    if not value:
        return None

    value = re.sub(
        r"\s+",
        " ",
        value
    )

    return value.strip().lower()


# =========================================================
# NAME MATCH (for resident "find my center" lookup)
# =========================================================
#
# Used only for the public-facing lookup, where residents
# may type a partial name, a different word order, or a
# name missing a middle initial. This is intentionally more
# forgiving than the exact-match normalize_name() comparisons
# used during Excel import / dedup.
#
# =========================================================

def _name_matches(
    query_normalized,
    target_normalized
):

    if not query_normalized or not target_normalized:
        return False

    if query_normalized == target_normalized:
        return True

    if query_normalized in target_normalized:
        return True

    query_tokens = set(
        query_normalized.split()
    )

    target_tokens = set(
        target_normalized.split()
    )

    return (
        len(query_tokens) > 0
        and query_tokens.issubset(target_tokens)
    )


# =========================================================
# FAMILY CODE
# =========================================================

def make_family_code(
    barangay_name,
    household_head_name
):

    barangay_part = re.sub(
        r"[^A-Za-z0-9]+",
        "",
        barangay_name
    ).upper()

    head_part = re.sub(
        r"[^A-Za-z0-9]+",
        "",
        household_head_name
    ).upper()

    if not barangay_part:
        barangay_part = "BRGY"

    if not head_part:
        head_part = "FAMILY"

    return (
        f"{barangay_part}-"
        f"{head_part}"
    )


# =========================================================
# FIND BARANGAY
# =========================================================

def find_barangay(barangay_name):

    normalized_name = normalize_barangay_name(
        barangay_name
    )

    if not normalized_name:
        return None

    barangays = Barangay.query.all()

    for barangay in barangays:

        existing_name = normalize_barangay_name(
            barangay.name
        )

        if existing_name == normalized_name:

            return barangay

    return None


# =========================================================
# FIND FAMILY
# =========================================================

def find_family(
    barangay_id,
    household_head_name
):

    normalized_head = normalize_name(
        household_head_name
    )

    families = Family.query.filter_by(
        barangay_id=barangay_id
    ).all()

    for family in families:

        existing_head = normalize_name(
            family.head_name
        )

        if existing_head == normalized_head:

            return family

    return None


# =========================================================
# FIND CENTER
# =========================================================

def find_evacuation_center(
    center_name,
    barangay_id
):

    normalized_name = normalize_text(
        center_name
    )

    if not normalized_name:
        return None

    centers = EvacuationCenter.query.filter_by(
        barangay_id=barangay_id
    ).all()

    for center in centers:

        if normalize_text(center.name) == normalized_name:

            return center

    return None


# =========================================================
# FIND ROOM
# =========================================================

def find_room(
    center_id,
    room_number
):

    normalized_room = normalize_text(
        room_number
    )

    if not normalized_room:
        return None

    rooms = EvacuationCenterRoom.query.filter_by(
        evacuation_center_id=center_id
    ).all()

    for room in rooms:

        if normalize_text(room.room_number) == normalized_room:

            return room

    return None


# =========================================================
# GET OR CREATE BARANGAY
# =========================================================

def get_or_create_barangay(barangay_name):

    existing = find_barangay(
        barangay_name
    )

    if existing:

        return existing, False

    display_name = re.sub(
        r"\s+",
        " ",
        str(barangay_name).strip()
    )

    barangay = Barangay(
        name=display_name,
        population=0,
        geom=None
    )

    db.session.add(barangay)

    db.session.flush()

    return barangay, True


# =========================================================
# PARSE INTEGER
# =========================================================

def parse_integer(
    value,
    field_name,
    excel_row,
    errors
):

    value = clean_value(value)

    if value is None:

        return None

    try:

        number = int(float(value))

        return number

    except (ValueError, TypeError):

        errors.append(
            f"Row {excel_row}: "
            f"invalid {field_name} '{value}'"
        )

        return None


# =========================================================
# REQUIRED COLUMNS
# =========================================================

def validate_columns(df):

    required_columns = [

        # Resident
        "first_name",
        "last_name",
        "household_head_name",
        "barangay",

        # Evacuation Center
        "evacuation_center",
        "center_capacity",
        "building_material",
        "accessibility_notes",
        "center_contact",

        # Room
        "room_number",
        "room_capacity"
    ]

    missing_columns = [

        column
        for column in required_columns
        if column not in df.columns

    ]

    return missing_columns


# =========================================================
# DELETE OLD IMPORTED DATA
# =========================================================

def clear_existing_data():

    # Assignments must be removed first
    EvacuationAssignment.query.delete(
        synchronize_session=False
    )

    # Residents
    Resident.query.delete(
        synchronize_session=False
    )

    # Rooms
    EvacuationCenterRoom.query.delete(
        synchronize_session=False
    )

    # Centers
    EvacuationCenter.query.delete(
        synchronize_session=False
    )

    # Families
    Family.query.delete(
        synchronize_session=False
    )

    # Barangays
    Barangay.query.delete(
        synchronize_session=False
    )

    db.session.flush()


# =========================================================
# UPLOAD RESIDENTS
# =========================================================

@residents_bp.route(
    '/api/residents/upload',
    methods=['POST']
)
@role_required(
    'admin',
    'lgu_personnel'
)
def upload_residents():

    # -----------------------------------------------------
    # CHECK FILE
    # -----------------------------------------------------

    if 'file' not in request.files:

        return jsonify({
            "error": "An Excel file is required."
        }), 400

    file = request.files['file']

    if file.filename == '':

        return jsonify({
            "error": "No file selected."
        }), 400

    if not file.filename.lower().endswith(
        ('.xlsx', '.xls')
    ):

        return jsonify({
            "error": (
                "Please upload an Excel file "
                "(.xlsx or .xls)."
            )
        }), 400

    # -----------------------------------------------------
    # READ EXCEL
    # -----------------------------------------------------

    try:

        df = pd.read_excel(
            file,
            dtype=object
        )

    except Exception as e:

        return jsonify({
            "error": (
                "Could not read the Excel file: "
                f"{str(e)}"
            )
        }), 400

    if df.empty:

        return jsonify({
            "error": (
                "The Excel file contains "
                "no resident rows."
            )
        }), 400

    # -----------------------------------------------------
    # NORMALIZE COLUMNS
    # -----------------------------------------------------

    df = normalize_columns(df)

    # -----------------------------------------------------
    # VALIDATE COLUMNS
    # -----------------------------------------------------

    missing_columns = validate_columns(df)

    if missing_columns:

        return jsonify({

            "error": (
                "The Excel file is missing "
                "required columns."
            ),

            "missing_columns": missing_columns,

            "columns_found": list(
                df.columns
            )

        }), 400

    # -----------------------------------------------------
    # CURRENT USER
    # -----------------------------------------------------

    user_id = get_jwt_identity()

    added = 0
    skipped = 0
    assignments_created = 0

    new_barangays = []
    created_families = []
    created_centers = []
    created_rooms = []

    errors = []

    try:

        # -------------------------------------------------
        # CLEAR OLD DATA
        # -------------------------------------------------

        clear_existing_data()

        # -------------------------------------------------
        # TRACK DATA CREATED DURING THIS IMPORT
        # -------------------------------------------------

        resident_keys = set()

        # -------------------------------------------------
        # PROCESS EXCEL ROWS
        # -------------------------------------------------

        for idx, row in df.iterrows():

            excel_row = idx + 2

            # =================================================
            # RESIDENT INFORMATION
            # =================================================

            first_name = clean_value(
                row.get("first_name")
            )

            middle_name = clean_value(
                row.get("middle_name")
            )

            last_name = clean_value(
                row.get("last_name")
            )

            household_head_name = clean_value(
                row.get("household_head_name")
            )

            barangay_name = clean_value(
                row.get("barangay")
            )

            address = clean_value(
                row.get("address")
            )

            contact_number = clean_value(
                row.get("contact_number")
            )

            family_members = parse_integer(
                row.get("family_members"),
                "family members",
                excel_row,
                errors
            )

            vulnerable_members = clean_value(
                row.get("vulnerable_members")
            )

            remarks = clean_value(
                row.get("remarks")
            )

            # =================================================
            # CENTER INFORMATION
            # =================================================

            center_name = clean_value(
                row.get("evacuation_center")
            )

            center_capacity = parse_integer(
                row.get("center_capacity"),
                "center capacity",
                excel_row,
                errors
            )

            building_material = clean_value(
                row.get("building_material")
            )

            accessibility_notes = clean_value(
                row.get("accessibility_notes")
            )

            center_contact = clean_value(
                row.get("center_contact")
            )

            # =================================================
            # ROOM INFORMATION
            # =================================================

            room_number = clean_value(
                row.get("room_number")
            )

            room_capacity = parse_integer(
                row.get("room_capacity"),
                "room capacity",
                excel_row,
                errors
            )

            # =================================================
            # VALIDATE RESIDENT
            # =================================================

            if not first_name:

                errors.append(
                    f"Row {excel_row}: "
                    "missing first name, skipped."
                )

                skipped += 1
                continue

            if not last_name:

                errors.append(
                    f"Row {excel_row}: "
                    "missing last name, skipped."
                )

                skipped += 1
                continue

            if not household_head_name:

                errors.append(
                    f"Row {excel_row}: "
                    "missing household head name, skipped."
                )

                skipped += 1
                continue

            if not barangay_name:

                errors.append(
                    f"Row {excel_row}: "
                    "missing barangay, skipped."
                )

                skipped += 1
                continue

            # =================================================
            # VALIDATE CENTER
            # =================================================

            if not center_name:

                errors.append(
                    f"Row {excel_row}: "
                    "missing evacuation center, skipped."
                )

                skipped += 1
                continue

            if center_capacity is None:

                errors.append(
                    f"Row {excel_row}: "
                    "missing center capacity, skipped."
                )

                skipped += 1
                continue

            if center_capacity <= 0:

                errors.append(
                    f"Row {excel_row}: "
                    "center capacity must be greater than 0, skipped."
                )

                skipped += 1
                continue

            # =================================================
            # VALIDATE ROOM
            # =================================================

            if not room_number:

                errors.append(
                    f"Row {excel_row}: "
                    "missing room number, skipped."
                )

                skipped += 1
                continue

            if room_capacity is None:

                errors.append(
                    f"Row {excel_row}: "
                    "missing room capacity, skipped."
                )

                skipped += 1
                continue

            if room_capacity <= 0:

                errors.append(
                    f"Row {excel_row}: "
                    "room capacity must be greater than 0, skipped."
                )

                skipped += 1
                continue

            # =================================================
            # CHECK DUPLICATE RESIDENT
            # =================================================

            resident_key = (

                normalize_name(first_name),

                normalize_name(middle_name),

                normalize_name(last_name),

                normalize_name(
                    household_head_name
                ),

                normalize_barangay_name(
                    barangay_name
                )
            )

            if resident_key in resident_keys:

                errors.append(
                    f"Row {excel_row}: "
                    "duplicate resident in Excel file, skipped."
                )

                skipped += 1
                continue

            # =================================================
            # BARANGAY
            # =================================================

            barangay, barangay_created = (
                get_or_create_barangay(
                    barangay_name
                )
            )

            if barangay_created:

                new_barangays.append(
                    barangay.name
                )

            # =================================================
            # FAMILY
            # =================================================

            family = find_family(
                barangay.id,
                household_head_name
            )

            if family is None:

                family = Family(

                    barangay_id=barangay.id,

                    family_code=make_family_code(
                        barangay.name,
                        household_head_name
                    ),

                    head_name=household_head_name,

                    member_count=(
                        family_members
                        if family_members
                        and family_members > 0
                        else 1
                    ),

                    contact_number=contact_number,

                    evacuation_status="Not Evacuated"
                )

                db.session.add(family)

                db.session.flush()

                created_families.append(
                    family.family_code
                )

            else:

                if contact_number:

                    family.contact_number = (
                        contact_number
                    )

            # =================================================
            # EVACUATION CENTER
            # =================================================
            #
            # IMPORTANT:
            # The center uses the Barangay from the Excel row.
            #
            # There is NO center_barangay column anymore.
            #
            # =================================================

            center = find_evacuation_center(
                center_name,
                barangay.id
            )

            if center is None:

                center = EvacuationCenter(

                    name=center_name,

                    # Keep the old text field
                    # for compatibility.
                    barangay=barangay.name,

                    # New proper relationship.
                    barangay_id=barangay.id,

                    capacity=center_capacity,

                    building_material=(
                        building_material
                    ),

                    accessibility_notes=(
                        accessibility_notes
                    ),

                    contact_number=(
                        center_contact
                    ),

                    is_active=True,

                    geom=None,

                    entrance_geom=None
                )

                db.session.add(center)

                db.session.flush()

                created_centers.append(
                    center.name
                )

            # =================================================
            # CHECK CENTER INFORMATION
            # =================================================

            else:

                if (
                    center.capacity is not None
                    and center.capacity != center_capacity
                ):

                    errors.append(
                        f"Row {excel_row}: "
                        f"center '{center.name}' "
                        f"has a different capacity "
                        f"({center.capacity} vs "
                        f"{center_capacity}), skipped."
                    )

                    skipped += 1
                    continue

            # =================================================
            # ROOM
            # =================================================

            room = find_room(
                center.id,
                room_number
            )

            if room is None:

                room = EvacuationCenterRoom(

                    evacuation_center_id=center.id,

                    room_number=room_number,

                    capacity=room_capacity,

                    # Location is added later
                    # through the map.
                    latitude=None,

                    longitude=None
                )

                db.session.add(room)

                db.session.flush()

                created_rooms.append(
                    f"{center.name} - {room_number}"
                )

            else:

                if room.capacity != room_capacity:

                    errors.append(
                        f"Row {excel_row}: "
                        f"room '{room.room_number}' "
                        f"in '{center.name}' "
                        f"has a different capacity "
                        f"({room.capacity} vs "
                        f"{room_capacity}), skipped."
                    )

                    skipped += 1
                    continue

            # =================================================
            # ROOM CAPACITY CHECK
            # =================================================

            assigned_count = (
                EvacuationAssignment.query
                .filter_by(
                    room_id=room.id
                )
                .count()
            )

            if assigned_count >= room.capacity:

                errors.append(
                    f"Row {excel_row}: "
                    f"room '{room.room_number}' "
                    f"in '{center.name}' "
                    f"is already full "
                    f"({assigned_count}/{room.capacity}), "
                    "resident skipped."
                )

                skipped += 1
                continue

            # =================================================
            # CREATE RESIDENT
            # =================================================

            resident = Resident(

                family_id=family.id,

                first_name=first_name,

                middle_name=middle_name,

                last_name=last_name,

                household_head_name=(
                    household_head_name
                ),

                barangay=barangay.name,

                address=address,

                contact_number=contact_number,

                family_members=(
                    family_members
                    if family_members
                    and family_members > 0
                    else 1
                ),

                vulnerable_members=(
                    vulnerable_members
                ),

                remarks=remarks,

                uploaded_by=user_id
            )

            db.session.add(resident)

            db.session.flush()

            # =================================================
            # AUTOMATIC ASSIGNMENT
            # =================================================

            assignment = EvacuationAssignment(

                resident_id=resident.id,

                room_id=room.id
            )

            db.session.add(assignment)

            assignments_created += 1

            # =================================================
            # TRACK RESIDENT
            # =================================================

            resident_keys.add(
                resident_key
            )

            added += 1

        # =====================================================
        # UPDATE FAMILY MEMBER COUNTS
        # =====================================================

        families = Family.query.all()

        for family in families:

            actual_count = (
                Resident.query
                .filter_by(
                    family_id=family.id
                )
                .count()
            )

            family.member_count = actual_count

        # =====================================================
        # UPDATE BARANGAY POPULATION
        # =====================================================

        barangays = Barangay.query.all()

        for barangay in barangays:

            population = (
                db.session.query(
                    Resident
                )
                .join(
                    Family,
                    Resident.family_id
                    == Family.id
                )
                .filter(
                    Family.barangay_id
                    == barangay.id
                )
                .count()
            )

            barangay.population = population

        # =====================================================
        # UPDATE FAMILY EVACUATION STATUS
        # =====================================================

        families = Family.query.all()

        for family in families:

            residents = (
                Resident.query
                .filter_by(
                    family_id=family.id
                )
                .all()
            )

            if not residents:

                family.evacuation_status = (
                    "Not Evacuated"
                )

                continue

            assigned_count = (
                db.session.query(
                    EvacuationAssignment
                )
                .join(
                    Resident,
                    EvacuationAssignment.resident_id
                    == Resident.id
                )
                .filter(
                    Resident.family_id
                    == family.id
                )
                .count()
            )

            if assigned_count == len(residents):

                family.evacuation_status = (
                    "Assigned"
                )

            elif assigned_count > 0:

                family.evacuation_status = (
                    "Partially Assigned"
                )

            else:

                family.evacuation_status = (
                    "Not Evacuated"
                )

        # =====================================================
        # SAVE IMPORT
        # =====================================================

        db.session.commit()

        # =====================================================
        # SYSTEM LOG
        # =====================================================

        log = SystemLog(

            user_id=user_id,

            action=(
                "Replaced resident and evacuation data "
                f"from Excel: "
                f"{added} residents, "
                f"{len(created_families)} families, "
                f"{len(created_centers)} centers, "
                f"{len(created_rooms)} rooms, "
                f"{assignments_created} assignments"
            )
        )

        db.session.add(log)

        db.session.commit()

        # =====================================================
        # RESPONSE
        # =====================================================

        return jsonify({

            "message": (
                "Excel data imported successfully. "
                "Previous resident, family, barangay, "
                "evacuation center, room, and assignment "
                "data were replaced."
            ),

            "added": added,

            "skipped": skipped,

            "assignments_created": (
                assignments_created
            ),

            "new_barangays": new_barangays,

            "families_created": len(
                created_families
            ),

            "evacuation_centers_created": len(
                created_centers
            ),

            "rooms_created": len(
                created_rooms
            ),

            "total_residents": (
                Resident.query.count()
            ),

            "total_families": (
                Family.query.count()
            ),

            "total_barangays": (
                Barangay.query.count()
            ),

            "total_evacuation_centers": (
                EvacuationCenter.query.count()
            ),

            "total_rooms": (
                EvacuationCenterRoom.query.count()
            ),

            "total_assignments": (
                EvacuationAssignment.query.count()
            ),

            "errors": errors
        }), 200

    except Exception as e:

        db.session.rollback()

        return jsonify({

            "error": (
                "Excel import failed. "
                "No changes were saved."
            ),

            "details": str(e)

        }), 500


# =========================================================
# GET ALL RESIDENTS
# =========================================================

@residents_bp.route(
    '/api/residents',
    methods=['GET']
)
@role_required(
    'admin',
    'lgu_personnel'
)
def list_residents():

    barangay_filter = request.args.get(
        'barangay'
    )

    query = Resident.query

    if barangay_filter:

        normalized_filter = (
            normalize_barangay_name(
                barangay_filter
            )
        )

        residents = Resident.query.all()

        residents = [

            resident
            for resident in residents

            if normalize_barangay_name(
                resident.barangay
            ) == normalized_filter

        ]

    else:

        residents = query.order_by(

            Resident.barangay,

            Resident.household_head_name,

            Resident.last_name,

            Resident.first_name

        ).all()

    if barangay_filter:

        residents.sort(

            key=lambda resident: (

                resident.household_head_name.lower(),

                resident.last_name.lower(),

                resident.first_name.lower()

            )
        )

    return jsonify([

        resident.to_dict()

        for resident in residents

    ]), 200


# =========================================================
# FIND MY EVACUATION CENTER (public resident lookup)
# =========================================================
#
# Used by the public map (ResidentHome.jsx) so a resident can
# type their household head's name and see which evacuation
# center / room they're assigned to. Intentionally NOT behind
# @role_required: residents using this page are not logged in.
#
# =========================================================

@residents_bp.route(
    '/api/residents/find-center',
    methods=['GET']
)
def find_my_evacuation_center():

    name = request.args.get(
        'name',
        ''
    )

    name = name.strip() if name else ''

    if len(name) < 3:

        return jsonify({
            "error": (
                "Enter your full name "
                "(at least 3 letters)."
            )
        }), 400

    query_normalized = normalize_name(name)

    families = Family.query.all()

    matches = []

    for family in families:

        head_normalized = normalize_name(
            family.head_name
        )

        if not _name_matches(
            query_normalized,
            head_normalized
        ):

            continue

        residents = Resident.query.filter_by(
            family_id=family.id
        ).all()

        if not residents:

            continue

        barangay = Barangay.query.get(
            family.barangay_id
        )

        representative = residents[0]

        # -----------------------------------------------------
        # Find this family's evacuation assignment, if any.
        # A family may have multiple residents; any assigned
        # resident is enough to identify the family's room.
        # -----------------------------------------------------

        assignment = (
            db.session.query(
                EvacuationAssignment
            )
            .join(
                Resident,
                EvacuationAssignment.resident_id
                == Resident.id
            )
            .filter(
                Resident.family_id
                == family.id
            )
            .first()
        )

        evacuation_center_data = None
        room_data = None

        if assignment:

            room = EvacuationCenterRoom.query.get(
                assignment.room_id
            )

            if room:

                room_data = {
                    "id": room.id,
                    "room_number": room.room_number
                }

                center = EvacuationCenter.query.get(
                    room.evacuation_center_id
                )

                if center:

                    evacuation_center_data = {
                        "id": center.id,
                        "name": center.name
                    }

        matches.append({

            "resident_id": representative.id,

            "household_head_name": family.head_name,

            "address": representative.address,

            "barangay": (
                barangay.name
                if barangay
                else None
            ),

            "evacuation_center": evacuation_center_data,

            "room": room_data
        })

    return jsonify({
        "matches": matches
    }), 200
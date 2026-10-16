import re

from datetime import date, datetime

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
    CenterBarangay,
    SystemLog
)

from utils import role_required


residents_bp = Blueprint('residents', __name__)


# =========================================================
# EXCEL COLUMN MAP
# =========================================================

def normalize_excel_column_name(column_name):

    if column_name is None:
        return ""

    normalized = str(column_name).strip().lower()
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized)

    return normalized.strip()


COLUMN_MAP = {

    # -----------------------------------------------------
    # HOUSEHOLD / FAMILY IDENTIFIERS (Priority 1 & 2)
    # -----------------------------------------------------

    "household id": "household_id",
    "household_id": "household_id",
    "family id": "household_id",
    "family_id": "household_id",
    "household no": "household_id",
    "household_no": "household_id",
    "household number": "household_id",
    "household_number": "household_id",

    "family code": "family_code",
    "family_code": "family_code",
    "household code": "family_code",
    "household_code": "family_code",

    "resident id": "resident_id",
    "resident_id": "resident_id",
    "member id": "resident_id",
    "member_id": "resident_id",

    # -----------------------------------------------------
    # RESIDENT
    # -----------------------------------------------------

    "first name": "first_name",
    "first name ": "first_name",
    "first_name": "first_name",

    "middle name": "middle_name",
    "middle_name": "middle_name",

    "last name": "last_name",
    "last_name": "last_name",

    "household head name": "household_head_name",
    "household head": "household_head_name",
    "head of household": "household_head_name",
    "household_head_name": "household_head_name",
    "family head name": "household_head_name",
    "head of family": "household_head_name",

    "barangay": "barangay",
    "barangay name": "barangay",
    "barangay_name": "barangay",

    "address / purok": "address",
    "address": "address",
    "purok": "address",
    "purok address": "address",
    "address and purok": "address",

    "contact": "contact_number",
    "contact number": "contact_number",
    "contact_number": "contact_number",
    "mobile number": "contact_number",

    "family members": "family_members",
    "family_members": "family_members",
    "number of family members": "family_members",

    "vulnerable members": "vulnerable_members",
    "vulnerable_members": "vulnerable_members",
    "count of vulnerable members": "vulnerable_members",

    "remarks": "remarks",

    # -----------------------------------------------------
    # RESIDENT DETAILS (new columns)
    # -----------------------------------------------------

    "suffix": "suffix",

    "date of birth": "date_of_birth",
    "date_of_birth": "date_of_birth",
    "birthdate": "date_of_birth",
    "birth date": "date_of_birth",
    "dob": "date_of_birth",

    "gender": "gender",
    "sex": "gender",

    "alternate contact": "alternate_contact",
    "alternate_contact": "alternate_contact",

    "relationship to head": "relationship_to_head",
    "relationship_to_head": "relationship_to_head",
    "relationship": "relationship_to_head",

    "is head of family": "is_head_of_family",
    "is_head_of_family": "is_head_of_family",

    "is pwd": "is_pwd",
    "is_pwd": "is_pwd",
    "pwd": "is_pwd",

    "disability type": "disability_type",
    "disability_type": "disability_type",

    "disability notes": "disability_notes",
    "disability_notes": "disability_notes",

    "is pregnant": "is_pregnant",
    "is_pregnant": "is_pregnant",

    "is lactating": "is_lactating",
    "is_lactating": "is_lactating",

    "is solo parent": "is_solo_parent",
    "is_solo_parent": "is_solo_parent",

    "needs assistance": "needs_assistance",
    "needs_assistance": "needs_assistance",
    "assistance needed": "needs_assistance",

    "medical notes": "medical_notes",
    "medical_notes": "medical_notes",

    "notes": "notes",

    # -----------------------------------------------------
    # EVACUATION CENTER
    # -----------------------------------------------------

    "evacuation center": "evacuation_center",
    "evacuation center name": "evacuation_center",
    "evacuation_center": "evacuation_center",
    "center": "evacuation_center",
    "center name": "evacuation_center",
    "center_name": "evacuation_center",
    "evacuation center name ": "evacuation_center",

    "center capacity": "center_capacity",
    "center_capacity": "center_capacity",
    "capacity": "center_capacity",

    "building material": "building_material",
    "building_material": "building_material",

    "accessibility notes": "accessibility_notes",
    "accessibility_notes": "accessibility_notes",

    "center contact": "center_contact",
    "center_contact": "center_contact",
    "contact person": "center_contact",

    # -----------------------------------------------------
    # ROOM
    # -----------------------------------------------------

    "room number": "room_number",
    "room_number": "room_number",
    "room no": "room_number",
    "room no ": "room_number",
    "room": "room_number",

    "room capacity": "room_capacity",
    "room_capacity": "room_capacity",
    "capacity of room": "room_capacity"
}


NORMALIZED_COLUMN_MAP = {
    normalize_excel_column_name(key): value
    for key, value in COLUMN_MAP.items()
}


# =========================================================
# RESIDENT DETAIL FIELDS (new, optional Excel columns)
# =========================================================
#
# These map 1:1 to columns on the residents table.
# They are optional: an older Excel file without them
# still imports exactly as before.
#
# =========================================================

TEXT_DETAIL_FIELDS = [
    "suffix",
    "alternate_contact",
    "relationship_to_head",
    "disability_type",
    "disability_notes",
    "medical_notes",
    "notes"
]

BOOLEAN_DETAIL_FIELDS = [
    "is_head_of_family",
    "is_pwd",
    "is_pregnant",
    "is_lactating",
    "is_solo_parent",
    "needs_assistance"
]

RESIDENT_DETAIL_FIELDS = (
    TEXT_DETAIL_FIELDS
    + BOOLEAN_DETAIL_FIELDS
    + ["date_of_birth", "gender"]
)

TRUE_VALUES = {"yes", "y", "true", "t", "1", "x"}

FALSE_VALUES = {"no", "n", "false", "f", "0"}


# =========================================================
# CLEAN CELL VALUE
# =========================================================

def clean_value(value):

    if value is None:
        return None

    if pd.isna(value):
        return None

    if isinstance(value, float) and value.is_integer():
        return str(int(value))

    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)

    value = str(value).strip()

    if not value:
        return None

    # Remove Excel .0 from numbers only when there are no leading zeros
    if value.endswith(".0") and not (len(value) > 3 and value.startswith("0")):

        try:

            number = float(value)

            if number.is_integer():
                value = str(int(number))

        except (ValueError, TypeError):
            pass

    return value


def clean_identifier(value):
    """
    Normalize a household or resident identifier while preserving
    meaningful leading zeros (e.g. '00123' or 'FM-0042').
    """
    cleaned = clean_value(value)
    if not cleaned:
        return None
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned if cleaned else None


# =========================================================
# NORMALIZE EXCEL COLUMN NAMES
# =========================================================

def normalize_columns(df):

    normalized_columns = []

    for column in df.columns:

        normalized_name = normalize_excel_column_name(column)
        normalized_columns.append(normalized_name)

    df.columns = normalized_columns

    rename_map = {}

    for column in df.columns:

        mapped_name = NORMALIZED_COLUMN_MAP.get(column)

        if mapped_name:
            rename_map[column] = mapped_name

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
# FAMILY CODE & HOUSEHOLD IMPORT KEY
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


def make_unique_family_code(
    barangay_name,
    household_head_name,
    preferred_code=None,
    used_codes=None
):
    """
    Generate a unique Family.family_code, preserving an explicit
    household_id / family_code when supplied and disambiguating
    collisions with a numeric suffix.
    """
    base_code = clean_identifier(preferred_code)
    if not base_code:
        base_code = make_family_code(barangay_name, household_head_name)
    base_code = base_code[:90]

    if used_codes is None:
        used_codes = set()

    candidate = base_code
    suffix_num = 2
    while candidate.casefold() in used_codes:
        candidate = f"{base_code}-{suffix_num}"
        suffix_num += 1

    used_codes.add(candidate.casefold())
    return candidate


def build_household_import_key(
    barangay_id,
    household_head_name,
    address=None,
    household_id=None,
    family_code=None,
    families_by_head=None,
    excel_row=None,
    warnings=None
):
    """
    Build a deterministic household import key using the 3-level priority order:
      - Priority 1: Explicit Household ID / Family ID (scoped to barangay_id)
      - Priority 2: Explicit Household Code / Family Code (scoped to barangay_id)
      - Priority 3: Composite Key (barangay_id, normalized household_head_name, normalized address)
        with fallback to an unambiguous existing household in the same barangay when address is blank.
    """
    norm_hh_id = clean_identifier(household_id)
    if norm_hh_id:
        return ("id", barangay_id, norm_hh_id.casefold())

    norm_fam_code = clean_identifier(family_code)
    if norm_fam_code:
        return ("code", barangay_id, norm_fam_code.casefold())

    norm_head = normalize_name(household_head_name) or ""
    norm_addr = normalize_text(address) or ""

    if families_by_head is not None:
        existing_entries = families_by_head.get((barangay_id, norm_head), [])
        if not norm_addr and len(existing_entries) == 1:
            return existing_entries[0]["key"]
        if not norm_addr and len(existing_entries) > 1 and warnings is not None:
            warnings.append(
                f"Row {excel_row}: household head '{household_head_name}' has no address "
                "and matches multiple households in this barangay; flagged for review."
            )
        elif norm_addr and existing_entries:
            # If an existing entry for this head had a blank address, adopt the concrete address key
            if len(existing_entries) == 1 and existing_entries[0]["norm_addr"] == "":
                existing_entries[0]["norm_addr"] = norm_addr
                return existing_entries[0]["key"]
            different_addrs = [
                e for e in existing_entries
                if e["norm_addr"] and e["norm_addr"] != norm_addr
            ]
            if different_addrs and not any(e["norm_addr"] == norm_addr for e in existing_entries):
                if warnings is not None:
                    warnings.append(
                        f"Row {excel_row}: household head '{household_head_name}' appears at "
                        f"multiple addresses in the same barangay ('{address}'); treated as a distinct household."
                    )

    return ("composite", barangay_id, norm_head, norm_addr)


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
    household_head_name,
    address=None,
    household_id=None,
    family_code=None
):

    preferred_code = clean_identifier(family_code) or clean_identifier(household_id)
    if preferred_code:
        by_code = Family.query.filter_by(barangay_id=barangay_id).all()
        for family in by_code:
            if family.family_code and family.family_code.strip().casefold() == preferred_code.casefold():
                return family

    normalized_head = normalize_name(
        household_head_name
    )
    normalized_addr = normalize_text(address)

    families = Family.query.filter_by(
        barangay_id=barangay_id
    ).all()

    matching_head_families = [
        family for family in families
        if normalize_name(family.head_name) == normalized_head
    ]

    if not matching_head_families:
        return None

    if normalized_addr:
        for family in matching_head_families:
            first_res = Resident.query.filter_by(family_id=family.id).first()
            fam_addr = normalize_text(first_res.address) if first_res else None
            if fam_addr == normalized_addr or fam_addr is None:
                return family
        return None

    return matching_head_families[0]


# =========================================================
# FIND CENTER
# =========================================================

def find_evacuation_center(
    center_name
):

    normalized_name = normalize_text(
        center_name
    )

    if not normalized_name:
        return None

    centers = EvacuationCenter.query.all()

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
# NAMES MUST NOT CONTAIN NUMBERS
# =========================================================
#
# Takes a list of (label, value) pairs and returns the
# first pair whose value contains a digit, or None.
#
# =========================================================

def find_name_with_numbers(names):

    for label, value in names:

        if value and re.search(r"\d", value):

            return label, value

    return None


# =========================================================
# PARSE YES / NO
# =========================================================

def parse_boolean(
    value,
    field_name,
    excel_row,
    warnings
):

    text = clean_value(value)

    if text is None:

        return False

    lowered = text.lower()

    if lowered in TRUE_VALUES:

        return True

    if lowered in FALSE_VALUES:

        return False

    warnings.append(
        f"Row {excel_row}: "
        f"invalid {field_name} '{text}', "
        "treated as No."
    )

    return False


# =========================================================
# PARSE DATE OF BIRTH
# =========================================================

def parse_birth_date(
    value,
    excel_row,
    warnings
):

    if value is None:

        return None

    try:

        if pd.isna(value):

            return None

    except (TypeError, ValueError):

        pass

    parsed = None

    if isinstance(value, datetime):

        parsed = value.date()

    elif isinstance(value, date):

        parsed = value

    elif (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
    ):

        # Excel serial date number
        converted = pd.to_datetime(
            value,
            unit="D",
            origin="1899-12-30",
            errors="coerce"
        )

        if not pd.isna(converted):

            parsed = converted.date()

    else:

        text = clean_value(value)

        if text is None:

            return None

        converted = pd.to_datetime(
            text,
            errors="coerce"
        )

        if not pd.isna(converted):

            parsed = converted.date()

    if (
        parsed is None
        or parsed > date.today()
        or parsed.year < 1900
    ):

        warnings.append(
            f"Row {excel_row}: "
            f"invalid date of birth '{value}', "
            "left blank."
        )

        return None

    return parsed


# =========================================================
# PARSE GENDER
# =========================================================

def parse_gender(
    value,
    excel_row,
    warnings
):

    text = clean_value(value)

    if text is None:

        return None

    lowered = text.lower()

    if lowered in ("male", "m"):

        return "Male"

    if lowered in ("female", "f"):

        return "Female"

    warnings.append(
        f"Row {excel_row}: "
        f"invalid gender '{text}', "
        "left blank."
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

    # Center/barangay links must be removed before centers and barangays.
    CenterBarangay.query.delete(synchronize_session=False)

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
    'admin'
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
    # CHECK RESIDENT DETAIL COLUMNS AGAINST THE MODEL
    # -----------------------------------------------------
    #
    # Done BEFORE any data is cleared, so a model that is
    # out of date never causes a half-finished import.
    #
    # -----------------------------------------------------

    detail_columns = [

        column
        for column in RESIDENT_DETAIL_FIELDS
        if column in df.columns

    ]

    missing_model_fields = [

        column
        for column in detail_columns
        if not hasattr(Resident, column)

    ]

    if missing_model_fields:

        return jsonify({

            "error": (
                "The Resident model is missing fields "
                "for columns in this Excel file. "
                "Add them to models.py and restart "
                "the Flask server."
            ),

            "missing_model_fields": missing_model_fields

        }), 500

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
    warnings = []

    try:

        # -------------------------------------------------
        # CLEAR OLD DATA
        # -------------------------------------------------

        clear_existing_data()

        # -------------------------------------------------
        # TRACK DATA CREATED DURING THIS IMPORT
        # -------------------------------------------------

        resident_keys = set()
        families_by_import_key = {}
        families_by_head = {}
        used_family_codes = {
            (f.family_code or "").strip().casefold()
            for f in Family.query.all()
            if f.family_code
        }

        # -------------------------------------------------
        # PROCESS EXCEL ROWS
        # -------------------------------------------------

        for idx, row in df.iterrows():

            excel_row = idx + 2

            # =================================================
            # HOUSEHOLD & RESIDENT IDENTIFIERS (OPTIONAL)
            # =================================================

            household_id_val = clean_identifier(
                row.get("household_id")
            )

            family_code_val = clean_identifier(
                row.get("family_code")
            )

            resident_id_val = clean_identifier(
                row.get("resident_id")
            )

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
            # NAMES MUST NOT CONTAIN NUMBERS
            # =================================================

            name_with_numbers = find_name_with_numbers([

                ("first name", first_name),

                ("middle name", middle_name),

                ("last name", last_name),

                (
                    "household head name",
                    household_head_name
                )
            ])

            if name_with_numbers:

                label, value = name_with_numbers

                errors.append(
                    f"Row {excel_row}: "
                    f"{label} '{value}' contains "
                    "numbers, skipped."
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

                resident_id_val.casefold() if resident_id_val else "",

                normalize_name(first_name),

                normalize_name(middle_name),

                normalize_name(last_name),

                normalize_name(clean_value(row.get("suffix"))),

                household_id_val.casefold() if household_id_val else "",

                family_code_val.casefold() if family_code_val else "",

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
            # EVACUATION CENTER
            # =================================================
            #
            center = find_evacuation_center(
                center_name
            )

            if center is None:

                center = EvacuationCenter(

                    name=center_name,

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

            if not CenterBarangay.query.filter_by(
                center_id=center.id,
                barangay_id=barangay.id
            ).first():
                db.session.add(CenterBarangay(
                    center_id=center.id,
                    barangay_id=barangay.id
                ))
                db.session.flush()

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
                    "skipped."
                )

                skipped += 1
                continue

            # =================================================
            # FAMILY / HOUSEHOLD GROUPING (AFTER VALIDATIONS)
            # =================================================
            #
            # Group residents by the household import key:
            #   Priority 1: household_id / family_id
            #   Priority 2: family_code / household_code
            #   Priority 3: composite key (barangay.id,
            #               normalized household_head_name,
            #               normalized address)
            # Only create a Family record when a valid resident
            # is actually being inserted, preventing orphan or
            # per-member duplicate Family records.
            # =================================================

            household_key = build_household_import_key(
                barangay_id=barangay.id,
                household_head_name=household_head_name,
                address=address,
                household_id=household_id_val,
                family_code=family_code_val,
                families_by_head=families_by_head,
                excel_row=excel_row,
                warnings=warnings
            )

            family = families_by_import_key.get(household_key)
            if family is None:
                family = find_family(
                    barangay.id,
                    household_head_name,
                    address=address,
                    household_id=household_id_val,
                    family_code=family_code_val
                )

            if family is None:

                preferred_code = family_code_val or household_id_val
                unique_code = make_unique_family_code(
                    barangay.name,
                    household_head_name,
                    preferred_code=preferred_code,
                    used_codes=used_family_codes
                )

                family = Family(

                    barangay_id=barangay.id,

                    family_code=unique_code,

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

                families_by_import_key[household_key] = family
                head_bucket_key = (
                    barangay.id,
                    normalize_name(household_head_name) or ""
                )
                families_by_head.setdefault(head_bucket_key, []).append({
                    "key": household_key,
                    "norm_addr": normalize_text(address) or "",
                    "family": family
                })

            else:

                families_by_import_key[household_key] = family
                if contact_number and not family.contact_number:

                    family.contact_number = (
                        contact_number
                    )

            # =================================================
            # RESIDENT DETAILS (new optional columns)
            # =================================================
            #
            # Only columns that exist in the Excel file are
            # passed on, so older 17-column files still work.
            #
            # =================================================

            detail_values = {}

            for column in detail_columns:

                raw_value = row.get(column)

                if column == "date_of_birth":

                    detail_values[column] = (
                        parse_birth_date(
                            raw_value,
                            excel_row,
                            warnings
                        )
                    )

                elif column == "gender":

                    detail_values[column] = (
                        parse_gender(
                            raw_value,
                            excel_row,
                            warnings
                        )
                    )

                elif column in BOOLEAN_DETAIL_FIELDS:

                    detail_values[column] = (
                        parse_boolean(
                            raw_value,
                            column.replace("_", " "),
                            excel_row,
                            warnings
                        )
                    )

                else:

                    detail_values[column] = (
                        clean_value(
                            raw_value
                        )
                    )

            full_name_norm = normalize_name(
                f"{first_name} {middle_name} {last_name}".strip()
                if middle_name
                else f"{first_name} {last_name}".strip()
            )
            short_name_norm = normalize_name(f"{first_name} {last_name}".strip())
            head_norm = normalize_name(household_head_name)
            rel_norm = normalize_name(detail_values.get("relationship_to_head"))
            is_head_row = (
                bool(detail_values.get("is_head_of_family"))
                or full_name_norm == head_norm
                or short_name_norm == head_norm
                or rel_norm in {"self", "head", "household head"}
            )
            if is_head_row:
                detail_values["is_head_of_family"] = True
                if not detail_values.get("relationship_to_head") or rel_norm in {"self", "head", "household head"}:
                    detail_values["relationship_to_head"] = "Household Head"

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

                uploaded_by=user_id,

                **detail_values
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
        # UPDATE FAMILY MEMBER COUNTS & HEAD DESIGNATION
        # =====================================================

        families = Family.query.all()

        for family in families:

            family_residents = (
                Resident.query
                .filter_by(
                    family_id=family.id
                )
                .order_by(Resident.id.asc())
                .all()
            )

            actual_count = len(family_residents)

            if actual_count == 0:
                db.session.delete(family)
                continue

            family.member_count = actual_count

            heads = [r for r in family_residents if r.is_head_of_family]
            if not heads:
                head_norm = normalize_name(family.head_name)
                matched_head = next(
                    (
                        r for r in family_residents
                        if _name_matches(head_norm, normalize_name(r.get_full_name()))
                        or _name_matches(head_norm, normalize_name(f"{r.first_name} {r.last_name}"))
                    ),
                    family_residents[0]
                )
                matched_head.is_head_of_family = True
                if not matched_head.relationship_to_head or normalize_name(matched_head.relationship_to_head) in {"self", "head", "household head"}:
                    matched_head.relationship_to_head = "Household Head"
            elif len(heads) > 1:
                for extra_head in heads[1:]:
                    extra_head.is_head_of_family = False

            for r in family_residents:
                r.family_members = actual_count

        db.session.flush()

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

            "errors": errors,

            "warnings": warnings
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

        residents = Resident.query.filter_by(
            family_id=family.id
        ).all()

        if not residents:

            continue

        head_normalized = normalize_name(
            family.head_name
        )

        matched_resident = next(
            (
                r for r in residents
                if _name_matches(query_normalized, normalize_name(r.get_full_name()))
                or _name_matches(query_normalized, normalize_name(f"{r.first_name} {r.last_name}"))
            ),
            None
        )

        if not _name_matches(
            query_normalized,
            head_normalized
        ) and matched_resident is None:

            continue

        barangay = Barangay.query.get(
            family.barangay_id
        )

        representative = (
            matched_resident
            or next((r for r in residents if r.is_head_of_family), None)
            or residents[0]
        )

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

            "resident_name": representative.get_full_name(),

            "household_head_name": family.head_name,

            "family_code": family.family_code,

            "address": representative.address or family.address,

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
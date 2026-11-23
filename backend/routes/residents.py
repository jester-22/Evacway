import re
import time
from collections import defaultdict
from threading import Lock

from datetime import date, datetime

import pandas as pd

from flask import Blueprint, request, jsonify
from flask_jwt_extended import get_jwt_identity
from sqlalchemy import func
from sqlalchemy.orm import joinedload

from models import (
    db,
    Amenity,
    Resident,
    Family,
    Barangay,
    EvacuationCenter,
    EvacuationCenterBuilding,
    EvacuationCenterRoom,
    EvacuationAssignment,
    CenterBarangay,
    SystemLog,
    ResidentLookupLog,
    ResidentAccount,
    User,
    RosterYear,
    philippines_now,
)

from utils import get_optional_caller, public_room_payload, role_required


residents_bp = Blueprint('residents', __name__)

_lookup_limit_buckets = defaultdict(list)
_lookup_miss_counts = defaultdict(int)
_lookup_limit_lock = Lock()
LOOKUP_RATE_LIMIT_MAX_REQUESTS = 10
LOOKUP_RATE_LIMIT_WINDOW_SECONDS = 900


def _lookup_rate_keys(scope, caller):
    client_ip = (
        request.headers.get('X-Real-IP')
        or request.remote_addr
        or 'unknown'
    ).strip()
    keys = [f"{scope}:ip:{client_ip}"]
    account_id = caller.get('account_id') if caller else None
    if account_id is not None:
        keys.append(f"{scope}:account:{account_id}")
    return keys


def _is_lookup_rate_limited(scope, caller, max_requests=None, window_seconds=None):
    max_requests = max_requests or LOOKUP_RATE_LIMIT_MAX_REQUESTS
    window_seconds = window_seconds or LOOKUP_RATE_LIMIT_WINDOW_SECONDS
    now = time.monotonic()
    keys = _lookup_rate_keys(scope, caller)
    with _lookup_limit_lock:
        for key in keys:
            _lookup_limit_buckets[key] = [
                timestamp for timestamp in _lookup_limit_buckets[key]
                if now - timestamp < window_seconds
            ]
        if any(len(_lookup_limit_buckets[key]) >= max_requests for key in keys):
            return True
        for key in keys:
            _lookup_limit_buckets[key].append(now)
    return False


def _mask_lookup_value(value):
    if value is None or str(value).strip() == '':
        return None
    words = str(value).strip().split()
    return ' '.join(word[:1] + '*' * max(len(word) - 1, 1) for word in words)[:150]


def _record_resident_lookup(
    scope, caller, name=None, barangay=None, birthdate=None, found=False, extra=None
):
    db.session.add(ResidentLookupLog(
        lookup_type=scope,
        resident_account_id=caller.get('account_id') if caller else None,
        client_ip=_lookup_rate_keys(scope, caller)[0].split(':ip:', 1)[-1],
        query_name_masked=_mask_lookup_value(name),
        query_barangay_masked=(_mask_lookup_value(barangay) or '')[:100] or None,
        query_extra_masked=(_mask_lookup_value(extra) or '')[:150] or None,
        query_birthdate_masked='****-**-**' if birthdate else None,
        found=bool(found),
    ))
    db.session.commit()


def _apply_lookup_miss_delay(scope, caller, found):
    keys = _lookup_rate_keys(scope, caller)
    delay = 0
    with _lookup_limit_lock:
        for key in keys:
            if found:
                _lookup_miss_counts.pop(key, None)
            else:
                _lookup_miss_counts[key] += 1
                if _lookup_miss_counts[key] >= 3:
                    delay = max(delay, min(0.75, 0.25 * (_lookup_miss_counts[key] - 2)))
    if delay:
        time.sleep(delay)


def _lookup_rate_limit_response():
    return jsonify({"error": "Too many attempts. Please wait a moment and try again."}), 429


def _no_center_match_response():
    return jsonify({"message": "No match found."}), 200


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

    "accessibility notes": "amenities",
    "accessibility_notes": "amenities",
    "amenities": "amenities",

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

    "room capacity": "people_spaces",
    "room_capacity": "people_spaces",
    "capacity of room": "people_spaces",
    "people spaces": "people_spaces",
    "people_spaces": "people_spaces",
    "family slots": "family_slots",
    "family_slots": "family_slots",
    "room slots": "family_slots",
    "room_family_slots": "family_slots"
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
        or parsed >= philippines_now().date()
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
        "amenities",
        "center_contact",

        # Room
        "room_number",
        "people_spaces"
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

            amenities = clean_value(
                row.get("amenities") or row.get("accessibility_notes")
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

            people_spaces = parse_integer(
                row.get("people_spaces"),
                "room capacity / people spaces",
                excel_row,
                errors
            )
            family_slots_provided = clean_value(row.get("family_slots")) is not None
            parsed_family_slots = parse_integer(
                row.get("family_slots"),
                "family slots",
                excel_row,
                errors
            )
            family_slots = parsed_family_slots if parsed_family_slots is not None else 5

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

            if people_spaces is None:

                errors.append(
                    f"Row {excel_row}: "
                    "missing room capacity, skipped."
                )

                skipped += 1
                continue

            if people_spaces <= 0:

                errors.append(
                    f"Row {excel_row}: "
                    "room capacity must be greater than 0, skipped."
                )

                skipped += 1
                continue

            if family_slots_provided and parsed_family_slots is None:
                skipped += 1
                continue

            if family_slots <= 0:
                errors.append(
                    f"Row {excel_row}: family slots must be greater than 0, skipped."
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

                    contact_number=(
                        center_contact
                    ),

                    is_active=True,

                    geom=None,

                    entrance_geom=None
                )

                if amenities:
                    all_ams = Amenity.query.filter_by(is_active=True).all()
                    text_lower = str(amenities).lower()
                    matched = [a for a in all_ams if a.name.lower() in text_lower or a.code.lower() in text_lower]
                    if matched:
                        center.amenities = matched

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

                    capacity=people_spaces,
                    family_slots=family_slots,
                    people_spaces=people_spaces,

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

                if room.people_spaces != people_spaces or (
                    family_slots_provided and room.family_slots != family_slots
                ):

                    errors.append(
                        f"Row {excel_row}: "
                        f"room '{room.room_number}' "
                        f"in '{center.name}' "
                        f"has different room limits "
                        f"(people spaces {room.people_spaces} vs {people_spaces}"
                        + (f", family slots {room.family_slots} vs {family_slots}" if family_slots_provided else "")
                        + "), skipped."
                    )

                    skipped += 1
                    continue

            # =================================================
            # ROOM CAPACITY CHECK
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

            assigned_count = (
                EvacuationAssignment.query
                .filter_by(
                    room_id=room.id
                )
                .count()
            )

            assigned_family_ids = {
                family_id
                for (family_id,) in (
                    db.session.query(Resident.family_id)
                    .join(EvacuationAssignment, EvacuationAssignment.resident_id == Resident.id)
                    .filter(
                        EvacuationAssignment.room_id == room.id,
                        Resident.family_id.is_not(None)
                    )
                    .distinct()
                    .all()
                )
            }
            household_already_uses_slot = family is not None and family.id in assigned_family_ids
            if assigned_count >= room.people_spaces:

                errors.append(
                    f"Row {excel_row}: "
                    f"room '{room.room_number}' "
                    f"in '{center.name}' "
                    f"has no people spaces available "
                    f"({assigned_count}/{room.people_spaces}), "
                    "skipped."
                )

                skipped += 1
                continue

            if not household_already_uses_slot and len(assigned_family_ids) >= room.family_slots:
                errors.append(
                    f"Row {excel_row}: room '{room.room_number}' in '{center.name}' "
                    f"has no family slots available ({len(assigned_family_ids)}/{room.family_slots}), skipped."
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

                    address=address,

                    vulnerable_members=vulnerable_members,

                    remarks=remarks,

                    uploaded_by=user_id,

                    evacuation_status="Unassigned"
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

            family.member_count = actual_count

        db.session.flush()

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
                family.evacuation_status = "Unassigned"
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

            if assigned_count > 0:
                family.evacuation_status = "Assigned"
            else:
                family.evacuation_status = "Unassigned"

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

    barangay_filter = request.args.get('barangay')
    year_filter = request.args.get('year')
    roster_year_id_filter = request.args.get('roster_year_id')

    query = Resident.query.outerjoin(Resident.family).outerjoin(Family.barangay).options(
        joinedload(Resident.family).joinedload(Family.barangay),
        joinedload(Resident.family).joinedload(Family.roster_year)
    )

    if roster_year_id_filter:
        try:
            query = query.filter(Family.roster_year_id == int(roster_year_id_filter))
        except (TypeError, ValueError):
            pass
    elif year_filter:
        try:
            query = query.join(Family.roster_year).filter(RosterYear.year == int(year_filter))
        except (TypeError, ValueError):
            pass

    if barangay_filter:
        normalized_filter = normalize_barangay_name(barangay_filter)
        query = query.filter(func.lower(func.trim(Barangay.name)) == normalized_filter.lower())

    residents = query.order_by(
        Barangay.name,
        Family.head_name,
        Resident.last_name,
        Resident.first_name
    ).all()

    linked_resident_ids = {
        resident_id
        for (resident_id,) in (
            db.session.query(User.resident_id)
            .filter(User.resident_id.isnot(None))
            .union(
                db.session.query(ResidentAccount.resident_id)
                .filter(ResidentAccount.resident_id.isnot(None))
            )
            .all()
        )
    }
    result = []
    for resident in residents:
        resident_data = resident.to_dict()
        resident_data["already_linked"] = resident.id in linked_resident_ids
        result.append(resident_data)

    return jsonify(result), 200


# =========================================================
# FIND MY EVACUATION CENTER (verified public lookup)
# =========================================================

def _resident_family_assignment(family_id):
    assignment = (
        db.session.query(EvacuationAssignment)
        .join(Resident, EvacuationAssignment.resident_id == Resident.id)
        .filter(Resident.family_id == family_id)
        .order_by(EvacuationAssignment.id.asc())
        .first()
    )
    if not assignment:
        return None, None
    center_id = assignment.evacuation_center_id
    if assignment.room_id:
        center_id = db.session.query(EvacuationCenterRoom.evacuation_center_id).filter_by(
            id=assignment.room_id
        ).scalar()
    center = db.session.query(
        EvacuationCenter.id, EvacuationCenter.name
    ).filter_by(id=center_id).first() if center_id else None
    return assignment, center


@residents_bp.route('/api/residents/my-center-lookup', methods=['POST'])
def lookup_my_evacuation_center():
    caller = get_optional_caller()
    payload = request.get_json(silent=True) or {}
    full_name = str(payload.get('full_name') or '').strip()
    barangay_id = payload.get('barangay_id')
    barangay_value = str(barangay_id or '').strip()
    birthdate_value = str(payload.get('birthdate') or '').strip()
    birthdate = None
    try:
        barangay_id = int(barangay_id)
        birthdate = date.fromisoformat(birthdate_value)
    except (TypeError, ValueError):
        barangay_id = None

    if _is_lookup_rate_limited('my_center', caller):
        _record_resident_lookup(
            'my_center', caller, full_name, barangay_value, birthdate_value, False
        )
        return _lookup_rate_limit_response()

    matching_families = []
    normalized_name = normalize_name(full_name)
    if normalized_name and barangay_id and birthdate:
        for family in Family.query.filter_by(barangay_id=barangay_id).all():
            if normalize_name(family.head_name) != normalized_name:
                continue
            heads = Resident.query.filter_by(
                family_id=family.id,
                is_head_of_family=True,
            ).all()
            if any(head.date_of_birth == birthdate for head in heads):
                matching_families.append(family)
                if len(matching_families) > 1:
                    break

    center = None
    if len(matching_families) == 1:
        _, center = _resident_family_assignment(matching_families[0].id)
    found = bool(len(matching_families) == 1 and center)
    _record_resident_lookup(
        'my_center', caller, full_name, barangay_value, birthdate_value, found
    )
    _apply_lookup_miss_delay('my_center', caller, found)
    if not found:
        return _no_center_match_response()
    return jsonify({'center_name': center.name}), 200


@residents_bp.route('/api/residents/my-center', methods=['GET'])
def get_my_evacuation_center():
    caller = get_optional_caller()
    if _is_lookup_rate_limited('my_center', caller):
        _record_resident_lookup('my_center_self', caller, found=False)
        return _lookup_rate_limit_response()
    if caller is None:
        _record_resident_lookup('my_center_self', None, found=False)
        return jsonify({'error': 'Authentication required.'}), 401
    if caller.get('role') != 'resident':
        _record_resident_lookup('my_center_self', caller, found=False)
        return jsonify({'error': 'Resident access required.'}), 403

    assignment = EvacuationAssignment.query.filter_by(
        resident_id=caller['resident_id']
    ).order_by(EvacuationAssignment.id.asc()).first()
    room = db.session.get(EvacuationCenterRoom, assignment.room_id) if assignment and assignment.room_id else None
    center_id = room.evacuation_center_id if room else (
        assignment.evacuation_center_id if assignment else None
    )
    center = db.session.query(
        EvacuationCenter.id, EvacuationCenter.name
    ).filter_by(id=center_id).first() if center_id else None
    _record_resident_lookup('my_center_self', caller, found=bool(center))
    _apply_lookup_miss_delay('my_center', caller, bool(center))
    if not center:
        return _no_center_match_response()

    room_payload = public_room_payload(room, is_my_room=True) if room else None
    return jsonify({
        'center_name': center.name,
        'room': room_payload,
        'is_checked_in': bool(assignment and assignment.checked_in_at),
    }), 200


@residents_bp.route('/api/residents/find-center', methods=['GET', 'POST'])
def find_evacuation_center_for_resident():
    caller = get_optional_caller()
    if request.method == 'GET':
        full_name = str(request.args.get('name') or '').strip()
        if _is_lookup_rate_limited('find_someone', caller):
            _record_resident_lookup('find_someone', caller, full_name, found=False)
            return _lookup_rate_limit_response()
        _record_resident_lookup('find_someone', caller, full_name, found=False)
        if caller is None:
            return jsonify({'error': 'Authentication required.'}), 401
        if caller.get('role') != 'resident':
            return jsonify({'error': 'Resident access required.'}), 403
        return jsonify({'error': 'Send the full name in a protected search request.'}), 405

    payload = request.get_json(silent=True) or {}
    full_name = str(payload.get('full_name') or '').strip()
    barangay_value = payload.get('barangay_id')
    additional_detail = str(payload.get('additional_detail') or '').strip()
    if _is_lookup_rate_limited('find_someone', caller):
        _record_resident_lookup(
            'find_someone', caller, full_name, barangay_value,
            found=False, extra=additional_detail,
        )
        return _lookup_rate_limit_response()
    if caller is None:
        _record_resident_lookup(
            'find_someone', None, full_name, barangay_value,
            found=False, extra=additional_detail,
        )
        return jsonify({'error': 'Authentication required.'}), 401
    if caller.get('role') != 'resident':
        _record_resident_lookup(
            'find_someone', caller, full_name, barangay_value,
            found=False, extra=additional_detail,
        )
        return jsonify({'error': 'Resident access required.'}), 403

    normalized_name = normalize_name(full_name)
    try:
        barangay_id = int(barangay_value)
    except (TypeError, ValueError):
        barangay_id = None

    center = None
    if (
        normalized_name
        and len(normalized_name.split()) >= 2
        and barangay_id is not None
        and barangay_id > 0
    ):
        families = Family.query.filter_by(searchable=True, barangay_id=barangay_id).all()
        matching_families = []
        for family in families:
            residents = Resident.query.filter_by(family_id=family.id).all()
            if not any(
                normalize_name(resident.get_full_name()) == normalized_name
                for resident in residents
            ):
                continue
            if additional_detail and normalize_name(additional_detail) not in normalize_name(family.address or ''):
                continue
            matching_families.append(family)

        if len(matching_families) == 1:
            _, center = _resident_family_assignment(matching_families[0].id)

    found = bool(center)
    barangay_log_value = barangay_value
    if barangay_id is not None and barangay_id > 0:
        barangay = db.session.get(Barangay, barangay_id)
        if barangay:
            barangay_log_value = barangay.name
    _record_resident_lookup(
        'find_someone', caller, full_name, barangay_log_value,
        found=found, extra=additional_detail,
    )
    _apply_lookup_miss_delay('find_someone', caller, found)
    if not center:
        return _no_center_match_response()
    return jsonify({'center_name': center.name}), 200


@residents_bp.route('/api/residents/profile/find-someone', methods=['GET', 'PATCH'])
def resident_find_someone_privacy():
    caller = get_optional_caller()
    if caller is None:
        return jsonify({'error': 'Authentication required.'}), 401
    if caller.get('role') != 'resident':
        return jsonify({'error': 'Resident access required.'}), 403

    resident = db.session.get(Resident, caller['resident_id'])
    family = db.session.get(Family, resident.family_id) if resident and resident.family_id else None
    account = db.session.get(ResidentAccount, caller.get('account_id')) if caller.get('account_id') else None
    if not family or not account or account.resident_id != resident.id:
        return jsonify({'error': 'Family profile not found.'}), 404

    if request.method == 'GET':
        return jsonify({
            'searchable': bool(family.searchable),
            'prompt_pending': not bool(account.find_someone_prompt_seen),
        }), 200

    payload = request.get_json(silent=True) or {}
    value = payload.get('searchable')
    if not isinstance(value, bool):
        return jsonify({'error': 'Choose Yes or No for family center search.'}), 400
    family.searchable = value
    account.find_someone_prompt_seen = True
    family.find_someone_opt_out = not value
    db.session.commit()
    return jsonify({'searchable': bool(family.searchable), 'prompt_pending': False}), 200


# =========================================================
# AUTOSUGGEST (Name lookup suggestions for residents)
# =========================================================

_autosuggest_rate_limits = defaultdict(list)

def _is_autosuggest_rate_limited(ip, max_requests=30, window_seconds=60):
    now = time.time()
    timestamps = _autosuggest_rate_limits[ip]
    _autosuggest_rate_limits[ip] = [ts for ts in timestamps if now - ts < window_seconds]
    if len(_autosuggest_rate_limits[ip]) >= max_requests:
        return True
    _autosuggest_rate_limits[ip].append(now)
    return False


@residents_bp.route('/api/residents/autosuggest', methods=['GET'])
def autosuggest_residents():
    caller = get_optional_caller()
    query = request.args.get('q', '').strip() or request.args.get('name', '').strip()
    if caller is None or caller.get('role') not in ('admin', 'lgu_personnel'):
        if _is_lookup_rate_limited('find_someone', caller, max_requests=30, window_seconds=60):
            _record_resident_lookup('find_someone', caller, query, found=False)
            return _lookup_rate_limit_response()
        _record_resident_lookup('find_someone', caller, query, found=False)
        status = 401 if caller is None else 403
        error = 'Authentication required.' if caller is None else 'Staff access required.'
        return jsonify({"error": error}), status

    client_ip = (
        request.headers.get('X-Forwarded-For', '')
        .split(',')[0]
        .strip()
        or request.remote_addr
        or '127.0.0.1'
    )

    if _is_autosuggest_rate_limited(client_ip, max_requests=30, window_seconds=60):
        return jsonify({
            "error": "Rate limit exceeded. Please wait a moment before trying again."
        }), 429

    query_normalized = normalize_name(query)

    if not query_normalized or len(query_normalized) < 1:
        return jsonify({
            "suggestions": []
        }), 200

    import unicodedata

    def strip_accents(s):
        if not s:
            return ""
        return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn').lower().strip()

    q_clean = strip_accents(query)

    def score_match(name):
        n_clean = strip_accents(name)
        if not q_clean or not n_clean:
            return None
        # Rank names that start with the typed text first
        if n_clean.startswith(q_clean):
            return 0
        words = n_clean.split()
        # Start of first name
        if words and words[0].startswith(q_clean):
            return 1
        # Start of last name
        if len(words) > 1 and words[-1].startswith(q_clean):
            return 2
        # Start of any word in full name
        for i, w in enumerate(words):
            if w.startswith(q_clean):
                return 3 + i
        return None

    # Build barangay lookup
    barangays = {b.id: b.name for b in Barangay.query.all()}

    candidates = []
    seen = set()

    # Query families with barangay preloaded
    families = Family.query.join(Barangay).options(joinedload(Family.barangay)).all()
    for family in families:
        head_name = (family.head_name or '').strip()
        if not head_name:
            continue
        score = score_match(head_name)
        if score is not None:
            b_name = family.barangay.name if family.barangay else ''
            key = (head_name.lower(), b_name.lower())
            if key not in seen:
                seen.add(key)
                candidates.append((score, head_name, b_name))

    # Also check individual residents with family and barangay preloaded
    residents = Resident.query.join(Family).join(Barangay).options(
        joinedload(Resident.family).joinedload(Family.barangay)
    ).all()
    for res in residents:
        full_name = (res.get_full_name() or f"{res.first_name} {res.last_name}").strip()
        if not full_name:
            continue
        score = score_match(full_name)
        if score is not None:
            family = res.family
            b_name = family.barangay.name if (family and family.barangay) else ''
            key = (full_name.lower(), b_name.lower())
            if key not in seen:
                seen.add(key)
                candidates.append((score, full_name, b_name))

    # Sort candidates by score (lower score = higher rank), then alphabetically by name
    candidates.sort(key=lambda c: (c[0], c[1].lower()))
    suggestions = [{"name": c[1], "barangay": c[2]} for c in candidates[:5]]

    return jsonify({
        "suggestions": suggestions
    }), 200

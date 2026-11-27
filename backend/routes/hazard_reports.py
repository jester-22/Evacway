import os
import uuid
from collections import defaultdict
from flask import Blueprint, request, jsonify, current_app
from werkzeug.utils import secure_filename
from models import (
    db,
    Barangay,
    HazardReport,
    HazardReportPhoto,
    SystemLog,
    RoadSegment,
    User,
    ResidentAccount,
    Resident,
    utc_now,
    to_utc_iso,
)
from sqlalchemy import func
from sqlalchemy.orm import aliased, selectinload
from geoalchemy2 import Geography
from geoalchemy2.shape import to_shape, from_shape
from shapely.geometry import mapping, Point
from flask_jwt_extended import get_jwt_identity, jwt_required, get_jwt
from utils import role_required
from datetime import datetime, timedelta, timezone
from services.notifications import (
    create_staff_notifications,
    send_staff_push_notifications,
)
from services.pathfinding import (
    snap_point_to_road,
    invalidate_road_network_cache,
    haversine,
)
from services.sogod_boundary import is_inside_sogod
from services.upload_storage import delete_uploaded_photo, save_uploaded_photo
from services.public_status import (
    active_hazard_status_filter,
    get_public_active_operation_alert,
    get_public_status_summary,
    hazard_status_group,
)


reports_bp = Blueprint('reports', __name__)

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'jpe', 'webp'}

ALLOWED_HAZARD_TRANSITIONS = {
    'pending': {'validated', 'rejected'},
    'validated': {'resolved'},
    'rejected': set(),
    'resolved': set(),
}

MAX_REJECTION_REASON_LENGTH = 2000

ROAD_CLOSURE_RECHECK_HOURS = 24


def hazard_needs_recheck(
    report,
    blocks_road,
    now=None,
    threshold_hours=ROAD_CLOSURE_RECHECK_HOURS,
):
    """Return True if a validated hazard closing road(s) has exceeded the re-check threshold."""
    status = str(getattr(report, 'status', '') or '').strip().lower()
    if status != 'validated' or not blocks_road:
        return False

    since = getattr(report, 'validated_at', None) or getattr(report, 'submitted_at', None)
    if since is None:
        return False
    current_time = now if now is not None else utc_now()

    if getattr(since, 'tzinfo', None) is not None and getattr(current_time, 'tzinfo', None) is None:
        since = since.astimezone(timezone.utc).replace(tzinfo=None)
    elif getattr(since, 'tzinfo', None) is None and getattr(current_time, 'tzinfo', None) is not None:
        current_time = current_time.astimezone(timezone.utc).replace(tzinfo=None)

    return (current_time - since) >= timedelta(hours=threshold_hours)


def _parse_duplicate_of(raw_value, report_id):
    """Validate an optional duplicate_of incident ID. Returns (int_or_None, error_message_or_None)."""
    if raw_value is None or raw_value == '':
        return None, None
    try:
        dup_id = int(raw_value)
    except (TypeError, ValueError):
        return None, "duplicate_of must be a valid incident ID."
    if dup_id <= 0:
        return None, "duplicate_of must be a valid incident ID."
    if dup_id == report_id:
        return None, "An incident cannot be marked as a duplicate of itself."
    target = HazardReport.query.get(dup_id)
    if not target:
        return None, f"Original incident #{dup_id} was not found."
    return dup_id, None

# system_logs.action is varchar(255). A single road is usually made up of
# several RoadSegment rows sharing the same road_name, so any list built
# from matched segments needs deduping — and as a safety net we also hard
# -truncate before insert so a long/unexpected list can never crash a
# request with a DataError again.
SYSTEM_LOG_ACTION_LIMIT = 255


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def is_road_blockage_report(report):
    t = (getattr(report, 'report_type', '') or '').lower()
    return 'block' in t or 'obstruct' in t


def _format_resident_username(first_name, middle_name=None, last_name=None, suffix=None):
    base = " ".join(
        str(part).strip()
        for part in (first_name, middle_name, last_name)
        if part and str(part).strip()
    )
    full = " ".join(part for part in (base, suffix) if part and str(part).strip())
    return full or None


def resolve_report_reporter_username(report):
    """Resolve the reporter's username/display name from the linked account without exposing contact info."""
    if not report:
        return None
    if getattr(report, 'reported_by_user_id', None) and getattr(report, 'reporter_user', None):
        name = (report.reporter_user.name or '').strip()
        return name or None
    acct = getattr(report, 'reporter_resident_account', None) if getattr(report, 'reported_by_resident_account_id', None) else None
    if acct and getattr(acct, 'resident', None):
        name = (acct.resident.get_full_name() or '').strip()
        return name or None
    return None


def _clean_barangay_name(value):
    """Trim and normalize a barangay name; return None for blank/placeholder values."""
    cleaned = " ".join(str(value or "").split()).strip()
    if not cleaned or cleaned.lower() in {"unknown", "unknown barangay", "n/a", "none"}:
        return None
    return cleaned[:100]


def resolve_barangay_name_for_point(point, fallback_name=None):
    """Resolve the authoritative barangay name for a hazard point.

    1. Prefer a PostGIS Barangay polygon containing the point (when Barangay.geom exists).
    2. Otherwise use the cleaned barangay_name supplied at submission time.
    """
    if point is not None:
        try:
            dialect = db.engine.dialect.name
            if dialect == 'postgresql':
                pt_geom = func.ST_SetSRID(func.ST_MakePoint(point.x, point.y), 4326)
                matched = (
                    db.session.query(Barangay.name)
                    .filter(Barangay.geom.isnot(None))
                    .filter(func.ST_Covers(Barangay.geom, pt_geom))
                    .first()
                )
                if matched and matched[0]:
                    return _clean_barangay_name(matched[0])
        except Exception:
            current_app.logger.debug("Spatial barangay lookup unavailable for hazard report point")
    return _clean_barangay_name(fallback_name)


def _spatial_barangay_names_for_reports(reports):
    """Batch-resolve barangay names from Barangay.geom for legacy reports missing barangay_name."""
    missing_ids = [r.id for r in reports if not _clean_barangay_name(getattr(r, 'barangay_name', None))]
    if not missing_ids:
        return {}
    try:
        if db.engine.dialect.name != 'postgresql':
            return {}
        rows = (
            db.session.query(HazardReport.id, Barangay.name)
            .join(Barangay, func.ST_Covers(Barangay.geom, HazardReport.geom))
            .filter(HazardReport.id.in_(missing_ids), Barangay.geom.isnot(None))
            .all()
        )
        resolved = {}
        for report_id, b_name in rows:
            cleaned = _clean_barangay_name(b_name)
            if cleaned and report_id not in resolved:
                resolved[report_id] = cleaned
        return resolved
    except Exception:
        return {}


def _resolved_barangay_for_report(report):
    stored = _clean_barangay_name(getattr(report, 'barangay_name', None))
    if stored:
        return stored
    return _spatial_barangay_names_for_reports([report]).get(report.id)


def report_to_dict(
    report,
    lat=None,
    lng=None,
    include_reporter=False,
    reporter_username=None,
    validated_by_name=None,
    closed_roads=None,
    barangay_name=None,
):
    if lat is None or lng is None:
        if report and getattr(report, 'geom', None) is not None:
            shapely_geom = to_shape(report.geom)
            coords = mapping(shapely_geom)['coordinates']  # [lng, lat]
            lng = coords[0]
            lat = coords[1]

    photos = []
    if getattr(report, 'photos', None):
        photos = [p.photo_path for p in report.photos if p.photo_path]
    if not photos and getattr(report, 'photo_url', None):
        photos = [report.photo_url]
    photo_url = photos[0] if photos else getattr(report, 'photo_url', None)

    closed_list = list(closed_roads) if closed_roads is not None else []
    blocks_road = len(closed_list) > 0
    resolved_barangay = _clean_barangay_name(
        barangay_name if barangay_name is not None else getattr(report, 'barangay_name', None)
    )

    payload = {
        "id": report.id,
        "description": report.description,
        "photo_url": photo_url,
        "photos": photos,
        "report_type": report.report_type,
        "barangay_name": resolved_barangay,
        "status": report.status,
        "status_group": hazard_status_group(report.status),
        "response_notes": report.response_notes,
        "rejection_reason": getattr(report, 'rejection_reason', None),
        "duplicate_of": getattr(report, 'duplicate_of', None),
        "blocks_road": blocks_road,
        "closed_roads": closed_list,
        "needs_recheck": hazard_needs_recheck(report, blocks_road),
        "recheck_threshold_hours": ROAD_CLOSURE_RECHECK_HOURS,
        "latitude": float(lat) if lat is not None else None,
        "longitude": float(lng) if lng is not None else None,
        "submitted_at": to_utc_iso(report.submitted_at),
        "validated_at": to_utc_iso(report.validated_at),
        "validated_by": report.validated_by,
    }
    if include_reporter:
        clean_reporter = (str(reporter_username).strip() if reporter_username else "") or None
        payload["reporter_username"] = clean_reporter
        payload["reporter_name"] = clean_reporter
        payload["reporter_deleted"] = clean_reporter is None
        if validated_by_name is not None:
            payload["validated_by_name"] = validated_by_name
    return payload


def dedupe(names):
    """Remove duplicate road names while preserving order. A single road
    is commonly split into many RoadSegment rows with the same name, so
    a raw match list is full of repeats before this is applied."""
    return list(dict.fromkeys(names))


def safe_log_action(text, limit=SYSTEM_LOG_ACTION_LIMIT):
    """Hard-truncate so a SystemLog insert can never fail with
    StringDataRightTruncation and take down the whole request."""
    return text if len(text) <= limit else text[: limit - 1] + "…"


def get_blockage_stretch_segments(report, all_segments=None):
    """
    Finds the road segment(s) affected by a hazard report (all hazard types):
    1. Uses the report's stored point (PostGIS geom, SRID 4326).
    2. Finds the nearest road segment to the reported point.
    3. If the report is at an intersection, closes each connected road arm to
       its next intersection. Otherwise, closes the road stretch between the
       first intersection on either side.
    """
    if not report or getattr(report, 'geom', None) is None:
        return []

    if all_segments is None:
        all_segments = RoadSegment.query.all()

    if not all_segments:
        return []

    node_to_segs = defaultdict(list)
    seg_endpoints = {}

    for s in all_segments:
        coords = list(to_shape(s.geom).coords)
        u = (round(coords[0][0], 6), round(coords[0][1], 6))
        v = (round(coords[-1][0], 6), round(coords[-1][1], 6))
        seg_endpoints[s.id] = (u, v)
        node_to_segs[u].append(s)
        node_to_segs[v].append(s)

    def is_intersection_node(node, current_road_name=None):
        segs = node_to_segs.get(node, [])
        if len(segs) >= 3:
            return True
        if current_road_name is not None and any(s.road_name != current_road_name for s in segs):
            return True
        return False

    pt = to_shape(report.geom)  # Point(lng, lat)
    report_lng, report_lat = pt.x, pt.y

    closed_segs = set()
    # A report centered on an intersection closes each connected arm up to
    # its next intersection. Away from an intersection, close only the
    # affected road corridor.
    intersection_nodes = [
        node for node in node_to_segs if is_intersection_node(node)
    ]
    nearby_intersections = [
        (haversine(report_lat, report_lng, node[1], node[0]) * 1000.0, node)
        for node in intersection_nodes
    ]
    # haversine returns kilometers. Compare in meters so a road-side pin does
    # not get mistaken for an intersection report and close every connected arm.
    nearby_intersections = [item for item in nearby_intersections if item[0] <= 3]

    if nearby_intersections:
        _, intersection_node = min(nearby_intersections, key=lambda item: item[0])

        def close_arm(first_seg):
            closed_segs.add(first_seg)
            target_road_name = first_seg.road_name
            u, v = seg_endpoints[first_seg.id]
            curr_node = v if u == intersection_node else u
            curr_seg = first_seg

            while not is_intersection_node(curr_node, target_road_name):
                next_candidates = [
                    seg for seg in node_to_segs[curr_node]
                    if seg.id != curr_seg.id and seg.road_name == target_road_name
                ]
                if not next_candidates:
                    break
                next_seg = next_candidates[0]
                if next_seg in closed_segs:
                    break
                closed_segs.add(next_seg)
                u_next, v_next = seg_endpoints[next_seg.id]
                curr_node = v_next if u_next == curr_node else u_next
                curr_seg = next_seg

        for arm in node_to_segs[intersection_node]:
            close_arm(arm)

        return list(closed_segs)

    best_seg = None
    min_dist = float('inf')

    for s in all_segments:
        line = to_shape(s.geom)
        d = line.distance(pt)
        if d < min_dist:
            min_dist = d
            best_seg = s

    if not best_seg:
        return []

    target_road_name = best_seg.road_name
    closed_segs.add(best_seg)

    for start_node in seg_endpoints[best_seg.id]:
        curr_node = start_node
        curr_seg = best_seg
        while True:
            if is_intersection_node(curr_node, target_road_name):
                break
            next_candidates = [
                s for s in node_to_segs[curr_node]
                if s.id != curr_seg.id and s.road_name == target_road_name
            ]
            if not next_candidates:
                break
            nxt = next_candidates[0]
            if nxt in closed_segs:
                break
            closed_segs.add(nxt)
            u_nxt, v_nxt = seg_endpoints[nxt.id]
            other_node = v_nxt if u_nxt == curr_node else u_nxt
            curr_seg = nxt
            curr_node = other_node

    return list(closed_segs)


def get_segments_for_report(report):
    """
    Backwards-compatible helper to find road segments associated with a report.
    Returns segments closed by this report, or the road stretch between nearest intersections.
    """
    if not report:
        return []
    closed = RoadSegment.query.filter_by(closed_by_report_id=report.id).all()
    if closed:
        return closed
    return get_blockage_stretch_segments(report)


def close_nearby_roads(report):
    """
    Closes the road segment(s) affected by the hazard report (all hazard types).
    Closes only the stretch of road between nearest intersections and records
    closed_by_report_id = report.id on each segment. Never closes segments by matching
    road_name alone.
    """
    segments = get_blockage_stretch_segments(report)
    closed_names = []
    for road in segments:
        if road:
            road.is_closed = True
            road.closed_by_report_id = report.id
            closed_names.append(road.road_name or f"Road #{road.id}")

    invalidate_road_network_cache()
    return dedupe(closed_names)


def reopen_roads_for_report(report):
    """
    Reopens segments where closed_by_report_id = report.id.
    If another validated, unresolved report (any hazard type) also covers a segment,
    keeps it closed and points closed_by_report_id to that report.
    Returns (reopened_names, still_closed_names).
    """
    segments_to_check = RoadSegment.query.filter_by(closed_by_report_id=report.id).all()
    if not segments_to_check:
        return [], []

    # Find other active validated, unresolved hazard reports (any report type)
    other_reports = (
        HazardReport.query
        .filter(
            HazardReport.id != report.id,
            HazardReport.status == 'validated',
        )
        .all()
    )

    all_segments = RoadSegment.query.all()
    other_coverage = {}
    for other in other_reports:
        for s in get_blockage_stretch_segments(other, all_segments):
            if s.id not in other_coverage:
                other_coverage[s.id] = other

    reopened_names = []
    still_closed_names = []

    for seg in segments_to_check:
        covering_other = other_coverage.get(seg.id)
        if covering_other:
            seg.is_closed = True
            seg.closed_by_report_id = covering_other.id
            still_closed_names.append(seg.road_name or f"Road #{seg.id}")
        else:
            seg.is_closed = False
            seg.closed_by_report_id = None
            reopened_names.append(seg.road_name or f"Road #{seg.id}")

    invalidate_road_network_cache()
    return dedupe(reopened_names), dedupe(still_closed_names)


def _resolve_authenticated_reporter():
    """Return (reported_by_user_id, reported_by_resident_account_id, display_name) or (None, None, None)."""
    claims = get_jwt() or {}
    ident = get_jwt_identity()
    account_type = claims.get('account_type', 'user')
    try:
        ident_int = int(ident) if ident is not None else None
    except (TypeError, ValueError):
        ident_int = None

    if ident_int is None or claims.get('mfa_flow'):
        return None, None, None

    if account_type == 'resident_account':
        acct = db.session.get(ResidentAccount, ident_int)
        if not acct or not acct.is_active:
            return None, None, None
        display_name = (acct.resident.get_full_name() if acct.resident else None) or f"Resident #{acct.id}"
        return None, acct.id, display_name

    if account_type != 'user':
        return None, None, None
    usr = db.session.get(User, ident_int)
    if not usr or not usr.is_active:
        return None, None, None
    if (
        usr.role == 'admin'
        or bool(usr.totp_enabled)
        or (
            usr.role == 'lgu_personnel'
            and current_app.config.get('LGU_TOTP_REQUIRED', False)
        )
    ):
        if (
            claims.get('mfa_verified') is not True
            or claims.get('mfa_version') != int(usr.mfa_version or 0)
        ):
            return None, None, None
    display_name = (usr.name or '').strip() or f"User #{usr.id}"
    return usr.id, None, display_name


@reports_bp.route('/api/hazard-reports', methods=['POST'])
@jwt_required()
def submit_hazard_report():
    # Every report comes from a registered account (resident_account or user).
    reported_by_user_id, reported_by_resident_account_id, reporter_display_name = (
        _resolve_authenticated_reporter()
    )
    if reported_by_user_id is None and reported_by_resident_account_id is None:
        return jsonify({"error": "An active registered account is required to submit a report"}), 401

    files = request.files.getlist('photos')
    if not files:
        files = request.files.getlist('photo')

    uploaded_files = [f for f in files if f and f.filename and f.filename.strip() != '']

    if not uploaded_files:
        return jsonify({"error": "At least one photo is required"}), 400

    if len(uploaded_files) > 5:
        return jsonify({"error": "Maximum of 5 photos allowed per hazard report"}), 400

    for f in uploaded_files:
        if not allowed_file(f.filename):
            return jsonify({"error": f"Invalid file format: '{f.filename}'. Allowed formats: png, jpg, jpeg, jpe, webp"}), 400

    description = request.form.get('description')
    report_type = request.form.get('report_type')
    latitude = request.form.get('latitude')
    longitude = request.form.get('longitude')

    if not all([description, latitude, longitude]):
        return jsonify({"error": "description, latitude, and longitude are required"}), 400

    try:
        report_latitude = float(latitude)
        report_longitude = float(longitude)
        if not is_inside_sogod(report_latitude, report_longitude):
            return jsonify({"error": "Hazard reports can only be submitted for locations inside Sogod."}), 400
    except (FileNotFoundError, ValueError, OSError):
        current_app.logger.exception("Could not validate hazard report against the Sogod boundary")
        return jsonify({"error": "Location validation is temporarily unavailable. Please try again later."}), 503

    uploader_folder = utc_now().strftime('%Y%m')

    saved_photo_urls = []
    saved_photo_metas = []
    try:
        for photo in uploaded_files:
            photo_url, photo_meta = save_uploaded_photo(photo, 'hazard', uploader_folder)
            saved_photo_urls.append(photo_url)
            saved_photo_metas.append(photo_meta)

        snap_pt, _, _, _ = snap_point_to_road(
            report_latitude,
            report_longitude,
            snap_to_intersection=False,
        )
        if not is_inside_sogod(snap_pt[0], snap_pt[1]):
            for photo_meta in saved_photo_metas:
                delete_uploaded_photo(photo_meta)
            return jsonify({"error": "The nearest reportable road is outside Sogod. Choose a location inside the boundary."}), 400
        point = Point(snap_pt[1], snap_pt[0])
        resolved_barangay = resolve_barangay_name_for_point(
            point,
            fallback_name=request.form.get('barangay_name') or request.form.get('barangay'),
        )

        first_photo_url = saved_photo_urls[0] if saved_photo_urls else ''

        report = HazardReport(
            description=description,
            photo_url=first_photo_url,
            report_type=report_type,
            barangay_name=resolved_barangay,
            status='pending',
            reported_by_user_id=reported_by_user_id,
            reported_by_resident_account_id=reported_by_resident_account_id,
            geom=from_shape(point, srid=4326)
        )
        db.session.add(report)
        db.session.flush()

        for idx, p_url in enumerate(saved_photo_urls):
            db.session.add(HazardReportPhoto(
                hazard_report_id=report.id,
                photo_path=p_url,
                sort_order=idx
            ))

        notifications = create_staff_notifications(
            event_type='hazard_report',
            resource_type='hazard_report',
            resource_id=report.id,
            title='New hazard report',
            message=f'{reporter_display_name} submitted a {report_type or "hazard"} report for review.',
        )
        db.session.commit()
    except ValueError as e:
        db.session.rollback()
        for photo_meta in saved_photo_metas:
            delete_uploaded_photo(photo_meta)
        return jsonify({"error": str(e)}), 400
    except Exception:
        db.session.rollback()
        for photo_meta in saved_photo_metas:
            delete_uploaded_photo(photo_meta)
        current_app.logger.exception("Failed to submit hazard report")
        return jsonify({"error": "Failed to submit hazard report. Please try again."}), 500

    try:
        send_staff_push_notifications(notifications)
    except Exception:
        current_app.logger.warning("Push notification dispatch failed for hazard report %s", report.id)

    return jsonify(report_to_dict(report)), 201


@reports_bp.route('/api/hazard-reports', methods=['GET'])
@role_required('admin', 'lgu_personnel')
def list_hazard_reports():
    status_filter = request.args.get('status')
    reporter_user = aliased(User)
    reporter_account = aliased(ResidentAccount)
    reporter_resident = aliased(Resident)
    validator_user = aliased(User)

    query = (
        db.session.query(
            HazardReport,
            func.ST_Y(HazardReport.geom).label('latitude'),
            func.ST_X(HazardReport.geom).label('longitude'),
            reporter_user.name.label('reporter_user_name'),
            reporter_resident.first_name.label('reporter_res_first'),
            reporter_resident.middle_name.label('reporter_res_middle'),
            reporter_resident.last_name.label('reporter_res_last'),
            reporter_resident.suffix.label('reporter_res_suffix'),
            validator_user.name.label('validated_by_name'),
        )
        .outerjoin(reporter_user, HazardReport.reported_by_user_id == reporter_user.id)
        .outerjoin(reporter_account, HazardReport.reported_by_resident_account_id == reporter_account.id)
        .outerjoin(reporter_resident, reporter_account.resident_id == reporter_resident.id)
        .outerjoin(validator_user, HazardReport.validated_by == validator_user.id)
    )
    if status_filter:
        if status_filter == 'active':
            query = query.filter(active_hazard_status_filter())
        else:
            query = query.filter(HazardReport.status == status_filter)
    rows = query.order_by(HazardReport.submitted_at.desc()).all()
    spatial_barangays = _spatial_barangay_names_for_reports([row[0] for row in rows])

    closed_segments = (
        RoadSegment.query
        .filter(
            RoadSegment.is_closed.is_(True),
            RoadSegment.closed_by_report_id.isnot(None),
        )
        .all()
    )
    closed_roads_by_report = defaultdict(list)
    for seg in closed_segments:
        closed_roads_by_report[seg.closed_by_report_id].append(
            seg.road_name or f"Road #{seg.id}"
        )

    results = []
    for (
        report,
        lat,
        lng,
        reporter_user_name,
        res_first,
        res_middle,
        res_last,
        res_suffix,
        validated_by_name,
    ) in rows:
        reporter_username = (
            (reporter_user_name or '').strip()
            or _format_resident_username(res_first, res_middle, res_last, res_suffix)
        )
        closed_roads = dedupe(closed_roads_by_report.get(report.id, []))
        resolved_barangay = (
            _clean_barangay_name(getattr(report, 'barangay_name', None))
            or spatial_barangays.get(report.id)
        )
        results.append(
            report_to_dict(
                report,
                lat=lat,
                lng=lng,
                include_reporter=True,
                reporter_username=reporter_username,
                validated_by_name=(validated_by_name or '').strip() or None,
                closed_roads=closed_roads,
                barangay_name=resolved_barangay,
            )
        )
    return jsonify(results)


def closed_road_names_near(report):
    """Names of the road segment(s) currently closed for this hazard report."""
    segments = RoadSegment.query.filter_by(closed_by_report_id=report.id, is_closed=True).all()
    if not segments:
        segments = [s for s in get_blockage_stretch_segments(report) if s.is_closed]
    return dedupe([r.road_name or f"Road #{r.id}" for r in segments if r and r.is_closed])


@reports_bp.route('/api/hazard-reports/public', methods=['GET'])
def list_public_hazard_reports():
    # Public on purpose: residents don't log in. Only active reports,
    # and only fields that are safe to show on the public map.
    query = (
        db.session.query(
            HazardReport,
            func.ST_Y(HazardReport.geom).label('latitude'),
            func.ST_X(HazardReport.geom).label('longitude'),
        )
        .options(selectinload(HazardReport.photos))
        .filter(active_hazard_status_filter())
    )
    rows = query.order_by(HazardReport.submitted_at.desc()).all()

    report_ids = [report.id for report, _, _ in rows]
    closed_roads_by_report = defaultdict(list)
    if report_ids:
        closed_segments_rows = (
            db.session.query(
                RoadSegment.id,
                RoadSegment.road_name,
                RoadSegment.closed_by_report_id,
            )
            .filter(
                RoadSegment.is_closed.is_(True),
                RoadSegment.closed_by_report_id.in_(report_ids),
            )
            .all()
        )
        for seg_id, seg_name, report_id in closed_segments_rows:
            closed_roads_by_report[report_id].append(seg_name or f"Road #{seg_id}")

    result = []
    for report, lat, lng in rows:
        closed_roads = dedupe(closed_roads_by_report.get(report.id, []))
        photos = []
        if getattr(report, 'photos', None):
            photos = [p.photo_path for p in report.photos if p.photo_path]
        if not photos and getattr(report, 'photo_url', None):
            photos = [report.photo_url]
        photo_url = photos[0] if photos else getattr(report, 'photo_url', None)

        result.append({
            "id": report.id,
            "description": report.description,
            "photo_url": photo_url,
            "photos": photos,
            "report_type": report.report_type,
            "status": report.status,
            "latitude": float(lat) if lat is not None else None,
            "longitude": float(lng) if lng is not None else None,
            "validated_at": to_utc_iso(report.validated_at),
            "blocks_road": len(closed_roads) > 0,
            "closed_roads": closed_roads
        })

    return jsonify(result)


@reports_bp.route('/api/public-status-summary', methods=['GET'])
def get_public_status_summary_route():
    response = jsonify(get_public_status_summary())
    response.headers['Cache-Control'] = 'public, max-age=60'
    return response


@reports_bp.route('/api/public-operation-alert', methods=['GET'])
def get_public_operation_alert_route():
    response = jsonify({"operation": get_public_active_operation_alert()})
    response.headers['Cache-Control'] = 'public, max-age=60'
    return response


@reports_bp.route('/api/hazard-reports/<int:report_id>/validate', methods=['PATCH'])
@role_required('admin', 'lgu_personnel')
def validate_hazard_report(report_id):
    report = HazardReport.query.get_or_404(report_id)
    data = request.get_json() or {}

    new_status = str(data.get('status') or '').strip().lower()  # 'validated', 'rejected', or 'resolved'
    if new_status not in ['validated', 'rejected', 'resolved']:
        return jsonify({"error": "status must be 'validated', 'rejected', or 'resolved'"}), 400

    current_status = str(report.status or 'pending').strip().lower()
    allowed_next = ALLOWED_HAZARD_TRANSITIONS.get(current_status, set())
    if new_status not in allowed_next:
        if not allowed_next:
            error_msg = (
                f"Cannot change a {current_status} incident to {new_status}. "
                f"No further status changes are allowed after {current_status}."
            )
        else:
            allowed_display = " or ".join(sorted(allowed_next))
            error_msg = (
                f"Cannot change a {current_status} incident to {new_status}. "
                f"Allowed next status: {allowed_display}."
            )
        return jsonify({"error": error_msg}), 400

    rejection_reason = None
    if new_status == 'rejected':
        raw_reason = data.get('rejection_reason')
        if raw_reason is None:
            raw_reason = data.get('reason')
        rejection_reason = str(raw_reason).strip() if raw_reason is not None else ''
        if not rejection_reason:
            return jsonify({"error": "A rejection reason is required."}), 400
        if len(rejection_reason) > MAX_REJECTION_REASON_LENGTH:
            return jsonify({
                "error": f"Rejection reason must be {MAX_REJECTION_REASON_LENGTH} characters or fewer."
            }), 400

    duplicate_of_provided = 'duplicate_of' in data
    duplicate_of_id = None
    if duplicate_of_provided:
        duplicate_of_id, dup_error = _parse_duplicate_of(data.get('duplicate_of'), report.id)
        if dup_error:
            return jsonify({"error": dup_error}), 400

    report.status = new_status
    if 'response_notes' in data:
        report.response_notes = data.get('response_notes')
    if new_status == 'rejected':
        report.rejection_reason = rejection_reason
    if duplicate_of_provided:
        report.duplicate_of = duplicate_of_id
    report.validated_by = get_jwt_identity()
    report.validated_at = utc_now()

    closed_roads = []
    reopened_roads = []
    if new_status == 'validated':
        closed_roads = close_nearby_roads(report)
    elif new_status in ['rejected', 'resolved']:
        reopened_roads, _ = reopen_roads_for_report(report)

    db.session.commit()

    log_action = f"{new_status.capitalize()} hazard report #{report.id}"
    if duplicate_of_provided and duplicate_of_id:
        log_action += f" (duplicate of #{duplicate_of_id})"
    if new_status == 'rejected' and rejection_reason:
        log_action += f" — reason: {rejection_reason}"
    if closed_roads:
        log_action += f" — auto-closed road(s): {', '.join(closed_roads)}"
    elif reopened_roads:
        log_action += f" — reopened road(s): {', '.join(reopened_roads)}"

    db.session.add(SystemLog(user_id=report.validated_by, action=safe_log_action(log_action)))
    db.session.commit()

    result = report_to_dict(
        report,
        include_reporter=True,
        reporter_username=resolve_report_reporter_username(report),
        validated_by_name=(report.validator_user.name.strip() if report.validator_user and report.validator_user.name else None),
        closed_roads=closed_roads,
        barangay_name=_resolved_barangay_for_report(report),
    )
    if reopened_roads:
        result['reopened_roads'] = reopened_roads
    return jsonify(result)


@reports_bp.route('/api/hazard-reports/<int:report_id>/duplicate', methods=['PATCH'])
@role_required('admin', 'lgu_personnel')
def update_hazard_report_duplicate(report_id):
    report = HazardReport.query.get_or_404(report_id)
    data = request.get_json() or {}

    duplicate_of_id, dup_error = _parse_duplicate_of(data.get('duplicate_of'), report.id)
    if dup_error:
        return jsonify({"error": dup_error}), 400

    report.duplicate_of = duplicate_of_id
    db.session.commit()

    if duplicate_of_id:
        log_action = f"Linked hazard report #{report.id} as duplicate of #{duplicate_of_id}"
    else:
        log_action = f"Cleared duplicate link on hazard report #{report.id}"
    db.session.add(SystemLog(user_id=get_jwt_identity(), action=safe_log_action(log_action)))
    db.session.commit()

    closed_segments = RoadSegment.query.filter_by(
        closed_by_report_id=report.id,
        is_closed=True,
    ).all()
    closed_roads = dedupe([s.road_name or f"Road #{s.id}" for s in closed_segments])

    return jsonify(
        report_to_dict(
            report,
            include_reporter=True,
            reporter_username=resolve_report_reporter_username(report),
            validated_by_name=(report.validator_user.name.strip() if report.validator_user and report.validator_user.name else None),
            closed_roads=closed_roads,
            barangay_name=_resolved_barangay_for_report(report),
        )
    )


@reports_bp.route('/api/hazard-reports/<int:report_id>/reopen-road', methods=['POST'])
@role_required('admin', 'lgu_personnel')
def reopen_road(report_id):
    report = HazardReport.query.get_or_404(report_id)

    current_status = str(report.status or 'pending').strip().lower()
    if 'resolved' not in ALLOWED_HAZARD_TRANSITIONS.get(current_status, set()):
        return jsonify({"error": "Only validated reports can trigger a road reopen"}), 400

    reopened_names, still_closed = reopen_roads_for_report(report)
    report.status = 'resolved'

    db.session.commit()

    log_action = f"Reopened road(s) for hazard report #{report.id}"
    if reopened_names:
        log_action += f": {', '.join(reopened_names)}"
    if still_closed:
        log_action += f" (kept closed, still flagged elsewhere: {', '.join(still_closed)})"

    db.session.add(SystemLog(user_id=get_jwt_identity(), action=safe_log_action(log_action)))
    db.session.commit()

    result = report_to_dict(
        report,
        include_reporter=True,
        reporter_username=resolve_report_reporter_username(report),
        validated_by_name=(report.validator_user.name.strip() if report.validator_user and report.validator_user.name else None),
        closed_roads=still_closed,
        barangay_name=_resolved_barangay_for_report(report),
    )
    result['reopened_roads'] = reopened_names
    result['still_closed'] = still_closed
    return jsonify(result)


@reports_bp.route('/api/hazard-reports/<int:report_id>', methods=['DELETE'])
@role_required('admin', 'lgu_personnel')
def delete_hazard_report(report_id):
    report = HazardReport.query.get_or_404(report_id)
    reopen_roads_for_report(report)

    db.session.delete(report)
    log_action = f"Deleted hazard report #{report_id}"
    db.session.add(SystemLog(user_id=get_jwt_identity(), action=safe_log_action(log_action)))
    db.session.commit()
    return jsonify({"message": f"Hazard report #{report_id} deleted successfully."})

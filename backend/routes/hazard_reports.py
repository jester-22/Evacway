import os
import uuid
from flask import Blueprint, request, jsonify, current_app
from werkzeug.utils import secure_filename
from models import db, HazardReport, SystemLog, RoadSegment, User, ResidentAccount
from sqlalchemy import func
from geoalchemy2 import Geography
from geoalchemy2.shape import to_shape, from_shape
from shapely.geometry import mapping, Point
from flask_jwt_extended import get_jwt_identity, jwt_required, get_jwt
from utils import role_required
from datetime import datetime
from services.notifications import (
    create_staff_notifications,
    send_staff_push_notifications,
)
from services.pathfinding import (
    snap_point_to_road,
    invalidate_road_network_cache,
    haversine,
)


reports_bp = Blueprint('reports', __name__)

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp'}

# system_logs.action is varchar(255). A single road is usually made up of
# several RoadSegment rows sharing the same road_name, so any list built
# from matched segments needs deduping — and as a safety net we also hard
# -truncate before insert so a long/unexpected list can never crash a
# request with a DataError again.
SYSTEM_LOG_ACTION_LIMIT = 255


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def report_to_dict(report):
    shapely_geom = to_shape(report.geom)
    coords = mapping(shapely_geom)['coordinates']  # [lng, lat]
    return {
        "id": report.id,
        "description": report.description,
        "photo_url": report.photo_url,
        "report_type": report.report_type,
        "status": report.status,
        "response_notes": report.response_notes,
        "latitude": coords[1],
        "longitude": coords[0],
        "submitted_at": report.submitted_at.isoformat() if report.submitted_at else None,
        "validated_at": report.validated_at.isoformat() if report.validated_at else None
    }


def dedupe(names):
    """Remove duplicate road names while preserving order. A single road
    is commonly split into many RoadSegment rows with the same name, so
    a raw match list is full of repeats before this is applied."""
    return list(dict.fromkeys(names))


def safe_log_action(text, limit=SYSTEM_LOG_ACTION_LIMIT):
    """Hard-truncate so a SystemLog insert can never fail with
    StringDataRightTruncation and take down the whole request."""
    return text if len(text) <= limit else text[: limit - 1] + "…"


def get_segments_for_report(report):
    """
    Finds the road segment(s) affected by a hazard report.
    - If the report is in the center of an intersection (or within 15 meters of
      an intersection node where multiple road segments meet), returns ALL segments
      meeting at that intersection node (from that intersection to each neighboring intersection).
    - If the report is along a road between intersections, returns ONLY that
      single road segment.
    """
    point = to_shape(report.geom)
    snap_pt, dist_m, sub_info, is_conn = snap_point_to_road(point.y, point.x)
    if not sub_info or not sub_info.get("seg_id"):
        return []

    u, v = sub_info.get("u"), sub_info.get("v")
    if not u or not v:
        road = RoadSegment.query.get(sub_info["seg_id"])
        return [road] if road else []

    # Check distance to endpoints u and v
    d_u = haversine(snap_pt[0], snap_pt[1], u[0], u[1]) * 1000.0
    d_v = haversine(snap_pt[0], snap_pt[1], v[0], v[1]) * 1000.0

    inter_node = None
    if d_u <= 15.0 and d_u <= d_v:
        inter_node = u
    elif d_v <= 15.0 and d_v <= d_u:
        inter_node = v

    # If near an endpoint node, check if multiple segments meet here (an intersection)
    if inter_node:
        all_segs = RoadSegment.query.all()
        matched = []
        for s in all_segs:
            line = to_shape(s.geom)
            coords = list(line.coords)
            start_d = haversine(inter_node[0], inter_node[1], coords[0][1], coords[0][0]) * 1000.0
            end_d = haversine(inter_node[0], inter_node[1], coords[-1][1], coords[-1][0]) * 1000.0
            if start_d <= 5.0 or end_d <= 5.0:
                matched.append(s)

        if len(matched) >= 2:
            return matched

    road = RoadSegment.query.get(sub_info["seg_id"])
    return [road] if road else []


def close_nearby_roads(report):
    """
    Closes the road segment(s) affected by the hazard.
    If at an intersection, closes all road branches meeting at that intersection.
    If along a road, closes only that single segment between intersections.
    """
    segments = get_segments_for_report(report)
    closed_names = []
    for road in segments:
        if road and not road.is_closed:
            road.is_closed = True
            closed_names.append(road.road_name or f"Road #{road.id}")

    invalidate_road_network_cache()
    return dedupe(closed_names)


def _resolve_hazard_uploader_folder():
    claims = get_jwt() or {}
    uploader_name = (
        request.form.get('reporter_name')
        or request.form.get('uploader')
        or claims.get('name')
    )
    if not uploader_name:
        ident = get_jwt_identity()
        account_type = claims.get('account_type', 'user')
        try:
            ident_int = int(ident) if ident is not None else None
        except (TypeError, ValueError):
            ident_int = None
        if ident_int is not None:
            if account_type == 'resident_account':
                acct = ResidentAccount.query.get(ident_int)
                if acct and acct.resident:
                    uploader_name = acct.resident.get_full_name()
                elif acct and acct.email:
                    uploader_name = acct.email.split('@')[0]
            else:
                usr = User.query.get(ident_int)
                if usr:
                    uploader_name = usr.name or (usr.email.split('@')[0] if usr.email else None)
    folder = secure_filename(str(uploader_name or '').strip())
    return folder or 'anonymous'


@reports_bp.route('/api/hazard-reports', methods=['POST'])
@jwt_required(optional=True)
def submit_hazard_report():
    # Only authenticated users (residents, LGU, admin) can submit reports.
    if 'photo' not in request.files:
        return jsonify({"error": "A photo is required"}), 400

    photo = request.files['photo']
    if photo.filename == '' or not allowed_file(photo.filename):
        return jsonify({"error": "Please upload a valid image (png, jpg, jpeg, webp)"}), 400

    description = request.form.get('description')
    report_type = request.form.get('report_type')
    latitude = request.form.get('latitude')
    longitude = request.form.get('longitude')

    if not all([description, latitude, longitude]):
        return jsonify({"error": "description, latitude, and longitude are required"}), 400

    # Save the photo under static/uploads/hazard/<uploader>/<unique_name>
    uploader_folder = _resolve_hazard_uploader_folder()
    ext = photo.filename.rsplit('.', 1)[1].lower()
    unique_name = f"{uuid.uuid4().hex}.{ext}"
    upload_folder = os.path.join(
        current_app.root_path, 'static', 'uploads', 'hazard', uploader_folder
    )
    os.makedirs(upload_folder, exist_ok=True)
    photo.save(os.path.join(upload_folder, unique_name))
    photo_url = f"/static/uploads/hazard/{uploader_folder}/{unique_name}"

    snap_pt, _, _, _ = snap_point_to_road(float(latitude), float(longitude))
    point = Point(snap_pt[1], snap_pt[0])

    report = HazardReport(
        description=description,
        photo_url=photo_url,
        report_type=report_type,
        status='pending',
        geom=from_shape(point, srid=4326)
    )
    db.session.add(report)
    db.session.flush()
    claims = get_jwt() or {}
    reporter_name = claims.get('name') or 'A resident'
    notifications = create_staff_notifications(
        event_type='hazard_report',
        resource_type='hazard_report',
        resource_id=report.id,
        title='New hazard report',
        message=f'{reporter_name} submitted a {report_type or "hazard"} report for review.',
    )
    db.session.commit()
    send_staff_push_notifications(notifications)

    return jsonify(report_to_dict(report)), 201


@reports_bp.route('/api/hazard-reports', methods=['GET'])
@role_required('admin', 'lgu_personnel')
def list_hazard_reports():
    status_filter = request.args.get('status')
    query = HazardReport.query
    if status_filter:
        query = query.filter_by(status=status_filter)
    reports = query.order_by(HazardReport.submitted_at.desc()).all()
    return jsonify([report_to_dict(r) for r in reports])

def closed_road_names_near(report):
    """Names of the road segment(s) currently closed for this hazard report."""
    segments = get_segments_for_report(report)
    return dedupe([r.road_name or f"Road #{r.id}" for r in segments if r and r.is_closed])


@reports_bp.route('/api/hazard-reports/public', methods=['GET'])
def list_public_hazard_reports():
    # Public on purpose: residents don't log in. Only validated reports,
    # and only fields that are safe to show on the public map.
    reports = (
        HazardReport.query
        .filter_by(status='validated')
        .order_by(HazardReport.submitted_at.desc())
        .all()
    )

    result = []

    for report in reports:
        point = to_shape(report.geom)
        closed_roads = closed_road_names_near(report)

        result.append({
            "id": report.id,
            "description": report.description,
            "photo_url": report.photo_url,
            "report_type": report.report_type,
            "status": report.status,
            "latitude": point.y,
            "longitude": point.x,
            "validated_at": (
                report.validated_at.isoformat()
                if report.validated_at
                else None
            ),
            "blocks_road": len(closed_roads) > 0,
            "closed_roads": closed_roads
        })

    return jsonify(result)

@reports_bp.route('/api/hazard-reports/<int:report_id>/validate', methods=['PATCH'])
@role_required('admin', 'lgu_personnel')
def validate_hazard_report(report_id):
    report = HazardReport.query.get_or_404(report_id)
    data = request.get_json()

    new_status = data.get('status')  # 'validated' or 'rejected'
    if new_status not in ['validated', 'rejected']:
        return jsonify({"error": "status must be 'validated' or 'rejected'"}), 400

    report.status = new_status
    report.response_notes = data.get('response_notes')
    report.validated_by = get_jwt_identity()
    report.validated_at = datetime.utcnow()

    closed_roads = []
    if new_status == 'validated':
        closed_roads = close_nearby_roads(report)

    db.session.commit()

    log_action = f"{new_status.capitalize()} hazard report #{report.id}"
    if closed_roads:
        log_action += f" — auto-closed road(s): {', '.join(closed_roads)}"

    db.session.add(SystemLog(user_id=report.validated_by, action=safe_log_action(log_action)))
    db.session.commit()

    result = report_to_dict(report)
    result['closed_roads'] = closed_roads
    return jsonify(result)


@reports_bp.route('/api/hazard-reports/<int:report_id>/reopen-road', methods=['POST'])
@role_required('admin', 'lgu_personnel')
def reopen_road(report_id):
    report = HazardReport.query.get_or_404(report_id)

    if report.status != 'validated':
        return jsonify({"error": "Only validated reports can trigger a road reopen"}), 400

    segments = get_segments_for_report(report)

    other_reports = HazardReport.query.filter(
        HazardReport.id != report.id,
        HazardReport.status == 'validated',
    ).all()

    other_seg_ids = set()
    for other in other_reports:
        for s in get_segments_for_report(other):
            if s:
                other_seg_ids.add(s.id)

    reopened_names = []
    skipped_names = []

    for road in segments:
        if road and road.is_closed:
            if road.id in other_seg_ids:
                skipped_names.append(road.road_name or f"Road #{road.id}")
            else:
                road.is_closed = False
                reopened_names.append(road.road_name or f"Road #{road.id}")

    reopened_names = dedupe(reopened_names)
    skipped_names = dedupe(skipped_names)

    if reopened_names and not skipped_names:
        report.status = 'resolved'

    db.session.commit()
    invalidate_road_network_cache()

    log_action = f"Reopened road(s) for hazard report #{report.id}"
    if reopened_names:
        log_action += f": {', '.join(reopened_names)}"
    if skipped_names:
        log_action += f" (kept closed, still flagged elsewhere: {', '.join(skipped_names)})"

    db.session.add(SystemLog(user_id=get_jwt_identity(), action=safe_log_action(log_action)))
    db.session.commit()

    result = report_to_dict(report)
    result['reopened_roads'] = reopened_names
    result['still_closed'] = skipped_names
    return jsonify(result)
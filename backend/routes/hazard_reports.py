import os
import uuid
from flask import Blueprint, request, jsonify, current_app
from werkzeug.utils import secure_filename
from models import db, HazardReport, SystemLog, RoadSegment
from sqlalchemy import func
from geoalchemy2 import Geography
from geoalchemy2.shape import to_shape, from_shape
from shapely.geometry import mapping, Point
from flask_jwt_extended import get_jwt_identity
from utils import role_required
from datetime import datetime
from services.notifications import (
    create_staff_notifications,
    send_staff_push_notifications,
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


# Distance in meters within which a validated hazard report auto-closes

ROAD_CLOSURE_RADIUS_METERS = 100


def close_nearby_roads(report):

    report_geom_subquery = (
        db.session.query(HazardReport.geom)
        .filter(HazardReport.id == report.id)
        .scalar_subquery()
    )

    nearby_roads = RoadSegment.query.filter(
        func.ST_DWithin(
            func.cast(RoadSegment.geom, Geography),
            func.cast(report_geom_subquery, Geography),
            ROAD_CLOSURE_RADIUS_METERS
        )
    ).all()

    closed_names = []
    for road in nearby_roads:
        if not road.is_closed:
            road.is_closed = True
            closed_names.append(road.road_name or f"Road #{road.id}")

    return dedupe(closed_names)


@reports_bp.route('/api/hazard-reports', methods=['POST'])
def submit_hazard_report():
    # Residents don't log in — this is intentionally public, per the proposal.
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

    # Save the photo with a unique name so uploads never overwrite each other
    ext = photo.filename.rsplit('.', 1)[1].lower()
    unique_name = f"{uuid.uuid4().hex}.{ext}"
    upload_folder = os.path.join(current_app.root_path, 'static', 'uploads')
    os.makedirs(upload_folder, exist_ok=True)
    photo.save(os.path.join(upload_folder, unique_name))
    photo_url = f"/static/uploads/{unique_name}"

    point = Point(float(longitude), float(latitude))

    report = HazardReport(
        description=description,
        photo_url=photo_url,
        report_type=report_type,
        status='pending',
        geom=from_shape(point, srid=4326)
    )
    db.session.add(report)
    db.session.flush()
    notifications = create_staff_notifications(
        event_type='hazard_report',
        resource_type='hazard_report',
        resource_id=report.id,
        title='New hazard report',
        message=f'A resident submitted a {report_type or "hazard"} report for review.',
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
    """Names of roads that are currently closed within the closure radius."""
    report_geom_subquery = (
        db.session.query(HazardReport.geom)
        .filter(HazardReport.id == report.id)
        .scalar_subquery()
    )

    roads = RoadSegment.query.filter(
        RoadSegment.is_closed.is_(True),
        func.ST_DWithin(
            func.cast(RoadSegment.geom, Geography),
            func.cast(report_geom_subquery, Geography),
            ROAD_CLOSURE_RADIUS_METERS
        )
    ).all()

    return dedupe([road.road_name or f"Road #{road.id}" for road in roads])


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

    report_geom_subquery = (
        db.session.query(HazardReport.geom)
        .filter(HazardReport.id == report.id)
        .scalar_subquery()
    )

    nearby_roads = RoadSegment.query.filter(
        func.ST_DWithin(
            func.cast(RoadSegment.geom, Geography),
            func.cast(report_geom_subquery, Geography),
            ROAD_CLOSURE_RADIUS_METERS
        )
    ).all()

    reopened_names = []
    skipped_names = []

    for road in nearby_roads:
        if not road.is_closed:
            continue

        road_geom_subquery = (
            db.session.query(RoadSegment.geom)
            .filter(RoadSegment.id == road.id)
            .scalar_subquery()
        )

        # Don't reopen if another validated report still stands near this road
        other_active_report = HazardReport.query.filter(
            HazardReport.id != report.id,
            HazardReport.status == 'validated',
            func.ST_DWithin(
                func.cast(HazardReport.geom, Geography),
                func.cast(road_geom_subquery, Geography),
                ROAD_CLOSURE_RADIUS_METERS
            )
        ).first()

        if other_active_report:
            skipped_names.append(road.road_name or f"Road #{road.id}")
            continue

        road.is_closed = False
        reopened_names.append(road.road_name or f"Road #{road.id}")

    # A single road is usually many segments sharing one name — dedupe
    # before this list is used in a log message, a response, or an alert.
    reopened_names = dedupe(reopened_names)
    skipped_names = dedupe(skipped_names)

    # Only mark the report fully resolved if every nearby closed road
    # actually reopened. If something else is still blocking a road,
    # leave the report as 'validated' since the hazard isn't fully cleared.
    if reopened_names and not skipped_names:
        report.status = 'resolved'

    db.session.commit()

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
from datetime import datetime, timezone

from sqlalchemy import func

from models import db, EvacuationCenter, EvacuationOperation, HazardReport, RoadSegment


_PENDING_HAZARD_STATUSES = {"pending"}
_CLEARED_HAZARD_STATUSES = {"resolved", "cleared", "rejected"}
_NON_ACTIVE_HAZARD_STATUSES = _PENDING_HAZARD_STATUSES | _CLEARED_HAZARD_STATUSES


def hazard_status_group(status):
    normalized = str(status or "").strip().lower()
    if normalized in _PENDING_HAZARD_STATUSES:
        return "pending"
    if normalized in _CLEARED_HAZARD_STATUSES:
        return "cleared"
    return "active"


def active_hazard_status_filter():
    normalized_status = func.lower(
        func.trim(func.coalesce(HazardReport.status, ""))
    )
    return normalized_status.notin_(_NON_ACTIVE_HAZARD_STATUSES)


def active_hazard_reports_query():
    return HazardReport.query.filter(active_hazard_status_filter())


def mapped_open_centers_query():
    evacuation_status = func.lower(
        func.trim(func.coalesce(EvacuationCenter.evacuation_status, ""))
    )
    return EvacuationCenter.query.filter(
        EvacuationCenter.is_active.is_(True),
        EvacuationCenter.geom.isnot(None),
        evacuation_status == "open",
    )


def closed_road_segments_query():
    return RoadSegment.query.filter(RoadSegment.is_closed.is_(True))


def get_public_status_summary(now=None):
    server_time = now or datetime.now(timezone.utc)
    if server_time.tzinfo is None:
        server_time = server_time.replace(tzinfo=timezone.utc)

    return {
        "counts": {
            "open_centers": mapped_open_centers_query()
            .with_entities(func.count(EvacuationCenter.id)).scalar() or 0,
            "closed_roads": closed_road_segments_query()
            .with_entities(func.count(RoadSegment.id)).scalar() or 0,
            "active_danger_reports": active_hazard_reports_query()
            .with_entities(func.count(HazardReport.id)).scalar() or 0,
        },
        "last_updated": server_time.astimezone(timezone.utc).replace(tzinfo=None).isoformat() + "Z",
    }


def get_public_active_operation_alert():
    active_status = func.lower(func.trim(func.coalesce(EvacuationOperation.status, "")))
    operation = (
        db.session.query(EvacuationOperation.id)
        .filter(active_status == "active")
        .order_by(EvacuationOperation.open_date.desc(), EvacuationOperation.id.desc())
        .first()
    )
    return {"active": operation is not None}

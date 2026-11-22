from datetime import timedelta
from sqlalchemy import func, or_

from models import RescueRequest, utc_now

CLOSED_RESCUE_STATUSES = ("resolved", "closed")
RESCUE_OVERDUE_THRESHOLD_HOURS = 2


def is_open_rescue_status(status):
    """Return True for any rescue status other than Resolved or Closed."""
    normalized = str(status or "").strip().lower()
    return normalized not in CLOSED_RESCUE_STATUSES


def rescue_status_since(rescue):
    """Return the timestamp when a rescue request entered its current status."""
    return (
        getattr(rescue, "status_updated_at", None)
        or getattr(rescue, "updated_at", None)
        or getattr(rescue, "created_at", None)
    )


def is_rescue_overdue(rescue, now=None, threshold_hours=RESCUE_OVERDUE_THRESHOLD_HOURS):
    """Return True if an open rescue request has been in its current status longer than threshold_hours."""
    if not is_open_rescue_status(getattr(rescue, "status", None)):
        return False
    since = rescue_status_since(rescue)
    if since is None:
        return False
    current_time = now if now is not None else utc_now()
    if getattr(since, "tzinfo", None) is not None and getattr(current_time, "tzinfo", None) is None:
        since = since.replace(tzinfo=None)
    elif getattr(since, "tzinfo", None) is None and getattr(current_time, "tzinfo", None) is not None:
        current_time = current_time.replace(tzinfo=None)
    return (current_time - since) > timedelta(hours=threshold_hours)


def open_rescue_requests_query():
    """Base SQLAlchemy query matching all open rescue requests (not Resolved or Closed)."""
    normalized_status = func.lower(func.trim(RescueRequest.status))
    return RescueRequest.query.filter(
        or_(
            RescueRequest.status.is_(None),
            normalized_status.notin_(CLOSED_RESCUE_STATUSES),
        )
    )


def count_open_rescue_requests():
    """Count all open rescue requests using the shared open-status definition."""
    return int(open_rescue_requests_query().count() or 0)

"""
Idempotent migration script to add high-impact performance indexes identified in the
EvacWay full-stack audit. Safe to run repeatedly on PostgreSQL / Supabase.
"""
import os
import sys

from sqlalchemy import text

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import app
from models import db

INDEX_STATEMENTS = [
    (
        "idx_residents_family_id",
        "CREATE INDEX IF NOT EXISTS idx_residents_family_id ON residents (family_id)",
    ),
    (
        "idx_evac_assignments_room_id",
        "CREATE INDEX IF NOT EXISTS idx_evac_assignments_room_id ON evacuation_assignments (room_id)",
    ),
    (
        "idx_evac_rooms_center_active",
        "CREATE INDEX IF NOT EXISTS idx_evac_rooms_center_active ON evacuation_center_rooms (evacuation_center_id, is_active)",
    ),
    (
        "idx_families_roster_barangay",
        "CREATE INDEX IF NOT EXISTS idx_families_roster_barangay ON families (roster_year_id, barangay_id)",
    ),
    (
        "idx_road_segments_closed_partial",
        "CREATE INDEX IF NOT EXISTS idx_road_segments_closed_partial ON road_segments (id) WHERE is_closed = TRUE",
    ),
    (
        "idx_hazard_reports_status_submitted",
        "CREATE INDEX IF NOT EXISTS idx_hazard_reports_status_submitted ON hazard_reports (status, submitted_at DESC)",
    ),
    (
        "idx_system_logs_timestamp",
        "CREATE INDEX IF NOT EXISTS idx_system_logs_timestamp ON system_logs (timestamp DESC)",
    ),
    (
        "idx_users_lower_email",
        "CREATE INDEX IF NOT EXISTS idx_users_lower_email ON users (LOWER(email))",
    ),
    (
        "idx_resident_accounts_lower_email",
        "CREATE INDEX IF NOT EXISTS idx_resident_accounts_lower_email ON resident_accounts (LOWER(email))",
    ),
    (
        "idx_center_barangays_barangay_center",
        "CREATE INDEX IF NOT EXISTS idx_center_barangays_barangay_center ON center_barangays (barangay_id, center_id)",
    ),
    (
        "idx_staff_notifications_user_read_created",
        "CREATE INDEX IF NOT EXISTS idx_staff_notifications_user_read_created ON staff_notifications (user_id, is_read, created_at DESC)",
    ),
    (
        "idx_staff_notifications_resource",
        "CREATE INDEX IF NOT EXISTS idx_staff_notifications_resource ON staff_notifications (resource_type, resource_id)",
    ),
]


def run_migration():
    with app.app_context():
        for name, stmt in INDEX_STATEMENTS:
            try:
                db.session.execute(text(stmt))
                db.session.commit()
                print(f"[OK] {name}")
            except Exception as exc:
                db.session.rollback()
                print(f"[SKIP/WARN] {name}: {exc}")


if __name__ == "__main__":
    run_migration()

"""Add resident account links and resident registration requests.

Additive and idempotent. Run from backend/ with the project virtualenv active:
    python migrate_resident_registration.py
"""

from sqlalchemy import inspect, text

from app import app
from models import db

STATEMENTS = [
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS resident_id INTEGER",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_resident_id ON users (resident_id)",
    """
    DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'fk_users_resident_id'
        ) THEN
            ALTER TABLE users
            ADD CONSTRAINT fk_users_resident_id
            FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE SET NULL;
        END IF;
    END;
    $$;
    """,
    """
    CREATE TABLE IF NOT EXISTS resident_registration_requests (
        id SERIAL PRIMARY KEY,
        first_name VARCHAR(100) NOT NULL,
        middle_name VARCHAR(100),
        last_name VARCHAR(100) NOT NULL,
        birthdate DATE NOT NULL,
        barangay VARCHAR(100) NOT NULL,
        address VARCHAR(255) NOT NULL,
        contact_number VARCHAR(20) NOT NULL,
        email VARCHAR(120) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        matched_resident_id INTEGER REFERENCES residents(id) ON DELETE SET NULL,
        reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at TIMESTAMP,
        rejection_reason TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT ck_resident_registration_request_status
            CHECK (status IN ('pending', 'approved', 'rejected'))
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_resident_registration_requests_status ON resident_registration_requests (status)",
    "CREATE INDEX IF NOT EXISTS ix_resident_registration_requests_created_at ON resident_registration_requests (created_at)",
    "CREATE INDEX IF NOT EXISTS ix_resident_registration_requests_email ON resident_registration_requests (email)",
    "CREATE INDEX IF NOT EXISTS ix_resident_registration_requests_contact ON resident_registration_requests (contact_number)",
]


if __name__ == "__main__":
    with app.app_context():
        with db.engine.begin() as conn:
            for statement in STATEMENTS:
                conn.execute(text(statement))

        user_columns = {
            column["name"] for column in inspect(db.engine).get_columns("users")
        }
        request_columns = {
            column["name"]
            for column in inspect(db.engine).get_columns("resident_registration_requests")
        }
        print("users.resident_id:", "present" if "resident_id" in user_columns else "missing")
        print("resident_registration_requests columns:", sorted(request_columns))
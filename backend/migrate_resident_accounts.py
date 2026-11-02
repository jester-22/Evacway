"""Add resident_accounts table and user columns for resident linkage.

Additive and idempotent. Run from backend/ with the project virtualenv active:
    python migrate_resident_accounts.py
"""

from sqlalchemy import inspect, text

from app import app
from models import db

STATEMENTS = [
    # Add last_login_at to users table
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP",

    # Add resident_id to users table
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS resident_id INTEGER",

    # Create unique index on users.resident_id
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_resident_id ON users (resident_id)",

    # Add FK constraint on users.resident_id
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

    # Create resident_accounts table
    """
    CREATE TABLE IF NOT EXISTS resident_accounts (
        id SERIAL PRIMARY KEY,
        resident_id INTEGER NOT NULL UNIQUE REFERENCES residents(id) ON DELETE CASCADE,
        email VARCHAR(120) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_login_at TIMESTAMP
    )
    """,

    # Create unique index on email for active accounts (partial unique index)
    """
    CREATE UNIQUE INDEX IF NOT EXISTS ix_resident_accounts_email_active
    ON resident_accounts (email)
    WHERE is_active = true
    """,

    # Create index on resident_id
    "CREATE INDEX IF NOT EXISTS ix_resident_accounts_resident_id ON resident_accounts (resident_id)",
]


if __name__ == "__main__":
    with app.app_context():
        with db.engine.begin() as conn:
            for statement in STATEMENTS:
                conn.execute(text(statement))

        user_columns = {
            column["name"] for column in inspect(db.engine).get_columns("users")
        }
        resident_account_columns = {
            column["name"]
            for column in inspect(db.engine).get_columns("resident_accounts")
        }
        print("users.last_login_at:", "present" if "last_login_at" in user_columns else "missing")
        print("users.resident_id:", "present" if "resident_id" in user_columns else "missing")
        print("resident_accounts columns:", sorted(resident_account_columns))
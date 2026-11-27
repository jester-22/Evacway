"""Add editable account-only profile columns (display_name, contact_number) to resident_accounts."""
from sqlalchemy import inspect, text

from app import app
from models import db


if __name__ == "__main__":
    with app.app_context():
        columns = {
            column["name"]
            for column in inspect(db.engine).get_columns("resident_accounts")
        }
        statements = []
        if "display_name" not in columns:
            statements.append(
                "ALTER TABLE resident_accounts ADD COLUMN display_name VARCHAR(100)"
            )
        if "contact_number" not in columns:
            statements.append(
                "ALTER TABLE resident_accounts ADD COLUMN contact_number VARCHAR(20)"
            )
        if statements:
            with db.engine.begin() as connection:
                for stmt in statements:
                    connection.execute(text(stmt))
        print("Resident account profile migration completed.")

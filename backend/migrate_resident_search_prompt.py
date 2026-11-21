"""Track the one-time family-search consent prompt per resident account."""
from sqlalchemy import inspect, text

from app import app
from models import db


if __name__ == "__main__":
    with app.app_context():
        columns = {
            column["name"]
            for column in inspect(db.engine).get_columns("resident_accounts")
        }
        if "find_someone_prompt_seen" not in columns:
            with db.engine.begin() as connection:
                connection.execute(text(
                    "ALTER TABLE resident_accounts ADD COLUMN find_someone_prompt_seen "
                    "BOOLEAN NOT NULL DEFAULT FALSE"
                ))
        print("Resident first-login search prompt migration completed.")

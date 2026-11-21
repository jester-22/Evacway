"""Add masked audit storage for Find someone optional detail queries."""
from sqlalchemy import inspect, text

from app import app
from models import db


if __name__ == "__main__":
    with app.app_context():
        columns = {
            column["name"]
            for column in inspect(db.engine).get_columns("resident_lookup_logs")
        }
        if "query_extra_masked" not in columns:
            with db.engine.begin() as connection:
                connection.execute(text(
                    "ALTER TABLE resident_lookup_logs ADD COLUMN query_extra_masked VARCHAR(150)"
                ))
        print("Masked extra-detail lookup field migration completed.")

"""Create shared `uploaded_files` table (with Postgres RLS) and backfill local uploads.

Additive and idempotent. Run from backend/ with the project virtualenv active:
    python migrate_uploaded_files.py
"""

import mimetypes
import os

from sqlalchemy import inspect, text

from models import UploadedFile


def ensure_uploaded_files_table(db_instance):
    """Ensure the `uploaded_files` table exists and has RLS enabled on Postgres."""
    engine = db_instance.engine
    UploadedFile.__table__.create(bind=engine, checkfirst=True)
    if engine.dialect.name == "postgresql":
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE public.uploaded_files ENABLE ROW LEVEL SECURITY"))


def backfill_local_uploads(db_instance, static_root):
    """Copy existing local static/uploads files into `uploaded_files` if missing."""
    uploads_root = os.path.join(static_root, "uploads")
    if not os.path.isdir(uploads_root):
        return 0

    existing_paths = {
        row[0]
        for row in db_instance.session.query(UploadedFile.storage_path).all()
    }
    inserted = 0

    for root, _, filenames in os.walk(uploads_root):
        for filename in filenames:
            full_path = os.path.join(root, filename)
            rel_path = os.path.relpath(full_path, uploads_root).replace("\\", "/").strip("/")
            if not rel_path or rel_path in existing_paths:
                continue
            try:
                with open(full_path, "rb") as fp:
                    raw_bytes = fp.read()
            except OSError:
                continue
            content_type, _ = mimetypes.guess_type(filename)
            db_instance.session.add(
                UploadedFile(
                    storage_path=rel_path,
                    content_type=content_type or "application/octet-stream",
                    data=raw_bytes,
                    byte_size=len(raw_bytes),
                )
            )
            existing_paths.add(rel_path)
            inserted += 1

    if inserted:
        db_instance.session.commit()
    return inserted


if __name__ == "__main__":
    from app import app
    from models import db

    with app.app_context():
        ensure_uploaded_files_table(db)
        cols = sorted(
            col["name"]
            for col in inspect(db.engine).get_columns("uploaded_files")
        )
        print("uploaded_files columns:", cols)
        synced = backfill_local_uploads(db, os.path.join(app.root_path, "static"))
        total = UploadedFile.query.count()
        print(f"Backfilled {synced} local upload(s). Total files in DB: {total}")

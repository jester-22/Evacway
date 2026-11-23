"""Shared upload storage for hazard report and rescue proof photos.

Stores uploaded photos so they are accessible across both localhost and deployed
environments (Vercel + Render):
1. Uses Supabase Storage when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.
2. Otherwise stores bytes in the shared `uploaded_files` database table (served by
   `/static/uploads/<path>` with immutable caching) and mirrors to local disk when
   writable.
"""

import mimetypes
import os
import uuid
from urllib.parse import quote

import requests
from flask import current_app
from sqlalchemy import inspect

from models import UploadedFile, db


def _guess_content_type(filename, fallback=None):
    guessed, _ = mimetypes.guess_type(filename or "")
    if guessed:
        return guessed
    if fallback and fallback != "application/octet-stream":
        return fallback
    return "application/octet-stream"


def _normalize_storage_path(subpath):
    cleaned = str(subpath or "").replace("\\", "/").strip("/")
    parts = [p for p in cleaned.split("/") if p and p not in (".", "..")]
    return "/".join(parts)


def _uploaded_files_table_exists():
    try:
        return inspect(db.engine).has_table("uploaded_files")
    except Exception:
        return False


def _upload_to_supabase_storage(storage_path, file_bytes, content_type):
    supabase_url = (current_app.config.get("SUPABASE_URL") or "").strip().rstrip("/")
    service_key = (current_app.config.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    bucket = (current_app.config.get("SUPABASE_STORAGE_BUCKET") or "evacway-uploads").strip()
    if not supabase_url or not service_key or not bucket:
        return None

    encoded_path = quote(storage_path, safe="/")
    endpoint = f"{supabase_url}/storage/v1/object/{bucket}/{encoded_path}"
    try:
        resp = requests.post(
            endpoint,
            headers={
                "Authorization": f"Bearer {service_key}",
                "apikey": service_key,
                "Content-Type": content_type,
                "x-upsert": "true",
            },
            data=file_bytes,
            timeout=20,
        )
        if 200 <= resp.status_code < 300:
            public_url = f"{supabase_url}/storage/v1/object/public/{bucket}/{encoded_path}"
            return public_url
        current_app.logger.warning(
            "Supabase Storage upload failed (%s): %s",
            resp.status_code,
            resp.text[:200],
        )
    except Exception as exc:
        current_app.logger.warning("Supabase Storage upload error: %s", exc)
    return None


def _delete_from_supabase_storage(storage_path):
    supabase_url = (current_app.config.get("SUPABASE_URL") or "").strip().rstrip("/")
    service_key = (current_app.config.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    bucket = (current_app.config.get("SUPABASE_STORAGE_BUCKET") or "evacway-uploads").strip()
    if not supabase_url or not service_key or not bucket:
        return

    encoded_path = quote(storage_path, safe="/")
    endpoint = f"{supabase_url}/storage/v1/object/{bucket}/{encoded_path}"
    try:
        requests.delete(
            endpoint,
            headers={
                "Authorization": f"Bearer {service_key}",
                "apikey": service_key,
            },
            timeout=10,
        )
    except Exception:
        pass


def save_uploaded_photo(file_storage, category, uploader_folder):
    """Persist an uploaded photo and return `(photo_url, metadata)`."""
    filename = file_storage.filename or "upload.jpg"
    ext = filename.rsplit(".", 1)[1].lower() if "." in filename else "jpg"
    unique_name = f"{uuid.uuid4().hex}.{ext}"
    storage_path = _normalize_storage_path(f"{category}/{uploader_folder}/{unique_name}")
    content_type = _guess_content_type(unique_name, getattr(file_storage, "mimetype", None))

    if hasattr(file_storage, "stream") and hasattr(file_storage.stream, "seek"):
        try:
            file_storage.stream.seek(0)
        except Exception:
            pass
    file_bytes = file_storage.read()

    # 1. Prefer Supabase Storage when configured
    public_url = _upload_to_supabase_storage(storage_path, file_bytes, content_type)
    if public_url:
        return public_url, {
            "storage_mode": "supabase",
            "storage_path": storage_path,
            "local_path": None,
        }

    # 2. Save to shared database table so localhost & Vercel/Render both serve it
    stored_in_db = False
    if _uploaded_files_table_exists():
        try:
            db.session.add(
                UploadedFile(
                    storage_path=storage_path,
                    content_type=content_type,
                    data=file_bytes,
                    byte_size=len(file_bytes),
                )
            )
            stored_in_db = True
        except Exception as exc:
            current_app.logger.warning("Could not stage uploaded photo in DB: %s", exc)

    # 3. Also mirror to local disk for fast local serving / legacy test compatibility
    local_path = None
    try:
        upload_folder = os.path.join(
            current_app.root_path, "static", "uploads", category, uploader_folder
        )
        os.makedirs(upload_folder, exist_ok=True)
        local_path = os.path.join(upload_folder, unique_name)
        with open(local_path, "wb") as fp:
            fp.write(file_bytes)
    except OSError as exc:
        current_app.logger.warning("Could not mirror uploaded photo to local disk: %s", exc)

    return f"/static/uploads/{storage_path}", {
        "storage_mode": "db" if stored_in_db else "local",
        "storage_path": storage_path,
        "local_path": local_path,
    }


def delete_uploaded_photo(meta):
    """Best-effort cleanup if a submission is rejected before commit."""
    if not meta:
        return
    local_path = meta.get("local_path")
    if local_path:
        try:
            os.remove(local_path)
        except OSError:
            pass
    storage_path = meta.get("storage_path")
    if meta.get("storage_mode") == "supabase" and storage_path:
        _delete_from_supabase_storage(storage_path)
    elif meta.get("storage_mode") == "db" and storage_path:
        try:
            for obj in list(db.session.new):
                if isinstance(obj, UploadedFile) and obj.storage_path == storage_path:
                    db.session.expunge(obj)
            UploadedFile.query.filter_by(storage_path=storage_path).delete()
        except Exception:
            pass


def get_uploaded_file_from_db(subpath):
    """Lookup uploaded file bytes from the shared `uploaded_files` table."""
    normalized = _normalize_storage_path(subpath)
    if not normalized or not _uploaded_files_table_exists():
        return None

    record = UploadedFile.query.filter_by(storage_path=normalized).first()
    if not record:
        basename = os.path.basename(normalized)
        if basename:
            record = UploadedFile.query.filter(
                UploadedFile.storage_path.like(f"%/{basename}")
            ).first()
    if not record:
        return None
    return record.data, record.content_type

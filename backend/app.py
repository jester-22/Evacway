import os
from datetime import timedelta

from flask import Flask, Response, abort, jsonify, request, send_from_directory
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from config import Config
from models import db

from routes.hazards import hazards_bp
from routes.evacuation_centers import centers_bp
from routes.roads import roads_bp
from routes.auth import auth_bp
from routes.users import users_bp
from routes.hazard_reports import reports_bp
from routes.routing import routing_bp
from routes.residents import residents_bp
from routes.rooms import rooms_bp
from barangays import barangays_bp
from routes.families import families_bp
from routes.notifications import notifications_bp
from routes.rescue_requests import rescue_bp
from routes.buildings import buildings_bp
from routes.resident_registrations import registrations_bp
from routes.reference_options import reference_options_bp
from routes.non_registered_evacuees import nre_bp
from routes.offline_map import offline_map_bp
from routes.dashboard import dashboard_bp


app = Flask(__name__)
app.config.from_object(Config)


def _warn_if_smtp_config_missing():
    if app.config.get("BREVO_API_KEY") or app.config.get("RESEND_API_KEY"):
        return
    smtp_settings = {
        "MAIL_HOST": app.config.get("MAIL_HOST"),
        "MAIL_PORT": os.environ.get("MAIL_PORT", "").strip(),
        "MAIL_USERNAME": app.config.get("MAIL_USERNAME"),
        "MAIL_PASSWORD": app.config.get("MAIL_PASSWORD"),
    }
    missing = [name for name, value in smtp_settings.items() if value in (None, "")]
    if missing:
        app.logger.warning("Mail configuration is missing or empty: %s", ", ".join(missing))


_warn_if_smtp_config_missing()


# =========================================================
# JWT SETUP
# =========================================================

# IMPORTANT:
# Change this secret before deploying the system.
app.config["JWT_SECRET_KEY"] = (
    os.environ.get("JWT_SECRET_KEY")
    or app.config.get("JWT_SECRET_KEY")
    or "evacway-dev-secret-change-this-later"
)

# Keep the user logged in for 7 days before the access token
# expires.
app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(days=7)
app.config.setdefault("MAX_CONTENT_LENGTH", 25 * 1024 * 1024)

if app.config["JWT_SECRET_KEY"] == "evacway-dev-secret-change-this-later":
    app.logger.warning(
        "JWT_SECRET_KEY is using the default development fallback. Set JWT_SECRET_KEY in production!"
    )

jwt = JWTManager(app)


# =========================================================
# CORS
# =========================================================

import re

_ALLOWED_CORS_ORIGIN_PATTERNS = [
    re.compile(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"),
    re.compile(r"^https?://(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?$"),
    re.compile(r"^https://evacway(-[a-z0-9-]+)?\.vercel\.app$"),
]


def _allowed_cors_origins():
    origins = {
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "https://evacway.vercel.app",
    }
    for env_key in ("FRONTEND_URL", "FRONTEND_URL_PUBLIC", "APP_URL_PUBLIC", "APP_URL_LOCAL"):
        val = (os.environ.get(env_key) or app.config.get(env_key) or "").strip().rstrip("/")
        if val:
            origins.add(val)
    extra = (os.environ.get("CORS_ALLOWED_ORIGINS") or "").strip()
    if extra:
        for item in extra.split(","):
            cleaned = item.strip().rstrip("/")
            if cleaned:
                origins.add(cleaned)
    return sorted(origins)


ALLOWED_CORS_ORIGINS = _allowed_cors_origins()


def _is_allowed_cors_origin(origin):
    if not origin:
        return False
    if origin in ALLOWED_CORS_ORIGINS:
        return True
    return any(pattern.match(origin) for pattern in _ALLOWED_CORS_ORIGIN_PATTERNS)


CORS(
    app,
    resources={r"/*": {"origins": [*ALLOWED_CORS_ORIGINS, *_ALLOWED_CORS_ORIGIN_PATTERNS]}},
    supports_credentials=True,
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Requested-With", "Accept"],
    expose_headers=["Content-Type", "Authorization"]
)


@app.after_request
def add_cors_headers(response):
    origin = (request.headers.get("Origin") or "").strip().rstrip("/")
    if _is_allowed_cors_origin(origin):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Vary"] = "Origin"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Requested-With, Accept"
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    return response


# =========================================================
# DATABASE
# =========================================================

db.init_app(app)

with app.app_context():
    try:
        from migrate_center_type_structure import ensure_center_type_structure_column
        ensure_center_type_structure_column(db)
    except Exception as e:
        app.logger.warning("Could not ensure center_types.structure_mode: %s", e)

    try:
        from migrate_hazard_reporter import ensure_hazard_report_reporter_columns
        ensure_hazard_report_reporter_columns(db)
    except Exception as e:
        app.logger.warning("Could not ensure hazard_reports reporter columns: %s", e)

    try:
        from migrate_registration_override_log import ensure_registration_link_override_logs_table
        ensure_registration_link_override_logs_table(db)
    except Exception as e:
        app.logger.warning("Could not ensure registration_link_override_logs table: %s", e)

    try:
        from migrate_rescue_handoff_notes import ensure_rescue_handoff_notes_columns
        ensure_rescue_handoff_notes_columns(db)
    except Exception as e:
        app.logger.warning("Could not ensure rescue_requests handoff/notes columns: %s", e)

    try:
        from migrate_hazard_rejection_reason import ensure_hazard_report_rejection_reason_column
        ensure_hazard_report_rejection_reason_column(db)
    except Exception as e:
        app.logger.warning("Could not ensure hazard_reports.rejection_reason: %s", e)

    try:
        from migrate_hazard_duplicate_of import ensure_hazard_report_duplicate_of_column
        ensure_hazard_report_duplicate_of_column(db)
    except Exception as e:
        app.logger.warning("Could not ensure hazard_reports.duplicate_of: %s", e)

    try:
        from migrate_hazard_barangay_name import ensure_hazard_report_barangay_name_column
        ensure_hazard_report_barangay_name_column(db)
    except Exception as e:
        app.logger.warning("Could not ensure hazard_reports.barangay_name: %s", e)

    try:
        from migrate_uploaded_files import ensure_uploaded_files_table
        ensure_uploaded_files_table(db)
    except Exception as e:
        app.logger.warning("Could not ensure uploaded_files table: %s", e)

    try:
        from migrate_user_recovery_email import ensure_user_recovery_email_column
        ensure_user_recovery_email_column(db)
    except Exception as e:
        app.logger.warning("Could not ensure users.recovery_email: %s", e)

    try:
        from migrate_registration_confirmation import ensure_registration_confirmation_columns
        ensure_registration_confirmation_columns(db)
    except Exception as e:
        app.logger.warning("Could not ensure resident_registration_requests confirmation columns: %s", e)


# =========================================================
# BLUEPRINTS
# =========================================================

app.register_blueprint(hazards_bp)
app.register_blueprint(centers_bp)
app.register_blueprint(roads_bp)
app.register_blueprint(auth_bp)
app.register_blueprint(users_bp)
app.register_blueprint(reports_bp)
app.register_blueprint(routing_bp)
app.register_blueprint(residents_bp)
app.register_blueprint(rooms_bp)
app.register_blueprint(barangays_bp)
app.register_blueprint(families_bp)
app.register_blueprint(notifications_bp)
app.register_blueprint(rescue_bp)
app.register_blueprint(buildings_bp)
app.register_blueprint(registrations_bp)
app.register_blueprint(reference_options_bp)
app.register_blueprint(nre_bp)
app.register_blueprint(offline_map_bp)
app.register_blueprint(dashboard_bp)


# =========================================================
# GLOBAL ERROR HANDLERS (Ensure JSON + CORS on errors)
# =========================================================

@app.errorhandler(500)
def handle_500_error(e):
    app.logger.exception("Internal server error: %s", e)
    resp = jsonify({"error": "Internal server error"})
    resp.status_code = 500
    return resp


@app.errorhandler(Exception)
def handle_unhandled_exception(e):
    from werkzeug.exceptions import HTTPException
    if isinstance(e, HTTPException):
        resp = jsonify({"error": e.description or str(e)})
        resp.status_code = e.code or 500
        return resp
    app.logger.exception("Unhandled server exception: %s", e)
    resp = jsonify({"error": "Internal server error"})
    resp.status_code = 500
    return resp


@app.cli.command("init-db")
def init_db():
    """Create all database tables."""
    db.create_all()
    print("Database tables initialized successfully.")


# =========================================================
# STATIC UPLOADS FALLBACK & HOME
# =========================================================

@app.route("/static/upload/<path:subpath>")
@app.route("/static/uploads/<path:subpath>")
def serve_uploaded_file(subpath):
    static_root = os.path.join(app.root_path, "static")
    uploads_roots = [
        os.path.normpath(os.path.join(static_root, "uploads")),
        os.path.normpath(os.path.join(static_root, "upload")),
    ]
    candidates = [
        os.path.join(static_root, "uploads", subpath),
        os.path.join(static_root, "upload", subpath),
    ]
    basename = os.path.basename(subpath)
    if basename:
        for base_dir in (
            os.path.join(static_root, "uploads", "rescue"),
            os.path.join(static_root, "uploads", "hazard"),
            os.path.join(static_root, "uploads"),
        ):
            if os.path.isdir(base_dir):
                candidates.append(os.path.join(base_dir, basename))
                for entry in os.scandir(base_dir):
                    if entry.is_dir():
                        candidates.append(os.path.join(entry.path, basename))

    for candidate in candidates:
        norm = os.path.normpath(candidate)
        in_allowed_root = any(
            os.path.commonpath([root, norm]) == root for root in uploads_roots
        )
        if in_allowed_root and os.path.isfile(norm):
            directory, filename = os.path.split(norm)
            resp = send_from_directory(directory, filename)
            resp.headers["X-Content-Type-Options"] = "nosniff"
            return resp

    try:
        from services.upload_storage import get_uploaded_file_from_db
        stored = get_uploaded_file_from_db(subpath)
        if stored is not None:
            data, content_type = stored
            response = Response(data, mimetype=content_type)
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            response.headers["X-Content-Type-Options"] = "nosniff"
            return response
    except Exception as exc:
        app.logger.warning("Could not load uploaded file %s from database: %s", subpath, exc)

    abort(404)


@app.route("/")
def home():
    return "EvacWay backend is running!"


# =========================================================
# RUN SERVER
# =========================================================

if __name__ == "__main__":
    with app.app_context():
        try:
            from sqlalchemy import text
            with db.engine.connect() as conn:
                conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis;"))
                conn.commit()
        except Exception as e:
            app.logger.warning("Could not enable postgis extension: %s", e)
        db.create_all()

    app.run(debug=True)

import os
from datetime import timedelta

from flask import Flask, abort, jsonify, send_from_directory
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


app = Flask(__name__)
app.config.from_object(Config)


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

jwt = JWTManager(app)


# =========================================================
# CORS
# =========================================================

CORS(app)


# =========================================================
# DATABASE
# =========================================================

db.init_app(app)


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


# =========================================================
# GLOBAL ERROR HANDLERS (Ensure JSON + CORS on errors)
# =========================================================

@app.errorhandler(500)
def handle_500_error(e):
    app.logger.exception("Internal server error: %s", e)
    return jsonify({"error": "Internal server error"}), 500


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
    candidates = [
        os.path.join(static_root, "uploads", subpath),
        os.path.join(static_root, "upload", subpath),
        os.path.join(static_root, subpath),
    ]
    basename = os.path.basename(subpath)
    if basename:
        for base_dir in (
            os.path.join(static_root, "uploads", "rescue"),
            os.path.join(static_root, "uploads", "hazard"),
            os.path.join(static_root, "uploads"),
            os.path.join(static_root, "rescue"),
        ):
            if os.path.isdir(base_dir):
                candidates.append(os.path.join(base_dir, basename))
                for entry in os.scandir(base_dir):
                    if entry.is_dir():
                        candidates.append(os.path.join(entry.path, basename))

    for candidate in candidates:
        norm = os.path.normpath(candidate)
        if norm.startswith(os.path.normpath(static_root)) and os.path.isfile(norm):
            directory, filename = os.path.split(norm)
            return send_from_directory(directory, filename)
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

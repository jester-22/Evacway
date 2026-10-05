import os
from datetime import timedelta

from flask import Flask
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


# =========================================================
# HOME
# =========================================================

@app.route("/")
def home():
    return "EvacWay backend is running!"


# =========================================================
# RUN SERVER
# =========================================================

if __name__ == "__main__":
    with app.app_context():
        db.create_all()

    app.run(debug=True)
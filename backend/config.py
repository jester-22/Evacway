import os

from dotenv import load_dotenv

basedir = os.path.abspath(os.path.dirname(__file__))
load_dotenv(os.path.join(basedir, ".env"))
load_dotenv()


class Config:

    _raw_db_url = os.environ.get("DATABASE_URL", "")
    if _raw_db_url.startswith("postgres://"):
        _raw_db_url = _raw_db_url.replace("postgres://", "postgresql://", 1)

    SQLALCHEMY_DATABASE_URI = _raw_db_url or None
    SQLALCHEMY_ENGINE_OPTIONS = {
        "connect_args": {"options": "-csearch_path=public,extensions"}
    }

    SQLALCHEMY_TRACK_MODIFICATIONS = False
    JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "")

    # Philippines timezone
    TIMEZONE = "Asia/Manila"

    MAIL_MAILER = os.environ.get("MAIL_MAILER", "smtp")
    MAIL_HOST = os.environ.get("MAIL_HOST", "")
    MAIL_PORT = int(os.environ.get("MAIL_PORT", "587"))
    MAIL_USERNAME = os.environ.get("MAIL_USERNAME", "")
    MAIL_PASSWORD = os.environ.get("MAIL_PASSWORD", "")
    MAIL_ENCRYPTION = os.environ.get("MAIL_ENCRYPTION", "tls")
    MAIL_FROM_ADDRESS = os.environ.get("MAIL_FROM_ADDRESS", "")
    MAIL_FROM_NAME = os.environ.get("MAIL_FROM_NAME", "EvacWay System")
    FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173")
    VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "")
    VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "")
    VAPID_CLAIMS_SUB = os.environ.get("VAPID_CLAIMS_SUB", "")
    PASSWORD_SETUP_TOKEN_MAX_AGE = int(
        os.environ.get("PASSWORD_SETUP_TOKEN_MAX_AGE", "3600")
    )
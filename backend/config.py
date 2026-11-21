import os

from dotenv import load_dotenv

basedir = os.path.abspath(os.path.dirname(__file__))
load_dotenv(os.path.join(basedir, ".env"))
load_dotenv()


def _database_pool_options(environ=None):
    values = environ if environ is not None else os.environ
    return {
        "pool_size": max(1, int(values.get("DATABASE_POOL_SIZE", "3"))),
        "max_overflow": max(0, int(values.get("DATABASE_MAX_OVERFLOW", "0"))),
        "pool_timeout": max(1, int(values.get("DATABASE_POOL_TIMEOUT", "30"))),
    }


class Config:

    _raw_db_url = os.environ.get("DATABASE_URL", "")
    if _raw_db_url.startswith("postgres://"):
        _raw_db_url = _raw_db_url.replace("postgres://", "postgresql://", 1)

    SQLALCHEMY_DATABASE_URI = _raw_db_url or None
    SQLALCHEMY_ENGINE_OPTIONS = {
        **_database_pool_options(),
        "pool_pre_ping": True,
        "pool_recycle": 280,
        "connect_args": {"options": "-csearch_path=public,extensions"},
    }

    SQLALCHEMY_TRACK_MODIFICATIONS = False
    JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "")

    # Philippines timezone
    TIMEZONE = "Asia/Manila"

    MAIL_MAILER = os.environ.get("MAIL_MAILER", "smtp")
    MAIL_HOST = os.environ.get("MAIL_HOST", "").strip()
    MAIL_PORT = int(os.environ.get("MAIL_PORT", "").strip() or "587")
    MAIL_USERNAME = os.environ.get("MAIL_USERNAME", "").strip()
    MAIL_PASSWORD = os.environ.get("MAIL_PASSWORD", "").strip().strip("\"'").replace(" ", "")
    MAIL_ENCRYPTION = os.environ.get("MAIL_ENCRYPTION", "tls").strip().lower()
    MAIL_FROM_ADDRESS = os.environ.get("MAIL_FROM_ADDRESS", "")
    MAIL_FROM_NAME = os.environ.get("MAIL_FROM_NAME", "EvacWay System")
    FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173")
    FRONTEND_URL_PUBLIC = os.environ.get("FRONTEND_URL_PUBLIC", "")
    APP_URL_PUBLIC = os.environ.get("APP_URL_PUBLIC", "")
    APP_URL_LOCAL = os.environ.get("APP_URL_LOCAL", "")
    VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "")
    VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "")
    VAPID_CLAIMS_SUB = os.environ.get("VAPID_CLAIMS_SUB", "")
    PASSWORD_SETUP_TOKEN_MAX_AGE = int(
        os.environ.get("PASSWORD_SETUP_TOKEN_MAX_AGE", "3600")
    )
    LOGIN_MAX_FAILED_ATTEMPTS = int(os.environ.get("LOGIN_MAX_FAILED_ATTEMPTS", "5"))
    LOGIN_FAILURE_WINDOW_MINUTES = int(os.environ.get("LOGIN_FAILURE_WINDOW_MINUTES", "15"))
    LOGIN_LOCK_MINUTES = int(os.environ.get("LOGIN_LOCK_MINUTES", "15"))
    LOGIN_RATE_LIMIT_MAX_REQUESTS = int(os.environ.get("LOGIN_RATE_LIMIT_MAX_REQUESTS", "20"))
    LOGIN_RATE_LIMIT_WINDOW_SECONDS = int(os.environ.get("LOGIN_RATE_LIMIT_WINDOW_SECONDS", "900"))
    LGU_TOTP_REQUIRED = os.environ.get("LGU_TOTP_REQUIRED", "false").strip().lower() in {"1", "true", "yes", "on"}
    DATA_PRIVACY_NOTICE_VERSION = os.environ.get("DATA_PRIVACY_NOTICE_VERSION", "1").strip() or "1"

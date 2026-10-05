from app import app
from models import PushSubscription, RescueRequest, StaffNotification, db


if __name__ == '__main__':
    with app.app_context():
        for model in (StaffNotification, RescueRequest, PushSubscription):
            model.__table__.create(bind=db.engine, checkfirst=True)
        print('Database tables are up to date.')
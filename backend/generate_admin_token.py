from app import app
from flask_jwt_extended import create_access_token

with app.app_context():
    token = create_access_token(identity='1', additional_claims={'role': 'admin', 'username': 'admin'})
    print('ADMIN_TOKEN=' + token)

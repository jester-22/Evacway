from flask import Blueprint, request, jsonify
from models import db, User, SystemLog
from werkzeug.security import generate_password_hash
from flask_jwt_extended import get_jwt_identity, get_jwt
from utils import role_required

users_bp = Blueprint('users', __name__)


@users_bp.route('/api/users', methods=['GET'])
@role_required('admin')
def list_users():
    # Admin sees all LGU personnel accounts (and other admins) so they can manage them
    users = User.query.filter(User.role.in_(['lgu_personnel', 'admin'])).all()
    return jsonify([u.to_dict() for u in users])


@users_bp.route('/api/users', methods=['POST'])
@role_required('admin')
def create_user():
    data = request.get_json()
    required = ['name', 'email', 'password', 'role']
    if not all(data.get(f) for f in required):
        return jsonify({"error": "name, email, password, and role are required"}), 400

    if data['role'] not in ['admin', 'lgu_personnel']:
        return jsonify({"error": "role must be 'admin' or 'lgu_personnel'"}), 400

    if User.query.filter_by(email=data['email']).first():
        return jsonify({"error": "A user with this email already exists"}), 409

    new_user = User(
        name=data['name'],
        email=data['email'],
        password_hash=generate_password_hash(data['password']),
        contact_number=data.get('contact_number'),
        role=data['role'],
        is_active=True
    )
    db.session.add(new_user)
    db.session.commit()

    admin_id = get_jwt_identity()
    db.session.add(SystemLog(user_id=admin_id, action=f"Created {data['role']} account: {data['email']}"))
    db.session.commit()

    return jsonify(new_user.to_dict()), 201


@users_bp.route('/api/users/<int:user_id>/toggle-active', methods=['PATCH'])
@role_required('admin')
def toggle_user_active(user_id):
    user = User.query.get_or_404(user_id)
    user.is_active = not user.is_active
    db.session.commit()

    admin_id = get_jwt_identity()
    action = "Activated" if user.is_active else "Deactivated"
    db.session.add(SystemLog(user_id=admin_id, action=f"{action} user account: {user.email}"))
    db.session.commit()

    return jsonify(user.to_dict())


@users_bp.route('/api/logs', methods=['GET'])
@role_required('admin')
def get_logs():
    logs = SystemLog.query.order_by(SystemLog.timestamp.desc()).limit(200).all()
    return jsonify([
        {
            "id": log.id,
            "user_id": log.user_id,
            "action": log.action,
            "timestamp": log.timestamp.isoformat()
        } for log in logs
    ])

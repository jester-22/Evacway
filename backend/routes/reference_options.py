import re
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from sqlalchemy import or_

from models import (
    db,
    CenterType,
    BuildingMaterial,
    Amenity,
    AccessibilityFeature,
    center_amenities,
    EvacuationCenter,
    SystemLog,
)
from utils import role_required

reference_options_bp = Blueprint('reference_options', __name__)


def slugify(text):
    text = str(text or '').strip().lower()
    text = re.sub(r'[^a-z0-9]+', '_', text)
    return text.strip('_')


# =========================================================
# 1. CENTER TYPES CRUD (/api/center-types)
# =========================================================
@reference_options_bp.route('/api/center-types', methods=['GET'])
def get_center_types():
    active_only = request.args.get('active_only', '').strip().lower() in ('true', '1')
    search = request.args.get('search', '').strip()

    query = CenterType.query
    if active_only:
        query = query.filter_by(is_active=True)

    if search:
        search_pattern = f"%{search}%"
        query = query.filter(
            or_(
                CenterType.name.ilike(search_pattern),
                CenterType.code.ilike(search_pattern),
                CenterType.description.ilike(search_pattern),
            )
        )

    rows = query.order_by(CenterType.display_order.asc(), CenterType.name.asc()).all()
    return jsonify([r.to_dict() for r in rows]), 200


@reference_options_bp.route('/api/center-types', methods=['POST'])
@jwt_required()
@role_required('admin')
def create_center_type():
    data = request.get_json() or {}
    name = str(data.get('name') or '').strip()
    if not name:
        return jsonify({"error": "Center type name is required"}), 400

    raw_code = str(data.get('code') or '').strip().lower()
    code = slugify(raw_code) if raw_code else slugify(name)
    if not code:
        return jsonify({"error": "A valid identifier code could not be generated"}), 400

    if CenterType.query.filter_by(code=code).first():
        return jsonify({"error": f"Center type with code '{code}' already exists"}), 409

    item = CenterType(
        name=name,
        code=code,
        description=str(data.get('description') or '').strip() or None,
        is_active=bool(data.get('is_active', True)),
        display_order=int(data.get('display_order', 0) or 0),
    )
    db.session.add(item)
    db.session.commit()

    user_id = get_jwt_identity()
    db.session.add(SystemLog(user_id=user_id, action=f"Created center type: {name} ({code})"))
    db.session.commit()

    return jsonify(item.to_dict()), 201


@reference_options_bp.route('/api/center-types/<int:item_id>', methods=['PUT'])
@jwt_required()
@role_required('admin')
def update_center_type(item_id):
    item = CenterType.query.get(item_id)
    if not item:
        return jsonify({"error": "Center type not found"}), 404

    data = request.get_json() or {}
    if 'name' in data:
        name = str(data['name'] or '').strip()
        if not name:
            return jsonify({"error": "Name cannot be empty"}), 400
        item.name = name

    if 'code' in data:
        new_code = slugify(data['code'])
        if not new_code:
            return jsonify({"error": "Code cannot be empty"}), 400
        if new_code != item.code:
            if CenterType.query.filter(CenterType.code == new_code, CenterType.id != item_id).first():
                return jsonify({"error": f"Center type with code '{new_code}' already exists"}), 409
            item.code = new_code

    if 'description' in data:
        item.description = str(data['description'] or '').strip() or None

    if 'is_active' in data:
        item.is_active = bool(data['is_active'])

    if 'display_order' in data:
        try:
            item.display_order = int(data['display_order'])
        except (ValueError, TypeError):
            pass

    db.session.commit()
    user_id = get_jwt_identity()
    db.session.add(SystemLog(user_id=user_id, action=f"Updated center type: {item.name}"))
    db.session.commit()

    return jsonify(item.to_dict()), 200


@reference_options_bp.route('/api/center-types/<int:item_id>', methods=['DELETE'])
@jwt_required()
@role_required('admin')
def delete_center_type(item_id):
    item = CenterType.query.get(item_id)
    if not item:
        return jsonify({"error": "Center type not found"}), 404

    in_use_count = EvacuationCenter.query.filter_by(center_type=item.code).count()
    if in_use_count > 0:
        item.is_active = False
        db.session.commit()
        return jsonify({
            "message": f"Center type '{item.name}' is assigned to {in_use_count} evacuation center(s). It has been deactivated to preserve facility data.",
            "deactivated": True,
            "in_use_count": in_use_count
        }), 200

    name = item.name
    db.session.delete(item)
    db.session.commit()
    return jsonify({"message": f"Center type '{name}' deleted successfully", "deleted": True}), 200


# =========================================================
# 2. BUILDING MATERIALS CRUD (/api/building-materials)
# =========================================================
@reference_options_bp.route('/api/building-materials', methods=['GET'])
def get_building_materials():
    active_only = request.args.get('active_only', '').strip().lower() in ('true', '1')
    search = request.args.get('search', '').strip()

    query = BuildingMaterial.query
    if active_only:
        query = query.filter_by(is_active=True)

    if search:
        search_pattern = f"%{search}%"
        query = query.filter(
            or_(
                BuildingMaterial.name.ilike(search_pattern),
                BuildingMaterial.code.ilike(search_pattern),
                BuildingMaterial.description.ilike(search_pattern),
            )
        )

    rows = query.order_by(BuildingMaterial.display_order.asc(), BuildingMaterial.name.asc()).all()
    return jsonify([r.to_dict() for r in rows]), 200


@reference_options_bp.route('/api/building-materials', methods=['POST'])
@jwt_required()
@role_required('admin')
def create_building_material():
    data = request.get_json() or {}
    name = str(data.get('name') or '').strip()
    if not name:
        return jsonify({"error": "Building material name is required"}), 400

    raw_code = str(data.get('code') or '').strip().lower()
    code = slugify(raw_code) if raw_code else slugify(name)
    if not code:
        return jsonify({"error": "A valid identifier code could not be generated"}), 400

    if BuildingMaterial.query.filter_by(code=code).first():
        return jsonify({"error": f"Building material with code '{code}' already exists"}), 409

    item = BuildingMaterial(
        name=name,
        code=code,
        description=str(data.get('description') or '').strip() or None,
        is_active=bool(data.get('is_active', True)),
        display_order=int(data.get('display_order', 0) or 0),
    )
    db.session.add(item)
    db.session.commit()

    user_id = get_jwt_identity()
    db.session.add(SystemLog(user_id=user_id, action=f"Created building material: {name} ({code})"))
    db.session.commit()

    return jsonify(item.to_dict()), 201


@reference_options_bp.route('/api/building-materials/<int:item_id>', methods=['PUT'])
@jwt_required()
@role_required('admin')
def update_building_material(item_id):
    item = BuildingMaterial.query.get(item_id)
    if not item:
        return jsonify({"error": "Building material not found"}), 404

    data = request.get_json() or {}
    if 'name' in data:
        name = str(data['name'] or '').strip()
        if not name:
            return jsonify({"error": "Name cannot be empty"}), 400
        item.name = name

    if 'code' in data:
        new_code = slugify(data['code'])
        if not new_code:
            return jsonify({"error": "Code cannot be empty"}), 400
        if new_code != item.code:
            if BuildingMaterial.query.filter(BuildingMaterial.code == new_code, BuildingMaterial.id != item_id).first():
                return jsonify({"error": f"Building material with code '{new_code}' already exists"}), 409
            item.code = new_code

    if 'description' in data:
        item.description = str(data['description'] or '').strip() or None

    if 'is_active' in data:
        item.is_active = bool(data['is_active'])

    if 'display_order' in data:
        try:
            item.display_order = int(data['display_order'])
        except (ValueError, TypeError):
            pass

    db.session.commit()
    user_id = get_jwt_identity()
    db.session.add(SystemLog(user_id=user_id, action=f"Updated building material: {item.name}"))
    db.session.commit()

    return jsonify(item.to_dict()), 200


@reference_options_bp.route('/api/building-materials/<int:item_id>', methods=['DELETE'])
@jwt_required()
@role_required('admin')
def delete_building_material(item_id):
    item = BuildingMaterial.query.get(item_id)
    if not item:
        return jsonify({"error": "Building material not found"}), 404

    in_use_count = EvacuationCenter.query.filter(
        or_(
            EvacuationCenter.building_material == item.code,
            EvacuationCenter.building_material.ilike(f"%{item.name}%")
        )
    ).count()

    if in_use_count > 0:
        item.is_active = False
        db.session.commit()
        return jsonify({
            "message": f"Building material '{item.name}' is referenced by {in_use_count} evacuation center(s). It has been deactivated to preserve facility data.",
            "deactivated": True,
            "in_use_count": in_use_count
        }), 200

    name = item.name
    db.session.delete(item)
    db.session.commit()
    return jsonify({"message": f"Building material '{name}' deleted successfully", "deleted": True}), 200


# =========================================================
# 3. AMENITIES CRUD (/api/amenities & /api/accessibility-features)
# =========================================================
@reference_options_bp.route('/api/amenities', methods=['GET'])
@reference_options_bp.route('/api/accessibility-features', methods=['GET'])
def get_amenities():
    active_only = request.args.get('active_only', '').strip().lower() in ('true', '1')
    search = request.args.get('search', '').strip()

    query = Amenity.query
    if active_only:
        query = query.filter_by(is_active=True)

    if search:
        search_pattern = f"%{search}%"
        query = query.filter(
            or_(
                Amenity.name.ilike(search_pattern),
                Amenity.code.ilike(search_pattern),
                Amenity.description.ilike(search_pattern),
            )
        )

    rows = query.order_by(Amenity.display_order.asc(), Amenity.name.asc()).all()
    return jsonify([r.to_dict() for r in rows]), 200


@reference_options_bp.route('/api/amenities', methods=['POST'])
@reference_options_bp.route('/api/accessibility-features', methods=['POST'])
@jwt_required()
@role_required('admin')
def create_amenity():
    data = request.get_json() or {}
    name = str(data.get('name') or '').strip()
    if not name:
        return jsonify({"error": "Amenity name is required"}), 400

    raw_code = str(data.get('code') or '').strip().lower()
    code = slugify(raw_code) if raw_code else slugify(name)
    if not code:
        return jsonify({"error": "A valid identifier code could not be generated"}), 400

    if Amenity.query.filter_by(code=code).first():
        return jsonify({"error": f"Amenity with code '{code}' already exists"}), 409

    item = Amenity(
        name=name,
        code=code,
        description=str(data.get('description') or '').strip() or None,
        is_active=bool(data.get('is_active', True)),
        display_order=int(data.get('display_order', 0) or 0),
    )
    db.session.add(item)
    db.session.commit()

    user_id = get_jwt_identity()
    db.session.add(SystemLog(user_id=user_id, action=f"Created amenity: {name} ({code})"))
    db.session.commit()

    return jsonify(item.to_dict()), 201


@reference_options_bp.route('/api/amenities/<int:item_id>', methods=['PUT'])
@reference_options_bp.route('/api/accessibility-features/<int:item_id>', methods=['PUT'])
@jwt_required()
@role_required('admin')
def update_amenity(item_id):
    item = Amenity.query.get(item_id)
    if not item:
        return jsonify({"error": "Amenity not found"}), 404

    data = request.get_json() or {}
    if 'name' in data:
        name = str(data['name'] or '').strip()
        if not name:
            return jsonify({"error": "Name cannot be empty"}), 400
        item.name = name

    if 'code' in data:
        new_code = slugify(data['code'])
        if not new_code:
            return jsonify({"error": "Code cannot be empty"}), 400
        if new_code != item.code:
            if Amenity.query.filter(Amenity.code == new_code, Amenity.id != item_id).first():
                return jsonify({"error": f"Amenity with code '{new_code}' already exists"}), 409
            item.code = new_code

    if 'description' in data:
        item.description = str(data['description'] or '').strip() or None

    if 'is_active' in data:
        item.is_active = bool(data['is_active'])

    if 'display_order' in data:
        try:
            item.display_order = int(data['display_order'])
        except (ValueError, TypeError):
            pass

    db.session.commit()
    user_id = get_jwt_identity()
    db.session.add(SystemLog(user_id=user_id, action=f"Updated amenity: {item.name}"))
    db.session.commit()

    return jsonify(item.to_dict()), 200


@reference_options_bp.route('/api/amenities/<int:item_id>', methods=['DELETE'])
@reference_options_bp.route('/api/accessibility-features/<int:item_id>', methods=['DELETE'])
@jwt_required()
@role_required('admin')
def delete_amenity(item_id):
    item = Amenity.query.get(item_id)
    if not item:
        return jsonify({"error": "Amenity not found"}), 404

    # Check how many centers use this amenity in junction table
    in_use_count = db.session.query(center_amenities).filter_by(amenity_id=item_id).count()

    if in_use_count > 0:
        item.is_active = False
        db.session.commit()
        return jsonify({
            "message": f"Amenity '{item.name}' is referenced by {in_use_count} evacuation center(s). It has been deactivated to preserve facility records.",
            "deactivated": True,
            "in_use_count": in_use_count
        }), 200

    name = item.name
    db.session.delete(item)
    db.session.commit()
    return jsonify({"message": f"Amenity '{name}' deleted successfully", "deleted": True}), 200

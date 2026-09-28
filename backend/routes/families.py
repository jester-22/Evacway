from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required

from models import (
    db,
    Barangay,
    Family,
    Resident
)

from utils import role_required


families_bp = Blueprint('families', __name__)


# =========================================================
# ADD FAMILY
# =========================================================
@families_bp.route('/api/families', methods=['POST'])
@jwt_required()
@role_required('admin', 'lgu_personnel')
def add_family():

    data = request.get_json()

    if not data:
        return jsonify({
            "error": "No data provided"
        }), 400

    barangay_id = data.get("barangay_id")
    family_code = data.get("family_code")
    head_name = data.get("head_name")
    member_count = data.get("member_count")
    contact_number = data.get("contact_number")

    if not barangay_id:
        return jsonify({
            "error": "Barangay is required"
        }), 400

    if not family_code:
        return jsonify({
            "error": "Family code is required"
        }), 400

    if not head_name:
        return jsonify({
            "error": "Family head name is required"
        }), 400

    if member_count is None:
        return jsonify({
            "error": "Member count is required"
        }), 400

    barangay = Barangay.query.get(barangay_id)

    if not barangay:
        return jsonify({
            "error": "Barangay not found"
        }), 404

    existing = Family.query.filter_by(
        family_code=family_code
    ).first()

    if existing:
        return jsonify({
            "error": "Family code already exists"
        }), 409

    family = Family(
        barangay_id=barangay_id,
        family_code=family_code,
        head_name=head_name,
        member_count=member_count,
        contact_number=contact_number,
        evacuation_status="Not Assigned"
    )

    db.session.add(family)
    db.session.commit()

    return jsonify({
        "message": "Family added successfully",
        "family": family.to_dict()
    }), 201


# =========================================================
# ADD FAMILY MEMBER
# =========================================================
@families_bp.route(
    '/api/families/<int:family_id>/members',
    methods=['POST']
)
@jwt_required()
@role_required('admin', 'lgu_personnel')
def add_family_member(family_id):

    family = Family.query.get(family_id)

    if not family:
        return jsonify({
            "error": "Family not found"
        }), 404

    data = request.get_json()

    if not data:
        return jsonify({
            "error": "No data provided"
        }), 400

    household_head_name = data.get("household_head_name")
    barangay = data.get("barangay")
    address = data.get("address")
    contact_number = data.get("contact_number")
    vulnerable_members = data.get("vulnerable_members")
    remarks = data.get("remarks")

    if not household_head_name:
        return jsonify({
            "error": "Member name is required"
        }), 400

    if not barangay:
        barangay = family.barangay.name

    resident = Resident(
        family_id=family.id,
        household_head_name=household_head_name,
        barangay=barangay,
        address=address,
        contact_number=contact_number,
        family_members=1,
        vulnerable_members=vulnerable_members,
        remarks=remarks
    )

    db.session.add(resident)

    # Keep the family's member count updated
    family.member_count = Resident.query.filter_by(
        family_id=family.id
    ).count() + 1

    db.session.commit()

    return jsonify({
        "message": "Family member added successfully",
        "member": resident.to_dict()
    }), 201


# =========================================================
# GET FAMILY MEMBERS
# =========================================================
@families_bp.route(
    '/api/families/<int:family_id>/members',
    methods=['GET']
)
@jwt_required()
@role_required('admin', 'lgu_personnel')
def get_family_members(family_id):

    family = Family.query.get(family_id)

    if not family:
        return jsonify({
            "error": "Family not found"
        }), 404

    members = Resident.query.filter_by(
        family_id=family_id
    ).order_by(
        Resident.id.asc()
    ).all()

    return jsonify([
        member.to_dict()
        for member in members
    ]), 200
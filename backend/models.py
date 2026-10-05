from flask_sqlalchemy import SQLAlchemy
from geoalchemy2 import Geometry
from datetime import datetime
from zoneinfo import ZoneInfo


db = SQLAlchemy()


# ---------------------------------------------------------
# TIMEZONE
# ---------------------------------------------------------
PHILIPPINES_TZ = ZoneInfo("Asia/Manila")


def philippines_now():
    return datetime.now(PHILIPPINES_TZ).replace(tzinfo=None)


# ---------------------------------------------------------
# USERS
# ---------------------------------------------------------
class User(db.Model):
    __tablename__ = 'users'

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    name = db.Column(
        db.String(100),
        nullable=False
    )

    email = db.Column(
        db.String(120),
        unique=True,
        nullable=False
    )

    password_hash = db.Column(
        db.String(255),
        nullable=False
    )

    contact_number = db.Column(
        db.String(20)
    )

    role = db.Column(
        db.String(20),
        nullable=False
    )

    is_active = db.Column(
        db.Boolean,
        default=True
    )

    created_at = db.Column(
        db.DateTime,
        default=philippines_now
    )

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "email": self.email,
            "contact_number": self.contact_number,
            "role": self.role,
            "is_active": self.is_active,
            "created_at": (
                self.created_at.isoformat()
                if self.created_at
                else None
            )
        }

    def __repr__(self):
        return f"<User {self.name} ({self.role})>"


# ---------------------------------------------------------
# HAZARD ZONES
# ---------------------------------------------------------
class HazardZone(db.Model):
    __tablename__ = 'hazard_zones'

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    name = db.Column(
        db.String(100),
        nullable=False
    )

    hazard_type = db.Column(
        db.String(50),
        nullable=False
    )

    risk_level = db.Column(
        db.String(20),
        nullable=False
    )

    geom = db.Column(
        Geometry('MULTIPOLYGON', srid=4326),
        nullable=False
    )

    created_by = db.Column(
        db.Integer,
        db.ForeignKey('users.id')
    )

    created_at = db.Column(
        db.DateTime,
        default=philippines_now
    )

    def __repr__(self):
        return (
            f"<HazardZone "
            f"{self.name} "
            f"({self.hazard_type}, {self.risk_level})>"
        )


# ---------------------------------------------------------
# EVACUATION CENTERS
#
# Center information can come from Excel first.
# GIS polygon/entrance can be added later from the map.
#
# Barangay relationship:
#
# Barangay 1 ---- many EvacuationCenters
# ---------------------------------------------------------
class EvacuationCenter(db.Model):
    __tablename__ = 'evacuation_centers'

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    name = db.Column(
        db.String(100),
        nullable=False
    )

    # -----------------------------------------------------
    # NEW: REAL BARANGAY FOREIGN KEY
    # -----------------------------------------------------
    barangay_id = db.Column(
        db.Integer,
        db.ForeignKey('barangays.id'),
        nullable=True
    )

    # Kept for compatibility with existing data/API.
    barangay = db.Column(
        db.String(100)
    )

    capacity = db.Column(
        db.Integer
    )

    building_material = db.Column(
        db.String(50)
    )

    accessibility_notes = db.Column(
        db.Text
    )

    hazard_exposure_score = db.Column(
        db.Float
    )

    contact_number = db.Column(
        db.String(20)
    )

    is_active = db.Column(
        db.Boolean,
        default=True
    )

    # Can be NULL until center is placed on map.
    geom = db.Column(
        Geometry('POLYGON', srid=4326),
        nullable=True
    )

    # Can be NULL until entrance is placed.
    entrance_geom = db.Column(
        Geometry('MULTIPOINT', srid=4326),
        nullable=True
    )

    managed_by = db.Column(
        db.Integer,
        db.ForeignKey('users.id')
    )

    created_at = db.Column(
        db.DateTime,
        default=philippines_now
    )

    # -----------------------------------------------------
    # Barangay → Evacuation Centers
    # -----------------------------------------------------
    barangay_record = db.relationship(
        'Barangay',
        back_populates='evacuation_centers',
        foreign_keys=[barangay_id]
    )

    # -----------------------------------------------------
    # Center → Rooms
    # -----------------------------------------------------
    rooms = db.relationship(
        'EvacuationCenterRoom',
        backref='evacuation_center',
        lazy=True,
        cascade='all, delete-orphan'
    )

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,

            "barangay_id": self.barangay_id,
            "barangay": self.barangay,

            "capacity": self.capacity,
            "building_material": self.building_material,
            "accessibility_notes": self.accessibility_notes,
            "hazard_exposure_score": self.hazard_exposure_score,
            "contact_number": self.contact_number,
            "is_active": self.is_active,

            "created_at": (
                self.created_at.isoformat()
                if self.created_at
                else None
            )
        }

    def __repr__(self):
        return f"<EvacuationCenter {self.name}>"


# ---------------------------------------------------------
# ROAD SEGMENTS
# ---------------------------------------------------------
class RoadSegment(db.Model):
    __tablename__ = 'road_segments'

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    road_name = db.Column(
        db.String(100)
    )

    road_type = db.Column(
        db.String(50)
    )

    base_weight = db.Column(
        db.Float,
        default=1.0
    )

    is_closed = db.Column(
        db.Boolean,
        default=False
    )

    hazard_zone_id = db.Column(
        db.Integer,
        db.ForeignKey('hazard_zones.id'),
        nullable=True
    )

    geom = db.Column(
        Geometry('LINESTRING', srid=4326),
        nullable=False
    )

    def __repr__(self):
        return f"<RoadSegment {self.road_name}>"


# ---------------------------------------------------------
# HAZARD REPORTS
# ---------------------------------------------------------
class HazardReport(db.Model):
    __tablename__ = 'hazard_reports'

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    description = db.Column(
        db.Text,
        nullable=False
    )

    photo_url = db.Column(
        db.String(255),
        nullable=False
    )

    report_type = db.Column(
        db.String(50)
    )

    status = db.Column(
        db.String(20),
        default='pending'
    )

    response_notes = db.Column(
        db.Text
    )

    validated_by = db.Column(
        db.Integer,
        db.ForeignKey('users.id'),
        nullable=True
    )

    geom = db.Column(
        Geometry('POINT', srid=4326),
        nullable=False
    )

    submitted_at = db.Column(
        db.DateTime,
        default=philippines_now
    )

    validated_at = db.Column(
        db.DateTime,
        nullable=True
    )

    def __repr__(self):
        return f"<HazardReport {self.report_type} - {self.status}>"


# ---------------------------------------------------------
# SYSTEM LOGS
# ---------------------------------------------------------
class SystemLog(db.Model):
    __tablename__ = 'system_logs'

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    user_id = db.Column(
        db.Integer,
        db.ForeignKey('users.id'),
        nullable=True
    )

    action = db.Column(
        db.String(255),
        nullable=False
    )

    timestamp = db.Column(
        db.DateTime,
        default=philippines_now
    )

    def __repr__(self):
        return f"<SystemLog {self.action} @ {self.timestamp}>"


# ---------------------------------------------------------
# STAFF NOTIFICATIONS
# ---------------------------------------------------------
class StaffNotification(db.Model):
    __tablename__ = 'staff_notifications'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    event_type = db.Column(db.String(32), nullable=False)
    resource_type = db.Column(db.String(24), nullable=False)
    resource_id = db.Column(db.Integer, nullable=False)
    title = db.Column(db.String(120), nullable=False)
    message = db.Column(db.String(240), nullable=False)
    is_emergency = db.Column(db.Boolean, nullable=False, default=False)
    is_read = db.Column(db.Boolean, nullable=False, default=False, index=True)
    created_at = db.Column(db.DateTime, nullable=False, default=philippines_now, index=True)


# ---------------------------------------------------------
# RESIDENT RESCUE REQUESTS
# ---------------------------------------------------------
class RescueRequest(db.Model):
    __tablename__ = 'rescue_requests'

    id = db.Column(db.Integer, primary_key=True)
    description = db.Column(db.Text, nullable=False)
    location_description = db.Column(db.String(255))
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    status = db.Column(db.String(20), nullable=False, default='pending', index=True)
    status_updated_by = db.Column(db.Integer, db.ForeignKey('users.id'))
    created_at = db.Column(db.DateTime, nullable=False, default=philippines_now, index=True)
    updated_at = db.Column(db.DateTime, nullable=False, default=philippines_now, onupdate=philippines_now)


# ---------------------------------------------------------
# WEB PUSH SUBSCRIPTIONS
# ---------------------------------------------------------
class PushSubscription(db.Model):
    __tablename__ = 'push_subscriptions'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    endpoint = db.Column(db.String(2048), nullable=False, unique=True)
    p256dh = db.Column(db.String(255), nullable=False)
    auth = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=philippines_now)


# ---------------------------------------------------------
# BARANGAYS
# ---------------------------------------------------------
class Barangay(db.Model):
    __tablename__ = 'barangays'

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    name = db.Column(
        db.String(100),
        nullable=False
    )

    population = db.Column(
        db.Integer,
        default=0
    )

    # Excel-created barangays may not have GIS geometry yet.
    geom = db.Column(
        Geometry('POLYGON', srid=4326),
        nullable=True
    )

    # -----------------------------------------------------
    # Barangay → Families
    # -----------------------------------------------------
    families = db.relationship(
        'Family',
        backref='barangay',
        lazy=True
    )

    # -----------------------------------------------------
    # Barangay → Evacuation Centers
    # -----------------------------------------------------
    evacuation_centers = db.relationship(
        'EvacuationCenter',
        back_populates='barangay_record',
        foreign_keys='EvacuationCenter.barangay_id',
        lazy=True
    )

    def __repr__(self):
        return f"<Barangay {self.name}>"


# ---------------------------------------------------------
# FAMILIES
# ---------------------------------------------------------
class Family(db.Model):
    __tablename__ = 'families'

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    barangay_id = db.Column(
        db.Integer,
        db.ForeignKey('barangays.id'),
        nullable=False
    )

    family_code = db.Column(
        db.String(100),
        nullable=False
    )

    head_name = db.Column(
        db.String(150),
        nullable=False
    )

    member_count = db.Column(
        db.Integer,
        nullable=False
    )

    contact_number = db.Column(
        db.String(20)
    )

    evacuation_status = db.Column(
        db.String(50)
    )

    created_at = db.Column(
        db.DateTime,
        default=philippines_now
    )

    updated_at = db.Column(
        db.DateTime,
        default=philippines_now,
        onupdate=philippines_now
    )

    residents = db.relationship(
        'Resident',
        backref='family',
        lazy=True
    )

    def to_dict(self):
        return {
            "id": self.id,
            "barangay_id": self.barangay_id,
            "family_code": self.family_code,
            "head_name": self.head_name,
            "member_count": self.member_count,
            "contact_number": self.contact_number,
            "evacuation_status": self.evacuation_status,
            "created_at": (
                self.created_at.isoformat()
                if self.created_at
                else None
            ),
            "updated_at": (
                self.updated_at.isoformat()
                if self.updated_at
                else None
            )
        }

    def __repr__(self):
        return f"<Family {self.family_code} - {self.head_name}>"


# ---------------------------------------------------------
# RESIDENTS / FAMILY MEMBERS
#
# One Excel row = one resident.
# ---------------------------------------------------------
class Resident(db.Model):
    __tablename__ = 'residents'

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    family_id = db.Column(
        db.Integer,
        db.ForeignKey('families.id'),
        nullable=True
    )

    first_name = db.Column(
        db.String(100),
        nullable=False
    )

    middle_name = db.Column(
        db.String(100)
    )

    last_name = db.Column(
        db.String(100),
        nullable=False
    )

    household_head_name = db.Column(
        db.String(150),
        nullable=False
    )

    barangay = db.Column(
        db.String(100),
        nullable=False
    )

    address = db.Column(
        db.String(255)
    )

    contact_number = db.Column(
        db.String(20)
    )

    family_members = db.Column(
        db.Integer,
        default=1
    )

    vulnerable_members = db.Column(
        db.String(255)
    )

    remarks = db.Column(
        db.Text
    )

    uploaded_by = db.Column(
        db.Integer,
        db.ForeignKey('users.id')
    )

    created_at = db.Column(
        db.DateTime,
        default=philippines_now
    )

    assignments = db.relationship(
        'EvacuationAssignment',
        backref='resident',
        lazy=True,
        cascade='all, delete-orphan'
    )

    def to_dict(self):
        return {
            "id": self.id,
            "family_id": self.family_id,

            "first_name": self.first_name,
            "middle_name": self.middle_name,
            "last_name": self.last_name,

            "full_name": self.get_full_name(),

            "household_head_name": self.household_head_name,
            "barangay": self.barangay,
            "address": self.address,
            "contact_number": self.contact_number,
            "family_members": self.family_members,
            "vulnerable_members": self.vulnerable_members,
            "remarks": self.remarks,

            "created_at": (
                self.created_at.isoformat()
                if self.created_at
                else None
            )
        }

    def get_full_name(self):
        parts = [
            self.first_name,
            self.middle_name,
            self.last_name
        ]

        return " ".join(
            str(part).strip()
            for part in parts
            if part and str(part).strip()
        )

    def __repr__(self):
        return (
            f"<Resident "
            f"{self.get_full_name()} "
            f"({self.barangay})>"
        )


# ---------------------------------------------------------
# EVACUATION CENTER ROOMS
#
# A room can be imported from Excel before its map
# location is placed.
# ---------------------------------------------------------
class EvacuationCenterRoom(db.Model):
    __tablename__ = 'evacuation_center_rooms'

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    evacuation_center_id = db.Column(
        db.Integer,
        db.ForeignKey('evacuation_centers.id'),
        nullable=False
    )

    room_number = db.Column(
        db.String(50),
        nullable=False
    )

    capacity = db.Column(
        db.Integer,
        nullable=False
    )

    # Can be NULL until room is placed on map.
    latitude = db.Column(
        db.Numeric(10, 7),
        nullable=True
    )

    longitude = db.Column(
        db.Numeric(10, 7),
        nullable=True
    )

    created_at = db.Column(
        db.DateTime,
        default=philippines_now
    )

    assignments = db.relationship(
        'EvacuationAssignment',
        backref='room',
        lazy=True,
        cascade='all, delete-orphan'
    )

    def to_dict(self):
        return {
            "id": self.id,
            "evacuation_center_id": self.evacuation_center_id,
            "room_number": self.room_number,
            "capacity": self.capacity,

            "latitude": (
                float(self.latitude)
                if self.latitude is not None
                else None
            ),

            "longitude": (
                float(self.longitude)
                if self.longitude is not None
                else None
            ),

            "created_at": (
                self.created_at.isoformat()
                if self.created_at
                else None
            )
        }

    def __repr__(self):
        return f"<EvacuationCenterRoom {self.room_number}>"


# ---------------------------------------------------------
# EVACUATION ASSIGNMENTS
#
# One resident/family member can have one room assignment.
# ---------------------------------------------------------
class EvacuationAssignment(db.Model):
    __tablename__ = 'evacuation_assignments'

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    resident_id = db.Column(
        db.Integer,
        db.ForeignKey('residents.id'),
        nullable=False,
        unique=True
    )

    room_id = db.Column(
        db.Integer,
        db.ForeignKey('evacuation_center_rooms.id'),
        nullable=False
    )

    assigned_at = db.Column(
        db.DateTime,
        default=philippines_now
    )

    def to_dict(self):
        return {
            "id": self.id,
            "resident_id": self.resident_id,
            "room_id": self.room_id,
            "assigned_at": (
                self.assigned_at.isoformat()
                if self.assigned_at
                else None
            )
        }

    def __repr__(self):
        return (
            f"<EvacuationAssignment "
            f"resident={self.resident_id} "
            f"room={self.room_id}>"
        )
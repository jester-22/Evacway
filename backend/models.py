from flask_sqlalchemy import SQLAlchemy
from geoalchemy2 import Geometry
from datetime import datetime
from zoneinfo import ZoneInfo


db = SQLAlchemy()

BARANGAY_COLOR_PALETTE = (
    "#2563eb",
    "#059669",
    "#d97706",
    "#7c3aed",
    "#db2777",
    "#0891b2",
    "#4f46e5",
    "#dc2626",
    "#0d9488",
    "#ea580c",
    "#65a30d",
    "#9333ea",
)


def get_barangay_color(barangay_id):
    try:
        idx = (int(barangay_id) - 1) % len(BARANGAY_COLOR_PALETTE)
        return BARANGAY_COLOR_PALETTE[idx]
    except (TypeError, ValueError):
        return BARANGAY_COLOR_PALETTE[0]


# ---------------------------------------------------------
# TIMEZONE
# ---------------------------------------------------------
PHILIPPINES_TZ = ZoneInfo("Asia/Manila")


def philippines_now():
    return datetime.now(PHILIPPINES_TZ).replace(tzinfo=None)


# ---------------------------------------------------------
# BASE MODEL (typed keyword constructor for static analyzers)
# ---------------------------------------------------------
class BaseModel(db.Model):
    __abstract__ = True

    def __init__(self, **kwargs):
        super().__init__(**kwargs)


# ---------------------------------------------------------
# USERS
# ---------------------------------------------------------
class User(BaseModel):
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

    resident_id = db.Column(
        db.Integer,
        db.ForeignKey('residents.id', ondelete='SET NULL'),
        unique=True,
        nullable=True,
        index=True
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

    last_login_at = db.Column(
        db.DateTime,
        nullable=True
    )

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "email": self.email,
            "contact_number": self.contact_number,
            "resident_id": self.resident_id,
            "role": self.role,
            "is_active": self.is_active,
            "created_at": (
                self.created_at.isoformat()
                if self.created_at
                else None
            ),
            "last_login_at": (
                self.last_login_at.isoformat()
                if self.last_login_at
                else None
            )
        }

    def __repr__(self):
        return f"<User {self.name} ({self.role})>"


# ---------------------------------------------------------
# HAZARD ZONES
# ---------------------------------------------------------
class HazardZone(BaseModel):
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
# Barangay relationship is many-to-many through CenterBarangay.
# ---------------------------------------------------------
class EvacuationCenter(BaseModel):
    __tablename__ = 'evacuation_centers'

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    name = db.Column(
        db.String(100),
        nullable=False
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

    center_type = db.Column(
        db.String(50),
        nullable=False,
        default='campus',
        server_default='campus'
    )

    owner_name = db.Column(
        db.String(150),
        nullable=True
    )

    max_rooms = db.Column(
        db.Integer,
        nullable=True
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

    barangay_links = db.relationship(
        'CenterBarangay',
        back_populates='center',
        cascade='all, delete-orphan',
        lazy=True
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
        barangays = [
            {
                "id": link.barangay.id,
                "name": link.barangay.name,
                "color": link.color,
            }
            for link in sorted(
                self.barangay_links,
                key=lambda item: (
                    item.barangay.name.casefold()
                    if item.barangay and item.barangay.name
                    else ""
                ),
            )
            if link.barangay is not None
        ]
        return {
            "id": self.id,
            "name": self.name,
            "barangays": barangays,
            "barangay": ", ".join(item["name"] for item in barangays) or None,
            "barangay_ids": [item["id"] for item in barangays],
            "barangay_id": barangays[0]["id"] if barangays else None,
            "capacity": self.capacity,
            "center_type": self.center_type or "campus",
            "owner_name": self.owner_name,
            "max_rooms": self.max_rooms,
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


class CenterBarangay(BaseModel):
    __tablename__ = 'center_barangays'

    center_id = db.Column(
        db.Integer,
        db.ForeignKey('evacuation_centers.id'),
        primary_key=True
    )
    barangay_id = db.Column(
        db.Integer,
        db.ForeignKey('barangays.id'),
        primary_key=True
    )
    created_at = db.Column(
        db.DateTime,
        default=philippines_now
    )

    center = db.relationship(
        'EvacuationCenter',
        back_populates='barangay_links'
    )
    barangay = db.relationship(
        'Barangay',
        back_populates='center_links'
    )

    @property
    def color(self):
        return get_barangay_color(self.barangay_id)


# ---------------------------------------------------------
# ROAD SEGMENTS
# ---------------------------------------------------------
class RoadSegment(BaseModel):
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
class HazardReport(BaseModel):
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
class SystemLog(BaseModel):
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

    def __init__(self, user_id=None, action=None, timestamp=None, **kwargs):
        super().__init__(user_id=user_id, action=action, timestamp=timestamp, **kwargs)

    def __repr__(self):
        return f"<SystemLog {self.action} @ {self.timestamp}>"


# ---------------------------------------------------------
# STAFF NOTIFICATIONS
# ---------------------------------------------------------
class StaffNotification(BaseModel):
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
class RescueRequest(BaseModel):
    __tablename__ = 'rescue_requests'

    id = db.Column(db.Integer, primary_key=True)
    description = db.Column(db.Text, nullable=False)
    location_description = db.Column(db.String(255))
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    status = db.Column(db.String(20), nullable=False, default='pending', index=True)
    status_updated_by = db.Column(db.Integer, db.ForeignKey('users.id'))
    requester_name = db.Column(db.String(100), nullable=False, default='')
    requester_contact = db.Column(db.String(20), nullable=False, default='')
    proof_images = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=philippines_now, index=True)
    updated_at = db.Column(db.DateTime, nullable=False, default=philippines_now, onupdate=philippines_now)


# ---------------------------------------------------------
# WEB PUSH SUBSCRIPTIONS
# ---------------------------------------------------------
class PushSubscription(BaseModel):
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
class Barangay(BaseModel):
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

    families = db.relationship(
        'Family',
        backref='barangay',
        lazy=True
    )

    center_links = db.relationship(
        'CenterBarangay',
        back_populates='barangay',
        cascade='all, delete-orphan',
        lazy=True
    )

    def __init__(self, name=None, population=0, geom=None, **kwargs):
        super().__init__(name=name, population=population, geom=geom, **kwargs)

    def __repr__(self):
        return f"<Barangay {self.name}>"


# ---------------------------------------------------------
# ROSTER YEARS
# ---------------------------------------------------------
class RosterYear(BaseModel):
    __tablename__ = 'roster_years'

    id = db.Column(db.Integer, primary_key=True)
    year = db.Column(db.Integer, unique=True, nullable=False)
    is_active = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, server_default=db.func.now())

    def to_dict(self):
        return {
            "id": self.id,
            "year": self.year,
            "is_active": self.is_active,
            "created_at": (
                self.created_at.isoformat()
                if self.created_at
                else None
            )
        }

    def __repr__(self):
        return f"<RosterYear {self.year} (active={self.is_active})>"


# ---------------------------------------------------------
# FAMILIES
# ---------------------------------------------------------
class Family(BaseModel):
    __tablename__ = 'families'
    __table_args__ = (
        db.UniqueConstraint('family_code', 'roster_year_id', name='uq_families_code_roster_year'),
    )

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    roster_year_id = db.Column(
        db.Integer,
        db.ForeignKey('roster_years.id'),
        nullable=False,
        index=True
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

    address = db.Column(
        db.String(255)
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

    updated_at = db.Column(
        db.DateTime,
        default=philippines_now,
        onupdate=philippines_now
    )

    roster_year = db.relationship(
        'RosterYear',
        backref=db.backref('families', lazy=True)
    )

    residents = db.relationship(
        'Resident',
        backref='family',
        lazy=True
    )

    def to_dict(self):
        return {
            "id": self.id,
            "roster_year_id": self.roster_year_id,
            "roster_year": self.roster_year.year if self.roster_year else None,
            "barangay_id": self.barangay_id,
            "family_code": self.family_code,
            "head_name": self.head_name,
            "member_count": self.member_count,
            "contact_number": self.contact_number,
            "evacuation_status": self.evacuation_status,
            "address": self.address,
            "vulnerable_members": self.vulnerable_members,
            "remarks": self.remarks,
            "uploaded_by": self.uploaded_by,
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
class Resident(BaseModel):
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

    # -----------------------------------------------------
    # OPTIONAL DETAIL FIELDS USED BY EXCEL IMPORT
    # -----------------------------------------------------

    suffix = db.Column(
        db.String(20)
    )

    date_of_birth = db.Column(
        db.Date
    )

    gender = db.Column(
        db.String(20)
    )

    alternate_contact = db.Column(
        db.String(50)
    )

    relationship_to_head = db.Column(
        db.String(50)
    )

    is_head_of_family = db.Column(
        db.Boolean,
        default=False
    )

    is_pwd = db.Column(
        db.Boolean,
        default=False
    )

    disability_type = db.Column(
        db.String(100)
    )

    disability_notes = db.Column(
        db.Text
    )

    is_pregnant = db.Column(
        db.Boolean,
        default=False
    )

    is_lactating = db.Column(
        db.Boolean,
        default=False
    )

    is_solo_parent = db.Column(
        db.Boolean,
        default=False
    )

    needs_assistance = db.Column(
        db.Boolean,
        default=False
    )

    medical_notes = db.Column(
        db.Text
    )

    notes = db.Column(
        db.Text
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

    @property
    def household_head_name(self):
        return self.family.head_name if self.family else None

    @property
    def barangay(self):
        return self.family.barangay.name if (self.family and self.family.barangay) else None

    @property
    def address(self):
        return self.family.address if self.family else None

    @property
    def contact_number(self):
        return self.family.contact_number if self.family else None

    @property
    def family_members(self):
        return self.family.member_count if self.family else None

    @property
    def vulnerable_members(self):
        return self.family.vulnerable_members if self.family else None

    @property
    def remarks(self):
        return self.family.remarks if self.family else None

    @property
    def uploaded_by(self):
        return self.family.uploaded_by if self.family else None

    @property
    def roster_year_id(self):
        return self.family.roster_year_id if self.family else None

    def to_dict(self):
        return {
            "id": self.id,
            "roster_year_id": self.family.roster_year_id if self.family else None,
            "roster_year": self.family.roster_year.year if (self.family and self.family.roster_year) else None,
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
            "suffix": self.suffix,
            "date_of_birth": (
                self.date_of_birth.isoformat()
                if self.date_of_birth
                else None
            ),
            "gender": self.gender,
            "alternate_contact": self.alternate_contact,
            "relationship_to_head": self.relationship_to_head,
            "is_head_of_family": self.is_head_of_family,
            "is_pwd": self.is_pwd,
            "disability_type": self.disability_type,
            "disability_notes": self.disability_notes,
            "is_pregnant": self.is_pregnant,
            "is_lactating": self.is_lactating,
            "is_solo_parent": self.is_solo_parent,
            "needs_assistance": self.needs_assistance,
            "medical_notes": self.medical_notes,
            "notes": self.notes,

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

        name = " ".join(
            str(part).strip()
            for part in parts
            if part and str(part).strip()
        )
        return " ".join(part for part in (name, self.suffix) if part)

    def __repr__(self):
        return (
            f"<Resident "
            f"{self.get_full_name()} "
            f"({self.barangay})>"
        )


# ---------------------------------------------------------
# RESIDENT ACCOUNTS
# ---------------------------------------------------------
class ResidentAccount(BaseModel):
    __tablename__ = 'resident_accounts'

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    resident_id = db.Column(
        db.Integer,
        db.ForeignKey('residents.id', ondelete='CASCADE'),
        unique=True,
        nullable=False
    )

    email = db.Column(
        db.String(120),
        nullable=False
    )

    password_hash = db.Column(
        db.String(255),
        nullable=False
    )

    is_active = db.Column(
        db.Boolean,
        default=True,
        nullable=False
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

    last_login_at = db.Column(
        db.DateTime,
        nullable=True
    )

    resident = db.relationship(
        'Resident',
        backref=db.backref('account', uselist=False, lazy=True)
    )

    def to_dict(self):
        return {
            "id": self.id,
            "resident_id": self.resident_id,
            "email": self.email,
            "is_active": self.is_active,
            "created_at": (
                self.created_at.isoformat()
                if self.created_at
                else None
            ),
            "updated_at": (
                self.updated_at.isoformat()
                if self.updated_at
                else None
            ),
            "last_login_at": (
                self.last_login_at.isoformat()
                if self.last_login_at
                else None
            )
        }

    def __repr__(self):
        return f"<ResidentAccount {self.email} (resident={self.resident_id})>"


# ---------------------------------------------------------
# RESIDENT REGISTRATION REQUESTS
# ---------------------------------------------------------
class ResidentRegistrationRequest(BaseModel):
    __tablename__ = 'resident_registration_requests'
    __table_args__ = (
        db.CheckConstraint(
            "status IN ('pending', 'approved', 'rejected')",
            name='ck_resident_registration_request_status'
        ),
    )

    id = db.Column(db.Integer, primary_key=True)
    first_name = db.Column(db.String(100), nullable=False)
    middle_name = db.Column(db.String(100))
    last_name = db.Column(db.String(100), nullable=False)
    birthdate = db.Column(db.Date, nullable=False)
    barangay = db.Column(db.String(100), nullable=False)
    address = db.Column(db.String(255), nullable=False)
    contact_number = db.Column(db.String(20), nullable=False)
    email = db.Column(db.String(120), nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    status = db.Column(db.String(20), nullable=False, default='pending', index=True)
    matched_resident_id = db.Column(
        db.Integer,
        db.ForeignKey('residents.id', ondelete='SET NULL')
    )
    reviewed_by = db.Column(
        db.Integer,
        db.ForeignKey('users.id', ondelete='SET NULL')
    )
    reviewed_at = db.Column(db.DateTime)
    rejection_reason = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=philippines_now, nullable=False)

    def to_dict(self):
        return {
            "id": self.id,
            "first_name": self.first_name,
            "middle_name": self.middle_name,
            "last_name": self.last_name,
            "full_name": " ".join(
                part for part in (self.first_name, self.middle_name, self.last_name) if part
            ),
            "birthdate": self.birthdate.isoformat() if self.birthdate else None,
            "barangay": self.barangay,
            "address": self.address,
            "contact_number": self.contact_number,
            "email": self.email,
            "status": self.status,
            "matched_resident_id": self.matched_resident_id,
            "reviewed_by": self.reviewed_by,
            "reviewed_at": self.reviewed_at.isoformat() if self.reviewed_at else None,
            "rejection_reason": self.rejection_reason,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


# ---------------------------------------------------------
# EVACUATION CENTER BUILDINGS
#
# Physical buildings within an evacuation center, stored as polygons.
# Links to one evacuation center and zero or more rooms.
# ---------------------------------------------------------
class EvacuationCenterBuilding(BaseModel):
    __tablename__ = 'evacuation_center_buildings'

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    evacuation_center_id = db.Column(
        db.Integer,
        db.ForeignKey('evacuation_centers.id'),
        nullable=False,
        index=True
    )

    name = db.Column(
        db.String(100),
        nullable=True
    )

    max_rooms = db.Column(
        db.Integer,
        nullable=True
    )

    floors = db.Column(
        db.Integer,
        nullable=True
    )

    status = db.Column(
        db.String(20),
        nullable=False,
        default='open',
        server_default='open'
    )

    notes = db.Column(
        db.Text,
        nullable=True
    )

    # Can be NULL until building is placed on map.
    geom = db.Column(
        Geometry('POLYGON', srid=4326),
        nullable=True
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

    evacuation_center = db.relationship(
        'EvacuationCenter',
        backref=db.backref('buildings', cascade='all, delete-orphan', lazy=True)
    )

    rooms = db.relationship(
        'EvacuationCenterRoom',
        backref='building',
        lazy=True
    )

    def to_dict(self):
        return {
            "id": self.id,
            "evacuation_center_id": self.evacuation_center_id,
            "name": self.name,
            "max_rooms": self.max_rooms,
            "floors": self.floors,
            "status": self.status,
            "notes": self.notes,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "is_mapped": self.geom is not None,
        }

    def __repr__(self):
        return f"<EvacuationCenterBuilding {self.id}: {self.name}>"


# ---------------------------------------------------------
# EVACUATION CENTER ROOMS
#
# A room can be imported from Excel before its map
# location is placed.
# ---------------------------------------------------------
class EvacuationCenterRoom(BaseModel):
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

    building_id = db.Column(
        db.Integer,
        db.ForeignKey('evacuation_center_buildings.id', ondelete='SET NULL'),
        nullable=True,
        index=True
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

    is_active = db.Column(
        db.Boolean,
        default=True,
        server_default='true',
        nullable=False
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
            "building_id": self.building_id,
            "building_name": (
                (self.building.name or f"Building #{self.building.id}")
                if self.building is not None
                else None
            ),
            "room_number": self.room_number,
            "capacity": self.capacity,
            "is_active": self.is_active,

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
class EvacuationAssignment(BaseModel):
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

    evacuation_center_id = db.Column(
        db.Integer,
        db.ForeignKey('evacuation_centers.id', ondelete='CASCADE'),
        nullable=True,
        index=True
    )

    room_id = db.Column(
        db.Integer,
        db.ForeignKey('evacuation_center_rooms.id'),
        nullable=True
    )

    assigned_at = db.Column(
        db.DateTime,
        default=philippines_now
    )

    checked_in_at = db.Column(
        db.DateTime,
        nullable=True,
        default=None
    )

    evacuation_center = db.relationship(
        'EvacuationCenter',
        backref=db.backref('direct_assignments', cascade='all, delete-orphan', lazy=True),
        foreign_keys=[evacuation_center_id]
    )

    def to_dict(self):
        return {
            "id": self.id,
            "resident_id": self.resident_id,
            "evacuation_center_id": self.evacuation_center_id,
            "room_id": self.room_id,
            "assigned_at": (
                self.assigned_at.isoformat()
                if self.assigned_at
                else None
            ),
            "checked_in_at": (
                self.checked_in_at.isoformat()
                if self.checked_in_at
                else None
            ),
            "is_checked_in": self.checked_in_at is not None,
        }

    def __repr__(self):
        return (
            f"<EvacuationAssignment "
            f"resident={self.resident_id} "
            f"center={self.evacuation_center_id} "
            f"room={self.room_id}>"
        )
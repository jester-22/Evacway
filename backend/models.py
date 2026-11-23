from flask_sqlalchemy import SQLAlchemy
from geoalchemy2 import Geometry
from datetime import datetime, date, timezone
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


def utc_now():
    """Return current UTC time as a naive datetime (for DB DateTime columns)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def to_utc_iso(value):
    """Serialize a datetime as an ISO 8601 UTC string ending with 'Z'.

    Naive datetimes are treated as UTC (matching utc_now()).
    Plain date objects (e.g. birthdate) remain YYYY-MM-DD.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            value = value.astimezone(timezone.utc).replace(tzinfo=None)
        return value.isoformat() + "Z"
    return value.isoformat()


def to_philippines_dt(value):
    """Convert a stored UTC datetime (naive or aware) to Asia/Manila time."""
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(PHILIPPINES_TZ)


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

    recovery_email = db.Column(
        db.String(120),
        nullable=True
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
        default=utc_now
    )

    last_login_at = db.Column(
        db.DateTime,
        nullable=True
    )

    login_failed_attempts = db.Column(db.Integer, nullable=False, default=0, server_default='0')
    login_failure_window_started_at = db.Column(db.DateTime, nullable=True)
    login_locked_until = db.Column(db.DateTime, nullable=True)

    totp_enabled = db.Column(db.Boolean, nullable=False, default=False, server_default=db.false())
    totp_secret_encrypted = db.Column(db.Text, nullable=True)
    totp_pending_secret_encrypted = db.Column(db.Text, nullable=True)
    totp_setup_expires_at = db.Column(db.DateTime, nullable=True)
    totp_last_used_step = db.Column(db.BigInteger, nullable=True)
    totp_backup_codes_hashes = db.Column(db.JSON, nullable=True)
    mfa_version = db.Column(db.Integer, nullable=False, default=0, server_default='0')


    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "email": self.email,
            "recovery_email": self.recovery_email,
            "contact_number": self.contact_number,
            "resident_id": self.resident_id,
            "role": self.role,
            "is_active": self.is_active,
            "created_at": (
                to_utc_iso(self.created_at)
                if self.created_at
                else None
            ),
            "last_login_at": (
                to_utc_iso(self.last_login_at)
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
        default=utc_now
    )

    def __repr__(self):
        return (
            f"<HazardZone "
            f"{self.name} "
            f"({self.hazard_type}, {self.risk_level})>"
        )


# ---------------------------------------------------------
# DEDICATED TABLES: CENTER TYPES, MATERIALS, ACCESSIBILITY
# ---------------------------------------------------------
class CenterType(BaseModel):
    __tablename__ = 'center_types'

    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(50), nullable=False, unique=True, index=True)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text, nullable=True)
    structure_mode = db.Column(
        db.String(30),
        nullable=False,
        default='buildings_and_rooms',
        server_default='buildings_and_rooms'
    )
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    display_order = db.Column(db.Integer, default=0, nullable=False)
    created_at = db.Column(db.DateTime, default=utc_now)
    updated_at = db.Column(db.DateTime, default=utc_now, onupdate=utc_now)

    def resolve_structure_mode(self):
        val = (self.structure_mode or '').strip().lower()
        if val in ('open_area', 'rooms_only', 'buildings_and_rooms'):
            return val
        code = (self.code or '').strip().lower()
        if code == 'single_venue':
            return 'open_area'
        if code == 'private_property':
            return 'rooms_only'
        return 'buildings_and_rooms'

    def to_dict(self):
        return {
            'id': self.id,
            'code': self.code,
            'name': self.name,
            'description': self.description,
            'structure_mode': self.resolve_structure_mode(),
            'is_active': self.is_active,
            'display_order': self.display_order,
            'created_at': to_utc_iso(self.created_at) if self.created_at else None,
            'updated_at': to_utc_iso(self.updated_at) if self.updated_at else None,
        }

    def __repr__(self):
        return f"<CenterType code='{self.code}' name='{self.name}'>"


class BuildingMaterial(BaseModel):
    __tablename__ = 'building_materials'

    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(50), nullable=False, unique=True, index=True)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text, nullable=True)
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    display_order = db.Column(db.Integer, default=0, nullable=False)
    created_at = db.Column(db.DateTime, default=utc_now)
    updated_at = db.Column(db.DateTime, default=utc_now, onupdate=utc_now)

    def to_dict(self):
        return {
            'id': self.id,
            'code': self.code,
            'name': self.name,
            'description': self.description,
            'is_active': self.is_active,
            'display_order': self.display_order,
            'created_at': to_utc_iso(self.created_at) if self.created_at else None,
            'updated_at': to_utc_iso(self.updated_at) if self.updated_at else None,
        }

    def __repr__(self):
        return f"<BuildingMaterial code='{self.code}' name='{self.name}'>"


class Amenity(BaseModel):
    __tablename__ = 'amenities'

    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(50), nullable=False, unique=True, index=True)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text, nullable=True)
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    display_order = db.Column(db.Integer, default=0, nullable=False)
    created_at = db.Column(db.DateTime, default=utc_now)
    updated_at = db.Column(db.DateTime, default=utc_now, onupdate=utc_now)

    def to_dict(self):
        return {
            'id': self.id,
            'code': self.code,
            'name': self.name,
            'description': self.description,
            'is_active': self.is_active,
            'display_order': self.display_order,
            'created_at': to_utc_iso(self.created_at) if self.created_at else None,
            'updated_at': to_utc_iso(self.updated_at) if self.updated_at else None,
        }

    def __repr__(self):
        return f"<Amenity code='{self.code}' name='{self.name}'>"


# Backward compatibility alias
AccessibilityFeature = Amenity

# ---------------------------------------------------------
# JUNCTION: EVACUATION CENTERS <-> AMENITIES
# ---------------------------------------------------------
center_amenities = db.Table(
    'center_amenities',
    db.Column('center_id', db.Integer, db.ForeignKey('evacuation_centers.id', ondelete='CASCADE'), primary_key=True),
    db.Column('amenity_id', db.Integer, db.ForeignKey('amenities.id', ondelete='CASCADE'), primary_key=True)
)
center_accessibility_features = center_amenities


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

    center_type_id = db.Column(
        db.Integer,
        db.ForeignKey('center_types.id', ondelete='RESTRICT'),
        nullable=False,
        default=1,
        server_default='1'
    )

    building_material_id = db.Column(
        db.Integer,
        db.ForeignKey('building_materials.id', ondelete='SET NULL'),
        nullable=True
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

    owner_name = db.Column(
        db.String(150),
        nullable=True
    )

    evacuation_open_date = db.Column(
        db.Date,
        nullable=True
    )

    evacuation_open_time = db.Column(
        db.String(10),
        nullable=True,
        default='08:00',
        server_default='08:00'
    )

    evacuation_cutoff_date = db.Column(
        db.Date,
        nullable=True
    )

    evacuation_cutoff_time = db.Column(
        db.String(10),
        nullable=True,
        default='18:00',
        server_default='18:00'
    )

    evacuation_extension_count = db.Column(
        db.Integer,
        nullable=True,
        default=0,
        server_default='0'
    )

    evacuation_extended_until = db.Column(
        db.DateTime(timezone=True),
        nullable=True
    )

    evacuation_status = db.Column(
        db.String(30),
        nullable=True,
        default='standby',
        server_default='standby'
    )

    evacuation_event_name = db.Column(
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
        default=utc_now
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

    center_type_ref = db.relationship(
        'CenterType',
        foreign_keys=[center_type_id],
        lazy='joined'
    )

    building_material_ref = db.relationship(
        'BuildingMaterial',
        foreign_keys=[building_material_id],
        lazy='joined'
    )

    amenities = db.relationship(
        'Amenity',
        secondary=center_amenities,
        lazy='subquery',
        backref=db.backref('centers', lazy='dynamic')
    )

    @property
    def accessibility_features(self):
        return self.amenities

    @accessibility_features.setter
    def accessibility_features(self, val):
        self.amenities = val

    @property
    def center_type(self):
        return self.center_type_ref.code if self.center_type_ref else "campus"

    @center_type.setter
    def center_type(self, val):
        if isinstance(val, int):
            self.center_type_id = val
        elif val:
            ct = CenterType.query.filter_by(code=str(val).strip().lower()).first()
            if ct:
                self.center_type_id = ct.id

    @property
    def center_type_name(self):
        return self.center_type_ref.name if self.center_type_ref else "Campus"

    @property
    def structure_mode(self):
        if self.center_type_ref is not None:
            return self.center_type_ref.resolve_structure_mode()
        code = (self.center_type or '').strip().lower()
        if code == 'single_venue':
            return 'open_area'
        if code == 'private_property':
            return 'rooms_only'
        return 'buildings_and_rooms'

    @property
    def building_material(self):
        return self.building_material_ref.name if self.building_material_ref else None

    @building_material.setter
    def building_material(self, val):
        if isinstance(val, int):
            self.building_material_id = val
        elif val:
            bm = BuildingMaterial.query.filter(
                (BuildingMaterial.name.ilike(str(val).strip())) | (BuildingMaterial.code == str(val).strip().lower())
            ).first()
            if bm:
                self.building_material_id = bm.id
            else:
                self.building_material_id = None
        else:
            self.building_material_id = None

    @property
    def owner_operator(self):
        return self.owner_name

    @owner_operator.setter
    def owner_operator(self, val):
        self.owner_name = val

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
            "center_type_id": self.center_type_id,
            "center_type": self.center_type_ref.code if self.center_type_ref else "campus",
            "center_type_name": self.center_type_ref.name if self.center_type_ref else "Campus",
            "structure_mode": self.structure_mode,
            "owner_name": self.owner_name,
            "owner_operator": self.owner_name,
            "max_rooms": self.max_rooms,
            "building_material_id": self.building_material_id,
            "building_material": self.building_material_ref.name if self.building_material_ref else self.building_material,
            "amenities": [a.name for a in self.amenities],
            "amenity_ids": [a.id for a in self.amenities],
            "hazard_exposure_score": self.hazard_exposure_score,
            "contact_number": self.contact_number,
            "is_active": self.is_active,
            "has_map": self.geom is not None,
            "is_mapped": self.geom is not None,
            "evacuation_open_date": (
                self.evacuation_open_date.isoformat()
                if self.evacuation_open_date
                else None
            ),
            "evacuation_open_time": self.evacuation_open_time or "08:00",
            "evacuation_cutoff_date": (
                self.evacuation_cutoff_date.isoformat()
                if self.evacuation_cutoff_date
                else (self.evacuation_open_date.isoformat() if self.evacuation_open_date else None)
            ),
            "evacuation_cutoff_time": self.evacuation_cutoff_time or "18:00",
            "evacuation_extension_count": int(self.evacuation_extension_count or 0),
            "evacuation_extended_until": (
                self.evacuation_extended_until.isoformat()
                if self.evacuation_extended_until
                else None
            ),
            "evacuation_status": self.evacuation_status or "standby",
            "evacuation_event_name": self.evacuation_event_name,

            "created_at": (
                to_utc_iso(self.created_at)
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
        default=utc_now
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

    closed_by_report_id = db.Column(
        db.Integer,
        db.ForeignKey('hazard_reports.id', ondelete='SET NULL'),
        nullable=True,
        index=True
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

    barangay_name = db.Column(
        db.String(100),
        nullable=True
    )

    status = db.Column(
        db.String(20),
        default='pending'
    )

    response_notes = db.Column(
        db.Text
    )

    rejection_reason = db.Column(
        db.Text,
        nullable=True
    )

    duplicate_of = db.Column(
        db.Integer,
        db.ForeignKey('hazard_reports.id', ondelete='SET NULL'),
        nullable=True,
        index=True
    )

    validated_by = db.Column(
        db.Integer,
        db.ForeignKey('users.id'),
        nullable=True
    )

    reported_by_user_id = db.Column(
        db.Integer,
        db.ForeignKey('users.id', ondelete='SET NULL'),
        nullable=True,
        index=True
    )

    reported_by_resident_account_id = db.Column(
        db.Integer,
        db.ForeignKey('resident_accounts.id', ondelete='SET NULL'),
        nullable=True,
        index=True
    )

    reporter_user = db.relationship(
        'User',
        foreign_keys=[reported_by_user_id],
        lazy='select'
    )

    reporter_resident_account = db.relationship(
        'ResidentAccount',
        foreign_keys=[reported_by_resident_account_id],
        lazy='select'
    )

    validator_user = db.relationship(
        'User',
        foreign_keys=[validated_by],
        lazy='select'
    )

    geom = db.Column(
        Geometry('POINT', srid=4326),
        nullable=False
    )

    submitted_at = db.Column(
        db.DateTime,
        default=utc_now
    )

    validated_at = db.Column(
        db.DateTime,
        nullable=True
    )

    photos = db.relationship(
        'HazardReportPhoto',
        backref='hazard_report',
        cascade='all, delete-orphan',
        order_by='HazardReportPhoto.sort_order',
        lazy='selectin'
    )

    def __repr__(self):
        return f"<HazardReport {self.report_type} - {self.status}>"


# ---------------------------------------------------------
# HAZARD REPORT PHOTOS
# ---------------------------------------------------------
class HazardReportPhoto(BaseModel):
    __tablename__ = 'hazard_report_photos'

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    hazard_report_id = db.Column(
        db.Integer,
        db.ForeignKey('hazard_reports.id', ondelete='CASCADE'),
        nullable=False,
        index=True
    )

    photo_path = db.Column(
        db.String(255),
        nullable=False
    )

    sort_order = db.Column(
        db.Integer,
        default=0,
        nullable=False
    )

    created_at = db.Column(
        db.DateTime,
        default=utc_now,
        nullable=False
    )

    def to_dict(self):
        return {
            'id': self.id,
            'hazard_report_id': self.hazard_report_id,
            'photo_path': self.photo_path,
            'sort_order': self.sort_order,
            'created_at': to_utc_iso(self.created_at) if self.created_at else None
        }

    def __repr__(self):
        return f"<HazardReportPhoto report_id={self.hazard_report_id} sort_order={self.sort_order} path='{self.photo_path}'>"


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
        default=utc_now
    )

    def __init__(self, user_id=None, action=None, timestamp=None, **kwargs):
        super().__init__(user_id=user_id, action=action, timestamp=timestamp, **kwargs)

    def __repr__(self):
        return f"<SystemLog {self.action} @ {self.timestamp}>"


class ResidentLookupLog(BaseModel):
    __tablename__ = 'resident_lookup_logs'

    id = db.Column(db.Integer, primary_key=True)
    lookup_type = db.Column(db.String(32), nullable=False, index=True)
    resident_account_id = db.Column(
        db.Integer,
        db.ForeignKey('resident_accounts.id', ondelete='SET NULL'),
        nullable=True,
        index=True,
    )
    client_ip = db.Column(db.String(64), nullable=True)
    query_name_masked = db.Column(db.String(150), nullable=True)
    query_barangay_masked = db.Column(db.String(100), nullable=True)
    query_extra_masked = db.Column(db.String(150), nullable=True)
    query_birthdate_masked = db.Column(db.String(16), nullable=True)
    found = db.Column(db.Boolean, nullable=False)
    timestamp = db.Column(db.DateTime, nullable=False, default=utc_now, index=True)


class AdminMfaRecoveryRequest(BaseModel):
    __tablename__ = 'admin_mfa_recovery_requests'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(
        db.Integer,
        db.ForeignKey('users.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    status = db.Column(db.String(20), nullable=False, default='pending', server_default='pending', index=True)
    requested_at = db.Column(db.DateTime, nullable=False, default=utc_now)
    expires_at = db.Column(db.DateTime, nullable=False, index=True)
    approved_by_user_id = db.Column(
        db.Integer,
        db.ForeignKey('users.id', ondelete='SET NULL'),
        nullable=True,
    )
    approved_at = db.Column(db.DateTime, nullable=True)


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
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now, index=True)


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
    status_updated_at = db.Column(db.DateTime, nullable=True, default=utc_now)
    handed_to_agency = db.Column(db.String(150), nullable=True)
    notes = db.Column(db.Text, nullable=True)
    requester_name = db.Column(db.String(100), nullable=False, default='')
    requester_contact = db.Column(db.String(20), nullable=False, default='')
    proof_images = db.Column(db.Text, nullable=True)
    selected_needs = db.Column(db.Text, nullable=True)
    people_count = db.Column(db.Integer, nullable=True)
    vulnerability_flags = db.Column(db.Text, nullable=True)
    accuracy = db.Column(db.Float, nullable=True)
    is_manual_pin = db.Column(db.Boolean, default=False)
    location_source = db.Column(db.String(50), nullable=True, default='gps')
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now, index=True)
    updated_at = db.Column(db.DateTime, nullable=False, default=utc_now, onupdate=utc_now)


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
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)


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
                to_utc_iso(self.created_at)
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

    find_someone_opt_out = db.Column(
        db.Boolean,
        nullable=False,
        default=False,
        server_default=db.false(),
    )

    searchable = db.Column(
        db.Boolean,
        nullable=False,
        default=False,
        server_default=db.false(),
    )

    uploaded_by = db.Column(
        db.Integer,
        db.ForeignKey('users.id')
    )

    created_at = db.Column(
        db.DateTime,
        default=utc_now
    )

    updated_at = db.Column(
        db.DateTime,
        default=utc_now,
        onupdate=utc_now
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
                to_utc_iso(self.created_at)
                if self.created_at
                else None
            ),
            "updated_at": (
                to_utc_iso(self.updated_at)
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
        default=utc_now
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

    @contact_number.setter
    def contact_number(self, value):
        if self.family is not None:
            self.family.contact_number = value

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

    @property
    def age(self):
        if not self.date_of_birth:
            return None
        today = date.today()
        born = self.date_of_birth
        try:
            return today.year - born.year - ((today.month, today.day) < (born.month, born.day))
        except Exception:
            return None

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
            "age": self.age,
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
                to_utc_iso(self.created_at)
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
        default=utc_now
    )

    updated_at = db.Column(
        db.DateTime,
        default=utc_now,
        onupdate=utc_now
    )

    last_login_at = db.Column(
        db.DateTime,
        nullable=True
    )

    login_failed_attempts = db.Column(db.Integer, nullable=False, default=0, server_default='0')
    login_failure_window_started_at = db.Column(db.DateTime, nullable=True)
    login_locked_until = db.Column(db.DateTime, nullable=True)
    find_someone_prompt_seen = db.Column(
        db.Boolean,
        nullable=False,
        default=False,
        server_default=db.false(),
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
                to_utc_iso(self.created_at)
                if self.created_at
                else None
            ),
            "updated_at": (
                to_utc_iso(self.updated_at)
                if self.updated_at
                else None
            ),
            "last_login_at": (
                to_utc_iso(self.last_login_at)
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
    privacy_consent = db.Column(db.Boolean, nullable=False, default=False, server_default=db.false())
    privacy_consent_at = db.Column(db.DateTime, nullable=True)
    privacy_notice_version = db.Column(db.String(40), nullable=True)
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
    created_at = db.Column(db.DateTime, default=utc_now, nullable=False)

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
            "privacy_consent": self.privacy_consent,
            "privacy_consent_at": to_utc_iso(self.privacy_consent_at) if self.privacy_consent_at else None,
            "privacy_notice_version": self.privacy_notice_version,
            "status": self.status,
            "matched_resident_id": self.matched_resident_id,
            "reviewed_by": self.reviewed_by,
            "reviewed_at": to_utc_iso(self.reviewed_at) if self.reviewed_at else None,
            "rejection_reason": self.rejection_reason,
            "created_at": to_utc_iso(self.created_at) if self.created_at else None,
        }


class RegistrationLinkOverrideLog(BaseModel):
    __tablename__ = 'registration_link_override_logs'

    id = db.Column(db.Integer, primary_key=True)
    admin_id = db.Column(
        db.Integer,
        db.ForeignKey('users.id', ondelete='SET NULL'),
        nullable=True,
        index=True,
    )
    request_id = db.Column(
        db.Integer,
        db.ForeignKey('resident_registration_requests.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    roster_id = db.Column(
        db.Integer,
        db.ForeignKey('residents.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    reason = db.Column(db.Text, nullable=False)
    timestamp = db.Column(db.DateTime, default=utc_now, nullable=False, index=True)

    def to_dict(self):
        return {
            "id": self.id,
            "admin_id": self.admin_id,
            "request_id": self.request_id,
            "roster_id": self.roster_id,
            "reason": self.reason,
            "timestamp": to_utc_iso(self.timestamp),
        }


# ---------------------------------------------------------
# EVACUATION CENTER BUILDINGS
#
# Physical buildings within an evacuation center, stored as polygons.
# Links to one evacuation center and zero or more rooms.
# ---------------------------------------------------------
class EvacuationCenterBuilding(BaseModel):
    __tablename__ = 'evacuation_center_buildings'
    __table_args__ = (
        db.CheckConstraint('floors BETWEEN 1 AND 20', name='ck_ec_building_floors_range'),
    )

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
        nullable=False,
        default=1,
        server_default='1'
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
        default=utc_now
    )

    updated_at = db.Column(
        db.DateTime,
        default=utc_now,
        onupdate=utc_now
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
        active_rooms = [room for room in self.rooms if room.is_active]
        usage_by_room = EvacuationCenterRoom.bulk_capacity_usage(active_rooms)
        floor_summary = []
        for floor in range(1, int(self.floors or 1) + 1):
            floor_rooms = [room for room in active_rooms if room.floor == floor]
            used_slots = sum(usage_by_room[room.id]["used_slots"] for room in floor_rooms)
            used_spaces = sum(usage_by_room[room.id]["used_spaces"] for room in floor_rooms)
            full_rooms = sum(1 for room in floor_rooms if usage_by_room[room.id]["is_full"])
            floor_summary.append({
                "floor": floor,
                "room_count": len(floor_rooms),
                "assigned": used_slots,
                "family_slots": sum(room.family_slots or 0 for room in floor_rooms),
                "used_slots": used_slots,
                "people_spaces": sum(room.people_spaces or 0 for room in floor_rooms),
                "used_spaces": used_spaces,
                "full_rooms": full_rooms,
            })
        return {
            "id": self.id,
            "evacuation_center_id": self.evacuation_center_id,
            "name": self.name,
            "max_rooms": self.max_rooms,
            "floors": self.floors,
            "floor_summary": floor_summary,
            "status": self.status,
            "notes": self.notes,
            "created_at": to_utc_iso(self.created_at) if self.created_at else None,
            "updated_at": to_utc_iso(self.updated_at) if self.updated_at else None,
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
    __table_args__ = (
        db.CheckConstraint('floor IS NULL OR floor >= 1', name='ck_ec_room_floor_positive'),
    )

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

    # Legacy database column retained until the compatibility migration is
    # fully deployed. New application logic uses family_slots/people_spaces.
    capacity = db.Column(
        db.Integer,
        nullable=False
    )

    family_slots = db.Column(db.Integer, nullable=False, default=5, server_default='5')
    people_spaces = db.Column(db.Integer, nullable=False, default=25, server_default='25')

    floor = db.Column(db.Integer, nullable=True)

    @property
    def latitude(self):
        return None

    @latitude.setter
    def latitude(self, val):
        pass

    @property
    def longitude(self):
        return None

    @longitude.setter
    def longitude(self, val):
        pass

    is_active = db.Column(
        db.Boolean,
        default=True,
        server_default='true',
        nullable=False
    )

    created_at = db.Column(
        db.DateTime,
        default=utc_now
    )

    assignments = db.relationship(
        'EvacuationAssignment',
        backref='room',
        lazy=True,
        cascade='all, delete-orphan'
    )

    @classmethod
    def bulk_capacity_usage(cls, rooms):
        """Batch-calculate room usage for many rooms in 2 SQL queries instead of N+1."""
        rooms_list = [room for room in (rooms or []) if room is not None]
        if not rooms_list:
            return {}

        room_ids = [room.id for room in rooms_list if room.id is not None]
        assigned_by_room = {rid: {} for rid in room_ids}
        walkin_by_room = {}

        if room_ids:
            reg_rows = (
                db.session.query(
                    EvacuationAssignment.room_id,
                    EvacuationAssignment.resident_id,
                    Resident.family_id,
                )
                .outerjoin(Resident, Resident.id == EvacuationAssignment.resident_id)
                .filter(
                    EvacuationAssignment.room_id.in_(room_ids),
                    EvacuationAssignment.resident_id.isnot(None),
                )
                .all()
            )
            for room_id, resident_id, family_id in reg_rows:
                assigned_by_room.setdefault(room_id, {})[resident_id] = family_id

            try:
                walkin_group_rows = (
                    db.session.query(
                        NonRegisteredEvacuee.room_id,
                        NonRegisteredEvacuee.group_code,
                        db.func.count(NonRegisteredEvacuee.id),
                    )
                    .join(
                        EvacuationOperation,
                        NonRegisteredEvacuee.operation_id == EvacuationOperation.id,
                    )
                    .filter(
                        NonRegisteredEvacuee.room_id.in_(room_ids),
                        NonRegisteredEvacuee.departed_at.is_(None),
                        EvacuationOperation.status == 'active',
                    )
                    .group_by(
                        NonRegisteredEvacuee.room_id,
                        NonRegisteredEvacuee.group_code,
                    )
                    .all()
                )
                slots_acc = {}
                spaces_acc = {}
                for room_id, _group_code, group_count in walkin_group_rows:
                    cnt = int(group_count or 0)
                    if cnt <= 0:
                        continue
                    spaces_acc[room_id] = spaces_acc.get(room_id, 0) + cnt
                    # Solo non-registered individuals (cnt == 1) only consume a people space, not a family slot.
                    if cnt > 1:
                        slots_acc[room_id] = slots_acc.get(room_id, 0) + 1
                for r_id in set(slots_acc.keys()) | set(spaces_acc.keys()):
                    walkin_by_room[r_id] = (
                        slots_acc.get(r_id, 0),
                        spaces_acc.get(r_id, 0),
                    )
            except Exception:
                db.session.rollback()

        usage_map = {}
        for room in rooms_list:
            assigned_residents = assigned_by_room.get(room.id, {})
            slot_keys = {
                ('family', family_id) if family_id is not None else ('resident', resident_id)
                for resident_id, family_id in assigned_residents.items()
            }
            walk_in_slots, walk_in_spaces = walkin_by_room.get(room.id, (0, 0))
            used_slots = len(slot_keys) + walk_in_slots
            used_spaces = len(assigned_residents) + walk_in_spaces
            family_slots = int(room.family_slots or 0)
            people_spaces = int(room.people_spaces or 0)
            usage_map[room.id] = {
                'used_slots': used_slots,
                'used_spaces': used_spaces,
                'available_slots': max(family_slots - used_slots, 0),
                'available_spaces': max(people_spaces - used_spaces, 0),
                'is_full': used_slots >= family_slots or used_spaces >= people_spaces,
                'is_over_capacity': used_slots > family_slots or used_spaces > people_spaces,
            }
        return usage_map

    def capacity_usage(self):
        """Calculate current room usage from registered and walk-in occupants."""
        if self.id is not None:
            return type(self).bulk_capacity_usage([self])[self.id]
        family_slots = int(self.family_slots or 0)
        people_spaces = int(self.people_spaces or 0)
        return {
            'used_slots': 0,
            'used_spaces': 0,
            'available_slots': max(family_slots, 0),
            'available_spaces': max(people_spaces, 0),
            'is_full': 0 >= family_slots or 0 >= people_spaces,
            'is_over_capacity': False,
        }

    def to_dict(self, usage=None):
        resolved_usage = self.capacity_usage() if usage is None else usage
        return {
            "id": self.id,
            "evacuation_center_id": self.evacuation_center_id,
            "building_id": self.building_id,
            "building_name": (
                (self.building.name or f"Building #{self.building.id}")
                if self.building is not None
                else None
            ),
            "building_floors": self.building.floors if self.building is not None else None,
            "building_status": self.building.status if self.building is not None else None,
            "building_is_mapped": bool(self.building is not None and self.building.geom is not None),
            "center_is_mapped": bool(self.evacuation_center is not None and self.evacuation_center.geom is not None),
            "room_number": self.room_number,
            "family_slots": self.family_slots,
            "people_spaces": self.people_spaces,
            **resolved_usage,
            "floor": self.floor,
            "is_active": self.is_active,

            "latitude": None,
            "longitude": None,

            "created_at": (
                to_utc_iso(self.created_at)
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
        default=utc_now
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
                to_utc_iso(self.assigned_at)
                if self.assigned_at
                else None
            ),
            "checked_in_at": (
                to_utc_iso(self.checked_in_at)
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


class EvacuationOperation(BaseModel):
    __tablename__ = 'evacuation_operations'

    id = db.Column(db.Integer, primary_key=True)
    center_id = db.Column(db.Integer, db.ForeignKey('evacuation_centers.id', ondelete='SET NULL'), nullable=True, index=True)
    event_name = db.Column(db.String(255), nullable=False)
    open_date = db.Column(db.Date, nullable=False)
    open_time = db.Column(db.String(10), default='08:00')
    cutoff_date = db.Column(db.Date, nullable=False)
    cutoff_time = db.Column(db.String(10), default='18:00')
    status = db.Column(db.String(30), default='active')  # 'active', 'concluded', 'standby'
    extension_count = db.Column(db.Integer, default=0)
    extended_until = db.Column(db.DateTime(timezone=True), nullable=True)
    created_by_user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    created_at = db.Column(db.DateTime, default=utc_now)
    concluded_at = db.Column(db.DateTime, nullable=True)

    center = db.relationship('EvacuationCenter', foreign_keys=[center_id], lazy=True)
    created_by = db.relationship('User', foreign_keys=[created_by_user_id], lazy=True)
    check_in_records = db.relationship('EvacuationCheckInRecord', backref='operation', cascade='all, delete-orphan', lazy=True)

    def to_dict(self):
        return {
            "id": self.id,
            "center_id": self.center_id,
            "center_name": self.center.name if self.center else "All Evacuation Centers",
            "event_name": self.event_name,
            "open_date": self.open_date.isoformat() if self.open_date else None,
            "open_time": self.open_time or "08:00",
            "cutoff_date": self.cutoff_date.isoformat() if self.cutoff_date else None,
            "cutoff_time": self.cutoff_time or "18:00",
            "status": self.status,
            "extension_count": self.extension_count or 0,
            "extended_until": self.extended_until.isoformat() if self.extended_until else None,
            "created_by_user_id": self.created_by_user_id,
            "created_at": to_utc_iso(self.created_at) if self.created_at else None,
            "concluded_at": to_utc_iso(self.concluded_at) if self.concluded_at else None,
            "is_active": self.status == 'active',
        }

    def __repr__(self):
        return f"<EvacuationOperation id={self.id} event='{self.event_name}' date={self.open_date} status='{self.status}'>"


class EvacuationCheckInRecord(BaseModel):
    __tablename__ = 'evacuation_check_in_records'

    id = db.Column(db.Integer, primary_key=True)
    operation_id = db.Column(db.Integer, db.ForeignKey('evacuation_operations.id', ondelete='CASCADE'), nullable=False, index=True)
    resident_id = db.Column(db.Integer, db.ForeignKey('residents.id', ondelete='CASCADE'), nullable=False, index=True)
    family_id = db.Column(db.Integer, db.ForeignKey('families.id', ondelete='SET NULL'), nullable=True, index=True)
    center_id = db.Column(db.Integer, db.ForeignKey('evacuation_centers.id', ondelete='CASCADE'), nullable=False, index=True)
    room_id = db.Column(db.Integer, db.ForeignKey('evacuation_center_rooms.id', ondelete='SET NULL'), nullable=True)
    checked_in_at = db.Column(db.DateTime, default=utc_now, nullable=False)
    checked_in_by_user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    method = db.Column(db.String(30), default='manual')
    status = db.Column(db.String(20), default='checked_in')  # 'checked_in', 'checked_out'
    checked_out_at = db.Column(db.DateTime, nullable=True)

    resident = db.relationship('Resident', foreign_keys=[resident_id], lazy=True)
    family = db.relationship('Family', foreign_keys=[family_id], lazy=True)
    center = db.relationship('EvacuationCenter', foreign_keys=[center_id], lazy=True)
    room = db.relationship('EvacuationCenterRoom', foreign_keys=[room_id], lazy=True)

    def to_dict(self):
        return {
            "id": self.id,
            "operation_id": self.operation_id,
            "resident_id": self.resident_id,
            "family_id": self.family_id,
            "center_id": self.center_id,
            "room_id": self.room_id,
            "checked_in_at": to_utc_iso(self.checked_in_at) if self.checked_in_at else None,
            "checked_in_by_user_id": self.checked_in_by_user_id,
            "method": self.method,
            "status": self.status,
            "checked_out_at": to_utc_iso(self.checked_out_at) if self.checked_out_at else None,
        }

    def __repr__(self):
        return f"<EvacuationCheckInRecord id={self.id} op={self.operation_id} res={self.resident_id} center={self.center_id} status='{self.status}'>"


class NonRegisteredEvacuee(BaseModel):
    __tablename__ = 'non_registered_evacuees'
    id = db.Column(db.Integer, primary_key=True)
    first_name = db.Column(db.String(60), nullable=False)
    middle_name = db.Column(db.String(60))
    last_name = db.Column(db.String(60), nullable=False)
    sex = db.Column(db.String(6), nullable=False)
    age_years = db.Column(db.Integer, nullable=False)
    birthdate = db.Column(db.Date)
    contact_number = db.Column(db.String(13))
    address = db.Column(db.String(200))
    is_pwd = db.Column(db.Boolean, nullable=False, default=False, server_default=db.false())
    is_pregnant = db.Column(db.Boolean, nullable=False, default=False, server_default=db.false())
    is_lactating = db.Column(db.Boolean, nullable=False, default=False, server_default=db.false())
    is_solo_parent = db.Column(db.Boolean, nullable=False, default=False, server_default=db.false())
    needs_assistance = db.Column(db.Boolean, nullable=False, default=False, server_default=db.false())
    needs_medical = db.Column(db.Boolean, nullable=False, default=False, server_default=db.false())
    notes = db.Column(db.String(200))
    group_code = db.Column(db.Uuid(as_uuid=False), nullable=False)
    is_group_head = db.Column(db.Boolean, nullable=False, default=False, server_default=db.false())
    operation_id = db.Column(db.Integer, db.ForeignKey('evacuation_operations.id', ondelete='RESTRICT'), nullable=False)
    center_id = db.Column(db.Integer, db.ForeignKey('evacuation_centers.id', ondelete='RESTRICT'), nullable=False)
    room_id = db.Column(db.Integer, db.ForeignKey('evacuation_center_rooms.id', ondelete='SET NULL'), nullable=True, index=True)
    arrived_at = db.Column(db.DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    departed_at = db.Column(db.DateTime(timezone=True))
    recorded_by = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='RESTRICT'), nullable=False)
    center = db.relationship('EvacuationCenter', foreign_keys=[center_id])
    operation = db.relationship('EvacuationOperation', foreign_keys=[operation_id])
    room = db.relationship('EvacuationCenterRoom', foreign_keys=[room_id])
    __table_args__ = (
        db.CheckConstraint("sex IN ('male', 'female', 'other')", name='ck_nre_sex'),
        db.CheckConstraint('age_years BETWEEN 0 AND 120', name='ck_nre_age'),
        db.CheckConstraint("NOT is_pregnant OR sex = 'female'", name='ck_nre_pregnancy'),
        db.CheckConstraint('departed_at IS NULL OR departed_at >= arrived_at', name='ck_nre_departure'),
        db.Index('ix_nre_operation_center', 'operation_id', 'center_id'),
        db.Index('ix_nre_group', 'group_code'),
        db.Index('ix_nre_arrived_desc', db.desc('arrived_at')),
        db.Index('ix_nre_present_center', 'center_id', postgresql_where=db.text('departed_at IS NULL'), sqlite_where=db.text('departed_at IS NULL')),
        db.Index('ix_nre_name', db.func.lower(last_name), db.func.lower(first_name)),
        db.Index('uq_nre_group_head', 'group_code', unique=True, postgresql_where=db.text('is_group_head'), sqlite_where=db.text('is_group_head')),
    )

    def to_dict(self, include_sensitive=False):
        result = {key: getattr(self, key) for key in (
            'id', 'first_name', 'middle_name', 'last_name', 'sex', 'age_years',
            'address', 'is_group_head', 'operation_id', 'center_id', 'room_id', 'recorded_by',
        )}
        result['group_code'] = str(self.group_code)
        result['name'] = ' '.join(filter(None, (self.first_name, self.middle_name, self.last_name)))
        for key in ('birthdate', 'arrived_at', 'departed_at'):
            value = getattr(self, key)
            result[key] = to_utc_iso(value)
        if include_sensitive:
            result.update({key: getattr(self, key) for key in (
                'contact_number', 'is_pwd', 'is_pregnant', 'is_lactating', 'is_solo_parent',
                'needs_assistance', 'needs_medical', 'notes',
            )})
        return result


# ---------------------------------------------------------
# SHARED UPLOADED FILES (HAZARD & RESCUE PHOTOS)
# ---------------------------------------------------------
class UploadedFile(BaseModel):
    __tablename__ = 'uploaded_files'

    id = db.Column(db.Integer, primary_key=True)
    storage_path = db.Column(db.String(255), unique=True, nullable=False, index=True)
    content_type = db.Column(db.String(120), nullable=False, default='application/octet-stream')
    data = db.Column(db.LargeBinary, nullable=False)
    byte_size = db.Column(db.Integer, nullable=False, default=0)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now)




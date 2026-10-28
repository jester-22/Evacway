/**
 * Evacuation center status thresholds and helpers (§3).
 *
 * Canonical source for center/room/family status classification,
 * occupancy segmentation, and status presentation values used across
 * the evacuation centers feature.
 */

export const STATUS_ORDER = ['Available', 'Near full', 'Full', 'Closed'];

export const STATUS_LABELS = {
  Available: 'Available',
  'Near full': 'Near full',
  Full: 'Full',
  Closed: 'Closed',
};

export const STATUS_COLORS = {
  Available: 'var(--ew-success)',
  'Near full': 'var(--ew-warning)',
  Full: 'var(--ew-danger)',
  Closed: 'var(--ew-neutral)',
};

export const OCCUPANCY_THRESHOLDS = {
  NEAR_FULL: 85, // percent of capacity assigned => \"Near full\"
  FULL: 100, // percent of capacity assigned => \"Full\"
};

export const VULNERABILITY_KEYWORDS = [
  'pregnant',
  'pwd',
  'disability',
  'elderly',
  'needs assistance',
  'senior',
];

export const ROOM_STATUS_THRESHOLDS = {
  NEAR_FULL: 85,
  FULL: 100,
};

export const FAMILY_STATUS_THRESHOLDS = {
  NEAR_FULL: 85,
  FULL: 100,
};

/**
 * Status of a single center based on assigned occupancy vs capacity.
 */
export function centerStatus(center, checkedIn, assigned, capacity) {
  if (center.is_active === false) return 'Closed';
  const cap = capacity || 0;
  const as = assigned || 0;
  if (cap > 0 && as >= cap) return 'Full';
  if (cap > 0 && Math.round((as / cap) * 100) >= OCCUPANCY_THRESHOLDS.NEAR_FULL) return 'Near full';
  return 'Available';
}

/**
 * Presentational variant token for a status string.
 */
export function statusVariant(status) {
  switch (status) {
    case 'Closed':
    case 'Full':
      return 'danger';
    case 'Near full':
      return 'warning';
    case 'Available':
      return 'success';
    default:
      return 'neutral';
  }
}

/**
 * Human-readable label for a status string.
 */
export function formatStatusLabel(status) {
  return STATUS_LABELS[status] ?? status;
}

/**
 * Segment occupancy into checked-in / assigned-not-arrived / free buckets.
 */
export function occupancySegments(checkedIn, assigned, capacity) {
  const cap = Math.max(0, capacity || 0);
  const ci = Math.max(0, Math.min(checkedIn || 0, cap));
  const as = Math.max(0, Math.min(assigned || 0, cap));
  const assignedNotArrived = Math.max(0, as - ci);
  const free = Math.max(0, cap - as);
  const pctAssigned = cap > 0 ? Math.round((as / cap) * 100) : 0;
  const pctCheckedIn = cap > 0 ? Math.round((ci / cap) * 100) : 0;
  return {
    checkedIn: ci,
    assignedNotArrived,
    free,
    capacity: cap,
    assigned: as,
    pctAssigned,
    pctCheckedIn,
  };
}

function sumRoomField(rooms, field) {
  return rooms.reduce((sum, r) => sum + (Number(r[field]) || 0), 0);
}

/**
 * Resolved checked-in count for a center (explicit center.occupied takes precedence).
 */
export function computeCenterCheckedIn(center, rooms) {
  const explicit = Number(center.occupied);
  if (explicit > 0 || rooms.length === 0) return explicit;
  return sumRoomField(rooms, 'occupied');
}

/**
 * Resolved assigned count for a center (explicit center.assigned takes precedence).
 */
export function computeCenterAssigned(center, rooms) {
  const explicit = center.assigned ?? center.total_assigned;
  const val = Number(explicit);
  if (val > 0 || rooms.length === 0) return val;
  return sumRoomField(rooms, 'assigned');
}

/**
 * Segment occupancy into checked-in / assigned-not-arrived / free buckets.
 */
export function computeOccupancySegments(checkedIn, assigned, capacity) {
  const cap = Math.max(0, capacity || 0);
  const ci = Math.max(0, Math.min(checkedIn || 0, cap));
  const as = Math.max(0, Math.min(assigned || 0, cap));
  const assignedNotArrived = Math.max(0, as - ci);
  const free = Math.max(0, cap - as);
  const pctAssigned = cap > 0 ? Math.round((as / cap) * 100) : 0;
  const pctCheckedIn = cap > 0 ? Math.round((ci / cap) * 100) : 0;
  return {
    checkedIn: ci,
    assignedNotArrived,
    free,
    capacity: cap,
    assigned: as,
    pctAssigned,
    pctCheckedIn,
  };
}

/**
 * Resolved capacity for a center (explicit center.capacity takes precedence).
 */
export function computeCenterCapacity(center, rooms) {
  const explicit = Number(center.capacity);
  if (explicit > 0) return explicit;
  return sumRoomField(rooms, 'capacity');
}

/**
 * Occupancy status used for progress bars / badges (percent, color, level).
 */
export function getOccupancyStatus(occupied = 0, capacity = 0) {
  const cap = Number(capacity) || 0;
  const occ = Number(occupied) || 0;
  const percent = cap > 0 ? Math.min(100, Math.round((occ / cap) * 100)) : occ > 0 ? 100 : 0;

  if (percent >= 90) {
    return { percent, color: "#dc2626", barClass: "is-full", level: "full" };
  }
  if (percent >= 70) {
    return { percent, color: "#d97706", barClass: "is-high", level: "high" };
  }
  return { percent, color: "#16a34a", barClass: "is-low", level: "normal" };
}

export function getOccupancyColor(occupied = 0, capacity = 0) {
  return getOccupancyStatus(occupied, capacity).color;
}

/**
 * Status of a single room based on occupied vs capacity.
 */
export function roomStatus(room) {
  const cap = Number(room.capacity) || 0;
  const occ = Number(room.occupied) || 0;
  if (room.is_active === false) return 'Closed';
  if (cap > 0 && occ >= cap) return 'Full';
  if (cap > 0 && Math.round((occ / cap) * 100) >= ROOM_STATUS_THRESHOLDS.NEAR_FULL) return 'Near full';
  return 'Available';
}

/**
 * Status of a family based on check-in state.
 */
export function familyStatus(family) {
  const checkedIn = Boolean(family.is_checked_in || family.checked_in_members);
  return checkedIn ? 'Checked in' : 'Not yet arrived';
}

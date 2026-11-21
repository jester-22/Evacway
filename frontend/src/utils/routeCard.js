function numericValue(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roomAvailability(room, availableKey, totalKey, usedKey) {
  const available = numericValue(room[availableKey]);
  if (available != null) return Math.max(0, available);

  const total = numericValue(room[totalKey]);
  const used = numericValue(room[usedKey]);
  return total == null || used == null ? null : Math.max(0, total - used);
}

function sumAvailability(rooms, availableKey, totalKey, usedKey) {
  if (rooms.length === 0) return null;
  const values = rooms.map((room) => roomAvailability(room, availableKey, totalKey, usedKey));
  if (values.some((value) => value == null)) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

export function getFreeCenterCapacity(centerId, rooms = []) {
  const matchingRooms = getActiveCenterRooms(centerId, rooms);

  return {
    freeFamilySlots: sumAvailability(matchingRooms, "available_slots", "family_slots", "used_slots"),
    freePeopleSpaces: sumAvailability(matchingRooms, "available_spaces", "people_spaces", "used_spaces"),
  };
}

function getActiveCenterRooms(centerId, rooms) {
  return (Array.isArray(rooms) ? rooms : []).filter((room) => (
    String(room.evacuation_center_id) === String(centerId)
    && room.is_active !== false
    && !["closed", "under repair"].includes(String(room.status || "").toLowerCase())
  ));
}

export function getCenterAvailability(centerId, rooms = [], knownPeopleCapacity = null) {
  const matchingRooms = getActiveCenterRooms(centerId, rooms);
  const capacity = getFreeCenterCapacity(centerId, matchingRooms);
  if (capacity.freeFamilySlots <= 0 || capacity.freePeopleSpaces <= 0) {
    return { status: "full", freePeopleSpaces: capacity.freePeopleSpaces };
  }
  if (capacity.freeFamilySlots == null || capacity.freePeopleSpaces == null) {
    return { status: "unavailable", freePeopleSpaces: null };
  }

  const totalPeopleSpaces = numericValue(knownPeopleCapacity)
    ?? matchingRooms.reduce((total, room) => (
      total + (numericValue(room.people_spaces ?? room.capacity) ?? 0)
    ), 0);
  const usageRatio = totalPeopleSpaces > 0
    ? (totalPeopleSpaces - capacity.freePeopleSpaces) / totalPeopleSpaces
    : 0;

  return {
    status: usageRatio >= 0.8 ? "almost-full" : "available",
    freePeopleSpaces: capacity.freePeopleSpaces,
  };
}

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
  const matchingRooms = (Array.isArray(rooms) ? rooms : []).filter((room) => (
    String(room.evacuation_center_id) === String(centerId)
    && room.is_active !== false
    && !["closed", "under repair"].includes(String(room.status || "").toLowerCase())
  ));

  return {
    freeFamilySlots: sumAvailability(matchingRooms, "available_slots", "family_slots", "used_slots"),
    freePeopleSpaces: sumAvailability(matchingRooms, "available_spaces", "people_spaces", "used_spaces"),
  };
}

/**
 * Formats a room value for display.
 * - Trims the value.
 * - If empty (null, undefined, or empty string), returns "Unassigned".
 * - If only digits (e.g. "3"), returns "Room " + value (e.g. "Room 3").
 * - Otherwise returns the value unchanged (e.g. "Room 3", "Yellow 12", "Tent 1").
 *
 * @param {string|number|null|undefined} value
 * @returns {string}
 */
export function formatRoomLabel(value) {
  if (value == null) {
    return "Unassigned";
  }

  const str = String(value).trim();
  if (!str) {
    return "Unassigned";
  }

  if (/^\d+$/.test(str)) {
    return `Room ${str}`;
  }

  return str;
}

export default formatRoomLabel;

const NAME_FIELDS = [
  "name",
  "label",
  "display_name",
  "formatted_address",
  "barangay_name",
  "full_name",
  "barangay",
  "value",
];

export function displayEntityName(value, fallback = "", seen = new Set()) {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (!value || typeof value !== "object" || Array.isArray(value) || seen.has(value)) {
    return fallback;
  }

  seen.add(value);
  for (const field of NAME_FIELDS) {
    if (value[field] === undefined || value[field] === value) continue;
    const name = displayEntityName(value[field], "", seen);
    if (name) return name;
  }

  return fallback;
}
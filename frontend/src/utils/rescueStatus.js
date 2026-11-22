import { parseTimestamp } from "./dateTime";

export const CLOSED_RESCUE_STATUSES = new Set(["resolved", "closed"]);
export const RESCUE_OVERDUE_THRESHOLD_HOURS = 2;
export const RESCUE_OVERDUE_THRESHOLD_MS = RESCUE_OVERDUE_THRESHOLD_HOURS * 60 * 60 * 1000;

export function isOpenRescueStatus(statusOrItem) {
  if (
    statusOrItem &&
    typeof statusOrItem === "object" &&
    typeof statusOrItem.is_open === "boolean"
  ) {
    return statusOrItem.is_open;
  }
  const raw =
    statusOrItem && typeof statusOrItem === "object"
      ? statusOrItem.status
      : statusOrItem;
  const normalized = String(raw || "").trim().toLowerCase();
  return !CLOSED_RESCUE_STATUSES.has(normalized);
}

export function isRescueOverdue(
  item,
  now = Date.now(),
  thresholdHours = RESCUE_OVERDUE_THRESHOLD_HOURS
) {
  if (!item || !isOpenRescueStatus(item)) return false;
  const effectiveHours =
    typeof item.overdue_threshold_hours === "number" && item.overdue_threshold_hours > 0
      ? item.overdue_threshold_hours
      : thresholdHours;
  const statusSince = item.status_updated_at || item.updated_at || item.created_at;
  if (!statusSince) return Boolean(item.is_overdue);
  const parsedDate = parseTimestamp(statusSince);
  if (!parsedDate) return Boolean(item.is_overdue);
  return now - parsedDate.getTime() > effectiveHours * 60 * 60 * 1000;
}

export function countOpenRescueRequests(requests) {
  if (!Array.isArray(requests)) return 0;
  return requests.filter((item) => isOpenRescueStatus(item)).length;
}

export const MANILA_TIME_ZONE = "Asia/Manila";

const ISO_DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_NAIVE_DATETIME_RE =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;

/**
 * Parse an API timestamp or date string into a Date object.
 * - Bare ISO datetimes without a timezone offset are treated as UTC ("Z").
 * - Date-only YYYY-MM-DD strings are anchored at midnight in Asia/Manila (+08:00)
 *   so formatting them in Asia/Manila always yields the exact calendar date.
 */
export function parseTimestamp(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const raw = String(value).trim();
  if (!raw) return null;

  let normalized = raw;
  if (ISO_DATE_ONLY_RE.test(raw)) {
    normalized = `${raw}T00:00:00+08:00`;
  } else if (ISO_NAIVE_DATETIME_RE.test(raw)) {
    normalized = `${raw.replace(" ", "T")}Z`;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Format a timestamp in the Asia/Manila time zone (date + time).
 */
export function formatManilaDateTime(value, options = {}, fallback = "") {
  const date = parseTimestamp(value);
  if (!date) return fallback;

  const hasCustomFields =
    options &&
    (options.dateStyle ||
      options.timeStyle ||
      options.year ||
      options.month ||
      options.day ||
      options.weekday ||
      options.hour ||
      options.minute ||
      options.second);

  const fmtOptions = hasCustomFields
    ? { ...options, timeZone: MANILA_TIME_ZONE }
    : {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: MANILA_TIME_ZONE,
      };

  return new Intl.DateTimeFormat("en-US", fmtOptions).format(date);
}

/**
 * Format a date or timestamp in the Asia/Manila time zone (date only).
 */
export function formatManilaDate(value, options = {}, fallback = "") {
  const date = parseTimestamp(value);
  if (!date) return fallback;

  const hasCustomFields =
    options &&
    (options.dateStyle ||
      options.year ||
      options.month ||
      options.day ||
      options.weekday);

  const fmtOptions = hasCustomFields
    ? { ...options, timeZone: MANILA_TIME_ZONE }
    : {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: MANILA_TIME_ZONE,
      };

  return new Intl.DateTimeFormat("en-US", fmtOptions).format(date);
}

/**
 * Format a timestamp in the Asia/Manila time zone (time only).
 */
export function formatManilaTime(value, options = {}, fallback = "") {
  const date = parseTimestamp(value);
  if (!date) return fallback;

  const hasCustomFields =
    options && (options.timeStyle || options.hour || options.minute || options.second);

  const fmtOptions = hasCustomFields
    ? { ...options, timeZone: MANILA_TIME_ZONE }
    : {
        hour: "numeric",
        minute: "2-digit",
        timeZone: MANILA_TIME_ZONE,
      };

  return new Intl.DateTimeFormat("en-US", fmtOptions).format(date);
}

/**
 * Return the YYYY-MM-DD calendar date key in Asia/Manila time.
 */
export function getManilaDateKey(value = new Date()) {
  const date = parseTimestamp(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: MANILA_TIME_ZONE,
  }).format(date);
}

/**
 * Return "Today", "Yesterday", or a formatted Asia/Manila date label.
 */
export function formatManilaRelativeDay(
  value,
  options = { month: "long", day: "numeric", year: "numeric" },
  fallback = ""
) {
  const targetKey = getManilaDateKey(value);
  if (!targetKey) return fallback;

  const now = new Date();
  const todayKey = getManilaDateKey(now);
  if (targetKey === todayKey) return "Today";

  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (targetKey === getManilaDateKey(yesterday)) return "Yesterday";

  return formatManilaDate(value, options, fallback);
}

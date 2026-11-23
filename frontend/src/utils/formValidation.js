export const NAME_REGEX = /^[a-zA-Z\u00C0-\u024FñÑ\s'.-]+$/;
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const PH_MOBILE_REGEX = /^(09\d{9}|\+639\d{9})$/;

export const PASSWORD_REQUIREMENTS_MESSAGE =
  "Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character.";

export const PASSWORD_RULES = [
  { id: "length", label: "At least 8 characters", test: (p = "") => p.length >= 8 },
  { id: "upper", label: "At least one uppercase letter (A–Z)", test: (p = "") => /[A-Z]/.test(p) },
  { id: "lower", label: "At least one lowercase letter (a–z)", test: (p = "") => /[a-z]/.test(p) },
  { id: "number", label: "At least one number (0–9)", test: (p = "") => /[0-9]/.test(p) },
  { id: "special", label: "At least one special character (!@#$%...)", test: (p = "") => /[^A-Za-z0-9\s]/.test(p) },
];

export function evaluatePasswordRules(password = "", confirmPassword = "") {
  const pwd = String(password || "");
  const cpwd = String(confirmPassword || "");
  return {
    minLen: pwd.length >= 8,
    upper: /[A-Z]/.test(pwd),
    lower: /[a-z]/.test(pwd),
    number: /[0-9]/.test(pwd),
    special: /[^A-Za-z0-9\s]/.test(pwd),
    match: Boolean(pwd) && pwd === cpwd,
  };
}

export function validatePassword(password) {
  const pwd = String(password || "");
  if (!pwd) return "Password is required.";
  if (pwd.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Z]/.test(pwd)) return "Password must include at least one uppercase letter.";
  if (!/[a-z]/.test(pwd)) return "Password must include at least one lowercase letter.";
  if (!/[0-9]/.test(pwd)) return "Password must include at least one number.";
  if (!/[^A-Za-z0-9\s]/.test(pwd)) return "Password must include at least one special character.";
  return "";
}

export function sanitizeNameInput(raw) {
  return String(raw || "").replace(/[^a-zA-Z\u00C0-\u024FñÑ\s'.-]/g, "");
}

export function sanitizePhoneInput(raw) {
  const str = String(raw || "");
  const hasLeadingPlus = str.trimStart().startsWith("+");
  const digits = str.replace(/\D/g, "");
  if (hasLeadingPlus) {
    return `+${digits}`.slice(0, 13);
  }
  return digits.slice(0, 11);
}

export function validatePersonName(value, { label = "Name", required = true, min = 2, max = 50 } = {}) {
  const val = String(value || "").trim();
  if (!val) return required ? `${label} is required.` : "";
  if (val.length < min || val.length > max) {
    return `${label} must be between ${min} and ${max} characters.`;
  }
  if (!NAME_REGEX.test(val) || !/[a-zA-Z\u00C0-\u024FñÑ]/.test(val)) {
    return `${label} can only contain letters, spaces, hyphens, apostrophes, and periods.`;
  }
  return "";
}

export function validateEmail(value, { label = "Email address", required = true } = {}) {
  const val = String(value || "").trim();
  if (!val) return required ? `${label} is required.` : "";
  if (val.length > 120 || !EMAIL_REGEX.test(val)) {
    return `Enter a valid ${label.toLowerCase()}.`;
  }
  return "";
}

export function validateContactNumber(value, { required = false, label = "Contact number" } = {}) {
  const val = String(value || "").trim();
  if (!val) return required ? `${label} is required.` : "";
  const clean = val.replace(/[\s-]/g, "");
  if (!PH_MOBILE_REGEX.test(clean)) {
    return "Enter a valid Philippine mobile number (e.g. 09XX XXX XXXX or +639XX XXX XXXX).";
  }
  return "";
}

export function getLocalYesterdayIso() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getLocalMinDobIso() {
  const now = new Date();
  const y = now.getFullYear() - 120;
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function validatePastBirthdate(value, { required = true, label = "Birthdate" } = {}) {
  const val = String(value || "").trim();
  if (!val) return required ? `${label} is required.` : "";
  const parts = val.split("-");
  if (parts.length !== 3) return `Enter a valid ${label.toLowerCase()}.`;
  const [year, month, day] = parts.map(Number);
  if (!year || !month || !day) return `Enter a valid ${label.toLowerCase()}.`;
  const dateObj = new Date(year, month - 1, day);
  if (
    Number.isNaN(dateObj.getTime()) ||
    dateObj.getFullYear() !== year ||
    dateObj.getMonth() !== month - 1 ||
    dateObj.getDate() !== day
  ) {
    return `Enter a valid ${label.toLowerCase()}.`;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (dateObj >= today) return `${label} must be a past date.`;
  const minDate = new Date();
  minDate.setFullYear(minDate.getFullYear() - 120);
  minDate.setHours(0, 0, 0, 0);
  if (dateObj < minDate) return `${label} cannot be more than 120 years ago.`;
  return "";
}

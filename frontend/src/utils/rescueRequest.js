export const RESCUE_NEEDS = [
  "Trapped",
  "Injured",
  "Flooding",
  "Medical emergency",
  "Need evacuation",
];

export const RESCUE_VULNERABILITY_FLAGS = ["PWD", "Senior", "Child", "Pregnant"];

export function maskContactNumber(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "No saved contact number";
  if (digits.length <= 7) return "*".repeat(digits.length);
  return `${digits.slice(0, 4)} *** *${digits.slice(-3)}`;
}

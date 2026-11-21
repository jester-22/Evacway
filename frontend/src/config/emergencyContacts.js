const VALID_PHONE = /^[+\d().\s-]+$/;

function configuredPhone(value) {
  const phone = String(value || "").trim();
  const digits = phone.replace(/\D/g, "");
  return VALID_PHONE.test(phone) && digits.length >= 7 ? phone : "";
}

export function createEmergencyContacts(env = {}) {
  const configuredOrOfficial = (key, officialNumber) =>
    configuredPhone(env[key]) || officialNumber;

  return {
    hotlines: [
      { label: "Sogod PNP-MPS", number: configuredOrOfficial("VITE_HOTLINE_PNP_MPS", "09625543356") },
      { label: "BFP Sogod Station", number: configuredOrOfficial("VITE_HOTLINE_BFP_1", "09055253319") },
      { label: "BFP Sogod Station", number: configuredOrOfficial("VITE_HOTLINE_BFP_2", "09120394672") },
      { label: "MDRRMO/SERT", number: configuredOrOfficial("VITE_HOTLINE_MDRRMO_1", "09854309736") },
      { label: "MDRRMO/SERT", number: configuredOrOfficial("VITE_HOTLINE_MDRRMO_2", "09359413945") },
      { label: "MDRRMO/SERT", number: configuredOrOfficial("VITE_HOTLINE_MDRRMO_LANDLINE", "(053) 5778281") },
      { label: "PCG Sogod PUB", number: configuredOrOfficial("VITE_HOTLINE_PCG", "09703712493") },
      { label: "MSWDO", number: configuredOrOfficial("VITE_HOTLINE_MSWDO", "09090172012") },
      { label: "RHU", number: configuredOrOfficial("VITE_HOTLINE_RHU", "09562676141") },
    ],
    rescueSmsNumber: configuredPhone(env.VITE_RESCUE_SMS_DESTINATION),
  };
}

export function createSmsUri(number, message, platform = "") {
  const recipient = configuredPhone(number).replace(/[^+\d]/g, "");
  if (!recipient || !String(message || "").trim()) return "";

  const body = encodeURIComponent(message);
  const isAppleMobile = /iPhone|iPad|iPod/i.test(platform);
  return isAppleMobile
    ? `sms:${recipient}&body=${body}`
    : `sms:${recipient}?body=${body}`;
}

export function buildRescueMessage({ coordinates, location, people }) {
  const latitude = Number(coordinates?.latitude);
  const longitude = Number(coordinates?.longitude);
  const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude);
  const locationLine = hasCoordinates
    ? `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=18/${latitude}/${longitude}`
    : String(location || "").trim()
      ? `Location: ${String(location).trim()}`
      : "";
  const rawCount = String(people || "").trim();
  const count = /^\d+$/.test(rawCount) ? Number(rawCount) : 0;

  return [
    "I need rescue assistance.",
    locationLine,
    Number.isInteger(count) && count > 0 ? `People needing help: ${count}` : "",
  ].filter(Boolean).join("\n");
}

const environment = import.meta.env || {};
export const emergencyContacts = createEmergencyContacts(environment);

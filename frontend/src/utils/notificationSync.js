export const REGISTRATIONS_UPDATED_EVENT = "evacway:registrations-updated";

const FALLBACK_COOLDOWN_MS = 1500;
const MAX_TRACKED_IDS = 500;

const syncedNotificationIds = new Set();
const lastAnonymousSyncByDomain = new Map();

function trackNotificationId(id) {
  if (id === undefined || id === null || id === "") return;
  const key = String(id);
  if (syncedNotificationIds.size >= MAX_TRACKED_IDS) {
    const oldest = syncedNotificationIds.values().next().value;
    if (oldest !== undefined) syncedNotificationIds.delete(oldest);
  }
  syncedNotificationIds.add(key);
}

export function resetNotificationSyncState() {
  syncedNotificationIds.clear();
  lastAnonymousSyncByDomain.clear();
}

export function getNotificationDomain(notification) {
  if (!notification || typeof notification !== "object") return null;

  const resourceType = String(
    notification.resource_type || notification.resourceType || ""
  ).toLowerCase();
  const eventType = String(
    notification.event_type || notification.eventType || ""
  ).toLowerCase();

  if (
    notification.is_emergency === true ||
    resourceType === "rescue_request" ||
    eventType.includes("rescue")
  ) {
    return "rescue";
  }

  if (resourceType === "hazard_report" || eventType.includes("hazard")) {
    return "hazard";
  }

  if (
    resourceType === "resident_registration" ||
    resourceType === "resident_account" ||
    eventType.includes("registration")
  ) {
    return "registration";
  }

  return null;
}

export function getNotificationDomains(notifications) {
  if (!Array.isArray(notifications) || notifications.length === 0) return [];
  const domains = new Set();
  for (const item of notifications) {
    const domain = getNotificationDomain(item);
    if (domain) domains.add(domain);
  }
  return Array.from(domains);
}

/**
 * Mark initial notification IDs as already synced so the initial page load
 * does not trigger redundant invalidations.
 */
export function markNotificationsSynced(notifications) {
  if (!Array.isArray(notifications)) return;
  for (const item of notifications) {
    const id = item?.id ?? item?.notificationId;
    if (id !== undefined && id !== null && id !== "") {
      trackNotificationId(id);
    }
  }
}

/**
 * Silently refreshes only the active queries affected by newly arrived notifications.
 * Uses `refetchType: "active"` so inactive tabs are marked stale without firing
 * unnecessary background requests, while active pages update in place without loaders.
 */
export function syncNotificationsToQueries(
  queryClient,
  notifications,
  {
    now = Date.now(),
    cooldownMs = FALLBACK_COOLDOWN_MS,
    eventTarget = typeof window !== "undefined" ? window : null,
  } = {}
) {
  if (!queryClient || !Array.isArray(notifications) || notifications.length === 0) {
    return [];
  }

  const domainsToSync = new Set();

  for (const item of notifications) {
    const domain = getNotificationDomain(item);
    if (!domain) continue;

    const rawId = item?.id ?? item?.notificationId;
    const hasId = rawId !== undefined && rawId !== null && rawId !== "";

    if (hasId) {
      const key = String(rawId);
      if (syncedNotificationIds.has(key)) continue;
      trackNotificationId(key);
      domainsToSync.add(domain);
    } else {
      const lastAt = lastAnonymousSyncByDomain.get(domain) ?? -Infinity;
      if (now - lastAt < cooldownMs) continue;
      lastAnonymousSyncByDomain.set(domain, now);
      domainsToSync.add(domain);
    }
  }

  if (domainsToSync.size === 0) return [];

  const invalidatedKeys = [];
  const invalidateActive = (queryKey) => {
    invalidatedKeys.push(queryKey);
    queryClient.invalidateQueries({ queryKey, refetchType: "active" });
  };

  if (domainsToSync.has("hazard")) {
    invalidateActive(["hazard-reports"]);
  }

  if (domainsToSync.has("rescue")) {
    invalidateActive(["rescue-requests"]);
  }

  if (domainsToSync.has("registration")) {
    if (eventTarget && typeof eventTarget.dispatchEvent === "function") {
      try {
        const event =
          typeof CustomEvent === "function"
            ? new CustomEvent(REGISTRATIONS_UPDATED_EVENT)
            : { type: REGISTRATIONS_UPDATED_EVENT };
        eventTarget.dispatchEvent(event);
      } catch {
        // Ignore event dispatch failures in restricted environments
      }
    }
  }

  invalidateActive(["dashboard"]);

  return Array.from(domainsToSync);
}

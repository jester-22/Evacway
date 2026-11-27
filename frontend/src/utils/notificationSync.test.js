import test from "node:test";
import assert from "node:assert/strict";
import {
  REGISTRATIONS_UPDATED_EVENT,
  getNotificationDomain,
  getNotificationDomains,
  markNotificationsSynced,
  resetNotificationSyncState,
  syncNotificationsToQueries,
} from "./notificationSync.js";

test("getNotificationDomain classifies hazard, rescue, registration, and unknown notifications", () => {
  assert.equal(getNotificationDomain({ resource_type: "hazard_report" }), "hazard");
  assert.equal(getNotificationDomain({ resourceType: "hazard_report" }), "hazard");
  assert.equal(getNotificationDomain({ event_type: "new_hazard_submitted" }), "hazard");

  assert.equal(getNotificationDomain({ resource_type: "rescue_request" }), "rescue");
  assert.equal(getNotificationDomain({ is_emergency: true }), "rescue");
  assert.equal(getNotificationDomain({ eventType: "rescue_alert" }), "rescue");

  assert.equal(getNotificationDomain({ resource_type: "resident_registration" }), "registration");
  assert.equal(getNotificationDomain({ resource_type: "resident_account" }), "registration");

  assert.equal(getNotificationDomain({ resource_type: "other" }), null);
  assert.equal(getNotificationDomain(null), null);
});

test("syncNotificationsToQueries invalidates only matching active queries and deduplicates by id", () => {
  resetNotificationSyncState();
  const calls = [];
  const queryClient = {
    invalidateQueries: (arg) => calls.push(arg),
  };

  // First arrival via service worker push
  const first = syncNotificationsToQueries(
    queryClient,
    [{ notificationId: 101, resource_type: "hazard_report" }],
    { eventTarget: null }
  );
  assert.deepEqual(first, ["hazard"]);
  assert.deepEqual(calls, [
    { queryKey: ["hazard-reports"], refetchType: "active" },
    { queryKey: ["dashboard"], refetchType: "active" },
  ]);

  // Same notification arriving shortly after via poll should NOT re-invalidate
  const duplicate = syncNotificationsToQueries(
    queryClient,
    [{ id: 101, resource_type: "hazard_report" }],
    { eventTarget: null }
  );
  assert.deepEqual(duplicate, []);
  assert.equal(calls.length, 2);

  // Distinct rescue notification invalidates rescue + dashboard only
  const rescue = syncNotificationsToQueries(
    queryClient,
    [{ id: 102, resource_type: "rescue_request", is_emergency: true }],
    { eventTarget: null }
  );
  assert.deepEqual(rescue, ["rescue"]);
  assert.deepEqual(calls.slice(2), [
    { queryKey: ["rescue-requests"], refetchType: "active" },
    { queryKey: ["dashboard"], refetchType: "active" },
  ]);
});

test("syncNotificationsToQueries coalesces dashboard invalidation and dispatches registration event", () => {
  resetNotificationSyncState();
  const calls = [];
  const dispatched = [];
  const queryClient = {
    invalidateQueries: (arg) => calls.push(arg),
  };
  const eventTarget = {
    dispatchEvent: (event) => dispatched.push(event.type),
  };

  const synced = syncNotificationsToQueries(
    queryClient,
    [
      { id: 201, resource_type: "hazard_report" },
      { id: 202, resource_type: "rescue_request" },
      { id: 203, resource_type: "resident_registration" },
    ],
    { eventTarget }
  );

  assert.deepEqual(synced.sort(), ["hazard", "registration", "rescue"]);
  assert.deepEqual(calls, [
    { queryKey: ["hazard-reports"], refetchType: "active" },
    { queryKey: ["rescue-requests"], refetchType: "active" },
    { queryKey: ["dashboard"], refetchType: "active" },
  ]);
  assert.deepEqual(dispatched, [REGISTRATIONS_UPDATED_EVENT]);
});

test("markNotificationsSynced prevents initial-load notifications from re-syncing", () => {
  resetNotificationSyncState();
  const calls = [];
  const queryClient = {
    invalidateQueries: (arg) => calls.push(arg),
  };

  markNotificationsSynced([{ id: 301, resource_type: "hazard_report" }]);
  const synced = syncNotificationsToQueries(
    queryClient,
    [{ id: 301, resource_type: "hazard_report" }],
    { eventTarget: null }
  );
  assert.deepEqual(synced, []);
  assert.equal(calls.length, 0);
  assert.deepEqual(
    getNotificationDomains([
      { resource_type: "hazard_report" },
      { resource_type: "hazard_report" },
      { resource_type: "rescue_request" },
    ]),
    ["hazard", "rescue"]
  );
});

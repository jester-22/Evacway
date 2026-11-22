import test from "node:test";
import assert from "node:assert/strict";
import {
  getAlertSoundKind,
  getBatchAlertSoundKind,
  isAlertSoundNotification,
  isAlertSoundMuted,
  setAlertSoundMuted,
} from "./alertSound.js";

test("getAlertSoundKind classifies rescue, hazard, and non-alert notifications", () => {
  assert.equal(
    getAlertSoundKind({
      resource_type: "rescue_request",
      event_type: "rescue_request",
      is_emergency: true,
    }),
    "rescue"
  );

  assert.equal(
    getAlertSoundKind({
      resource_type: "rescue_request",
      is_emergency: false,
    }),
    "rescue"
  );

  assert.equal(
    getAlertSoundKind({
      resource_type: "hazard_report",
      event_type: "hazard_report",
      is_emergency: false,
    }),
    "hazard"
  );

  assert.equal(
    getAlertSoundKind({
      resource_type: "resident_registration",
      event_type: "resident_registration",
      is_emergency: false,
    }),
    null
  );

  assert.equal(getAlertSoundKind(null), null);
});

test("isAlertSoundNotification matches only hazard reports and rescue alerts", () => {
  assert.equal(isAlertSoundNotification({ resource_type: "hazard_report" }), true);
  assert.equal(isAlertSoundNotification({ resource_type: "rescue_request" }), true);
  assert.equal(isAlertSoundNotification({ is_emergency: true }), true);
  assert.equal(isAlertSoundNotification({ resource_type: "resident_registration" }), false);
  assert.equal(isAlertSoundNotification({ resource_type: "resident_account" }), false);
});

test("getBatchAlertSoundKind prioritizes rescue over hazard and ignores silent notifications", () => {
  assert.equal(
    getBatchAlertSoundKind([
      { resource_type: "resident_registration" },
      { resource_type: "hazard_report" },
      { resource_type: "rescue_request", is_emergency: true },
    ]),
    "rescue"
  );

  assert.equal(
    getBatchAlertSoundKind([
      { resource_type: "resident_registration" },
      { resource_type: "hazard_report" },
    ]),
    "hazard"
  );

  assert.equal(
    getBatchAlertSoundKind([{ resource_type: "resident_registration" }]),
    null
  );

  assert.equal(getBatchAlertSoundKind([]), null);
});

test("mute helpers fail safely when window/localStorage is unavailable", () => {
  assert.equal(isAlertSoundMuted(), false);
  assert.doesNotThrow(() => setAlertSoundMuted(true));
});

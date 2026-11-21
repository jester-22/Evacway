import assert from "node:assert/strict";
import test from "node:test";
import { LONG_WALK_THRESHOLD_MINUTES } from "../config/routeCard.js";
import { getCenterAvailability, getFreeCenterCapacity } from "./routeCard.js";

test("route card totals only usable rooms at the destination center", () => {
  const capacity = getFreeCenterCapacity(7, [
    { evacuation_center_id: 7, available_slots: 2, available_spaces: 8, status: "Available" },
    { evacuation_center_id: 7, available_slots: 1, available_spaces: 4, status: "Available" },
    { evacuation_center_id: 7, available_slots: 5, available_spaces: 20, status: "Closed" },
    { evacuation_center_id: 8, available_slots: 10, available_spaces: 50, status: "Available" },
  ]);

  assert.deepEqual(capacity, { freeFamilySlots: 3, freePeopleSpaces: 12 });
});

test("route card derives remaining capacity from existing totals and used counts", () => {
  const capacity = getFreeCenterCapacity("7", [
    { evacuation_center_id: 7, family_slots: 6, used_slots: 2, people_spaces: 24, used_spaces: 9 },
  ]);

  assert.deepEqual(capacity, { freeFamilySlots: 4, freePeopleSpaces: 15 });
});

test("route card leaves missing capacity unknown instead of displaying zero", () => {
  const capacity = getFreeCenterCapacity(7, [
    { evacuation_center_id: 7, status: "Available" },
  ]);

  assert.deepEqual(capacity, { freeFamilySlots: null, freePeopleSpaces: null });
});

test("availability is full when either family slots or people spaces run out", () => {
  assert.deepEqual(getCenterAvailability(7, [
    { evacuation_center_id: 7, available_slots: 0, available_spaces: 12, people_spaces: 24 },
  ]), { status: "full", freePeopleSpaces: 12 });
  assert.deepEqual(getCenterAvailability(7, [
    { evacuation_center_id: 7, available_slots: 2, available_spaces: 0, people_spaces: 24 },
  ]), { status: "full", freePeopleSpaces: 0 });
  assert.deepEqual(getCenterAvailability(7, [
    { evacuation_center_id: 7, available_slots: null, available_spaces: 0 },
  ]), { status: "full", freePeopleSpaces: 0 });
});

test("availability warns at 80 percent people-space use", () => {
  assert.deepEqual(getCenterAvailability(7, [
    { evacuation_center_id: 7, available_slots: 4, available_spaces: 4, family_slots: 8, people_spaces: 20 },
  ]), { status: "almost-full", freePeopleSpaces: 4 });
  assert.deepEqual(getCenterAvailability(7, [
    { evacuation_center_id: 7, available_slots: 4, available_spaces: 5, family_slots: 8, people_spaces: 20 },
  ]), { status: "available", freePeopleSpaces: 5 });
});

test("availability uses the center's existing capacity when room totals are not public", () => {
  assert.deepEqual(getCenterAvailability(7, [
    { evacuation_center_id: 7, available_slots: 50, available_spaces: 35 },
  ], 375), { status: "almost-full", freePeopleSpaces: 35 });
});

test("long walks use the configured 60-minute threshold", () => {
  assert.equal(LONG_WALK_THRESHOLD_MINUTES, 60);
});

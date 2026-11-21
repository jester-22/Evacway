import assert from "node:assert/strict";
import test from "node:test";
import { getFreeCenterCapacity } from "./routeCard.js";

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

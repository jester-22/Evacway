import assert from "node:assert/strict";
import test from "node:test";
import { maskContactNumber, RESCUE_NEEDS, RESCUE_VULNERABILITY_FLAGS } from "./rescueRequest.js";

test("rescue form offers the requested quick needs and vulnerability flags", () => {
  assert.deepEqual(RESCUE_NEEDS, [
    "Trapped", "Injured", "Flooding", "Medical emergency", "Need evacuation",
  ]);
  assert.deepEqual(RESCUE_VULNERABILITY_FLAGS, ["PWD", "Senior", "Child", "Pregnant"]);
});

test("saved contact is masked while preserving only the first four and last three digits", () => {
  assert.equal(maskContactNumber("0912 345 6893"), "0912 *** *893");
  assert.equal(maskContactNumber(""), "No saved contact number");
  assert.equal(maskContactNumber("123456"), "******");
});

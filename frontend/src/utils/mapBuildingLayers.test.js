import assert from "node:assert/strict";
import test from "node:test";
import {
  BUILDING_MIN_ZOOM,
  ENTRANCES_MIN_ZOOM,
  ENTRANCE_LABEL_MIN_ZOOM,
} from "./mapBuildingLayers.js";

test("entrance points appear at building zoom, with labels one zoom level closer", () => {
  assert.equal(ENTRANCES_MIN_ZOOM, BUILDING_MIN_ZOOM);
  assert.equal(ENTRANCE_LABEL_MIN_ZOOM, BUILDING_MIN_ZOOM + 1);
});

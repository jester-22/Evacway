import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  isCenterMapped,
  resolveBuildingOperationalStatus,
  resolveCenterStructureMode,
} from "./utils.js";

test("resolveBuildingOperationalStatus prefers operational_status over occupancy status like Available/Full", () => {
  const geojsonBuilding = {
    id: 3,
    name: "Central Building",
    properties: {
      id: 3,
      name: "Central Building",
      status: "Available",
      operational_status: "open",
      is_mapped: true,
    },
  };
  assert.equal(resolveBuildingOperationalStatus(geojsonBuilding), "open");

  const fullOpenBuilding = {
    id: 4,
    status: "Full",
    properties: {
      status: "Full",
      operational_status: "open",
    },
  };
  assert.equal(resolveBuildingOperationalStatus(fullOpenBuilding), "open");

  const closedBuilding = {
    id: 5,
    properties: {
      status: "Available",
      operational_status: "closed",
    },
  };
  assert.equal(resolveBuildingOperationalStatus(closedBuilding), "closed");

  const roomOverride = {
    building_status: "under_repair",
  };
  assert.equal(resolveBuildingOperationalStatus(geojsonBuilding, roomOverride), "under_repair");

  // Unknown occupancy-only status defaults safely to open
  assert.equal(
    resolveBuildingOperationalStatus({ properties: { status: "Near Capacity" } }),
    "open"
  );
});

test("isCenterMapped detects geometry and has_map flags", () => {
  assert.equal(isCenterMapped({ has_map: true }), true);
  assert.equal(isCenterMapped({ has_map: false }), false);
  assert.equal(
    isCenterMapped({
      geometry: { type: "Polygon", coordinates: [[[124.98, 10.39]]] },
    }),
    true
  );
  assert.equal(isCenterMapped(null), false);
});

test("resolveCenterStructureMode maps structure_mode and center_type consistently", () => {
  assert.equal(resolveCenterStructureMode({ structure_mode: "open_area" }), "open_area");
  assert.equal(resolveCenterStructureMode({ structure_mode: "rooms_only" }), "rooms_only");
  assert.equal(resolveCenterStructureMode({ center_type: "private_property" }), "rooms_only");
  assert.equal(resolveCenterStructureMode({ center_type: "single_venue" }), "open_area");
  assert.equal(resolveCenterStructureMode({ center_type: "campus" }), "buildings_and_rooms");
});

test("CenterModals imports isCenterMapped and resolveBuildingOperationalStatus", () => {
  const source = readFileSync(new URL("./CenterModals.jsx", import.meta.url), "utf8");
  assert.match(source, /import\s+\{[^}]*\bisCenterMapped\b[^}]*\}\s+from\s+['"]\.\/utils['"]/);
  assert.match(
    source,
    /import\s+\{[^}]*\bresolveBuildingOperationalStatus\b[^}]*\}\s+from\s+['"]\.\/utils['"]/
  );
});

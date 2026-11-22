import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildConnectedRouteLngLat,
  findNearbyBlockedRoad,
} from "./navigationProximity.js";

test("buildConnectedRouteLngLat connects user start and exact entrance in [lng, lat] order", () => {
  const coords = buildConnectedRouteLngLat(
    [
      [10.391, 124.980],
      [10.392, 124.980],
    ],
    [10.3908, 124.9799],
    [10.3921, 124.9801]
  );

  assert.equal(coords.length, 4);
  assert.deepEqual(coords[0], [124.9799, 10.3908]);
  assert.deepEqual(coords[coords.length - 1], [124.9801, 10.3921]);
});

test("buildConnectedRouteLngLat deduplicates endpoints already touching the road", () => {
  const coords = buildConnectedRouteLngLat(
    [
      [10.391, 124.980],
      [10.392, 124.980],
    ],
    [10.391, 124.980],
    [10.392, 124.980]
  );

  assert.equal(coords.length, 2);
});

test("findNearbyBlockedRoad warns when approaching or entering a closed road", () => {
  const roads = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [124.9800, 10.3910],
            [124.9810, 10.3910],
          ],
        },
        properties: { is_closed: true, road_name: "Don Vicente Street" },
      },
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [124.9800, 10.3920],
            [124.9810, 10.3920],
          ],
        },
        properties: { is_closed: false, road_name: "Open Street" },
      },
    ],
  };

  // Directly on the closed road (~5m away)
  const onRoad = findNearbyBlockedRoad([10.39104, 124.9805], roads, []);
  assert.equal(onRoad?.severity, "on_road");
  assert.equal(onRoad?.roadName, "Don Vicente Street");

  // Approaching the closed road (~25m away)
  const approaching = findNearbyBlockedRoad([10.39122, 124.9805], roads, []);
  assert.equal(approaching?.severity, "approaching");
  assert.equal(approaching?.roadName, "Don Vicente Street");

  // Far away (> 35m) on open street
  const safe = findNearbyBlockedRoad([10.3920, 124.9805], roads, []);
  assert.equal(safe, null);
});

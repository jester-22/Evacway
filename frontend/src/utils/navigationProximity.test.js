import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildConnectedRouteLngLat,
  buildRoadLockedRouteLngLat,
  snapAndTrimRoutePolyline,
  evaluateOffRouteDebounce,
  isAcceptableGpsAccuracy,
  getValidMovementHeading,
  hasArrivedAtEntrance,
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

test("buildRoadLockedRouteLngLat keeps coordinates strictly on road geometry without off-road connectors", () => {
  const coords = buildRoadLockedRouteLngLat([
    [10.391, 124.980],
    [10.3915, 124.980],
    [10.392, 124.980],
  ]);

  assert.equal(coords.length, 3);
  assert.deepEqual(coords[0], [124.980, 10.391]);
  assert.deepEqual(coords[2], [124.980, 10.392]);
});

test("snapAndTrimRoutePolyline trims behind user and locks blue line to road centerline when within 20m", () => {
  const routePoints = [
    [10.3900, 124.9800],
    [10.3910, 124.9800],
    [10.3920, 124.9800],
  ];
  // User is halfway along first segment, drifted ~8m east into a house lot
  const driftedUser = [10.3905, 124.98007];
  const snap = snapAndTrimRoutePolyline(driftedUser, routePoints, { userHeading: 0 });

  assert.equal(snap.isOnRoute, true);
  assert.equal(snap.isOffRoute, false);
  assert.ok(snap.distanceToRoute > 5 && snap.distanceToRoute <= 20);
  // Snapped point stays strictly on longitude 124.9800 (the road centerline), not 124.98007
  assert.ok(Math.abs(snap.snappedPoint[1] - 124.9800) < 1e-6);
  assert.ok(Math.abs(snap.snappedPoint[0] - 10.3905) < 1e-4);
  assert.equal(snap.remainingLngLat.length, 3);
  assert.deepEqual(snap.remainingLngLat[0], [snap.snappedPoint[1], snap.snappedPoint[0]]);
  assert.deepEqual(snap.remainingLngLat[2], [124.9800, 10.3920]);
});

test("evaluateOffRouteDebounce requires > 25m off-route for at least 3 consecutive seconds", () => {
  // Within 20m: not off-route
  const onRoute = evaluateOffRouteDebounce({
    distanceToRoute: 14,
    nowMs: 1000,
    offRouteSinceMs: null,
  });
  assert.equal(onRoute.shouldTriggerReroute, false);
  assert.equal(onRoute.offRouteSinceMs, null);

  // First tick > 25m at t=1000ms: starts timer, does not reroute yet
  const tick1 = evaluateOffRouteDebounce({
    distanceToRoute: 32,
    nowMs: 1000,
    offRouteSinceMs: null,
  });
  assert.equal(tick1.isOffRoute, true);
  assert.equal(tick1.shouldTriggerReroute, false);
  assert.equal(tick1.offRouteSinceMs, 1000);

  // Second tick > 25m at t=2500ms (1.5s elapsed): still debouncing
  const tick2 = evaluateOffRouteDebounce({
    distanceToRoute: 34,
    nowMs: 2500,
    offRouteSinceMs: tick1.offRouteSinceMs,
  });
  assert.equal(tick2.shouldTriggerReroute, false);

  // Third tick > 25m at t=4100ms (3.1s elapsed): triggers reroute
  const tick3 = evaluateOffRouteDebounce({
    distanceToRoute: 35,
    nowMs: 4100,
    offRouteSinceMs: tick2.offRouteSinceMs,
  });
  assert.equal(tick3.shouldTriggerReroute, true);
});

test("isAcceptableGpsAccuracy filters out readings with accuracy > 25m", () => {
  assert.equal(isAcceptableGpsAccuracy(8), true);
  assert.equal(isAcceptableGpsAccuracy(25), true);
  assert.equal(isAcceptableGpsAccuracy(25.1), false);
  assert.equal(isAcceptableGpsAccuracy(65), false);
});

test("getValidMovementHeading returns heading only when speed > 1 m/s", () => {
  assert.equal(getValidMovementHeading({ heading: 90, speed: 0.4 }), null);
  assert.equal(getValidMovementHeading({ heading: 90, speed: 1.5 }), 90);
});

test("hasArrivedAtEntrance does not mark arrived when 25-30m away down the street and requires reaching entrance (<= 10m)", () => {
  const entrance = [10.3910, 124.9800];
  // User is ~28m south down the street (like in the screenshot)
  const stillWalkingOnStreet = [10.39075, 124.9800];
  assert.equal(
    hasArrivedAtEntrance({
      userLocation: stillWalkingOnStreet,
      entranceLatLng: entrance,
      remainingRouteMeters: 28,
    }),
    false
  );

  // User is within 10m straight-line across a fence, but still has 22m of route around the corner
  assert.equal(
    hasArrivedAtEntrance({
      userLocation: [10.39093, 124.9800],
      entranceLatLng: entrance,
      remainingRouteMeters: 22,
    }),
    false
  );

  // User has actually reached the entrance gate (~4m away, 4m remaining route)
  assert.equal(
    hasArrivedAtEntrance({
      userLocation: [10.39097, 124.9800],
      entranceLatLng: entrance,
      remainingRouteMeters: 4,
    }),
    true
  );
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

  // Inside a flood/landslide hazard zone polygon
  const hazardZones = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [124.9800, 10.3930],
              [124.9810, 10.3930],
              [124.9810, 10.3940],
              [124.9800, 10.3940],
              [124.9800, 10.3930],
            ],
          ],
        },
        properties: { name: "Subangdaku Flood Zone", hazard_type: "flood" },
      },
    ],
  };

  const inZone = findNearbyBlockedRoad([10.3935, 124.9805], roads, [], 35, hazardZones);
  assert.equal(inZone?.severity, "on_road");
  assert.equal(inZone?.isHazardZone, true);
  assert.equal(inZone?.roadName, "Subangdaku Flood Zone");
});

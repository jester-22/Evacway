// Run: npm test   (uses Node's built-in test runner, no extra dependency)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  closestPointOnSegment,
  snapToPolygonEdge,
  snapLngLatToPolygonEdge,
  lngLatToMercator,
  mercatorToLngLat,
} from "./polygonSnap.js";

// 100 x 100 px square, screen coords (y grows downward)
const SQUARE = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];
const TOL = 14;
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("click inside the polygon, near an edge, snaps onto that edge", () => {
  const r = snapToPolygonEdge({ x: 40, y: 8 }, SQUARE, TOL);
  assert.ok(r);
  close(r.x, 40);
  close(r.y, 0); // on the top edge, not at the click
  close(r.distance, 8);
  assert.equal(r.segmentIndex, 0);
});

test("click outside the polygon, near an edge, snaps onto that edge", () => {
  const r = snapToPolygonEdge({ x: 60, y: -10 }, SQUARE, TOL);
  assert.ok(r);
  close(r.x, 60);
  close(r.y, 0);
  close(r.distance, 10);
});

test("click near a vertex clamps t to the segment end (lands on the corner)", () => {
  // Beyond the top-right corner diagonally: projection onto both adjacent edges is clamped
  const r = snapToPolygonEdge({ x: 106, y: -6 }, SQUARE, TOL);
  assert.ok(r);
  close(r.x, 100);
  close(r.y, 0);
  close(r.distance, Math.hypot(6, 6));
  assert.ok(r.t === 0 || r.t === 1);
});

test("click beyond the tolerance is rejected (outside and deep inside)", () => {
  assert.equal(snapToPolygonEdge({ x: 50, y: -20 }, SQUARE, TOL), null);
  assert.equal(snapToPolygonEdge({ x: 50, y: 50 }, SQUARE, TOL), null); // centre of polygon
});

test("explicit closing vertex and degenerate segments are handled", () => {
  const closed = [...SQUARE, { ...SQUARE[0] }];
  const r = snapToPolygonEdge({ x: 5, y: 50 }, closed, TOL);
  assert.ok(r);
  close(r.x, 0);
  close(r.y, 50);
});

test("closestPointOnSegment clamps t to [0, 1]", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 0 };
  assert.equal(closestPointOnSegment({ x: -5, y: 3 }, a, b).t, 0);
  assert.equal(closestPointOnSegment({ x: 25, y: 3 }, a, b).t, 1);
  close(closestPointOnSegment({ x: 4, y: 3 }, a, b).t, 0.4);
});

test("mercator round-trip", () => {
  const p = { lng: 125.0, lat: 10.38 };
  const back = mercatorToLngLat(lngLatToMercator(p));
  close(back.lng, p.lng, 1e-9);
  close(back.lat, p.lat, 1e-9);
});

test("snapLngLatToPolygonEdge uses ground meters, not raw degrees", () => {
  // ~100 m square near Sogod (lat ~10.4). 0.0009 deg lat ~ 100 m.
  const poly = [
    { lng: 125.0, lat: 10.4 },
    { lng: 125.0009, lat: 10.4 },
    { lng: 125.0009, lat: 10.4009 },
    { lng: 125.0, lat: 10.4009 },
  ];
  // 0.00005 deg east of the east edge: ~5.5 m on the ground
  const r = snapLngLatToPolygonEdge({ lng: 125.00095, lat: 10.40045 }, poly, 15);
  assert.ok(r);
  close(r.lng, 125.0009, 1e-9);
  close(r.lat, 10.40045, 1e-7);
  assert.ok(r.distanceMeters > 5 && r.distanceMeters < 6, String(r.distanceMeters));
  // 0.0002 deg away (~22 m) is beyond 15 m
  assert.equal(snapLngLatToPolygonEdge({ lng: 125.0011, lat: 10.40045 }, poly, 15), null);
});


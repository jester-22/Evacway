import assert from "node:assert/strict";
import test from "node:test";
import {
  ROUTE_ARROW_ANIMATION_INTERVAL_MS,
  shouldUpdateRouteArrowAnimation,
} from "./routeArrowAnimation.js";

test("route arrows update immediately, then at most ten times per second", () => {
  assert.equal(ROUTE_ARROW_ANIMATION_INTERVAL_MS, 100);
  assert.equal(shouldUpdateRouteArrowAnimation(0, null), true);
  assert.equal(shouldUpdateRouteArrowAnimation(99, 0), false);
  assert.equal(shouldUpdateRouteArrowAnimation(100, 0), true);
});

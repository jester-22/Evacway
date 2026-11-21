import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPublicMapLayerVisibility,
  simplifyPublicBaseMap,
} from "./publicMapLayers.js";

function fakeMap(layerIds, styleLayers = []) {
  const visibility = new Map();
  const existing = new Set(layerIds);
  return {
    visibility,
    getStyle: () => ({ layers: styleLayers }),
    getLayer: (id) => existing.has(id),
    getLayoutProperty: (id, property) => visibility.get(`${id}:${property}`),
    setLayoutProperty: (id, property, value) => visibility.set(`${id}:${property}`, value),
  };
}

test("basemap simplification hides POI, transit, and airport labels only", () => {
  const map = fakeMap([], [
    { id: "poi-label", type: "symbol" },
    { id: "transit-label", type: "symbol" },
    { id: "airport-label", type: "symbol" },
    { id: "place-label", type: "symbol" },
    { id: "poi-background", type: "fill" },
  ]);

  simplifyPublicBaseMap(map);

  assert.equal(map.visibility.get("poi-label:visibility"), "none");
  assert.equal(map.visibility.get("transit-label:visibility"), "none");
  assert.equal(map.visibility.get("airport-label:visibility"), "none");
  assert.equal(map.visibility.has("place-label:visibility"), false);
  assert.equal(map.visibility.has("poi-background:visibility"), false);
});

test("layer controls change map visibility and preserve center marker elements", () => {
  const map = fakeMap([
    "evacuation-centers-fill",
    "resident-hazard-fill",
    "roads-closed-display-layer",
    "sogod-boundary-line",
  ]);
  const markerElement = { style: {} };
  const centerMarker = { getElement: () => markerElement };

  applyPublicMapLayerVisibility(map, {
    centers: false,
    hazards: false,
    boundaries: true,
  }, [centerMarker]);

  assert.equal(map.visibility.get("evacuation-centers-fill:visibility"), "none");
  assert.equal(map.visibility.get("resident-hazard-fill:visibility"), "none");
  assert.equal(map.visibility.get("roads-closed-display-layer:visibility"), "none");
  assert.equal(map.visibility.get("sogod-boundary-line:visibility"), "visible");
  assert.equal(markerElement.style.visibility, "hidden");

  applyPublicMapLayerVisibility(map, {
    centers: true,
    hazards: true,
    boundaries: true,
  }, [centerMarker]);
  assert.equal(markerElement.style.visibility, "");
});

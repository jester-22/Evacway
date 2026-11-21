import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOfflineTileUrl,
  getSogodOfflineTileCoordinates,
  getBasemapStyleUrl,
  DEFAULT_PUBLIC_MAP_STYLE,
  getOfflineMapDownloadProgress,
  isWithinSogodTileBounds,
  parseOpenFreeMapTileUrl,
  OFFLINE_MAP_MAX_TILES,
  OFFLINE_MAP_MAX_ZOOM,
  OFFLINE_MAP_MIN_ZOOM,
} from "./offlineMap.js";

test("Sogod offline tile download stays inside the provider's tile cap and zoom range", () => {
  const tiles = getSogodOfflineTileCoordinates();

  assert.ok(tiles.length > 0);
  assert.ok(tiles.length <= OFFLINE_MAP_MAX_TILES);
  assert.ok(tiles.every(({ zoom }) => zoom >= OFFLINE_MAP_MIN_ZOOM && zoom <= OFFLINE_MAP_MAX_ZOOM));
  assert.ok(tiles.every(({ zoom, x, y }) => isWithinSogodTileBounds(zoom, x, y)));
});

test("tile requests use the bounded public proxy path", () => {
  assert.equal(buildOfflineTileUrl({ zoom: 12, x: 3539, y: 2041 }), "/api/public/offline-map/tiles/12/3539/2041");
  assert.equal(isWithinSogodTileBounds(10, 882, 510), false);
});

test("versioned OpenFreeMap URLs are proxied only inside the Sogod range", () => {
  assert.deepEqual(
    parseOpenFreeMapTileUrl("https://tiles.openfreemap.org/planet/20261115_080022_pt/14/13880/7716.pbf"),
    { zoom: 14, x: 13880, y: 7716 },
  );
  assert.equal(parseOpenFreeMapTileUrl("https://tiles.openfreemap.org/planet/14/0/0.pbf"), null);
  assert.equal(parseOpenFreeMapTileUrl("https://tiles.openfreemap.org/planet/15/13880/7716.pbf"), null);
});

test("online basemaps use Mapbox and offline basemaps use cached OpenFreeMap styles", () => {
  assert.equal(
    getBasemapStyleUrl("street", true, "configured-token"),
    "mapbox://styles/mapbox/streets-v12",
  );
  assert.equal(
    getBasemapStyleUrl("bright", true, "configured-token"),
    "mapbox://styles/mapbox/satellite-streets-v12",
  );
  assert.equal(
    getBasemapStyleUrl("street", false, "configured-token"),
    "https://tiles.openfreemap.org/styles/liberty",
  );
  assert.equal(
    getBasemapStyleUrl("bright", false, "configured-token"),
    "https://tiles.openfreemap.org/styles/bright",
  );
  assert.equal(
    getBasemapStyleUrl("street", true, ""),
    "https://tiles.openfreemap.org/styles/liberty",
  );
});

test("the default public map style is satellite when online", () => {
  assert.equal(
    getBasemapStyleUrl(DEFAULT_PUBLIC_MAP_STYLE, true, "configured-token"),
    "mapbox://styles/mapbox/satellite-streets-v12",
  );
});

test("offline map download progress is clamped to the valid fill range", () => {
  assert.equal(getOfflineMapDownloadProgress(0, 105), 0);
  assert.equal(getOfflineMapDownloadProgress(21, 105), 20);
  assert.equal(getOfflineMapDownloadProgress(106, 105), 100);
  assert.equal(getOfflineMapDownloadProgress(0, 0), 0);
});

export const SOGOD_OFFLINE_BOUNDS = Object.freeze({
  west: 124.912,
  south: 10.368,
  east: 125.078,
  north: 10.525,
});

export const OFFLINE_MAP_MIN_ZOOM = 11;
export const OFFLINE_MAP_MAX_ZOOM = 14;
export const OFFLINE_MAP_MAX_TILES = 3000;
export const OFFLINE_MAP_MAX_BYTES = 50 * 1024 * 1024;
export const OPENFREEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
export const OPENFREEMAP_ALTERNATE_STYLE_URL = "https://tiles.openfreemap.org/styles/bright";
export const MAPBOX_STREET_STYLE_URL = "mapbox://styles/mapbox/light-v11";
export const MAPBOX_SATELLITE_STYLE_URL = "mapbox://styles/mapbox/satellite-streets-v12";

export function getBasemapStyleUrl(style, online, mapboxAccessToken) {
  if (online && mapboxAccessToken) {
    return style === "bright" ? MAPBOX_SATELLITE_STYLE_URL : MAPBOX_STREET_STYLE_URL;
  }
  return style === "bright" ? OPENFREEMAP_ALTERNATE_STYLE_URL : OPENFREEMAP_STYLE_URL;
}

export function getOfflineMapDownloadProgress(completed, total) {
  if (!Number.isFinite(completed) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((completed / total) * 100)));
}

export function longitudeToTileX(longitude, zoom) {
  return Math.floor(((longitude + 180) / 360) * (2 ** zoom));
}

export function latitudeToTileY(latitude, zoom) {
  const clampedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const radians = (clampedLatitude * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * (2 ** zoom)
  );
}

export function getSogodOfflineTileCoordinates(
  bounds = SOGOD_OFFLINE_BOUNDS,
  minZoom = OFFLINE_MAP_MIN_ZOOM,
  maxZoom = OFFLINE_MAP_MAX_ZOOM,
) {
  const tiles = [];
  for (let zoom = minZoom; zoom <= maxZoom; zoom += 1) {
    const minX = longitudeToTileX(bounds.west, zoom);
    const maxX = longitudeToTileX(bounds.east, zoom);
    const minY = latitudeToTileY(bounds.north, zoom);
    const maxY = latitudeToTileY(bounds.south, zoom);
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        tiles.push({ zoom, x, y });
      }
    }
  }

  if (tiles.length > OFFLINE_MAP_MAX_TILES) {
    throw new RangeError("The selected Sogod map area exceeds the offline tile limit.");
  }
  return tiles;
}

export function buildOfflineTileUrl({ zoom, x, y }) {
  return `/api/public/offline-map/tiles/${zoom}/${x}/${y}`;
}

export function parseOpenFreeMapTileUrl(value) {
  try {
    const url = new URL(value, "https://tiles.openfreemap.org");
    if (url.hostname !== "tiles.openfreemap.org") return null;
    const match = url.pathname.match(/^\/planet\/(?:[A-Za-z0-9_-]+\/)?(\d+)\/(\d+)\/(\d+)\.pbf$/);
    if (!match) return null;
    const [, zoom, x, y] = match.map(Number);
    if (zoom < OFFLINE_MAP_MIN_ZOOM || zoom > OFFLINE_MAP_MAX_ZOOM
      || !isWithinSogodTileBounds(zoom, x, y)) return null;
    return { zoom, x, y };
  } catch {
    return null;
  }
}

export function isWithinSogodTileBounds(zoom, x, y) {
  if (!Number.isInteger(zoom) || zoom < 0 || zoom > 18) return false;
  const minX = longitudeToTileX(SOGOD_OFFLINE_BOUNDS.west, zoom);
  const maxX = longitudeToTileX(SOGOD_OFFLINE_BOUNDS.east, zoom);
  const minY = latitudeToTileY(SOGOD_OFFLINE_BOUNDS.north, zoom);
  const maxY = latitudeToTileY(SOGOD_OFFLINE_BOUNDS.south, zoom);
  return x >= minX && x <= maxX && y >= minY && y <= maxY;
}

/**
 * Polygon edge snapping (pure functions, no map dependency).
 *
 * All geometry is done in a single planar space ({ x, y }): either screen pixels
 * (map.project / map.unproject) or Web Mercator meters. Never in raw lng/lat degrees.
 */

/**
 * Closest point to `p` on segment a-b, with t clamped to [0, 1].
 * @returns {{ x: number, y: number, t: number, distance: number }}
 */
export function closestPointOnSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const x = a.x + t * dx;
  const y = a.y + t * dy;
  return { x, y, t, distance: Math.hypot(p.x - x, p.y - y) };
}

/**
 * Snaps `point` to the closest point on the closed polygon outline.
 * Inside/outside doesn't matter: only distance to the outline counts.
 *
 * @param {{x:number,y:number}} point
 * @param {Array<{x:number,y:number}>} polygon  ring vertices (closing vertex optional)
 * @param {number} tolerance  max distance (same units as point); Infinity = always snap
 * @returns {{ x, y, t, distance, segmentIndex } | null}  null when beyond tolerance
 */
export function snapToPolygonEdge(point, polygon, tolerance = Infinity) {
  if (!point || !Array.isArray(polygon) || polygon.length < 2) return null;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;

  let best = null;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    if (a.x === b.x && a.y === b.y) continue; // skip zero-length (e.g. explicit closing vertex)
    const c = closestPointOnSegment(point, a, b);
    if (!best || c.distance < best.distance) best = { ...c, segmentIndex: i };
  }
  if (!best || best.distance > tolerance) return null;
  return best;
}

/* ---- Web Mercator helpers (for snapping without a map instance) ---- */

const EARTH_RADIUS = 6378137;

export function lngLatToMercator(p) {
  const lng = Number(p?.lng ?? p?.longitude);
  const lat = Number(p?.lat ?? p?.latitude);
  return {
    x: (EARTH_RADIUS * lng * Math.PI) / 180,
    y: EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)),
  };
}

export function mercatorToLngLat(m) {
  return {
    lng: (m.x / EARTH_RADIUS) * (180 / Math.PI),
    lat: (2 * Math.atan(Math.exp(m.y / EARTH_RADIUS)) - Math.PI / 2) * (180 / Math.PI),
  };
}

/**
 * Snaps a lng/lat point onto a lng/lat polygon outline using Web Mercator.
 * Straight lines in Mercator are straight on the (unpitched) map, so the result
 * sits exactly on the rendered outline at every zoom level.
 *
 * @param toleranceMeters  ground distance; Infinity = always snap
 * @returns {{ lng: number, lat: number, distanceMeters: number } | null}
 */
export function snapLngLatToPolygonEdge(point, polygon, toleranceMeters = Infinity) {
  if (!point || !Array.isArray(polygon) || polygon.length < 2) return null;
  const p = lngLatToMercator(point);
  const ring = polygon.map(lngLatToMercator);
  const snapped = snapToPolygonEdge(p, ring, Infinity);
  if (!snapped) return null;
  // Mercator stretches distances by 1/cos(lat); convert back to ground meters
  const lat = Number(point.lat ?? point.latitude);
  const distanceMeters = snapped.distance * Math.cos((lat * Math.PI) / 180);
  if (distanceMeters > toleranceMeters) return null;
  return { ...mercatorToLngLat(snapped), distanceMeters };
}


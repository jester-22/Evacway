function haversineMeters(first, second) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(second[0] - first[0]);
  const dLng = toRad(second[1] - first[1]);
  const lat1 = toRad(first[0]);
  const lat2 = toRad(second[0]);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distanceToSegmentMeters(pointLatLng, segStartLatLng, segEndLatLng) {
  const [latP, lngP] = pointLatLng;
  const [latA, lngA] = segStartLatLng;
  const [latB, lngB] = segEndLatLng;

  const midLat = ((latA + latB) / 2) * (Math.PI / 180);
  const cosLat = Math.cos(midLat);

  const xP = lngP * cosLat;
  const yP = latP;
  const xA = lngA * cosLat;
  const yA = latA;
  const xB = lngB * cosLat;
  const yB = latB;

  const dx = xB - xA;
  const dy = yB - yA;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return haversineMeters(pointLatLng, segStartLatLng);
  }

  let t = ((xP - xA) * dx + (yP - yA) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const snapped = [yA + t * dy, (xA + t * dx) / cosLat];
  return haversineMeters(pointLatLng, snapped);
}

function appendIfDistinct(list, lngLat) {
  if (!Array.isArray(lngLat) || lngLat.length < 2) return;
  const [lng, lat] = lngLat;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
  const prev = list[list.length - 1];
  if (prev && haversineMeters([prev[1], prev[0]], [lat, lng]) < 0.5) return;
  list.push([lng, lat]);
}

/**
 * Builds a continuous GeoJSON [lng, lat] polyline connecting:
 *   startLatLng (user location) -> road routePoints ([lat, lng]) -> entranceLatLng (exact entrance).
 */
export function buildConnectedRouteLngLat(routePoints, startLatLng = null, entranceLatLng = null) {
  const coords = [];

  if (Array.isArray(startLatLng) && startLatLng.length >= 2) {
    const sLat = Number(startLatLng[0]);
    const sLng = Number(startLatLng[1]);
    if (Number.isFinite(sLat) && Number.isFinite(sLng)) {
      appendIfDistinct(coords, [sLng, sLat]);
    }
  }

  if (Array.isArray(routePoints)) {
    for (const pt of routePoints) {
      if (!Array.isArray(pt) || pt.length < 2) continue;
      const lat = Number(pt[0]);
      const lng = Number(pt[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        appendIfDistinct(coords, [lng, lat]);
      }
    }
  }

  if (Array.isArray(entranceLatLng) && entranceLatLng.length >= 2) {
    const eLat = Number(entranceLatLng[0]);
    const eLng = Number(entranceLatLng[1]);
    if (Number.isFinite(eLat) && Number.isFinite(eLng)) {
      appendIfDistinct(coords, [eLng, eLat]);
    }
  }

  return coords;
}

export const BLOCKED_ROAD_ON_THRESHOLD_METERS = 15;
export const BLOCKED_ROAD_WARN_THRESHOLD_METERS = 35;
export const BLOCKED_ROAD_CLEAR_THRESHOLD_METERS = 45;

/**
 * Finds the nearest closed road segment or validated road-blocking hazard to userLatLng.
 * Returns null if none are within maxDistanceMeters.
 */
export function findNearbyBlockedRoad(
  userLatLng,
  roadsGeoJSON,
  validatedHazards = [],
  maxDistanceMeters = BLOCKED_ROAD_WARN_THRESHOLD_METERS
) {
  if (!Array.isArray(userLatLng) || userLatLng.length < 2) return null;
  const uLat = Number(userLatLng[0]);
  const uLng = Number(userLatLng[1]);
  if (!Number.isFinite(uLat) || !Number.isFinite(uLng)) return null;
  const userPt = [uLat, uLng];

  let closest = null;

  const features = Array.isArray(roadsGeoJSON?.features) ? roadsGeoJSON.features : [];
  for (const feat of features) {
    if (!feat?.properties?.is_closed) continue;
    const geomType = feat.geometry?.type;
    const rawCoords = feat.geometry?.coordinates;
    if (!Array.isArray(rawCoords)) continue;

    const lines =
      geomType === "MultiLineString"
        ? rawCoords
        : geomType === "LineString"
          ? [rawCoords]
          : [];

    for (const line of lines) {
      if (!Array.isArray(line) || line.length < 2) continue;
      for (let i = 0; i < line.length - 1; i++) {
        const a = line[i];
        const b = line[i + 1];
        if (!Array.isArray(a) || !Array.isArray(b)) continue;
        const dist = distanceToSegmentMeters(userPt, [a[1], a[0]], [b[1], b[0]]);
        if (dist <= maxDistanceMeters && (!closest || dist < closest.distanceMeters)) {
          closest = {
            distanceMeters: Math.round(dist),
            roadName: feat.properties?.road_name || "Blocked road",
            severity: dist <= BLOCKED_ROAD_ON_THRESHOLD_METERS ? "on_road" : "approaching",
          };
        }
      }
    }
  }

  if (Array.isArray(validatedHazards)) {
    for (const report of validatedHazards) {
      if (!report) continue;
      const typeText = `${report.report_type || ""} ${report.hazard_type || ""}`;
      const isBlockage =
        report.blocks_road === true ||
        report.road_segment_id != null ||
        (Array.isArray(report.closed_roads) && report.closed_roads.length > 0) ||
        /block|closed|obstruct|flood|landslide/i.test(typeText);
      if (!isBlockage) continue;

      const rLat = Number(report.latitude ?? report.lat);
      const rLng = Number(report.longitude ?? report.lng);
      if (!Number.isFinite(rLat) || !Number.isFinite(rLng)) continue;

      const dist = haversineMeters(userPt, [rLat, rLng]);
      if (dist <= maxDistanceMeters && (!closest || dist < closest.distanceMeters)) {
        const label =
          report.road_name ||
          (Array.isArray(report.closed_roads) && report.closed_roads[0]) ||
          report.report_type ||
          "Blocked road";
        closest = {
          distanceMeters: Math.round(dist),
          roadName: label,
          severity: dist <= BLOCKED_ROAD_ON_THRESHOLD_METERS ? "on_road" : "approaching",
        };
      }
    }
  }

  return closest;
}

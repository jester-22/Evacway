export function haversineMeters(first, second) {
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

export function calculateBearingDegrees(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const dLon = (lon2 - lon1) * toRad;
  const y = Math.sin(dLon) * Math.cos(lat2 * toRad);
  const x =
    Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) -
    Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos(dLon);
  return (Math.atan2(y, x) * toDeg + 360) % 360;
}

export function angularDifferenceDegrees(angleA, angleB) {
  const diff = Math.abs(((angleA - angleB) % 360) + 360) % 360;
  return diff > 180 ? 360 - diff : diff;
}

export function projectPointToSegmentMeters(pointLatLng, segStartLatLng, segEndLatLng) {
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
    return {
      snapped: [latA, lngA],
      distanceMeters: haversineMeters(pointLatLng, segStartLatLng),
      t: 0,
    };
  }

  let t = ((xP - xA) * dx + (yP - yA) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const snapped = [yA + t * dy, (xA + t * dx) / cosLat];
  return {
    snapped,
    distanceMeters: haversineMeters(pointLatLng, snapped),
    t,
  };
}

function distanceToSegmentMeters(pointLatLng, segStartLatLng, segEndLatLng) {
  return projectPointToSegmentMeters(pointLatLng, segStartLatLng, segEndLatLng).distanceMeters;
}

function appendIfDistinct(list, lngLat) {
  if (!Array.isArray(lngLat) || lngLat.length < 2) return;
  const [lng, lat] = lngLat;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
  const prev = list[list.length - 1];
  if (prev && haversineMeters([prev[1], prev[0]], [lat, lng]) < 0.5) return;
  list.push([lng, lat]);
}

export const ON_ROUTE_SNAP_THRESHOLD_METERS = 20;
export const OFF_ROUTE_REROUTE_THRESHOLD_METERS = 25;
export const OFF_ROUTE_DEBOUNCE_MS = 3000;
export const MAX_ACCEPTABLE_GPS_ACCURACY_METERS = 25;
export const MIN_HEADING_SPEED_MPS = 1.0;
export const ENTRANCE_ARRIVAL_RADIUS_METERS = 10;
export const MAX_REMAINING_ROUTE_FOR_ARRIVAL_METERS = 12;

/**
 * Checks whether the user has truly reached the destination entrance.
 * Requires the user to be within 10m of the entrance coordinate AND have <= 12m
 * of walking route remaining so arrival never triggers early down the street.
 */
export function hasArrivedAtEntrance({
  userLocation,
  entranceLatLng,
  remainingRouteMeters = null,
  arrivalRadiusMeters = ENTRANCE_ARRIVAL_RADIUS_METERS,
  maxRemainingRouteMeters = MAX_REMAINING_ROUTE_FOR_ARRIVAL_METERS,
}) {
  if (
    !Array.isArray(userLocation) ||
    userLocation.length < 2 ||
    !Array.isArray(entranceLatLng) ||
    entranceLatLng.length < 2
  ) {
    return false;
  }
  const uLat = Number(userLocation[0]);
  const uLng = Number(userLocation[1]);
  const eLat = Number(entranceLatLng[0]);
  const eLng = Number(entranceLatLng[1]);
  if (!Number.isFinite(uLat) || !Number.isFinite(uLng) || !Number.isFinite(eLat) || !Number.isFinite(eLng)) {
    return false;
  }

  const directDistance = haversineMeters([uLat, uLng], [eLat, eLng]);
  if (directDistance > arrivalRadiusMeters) {
    return false;
  }

  if (remainingRouteMeters != null && Number.isFinite(Number(remainingRouteMeters))) {
    if (Number(remainingRouteMeters) > maxRemainingRouteMeters) {
      return false;
    }
  }

  return true;
}

/**
 * Filters out noisy GPS updates with accuracy worse than 25 meters.
 */
export function isAcceptableGpsAccuracy(accuracyMeters, maxAccuracyMeters = MAX_ACCEPTABLE_GPS_ACCURACY_METERS) {
  if (accuracyMeters == null || accuracyMeters === "") return true;
  const acc = Number(accuracyMeters);
  if (!Number.isFinite(acc) || acc < 0) return false;
  return acc <= maxAccuracyMeters;
}

/**
 * Extracts a reliable movement bearing (0-360) only when the user is moving (> 1 m/s).
 */
export function getValidMovementHeading(coords, fallbackHeading = null) {
  if (!coords) return fallbackHeading;
  const heading = Number(coords.heading);
  const speed = Number(coords.speed);
  if (
    Number.isFinite(heading) &&
    heading >= 0 &&
    heading <= 360 &&
    Number.isFinite(speed) &&
    speed >= MIN_HEADING_SPEED_MPS
  ) {
    return heading % 360;
  }
  return fallbackHeading;
}

/**
 * Computes the nearest point and perpendicular distance from userLocation ([lat, lng])
 * to an active route polyline ([[lat, lng], ...]), slicing the polyline into
 * walkedPoints and remainingPoints locked strictly to the road centerline.
 *
 * When userHeading (0-360) is provided, segments aligned with the user's travel
 * direction receive a slight tie-breaker preference at intersections so the
 * snapped point does not jump onto a perpendicular cross-segment.
 */
export function snapAndTrimRoutePolyline(userLocation, routePoints, options = {}) {
  const { userHeading = null, entranceLatLng = null } = options;

  if (!Array.isArray(routePoints) || routePoints.length === 0) {
    return {
      snappedPoint: userLocation,
      distanceToRoute: Infinity,
      segmentIndex: 0,
      t: 0,
      isOnRoute: false,
      isOffRoute: true,
      shouldReroute: true,
      walkedPoints: [],
      walkedLngLat: [],
      remainingPoints: [],
      remainingLngLat: [],
    };
  }

  if (routePoints.length === 1) {
    const onlyPt = routePoints[0];
    const dist = haversineMeters(userLocation, onlyPt);
    return {
      snappedPoint: onlyPt,
      distanceToRoute: dist,
      segmentIndex: 0,
      t: 0,
      isOnRoute: dist <= ON_ROUTE_SNAP_THRESHOLD_METERS,
      isOffRoute: dist > OFF_ROUTE_REROUTE_THRESHOLD_METERS,
      shouldReroute: dist > OFF_ROUTE_REROUTE_THRESHOLD_METERS,
      walkedPoints: [onlyPt],
      walkedLngLat: [[onlyPt[1], onlyPt[0]]],
      remainingPoints: [onlyPt],
      remainingLngLat: [[onlyPt[1], onlyPt[0]]],
    };
  }

  let bestScore = Infinity;
  let minDistance = Infinity;
  let bestSnapped = routePoints[0];
  let bestSegmentIndex = 0;
  let bestT = 0;

  for (let i = 0; i < routePoints.length - 1; i++) {
    const a = routePoints[i];
    const b = routePoints[i + 1];
    const proj = projectPointToSegmentMeters(userLocation, a, b);

    // Optional heading tie-breaker within 8m at corners/intersections
    let headingPenalty = 0;
    if (
      userHeading != null &&
      Number.isFinite(userHeading) &&
      haversineMeters(a, b) >= 1.0
    ) {
      const segBearing = calculateBearingDegrees(a[0], a[1], b[0], b[1]);
      const angleDiff = angularDifferenceDegrees(userHeading, segBearing);
      if (angleDiff > 90) {
        headingPenalty = Math.min(6, ((angleDiff - 90) / 90) * 6);
      }
    }

    const score = proj.distanceMeters + headingPenalty;
    if (score < bestScore) {
      bestScore = score;
      minDistance = proj.distanceMeters;
      bestSnapped = proj.snapped;
      bestSegmentIndex = i;
      bestT = proj.t;
    }
  }

  const walkedPoints = [...routePoints.slice(0, bestSegmentIndex + 1), bestSnapped];
  const walkedLngLat = buildRoadLockedRouteLngLat(walkedPoints);
  const remainingPoints = [bestSnapped, ...routePoints.slice(bestSegmentIndex + 1)];
  const remainingLngLat = buildRoadLockedRouteLngLat(remainingPoints, entranceLatLng);

  return {
    snappedPoint: bestSnapped,
    distanceToRoute: minDistance,
    segmentIndex: bestSegmentIndex,
    t: bestT,
    isOnRoute: minDistance <= ON_ROUTE_SNAP_THRESHOLD_METERS,
    isOffRoute: minDistance > OFF_ROUTE_REROUTE_THRESHOLD_METERS,
    shouldReroute: minDistance > OFF_ROUTE_REROUTE_THRESHOLD_METERS,
    walkedPoints,
    walkedLngLat,
    remainingPoints,
    remainingLngLat,
  };
}

/**
 * Evaluates whether an off-route user should trigger a debounced full route recalculation.
 * Requires the user to remain > 25 meters off-route for at least 3 consecutive seconds.
 */
export function evaluateOffRouteDebounce({
  distanceToRoute,
  nowMs,
  offRouteSinceMs,
  thresholdMeters = OFF_ROUTE_REROUTE_THRESHOLD_METERS,
  debounceMs = OFF_ROUTE_DEBOUNCE_MS,
}) {
  if (!Number.isFinite(distanceToRoute) || distanceToRoute <= thresholdMeters) {
    return {
      isOffRoute: false,
      offRouteSinceMs: null,
      shouldTriggerReroute: false,
    };
  }

  const startedAt = offRouteSinceMs != null ? offRouteSinceMs : nowMs;
  const elapsed = Math.max(0, nowMs - startedAt);
  return {
    isOffRoute: true,
    offRouteSinceMs: startedAt,
    shouldTriggerReroute: elapsed >= debounceMs,
  };
}

/**
 * Builds a GeoJSON [lng, lat] LineString strictly locked to the road network coordinates
 * without prepending raw off-road GPS coordinates. When `entranceLatLng` ([lat, lng]) is
 * provided within 25m of the road-snapped endpoint, appends the short perpendicular step
 * directly into the entrance pin so the line leads right to the gate without overshooting.
 */
export function buildRoadLockedRouteLngLat(routePoints, entranceLatLng = null) {
  const coords = [];
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
      if (coords.length === 0) {
        appendIfDistinct(coords, [eLng, eLat]);
      } else {
        const lastLngLat = coords[coords.length - 1];
        const distToEntrance = haversineMeters([lastLngLat[1], lastLngLat[0]], [eLat, eLng]);
        if (distToEntrance <= 25) {
          appendIfDistinct(coords, [eLng, eLat]);
        }
      }
    }
  }

  return coords;
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

function isPointInRing(latLng, ringLngLat) {
  if (!Array.isArray(ringLngLat) || ringLngLat.length < 3) return false;
  const [lat, lng] = latLng;
  let inside = false;
  for (let i = 0, j = ringLngLat.length - 1; i < ringLngLat.length; j = i++) {
    const xi = Number(ringLngLat[i]?.[0]);
    const yi = Number(ringLngLat[i]?.[1]);
    const xj = Number(ringLngLat[j]?.[0]);
    const yj = Number(ringLngLat[j]?.[1]);
    if (!Number.isFinite(xi) || !Number.isFinite(yi) || !Number.isFinite(xj) || !Number.isFinite(yj)) {
      continue;
    }
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distanceToPolygonRingsMeters(userPt, polygonRings) {
  if (!Array.isArray(polygonRings) || polygonRings.length === 0) return Infinity;
  const outerRing = polygonRings[0];
  let inside = isPointInRing(userPt, outerRing);
  if (inside && polygonRings.length > 1) {
    for (let h = 1; h < polygonRings.length; h++) {
      if (isPointInRing(userPt, polygonRings[h])) {
        inside = false;
        break;
      }
    }
  }
  if (inside) return 0;

  let minDist = Infinity;
  for (const ring of polygonRings) {
    if (!Array.isArray(ring) || ring.length < 2) continue;
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i];
      const b = ring[i + 1];
      if (!Array.isArray(a) || !Array.isArray(b)) continue;
      const d = distanceToSegmentMeters(userPt, [a[1], a[0]], [b[1], b[0]]);
      if (d < minDist) minDist = d;
    }
  }
  return minDist;
}

/**
 * Finds the nearest closed road segment, validated hazard report, or hazard zone polygon to userLatLng.
 * Returns null if none are within maxDistanceMeters.
 */
export function findNearbyBlockedRoad(
  userLatLng,
  roadsGeoJSON,
  validatedHazards = [],
  maxDistanceMeters = BLOCKED_ROAD_WARN_THRESHOLD_METERS,
  hazardZonesGeoJSON = null
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
          isHazardZone: false,
        };
      }
    }
  }

  const zoneFeatures = Array.isArray(hazardZonesGeoJSON?.features)
    ? hazardZonesGeoJSON.features
    : Array.isArray(hazardZonesGeoJSON)
      ? hazardZonesGeoJSON
      : [];

  for (const zone of zoneFeatures) {
    const geom = zone?.geometry;
    if (!geom || !Array.isArray(geom.coordinates)) continue;
    const polygons =
      geom.type === "MultiPolygon"
        ? geom.coordinates
        : geom.type === "Polygon"
          ? [geom.coordinates]
          : [];

    for (const polyRings of polygons) {
      const dist = distanceToPolygonRingsMeters(userPt, polyRings);
      if (dist <= maxDistanceMeters && (!closest || dist < closest.distanceMeters)) {
        const props = zone.properties || {};
        const hazardType = props.hazard_type || props.type || "Hazard";
        const zoneName = props.name || `${hazardType} hazard zone`;
        closest = {
          distanceMeters: Math.round(dist),
          roadName: zoneName,
          severity: dist <= BLOCKED_ROAD_ON_THRESHOLD_METERS ? "on_road" : "approaching",
          isHazardZone: true,
        };
      }
    }
  }

  return closest;
}

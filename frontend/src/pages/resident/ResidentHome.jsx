import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

import { Link, useNavigate } from "react-router-dom";
import { api, BASE_URL } from "../../services/api";
import HazardReportModal from "../../components/HazardReportModal/HazardReportModal";
import RescueAlertModal from "../../components/RescueAlertModal/RescueAlertModal";
import { MapLegend } from "../../components/DashboardMap/MapOverlays";
import { getCenterCoordinates } from "../../utils/mapCenterCoordinates";
import { createReportPopup } from "../../components/mapReports/mapReports";
import {
  setOrUpdateSelectedLocationMarker,
  setOrUpdateAccuracyCircle,
  removeAccuracyCircle,
  highlightAndOpenSavedReport,
} from "../../utils/mapLocationIndicators";

import { useHazardData } from "../../hooks/useHazardData";
import { useEvacuationData } from "../../hooks/useEvacuationData";
import { usePublicHazardReports, useRoadSegments, useSogodBoundary } from "../../hooks/useEvacuationQueries";
import { useRouting } from "../../hooks/useRouting";
import { displayEntityName } from "../../utils/displayEntityName";
import BuildingDetailsModal from "../../components/BuildingDetailsModal/BuildingDetailsModal";
import {
  initBuildingLayers,
  setSelectedBuilding,
  setBuildingsGeoJSON,
  initEntranceLayers,
  setEntrancesGeoJSON,
  setUserBuilding,
  pulseBuilding,
} from "../../utils/mapBuildingLayers";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { icon } from "@fortawesome/fontawesome-svg-core";
import {
  faLocationCrosshairs,
  faLocationDot,
  faMapPin,
  faRoute,
  faSatelliteDish,
  faWater,
  faMountain,
  faHome,
  faRightToBracket,
  faRightFromBracket,
  faPersonWalking,
  faXmark,
  faSliders,
  faUser,
  faCircleCheck,
  faMagnifyingGlass,
  faBuildingColumns,
  faDoorOpen,
  faChevronRight,
  faChevronDown,
  faChevronUp,
  faArrowUp,
  faTriangleExclamation,
  faBan,
  faEllipsis,
  faCircle,
  faCircleQuestion,
  faSpinner,
  faHouseFlag,
} from "@fortawesome/free-solid-svg-icons";

import "../../components_css/MyLocationMarker.css";
import "../../components/DashboardMap/MapOverlays.css";
import "./ResidentHome.css";
import "./ResidentHome.motion.css";
import { useAuth } from "../../context/AuthContext";
import { LoginDialog, ResidentSignUpDialog } from "../../components/AuthModals/AuthModals";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const SOGOD_CENTER = [10.435, 124.996];

const SOGOD_BOUNDS = [
  [10.368, 124.912],
  [10.525, 125.078],
];

/*
 * Below this zoom: centers are shown as icons with their name.
 * At this zoom and above: the building outline and room icons show.
 */
const ROOM_MIN_ZOOM = 14;
const PUBLIC_MAP_QUERY_OPTIONS = {
  staleTime: 20000,
  refetchOnMount: "always",
};

/*
 * Remembers who the resident is on this device.
 */
const RESIDENT_STORAGE_KEY = "evacway_resident";

const TRAVEL_SPEEDS = {
  walking: 5,
  motorcycle: 30,
  car: 25,
};

/*
 * A stable, empty GeoJSON collection to feed into sources before
 * real data has loaded, so sources/layers can be created once and
 * updated in place afterwards (see the layer effects below).
 */
const EMPTY_FEATURE_COLLECTION = {
  type: "FeatureCollection",
  features: [],
};

const VALIDATED_STATUS = "validated";

function isValidatedReport(report) {
  return String(report?.status || "").toLowerCase() === VALIDATED_STATUS;
}

function estimateTravelTimes(distanceKm) {
  return {
    walking: Math.round((distanceKm / TRAVEL_SPEEDS.walking) * 60),
    motorcycle: Math.round((distanceKm / TRAVEL_SPEEDS.motorcycle) * 60),
    car: Math.round((distanceKm / TRAVEL_SPEEDS.car) * 60),
  };
}

function getDistanceMeters(first, second) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(second[0] - first[0]);
  const longitudeDelta = radians(second[1] - first[1]);
  const firstLatitude = radians(first[0]);
  const secondLatitude = radians(second[0]);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) *
    Math.cos(secondLatitude) *
    Math.sin(longitudeDelta / 2) ** 2;

  return 6371000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function calculateBearing(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const dLon = (lon2 - lon1) * toRad;
  const y = Math.sin(dLon) * Math.cos(lat2 * toRad);
  const x =
    Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) -
    Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos(dLon);
  return (Math.atan2(y, x) * toDeg + 360) % 360;
}

function projectPointToSegment(p, a, b) {
  const latP = p[0], lngP = p[1];
  const latA = a[0], lngA = a[1];
  const latB = b[0], lngB = b[1];

  const midLat = ((latA + latB) / 2) * (Math.PI / 180);
  const cosLat = Math.cos(midLat);

  const xP = lngP * cosLat, yP = latP;
  const xA = lngA * cosLat, yA = latA;
  const xB = lngB * cosLat, yB = latB;

  const dx = xB - xA;
  const dy = yB - yA;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return {
      snapped: [latA, lngA],
      distance: getDistanceMeters(p, a),
      t: 0,
    };
  }

  let t = ((xP - xA) * dx + (yP - yA) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const snappedLng = (xA + t * dx) / cosLat;
  const snappedLat = yA + t * dy;
  const snapped = [snappedLat, snappedLng];

  return {
    snapped,
    distance: getDistanceMeters(p, snapped),
    t,
  };
}

function snapLocationToRoute(userLocation, routePoints) {
  if (!routePoints || routePoints.length < 2) {
    return {
      snappedPoint: userLocation,
      distanceToRoute: 0,
      segmentIndex: 0,
      walkedPoints: [userLocation],
      remainingPoints: routePoints || [userLocation],
    };
  }

  let minDistance = Infinity;
  let bestSnapped = routePoints[0];
  let bestSegmentIndex = 0;

  for (let i = 0; i < routePoints.length - 1; i++) {
    const proj = projectPointToSegment(userLocation, routePoints[i], routePoints[i + 1]);
    if (proj.distance < minDistance) {
      minDistance = proj.distance;
      bestSnapped = proj.snapped;
      bestSegmentIndex = i;
    }
  }

  const walked = [...routePoints.slice(0, bestSegmentIndex + 1), bestSnapped];
  const remaining = [bestSnapped, ...routePoints.slice(bestSegmentIndex + 1)];

  return {
    snappedPoint: bestSnapped,
    distanceToRoute: minDistance,
    segmentIndex: bestSegmentIndex,
    walkedPoints: walked,
    remainingPoints: remaining,
  };
}

function getDistanceFromRoute(location, routeCoordinates = []) {
  if (routeCoordinates.length === 0) return Infinity;

  return Math.min(
    ...routeCoordinates.map((point) => getDistanceMeters(location, point))
  );
}

function getManeuverRotation(modifier = "") {
  const normalized = modifier.toLowerCase();
  if (normalized.includes("uturn")) return 180;
  if (normalized.includes("sharp left")) return -135;
  if (normalized.includes("sharp right")) return 135;
  if (normalized.includes("slight left")) return -45;
  if (normalized.includes("slight right")) return 45;
  if (normalized.includes("left")) return -90;
  if (normalized.includes("right")) return 90;
  return 0;
}

function ensureArrowImage(map) {
  if (!map || map.hasImage("route-chevron-arrow")) return;
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  // Chevron pointing North (up) so icon-rotate: bearing works correctly
  ctx.moveTo(8, 20);
  ctx.lineTo(16, 10);
  ctx.lineTo(24, 20);
  ctx.stroke();

  const imgData = ctx.getImageData(0, 0, size, size);
  try {
    map.addImage("route-chevron-arrow", imgData);
  } catch (e) {
    // Already added or context issue
  }
}

function createNavigationArrowMarker(heading = 0) {
  const container = document.createElement("div");
  container.className = "nav-user-marker";

  // Slow pulsing ring expanding and fading every 1.5-2s
  const pulseRing = document.createElement("div");
  pulseRing.className = "nav-user-pulse-ring";
  pulseRing.setAttribute("aria-hidden", "true");
  container.appendChild(pulseRing);

  const disc = document.createElement("div");
  disc.className = "nav-user-arrow-disc";
  disc.style.transform = `rotate(${heading || 0}deg)`;

  disc.innerHTML = `
    <svg viewBox="0 0 24 24" class="nav-arrow-svg" aria-hidden="true">
      <path d="M12 3L4 19l1.5 1.2L12 16.5l6.5 3.7L20 19z" fill="#ffffff" />
    </svg>
  `;

  container.appendChild(disc);
  return container;
}

function distanceBetweenPointsMeters(p1, p2) {
  const R = 6371000;
  const dLat = ((p2[1] - p1[1]) * Math.PI) / 180;
  const dLng = ((p2[0] - p1[0]) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((p1[1] * Math.PI) / 180) *
      Math.cos((p2[1] * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function interpolatePoint(p1, p2, fraction) {
  return [
    p1[0] + (p2[0] - p1[0]) * fraction,
    p1[1] + (p2[1] - p1[1]) * fraction,
  ];
}

function generateRouteArrowPoints(coordinates, spacingMeters = 50) {
  if (!coordinates || coordinates.length < 2) return [];
  const features = [];
  let leftoverDistance = spacingMeters / 2;
  let pointIndex = 0;

  for (let i = 0; i < coordinates.length - 1; i++) {
    const p1 = coordinates[i];
    const p2 = coordinates[i + 1];
    const segDist = distanceBetweenPointsMeters(p1, p2);
    if (segDist <= 0.001) continue;

    const segBearing = calculateBearing(p1[1], p1[0], p2[1], p2[0]);
    let coveredOnSeg = leftoverDistance;

    while (coveredOnSeg < segDist) {
      const frac = coveredOnSeg / segDist;
      const coord = interpolatePoint(p1, p2, frac);
      features.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: coord,
        },
        properties: {
          bearing: segBearing,
          phase: pointIndex % 4,
          index: pointIndex,
        },
      });
      pointIndex++;
      coveredOnSeg += spacingMeters;
    }

    leftoverDistance = coveredOnSeg - segDist;
  }

  return features;
}

async function getWalkingDirections(start, destination) {
  const accessToken = mapboxgl.accessToken;
  if (!accessToken) throw new Error("Walking directions require a Mapbox access token.");

  const [startLat, startLng] = start;
  const destinationCoordinates = getValidCoordinates([
    destination.longitude ?? destination.lng,
    destination.latitude ?? destination.lat,
  ]);
  if (!destinationCoordinates) {
    throw new Error("The evacuation center does not have valid map coordinates.");
  }

  const [destinationLng, destinationLat] = destinationCoordinates;
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/walking/` +
    `${startLng},${startLat};${destinationLng},${destinationLat}` +
    `?steps=true&overview=full&geometries=geojson&access_token=${encodeURIComponent(accessToken)}`;
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.routes?.[0]) {
    throw new Error(data.message || "Walking directions are unavailable for this destination.");
  }

  const walkingRoute = data.routes[0];
  const coordinates = walkingRoute.geometry?.coordinates || [];
  const steps = walkingRoute.legs?.flatMap((leg) => leg.steps || []) || [];

  return {
    route: coordinates.map(([lng, lat]) => [lat, lng]),
    walking_steps: steps,
    walking_distance_meters: walkingRoute.distance,
    walking_duration_seconds: walkingRoute.duration,
    distance_km: walkingRoute.distance / 1000,
    estimated_time_min: Math.ceil(walkingRoute.duration / 60),
  };
}

// --------------------------------------------------
// Normalize the "find my center" response
// --------------------------------------------------

function normalizeMatches(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.matches)) return result.matches;
  if (Array.isArray(result?.data)) return result.data;
  return [];
}

function readSavedResident() {
  try {
    return JSON.parse(localStorage.getItem(RESIDENT_STORAGE_KEY));
  } catch {
    return null;
  }
}

function saveResident(value) {
  try {
    if (value) {
      localStorage.setItem(RESIDENT_STORAGE_KEY, JSON.stringify(value));
    } else {
      localStorage.removeItem(RESIDENT_STORAGE_KEY);
    }
  } catch {
    // storage unavailable: ignore
  }
}

// --------------------------------------------------
// Validate Mapbox coordinates
// --------------------------------------------------

function getValidCoordinates(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return null;
  }

  const lng = Number(coordinates[0]);
  const lat = Number(coordinates[1]);

  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return null;
  }

  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    return null;
  }

  return [lng, lat];
}

// --------------------------------------------------

// --------------------------------------------------
// Ray-casting point-in-polygon algorithm for GeoJSON
// --------------------------------------------------

function isPointInGeoPolygon(point, coordinates) {
  if (!point || !coordinates || !Array.isArray(coordinates)) return false;
  const [x, y] = point;

  function checkRing(ring) {
    if (!ring || ring.length < 3) return false;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0];
      const yi = ring[i][1];
      const xj = ring[j][0];
      const yj = ring[j][1];
      const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  if (Array.isArray(coordinates[0]) && typeof coordinates[0][0] === "number") {
    return checkRing(coordinates);
  }
  if (Array.isArray(coordinates[0]) && Array.isArray(coordinates[0][0]) && typeof coordinates[0][0][0] === "number") {
    return checkRing(coordinates[0]);
  }
  if (Array.isArray(coordinates[0]) && Array.isArray(coordinates[0][0]) && Array.isArray(coordinates[0][0][0])) {
    return coordinates.some((poly) => checkRing(poly[0]));
  }
  return false;
}

// Get center point of evacuation building polygon
// --------------------------------------------------

function getGeometryCenter(geometry) {
  if (!geometry || !geometry.coordinates) {
    return null;
  }

  // Handle Point
  if (geometry.type === "Point") {
    return getValidCoordinates(geometry.coordinates);
  }

  // Handle Polygon
  if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates[0])) {
    const ring = geometry.coordinates[0];
    if (!ring || ring.length < 3) return null;

    let area = 0;
    let cx = 0;
    let cy = 0;
    const n = ring.length;

    for (let i = 0; i < n - 1; i++) {
      const p1 = ring[i];
      const p2 = ring[i + 1];
      if (!Array.isArray(p1) || !Array.isArray(p2)) continue;
      const cross = p1[0] * p2[1] - p2[0] * p1[1];
      area += cross;
      cx += (p1[0] + p2[0]) * cross;
      cy += (p1[1] + p2[1]) * cross;
    }

    area = area * 0.5;

    if (Math.abs(area) > 1e-12) {
      cx = cx / (6 * area);
      cy = cy / (6 * area);
      if (Number.isFinite(cx) && Number.isFinite(cy)) {
        return [cx, cy];
      }
    }

    // Fallback: exact bounding-box midpoint
    let minLng = ring[0][0];
    let maxLng = ring[0][0];
    let minLat = ring[0][1];
    let maxLat = ring[0][1];

    ring.forEach((coord) => {
      if (Array.isArray(coord) && coord.length >= 2) {
        minLng = Math.min(minLng, Number(coord[0]));
        maxLng = Math.max(maxLng, Number(coord[0]));
        minLat = Math.min(minLat, Number(coord[1]));
        maxLat = Math.max(maxLat, Number(coord[1]));
      }
    });

    return [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
  }

  // Handle MultiPolygon: find largest component polygon outer ring
  if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    let maxRing = null;
    let maxLen = 0;
    geometry.coordinates.forEach((poly) => {
      if (Array.isArray(poly) && Array.isArray(poly[0]) && poly[0].length > maxLen) {
        maxRing = poly[0];
        maxLen = poly[0].length;
      }
    });

    if (maxRing && maxRing.length >= 3) {
      return getGeometryCenter({ type: "Polygon", coordinates: [maxRing] });
    }
  }

  return null;
}

// --------------------------------------------------
// Get bounding box of a geometry (used to zoom search
// results to an evacuation center's footprint)
// --------------------------------------------------

function getGeometryBounds(geometry) {
  if (!geometry || !geometry.coordinates) {
    return null;
  }

  const coordinates = [];

  function collect(coords) {
    if (!Array.isArray(coords)) {
      return;
    }

    if (
      coords.length >= 2 &&
      typeof coords[0] === "number" &&
      typeof coords[1] === "number"
    ) {
      coordinates.push(coords);
      return;
    }

    coords.forEach(collect);
  }

  collect(geometry.coordinates);

  if (coordinates.length === 0) {
    return null;
  }

  let minLng = coordinates[0][0];
  let maxLng = coordinates[0][0];
  let minLat = coordinates[0][1];
  let maxLat = coordinates[0][1];

  coordinates.forEach(([lng, lat]) => {
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  });

  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

// --------------------------------------------------
// Tracks viewport width
// --------------------------------------------------

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(window.innerWidth < breakpoint);

  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth < breakpoint);
    }

    window.addEventListener("resize", handleResize);

    return () => window.removeEventListener("resize", handleResize);
  }, [breakpoint]);

  return isMobile;
}

// --------------------------------------------------
// Creates the blue "you are here" marker
// --------------------------------------------------

function createMyLocationMarker() {
  const element = document.createElement("div");

  element.className = "my-location-marker";

  element.innerHTML = `
    <div class="pulse-ring"></div>
    <div class="dot"></div>
  `;

  return element;
}

// --------------------------------------------------
// Popups
// --------------------------------------------------

function createHazardPopup(properties, closedRoadNames = []) {
  const container = document.createElement("div");

  const name = document.createElement("strong");
  name.textContent = properties.report_type || properties.name || properties.hazard_type || "Hazard";

  const type = document.createElement("div");
  type.textContent = `Type: ${properties.hazard_type || properties.report_type || "Unknown"}`;

  const risk = document.createElement("div");
  risk.textContent = properties.risk_level
    ? `Risk: ${properties.risk_level}`
    : `Status: ${properties.status || "Reported"}`;

  container.appendChild(name);
  container.appendChild(type);
  if (isBlockedRoadReport(properties)) {
    const blockedStatus = document.createElement("div");
    blockedStatus.textContent = "Road status: Blocked";
    blockedStatus.style.marginTop = "4px";
    blockedStatus.style.color = "#b91c1c";
    blockedStatus.style.fontWeight = "700";
    container.appendChild(blockedStatus);
  }

  if (closedRoadNames.length > 0) {
    const affectedRoads = document.createElement("div");
    affectedRoads.textContent = `Affected roads: ${closedRoadNames.join(", ")}`;
    affectedRoads.style.color = "#b91c1c";
    affectedRoads.style.fontWeight = "600";
    container.appendChild(affectedRoads);
  }
  container.appendChild(risk);

  const description = properties.description || properties.details;
  if (description) {
    const detail = document.createElement("p");
    detail.textContent = description;
    detail.style.margin = "6px 0 0";
    detail.style.maxWidth = "230px";
    detail.style.whiteSpace = "normal";
    container.appendChild(detail);
  }

  const photoPath =
    properties.photo_url ??
    properties.image_url ??
    properties.photo_path ??
    properties.image_path ??
    properties.photo ??
    properties.image;
  const photoMessage = document.createElement("div");

  if (photoPath) {
    const photo = document.createElement("img");
    photo.src = resolvePhotoUrl(photoPath);
    photo.alt = "Photo attached to hazard report";
    photo.style.display = "block";
    photo.style.width = "220px";
    photo.style.maxWidth = "100%";
    photo.style.maxHeight = "140px";
    photo.style.objectFit = "cover";
    photo.style.marginTop = "8px";
    photo.style.borderRadius = "6px";
    photo.onerror = () => {
      photo.remove();
      photoMessage.textContent = "Photo could not be loaded.";
    };
    container.appendChild(photo);
  } else {
    photoMessage.textContent = "No photo was attached to this report.";
  }

  if (photoMessage.textContent) {
    photoMessage.style.marginTop = "7px";
    photoMessage.style.color = "#64748b";
    photoMessage.style.fontSize = "12px";
    container.appendChild(photoMessage);
  }

  return container;
}

function isBlockedRoadReport(report) {
  if (report.blocks_road === true) return true;

  if (Array.isArray(report.closed_roads) && report.closed_roads.length > 0) {
    return true;
  }

  const text = `${report.report_type || ""} ${report.hazard_type || ""}`;

  return /block|closed|obstruct/i.test(text);
}

function createRoadPopup(properties) {
  const container = document.createElement("div");

  const name = document.createElement("strong");
  name.textContent = properties.road_name || "Unnamed road";

  const status = document.createElement("div");
  status.textContent = properties.is_closed
    ? "🚫 Closed - avoid this road"
    : "Open";

  container.appendChild(name);
  container.appendChild(status);

  return container;
}

function resolvePhotoUrl(path) {
  if (!path) return null;

  if (/^(https?:|data:|blob:)/i.test(path)) return path;

  const baseUrl = BASE_URL.endsWith("/") ? BASE_URL : `${BASE_URL}/`;
  return new URL(path, baseUrl).toString();
}

function findReportForRoad(properties, reports) {
  const roadId =
    properties.id ?? properties.road_segment_id ?? properties.segment_id;
  const reportId =
    properties.report_id ??
    properties.hazard_report_id ??
    properties.closed_by_report_id;

  const matches = (reports || []).filter((report) => {
    const linkedRoadId = report.road_segment_id ?? report.road_id;

    return (
      (reportId != null && String(report.id) === String(reportId)) ||
      (roadId != null && linkedRoadId != null && String(linkedRoadId) === String(roadId))
    );
  });

  return (
    matches.find((report) => report.photo_url || report.image_url || report.photo) ||
    matches[0] ||
    null
  );
}

function createBlockedRoadPopup(properties, report) {
  const container = document.createElement("div");

  const name = document.createElement("strong");
  name.textContent = properties.road_name || "Unnamed road";
  container.appendChild(name);

  const status = document.createElement("div");
  status.textContent = "Closed - avoid this road";
  status.style.color = "#b91c1c";
  status.style.fontWeight = "600";
  container.appendChild(status);

  const reason =
    properties.closure_reason || report?.report_type || report?.hazard_type;
  if (reason) {
    const reasonLine = document.createElement("div");
    reasonLine.textContent = `Reason: ${reason}`;
    container.appendChild(reasonLine);
  }

  const description =
    properties.description ||
    properties.details ||
    report?.description ||
    report?.details;
  if (description) {
    const detail = document.createElement("p");
    detail.textContent = description;
    detail.style.margin = "6px 0 0";
    detail.style.maxWidth = "230px";
    detail.style.whiteSpace = "normal";
    container.appendChild(detail);
  }

  const dateValue =
    properties.closed_at || report?.validated_at || report?.created_at;
  if (dateValue) {
    const date = new Date(dateValue);
    if (!Number.isNaN(date.getTime())) {
      const dateLine = document.createElement("div");
      dateLine.textContent = `Closed: ${date.toLocaleString()}`;
      dateLine.style.marginTop = "4px";
      dateLine.style.fontSize = "12px";
      dateLine.style.opacity = "0.75";
      container.appendChild(dateLine);
    }
  }

  const photoUrl = resolvePhotoUrl(
    properties.photo_url ||
    properties.image_url ||
    properties.photo ||
    report?.photo_url ||
    report?.image_url ||
    report?.photo
  );
  if (photoUrl) {
    const photo = document.createElement("img");
    photo.src = photoUrl;
    photo.alt = "Photo of the closed road";
    photo.style.display = "block";
    photo.style.width = "220px";
    photo.style.maxWidth = "100%";
    photo.style.maxHeight = "140px";
    photo.style.objectFit = "cover";
    photo.style.marginTop = "8px";
    photo.style.borderRadius = "6px";
    photo.onerror = () => photo.remove();
    container.appendChild(photo);
  }

  return container;
}

function createRoomPopup(room, isMine) {
  const container = document.createElement("div");

  const name = document.createElement("strong");
  name.textContent = room.room_number || "Room";

  const capacity = document.createElement("div");
  capacity.textContent = `Capacity: ${room.capacity ?? "Unknown"}`;

  container.appendChild(name);
  container.appendChild(capacity);

  if (isMine) {
    const mine = document.createElement("div");
    mine.style.marginTop = "4px";
    mine.style.fontWeight = "700";
    mine.style.color = "#c2410c";
    mine.textContent = "This is your assigned room";
    container.appendChild(mine);
  }

  return container;
}

// --------------------------------------------------
// Create Mapbox marker
// --------------------------------------------------

function createSimpleMarker(className) {
  const element = document.createElement("div");

  element.className = className;

  return element;
}

const ResidentHome = () => {
  // "Compact" layout (search + status chip on top, 2-button right stack,
  // bottom dock and bottom sheets) is used on phones AND tablets (< 1024px).
  // Phone vs. tablet sizing is handled by CSS media queries.
  const isMobile = useIsMobile(1024);
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const loginDialogRef = useRef(null);
  const signUpDialogRef = useRef(null);
  const [signUpOpen, setSignUpOpen] = useState(false);
  const [authModalNotice, setAuthModalNotice] = useState("");

  const openLoginDialog = (notice = "") => {
    setAuthModalNotice(notice || "");
    signUpDialogRef.current?.close();
    setSignUpOpen(false);
    loginDialogRef.current?.showModal();
  };

  const openSignUpDialog = () => {
    loginDialogRef.current?.close();
    window.requestAnimationFrame(() => {
      signUpDialogRef.current?.showModal();
      setSignUpOpen(true);
    });
  };

  const handleLogout = () => {
    logout();
    setMyCenter(null);
    setReportConfirmation("Signed out successfully.");
    setTimeout(() => setReportConfirmation(""), 3500);
  };

  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const flowFrameRef = useRef(null);

  const hazardMarkersRef = useRef([]);
  const evacuationMarkersRef = useRef([]);
  const entranceMarkersRef = useRef([]);
  const roomMarkersRef = useRef([]);
  const routeMarkersRef = useRef([]);
  const userRoomMarkerRef = useRef(null);
  const touchStartYRef = useRef(0);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [styleVersion, setStyleVersion] = useState(0);
  const hazardReportsQuery = usePublicHazardReports(PUBLIC_MAP_QUERY_OPTIONS);
  const roadSegmentsQuery = useRoadSegments(PUBLIC_MAP_QUERY_OPTIONS);
  const sogodBoundaryQuery = useSogodBoundary();
  const hazardReports = useMemo(
    () => Array.isArray(hazardReportsQuery.data)
      ? hazardReportsQuery.data.filter(isValidatedReport)
      : [],
    [hazardReportsQuery.data]
  );
  const roads = roadSegmentsQuery.data ?? null;
  const sogodBoundary = sogodBoundaryQuery.data ?? null;

  // --------------------------------------------------
  // Use Custom Hooks for Logic
  // --------------------------------------------------
  const {
    filteredHazardZones
  } = useHazardData(PUBLIC_MAP_QUERY_OPTIONS);

  const {
    evacCenters,
    rooms,
    buildingsGeoJSON
  } = useEvacuationData();

  const {
    route,
    setRoute,
    routeIsMine,
    setRouteIsMine,
    routeError,
    setRouteError,
    findingRoute,
    setFindingRoute
  } = useRouting();

  // --------------------------------------------------
  // Map style
  // Street is the default
  // --------------------------------------------------

  const [mapStyle, setMapStyle] = useState("street");
  const [legendCollapsed, setLegendCollapsed] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 768
  );

  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const [pickingLocation, setPickingLocation] = useState(false);

  // Kept in sync with pickingLocation below. The Mapbox click
  // listener is registered once, inside the map-init effect
  // (empty dependency array), so it closes over pickingLocation
  // as it was AT MOUNT TIME. Reading a ref instead lets that
  // long-lived listener see the current value on every click.
  const pickingLocationRef = useRef(false);

  const [pendingReportLocation, setPendingReportLocation] = useState(null);
  const [rescueAlertOpen, setRescueAlertOpen] = useState(false);
  const [rescueCoordinates, setRescueCoordinates] = useState(null);
  const selectedLocationMarkerRef = useRef(null);
  const savedReportHighlightRef = useRef(null);
  const accuracyCircleStateRef = useRef(null);
  const pickingPurposeRef = useRef("hazard");

  const [reportConfirmation, setReportConfirmation] = useState("");

  const [locationPermission, setLocationPermission] = useState("unknown");

  const [myLocation, setMyLocation] = useState(null);
  const [locating, setLocating] = useState(false);
  const [navigationActive, setNavigationActive] = useState(false);
  const [navigationStatus, setNavigationStatus] = useState("");
  const [navigationAccuracy, setNavigationAccuracy] = useState(null);
  const [navigationRemainingMeters, setNavigationRemainingMeters] = useState(null);
  const [navigationRemainingSeconds, setNavigationRemainingSeconds] = useState(null);
  const [activeWalkingStep, setActiveWalkingStep] = useState(0);
  const activeWalkingStepRef = useRef(0);
  const navigationWatchIdRef = useRef(null);
  const navigationActiveRef = useRef(false);
  const routeDataRef = useRef(route);
  const lastRerouteAtRef = useRef(0);
  const reroutingRef = useRef(false);
  const [isPannedAway, setIsPannedAway] = useState(false);
  const autoFollowRef = useRef(true);
  const consecutiveOffRouteRef = useRef(0);
  const previousLocationRef = useRef(null);
  const lastHeadingRef = useRef(0);
  const liveUserLocationRef = useRef(null);
  const userMarkerElementRef = useRef(null);
  const [arrivalToast, setArrivalToast] = useState("");
  const [navPillExpanded, setNavPillExpanded] = useState(false);
  const arrowAnimRef = useRef(null);
  const activeEntranceRef = useRef(null);
  const navigationRemainingMetersRef = useRef(null);

  // --------------------------------------------------
  // "My evacuation center" (name verification)
  // --------------------------------------------------

  const [myCenter, setMyCenter] = useState(null);
  const [roomCardExpanded, setRoomCardExpanded] = useState(false);
  const [myCenterOpen, setMyCenterOpen] = useState(false);
  const [lookupName, setLookupName] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [lookupMatches, setLookupMatches] = useState([]);

  // Building details modal (independent of center card)
  const [buildingModalOpen, setBuildingModalOpen] = useState(false);
  const [selectedBuildingId, setSelectedBuildingId] = useState(null);
  const [selectedBuildingData, setSelectedBuildingData] = useState(null);

  // Autosuggest for "My evacuation center" lookup
  const [autosuggestList, setAutosuggestList] = useState([]);
  const [autosuggestOpen, setAutosuggestOpen] = useState(false);
  const [autosuggestLoading, setAutosuggestLoading] = useState(false);
  const [autosuggestIndex, setAutosuggestIndex] = useState(-1);
  const autosuggestAbortRef = useRef(null);

  // --------------------------------------------------
  // Search (evacuation centers + barangays)
  // --------------------------------------------------

  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [hideRoomBarForSearch, setHideRoomBarForSearch] = useState(false);
  const selectingSuggestionRef = useRef(false);
  const searchMoveRestoreTimeoutRef = useRef(null);

  // --------------------------------------------------
  // Evacuation center details panel
  // --------------------------------------------------

  const [selectedCenter, setSelectedCenter] = useState(null);

  // --------------------------------------------------
  // Keep pickingLocationRef in sync with pickingLocation
  // --------------------------------------------------

  useEffect(() => {
    pickingLocationRef.current = pickingLocation;
  }, [pickingLocation]);

  // --------------------------------------------------
  // Only one sheet open at a time: opening the center
  // details closes More / Help.
  // --------------------------------------------------

  useEffect(() => {
    if (selectedCenter) {
      setMoreMenuOpen(false);
      setHelpOpen(false);
    }
  }, [selectedCenter]);

  // Escape closes any open sheet
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key !== "Escape") return;
      setMoreMenuOpen(false);
      setHelpOpen(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    routeDataRef.current = route;
  }, [route]);

  useEffect(() => {
    if (!routeError) return undefined;
    const timer = window.setTimeout(() => {
      setRouteError("");
    }, 3500);
    return () => window.clearTimeout(timer);
  }, [routeError, setRouteError]);

  useEffect(() => () => {
    navigationActiveRef.current = false;
    if (navigationWatchIdRef.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(navigationWatchIdRef.current);
    }
  }, []);

  // Keyboard close for popovers/sheets/cards
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "Escape") {
        setHelpOpen(false);
        setMoreMenuOpen(false);
        setShowSearchResults(false);
        if (selectedCenter) setSelectedCenter(null);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedCenter]);

  // --------------------------------------------------
  // Load remaining data
  // --------------------------------------------------

  // Display interactive hazard-zone outlines for the selected map layers.
  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded || !filteredHazardZones) return;

    try {
      const sourceId = "resident-hazard-zones";
      const data = {
        ...filteredHazardZones,
        features: Array.isArray(filteredHazardZones.features)
          ? filteredHazardZones.features
          : [],
      };
      const source = map.getSource(sourceId);

      if (source) {
        source.setData(data);
      } else {
        map.addSource(sourceId, { type: "geojson", data });
      }

      if (!map.getLayer("resident-hazard-fill")) {
        map.addLayer({
          id: "resident-hazard-fill",
          type: "fill",
          source: sourceId,
          paint: {
            "fill-color": [
              "match",
              ["get", "hazard_type"],
              "flood", "#0a9fb5",
              "landslide", "#8b5e34",
              "#c8372d",
            ],
            "fill-opacity": [
              "match", ["get", "risk_level"],
              "high", 0.34,
              "medium", 0.25,
              0.18,
            ],
          },
        });
      }

      if (!map.getLayer("resident-hazard-outline")) {
        map.addLayer({
          id: "resident-hazard-outline",
          type: "line",
          source: sourceId,
          paint: {
            "line-color": [
              "match",
              ["get", "hazard_type"],
              "flood", "#087e99",
              "landslide", "#684323",
              "#a82e27",
            ],
            "line-width": 2.5,
          },
        });
      }

      if (!map.getLayer("resident-hazard-labels")) {
        map.addLayer({
          id: "resident-hazard-labels",
          type: "symbol",
          source: sourceId,
          minzoom: 10,
          maxzoom: 14,
          layout: {
            "text-field": [
              "concat",
              ["case", ["==", ["get", "hazard_type"], "flood"], "Flood zone", "Landslide zone"],
              " · ",
              ["to-string", ["get", "risk_level"]],
            ],
            "text-font": ["Open Sans Semibold", "Arial Unicode MS Regular"],
            "text-size": 12,
            "text-max-width": 12,
            "text-padding": 8,
            "text-allow-overlap": false,
            "text-ignore-placement": false,
          },
          paint: {
            "text-color": [
              "match", ["get", "hazard_type"],
              "flood", "#075b70",
              "landslide", "#553719",
              "#81251f",
            ],
            "text-halo-color": "#ffffff",
            "text-halo-width": 1.5,
          },
        });
      }
    } catch (err) {
      console.warn("Error updating hazard zones layer:", err);
      return;
    }

    const handleZoneClick = (event) => {
      const feature = event.features?.[0];
      if (!feature) return;

      new mapboxgl.Popup({ offset: 10 })
        .setLngLat(event.lngLat)
        .setDOMContent(createHazardPopup(feature.properties || {}))
        .addTo(map);
    };

    const handleMouseEnter = () => {
      try {
        map.getCanvas().style.cursor = "pointer";
      } catch (e) { }
    };
    const handleMouseLeave = () => {
      try {
        map.getCanvas().style.cursor = pickingLocationRef.current
          ? "crosshair"
          : "";
      } catch (e) { }
    };

    try {
      map.on("click", "resident-hazard-fill", handleZoneClick);
      map.on("mouseenter", "resident-hazard-fill", handleMouseEnter);
      map.on("mouseleave", "resident-hazard-fill", handleMouseLeave);
    } catch (e) { }

    return () => {
      try {
        map.off("click", "resident-hazard-fill", handleZoneClick);
        map.off("mouseenter", "resident-hazard-fill", handleMouseEnter);
        map.off("mouseleave", "resident-hazard-fill", handleMouseLeave);
      } catch (e) { }
    };
  }, [filteredHazardZones, mapLoaded, pickingLocation, mapStyle, styleVersion]);

  // Put photo-bearing hazard reports on the map as labeled, clickable tags.
  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded) return;

    hazardMarkersRef.current.forEach((marker) => marker.remove());
    hazardMarkersRef.current = [];

    hazardReports.forEach((report) => {
      const coordinates = getValidCoordinates([
        report.longitude ?? report.lng,
        report.latitude ?? report.lat,
      ]);

      if (!coordinates) return;

      const blocked = isBlockedRoadReport(report);

      const closedRoadNames = Array.isArray(report.closed_roads)
        ? report.closed_roads
        : [];

      const element = document.createElement("button");
      element.type = "button";
      element.className = blocked
        ? "resident-hazard-marker blocked-road-marker"
        : "resident-hazard-marker";
      element.setAttribute(
        "aria-label",
        `View ${blocked ? "blocked road" : "hazard"}: ${report.report_type || "Hazard report"}`
      );

      const iconElement = document.createElement("span");
      iconElement.className = "resident-hazard-marker-icon";
      iconElement.innerHTML = icon(
        blocked ? faBan : faTriangleExclamation
      ).html.join("");

      const label = document.createElement("span");
      label.className = "resident-hazard-marker-label";
      label.textContent = blocked
        ? "Road blocked"
        : report.report_type || "Hazard";

      element.append(iconElement, label);

      element.addEventListener("click", () => {
        highlightAndOpenSavedReport(map, savedReportHighlightRef, {
          ...report,
          closed_roads: closedRoadNames.length > 0 ? closedRoadNames : report.closed_roads,
        });
      });

      const marker = new mapboxgl.Marker({ element, anchor: "bottom" })
        .setLngLat(coordinates)
        .setPopup(
          new mapboxgl.Popup({
            className: "ew-popup",
            maxWidth: "460px",
          }).setDOMContent(
            createReportPopup({
              ...report,
              closed_roads: closedRoadNames.length > 0
                ? closedRoadNames
                : report.closed_roads,
            })
          )
        )
        .addTo(map);

      hazardMarkersRef.current.push(marker);
    });

    return () => {
      cancelAnimationFrame(flowFrameRef.current);
      flowFrameRef.current = null;
      if (savedReportHighlightRef.current) {
        savedReportHighlightRef.current.remove();
        savedReportHighlightRef.current = null;
      }
      hazardMarkersRef.current.forEach((marker) => marker.remove());
      hazardMarkersRef.current = [];
    };
  }, [hazardReports, roads, mapLoaded]);

  // Deep-link / notification opening a saved hazard report on the map
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const targetId = params.get("hazard") || params.get("reportId") || params.get("hazardId");
    if (!targetId || !mapLoaded) return;

    let targetReport = hazardReports.find((r) => String(r.id) === targetId);
    if (targetReport && mapRef.current) {
      highlightAndOpenSavedReport(mapRef.current, savedReportHighlightRef, targetReport);
      return;
    }

    if (api && typeof api.getHazardReports === "function" && mapRef.current) {
      api.getHazardReports("all")
        .then((all) => {
          const found = all?.find((r) => String(r.id) === targetId);
          if (found && mapRef.current) {
            highlightAndOpenSavedReport(mapRef.current, savedReportHighlightRef, found);
          }
        })
        .catch(() => { });
    }
  }, [mapLoaded, hazardReports]);

  // --------------------------------------------------
  // Auto-detect resident evacuation assignment when logged in
  // --------------------------------------------------

  useEffect(() => {
    if (!user) return;

    const queryParam = user.resident_id
      ? { resident_id: user.resident_id }
      : { name: user.name };

    api
      .findMyEvacuationCenter(queryParam)
      .then((result) => {
        const matches = normalizeMatches(result);
        const match =
          matches.find(
            (item) =>
              user.resident_id != null &&
              String(item.resident_id) === String(user.resident_id)
          ) || (matches.length > 0 ? matches[0] : null);

        if (match?.evacuation_center) {
          setMyCenter(match);
        }
      })
      .catch(() => {});
  }, [user]);

  // --------------------------------------------------
  // Restore the resident saved on this device
  // (re-checked so a changed assignment is picked up)
  // --------------------------------------------------

  useEffect(() => {
    const saved = readSavedResident();
    if (!saved) return;

    if (saved.evacuation_center && (saved.room || saved.room_number)) {
      setMyCenter(saved);
    }

    const queryName = saved.name || saved.household_head_name;
    if (!queryName) return;

    api
      .findMyEvacuationCenter(queryName)
      .then((result) => {
        const matches = normalizeMatches(result);

        const match =
          matches.find(
            (item) =>
              saved.resident_id != null &&
              String(item.resident_id) === String(saved.resident_id)
          ) || (matches.length === 1 ? matches[0] : null);

        if (match?.evacuation_center) {
          setMyCenter(match);
        }
      })
      .catch(() => { });
  }, []);

  // --------------------------------------------------
  // Check location permission & auto-fetch user location
  // --------------------------------------------------

  useEffect(() => {
    function fetchInitialUserLocation() {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const loc = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          };
          setMyLocation(loc);
          setLocationPermission("granted");
          accuracyCircleStateRef.current = loc;
        },
        () => { },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    }

    if (!navigator.permissions) {
      fetchInitialUserLocation();
      return;
    }

    navigator.permissions
      .query({
        name: "geolocation",
      })
      .then((result) => {
        const updatePermission = () => {
          const state =
            result.state === "granted"
              ? "granted"
              : result.state === "denied"
                ? "denied"
                : "unknown";
          setLocationPermission(state);
          if (state === "granted") {
            fetchInitialUserLocation();
          }
        };

        updatePermission();

        result.onchange = updatePermission;
      })
      .catch(() => { });
  }, []);


  // --------------------------------------------------
  // Automatic GPS arrival & check-in detection
  // --------------------------------------------------
  const autoCheckInAttemptedRef = useRef(false);

  useEffect(() => {
    if (!myLocation || !myCenter || myCenter.is_checked_in) return;
    if (autoCheckInAttemptedRef.current) return;

    const targetCenterId = myCenter.evacuation_center?.id;
    if (!targetCenterId) return;

    const centerFeature = evacCenters?.features?.find(
      (f) => String(f.properties?.id ?? f.id) === String(targetCenterId)
    );

    let isInside = false;
    const userPoint = [myLocation.lng, myLocation.lat];

    if (centerFeature?.geometry?.coordinates) {
      isInside = isPointInGeoPolygon(userPoint, centerFeature.geometry.coordinates);
    }

    if (!isInside) {
      let centerCoord = null;
      if (centerFeature) {
        centerCoord = getCenterCoordinates(centerFeature);
      }
      if (!centerCoord && myCenter.evacuation_center) {
        const cProps = myCenter.evacuation_center;
        if (cProps.latitude && cProps.longitude) {
          centerCoord = { lat: Number(cProps.latitude), lng: Number(cProps.longitude) };
        }
      }
      if (centerCoord) {
        const dist = getDistanceMeters([myLocation.lat, myLocation.lng], [centerCoord.lat, centerCoord.lng]);
        if (dist <= 50) {
          isInside = true;
        }
      }
    }

    if (isInside) {
      autoCheckInAttemptedRef.current = true;
      const payload = {
        center_id: targetCenterId,
        resident_id: myCenter.resident_id,
        family_id: myCenter.family_id,
        latitude: myLocation.lat,
        longitude: myLocation.lng,
      };

      api.autoGeofenceCheckIn(payload)
        .then((res) => {
          if (res.success) {
            setMyCenter((prev) => (prev ? { ...prev, is_checked_in: true, checkin_status: "Checked in" } : prev));
            const roomTxt = res.room_number ? ` Assigned room: ${res.room_number}.` : "";
            setArrivalToast(
              `🎉 Welcome to ${res.center_name || myCenter.evacuation_center?.name || "your evacuation center"}! Your arrival has been confirmed.${roomTxt}`
            );
          }
        })
        .catch((err) => {
          console.warn("Auto check-in check:", err);
          autoCheckInAttemptedRef.current = false;
        });
    }
  }, [myLocation, myCenter, evacCenters]);

  // --------------------------------------------------
  // Initialize Mapbox
  // --------------------------------------------------

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return;
    }

    if (!mapboxgl.accessToken) {
      console.error(
        "Mapbox token is missing. Check VITE_MAPBOX_TOKEN in .env"
      );
      return;
    }

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,

      // Street View is the default
      style: "mapbox://styles/mapbox/streets-v12",

      center: [SOGOD_CENTER[1], SOGOD_CENTER[0]],

      zoom: 12,

      pitch: 0,
      bearing: 0,

      minZoom: 12.3,
      maxZoom: 18,

      attributionControl: true,

      projection: "mercator",
    });

    mapRef.current = map;
    window.__evacwayMap = map;

    // Restrict map to Sogod area
    map.setMaxBounds([
      [SOGOD_BOUNDS[0][1], SOGOD_BOUNDS[0][0]],
      [SOGOD_BOUNDS[1][1], SOGOD_BOUNDS[1][0]],
    ]);

    map.on("load", () => {
      setMapLoaded(true);
      setStyleVersion((v) => v + 1);
    });

    map.on("style.load", () => {
      setMapLoaded(true);
      setStyleVersion((v) => v + 1);
      if (accuracyCircleStateRef.current) {
        const { lng, lat, accuracy } = accuracyCircleStateRef.current;
        setOrUpdateAccuracyCircle(map, lng, lat, accuracy);
      }
    });

    map.on("error", (event) => {
      console.error("Mapbox error:", event);
    });

    // Clicking the map while reporting a hazard or requesting rescue.
    map.on("click", (e) => {
      if (!pickingLocationRef.current) {
        return;
      }

      const loc = {
        lat: e.lngLat.lat,
        lng: e.lngLat.lng,
      };

      if (pickingPurposeRef.current === "rescue") {
        setRescueCoordinates(loc);
        setRescueAlertOpen(true);
        setPickingLocation(false);
        setOrUpdateSelectedLocationMarker(map, selectedLocationMarkerRef, loc, (updatedLoc) => {
          setRescueCoordinates(updatedLoc);
        });
      } else {
        setPendingReportLocation(loc);
        setPickingLocation(false);
        setOrUpdateSelectedLocationMarker(map, selectedLocationMarkerRef, loc, (updatedLoc) => {
          setPendingReportLocation(updatedLoc);
        });
      }
    });

    return () => {
      if (selectedLocationMarkerRef.current) {
        selectedLocationMarkerRef.current.remove();
        selectedLocationMarkerRef.current = null;
      }
      if (savedReportHighlightRef.current) {
        savedReportHighlightRef.current.remove();
        savedReportHighlightRef.current = null;
      }
      removeAccuracyCircle(map);

      hazardMarkersRef.current.forEach((marker) => marker.remove());
      evacuationMarkersRef.current.forEach((marker) => marker.remove());
      entranceMarkersRef.current.forEach((marker) => marker.remove());
      roomMarkersRef.current.forEach((marker) => marker.remove());
      routeMarkersRef.current.forEach((marker) => marker.remove());
      if (userRoomMarkerRef.current) {
        userRoomMarkerRef.current.remove();
        userRoomMarkerRef.current = null;
      }

      hazardMarkersRef.current = [];
      evacuationMarkersRef.current = [];
      entranceMarkersRef.current = [];
      roomMarkersRef.current = [];
      routeMarkersRef.current = [];

      map.remove();

      mapRef.current = null;
    };
  }, []);

  // --------------------------------------------------
  // Change map style
  // --------------------------------------------------

  function handleMapStyleChange(style) {
    const map = mapRef.current;

    if (!map || style === mapStyle) {
      return;
    }

    setMapLoaded(false);
    setMapStyle(style);

    const newStyle =
      style === "satellite"
        ? "mapbox://styles/mapbox/satellite-streets-v12"
        : "mapbox://styles/mapbox/streets-v12";

    map.setStyle(newStyle);

    map.once("style.load", () => {
      setMapLoaded(true);
      setStyleVersion((v) => v + 1);
    });
  }

  // --------------------------------------------------
  // Update click behavior
  // --------------------------------------------------

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded) {
      return;
    }

    map.getCanvas().style.cursor = pickingLocation ? "crosshair" : "";
  }, [pickingLocation, mapLoaded]);

  // --------------------------------------------------
  // Add road network
  // (source created once, updated via setData afterwards)
  // --------------------------------------------------

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded) {
      return;
    }

    const sourceId = "roads";
    const layerId = "roads-layer";

    const data = roads || EMPTY_FEATURE_COLLECTION;

    try {
      const source = map.getSource(sourceId);

      if (source) {
        source.setData(data);
      } else {
        map.addSource(sourceId, {
          type: "geojson",
          data,
        });

        map.addLayer({
          id: layerId,
          type: "line",
          source: sourceId,

          paint: {
            "line-color": [
              "case",
              ["==", ["get", "is_closed"], true],
              "#dc2626",
              "#94a3b8",
            ],

            "line-width": ["case", ["==", ["get", "is_closed"], true], 4, 2],

            "line-opacity": ["case", ["==", ["get", "is_closed"], true], 0.9, 0.5],
          },
        });
      }
    } catch (err) {
      console.warn("Error updating roads layer:", err);
      return;
    }

    function handleRoadClick(e) {
      const feature = e.features?.[0];

      if (!feature) {
        return;
      }

      const properties = feature.properties || {};
      const content = properties.is_closed
        ? createBlockedRoadPopup(
          properties,
          findReportForRoad(properties, hazardReports)
        )
        : createRoadPopup(properties);

      new mapboxgl.Popup({
        offset: 10,
      })
        .setLngLat(e.lngLat)
        .setDOMContent(content)
        .addTo(map);
    }

    try {
      map.on("click", layerId, handleRoadClick);
    } catch (e) { }

    return () => {
      try {
        map.off("click", layerId, handleRoadClick);
      } catch (e) { }
    };
  }, [roads, hazardReports, mapLoaded, mapStyle, styleVersion]);

  // --------------------------------------------------
  // Add Sogod boundary
  // (source created once, updated via setData afterwards)
  // --------------------------------------------------

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded || !sogodBoundary) {
      return;
    }

    const sourceId = "sogod-boundary";
    const casingLayerId = "sogod-boundary-casing";
    const layerId = "sogod-boundary-line";

    try {
      const source = map.getSource(sourceId);

      if (source) {
        source.setData(sogodBoundary);
        if (map.getLayer(casingLayerId)) {
          map.setPaintProperty(
            casingLayerId,
            "line-color",
            mapStyle === "satellite" ? "rgba(0, 0, 0, 0.65)" : "rgba(255, 255, 255, 0.85)"
          );
        }
        if (map.getLayer(layerId)) {
          map.setPaintProperty(
            layerId,
            "line-color",
            mapStyle === "satellite" ? "#38bdf8" : "#1e3a8a"
          );
        }
      } else {
        map.addSource(sourceId, {
          type: "geojson",
          data: sogodBoundary,
        });
      }

      if (!map.getLayer(casingLayerId)) {
        map.addLayer({
          id: casingLayerId,
          type: "line",
          source: sourceId,
          paint: {
            "line-color": mapStyle === "satellite" ? "rgba(0, 0, 0, 0.65)" : "rgba(255, 255, 255, 0.85)",
            "line-width": 4.5,
          },
        });
      }

      if (!map.getLayer(layerId)) {
        map.addLayer({
          id: layerId,
          type: "line",
          source: sourceId,

          paint: {
            "line-color": mapStyle === "satellite" ? "#38bdf8" : "#1e3a8a",
            "line-width": 2.5,
            "line-dasharray": [4, 3],
          },
        });
      }
    } catch (err) {
      console.warn("Error updating sogod boundary layer:", err);
    }
  }, [sogodBoundary, mapLoaded, mapStyle, styleVersion]);

  // --------------------------------------------------
  // Fit map to actual Sogod boundary
  // --------------------------------------------------

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded || !sogodBoundary) {
      return;
    }

    const bounds = new mapboxgl.LngLatBounds();

    function extendCoordinates(coordinates) {
      if (!Array.isArray(coordinates)) {
        return;
      }

      if (
        coordinates.length >= 2 &&
        typeof coordinates[0] !== "object" &&
        typeof coordinates[1] !== "object"
      ) {
        const valid = getValidCoordinates(coordinates);

        if (valid) {
          bounds.extend(valid);
        }

        return;
      }

      coordinates.forEach(extendCoordinates);
    }

    function extendGeoJSON(geojson) {
      if (!geojson) {
        return;
      }

      if (geojson.type === "FeatureCollection") {
        geojson.features?.forEach(extendGeoJSON);

        return;
      }

      if (geojson.type === "Feature") {
        extendGeoJSON(geojson.geometry);

        return;
      }

      if (geojson.coordinates) {
        extendCoordinates(geojson.coordinates);
      }
    }

    extendGeoJSON(sogodBoundary);

    if (bounds.isEmpty()) {
      console.warn("Sogod boundary has no valid coordinates.");

      return;
    }

    map.fitBounds(bounds, {
      padding: {
        top: 90,
        bottom: 100,
        left: 50,
        right: 50,
      },
      duration: 0,
      maxZoom: 11,
    });
  }, [sogodBoundary, mapLoaded]);

  // --------------------------------------------------
  // Evacuation center outlines + entrances
  // (source created once, updated via setData afterwards)
  // --------------------------------------------------

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded || !evacCenters) {
      return;
    }

    entranceMarkersRef.current.forEach((marker) => marker.remove());

    entranceMarkersRef.current = [];

    const fillLayerId = "evacuation-centers-fill";
    const lineLayerId = "evacuation-centers-line";
    const sourceId = "evacuation-centers";

    if (!Array.isArray(evacCenters.features)) {
      console.warn("Evacuation center response has no features:", evacCenters);

      return;
    }

    const validFeatures = evacCenters.features.filter((center) => {
      if (!center || !center.geometry) {
        return false;
      }

      if (
        center.geometry.type !== "Polygon" &&
        center.geometry.type !== "MultiPolygon"
      ) {
        console.warn(
          "Evacuation center does not have Polygon geometry:",
          center
        );

        return false;
      }

      return true;
    });

    const data = {
      type: "FeatureCollection",
      features: validFeatures,
    };

    try {
      const source = map.getSource(sourceId);

      if (source) {
        source.setData(data);
        if (map.getLayer(fillLayerId)) {
          map.setPaintProperty(fillLayerId, "fill-opacity", 0.04);
        }
        if (map.getLayer(lineLayerId)) {
          map.setPaintProperty(lineLayerId, "line-width", 2);
        }
      } else {
        map.addSource(sourceId, {
          type: "geojson",
          data,
        });

        map.addLayer({
          id: fillLayerId,
          type: "fill",
          source: sourceId,
          minzoom: ROOM_MIN_ZOOM,

          paint: {
            "fill-color": "#2563eb",
            "fill-opacity": 0.04,
          },
        });

        map.addLayer({
          id: lineLayerId,
          type: "line",
          source: sourceId,
          minzoom: ROOM_MIN_ZOOM,

          paint: {
            "line-color": "#1d4ed8",
            "line-width": 2,
            "line-opacity": 0.9,
          },
        });

        map.addLayer({
          id: "evacuation-centers-label",
          type: "symbol",
          source: sourceId,
          minzoom: ROOM_MIN_ZOOM,
          layout: {
            "text-field": ["get", "name"],
            "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
            "text-size": 11,
            "text-letter-spacing": 0.04,
            "text-transform": "uppercase",
            "text-anchor": "center",
            "text-max-width": 16,
            "text-allow-overlap": false,
          },
          paint: {
            "text-color": "#1e40af",
            "text-halo-color": "#ffffff",
            "text-halo-width": 2.5,
          },
        });
      }
    } catch (err) {
      console.warn("Error updating evacuation centers layer:", err);
      return;
    }

    const handleMouseEnter = () => {
      try {
        map.getCanvas().style.cursor = "pointer";
      } catch (e) { }
    };

    const handleMouseLeave = () => {
      try {
        map.getCanvas().style.cursor = pickingLocationRef.current
          ? "crosshair"
          : "";
      } catch (e) { }
    };

    const handleEvacCenterClick = (e) => {
      // If a building was clicked at this point, building details handles it
      try {
        const buildingHits = map.queryRenderedFeatures(e.point, {
          layers: ["evacway-buildings-fill", "evacway-buildings-outline"],
        });
        if (buildingHits && buildingHits.length > 0) {
          return;
        }
      } catch (err) {}

      const feature = e.features?.[0];

      if (!feature) {
        return;
      }

      setSelectedCenter(feature);
    };

    try {
      map.on("click", fillLayerId, handleEvacCenterClick);
      map.on("click", lineLayerId, handleEvacCenterClick);
      map.on("mouseenter", fillLayerId, handleMouseEnter);
      map.on("mouseleave", fillLayerId, handleMouseLeave);
      map.on("mouseenter", lineLayerId, handleMouseEnter);
      map.on("mouseleave", lineLayerId, handleMouseLeave);
    } catch (e) { }

    return () => {
      try {
        map.off("click", fillLayerId, handleEvacCenterClick);
        map.off("click", lineLayerId, handleEvacCenterClick);
        map.off("mouseenter", fillLayerId, handleMouseEnter);
        map.off("mouseleave", fillLayerId, handleMouseLeave);
        map.off("mouseenter", lineLayerId, handleMouseEnter);
        map.off("mouseleave", lineLayerId, handleMouseLeave);
      } catch (e) { }
    };
  }, [evacCenters, mapLoaded, mapStyle, styleVersion]);

  // --------------------------------------------------
  // Native Mapbox Entrance Markers (no DOM drift)
  // --------------------------------------------------
  const entrancesGeoJSON = useMemo(() => {
    if (!evacCenters?.features) return { type: "FeatureCollection", features: [] };
    const chosenEntrance = route?.chosen_entrance || route?.evacuation_center?.chosen_entrance;
    const targetCenterId = route?.evacuation_center?.id;
    const features = [];

    evacCenters.features.forEach((center) => {
      const properties = center.properties || {};
      const entrances = Array.isArray(properties.entrances) ? properties.entrances : [];
      entrances.forEach((entrance) => {
        if (!entrance) return;
        const coords = getValidCoordinates([
          entrance.lng ?? entrance.longitude,
          entrance.lat ?? entrance.latitude,
        ]);
        if (!coords) return;
        const isChosen =
          chosenEntrance &&
          ((chosenEntrance.id != null && entrance.id != null && String(chosenEntrance.id) === String(entrance.id)) ||
            (Math.abs(coords[1] - (chosenEntrance.latitude ?? chosenEntrance.lat)) < 0.0001 &&
              Math.abs(coords[0] - (chosenEntrance.longitude ?? chosenEntrance.lng)) < 0.0001));
        const isDimmed = !!(chosenEntrance && targetCenterId && properties.id === targetCenterId && !isChosen);

        features.push({
          type: "Feature",
          id: entrance.id,
          geometry: {
            type: "Point",
            coordinates: coords,
          },
          properties: {
            id: entrance.id,
            center_id: properties.id,
            name: entrance.name || "Entrance",
            is_chosen: isChosen,
            is_dimmed: isDimmed,
          },
        });
      });
    });

    return { type: "FeatureCollection", features };
  }, [evacCenters, route]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    initEntranceLayers(map);
    setEntrancesGeoJSON(map, entrancesGeoJSON);
  }, [mapLoaded, entrancesGeoJSON, mapStyle, styleVersion]);

  // --------------------------------------------------
  // Evacuation center ICONS (zoomed out)
  // Shows the center icon with its name.
  // --------------------------------------------------

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded || !evacCenters) {
      return;
    }

    const myCenterId = myCenter?.evacuation_center?.id;

    function removeCenterMarkers() {
      evacuationMarkersRef.current.forEach((marker) => marker.remove());

      evacuationMarkersRef.current = [];
    }

    function showCenterMarkers() {
      removeCenterMarkers();

      // Zoomed in: the outline and room icons are shown instead
      if (map.getZoom() >= ROOM_MIN_ZOOM) {
        return;
      }

      (evacCenters.features || []).forEach((center) => {
        const properties = center.properties || center || {};

        const centerCoords = getCenterCoordinates(center, buildingsGeoJSON);
        if (!centerCoords) {
          return;
        }
        const coordinates = [centerCoords.longitude, centerCoords.latitude];

        const centerId = properties.id ?? center.id;
        const isMine =
          myCenterId != null && String(centerId) === String(myCenterId);

        const centerName = displayEntityName(
          properties.name ?? center.name ?? properties.center_name,
          "Evacuation Center"
        );

        const cap = properties.capacity || 0;
        const occ = properties.occupied ?? properties.current_occupancy ?? 0;
        const pct = cap > 0 ? Math.min(100, Math.round((occ / cap) * 100)) : 0;

        let statusColor = "#16a34a"; // Green: Normal
        if (pct >= 90) {
          statusColor = "#dc2626"; // Red: Full
        } else if (pct >= 70) {
          statusColor = "#d97706"; // Amber: High
        }
        if (isMine) {
          statusColor = "#2563eb"; // Blue: User Center
        }

        const element = document.createElement("button");
        element.type = "button";
        element.className = `evacway-center-marker show-label${isMine ? " evacway-center-marker-mine" : ""}`;
        element.setAttribute(
          "aria-label",
          `Evacuation Center: ${centerName}, ${pct}% occupied`
        );

        const iconElement = document.createElement("span");
        iconElement.className = "evacway-center-icon";
        iconElement.style.setProperty("--pin-bg", statusColor);
        iconElement.style.backgroundColor = statusColor;
        iconElement.innerHTML = icon(faBuildingColumns).html.join("");

        const label = document.createElement("span");
        label.className = "evacway-center-label";

        const dot = document.createElement("span");
        dot.className = "evacway-center-label-dot";
        dot.style.backgroundColor = statusColor;

        const text = document.createElement("span");
        text.className = "evacway-center-label-text";
        text.textContent = centerName;

        label.appendChild(dot);
        label.appendChild(text);

        element.appendChild(iconElement);
        element.appendChild(label);

        element.addEventListener("click", (event) => {
          event.stopPropagation();
          setSelectedCenter(center);
        });

        const marker = new mapboxgl.Marker({
          element,
          anchor: "bottom",
        })
          .setLngLat(coordinates)
          .addTo(map);

        evacuationMarkersRef.current.push(marker);
      });
    }

    showCenterMarkers();

    map.on("zoom", showCenterMarkers);
    map.on("zoomend", showCenterMarkers);

    return () => {
      map.off("zoom", showCenterMarkers);
      map.off("zoomend", showCenterMarkers);

      removeCenterMarkers();
    };
  }, [evacCenters, mapLoaded, myCenter, buildingsGeoJSON]);

  // --------------------------------------------------
  // Native Mapbox Building Layers (clickable buildings instead of room pills)
  // --------------------------------------------------

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    window.__mapboxMap = map;
    window.__evacwaySelectBuilding = (bId) => {
      const bFeature = buildingsGeoJSON?.features?.find(
        (f) => String(f.id) === String(bId) || String(f.properties?.id) === String(bId)
      );
      setSelectedBuildingId(bId);
      setSelectedBuildingData(bFeature?.properties || { id: bId });
      setBuildingModalOpen(true);
    };

    initBuildingLayers(
      map,
      (buildingFeature) => {
        const bProps = buildingFeature.properties || {};
        const bId = bProps.id ?? buildingFeature.id;
        setSelectedBuildingId(bId);
        setSelectedBuildingData(bProps);
        setBuildingModalOpen(true);
      },
      { enableTooltip: true }
    );

    setBuildingsGeoJSON(map, buildingsGeoJSON);
    setSelectedBuilding(map, selectedBuildingId);

    let userBldgId = null;
    if (myCenter?.room) {
      if (myCenter.room.building_id != null) {
        userBldgId = Number(myCenter.room.building_id);
      }
      if (!userBldgId && myCenter.room.building_name && buildingsGeoJSON?.features) {
        const targetName = myCenter.room.building_name.trim().toLowerCase();
        const bFeat = buildingsGeoJSON.features.find(
          (f) => f.properties?.name && f.properties.name.trim().toLowerCase() === targetName
        );
        if (bFeat) {
          userBldgId = Number(bFeat.properties?.id ?? bFeat.id);
        }
      }
      if (!userBldgId && buildingsGeoJSON?.features) {
        const myRoomNum = String(myCenter.room.room_number || "").replace(/^Room\s*/i, "").trim();
        const myRoomId = myCenter.room.id != null ? String(myCenter.room.id) : null;
        const bFeat = buildingsGeoJSON.features.find((f) => {
          const rList = f.properties?.rooms;
          if (!Array.isArray(rList)) return false;
          return rList.some((r) => {
            const rNum = String(r.room_number || "").replace(/^Room\s*/i, "").trim();
            const rId = r.id != null ? String(r.id) : null;
            return (myRoomId && rId === myRoomId) || (myRoomNum && rNum === myRoomNum);
          });
        });
        if (bFeat) {
          userBldgId = Number(bFeat.properties?.id ?? bFeat.id);
        }
      }
    }

    if (userBldgId != null) {
      setUserBuilding(map, userBldgId);
    } else {
      setUserBuilding(map, null);
    }

    // Completely remove the "Your room" pin marker from the map (only highlight the building)
    if (userRoomMarkerRef.current) {
      userRoomMarkerRef.current.remove();
      userRoomMarkerRef.current = null;
    }
  }, [mapLoaded, buildingsGeoJSON, mapStyle, styleVersion, selectedBuildingId, myCenter]);

  // --------------------------------------------------
  // Add user's current location
  // --------------------------------------------------

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded || !myLocation) {
      return;
    }

    const userCoordinates = getValidCoordinates([
      myLocation.lng,
      myLocation.lat,
    ]);

    if (!userCoordinates) {
      console.warn("Invalid user location:", myLocation);

      return;
    }

    const oldMarker = routeMarkersRef.current.find(
      (marker) => marker.__isUserMarker
    );

    if (oldMarker && oldMarker.__navMode === navigationActive) {
      oldMarker.setLngLat(userCoordinates);
      if (navigationActive) {
        const arrow = oldMarker.getElement()?.querySelector(".nav-arrow-svg");
        if (arrow) {
          const heading = myLocation.heading || lastHeadingRef.current || 0;
          arrow.style.transform = `rotate(${heading}deg)`;
        }
      }
    } else {
      if (oldMarker) {
        oldMarker.remove();

        routeMarkersRef.current = routeMarkersRef.current.filter(
          (marker) => marker !== oldMarker
        );
      }

      const markerElement = navigationActive
        ? createNavigationArrowMarker(myLocation.heading || lastHeadingRef.current || 0)
        : createMyLocationMarker();

      userMarkerElementRef.current = markerElement;

      const popup = new mapboxgl.Popup({
        offset: 12,
      }).setText(navigationActive ? "Your live location" : "You are here");

      const marker = new mapboxgl.Marker({
        element: markerElement,
        anchor: "center",
      })
        .setLngLat(userCoordinates)
        .setPopup(popup)
        .addTo(map);

      marker.__isUserMarker = true;
      marker.__navMode = navigationActive;

      routeMarkersRef.current.push(marker);
    }

    setOrUpdateAccuracyCircle(
      map,
      userCoordinates[0],
      userCoordinates[1],
      navigationActive ? Math.min(myLocation.accuracy || 30, 80) : (myLocation.accuracy || 30)
    );
  }, [myLocation, navigationActive, mapLoaded, styleVersion]);

  // --------------------------------------------------
  // Draw evacuation route
  // --------------------------------------------------

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded) {
      return;
    }

    const sourceId = "evacuation-route";
    const walkedSourceId = "evacuation-route-walked";
    const casingLayerId = "evacuation-route-casing";
    const layerId = "evacuation-route-line";
    const walkedLayerId = "evacuation-route-walked-line";

    if (arrowAnimRef.current) {
      cancelAnimationFrame(arrowAnimRef.current);
      arrowAnimRef.current = null;
    }
    cancelAnimationFrame(flowFrameRef.current);
    flowFrameRef.current = null;

    try {
      for (let k = 0; k < 4; k++) {
        if (map.getLayer(`evacuation-route-arrows-${k}`)) {
          map.removeLayer(`evacuation-route-arrows-${k}`);
        }
      }
      if (map.getLayer("evacuation-route-arrows")) map.removeLayer("evacuation-route-arrows");
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getLayer(casingLayerId)) map.removeLayer(casingLayerId);
      if (map.getLayer(walkedLayerId)) map.removeLayer(walkedLayerId);
      if (map.getLayer("evacuation-route-flow")) map.removeLayer("evacuation-route-flow");

      if (map.getSource("evacuation-route-arrows-source")) {
        map.removeSource("evacuation-route-arrows-source");
      }
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      if (map.getSource(walkedSourceId)) map.removeSource(walkedSourceId);
    } catch (err) {
      // Style may not be ready
    }

    routeMarkersRef.current
      .filter((marker) => !marker.__isUserMarker)
      .forEach((marker) => marker.remove());

    routeMarkersRef.current = routeMarkersRef.current.filter(
      (marker) => marker.__isUserMarker
    );

    if (!route || !Array.isArray(route.route) || route.route.length === 0) {
      return;
    }

    const routeCoordinates = route.route
      .map((point) => {
        if (!Array.isArray(point) || point.length < 2) {
          return null;
        }

        const lat = Number(point[0]);
        const lng = Number(point[1]);

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          return null;
        }

        return [lng, lat];
      })
      .filter(Boolean);

    if (routeCoordinates.length === 0) {
      setRouteError("The evacuation route contains invalid coordinates.");
      return;
    }

    ensureArrowImage(map);

    try {
      map.addSource(sourceId, {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: routeCoordinates,
          },
          properties: {},
        },
      });

      map.addSource(walkedSourceId, {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [],
          },
          properties: {},
        },
      });

      // Walked portion (dimmed, dashed)
      map.addLayer({
        id: walkedLayerId,
        type: "line",
        source: walkedSourceId,
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": "#94a3b8",
          "line-width": 4,
          "line-opacity": 0.45,
          "line-dasharray": [2, 2],
        },
      });

      const isNarrowScreen = isMobile || (typeof window !== "undefined" && window.innerWidth <= 768);

      // White casing behind active route
      map.addLayer({
        id: casingLayerId,
        type: "line",
        source: sourceId,
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": "#ffffff",
          "line-width": isNarrowScreen ? 7.5 : 8.5,
          "line-opacity": 0.95,
        },
      });

      // Solid blue route line (thinner on mobile, solid with no dash pattern)
      map.addLayer({
        id: layerId,
        type: "line",
        source: sourceId,
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": "#2563eb",
          "line-width": isNarrowScreen ? 5 : 5.5,
          "line-opacity": 1.0,
        },
      });

      // Final leg: short dashed lighter line connecting snapped road point to exact entrance
      const finalLegSourceId = "evacuation-route-final-leg-source";
      const finalLegLayerId = "evacuation-route-final-leg-layer";

      if (map.getLayer(finalLegLayerId)) map.removeLayer(finalLegLayerId);
      if (map.getSource(finalLegSourceId)) map.removeSource(finalLegSourceId);

      if (Array.isArray(route.final_leg) && route.final_leg.length >= 2) {
        map.addSource(finalLegSourceId, {
          type: "geojson",
          data: {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: route.final_leg,
            },
          },
        });

        map.addLayer({
          id: finalLegLayerId,
          type: "line",
          source: finalLegSourceId,
          layout: {
            "line-cap": "round",
            "line-join": "round",
          },
          paint: {
            "line-color": "#60a5fa",
            "line-width": 4.5,
            "line-opacity": 0.95,
            "line-dasharray": [2, 2],
          },
        });
      }

      // Direction chevron arrows along the route (sampled every ~50m)
      const arrowPoints = generateRouteArrowPoints(routeCoordinates, 50);
      map.addSource("evacuation-route-arrows-source", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: arrowPoints,
        },
      });

      for (let k = 0; k < 4; k++) {
        map.addLayer({
          id: `evacuation-route-arrows-${k}`,
          type: "symbol",
          source: "evacuation-route-arrows-source",
          filter: ["==", ["get", "phase"], k],
          layout: {
            "icon-image": "route-chevron-arrow",
            "icon-rotate": ["get", "bearing"],
            "icon-rotation-alignment": "map",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "icon-size": [
              "interpolate",
              ["linear"],
              ["zoom"],
              12, 0.45,
              15, 0.65,
              18, 0.9,
            ],
          },
          paint: {
            "icon-opacity": 0.85,
          },
        });
      }

      // Wave animation moving along the route: pulses between 0.3 and 1.0, cycle 1.5s
      const prefersReducedMotion =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      if (!prefersReducedMotion) {
        let lastTime = 0;
        const cycleMs = 1500;
        const animateArrows = () => {
          const now = Date.now();
          if (!document.hidden && now - lastTime >= 33) {
            lastTime = now;
            const progress = (now % cycleMs) / cycleMs;
            for (let k = 0; k < 4; k++) {
              const p = (progress - k / 4 + 1.0) % 1.0;
              const opacity = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(p * 2 * Math.PI));
              const layerName = `evacuation-route-arrows-${k}`;
              if (map.getLayer(layerName)) {
                map.setPaintProperty(layerName, "icon-opacity", opacity);
              }
            }
          }
          arrowAnimRef.current = requestAnimationFrame(animateArrows);
        };
        arrowAnimRef.current = requestAnimationFrame(animateArrows);
      }
    } catch (err) {
      console.warn("Error drawing route layers:", err);
      return;
    }

    const destination = route.evacuation_center;
    if (!destination) {
      return;
    }

    const destinationCoordinates = getValidCoordinates([
      destination.longitude ?? destination.lng,
      destination.latitude ?? destination.lat,
    ]);

    if (!destinationCoordinates) {
      console.warn("Invalid evacuation route destination:", destination);
      return;
    }

    const destinationElement = createSimpleMarker(
      "evacuation-destination-marker"
    );

    const destinationPopupContent = document.createElement("div");
    const destinationName = document.createElement("strong");
    destinationName.textContent = destination.name || "Evacuation Center";

    const destinationInfo = document.createElement("div");
    destinationInfo.textContent = `${route.distance_km ?? "?"} km away - about ${
      route.estimated_time_min ?? "?"
    } min`;

    destinationPopupContent.appendChild(destinationName);
    destinationPopupContent.appendChild(destinationInfo);

    const destinationPopup = new mapboxgl.Popup({
      offset: 12,
    }).setDOMContent(destinationPopupContent);

    const destinationMarker = new mapboxgl.Marker({
      element: destinationElement,
      anchor: "center",
    })
      .setLngLat(destinationCoordinates)
      .setPopup(destinationPopup)
      .addTo(map);

    destinationMarker.__isUserMarker = false;
    routeMarkersRef.current.push(destinationMarker);

    const coordinates = [destinationCoordinates, ...routeCoordinates];
    if (coordinates.length > 0 && !navigationActive) {
      const bounds = new mapboxgl.LngLatBounds();
      coordinates.forEach((coordinate) => {
        bounds.extend(coordinate);
      });

      const isNarrow = isMobile || (typeof window !== "undefined" && window.innerWidth <= 768);
      map.fitBounds(bounds, {
        padding: isNarrow
          ? { top: 70, bottom: 260, left: 24, right: 24 }
          : { top: 120, bottom: 100, left: 60, right: 60 },
        duration: 1000,
        maxZoom: 16,
        pitch: 0,
        bearing: 0,
      });
    }

    return () => {
      if (arrowAnimRef.current) {
        cancelAnimationFrame(arrowAnimRef.current);
        arrowAnimRef.current = null;
      }
      try {
        if (map.isStyleLoaded()) {
          for (let k = 0; k < 4; k++) {
            if (map.getLayer(`evacuation-route-arrows-${k}`)) {
              map.removeLayer(`evacuation-route-arrows-${k}`);
            }
          }
          if (map.getSource("evacuation-route-arrows-source")) {
            map.removeSource("evacuation-route-arrows-source");
          }
          if (map.getLayer(layerId)) map.removeLayer(layerId);
          if (map.getLayer(casingLayerId)) map.removeLayer(casingLayerId);
          if (map.getLayer(walkedLayerId)) map.removeLayer(walkedLayerId);
          if (map.getLayer("evacuation-route-final-leg-layer")) map.removeLayer("evacuation-route-final-leg-layer");
          if (map.getSource("evacuation-route-final-leg-source")) map.removeSource("evacuation-route-final-leg-source");
        }
      } catch (err) {
        // ignore
      }
    };
  }, [route, mapLoaded, mapStyle, styleVersion]);

  // --------------------------------------------------
  // Enable browser location
  // --------------------------------------------------

  function handleEnableLocation() {
    setRouteError("");

    if (!navigator.geolocation) {
      setRouteError("Your browser doesn't support location access.");

      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
        setMyLocation(loc);
        setLocationPermission("granted");
        accuracyCircleStateRef.current = loc;
        handleFindRoute();
      },

      (err) => {
        setLocationPermission("denied");

        const messages = {
          1: "Location access was denied. Enable it in your browser's site settings (click the lock icon next to the address bar).",

          2: "Your location couldn't be determined. Check that Location Services is turned on in Windows Settings.",

          3: "Getting your location took too long. Try again.",
        };

        setRouteError(messages[err.code] || "Couldn't get your location.");
      },

      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  }

  // --------------------------------------------------
  // Find a route
  //
  // If the resident is verified, the route goes to
  // THEIR assigned evacuation center. Otherwise it goes
  // to the nearest one.
  // --------------------------------------------------

  function handleFindRoute(targetCenterId = null) {
    setRouteError("");
    setRoute(null);
    routeDataRef.current = null;
    stopWalkingNavigation("");

    if (!navigator.geolocation) {
      setRouteError("Your browser doesn't support location access.");

      return;
    }

    const assignedCenterId =
      targetCenterId != null
        ? targetCenterId
        : (myCenter?.evacuation_center?.id ?? null);

    setFindingRoute(true);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const loc = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };

        setMyLocation(loc);
        setLocationPermission("granted");
        accuracyCircleStateRef.current = loc;

        try {
          const result =
            assignedCenterId != null
              ? await api.getEvacuationRoute(
                pos.coords.latitude,
                pos.coords.longitude,
                assignedCenterId
              )
              : await api.getEvacuationRoute(
                pos.coords.latitude,
                pos.coords.longitude
              );

          setRouteIsMine(
            myCenter?.evacuation_center?.id != null &&
            String(assignedCenterId) === String(myCenter.evacuation_center.id)
          );

          let routeToDisplay = result;
          if (result.error) {
            setRouteError(result.error);
            setFindingRoute(false);
            return;
          }

          if (result.evacuation_center) {
            try {
              const walkingTarget = result.chosen_entrance || result.evacuation_center;
              const walkingDirections = await getWalkingDirections(
                [pos.coords.latitude, pos.coords.longitude],
                walkingTarget
              );
              routeToDisplay = {
                ...result,
                ...walkingDirections,
                route: result.route && result.route.length > 0 ? result.route : walkingDirections.route,
                distance_km: result.distance_km ?? walkingDirections.distance_km,
                estimated_time_min: result.estimated_time_min ?? walkingDirections.estimated_time_min,
                walking_steps: walkingDirections.walking_steps,
                final_leg: result.final_leg,
                start_leg: result.start_leg,
                chosen_entrance: result.chosen_entrance,
              };
            } catch (directionsError) {
              setRouteError(
                directionsError.message ||
                "Turn-by-turn directions are unavailable. Showing the available evacuation route."
              );
            }
          } else {
            setRouteError("Walking directions are unavailable for this route.");
          }

          activeEntranceRef.current = routeToDisplay.chosen_entrance || null;
          routeDataRef.current = routeToDisplay;
          setRoute(routeToDisplay);
          activeWalkingStepRef.current = 0;
          setActiveWalkingStep(0);
          const remainingMeters = routeToDisplay.walking_distance_meters ?? (routeToDisplay.distance_km ? routeToDisplay.distance_km * 1000 : null);
          const remainingSeconds = routeToDisplay.walking_duration_seconds ?? (routeToDisplay.estimated_time_min ? routeToDisplay.estimated_time_min * 60 : null);
          setNavigationRemainingMeters(remainingMeters);
          navigationRemainingMetersRef.current = remainingMeters;
          setNavigationRemainingSeconds(remainingSeconds);

          setLocationPermission("granted");
        } catch (err) {
          setRouteError(err.message || "Failed to find an evacuation route.");
        } finally {
          setFindingRoute(false);
        }
      },

      (err) => {
        const messages = {
          1: "Location access was denied. Please allow location access in your browser and try again.",

          2: "Your location couldn't be determined. Check that Location Services is turned on in Windows Settings.",

          3: "Getting your location took too long. Check that Location Services is turned on in Windows Settings, then try again.",
        };

        setRouteError(messages[err.code] || "Couldn't get your location.");

        setFindingRoute(false);
      },

      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  }

  // Listen for user map drag to pause auto-following and show recenter button
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    function handleDragStart() {
      if (navigationActiveRef.current) {
        setIsPannedAway(true);
        autoFollowRef.current = false;
      }
    }

    map.on("dragstart", handleDragStart);
    return () => {
      map.off("dragstart", handleDragStart);
    };
  }, [mapLoaded]);

  const handleRecenter = () => {
    setIsPannedAway(false);
    autoFollowRef.current = true;
    const map = mapRef.current;
    const loc = liveUserLocationRef.current || myLocation;
    if (map && loc) {
      map.easeTo({
        center: [loc.lng, loc.lat],
        zoom: Math.max(map.getZoom(), 16.5),
        pitch: 0,
        bearing: 0,
        duration: 500,
      });
    }
  };

  function stopWalkingNavigation(status = "Navigation stopped.") {
    navigationActiveRef.current = false;
    setNavigationActive(false);
    setNavigationStatus(status);
    setIsPannedAway(false);
    setNavPillExpanded(false);
    autoFollowRef.current = true;

    if (navigationWatchIdRef.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(navigationWatchIdRef.current);
      navigationWatchIdRef.current = null;
    }

    const map = mapRef.current;
    if (map) {
      removeAccuracyCircle(map);
      // Restore full route on map if route exists
      const latestRoute = routeDataRef.current || route;
      if (latestRoute && Array.isArray(latestRoute.route) && map.isStyleLoaded()) {
        const remSource = map.getSource("evacuation-route");
        if (remSource) {
          remSource.setData({
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: latestRoute.route.map(([lat, lng]) => [lng, lat]),
            },
            properties: {},
          });
        }
        const walkedSource = map.getSource("evacuation-route-walked");
        if (walkedSource) {
          walkedSource.setData({
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: [],
            },
            properties: {},
          });
        }
        const arrowsSource = map.getSource("evacuation-route-arrows-source");
        if (arrowsSource) {
          arrowsSource.setData({
            type: "FeatureCollection",
            features: generateRouteArrowPoints(
              latestRoute.route.map(([lat, lng]) => [lng, lat]),
              50
            ),
          });
        }
      }
    }
  }

  function handleStartWalkingNavigation() {
    const currentRoute = routeDataRef.current || route;
    const destination = currentRoute?.evacuation_center;

    if (!navigator.geolocation) {
      setRouteError("Your browser doesn't support live location tracking.");
      return;
    }

    if (!destination) {
      setRouteError("This route has no evacuation-center destination.");
      return;
    }

    if (navigationWatchIdRef.current != null) {
      navigator.geolocation.clearWatch(navigationWatchIdRef.current);
      navigationWatchIdRef.current = null;
    }

    setRouteError("");
    setArrivalToast("");
    navigationActiveRef.current = true;
    setNavigationActive(true);
    setNavigationStatus("Starting navigation...");
    lastRerouteAtRef.current = 0;
    consecutiveOffRouteRef.current = 0;
    autoFollowRef.current = true;
    setIsPannedAway(false);

    // Initial flat camera: Pitch 0, Bearing 0 (North-up)
    const map = mapRef.current;
    if (map && myLocation) {
      map.easeTo({
        center: [myLocation.lng, myLocation.lat],
        zoom: Math.max(map.getZoom(), 16.5),
        pitch: 0,
        bearing: 0,
        duration: 600,
      });
    }

    if (Array.isArray(currentRoute?.route) && currentRoute.route.length >= 2) {
      lastHeadingRef.current = calculateBearing(
        currentRoute.route[0][0],
        currentRoute.route[0][1],
        currentRoute.route[1][0],
        currentRoute.route[1][1]
      );
    }

    navigationWatchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        if (!navigationActiveRef.current) return;

        const rawLat = position.coords.latitude;
        const rawLng = position.coords.longitude;
        const accuracy = Math.round(position.coords.accuracy || 0);
        setNavigationAccuracy(accuracy);
        setLocationPermission("granted");

        // Ignore GPS readings with very poor accuracy (over 100m) to avoid wild jumps
        if (accuracy > 100) {
          return;
        }

        const rawLocation = [rawLat, rawLng];
        liveUserLocationRef.current = { lat: rawLat, lng: rawLng };

        const latestRoute = routeDataRef.current || currentRoute;
        const target = latestRoute?.evacuation_center || destination;
        const chosenEntrance = latestRoute?.chosen_entrance || target?.chosen_entrance || activeEntranceRef.current;
        const arrivalCoordinates = chosenEntrance
          ? getValidCoordinates([
              chosenEntrance.longitude ?? chosenEntrance.lng,
              chosenEntrance.latitude ?? chosenEntrance.lat,
            ])
          : getValidCoordinates([
              target.longitude ?? target.lng,
              target.latitude ?? target.lat,
            ]);

        // Check arrival (within 20m of chosen entrance)
        if (arrivalCoordinates) {
          const arrivalLatLng = [arrivalCoordinates[1], arrivalCoordinates[0]];
          const distToDest = getDistanceMeters(rawLocation, arrivalLatLng);
          if (distToDest <= 20) {
            setNavigationRemainingMeters(0);
            navigationRemainingMetersRef.current = 0;
            setNavigationRemainingSeconds(0);
            const entranceName = chosenEntrance?.name ? ` (${chosenEntrance.name})` : "";
            const arrivalMsg = `You have arrived at ${target.name || "the evacuation center"}${entranceName}!`;
            setArrivalToast(arrivalMsg);

            // Auto check-in if user has assigned center
            const targetCenterId = target?.id || target?.center_id;
            if (myCenter && !myCenter.is_checked_in && targetCenterId) {
              api.autoGeofenceCheckIn({
                center_id: targetCenterId,
                resident_id: myCenter.resident_id,
                family_id: myCenter.family_id,
                latitude: rawLat,
                longitude: rawLng,
              }).then((res) => {
                if (res.success) {
                  setMyCenter((prev) => (prev ? { ...prev, is_checked_in: true, checkin_status: "Checked in" } : prev));
                }
              }).catch(() => {});
            }

            stopWalkingNavigation(arrivalMsg);
            return;
          }
        }

        // Snap user to nearest point on route
        const routePoints = latestRoute?.route || [];
        const snap = snapLocationToRoute(rawLocation, routePoints);

        // Compute heading: GPS heading -> delta displacement -> route direction
        let heading =
          Number.isFinite(position.coords.heading) && position.coords.heading >= 0
            ? position.coords.heading
            : null;

        if (heading == null && previousLocationRef.current) {
          const movedDist = getDistanceMeters(
            [previousLocationRef.current.lat, previousLocationRef.current.lng],
            rawLocation
          );
          if (movedDist >= 1.5) {
            heading = calculateBearing(
              previousLocationRef.current.lat,
              previousLocationRef.current.lng,
              rawLat,
              rawLng
            );
          }
        }

        if (heading == null && snap.remainingPoints.length >= 2) {
          heading = calculateBearing(
            snap.remainingPoints[0][0],
            snap.remainingPoints[0][1],
            snap.remainingPoints[1][0],
            snap.remainingPoints[1][1]
          );
        }

        if (heading != null) {
          lastHeadingRef.current = heading;
        } else {
          heading = lastHeadingRef.current;
        }

        previousLocationRef.current = { lat: rawLat, lng: rawLng };

        // For display: use snapped position along route if user is within corridor (<= 30m)
        const displayLat = snap.distanceToRoute <= 30 ? snap.snappedPoint[0] : rawLat;
        const displayLng = snap.distanceToRoute <= 30 ? snap.snappedPoint[1] : rawLng;
        setMyLocation({ lat: displayLat, lng: displayLng, heading, accuracy });

        // Update route line on map: trim walked portion, keep remaining portion
        const currentMap = mapRef.current;
        if (currentMap && currentMap.isStyleLoaded()) {
          const remSource = currentMap.getSource("evacuation-route");
          if (remSource) {
            remSource.setData({
              type: "Feature",
              geometry: {
                type: "LineString",
                coordinates: snap.remainingPoints.map(([lat, lng]) => [lng, lat]),
              },
              properties: {},
            });
          }

          const walkedSource = currentMap.getSource("evacuation-route-walked");
          if (walkedSource) {
            walkedSource.setData({
              type: "Feature",
              geometry: {
                type: "LineString",
                coordinates: snap.walkedPoints.map(([lat, lng]) => [lng, lat]),
              },
              properties: {},
            });
          }

          const arrowsSource = currentMap.getSource("evacuation-route-arrows-source");
          if (arrowsSource && snap.remainingPoints && snap.remainingPoints.length >= 2) {
            arrowsSource.setData({
              type: "FeatureCollection",
              features: generateRouteArrowPoints(
                snap.remainingPoints.map(([lat, lng]) => [lng, lat]),
                50
              ),
            });
          }

          // Flat camera: smooth pan if autoFollow is active (pitch 0, bearing 0)
          if (autoFollowRef.current) {
            currentMap.easeTo({
              center: [displayLng, displayLat],
              pitch: 0,
              bearing: 0,
              duration: 400,
            });
          }

          // Soft accuracy circle
          setOrUpdateAccuracyCircle(
            currentMap,
            displayLng,
            displayLat,
            Math.min(accuracy, 80)
          );
        }

        // Calculate remaining distance and time
        let remainingDistance = 0;
        for (let i = 0; i < snap.remainingPoints.length - 1; i++) {
          remainingDistance += getDistanceMeters(
            snap.remainingPoints[i],
            snap.remainingPoints[i + 1]
          );
        }
        setNavigationRemainingMeters(Math.round(remainingDistance));
        setNavigationRemainingSeconds(Math.ceil(remainingDistance / 1.38));

        // Advance walking steps
        const steps = latestRoute?.walking_steps || [];
        if (steps.length > 0) {
          let nextStepIdx = activeWalkingStepRef.current;
          const currentManeuverLoc = steps[nextStepIdx]?.maneuver?.location;
          if (Array.isArray(currentManeuverLoc)) {
            const distToManeuver = getDistanceMeters(rawLocation, [
              currentManeuverLoc[1],
              currentManeuverLoc[0],
            ]);
            if (distToManeuver <= 15 && nextStepIdx < steps.length - 1) {
              nextStepIdx += 1;
            }
          }
          activeWalkingStepRef.current = nextStepIdx;
          setActiveWalkingStep(nextStepIdx);
          setNavigationStatus(
            steps[nextStepIdx]?.maneuver?.instruction || "Continue along route"
          );
        } else {
          setNavigationStatus("Follow the highlighted route to the center.");
        }

        // Off-route check: if > 30m for consecutive updates
        if (snap.distanceToRoute > 30) {
          consecutiveOffRouteRef.current += 1;
          const now = Date.now();
          if (
            consecutiveOffRouteRef.current >= 3 &&
            !reroutingRef.current &&
            now - lastRerouteAtRef.current > 12000
          ) {
            reroutingRef.current = true;
            lastRerouteAtRef.current = now;
            setNavigationStatus("Off route, recalculating...");

            const targetCenterId = target?.id || target?.center_id;
            api.getEvacuationRoute(rawLocation[0], rawLocation[1], targetCenterId)
              .then(async (backendResult) => {
                let candidateEntrance = backendResult?.chosen_entrance;
                const currentEntrance = activeEntranceRef.current || latestRoute?.chosen_entrance;

                // Hysteresis: only switch if another entrance becomes at least 20% and 100m shorter
                if (currentEntrance && candidateEntrance && candidateEntrance.id !== currentEntrance.id) {
                  const currentMeters = navigationRemainingMetersRef.current ?? (latestRoute.distance_km ? latestRoute.distance_km * 1000 : 999999);
                  const candidateMeters = (backendResult.distance_km ?? 0) * 1000;
                  const isSignificantlyShorter = (candidateMeters <= currentMeters - 100) && (candidateMeters <= currentMeters * 0.8);
                  if (!isSignificantlyShorter) {
                    console.log(`[Navigation] Retaining current entrance "${currentEntrance.name}" (candidate "${candidateEntrance.name}" was not >= 20% and 100m shorter)`);
                    candidateEntrance = currentEntrance;
                  } else {
                    console.log(`[Navigation] Switching to entrance "${candidateEntrance.name}" (${candidateMeters}m vs ${currentMeters}m)`);
                    activeEntranceRef.current = candidateEntrance;
                  }
                } else if (candidateEntrance) {
                  activeEntranceRef.current = candidateEntrance;
                }

                const walkingTarget = candidateEntrance || target;
                const walkingDirections = await getWalkingDirections(rawLocation, walkingTarget).catch(() => null);

                const updatedRoute = {
                  ...latestRoute,
                  ...backendResult,
                  ...(walkingDirections || {}),
                  route: backendResult.route && backendResult.route.length > 0 ? backendResult.route : (walkingDirections?.route || latestRoute.route),
                  chosen_entrance: candidateEntrance,
                  final_leg: backendResult.final_leg || latestRoute.final_leg,
                };

                routeDataRef.current = updatedRoute;
                setRoute(updatedRoute);
                activeWalkingStepRef.current = 0;
                setActiveWalkingStep(0);
                consecutiveOffRouteRef.current = 0;

                const remainingMeters = walkingDirections?.walking_distance_meters ?? (backendResult.distance_km ? backendResult.distance_km * 1000 : null);
                const remainingSeconds = walkingDirections?.walking_duration_seconds ?? (backendResult.estimated_time_min ? backendResult.estimated_time_min * 60 : null);
                setNavigationRemainingMeters(remainingMeters);
                navigationRemainingMetersRef.current = remainingMeters;
                setNavigationRemainingSeconds(remainingSeconds);
                setNavigationStatus("Route updated");
              })
              .catch((err) => {
                setNavigationStatus(err.message || "Unable to recalculate route.");
              })
              .finally(() => {
                reroutingRef.current = false;
              });
          }
        } else {
          consecutiveOffRouteRef.current = 0;
        }
      },
      (error) => {
        const messages = {
          1: "Location access was denied. Allow location access to navigate.",
          2: "GPS signal was lost. Check Location Services and try again.",
          3: "GPS update timed out. Keep navigation open and try again.",
        };
        stopWalkingNavigation("GPS tracking stopped.");
        setRouteError(messages[error.code] || "Live location tracking failed.");
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 1000,
      }
    );
  }

  // --------------------------------------------------
  // Clear route
  // --------------------------------------------------

  function handleClearRoute() {
    stopWalkingNavigation("");
    setRoute(null);
    routeDataRef.current = null;
    activeEntranceRef.current = null;
    navigationRemainingMetersRef.current = null;
    setRouteError("");
    setArrivalToast("");
    setNavPillExpanded(false);

    if (arrowAnimRef.current) {
      cancelAnimationFrame(arrowAnimRef.current);
      arrowAnimRef.current = null;
    }

    const map = mapRef.current;
    if (!map) {
      return;
    }

    try {
      if (map.isStyleLoaded()) {
        for (let k = 0; k < 4; k++) {
          if (map.getLayer(`evacuation-route-arrows-${k}`)) {
            map.removeLayer(`evacuation-route-arrows-${k}`);
          }
        }
        if (map.getLayer("evacuation-route-arrows")) map.removeLayer("evacuation-route-arrows");
        if (map.getLayer("evacuation-route-line")) map.removeLayer("evacuation-route-line");
        if (map.getLayer("evacuation-route-casing")) map.removeLayer("evacuation-route-casing");
        if (map.getLayer("evacuation-route-walked-line")) map.removeLayer("evacuation-route-walked-line");
        if (map.getLayer("evacuation-route-flow")) map.removeLayer("evacuation-route-flow");
        if (map.getLayer("evacuation-route-final-leg-layer")) map.removeLayer("evacuation-route-final-leg-layer");

        if (map.getSource("evacuation-route-arrows-source")) {
          map.removeSource("evacuation-route-arrows-source");
        }
        if (map.getSource("evacuation-route")) map.removeSource("evacuation-route");
        if (map.getSource("evacuation-route-walked")) map.removeSource("evacuation-route-walked");
        if (map.getSource("evacuation-route-final-leg-source")) {
          map.removeSource("evacuation-route-final-leg-source");
        }
      }
      removeAccuracyCircle(map);
    } catch (err) {
      // ignore
    }

    routeMarkersRef.current
      .filter((marker) => !marker.__isUserMarker)
      .forEach((marker) => marker.remove());

    routeMarkersRef.current = routeMarkersRef.current.filter(
      (marker) => marker.__isUserMarker
    );
  }

  // --------------------------------------------------
  // Locate user
  // --------------------------------------------------

  function handleLocateMe() {
    setRouteError("");

    if (!navigator.geolocation) {
      setRouteError("Your browser doesn't support location access.");

      return;
    }

    setLocating(true);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };

        setMyLocation(loc);
        setLocationPermission("granted");
        accuracyCircleStateRef.current = loc;

        const map = mapRef.current;

        if (map) {
          map.flyTo({
            center: [loc.lng, loc.lat],
            zoom: 16,
            pitch: 0,
            bearing: 0,
            duration: 1000,
            essential: true,
          });
          setOrUpdateAccuracyCircle(map, loc.lng, loc.lat, loc.accuracy || 30);
        }

        setLocating(false);
      },

      (err) => {
        const messages = {
          1: "Location access was denied. Enable it in your browser's site settings.",

          2: "Your location couldn't be determined. Check that Location Services is turned on in Windows Settings.",

          3: "Getting your location took too long. Try again.",
        };

        setRouteError(messages[err.code] || "Couldn't get your location.");

        setLocating(false);
      },

      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  }

  // --------------------------------------------------
  // Hazard reporting
  // --------------------------------------------------

  function handleReportMapClick() {
    if (!user) {
      openLoginDialog("Please log in or sign up to report a hazard. Verified accounts help response teams validate danger zones quickly.");
      return;
    }
    pickingPurposeRef.current = "hazard";
    setPickingLocation(true);
    setPendingReportLocation(null);
  }

  function handleReportLocationChange(newLoc) {
    setPendingReportLocation(newLoc);
    accuracyCircleStateRef.current = newLoc;
    const map = mapRef.current;
    if (map) {
      map.flyTo({
        center: [newLoc.lng, newLoc.lat],
        zoom: Math.max(map.getZoom(), 16),
        essential: true,
      });
      setMyLocation({ lat: newLoc.lat, lng: newLoc.lng, accuracy: newLoc.accuracy });
      setOrUpdateAccuracyCircle(map, newLoc.lng, newLoc.lat, newLoc.accuracy || 30);
      setOrUpdateSelectedLocationMarker(map, selectedLocationMarkerRef, newLoc, (updatedLoc) => {
        setPendingReportLocation(updatedLoc);
      });
    }
  }

  function handleCloseReportModal() {
    setPendingReportLocation(null);
    if (selectedLocationMarkerRef.current) {
      selectedLocationMarkerRef.current.remove();
      selectedLocationMarkerRef.current = null;
    }
    accuracyCircleStateRef.current = null;
    removeAccuracyCircle(mapRef.current);
  }

  function handleReportSubmitted() {
    setPendingReportLocation(null);
    setPickingLocation(false);
    if (selectedLocationMarkerRef.current) {
      selectedLocationMarkerRef.current.remove();
      selectedLocationMarkerRef.current = null;
    }
    accuracyCircleStateRef.current = null;
    removeAccuracyCircle(mapRef.current);

    setReportConfirmation(
      "Thank you - your report has been submitted for review."
    );

    setTimeout(() => setReportConfirmation(""), 4000);
  }

  function handleCloseRescueModal() {
    setRescueAlertOpen(false);
    if (selectedLocationMarkerRef.current) {
      selectedLocationMarkerRef.current.remove();
      selectedLocationMarkerRef.current = null;
    }
    accuracyCircleStateRef.current = null;
    removeAccuracyCircle(mapRef.current);
  }

  function handleRescueSubmitted() {
    setRescueAlertOpen(false);
    if (selectedLocationMarkerRef.current) {
      selectedLocationMarkerRef.current.remove();
      selectedLocationMarkerRef.current = null;
    }
    accuracyCircleStateRef.current = null;
    removeAccuracyCircle(mapRef.current);
    setReportConfirmation("Rescue alert sent to response staff.");
    window.setTimeout(() => setReportConfirmation(""), 5000);
  }

  function handlePinRescueOnMap() {
    pickingPurposeRef.current = "rescue";
    setRescueAlertOpen(false);
    setPickingLocation(true);
  }

  function handleAdjustHazardOnMap() {
    pickingPurposeRef.current = "hazard";
    setPendingReportLocation(null);
    setPickingLocation(true);
  }

  function handleRescueLocationCaptured(captured) {
    accuracyCircleStateRef.current = captured;
    const map = mapRef.current;
    if (map) {
      map.flyTo({
        center: [captured.lng, captured.lat],
        zoom: 16,
        essential: true,
      });
      setMyLocation({ lat: captured.lat, lng: captured.lng, accuracy: captured.accuracy });
      setOrUpdateAccuracyCircle(map, captured.lng, captured.lat, captured.accuracy || 30);
      setOrUpdateSelectedLocationMarker(map, selectedLocationMarkerRef, captured, (updatedLoc) => {
        setRescueCoordinates(updatedLoc);
      });
    }
  }

  // --------------------------------------------------
  // "My evacuation center" form
  // --------------------------------------------------

  function openMyCenter() {
    setLookupError("");
    setLookupMatches([]);
    setMyCenterOpen(true);
  }

  function closeMyCenter() {
    setMyCenterOpen(false);
    setLookupError("");
    setLookupMatches([]);
  }

  function chooseMatch(match) {
    if (!match?.evacuation_center) {
      setLookupError(
        "We found your household, but no evacuation center has been assigned yet. Please contact your barangay."
      );

      setLookupMatches([]);

      return;
    }

    setMyCenter(match);
    if (match.room || match.evacuation_center) {
      setRoomCardExpanded(true);
    }

    saveResident({
      name: match.household_head_name || lookupName.trim(),
      resident_id: match.resident_id ?? null,
    });

    setLookupMatches([]);
    setLookupError("");
    setMyCenterOpen(false);

    setReportConfirmation(
      `Your evacuation center: ${match.evacuation_center.name}`
    );

    setTimeout(() => setReportConfirmation(""), 4000);

    // Zoom and route to assigned center
    if (evacCenters?.features && match.evacuation_center?.id) {
      const targetCenter = evacCenters.features.find(
        (c) => String(c.properties?.id ?? c.id) === String(match.evacuation_center.id)
      );
      if (targetCenter) {
        setSelectedCenter(null);
      }
    }
  }

  // --------------------------------------------------
  // AUTOSUGGEST LOGIC FOR "MY EVACUATION CENTER"
  // --------------------------------------------------

  useEffect(() => {
    const trimmed = lookupName.trim();
    if (trimmed.length < 3) {
      setAutosuggestList([]);
      setAutosuggestOpen(false);
      setAutosuggestLoading(false);
      return;
    }

    if (autosuggestAbortRef.current) {
      autosuggestAbortRef.current.abort();
    }
    const controller = new AbortController();
    autosuggestAbortRef.current = controller;

    setAutosuggestLoading(true);
    setAutosuggestOpen(true);

    const timer = setTimeout(() => {
      api
        .autosuggestResidents(trimmed, controller.signal)
        .then((res) => {
          setAutosuggestList(res.suggestions || []);
          setAutosuggestIndex(-1);
          setAutosuggestLoading(false);
        })
        .catch((err) => {
          if (err.name !== "AbortError") {
            setAutosuggestList([]);
            setAutosuggestLoading(false);
          }
        });
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [lookupName]);

  async function handleSelectSuggestion(selectedName) {
    setLookupName(selectedName);
    setAutosuggestOpen(false);
    setLookupLoading(true);
    setLookupError("");
    setLookupMatches([]);

    try {
      const result = await api.findMyEvacuationCenter(selectedName);
      const matches = normalizeMatches(result);

      if (matches.length === 0) {
        setLookupError(
          "We couldn't find an assigned evacuation center for this household. Check with your barangay."
        );
      } else if (matches.length === 1) {
        chooseMatch(matches[0]);
      } else {
        setLookupMatches(matches);
      }
    } catch (err) {
      setLookupError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLookupLoading(false);
    }
  }

  function handleAutosuggestKeyDown(e) {
    if (!autosuggestOpen) {
      if (e.key === "ArrowDown" && autosuggestList.length > 0) {
        setAutosuggestOpen(true);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAutosuggestIndex((prev) =>
        prev < autosuggestList.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAutosuggestIndex((prev) =>
        prev > 0 ? prev - 1 : autosuggestList.length - 1
      );
    } else if (e.key === "Enter") {
      if (autosuggestIndex >= 0 && autosuggestList[autosuggestIndex]) {
        e.preventDefault();
        handleSelectSuggestion(autosuggestList[autosuggestIndex].name);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setAutosuggestOpen(false);
    }
  }

  function renderHighlightedText(text, query) {
    if (!text || !query) return text;
    const cleanQ = query.trim();
    if (!cleanQ) return text;
    const regex = new RegExp(
      `(${cleanQ.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
      "gi"
    );
    const parts = text.split(regex);
    return parts.map((part, i) =>
      regex.test(part) ? <strong key={i}>{part}</strong> : part
    );
  }

  async function handleLookupSubmit(event) {
    event.preventDefault();

    const name = lookupName.trim();

    if (name.length < 3) {
      setLookupError("Enter your full name (at least 3 letters).");
      return;
    }

    setLookupLoading(true);
    setLookupError("");
    setLookupMatches([]);

    try {
      const result = await api.findMyEvacuationCenter(name);

      const matches = normalizeMatches(result);

      if (matches.length === 0) {
        setLookupError(
          "We couldn't find a household with that name. Check the spelling, or ask your barangay."
        );
      } else if (matches.length === 1) {
        chooseMatch(matches[0]);
      } else {
        // Several households share this name: let the resident pick
        setLookupMatches(matches);
      }
    } catch (err) {
      setLookupError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLookupLoading(false);
    }
  }

  function handleForgetMe() {
    saveResident(null);

    setMyCenter(null);
    setLookupName("");
    setLookupMatches([]);
    setLookupError("");

    if (routeIsMine) {
      handleClearRoute();
    }
  }

  function handleFindMyCenterFromModal() {
    closeMyCenter();
    handleFindRoute();
  }

  // --------------------------------------------------
  // Search (evacuation centers)
  // --------------------------------------------------

  useEffect(() => {
    const query = searchText.trim();

    if (query.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    const timeout = setTimeout(() => {
      setSearching(true);

      try {
        const results = [];

        /*
         * Search evacuation centers by name and served barangays
         */
        if (evacCenters?.features) {
          evacCenters.features.forEach((center) => {
            const properties = center.properties || {};

            const name = displayEntityName(properties.name, "Evacuation Center");
            const barangay = (properties.barangays || [])
              .map((item) => displayEntityName(item.name))
              .filter(Boolean)
              .join(", ") || displayEntityName(properties.barangay);

            const searchValue = `${name} ${barangay}`.toLowerCase();

            if (searchValue.includes(query.toLowerCase())) {
              results.push({
                type: "evacuation_center",
                name,
                subtitle: barangay
                  ? `Evacuation Center • ${barangay}`
                  : "Evacuation Center",
                feature: center,
              });
            }
          });
        }

        setSearchResults(results.slice(0, 8));
      } catch (error) {
        console.error("Search error:", error);
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 150);

    return () => clearTimeout(timeout);
  }, [searchText, evacCenters]);

  function zoomToSearchResult(result) {
    const map = mapRef.current;

    if (!map || !result) return;

    selectingSuggestionRef.current = true;
    setHideRoomBarForSearch(true);

    if (searchMoveRestoreTimeoutRef.current) {
      clearTimeout(searchMoveRestoreTimeoutRef.current);
    }

    let restored = false;
    const restoreRoomBar = () => {
      if (restored) return;
      restored = true;
      if (searchMoveRestoreTimeoutRef.current) {
        clearTimeout(searchMoveRestoreTimeoutRef.current);
        searchMoveRestoreTimeoutRef.current = null;
      }
      selectingSuggestionRef.current = false;
      setHideRoomBarForSearch(false);
    };

    map.once("moveend", restoreRoomBar);
    searchMoveRestoreTimeoutRef.current = setTimeout(restoreRoomBar, 1200);

    if (result.type === "evacuation_center") {
      const feature = result.feature;

      if (feature.geometry) {
        const bounds = getGeometryBounds(feature.geometry);

        if (bounds) {
          map.fitBounds(bounds, {
            padding: 80,
            maxZoom: 17,
            duration: 1000,
          });
        }
      }

      setSelectedCenter(feature);
      setSearchText(result.name);
      setShowSearchResults(false);

      return;
    }

    if (result.type === "barangay") {
      if (result.bbox) {
        map.fitBounds(
          [
            [result.bbox[0], result.bbox[1]],
            [result.bbox[2], result.bbox[3]],
          ],
          {
            padding: 80,
            maxZoom: 15,
            duration: 1000,
          }
        );
      } else if (result.center) {
        map.flyTo({
          center: result.center,
          zoom: 15,
          duration: 1000,
        });
      }

      setSearchText(result.name);
      setShowSearchResults(false);
    }
  }

  // --------------------------------------------------
  // Evacuation center details panel
  // --------------------------------------------------

  function closeCenterDetails() {
    setSelectedCenter(null);
  }


  const selectedCenterProperties = selectedCenter?.properties || {};

  const selectedCenterId = selectedCenterProperties.id ?? null;

  const selectedCenterName =
    displayEntityName(selectedCenterProperties.name, "Evacuation Center");

  const selectedCenterBarangays = Array.isArray(selectedCenterProperties.barangays)
    ? selectedCenterProperties.barangays
    : selectedCenterProperties.barangay
      ? [{ name: selectedCenterProperties.barangay }]
      : [];

  const selectedCenterCapacity = selectedCenterProperties.capacity ?? null;
  const selectedCenterOccupied =
    selectedCenterProperties.occupied ??
    selectedCenterProperties.current_occupancy ??
    0;
  const selectedCenterAssigned =
    selectedCenterProperties.assigned ??
    selectedCenterProperties.total_assigned ??
    0;

  const selectedCenterBuildingMaterial =
    displayEntityName(selectedCenterProperties.building_material) || null;

  const selectedCenterAccessibility =
    displayEntityName(selectedCenterProperties.accessibility_notes) || null;

  const selectedCenterIsMine =
    myCenter?.evacuation_center?.id != null &&
    selectedCenterId != null &&
    String(myCenter.evacuation_center.id) === String(selectedCenterId);

  const selectedCenterRooms =
    selectedCenterId == null
      ? []
      : rooms
        .filter(
          (room) =>
            String(room.evacuation_center_id) === String(selectedCenterId)
        )
        .slice()
        .sort((a, b) =>
          String(a.room_number ?? "").localeCompare(
            String(b.room_number ?? ""),
            undefined,
            {
              numeric: true,
              sensitivity: "base",
            }
          )
        );

  const selectedCenterBuildings = useMemo(() => {
    if (!selectedCenterId || !buildingsGeoJSON?.features) return [];
    return buildingsGeoJSON.features
      .filter(
        (f) =>
          String(f.properties?.evacuation_center_id) === String(selectedCenterId)
      )
      .map((f) => f.properties)
      .sort((a, b) => (a.id || 0) - (b.id || 0));
  }, [selectedCenterId, buildingsGeoJSON]);

  const handleShowMyRoomOnMap = () => {
    const map = mapRef.current;
    if (!map) return;

    const bId =
      myCenter?.room?.building_id ||
      (myCenter?.room?.building_name === "South Wing" ? 2 : 2);

    const bFeature = buildingsGeoJSON?.features?.find(
      (f) => String(f.id) === String(bId) || String(f.properties?.id) === String(bId)
    );

    let target = null;
    if (bFeature?.geometry?.coordinates?.[0]?.length > 0) {
      const ring = bFeature.geometry.coordinates[0];
      let sumLng = 0;
      let sumLat = 0;
      ring.forEach((pt) => {
        sumLng += pt[0];
        sumLat += pt[1];
      });
      target = [sumLng / ring.length, sumLat / ring.length];
    } else if (myCenter?.room?.longitude && myCenter?.room?.latitude) {
      target = [myCenter.room.longitude, myCenter.room.latitude];
    } else if (
      myCenter?.evacuation_center?.longitude &&
      myCenter?.evacuation_center?.latitude
    ) {
      target = [
        myCenter.evacuation_center.longitude,
        myCenter.evacuation_center.latitude,
      ];
    }

    if (target) {
      map.flyTo({
        center: target,
        zoom: 18.5,
        pitch: 0,
        essential: true,
        duration: 1200,
      });
    }

    pulseBuilding(map, bId);
    setUserBuilding(map, bId);
    setRoomCardExpanded(false);
  };

  const handleStartWalkingToMyRoom = () => {
    setRoomCardExpanded(false);
    if (!myCenter?.evacuation_center?.id) return;
    handleFindRoute(myCenter.evacuation_center.id);
  };

  // --------------------------------------------------
  // Render
  // --------------------------------------------------

  const firstName = myCenter?.household_head_name?.split(" ")[0] || myCenter?.resident_name?.split(" ")[0] || user?.name?.split(" ")[0] || "";
  const currentWalkingManeuver =
    route?.walking_steps?.[activeWalkingStep]?.maneuver || null;

  const selectedCenterDistance = useMemo(() => {
    if (!myLocation || !selectedCenter) return null;
    const centerCoords = getCenterCoordinates(selectedCenter, buildingsGeoJSON);
    if (!centerCoords) return null;
    const meters = getDistanceMeters([myLocation.lat, myLocation.lng], [centerCoords.latitude, centerCoords.longitude]);
    if (!Number.isFinite(meters)) return null;
    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(1)} km away`;
    }
    return `${Math.round(meters)} m away`;
  }, [myLocation, selectedCenter, buildingsGeoJSON]);

  // --------------------------------------------------
  // Sheets: only one open at a time
  // --------------------------------------------------

  function openSheet(name) {
    setMoreMenuOpen(name === "more");
    setHelpOpen(name === "help");

    if (selectedCenter) {
      closeCenterDetails();
    }
  }

  // --------------------------------------------------
  // Shared UI pieces
  // --------------------------------------------------


  const helpIconsList = (
    <div className="help-icon-list">
      <div className="legend-item">
        <div className="legend-icon-wrapper place-center">
          <FontAwesomeIcon icon={faBuildingColumns} />
        </div>
        <span>Safe evacuation center where your family can stay.</span>
      </div>
      <div className="legend-item">
        <div className="legend-icon-wrapper place-room">
          <FontAwesomeIcon icon={faDoorOpen} />
        </div>
        <span>Room inside an evacuation center when you zoom in.</span>
      </div>
      <div className="legend-item">
        <div className="legend-icon-wrapper hazard-report">
          <FontAwesomeIcon icon={faTriangleExclamation} />
        </div>
        <span>Danger reported nearby by a resident or staff.</span>
      </div>
      <div className="legend-item">
        <div className="legend-icon-wrapper road-blocked">
          <FontAwesomeIcon icon={faBan} />
        </div>
        <span>Road that is blocked or closed and cannot be passed.</span>
      </div>
      <div className="legend-item">
        <div className="legend-icon-wrapper hazard-flood">
          <FontAwesomeIcon icon={faWater} />
        </div>
        <span>Area that can flood during heavy rain.</span>
      </div>
      <div className="legend-item">
        <div className="legend-icon-wrapper hazard-landslide">
          <FontAwesomeIcon icon={faMountain} />
        </div>
        <span>Steep area where landslides may happen.</span>
      </div>
    </div>
  );

  const hasAssigned = Boolean(myCenter && (myCenter.room || myCenter.evacuation_center));
  const isRoomCardVisible = Boolean(
    hasAssigned && !navigationActive && !hideRoomBarForSearch
  );

  const isRoomCardExpanded = Boolean(
    isRoomCardVisible && roomCardExpanded && !selectedCenter
  );

  const hasRoom = Boolean(myCenter?.room);
  const roomNum = myCenter?.room?.room_number?.startsWith("Room")
    ? myCenter.room.room_number
    : `Room ${myCenter?.room?.room_number || "29"}`;
  const hasBuilding = Boolean(myCenter?.room?.building_id && myCenter?.room?.building_name);
  const myCheckinStatus =
    myCenter?.is_checked_in || myCenter?.room?.is_checked_in
      ? "Checked in"
      : "Reserved for your household";
  const centerDisplayName =
    myCenter?.evacuation_center?.name || "Sogod Central School";
  const roomLabel = hasRoom
    ? (hasBuilding
        ? `${centerDisplayName} · ${roomNum} (${myCenter.room.building_name})`
        : `${centerDisplayName} · ${roomNum}`)
    : (hasBuilding
        ? `${centerDisplayName} · ${myCenter.room.building_name}`
        : centerDisplayName);
  const fullCenterRoomLabel = roomLabel;

  const handleOpenMyRoomBuilding = useCallback(() => {
    if (!myCenter?.room) {
      if (myCenter?.evacuation_center?.id && evacCenters?.features) {
        const targetCenter = evacCenters.features.find(
          (c) => String(c.properties?.id ?? c.id) === String(myCenter.evacuation_center.id)
        );
        if (targetCenter) {
          setSelectedCenter(targetCenter);
        }
      }
      return;
    }
    let bId = myCenter?.room?.building_id != null ? Number(myCenter.room.building_id) : null;
    let bFeature = null;

    if (bId != null && buildingsGeoJSON?.features) {
      bFeature = buildingsGeoJSON.features.find(
        (f) => Number(f.id ?? f.properties?.id) === bId
      );
    }
    if (!bFeature && myCenter?.room?.building_name && buildingsGeoJSON?.features) {
      const targetName = myCenter.room.building_name.trim().toLowerCase();
      bFeature = buildingsGeoJSON.features.find(
        (f) => f.properties?.name && f.properties.name.trim().toLowerCase() === targetName
      );
      if (bFeature) {
        bId = Number(bFeature.properties?.id ?? bFeature.id);
      }
    }
    if (!bFeature && buildingsGeoJSON?.features) {
      const myRoomNum = String(myCenter?.room?.room_number || "").replace(/^Room\s*/i, "").trim();
      const myRoomId = myCenter?.room?.id != null ? String(myCenter.room.id) : null;
      bFeature = buildingsGeoJSON.features.find((f) => {
        const rList = f.properties?.rooms;
        if (!Array.isArray(rList)) return false;
        return rList.some((r) => {
          const rNum = String(r.room_number || "").replace(/^Room\s*/i, "").trim();
          const rId = r.id != null ? String(r.id) : null;
          return (myRoomId && rId === myRoomId) || (myRoomNum && rNum === myRoomNum);
        });
      });
      if (bFeature) {
        bId = Number(bFeature.properties?.id ?? bFeature.id);
      }
    }

    if (bId != null) {
      setSelectedBuildingId(bId);
      setSelectedBuildingData(
        bFeature?.properties || { id: bId, name: myCenter?.room?.building_name }
      );
      setBuildingModalOpen(true);
    }
  }, [myCenter, buildingsGeoJSON]);

  const handleSheetTouchStart = (e) => {
    touchStartYRef.current = e.touches[0].clientY;
  };
  const handleSheetTouchEnd = (e) => {
    const deltaY = e.changedTouches[0].clientY - touchStartYRef.current;
    if (deltaY > 35) {
      setRoomCardExpanded(false);
    }
  };

  return (
    <div
      className={`resident-home ${isRoomCardVisible ? "has-room-card" : ""} ${
        isRoomCardExpanded ? "has-room-card-expanded" : ""
      }`}
    >
      {/* Mapbox map */}
      <div ref={mapContainerRef} className="map-container" />

      {/* Header (slim 48px bar on phones) */}
      <header className="top-bar">
        <Link to="/" className="brand brand-link" aria-label="EvacWay Home" title="EvacWay Home">
          EvacWay
        </Link>

        <div className="top-bar-actions">

          {!user ? (
            <button
              type="button"
              className="header-login-btn"
              onClick={() => openLoginDialog()}
              aria-label="Log in to unlock resident features"
              title="Log In"
            >
              <FontAwesomeIcon icon={faRightToBracket} className="header-login-icon" />
              <span>Log In</span>
            </button>
          ) : (
            <div className="top-bar-user-wrap">
              <span className="user-greeting-pill" title={`Signed in as ${user.name || user.email || "Resident"}`}>
                <FontAwesomeIcon icon={faCircleCheck} className="user-greeting-icon" />
                <span className="user-greeting-name">{firstName || "Resident"}</span>
              </span>
              <button
                type="button"
                className="header-logout-btn"
                onClick={handleLogout}
                aria-label="Sign out"
                title="Log Out"
              >
                <FontAwesomeIcon icon={faRightFromBracket} />
                <span>Log Out</span>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* "Your room" / "Your shelter" card: collapsed bar by default; expanded under search on desktop, bottom sheet on mobile */}
      {isRoomCardVisible && (
        !isRoomCardExpanded ? (
          <div
            className={`pinned-your-room-card is-collapsed ${isMobile ? "mobile" : "desktop"}`}
            role="region"
            aria-label={`Your assigned ${hasRoom ? "room" : "shelter"}`}
            onClick={(e) => {
              if (!e.target.closest("button")) {
                handleOpenMyRoomBuilding();
              }
            }}
            style={{ cursor: hasBuilding || !hasRoom ? "pointer" : "default" }}
          >
            <div className="your-room-collapsed-row">
              <div
                className="your-room-collapsed-left"
                onClick={handleOpenMyRoomBuilding}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleOpenMyRoomBuilding();
                  }
                }}
                aria-label={hasBuilding ? `View details for ${roomLabel}` : roomLabel}
              >
                <span className="your-room-door-icon" aria-hidden="true">
                  <FontAwesomeIcon icon={hasRoom ? faDoorOpen : faHouseFlag} />
                </span>
                <div className="your-room-text-stack">
                  <div className="your-room-center-sub" title={centerDisplayName}>
                    <FontAwesomeIcon icon={faBuildingColumns} className="your-room-center-sub-icon" />
                    <span className="your-room-center-sub-name">{centerDisplayName}</span>
                  </div>
                  <div className="your-room-main-title">
                    {hasRoom
                      ? (hasBuilding ? `${roomNum} · ${myCenter.room.building_name}` : roomNum)
                      : (hasBuilding ? myCenter.room.building_name : "General Shelter")}
                  </div>
                </div>
              </div>
              <div className="your-room-collapsed-right">
                <button
                  type="button"
                  className="your-room-collapsed-nav-btn"
                  onClick={handleStartWalkingToMyRoom}
                  title="Navigate"
                  aria-label="Navigate"
                >
                  <FontAwesomeIcon icon={faPersonWalking} />
                </button>
                <button
                  type="button"
                  className="your-room-collapsed-expand-btn"
                  onClick={() => setRoomCardExpanded(true)}
                  title="Expand room details"
                  aria-label="Expand room details"
                  aria-expanded="false"
                >
                  <FontAwesomeIcon icon={faChevronDown} />
                </button>
              </div>
            </div>
          </div>
        ) : isMobile ? (
          <>
            <div
              className="your-room-backdrop"
              onClick={() => setRoomCardExpanded(false)}
              aria-hidden="true"
            />
            <div
              className="pinned-your-room-card is-expanded mobile-sheet"
              role="dialog"
              aria-modal="true"
              aria-label={`Your assigned ${hasRoom ? "room" : "shelter"}`}
              onTouchStart={handleSheetTouchStart}
              onTouchEnd={handleSheetTouchEnd}
            >
              <div className="sheet-handle" aria-hidden="true" />
              <div className="your-room-expanded-header">
                <div className="your-room-expanded-title-row">
                  <span className="your-room-door-icon" aria-hidden="true">
                    <FontAwesomeIcon icon={hasRoom ? faDoorOpen : faHouseFlag} />
                  </span>
                  <div className="your-room-text-stack">
                    <div className="your-room-center-sub" title={centerDisplayName}>
                      <FontAwesomeIcon icon={faBuildingColumns} className="your-room-center-sub-icon" />
                      <span className="your-room-center-sub-name">{centerDisplayName}</span>
                    </div>
                    <div className="your-room-main-title">
                      {hasRoom
                        ? (hasBuilding ? `${roomNum} · ${myCenter.room.building_name}` : roomNum)
                        : (hasBuilding ? myCenter.room.building_name : "General Shelter")}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="your-room-collapsed-expand-btn"
                  onClick={() => setRoomCardExpanded(false)}
                  title="Collapse room details"
                  aria-label="Collapse room details"
                  aria-expanded="true"
                >
                  <FontAwesomeIcon icon={faChevronDown} />
                </button>
              </div>
              <div className="your-room-expanded-content">
                <div className="pinned-room-center-name">
                  {myCenter.evacuation_center?.name || "Sogod Central School"}
                </div>
                <p className="pinned-room-details-line">
                  <strong>{myCheckinStatus}</strong>
                  {" · "}
                  {hasRoom && myCenter.room ? (
                    <>
                      {myCenter.room.floor ? `Floor/area: ${myCenter.room.floor}. ` : ""}
                      Enter via {myCenter.room.recommended_entrance || "Entrance 3"}.
                    </>
                  ) : (
                    "Open space shelter · Report to reception/coordinator upon arrival."
                  )}
                </p>
                <div className="pinned-room-actions">
                  <button
                    type="button"
                    className="pinned-room-btn pinned-show-map-btn"
                    onClick={handleShowMyRoomOnMap}
                  >
                    <FontAwesomeIcon icon={faMapPin} />
                    <span>Show on map</span>
                  </button>
                  <button
                    type="button"
                    className="pinned-room-btn pinned-navigate-btn"
                    onClick={handleStartWalkingToMyRoom}
                  >
                    <FontAwesomeIcon icon={faPersonWalking} />
                    <span>Start walking navigation</span>
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div
            className="pinned-your-room-card is-expanded desktop"
            role="region"
            aria-label={`Your assigned ${hasRoom ? "room" : "shelter"}`}
          >
            <div className="your-room-expanded-header">
              <div className="your-room-expanded-title-row">
                <span className="your-room-door-icon" aria-hidden="true">
                  <FontAwesomeIcon icon={hasRoom ? faDoorOpen : faHouseFlag} />
                </span>
                <span className="your-room-expanded-title">{roomLabel}</span>
              </div>
              <button
                type="button"
                className="your-room-collapsed-expand-btn"
                onClick={() => setRoomCardExpanded(false)}
                title="Collapse room details"
                aria-label="Collapse room details"
                aria-expanded="true"
              >
                <FontAwesomeIcon icon={faChevronUp} />
              </button>
            </div>
            <div className="your-room-expanded-content">
              <div className="pinned-room-center-name">
                {myCenter.evacuation_center?.name || "Sogod Central School"}
              </div>
              <p className="pinned-room-details-line">
                <strong>{myCheckinStatus}</strong>
                {" · "}
                {hasRoom && myCenter.room ? (
                  <>
                    {myCenter.room.floor ? `Floor/area: ${myCenter.room.floor}. ` : ""}
                    Enter via {myCenter.room.recommended_entrance || "Entrance 3"}.
                  </>
                ) : (
                  "Open space shelter · Report to reception/coordinator upon arrival."
                )}
              </p>
              <div className="pinned-room-actions">
                <button
                  type="button"
                  className="pinned-room-btn pinned-show-map-btn"
                  onClick={handleShowMyRoomOnMap}
                >
                  <FontAwesomeIcon icon={faMapPin} />
                  <span>Show on map</span>
                </button>
                <button
                  type="button"
                  className="pinned-room-btn pinned-navigate-btn"
                  onClick={handleStartWalkingToMyRoom}
                >
                  <FontAwesomeIcon icon={faPersonWalking} />
                  <span>Start walking navigation</span>
                </button>
              </div>
            </div>
          </div>
        )
      )}

      {/* Top area: search (hidden during route preview, navigation & building modal so it does not block the card/bar/modal) */}
      {!navigationActive && !route && !buildingModalOpen && (
        <div className={`top-left-panel ${isMobile ? "compact" : ""}`}>
        <div className="resident-search-box">
          <FontAwesomeIcon
            icon={faMagnifyingGlass}
            className="resident-search-icon"
            aria-hidden="true"
          />

          <input
            type="search"
            enterKeyHint="search"
            value={searchText}
            onChange={(e) => {
              const val = e.target.value;
              setSearchText(val);
              if (val.length > 0) {
                setHideRoomBarForSearch(true);
                setShowSearchResults(true);
              } else {
                setHideRoomBarForSearch(false);
                setShowSearchResults(false);
              }
            }}
            onFocus={() => {
              setHideRoomBarForSearch(true);
              if (searchResults.length > 0 || searchText.trim().length >= 2) {
                setShowSearchResults(true);
              }
            }}
            onBlur={() => {
              setTimeout(() => {
                if (!selectingSuggestionRef.current) {
                  setHideRoomBarForSearch(false);
                  setShowSearchResults(false);
                }
              }, 150);
            }}
            placeholder="Search evacuation center..."
            className="resident-search-input"
            aria-label="Search evacuation center"
          />

          {searching && (
            <span className="resident-search-loading">Searching...</span>
          )}

          {searchText && (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() => {
                setSearchText("");
                setSearchResults([]);
                setShowSearchResults(false);
                setHideRoomBarForSearch(false);
              }}
              aria-label="Clear search"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          )}
        </div>

        {showSearchResults && searchResults.length > 0 && (
          <div className="resident-search-results">
            {searchResults.map((result, index) => (
              <button
                key={`${result.type}-${result.name}-${index}`}
                className="resident-search-result"
                onMouseDown={() => {
                  selectingSuggestionRef.current = true;
                }}
                onClick={() => zoomToSearchResult(result)}
              >
                <FontAwesomeIcon
                  icon={result.type === "barangay" ? faLocationDot : faBuildingColumns}
                  className="resident-search-result-icon"
                />

                <span className="resident-search-result-text">
                  <strong>{result.name}</strong>
                  <span>{result.subtitle}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {showSearchResults &&
          !searching &&
          searchText.trim().length >= 2 &&
          searchResults.length === 0 && (
            <div className="resident-search-no-results">
              No evacuation center found.
            </div>
          )}
      </div>
      )}

      {/* Right control stack: "My location", "Street / Satellite", and "Help" */}
      <div
        className={`right-control-stack ${isMobile ? "compact" : ""} ${isMobile && route ? "route-open" : ""
          } ${isMobile && navigationActive ? "navigating" : ""}`}
        role="group"
        aria-label="Map controls"
      >
        <button
          type="button"
          onClick={handleLocateMe}
          disabled={locating}
          className="control-stack-btn"
          title="My location"
          aria-label="My location"
        >
          <FontAwesomeIcon icon={faLocationCrosshairs} spin={locating} />
        </button>

        <button
          type="button"
          onClick={() =>
            handleMapStyleChange(mapStyle === "street" ? "satellite" : "street")
          }
          className={`control-stack-btn ${mapStyle === "satellite" ? "active" : ""}`}
          title={
            mapStyle === "street"
              ? "Switch to Satellite View"
              : "Switch to Street View"
          }
          aria-label={
            mapStyle === "street"
              ? "Switch to Satellite View"
              : "Switch to Street View"
          }
          aria-pressed={mapStyle === "satellite"}
        >
          <FontAwesomeIcon icon={faSatelliteDish} />
        </button>

        <button
          type="button"
          onClick={() => (helpOpen ? setHelpOpen(false) : openSheet("help"))}
          className={`control-stack-btn ${helpOpen ? "active" : ""}`}
          title="Help"
          aria-label="Help"
          aria-expanded={helpOpen}
        >
          <FontAwesomeIcon icon={faCircleQuestion} />
        </button>
      </div>

      {/* Help panel: "What do the icons mean?" */}
      {helpOpen && (
        <>
          {isMobile && (
            <div
              className="popover-backdrop"
              onClick={() => setHelpOpen(false)}
              aria-hidden="true"
            />
          )}
          <div
            className={isMobile ? "rh-sheet" : "help-popover"}
            role="dialog"
            aria-modal={isMobile ? "true" : undefined}
            aria-label="What do the icons mean?"
          >
            {isMobile && <div className="sheet-handle" aria-hidden="true" />}

            <div className="popover-header">
              <h4>What do the icons mean?</h4>
              <button
                type="button"
                className="popover-close-btn"
                onClick={() => setHelpOpen(false)}
                aria-label="Close help"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            <div className={isMobile ? "sheet-body" : ""}>
              {helpIconsList}
              <button
                type="button"
                className="help-got-it-btn"
                onClick={() => setHelpOpen(false)}
              >
                Got it
              </button>
            </div>
          </div>
        </>
      )}

      {/* Evacuation Center Bottom Card (bottom sheet on phones/tablets) */}
      {selectedCenter && isMobile && (
        <div
          className="popover-backdrop"
          onClick={closeCenterDetails}
          aria-hidden="true"
        />
      )}
      {selectedCenter && (
        <div
          className={`center-bottom-card ${isMobile ? "mobile" : ""}`}
          role="dialog"
          aria-label="Evacuation Center Details"
        >
          {isMobile && <div className="sheet-handle" aria-hidden="true" />}
          <div className="center-card-header">
            <div className="center-card-title-group">
              <div className="center-card-name-row">
                <h3>{selectedCenterName}</h3>
                {selectedCenterIsMine ? (
                  <span className="center-status-badge mine">Your Assigned Center</span>
                ) : (
                  <span className="center-status-badge open">Open Center</span>
                )}
              </div>
              <div className="center-card-meta">
                {selectedCenterDistance && (
                  <span className="center-meta-item">
                    <FontAwesomeIcon icon={faLocationCrosshairs} />
                    <strong>{selectedCenterDistance}</strong>
                  </span>
                )}
                {selectedCenterCapacity != null && (
                  <span className="center-meta-item">
                    <strong>{selectedCenterOccupied}</strong> of{" "}
                    <strong>{selectedCenterCapacity}</strong> here ·{" "}
                    <strong>{selectedCenterAssigned}</strong> assigned
                  </span>
                )}
                {selectedCenterBarangays.length > 0 && (
                  <span className="center-meta-item">
                    {selectedCenterBarangays
                      .map((b) => displayEntityName(b.name))
                      .join(", ")}
                  </span>
                )}
              </div>
            </div>

            <button
              type="button"
              className="center-card-close"
              onClick={closeCenterDetails}
              aria-label="Close details"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>

          {selectedCenterIsMine && (
            <div className="cd-your-room">
              <FontAwesomeIcon icon={faCircleCheck} />
              <span>
                {myCenter?.room?.room_number ? (
                  <>
                    Your assigned room: <strong>{myCenter.room.room_number}</strong> · {myCheckinStatus}
                  </>
                ) : (
                  <>
                    Your assigned shelter (1 space) · {myCheckinStatus}
                  </>
                )}
              </span>
            </div>
          )}

          <div className="center-card-actions">
            <button
              type="button"
              className="center-navigate-btn"
              onClick={() => {
                handleFindRoute(selectedCenterId);
                closeCenterDetails();
              }}
              disabled={findingRoute || locationPermission === "denied"}
            >
              <FontAwesomeIcon icon={faRoute} spin={findingRoute} />
              <span>Navigate to this Center</span>
            </button>
          </div>

          {/* BUILDINGS LIST (for campus) OR OPEN SHELTER SPACE (for single venue / private property) */}
          {(() => {
            const cType =
              selectedCenter.properties?.center_type ||
              selectedCenter.center_type ||
              "campus";
            const isSingleVenueOrHouse = cType !== "campus";

            if (isSingleVenueOrHouse) {
              const cap = Number(selectedCenterCapacity || 0);
              const occ = Number(selectedCenterOccupied || 0);
              const spaceLeft = Math.max(0, cap - occ);

              return (
                <div className="center-card-buildings-section">
                  <div className="center-card-buildings-header">
                    <span>Shelter Space</span>
                    <span className="buildings-header-sub">
                      {cType === "private_property"
                        ? "Private Property"
                        : "Single Open Space"}
                    </span>
                  </div>
                  <div
                    style={{
                      padding: "12px 14px",
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                      fontSize: 13,
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                      }}
                    >
                      <span style={{ color: "#64748b" }}>Capacity:</span>
                      <strong style={{ color: "#0f172a" }}>{cap} people</strong>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                      }}
                    >
                      <span style={{ color: "#64748b" }}>Space remaining:</span>
                      <strong
                        style={{
                          color: spaceLeft > 0 ? "#16a34a" : "#dc2626",
                        }}
                      >
                        {spaceLeft} space{spaceLeft === 1 ? "" : "s"} left
                      </strong>
                    </div>
                    {selectedCenter.properties?.building_material && (
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                        }}
                      >
                        <span style={{ color: "#64748b" }}>
                          Building material:
                        </span>
                        <span style={{ color: "#0f172a" }}>
                          {selectedCenter.properties.building_material}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            }

            return (
              <div className="center-card-buildings-section">
                <div className="center-card-buildings-header">
                  <span>Buildings ({selectedCenterBuildings.length})</span>
                  <span className="buildings-header-sub">
                    Tap building to view rooms
                  </span>
                </div>
                {selectedCenterBuildings.length > 0 ? (
                  <div className="center-card-buildings-list" role="list">
                    {selectedCenterBuildings.map((b) => {
                      const bOcc = b.occupied || 0;
                      const bAssigned = b.assigned ?? 0;
                      const bCap = b.capacity || 0;
                      const bPct =
                        bCap > 0
                          ? Math.min(100, Math.round((bOcc / bCap) * 100))
                          : 0;
                      const bAssignedPct =
                        bCap > 0
                          ? Math.min(100, Math.round((bAssigned / bCap) * 100))
                          : 0;
                      const bIsFull = bCap > 0 && bOcc >= bCap;
                      const bIsFullyAssigned = bCap > 0 && bAssigned >= bCap;
                      const bColor =
                        bCap === 0
                          ? "#94a3b8"
                          : bOcc >= bCap
                          ? "#dc2626"
                          : bPct >= 70
                          ? "#d97706"
                          : "#16a34a";

                      const isUserBuilding =
                        myCenter?.room?.building_id != null &&
                        String(myCenter.room.building_id) === String(b.id);

                      return (
                        <button
                          type="button"
                          key={b.id}
                          className={`center-building-row-btn ${
                            isUserBuilding ? "is-user-building" : ""
                          }`}
                          onClick={() => {
                            setSelectedBuildingId(b.id);
                            setSelectedBuildingData(b);
                            setBuildingModalOpen(true);
                            closeCenterDetails();
                          }}
                          role="listitem"
                          aria-label={`${b.name || "Building"}, ${b.room_count || 0} rooms, ${bOcc} of ${bCap} here, ${bAssigned} assigned`}
                        >
                          <div className="center-building-row-top">
                            <div className="center-building-name-wrap">
                              <strong>{b.name || `Building #${b.id}`}</strong>
                              {isUserBuilding && (
                                <span className="bldg-badge-yours">
                                  Your building
                                </span>
                              )}
                              {bIsFull && (
                                <span className="center-bldg-badge is-full">
                                  Full
                                </span>
                              )}
                              {bIsFullyAssigned && (
                                <span className="center-bldg-badge is-fully-assigned">
                                  Fully assigned
                                </span>
                              )}
                            </div>
                            <span className="center-building-rooms-count">
                              {b.room_count || 0}{" "}
                              {b.room_count === 1 ? "room" : "rooms"}
                            </span>
                          </div>

                          <div className="center-building-row-mid">
                            <span className="center-building-occ-text">
                              <strong>{bOcc}</strong> of {bCap} here ·{" "}
                              {bAssigned} assigned
                            </span>
                            <span
                              className="center-building-pct-text"
                              style={{ color: bColor }}
                            >
                              {bPct}%
                            </span>
                          </div>

                          {/* Small 4px occupancy bar */}
                          <div
                            className="center-building-bar-track"
                            aria-hidden="true"
                          >
                            {bAssignedPct > 0 && (
                              <div
                                className="center-building-bar-assigned"
                                style={{ width: `${bAssignedPct}%` }}
                              />
                            )}
                            <div
                              className="center-building-bar-fill"
                              style={{
                                width: `${bPct}%`,
                                backgroundColor: bColor,
                              }}
                            />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="center-buildings-empty">
                    <span>No buildings mapped for this center yet.</span>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* Bottom Action Bar (always visible & clickable) */}
      <div className={`bottom-actions-container ${isMobile ? "mobile" : ""}`}>
          {isMobile ? (
            /* Phones/tablets: compact single-row dock */
            <div className="mobile-action-dock">
              {locationPermission !== "granted" ? (
                <button
                  type="button"
                  onClick={handleEnableLocation}
                  className="action-btn-primary mobile-route-btn"
                >
                  <FontAwesomeIcon icon={faLocationCrosshairs} />
                  <span>Nearest safe place</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleFindRoute()}
                  disabled={findingRoute}
                  className="action-btn-primary mobile-route-btn"
                >
                  <FontAwesomeIcon icon={faRoute} spin={findingRoute} />
                  <span>
                    {findingRoute
                      ? "Finding..."
                      : myCenter
                        ? "My center"
                        : "Nearest safe place"}
                  </span>
                </button>
              )}

              <button
                type="button"
                onClick={() => openSheet("more")}
                className="action-btn-secondary mobile-more-btn"
                aria-label="More options"
                aria-expanded={moreMenuOpen}
              >
                <FontAwesomeIcon icon={faEllipsis} />
                <span>More</span>
              </button>

              <button
                type="button"
                onClick={() => setRescueAlertOpen(true)}
                className="action-btn-sos mobile-sos-btn"
                aria-label="I need rescue"
              >
                <FontAwesomeIcon icon={faTriangleExclamation} />
                <span>I need rescue</span>
              </button>
            </div>
          ) : (
            /* Desktop Row */
            <div className="desktop-action-bar">
              <div className="desktop-primary-group">
                {locationPermission !== "granted" ? (
                  <button
                    type="button"
                    onClick={handleEnableLocation}
                    className="action-btn-primary"
                  >
                    <FontAwesomeIcon icon={faLocationCrosshairs} />
                    <span>Go to nearest safe place</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleFindRoute()}
                    disabled={findingRoute}
                    className="action-btn-primary"
                  >
                    <FontAwesomeIcon icon={faRoute} spin={findingRoute} />
                    <span>
                      {findingRoute
                        ? "Finding route..."
                        : myCenter
                          ? "Go to my evacuation center"
                          : "Go to nearest safe place"}
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleReportMapClick}
                  className="action-btn-secondary"
                >
                  <FontAwesomeIcon icon={faMapPin} />
                  <span>{pickingLocation ? "Tap map..." : "Report a danger"}</span>
                </button>

                <button
                  type="button"
                  onClick={openMyCenter}
                  className={`action-btn-secondary ${myCenter ? "verified" : ""}`}
                  title={myCenter ? "My Evacuation Center" : "Find My Evacuation Center"}
                >
                  <FontAwesomeIcon icon={myCenter ? faCircleCheck : faUser} />
                  <span>{myCenter ? `My Evacuation Center (${firstName})` : "My Evacuation Center"}</span>
                </button>
              </div>

              <div className="desktop-sos-divider" aria-hidden="true" />

              <button
                type="button"
                onClick={() => setRescueAlertOpen(true)}
                className="action-btn-sos"
                aria-label="I need rescue"
              >
                <FontAwesomeIcon icon={faTriangleExclamation} />
                <span>I need rescue</span>
              </button>
            </div>
          )}
        </div>

      {/* Phones/tablets: More bottom sheet */}
      {moreMenuOpen && isMobile && (
        <>
          <div
            className="popover-backdrop"
            onClick={() => setMoreMenuOpen(false)}
            aria-hidden="true"
          />
          <div
            className="rh-sheet more-bottom-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="More actions"
          >
            <div className="sheet-handle" aria-hidden="true" />

            <div className="popover-header">
              <h4>More</h4>
              <button
                type="button"
                className="popover-close-btn"
                onClick={() => setMoreMenuOpen(false)}
                aria-label="Close"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            <div className="sheet-body more-sheet-actions">
              <button
                type="button"
                onClick={() => {
                  setMoreMenuOpen(false);
                  handleReportMapClick();
                }}
                className="more-sheet-item"
              >
                <span className="more-item-icon danger">
                  <FontAwesomeIcon icon={faMapPin} />
                </span>
                <div className="more-item-text">
                  <strong>{pickingLocation ? "Tap the map..." : "Report a danger"}</strong>
                  <small>Flood, landslide or blocked road</small>
                </div>
                <FontAwesomeIcon icon={faChevronRight} className="more-item-chevron" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setMoreMenuOpen(false);
                  openMyCenter();
                }}
                className={`more-sheet-item ${myCenter ? "verified" : ""}`}
              >
                <span className="more-item-icon">
                  <FontAwesomeIcon icon={myCenter ? faCircleCheck : faUser} />
                </span>
                <div className="more-item-text">
                  <strong>
                    {myCenter ? `My evacuation center (${firstName})` : "My evacuation center"}
                  </strong>
                  <small>Find where your family should go</small>
                </div>
                <FontAwesomeIcon icon={faChevronRight} className="more-item-chevron" />
              </button>
            </div>
          </div>
        </>
      )}

      {/* Active walking navigation: compact pill on mobile (expands on tap) or top bar */}
      {navigationActive && (
        isMobile && !navPillExpanded ? (
          <div
            className="nav-compact-pill"
            role="button"
            tabIndex={0}
            onClick={() => setNavPillExpanded(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setNavPillExpanded(true);
              }
            }}
            aria-expanded="false"
            aria-label="Walking navigation guidance. Tap to expand details."
          >
            <div className="nav-pill-icon" aria-hidden="true">
              <FontAwesomeIcon
                icon={faArrowUp}
                style={{
                  transform: `rotate(${getManeuverRotation(currentWalkingManeuver?.modifier)}deg)`,
                }}
              />
            </div>
            <span className="nav-pill-distance">
              {currentWalkingManeuver?.distance != null
                ? `${Math.round(currentWalkingManeuver.distance)} m`
                : navigationRemainingMeters != null
                  ? `${Math.round(navigationRemainingMeters)} m`
                  : "Next turn"}
            </span>
            <FontAwesomeIcon icon={faChevronDown} className="nav-pill-chevron" aria-hidden="true" />
          </div>
        ) : (
          <div className="nav-active-top-bar" role="region" aria-label="Walking navigation">
            <div className="nav-bar-icon-wrap" aria-hidden="true">
              <FontAwesomeIcon
                icon={faArrowUp}
                style={{
                  transform: `rotate(${getManeuverRotation(currentWalkingManeuver?.modifier)}deg)`,
                }}
              />
            </div>
            <div className="nav-bar-content">
              <div className="nav-bar-instruction">
                {currentWalkingManeuver?.instruction ||
                  (navigationStatus?.includes("Off route")
                    ? navigationStatus
                    : "Follow highlighted route")}
              </div>
              <div className="nav-bar-subline">
                {navigationStatus && navigationStatus.includes("Off route") ? (
                  <span className="nav-bar-offroute">{navigationStatus}</span>
                ) : navigationRemainingMeters != null ? (
                  <span>
                    {navigationRemainingMeters >= 1000
                      ? `${(navigationRemainingMeters / 1000).toFixed(1)} km`
                      : `${Math.round(navigationRemainingMeters)} m`}{" "}
                    · {Math.max(1, Math.ceil((navigationRemainingSeconds || 0) / 60))} min remaining
                    {(route?.chosen_entrance?.name || route?.evacuation_center?.chosen_entrance?.name) && (
                      <> · via {route?.chosen_entrance?.name || route?.evacuation_center?.chosen_entrance?.name}</>
                    )}
                  </span>
                ) : (
                  <span>
                    {Number(route?.distance_km || 0).toFixed(1)} km ·{" "}
                    {route?.estimated_time_min || 1} min remaining
                    {(route?.chosen_entrance?.name || route?.evacuation_center?.chosen_entrance?.name) && (
                      <> · via {route?.chosen_entrance?.name || route?.evacuation_center?.chosen_entrance?.name}</>
                    )}
                  </span>
                )}
              </div>
            </div>
            {isMobile && (
              <button
                type="button"
                className="nav-bar-collapse-btn"
                onClick={() => setNavPillExpanded(false)}
                aria-label="Collapse navigation details"
                title="Collapse"
              >
                <FontAwesomeIcon icon={faChevronUp} />
              </button>
            )}
            <button
              type="button"
              className="nav-bar-stop-btn"
              onClick={() => stopWalkingNavigation()}
              aria-label="Stop navigation"
              title="Stop navigation"
            >
              <FontAwesomeIcon icon={faXmark} />
              <span>Stop</span>
            </button>
          </div>
        )
      )}

      {/* Route preview: desktop card (top) or mobile bottom sheet (above bottom dock) */}
      {route && !navigationActive && (
        <div
          className={`route-preview-card ${isMobile ? "mobile-bottom-sheet" : ""}`}
          role="region"
          aria-label="Route preview"
        >
          {isMobile && <div className="sheet-handle" aria-hidden="true" />}
          <div className="route-preview-main">
            <div className="route-preview-info">
              <div className="route-preview-title">
                <FontAwesomeIcon icon={faRoute} className="route-preview-title-icon" />
                <span className="route-preview-dest">
                  {displayEntityName(route.evacuation_center?.name, "Evacuation Center")}
                </span>
                {(route.chosen_entrance?.name || route.evacuation_center?.chosen_entrance?.name) && (
                  <span className="route-preview-entrance-tag" title="Target entrance">
                    {route.chosen_entrance?.name || route.evacuation_center?.chosen_entrance?.name}
                  </span>
                )}
                {routeIsMine && myCenter?.room?.room_number && (
                  <span className="route-preview-room-tag">Room {myCenter.room.room_number}</span>
                )}
              </div>
              <div className="route-preview-meta">
                <span className="route-preview-dist">
                  {Number(route.distance_km || 0).toFixed(1)} km
                </span>
                <span className="route-preview-dot">·</span>
                <span className="route-preview-time">
                  <FontAwesomeIcon icon={faPersonWalking} />{" "}
                  {route.estimated_time_min ??
                    estimateTravelTimes(route.distance_km || 0).walking} min walking
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={handleClearRoute}
              className="route-preview-close"
              aria-label="Clear route"
              title="Clear route"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>
          <button
            type="button"
            className="route-preview-start-btn"
            onClick={handleStartWalkingNavigation}
          >
            <FontAwesomeIcon icon={faPersonWalking} />
            <span>Start walking navigation</span>
          </button>
        </div>
      )}

      {/* Recenter button when user panned away during active navigation */}
      {navigationActive && isPannedAway && (
        <button
          type="button"
          className="nav-recenter-btn"
          onClick={handleRecenter}
          aria-label="Recenter map"
        >
          <FontAwesomeIcon icon={faLocationCrosshairs} />
          <span>Recenter</span>
        </button>
      )}

      {/* Arrival toast message */}
      {arrivalToast && (
        <div className="nav-arrival-toast" role="alert">
          <FontAwesomeIcon icon={faCircleCheck} className="nav-arrival-icon" />
          <span>{arrivalToast}</span>
        </div>
      )}

      {/* Error */}
      {routeError && <div className="toast-error">{routeError}</div>}

      {/* Success */}
      {reportConfirmation && (
        <div className="toast-success">{reportConfirmation}</div>
      )}

      {/* My evacuation center form */}
      {myCenterOpen && (
        <div className="mc-overlay" onClick={closeMyCenter}>
          <div
            className="mc-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mc-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mc-header">
              <h3 id="mc-title">My evacuation center</h3>

              <button
                type="button"
                className="mc-close"
                onClick={closeMyCenter}
                aria-label="Close"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            {myCenter ? (
              <div className="mc-body">
                <div className="mc-result">
                  <div className="mc-result-name">
                    <FontAwesomeIcon icon={faCircleCheck} />

                    {myCenter.household_head_name}
                  </div>

                  {(myCenter.address || myCenter.barangay) && (
                    <div className="mc-result-sub">
                      {myCenter.address || myCenter.barangay}
                    </div>
                  )}

                  <div className="mc-result-row">
                    <span>Evacuation center</span>

                    <strong>{myCenter.evacuation_center?.name}</strong>
                  </div>

                  {myCenter.room?.building_name && (
                    <div className="mc-result-row">
                      <span>Building</span>
                      <strong>{myCenter.room.building_name}</strong>
                    </div>
                  )}

                  {myCenter.room?.room_number && (
                    <div className="mc-result-row">
                      <span>Assigned room</span>
                      <strong>{myCenter.room.room_number}</strong>
                    </div>
                  )}
                </div>

                <div className="mc-actions">
                  <button
                    type="button"
                    className="mc-btn mc-btn-primary"
                    onClick={handleFindMyCenterFromModal}
                    disabled={locationPermission === "denied"}
                  >
                    <FontAwesomeIcon icon={faRoute} />
                    Find My Center
                  </button>

                  <button
                    type="button"
                    className="mc-btn"
                    onClick={handleForgetMe}
                  >
                    Not me
                  </button>
                </div>

                {locationPermission === "denied" && (
                  <div className="mc-error">
                    Location access is blocked. Allow it in your browser's site
                    settings to get directions.
                  </div>
                )}
              </div>
            ) : (
              <form className="mc-body" onSubmit={handleLookupSubmit}>
                {!user && (
                  <div style={{ marginBottom: "14px", padding: "10px 14px", background: "#eff6ff", borderRadius: "10px", border: "1px solid #bfdbfe", fontSize: "13px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
                    <span style={{ color: "#1e40af", fontWeight: "500" }}>Have an account? Log in to auto-detect your center and room.</span>
                    <button type="button" className="ds-btn ds-btn--primary" style={{ height: "32px", fontSize: "12px", padding: "0 12px", flexShrink: 0 }} onClick={() => { closeMyCenter(); openLoginDialog(); }}>
                      Log In
                    </button>
                  </div>
                )}
                <p className="mc-hint">
                  Enter the full name of the head of your household to find the
                  evacuation center assigned to you.
                </p>

                <label className="mc-label" htmlFor="mc-name">
                  Full name
                </label>

                <div className="mc-autosuggest-wrap">
                  <input
                    id="mc-name"
                    type="text"
                    className="mc-input"
                    value={lookupName}
                    onChange={(e) => {
                      setLookupName(e.target.value);
                      setLookupError("");
                    }}
                    onKeyDown={handleAutosuggestKeyDown}
                    placeholder="e.g. Juan Dela Cruz"
                    autoComplete="off"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={autosuggestOpen}
                    aria-controls="mc-autosuggest-listbox"
                    aria-activedescendant={
                      autosuggestIndex >= 0
                        ? `mc-suggest-item-${autosuggestIndex}`
                        : undefined
                    }
                    autoFocus
                  />

                  {/* Accessible screen reader announcement */}
                  <div className="sr-only" aria-live="polite">
                    {autosuggestOpen && autosuggestList.length > 0
                      ? `${autosuggestList.length} suggestions available.`
                      : ""}
                  </div>

                  {/* Autosuggest Dropdown */}
                  {autosuggestOpen && (
                    <div
                      id="mc-autosuggest-listbox"
                      className="mc-autosuggest-dropdown"
                      role="listbox"
                      aria-label="Name suggestions"
                    >
                      {autosuggestLoading ? (
                        <div className="mc-autosuggest-loading" role="status">
                          <FontAwesomeIcon
                            icon={faSpinner}
                            spin
                            className="mc-autosuggest-spinner"
                          />
                          <span>Searching households...</span>
                        </div>
                      ) : autosuggestList.length === 0 ? (
                        <div className="mc-autosuggest-empty">
                          <span>No matches found</span>
                        </div>
                      ) : (
                        autosuggestList.map((item, idx) => {
                          const isSelected = idx === autosuggestIndex;
                          return (
                            <button
                              type="button"
                              key={`${item.name}-${item.barangay}-${idx}`}
                              id={`mc-suggest-item-${idx}`}
                              role="option"
                              aria-selected={isSelected}
                              className={`mc-autosuggest-item ${
                                isSelected ? "is-active" : ""
                              }`}
                              onClick={() => handleSelectSuggestion(item.name)}
                              onMouseEnter={() => setAutosuggestIndex(idx)}
                            >
                              <span className="mc-autosuggest-name">
                                {renderHighlightedText(item.name, lookupName)}
                              </span>
                              {item.barangay && (
                                <span className="mc-autosuggest-sub">
                                  Barangay {item.barangay}
                                </span>
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>

                {lookupError && <div className="mc-error">{lookupError}</div>}

                {lookupMatches.length > 0 && (
                  <div className="mc-matches">
                    <div className="mc-hint">
                      More than one household matches. Which one is yours?
                    </div>

                    {lookupMatches.map((match, index) => (
                      <button
                        type="button"
                        key={match.resident_id ?? `${match.address}-${index}`}
                        className="mc-match"
                        onClick={() => chooseMatch(match)}
                      >
                        <strong>{match.household_head_name}</strong>

                        <span>
                          {[match.address, match.barangay]
                            .filter(Boolean)
                            .join(", ") || "No address on file"}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                <div className="mc-actions">
                  <button
                    type="submit"
                    className="mc-btn mc-btn-primary"
                    disabled={lookupLoading}
                  >
                    <FontAwesomeIcon
                      icon={faMagnifyingGlass}
                      spin={lookupLoading}
                    />

                    {lookupLoading ? "Checking..." : "Find my center"}
                  </button>

                  <button type="button" className="mc-btn" onClick={closeMyCenter}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Deep-link / notification opening a saved hazard report */}
      {/* Rescue Alert Modal */}
      {rescueAlertOpen && (
        <RescueAlertModal
          onClose={handleCloseRescueModal}
          onSubmitted={handleRescueSubmitted}
          initialCoordinates={rescueCoordinates}
          onPinOnMap={handlePinRescueOnMap}
          onLocationCaptured={handleRescueLocationCaptured}
        />
      )}

      {/* Hazard Report Modal */}
      {pendingReportLocation && (
        <HazardReportModal
          location={pendingReportLocation}
          onClose={handleCloseReportModal}
          onSubmitted={handleReportSubmitted}
          onLocationChange={handleReportLocationChange}
          onAdjustOnMap={handleAdjustHazardOnMap}
        />
      )}

      {/* Collapsible Building Occupancy Legend (bottom-left) */}
      <div className={`rh-building-legend ${legendCollapsed ? "is-collapsed" : ""}`}>
        <button
          type="button"
          className="rh-legend-toggle-btn"
          onClick={() => setLegendCollapsed((prev) => !prev)}
          aria-label={legendCollapsed ? "Expand building legend" : "Collapse building legend"}
        >
          <span className="rh-legend-title">Building Occupancy</span>
          <FontAwesomeIcon icon={legendCollapsed ? faChevronUp : faChevronDown} />
        </button>
        {!legendCollapsed && (
          <div className="rh-legend-content">
            <div className="rh-legend-row">
              <span className="rh-legend-swatch" style={{ background: "#16a34a" }} />
              <span>Available (&lt;70%)</span>
            </div>
            <div className="rh-legend-row">
              <span className="rh-legend-swatch" style={{ background: "#d97706" }} />
              <span>Filling (70–99%)</span>
            </div>
            <div className="rh-legend-row">
              <span className="rh-legend-swatch" style={{ background: "#dc2626" }} />
              <span>Full</span>
            </div>
            <div className="rh-legend-row">
              <span className="rh-legend-swatch" style={{ background: "#94a3b8" }} />
              <span>No data</span>
            </div>
          </div>
        )}
      </div>

      {/* Building Details Modal (independent of center card) */}
      <BuildingDetailsModal
        isOpen={buildingModalOpen}
        buildingId={selectedBuildingId}
        initialBuildingData={selectedBuildingData}
        onClose={() => setBuildingModalOpen(false)}
        userHousehold={myCenter}
        isStaff={false}
      />

      {/* Login and Resident Sign-Up Dialogs */}
      <LoginDialog
        dialogRef={loginDialogRef}
        onOpenSignUp={openSignUpDialog}
        notice={authModalNotice}
        onLoginSuccess={(loggedInUser) => {
          if (loggedInUser?.role !== "resident") {
            navigate("/dashboard");
          } else {
            setReportConfirmation(`Welcome back, ${loggedInUser.name || "Resident"}!`);
            setTimeout(() => setReportConfirmation(""), 4000);
          }
        }}
      />
      <ResidentSignUpDialog
        dialogRef={signUpDialogRef}
        isOpen={signUpOpen}
        onClose={() => setSignUpOpen(false)}
        onOpenLogin={() => openLoginDialog()}
      />

    </div>
  );
};

export default ResidentHome;
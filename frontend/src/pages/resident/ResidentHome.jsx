import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

import { Link, useLocation, useNavigate } from "react-router-dom";
import { api, BASE_URL } from "../../services/api";
import HazardReportModal from "../../components/HazardReportModal/HazardReportModal";
import RescueAlertModal from "../../components/RescueAlertModal/RescueAlertModal";
import { EVAC_SHELTER_ICON_HTML, EvacShelterIcon } from "../../components/DashboardMap/evacShelterIcon";
import { getCenterCoordinates } from "../../utils/mapCenterCoordinates";
import { getMappedBuildingsForCenter } from "../../utils/centerBuildings";
import { getCenterAvailability, getFreeCenterCapacity } from "../../utils/routeCard";
import { applyPublicMapLayerVisibility, simplifyPublicBaseMap } from "../../utils/publicMapLayers";
import { shouldUpdateRouteArrowAnimation } from "../../utils/routeArrowAnimation.js";
import { resolveRoomBuilding } from "../../utils/resolveRoomBuilding";
import { needsLocationConfirmation } from "../../utils/locationConfirmation";
import { createReportPopup } from "../../components/mapReports/mapReports";
import {
  setOrUpdateSelectedLocationMarker,
  setOrUpdateAccuracyCircle,
  removeAccuracyCircle,
  highlightAndOpenSavedReport,
  refineGeolocation,
  animateLocationTransition,
} from "../../utils/mapLocationIndicators";

import { useHazardData } from "../../hooks/useHazardData";
import { useEvacuationData } from "../../hooks/useEvacuationData";
import { usePublicHazardReports, useRoadSegments, useSogodBoundary, queryKeys } from "../../hooks/useEvacuationQueries";
import { useRouting } from "../../hooks/useRouting";
import { displayEntityName } from "../../utils/displayEntityName";
import { formatFloorLabel } from "../../utils/formatRoomLabel";
import BuildingDetailsModal from "../../components/BuildingDetailsModal/BuildingDetailsModal";
import PublicMapDialogShell from "../../components/PublicMapDialogShell/PublicMapDialogShell";
import {
  initBuildingLayers,
  removeBuildingTooltip,
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
  faBuilding,
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
  faDownload,
  faLayerGroup,
} from "@fortawesome/free-solid-svg-icons";

import "../../components_css/MyLocationMarker.css";
import "../../components/DashboardMap/MapOverlays.css";
import "./ResidentHome.css";
import "./ResidentHome.motion.css";
import { useAuth } from "../../context/AuthContext";
import { LoginDialog, ResidentSignUpDialog } from "../../components/AuthModals/AuthModals";
import {
  buildOfflineTileUrl,
  getBasemapStyleUrl,
  getOfflineMapDownloadProgress,
  getSogodOfflineTileCoordinates,
  OFFLINE_MAP_MAX_BYTES,
  OPENFREEMAP_ALTERNATE_STYLE_URL,
  OPENFREEMAP_STYLE_URL,
  DEFAULT_PUBLIC_MAP_STYLE,
  parseOpenFreeMapTileUrl,
} from "../../config/offlineMap";
import { LONG_WALK_THRESHOLD_MINUTES } from "../../config/routeCard";
import { emergencyContacts } from "../../config/emergencyContacts";

const MAPBOX_ACCESS_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

function transformOpenFreeMapRequest(url) {
  const tile = parseOpenFreeMapTileUrl(url);
  if (tile) {
    return {
      url: new URL(buildOfflineTileUrl(tile), window.location.origin).href,
    };
  }
  return { url };
}

function formatPublicCenterUpdateTime(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
    : "";
}

function CenterCapacityFacts({ centerId, rooms, capacityOverride, className = "" }) {
  const calculatedCapacity = getFreeCenterCapacity(centerId, rooms);
  const capacity = {
    freeFamilySlots: capacityOverride?.free_family_slots ?? calculatedCapacity.freeFamilySlots,
    freePeopleSpaces: capacityOverride?.free_people_spaces ?? calculatedCapacity.freePeopleSpaces,
  };
  const familySlots = capacity.freeFamilySlots == null ? "Not tracked" : capacity.freeFamilySlots;
  const peopleSpaces = capacity.freePeopleSpaces == null ? "Not tracked" : capacity.freePeopleSpaces;

  return (
    <div className={`route-capacity-facts ${className}`.trim()} aria-label="Available center capacity">
      <div>
        <strong>{familySlots}</strong>
        <span>Family slots</span>
      </div>
      <div>
        <strong>{peopleSpaces}</strong>
        <span>People spaces</span>
      </div>
    </div>
  );
}

function RouteAlternativeCard({ alternative, rooms, onSelect }) {
  const center = alternative?.evacuation_center;
  if (!center?.id) return null;

  return (
    <section className="route-alternative-card" aria-label="Alternative evacuation center">
      <div className="route-alternative-heading">
        <span>Alternative center</span>
        <strong>{displayEntityName(center.name, "Evacuation Center")}</strong>
      </div>
      <div className="route-alternative-meta">
        {Number(alternative.distance_km || 0).toFixed(1)} km
        <span aria-hidden="true">·</span>
        {alternative.estimated_time_min ?? "—"} min walking
      </div>
      <CenterCapacityFacts centerId={center.id} rooms={rooms} capacityOverride={center} />
      <p className="route-choice-reason">
        {alternative.selection_reason || "Next shortest reachable walking distance."}
      </p>
      <button type="button" className="route-alternative-select" onClick={onSelect}>
        Route to this center
      </button>
    </section>
  );
}

export const SOGOD_CENTER = [10.3932, 124.9886];

export const SOGOD_BOUNDS = [
  [10.368, 124.912],
  [10.525, 125.078],
];

export const DEFAULT_MAP_ZOOM = 14.5;
export const MIN_MAP_ZOOM = 11;
export const MAX_MAP_ZOOM = 18;

/*
 * Below this zoom: centers are shown as icons with their name.
 * At this zoom and above: the building outline and room icons show.
 */
const ROOM_MIN_ZOOM = 14;
const HAZARD_LABEL_ZOOM = 14.5;
const CENTER_MARKER_MAX_ZOOM = 16;
const PUBLIC_MAP_QUERY_OPTIONS = {
  staleTime: 20000,
  refetchOnMount: "always",
};
const ROUTE_SAFETY_QUERY_OPTIONS = {
  ...PUBLIC_MAP_QUERY_OPTIONS,
  refetchInterval: 30000,
  refetchIntervalInBackground: false,
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

function drawCanvasRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }
}

export function createHazardMarkerImage(isBlocked, labelText, iconDef, withLabel = true) {
  const dpr = 2;
  const squareSize = 34;
  const squareRadius = 10;
  const squareHalf = squareSize / 2;

  if (!withLabel) {
    // Compact icon (zoomed out far): ONLY the red rounded-square badge, no label
    const pad = 6;
    const logicalW = squareSize + pad * 2; // 46px
    const logicalH = squareSize + pad * 2; // 46px
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(logicalW * dpr);
    canvas.height = Math.round(logicalH * dpr);
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    const cx = logicalW / 2;
    const cy = logicalH / 2;
    const squareX = cx - squareHalf;
    const squareY = cy - squareHalf;

    // 1. Red rounded-square badge shadow
    ctx.save();
    ctx.shadowColor = "rgba(45, 31, 22, 0.35)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = isBlocked ? "#dc2626" : "#bd3c31";
    drawCanvasRoundedRect(ctx, squareX, squareY, squareSize, squareSize, squareRadius);
    ctx.fill();
    ctx.restore();

    // 2. White outline (border) around the badge
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    drawCanvasRoundedRect(ctx, squareX, squareY, squareSize, squareSize, squareRadius);
    ctx.stroke();

    // 3. White symbol inside badge
    if (iconDef && Array.isArray(iconDef.icon) && iconDef.icon[4]) {
      const [iconW, iconH, , , pathData] = iconDef.icon;
      const targetIconSize = 16;
      const scale = targetIconSize / Math.max(iconW, iconH);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      ctx.translate(-iconW / 2, -iconH / 2);
      ctx.fillStyle = "#ffffff";
      try {
        ctx.fill(new Path2D(pathData));
      } catch {
        ctx.beginPath();
        ctx.arc(iconW / 2, iconH / 2, iconW / 3, 0, Math.PI * 2);
        ctx.lineWidth = iconW / 8;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();
      }
      ctx.restore();
    }

    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  // Full icon (zoomed in): Badge + "Road blocked" label sitting just below
  const fontSize = 14;
  const font = `800 ${fontSize}px "Public Sans", system-ui, -apple-system, sans-serif`;

  const tempCanvas = document.createElement("canvas");
  const tempCtx = tempCanvas.getContext("2d");
  tempCtx.font = font;
  const textWidth = Math.ceil(tempCtx.measureText(labelText).width);

  const pillPaddingX = 7;
  const pillPaddingY = 3;
  const pillWidth = textWidth + pillPaddingX * 2;
  const pillHeight = fontSize + pillPaddingY * 2 + 2; // ~18px
  const gap = 3;

  // Symmetrical anchor: center of square badge sits at (cx, yCenter).
  // Distance from badge center to bottom of label: 17 + 3 + 18 = 38px.
  // Symmetrical height = 76px so badge center sits at exact canvas center.
  const yCenter = squareHalf + gap + pillHeight; // 38px
  const logicalH = yCenter * 2; // 76px
  const logicalW = Math.max(squareSize + 20, pillWidth + 16, 92);

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(logicalW * dpr);
  canvas.height = Math.round(logicalH * dpr);
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const cx = logicalW / 2;
  const squareX = cx - squareSize / 2;
  const squareY = yCenter - squareSize / 2; // 21px

  // 1. Red rounded-square badge with subtle drop shadow
  ctx.save();
  ctx.shadowColor = "rgba(45, 31, 22, 0.35)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = isBlocked ? "#dc2626" : "#bd3c31";
  drawCanvasRoundedRect(ctx, squareX, squareY, squareSize, squareSize, squareRadius);
  ctx.fill();
  ctx.restore();

  // 2. White outline (border) around the badge so it stands out from the red road
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  drawCanvasRoundedRect(ctx, squareX, squareY, squareSize, squareSize, squareRadius);
  ctx.stroke();

  // 3. White circle-slash (no-entry) symbol inside the badge
  if (iconDef && Array.isArray(iconDef.icon) && iconDef.icon[4]) {
    const [iconW, iconH, , , pathData] = iconDef.icon;
    const targetIconSize = 16;
    const scale = targetIconSize / Math.max(iconW, iconH);
    ctx.save();
    ctx.translate(cx, yCenter);
    ctx.scale(scale, scale);
    ctx.translate(-iconW / 2, -iconH / 2);
    ctx.fillStyle = "#ffffff";
    try {
      ctx.fill(new Path2D(pathData));
    } catch {
      ctx.beginPath();
      ctx.arc(iconW / 2, iconH / 2, iconW / 3, 0, Math.PI * 2);
      ctx.lineWidth = iconW / 8;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(iconW * 0.25, iconH * 0.25);
      ctx.lineTo(iconW * 0.75, iconH * 0.75);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 4. Small red "Road blocked" label sitting just below the badge
  const pillX = cx - pillWidth / 2;
  const pillY = squareY + squareSize + gap; // 58px

  // Pill shadow
  ctx.save();
  ctx.shadowColor = "rgba(45, 31, 22, 0.25)";
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = isBlocked ? "#dc2626" : "#fff8f4";
  drawCanvasRoundedRect(ctx, pillX, pillY, pillWidth, pillHeight, 5);
  ctx.fill();
  ctx.restore();

  // Pill border
  ctx.strokeStyle = isBlocked ? "#ffffff" : "rgba(157, 49, 39, 0.25)";
  ctx.lineWidth = 1;
  drawCanvasRoundedRect(ctx, pillX, pillY, pillWidth, pillHeight, 5);
  ctx.stroke();

  // Pill text
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = isBlocked ? "#ffffff" : "#7d241e";
  ctx.fillText(labelText, cx, pillY + pillHeight / 2);

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export function ensureHazardImage(map, isBlocked, labelText, iconDef, withLabel = true) {
  if (!map) return "";
  const variant = withLabel ? "full" : "compact";
  const safeId = `hazard-marker-v5-${isBlocked ? "badge" : "warning"}-${variant}-${encodeURIComponent(labelText).replace(/[%._-]/g, "")}`;
  if (!map.hasImage(safeId)) {
    try {
      const imgData = createHazardMarkerImage(isBlocked, labelText, iconDef, withLabel);
      map.addImage(safeId, imgData, { pixelRatio: 2 });
    } catch (err) {
      console.warn("Could not add hazard marker image:", err);
    }
  }
  return safeId;
}

export function distanceBetweenPointsMeters(p1, p2) {
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

export function getLineMidpoint(coords) {
  if (!Array.isArray(coords) || coords.length === 0) return null;
  if (typeof coords[0] === "number" && coords.length >= 2) return coords;
  if (coords.length === 1) return coords[0];
  if (coords.length === 2) {
    return [(coords[0][0] + coords[1][0]) / 2, (coords[0][1] + coords[1][1]) / 2];
  }
  let totalDist = 0;
  const dists = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const d = distanceBetweenPointsMeters(coords[i], coords[i + 1]);
    dists.push(d);
    totalDist += d;
  }
  if (totalDist === 0) return coords[Math.floor(coords.length / 2)];
  const halfDist = totalDist / 2;
  let accumulated = 0;
  for (let i = 0; i < dists.length; i++) {
    if (accumulated + dists[i] >= halfDist) {
      const remain = halfDist - accumulated;
      const frac = dists[i] > 0 ? remain / dists[i] : 0.5;
      return [
        coords[i][0] + (coords[i + 1][0] - coords[i][0]) * frac,
        coords[i][1] + (coords[i + 1][1] - coords[i][1]) * frac,
      ];
    }
    accumulated += dists[i];
  }
  return coords[Math.floor(coords.length / 2)];
}

export function getLineLength(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return 0;
  let len = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    len += distanceBetweenPointsMeters(coords[i], coords[i + 1]);
  }
  return len;
}

export function getPointAlongLine(coords, targetDist) {
  if (!Array.isArray(coords) || coords.length === 0) return null;
  if (coords.length === 1) return coords[0];
  let accumulated = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const segDist = distanceBetweenPointsMeters(coords[i], coords[i + 1]);
    if (accumulated + segDist >= targetDist || i === coords.length - 2) {
      const remain = Math.max(0, targetDist - accumulated);
      const frac = segDist > 0 ? Math.min(1, remain / segDist) : 0.5;
      return [
        coords[i][0] + (coords[i + 1][0] - coords[i][0]) * frac,
        coords[i][1] + (coords[i + 1][1] - coords[i][1]) * frac,
      ];
    }
    accumulated += segDist;
  }
  return coords[coords.length - 1];
}

export function getReportBlockedRoadMidpoint(report, roadFeatures) {
  const fallbackLng = Number(report.longitude ?? report.lng);
  const fallbackLat = Number(report.latitude ?? report.lat);
  const fallbackCoords =
    Number.isFinite(fallbackLng) && Number.isFinite(fallbackLat)
      ? [fallbackLng, fallbackLat]
      : null;

  if (!roadFeatures || roadFeatures.length === 0) return fallbackCoords;

  const repRoadId = report.road_segment_id ?? report.road_id;
  const closedNames = new Set(
    (Array.isArray(report.closed_roads) ? report.closed_roads : [report.road_name])
      .filter(Boolean)
      .map((n) => String(n).toLowerCase().trim())
  );

  let matched = roadFeatures.filter((feat) => {
    const p = feat.properties || {};
    const featRoadId = p.id ?? p.road_segment_id;
    if (repRoadId && featRoadId && String(repRoadId) === String(featRoadId)) return true;
    const name = String(p.road_name || "").toLowerCase().trim();
    return name && closedNames.has(name);
  });

  if (matched.length === 0) return fallbackCoords;

  if (fallbackCoords && matched.length > 1) {
    const closedMatched = matched.filter((m) => m.properties?.is_closed);
    const pool = closedMatched.length > 0 ? closedMatched : matched;
    const close = pool.filter((m) => {
      const coords = m.geometry?.coordinates;
      if (!Array.isArray(coords) || coords.length === 0) return false;
      const minDist = Math.min(...coords.map((pt) => distanceBetweenPointsMeters(fallbackCoords, pt)));
      return minDist <= 400;
    });
    if (close.length > 0) {
      matched = close;
    } else if (closedMatched.length > 0) {
      matched = closedMatched;
    }
  }

  const validCoordsList = matched
    .map((s) => s.geometry?.coordinates)
    .filter((c) => Array.isArray(c) && c.length >= 2);

  if (validCoordsList.length === 0) return fallbackCoords;
  if (validCoordsList.length === 1) {
    return getLineMidpoint(validCoordsList[0]);
  }

  const segLengths = validCoordsList.map((c) => getLineLength(c));
  const totalLen = segLengths.reduce((a, b) => a + b, 0);
  if (totalLen === 0) return validCoordsList[0][0];

  const halfDist = totalLen / 2;
  let accumulated = 0;
  for (let i = 0; i < validCoordsList.length; i++) {
    if (accumulated + segLengths[i] >= halfDist || i === validCoordsList.length - 1) {
      const remain = halfDist - accumulated;
      return getPointAlongLine(validCoordsList[i], remain);
    }
    accumulated += segLengths[i];
  }
  return validCoordsList[0][0];
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
  const accessToken = MAPBOX_ACCESS_TOKEN;
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

function distanceBetweenCoordsMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.max(0, Math.min(1, a))));
}

function minDistanceToPolylineMeters(lat, lng, polyline) {
  if (!Array.isArray(polyline) || polyline.length === 0) return Infinity;
  if (polyline.length === 1) {
    return distanceBetweenCoordsMeters(lat, lng, polyline[0][0], polyline[0][1]);
  }
  let minDist = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const lat1 = polyline[i][0];
    const lng1 = polyline[i][1];
    const lat2 = polyline[i + 1][0];
    const lng2 = polyline[i + 1][1];

    const midLat = (((lat1 + lat2) / 2) * Math.PI) / 180;
    const cosLat = Math.cos(midLat);
    const dx = (lng2 - lng1) * cosLat;
    const dy = lat2 - lat1;
    const lenSq = dx * dx + dy * dy;

    let projLat = lat1;
    let projLng = lng1;
    if (lenSq > 1e-14) {
      const px = (lng - lng1) * cosLat;
      const py = lat - lat1;
      const t = Math.max(0, Math.min(1, (px * dx + py * dy) / lenSq));
      projLat = lat1 + t * (lat2 - lat1);
      projLng = lng1 + t * (lng2 - lng1);
    }
    const d = distanceBetweenCoordsMeters(lat, lng, projLat, projLng);
    if (d < minDist) {
      minDist = d;
      if (minDist <= 15.0) {
        break;
      }
    }
  }
  return minDist;
}

export function mapboxRouteMatchesBackend(mapboxRouteCoords, backendCoords, thresholdMeters = 15.0) {
  if (!Array.isArray(mapboxRouteCoords) || mapboxRouteCoords.length === 0) return false;
  if (!Array.isArray(backendCoords) || backendCoords.length === 0) return false;

  for (let i = 0; i < mapboxRouteCoords.length; i++) {
    const pt = mapboxRouteCoords[i];
    if (!Array.isArray(pt) || pt.length < 2) continue;
    const dist = minDistanceToPolylineMeters(pt[0], pt[1], backendCoords);
    if (dist > thresholdMeters) {
      return false;
    }
  }
  return true;
}

function clearSavedResident() {
  try {
    localStorage.removeItem(RESIDENT_STORAGE_KEY);
  } catch {
    // storage unavailable: ignore
  }
}

// --------------------------------------------------
// Format first name and last name (omit middle name, title-case)
// --------------------------------------------------

function formatFirstAndLastName(rawName) {
  if (!rawName || typeof rawName !== "string") return "";
  const parts = rawName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";

  const toTitleCase = (str) =>
    str
      .toLowerCase()
      .split("-")
      .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
      .join("-");

  if (parts.length === 1) {
    return toTitleCase(parts[0]);
  }

  // Only the first name and the last name, removing any middle name(s)
  const first = toTitleCase(parts[0]);
  const last = toTitleCase(parts[parts.length - 1]);
  return `${first} ${last}`;
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

function isInsideSogodBoundary(point, boundary) {
  if (!boundary || !point) return false;
  const features = boundary.type === "FeatureCollection" ? boundary.features : [boundary];
  return features.some((feature) => {
    const geometry = feature?.type === "Feature" ? feature.geometry : feature;
    return geometry?.type === "Polygon" || geometry?.type === "MultiPolygon"
      ? isPointInGeoPolygon(point, geometry.coordinates)
      : false;
  });
}

// --------------------------------------------------
// Project point [lng, lat] onto LineString or MultiLineString geometry
// --------------------------------------------------

function projectPointToLineStringGeometry(point, geometry, projectCoordinate) {
  if (!point || !geometry || !geometry.coordinates) return point;
  const [lng, lat] = point;
  const project = projectCoordinate || ((coordinate) => ({ x: coordinate[0], y: coordinate[1] }));
  const projectedPoint = project(point);

  let coordinateRings = [];
  if (geometry.type === "LineString") {
    coordinateRings = [geometry.coordinates];
  } else if (geometry.type === "MultiLineString") {
    coordinateRings = geometry.coordinates;
  } else {
    return point;
  }

  let minDistSq = Infinity;
  let bestPoint = [lng, lat];

  for (const coords of coordinateRings) {
    if (!Array.isArray(coords) || coords.length < 2) continue;
    for (let i = 0; i < coords.length - 1; i++) {
      const p1 = coords[i];
      const p2 = coords[i + 1];
      if (!Array.isArray(p1) || !Array.isArray(p2)) continue;

      const coordinateDx = p2[0] - p1[0];
      const coordinateDy = p2[1] - p1[1];
      const projectedP1 = project(p1);
      const projectedP2 = project(p2);
      const dx = projectedP2.x - projectedP1.x;
      const dy = projectedP2.y - projectedP1.y;
      const lenSq = dx * dx + dy * dy;

      let proj;
      if (lenSq === 0) {
        proj = p1;
      } else {
        const t = Math.max(0, Math.min(1, ((projectedPoint.x - projectedP1.x) * dx + (projectedPoint.y - projectedP1.y) * dy) / lenSq));
        proj = [p1[0] + t * coordinateDx, p1[1] + t * coordinateDy];
      }

      const projectedProj = project(proj);
      const distSq = (projectedPoint.x - projectedProj.x) ** 2 + (projectedPoint.y - projectedProj.y) ** 2;
      if (distSq < minDistSq) {
        minDistSq = distSq;
        bestPoint = proj;
      }
    }
  }

  return bestPoint;
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
  const [isMobile, setIsMobile] = useState(window.innerWidth <= breakpoint);

  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth <= breakpoint);
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

function createHazardPopup(properties, closedRoadNames = [], options = {}) {
  const fullReport = {
    ...properties,
    closed_roads:
      Array.isArray(closedRoadNames) && closedRoadNames.length > 0
        ? closedRoadNames
        : properties.closed_roads || [],
  };
  return createReportPopup(fullReport, options);
}

function isBlockedRoadReport(report) {
  if (!report) return false;
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

export function findReportForRoad(properties, reports) {
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
    matches.find(
      (report) =>
        (Array.isArray(report.photos) && report.photos.length > 0) ||
        report.photo_url ||
        report.image_url ||
        report.photo
    ) ||
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

  const candidateUrl =
    (Array.isArray(report?.photos) && report.photos.length > 0 ? report.photos[0] : null) ||
    properties.photo_url ||
    properties.image_url ||
    properties.photo ||
    report?.photo_url ||
    report?.image_url ||
    report?.photo;
  const photoUrl = resolvePhotoUrl(candidateUrl);
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
  const location = useLocation();
  const { user, logout } = useAuth();
  const isLoggedInResident = user?.role === "resident";
  const queryClient = useQueryClient();

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
  const hazardReportsQuery = usePublicHazardReports(ROUTE_SAFETY_QUERY_OPTIONS);
  const roadSegmentsQuery = useRoadSegments(ROUTE_SAFETY_QUERY_OPTIONS);
  const sogodBoundaryQuery = useSogodBoundary();
  const hazardReports = useMemo(
    () => Array.isArray(hazardReportsQuery.data)
      ? hazardReportsQuery.data.filter(isValidatedReport)
      : [],
    [hazardReportsQuery.data]
  );
  const roads = roadSegmentsQuery.data ?? null;
  const routeSafetySignature = useMemo(() => JSON.stringify({
    validatedHazards: hazardReports.map((report) => report.id).sort(),
    closedRoads: (roads?.features || [])
      .filter((feature) => feature.properties?.is_closed)
      .map((feature) => feature.properties?.id)
      .sort(),
  }), [hazardReports, roads]);
  const sogodBoundary = sogodBoundaryQuery.data ?? null;
  const sogodBoundaryRef = useRef(null);
  useEffect(() => {
    sogodBoundaryRef.current = sogodBoundary;
  }, [sogodBoundary]);

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
    setRouteIsMine,
    routeError,
    setRouteError,
    findingRoute,
    setFindingRoute
  } = useRouting();
  const routeSafetySignatureRef = useRef(null);
  const [routeDetailsOpen, setRouteDetailsOpen] = useState(false);
  const [otherCentersOpen, setOtherCentersOpen] = useState(false);
  const routeWalkMinutes = Number(
    route?.estimated_time_min
    ?? (route ? estimateTravelTimes(route.distance_km || 0).walking : 0)
  );
  const calculatedRouteAvailability = route?.evacuation_center?.id != null
    ? getCenterAvailability(route.evacuation_center.id, rooms, route.evacuation_center.capacity)
    : { status: "unavailable", freePeopleSpaces: null };
  const serverFreeSlots = Number(route?.evacuation_center?.free_family_slots);
  const serverFreePeople = Number(route?.evacuation_center?.free_people_spaces);
  const hasServerCapacity = Number.isFinite(serverFreeSlots) && Number.isFinite(serverFreePeople);
  const routeAvailability = hasServerCapacity
    ? {
      status: serverFreeSlots <= 0 || serverFreePeople <= 0
        ? "full"
        : calculatedRouteAvailability.status === "almost-full" ? "almost-full" : "available",
      freePeopleSpaces: serverFreePeople,
    }
    : calculatedRouteAvailability;
  const configuredHotline = emergencyContacts.hotlines[0] || null;

  useEffect(() => {
    setRouteDetailsOpen(false);
    setOtherCentersOpen(false);
  }, [route?.evacuation_center?.id, route?.alternative_center?.evacuation_center?.id]);

  // --------------------------------------------------
  // Map style
  // Street is the default
  // --------------------------------------------------

  const [mapStyle, setMapStyle] = useState(DEFAULT_PUBLIC_MAP_STYLE);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [offlineMapDownload, setOfflineMapDownload] = useState({
    status: "idle",
    completed: 0,
    total: 0,
    error: "",
  });
  const offlineMapProgress = getOfflineMapDownloadProgress(
    offlineMapDownload.completed,
    offlineMapDownload.total,
  );
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [mapLayersOpen, setMapLayersOpen] = useState(false);
  const [publicMapLayers, setPublicMapLayers] = useState({
    centers: true,
    hazards: true,
    boundaries: true,
  });

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
  const hazardPopupRef = useRef(null);
  const [isHazardPopupOpen, setIsHazardPopupOpen] = useState(false);
  const [isMobileMap, setIsMobileMap] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(max-width: 768px)").matches
      : false
  );
  const accuracyCircleStateRef = useRef(null);
  const pickingPurposeRef = useRef("hazard");

  const [pendingSuggestedRoad, setPendingSuggestedRoad] = useState(null);
  const [quickLocating, setQuickLocating] = useState(false);

  const [reportConfirmation, setReportConfirmation] = useState("");
  const [requestingAssistance, setRequestingAssistance] = useState(false);
  const [assistanceSent, setAssistanceSent] = useState(false);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const profileDropdownRef = useRef(null);
  const [findSomeoneSearchable, setFindSomeoneSearchable] = useState(false);
  const [findSomeonePrivacyLoading, setFindSomeonePrivacyLoading] = useState(false);
  const [findSomeonePrivacySaving, setFindSomeonePrivacySaving] = useState(false);
  const [findSomeonePrivacyError, setFindSomeonePrivacyError] = useState("");
  const [findSomeonePrivacyPromptOpen, setFindSomeonePrivacyPromptOpen] = useState(false);
  const [findSomeonePromptChoice, setFindSomeonePromptChoice] = useState(false);

  useEffect(() => {
    if (!profileDropdownOpen) return;

    function handleKeyDown(e) {
      if (e.key === "Escape") {
        setProfileDropdownOpen(false);
      }
    }

    function handleClickOutside(e) {
      if (profileDropdownRef.current && !profileDropdownRef.current.contains(e.target)) {
        setProfileDropdownOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [profileDropdownOpen]);

  useEffect(() => {
    if (!isLoggedInResident) {
      setFindSomeonePrivacyPromptOpen(false);
      setFindSomeoneSearchable(false);
      return undefined;
    }
    let active = true;
    api.getFindSomeonePrivacy()
      .then((result) => {
        if (!active) return;
        setFindSomeoneSearchable(Boolean(result.searchable));
        if (result.prompt_pending) {
          setFindSomeonePromptChoice(false);
          setFindSomeonePrivacyPromptOpen(true);
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, [isLoggedInResident]);

  useEffect(() => {
    if (!profileDropdownOpen || !isLoggedInResident) return undefined;
    let active = true;
    setFindSomeonePrivacyLoading(true);
    setFindSomeonePrivacyError("");
    api.getFindSomeonePrivacy()
      .then((result) => {
        if (active) setFindSomeoneSearchable(Boolean(result.searchable));
      })
      .catch((error) => {
        if (active) setFindSomeonePrivacyError(error.message || "Could not load this setting.");
      })
      .finally(() => {
        if (active) setFindSomeonePrivacyLoading(false);
      });
    return () => { active = false; };
  }, [profileDropdownOpen, isLoggedInResident]);

  async function handleFindSomeonePrivacyChange(event) {
    const nextValue = event.target.checked;
    const previousValue = findSomeoneSearchable;
    setFindSomeoneSearchable(nextValue);
    setFindSomeonePrivacySaving(true);
    setFindSomeonePrivacyError("");
    try {
      const result = await api.updateFindSomeonePrivacy(nextValue);
      setFindSomeoneSearchable(Boolean(result.searchable));
    } catch (error) {
      setFindSomeoneSearchable(previousValue);
      setFindSomeonePrivacyError(error.message || "Could not update this setting.");
    } finally {
      setFindSomeonePrivacySaving(false);
    }
  }

  async function saveFindSomeonePromptChoice() {
    setFindSomeonePrivacySaving(true);
    setFindSomeonePrivacyError("");
    try {
      const result = await api.updateFindSomeonePrivacy(findSomeonePromptChoice);
      setFindSomeoneSearchable(Boolean(result.searchable));
      setFindSomeonePrivacyPromptOpen(false);
    } catch (error) {
      setFindSomeonePrivacyError(error.message || "Could not save this setting.");
    } finally {
      setFindSomeonePrivacySaving(false);
    }
  }

  const [locationPermission, setLocationPermission] = useState("unknown");
  const [showRoutePinOption, setShowRoutePinOption] = useState(false);

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
  const [, setNavPillExpanded] = useState(false);
  const arrowAnimRef = useRef(null);
  const activeEntranceRef = useRef(null);
  const navigationRemainingMetersRef = useRef(null);
  const [navigationLocationConfirmation, setNavigationLocationConfirmation] = useState(null);
  const [assistanceLocationConfirmation, setAssistanceLocationConfirmation] = useState(null);
  const [lostSignal, setLostSignal] = useState(false);
  const lastGoodReadingTimeRef = useRef(0);
  const lastBatteryThrottleRef = useRef(null);
  const markerAnimationCleanupRef = useRef(null);

  // Stop geolocation watcher on window unload / unmount
  useEffect(() => {
    function handleBeforeUnload() {
      if (navigationWatchIdRef.current != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(navigationWatchIdRef.current);
        navigationWatchIdRef.current = null;
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      handleBeforeUnload();
    };
  }, []);

  // --------------------------------------------------
  // "My evacuation center" (name verification)
  // --------------------------------------------------

  const [myCenter, setMyCenter] = useState(null);
  const [roomCardExpanded, setRoomCardExpanded] = useState(false);
  const [myCenterOpen, setMyCenterOpen] = useState(false);
  const [lookupName, setLookupName] = useState("");
  const [lookupBarangayId, setLookupBarangayId] = useState("");
  const [lookupBirthdate, setLookupBirthdate] = useState("");
  const [lookupBarangays, setLookupBarangays] = useState([]);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState("");

  // "Find someone" state
  const [findSomeoneOpen, setFindSomeoneOpen] = useState(false);
  const [findSomeoneName, setFindSomeoneName] = useState("");
  const [findSomeoneBarangayId, setFindSomeoneBarangayId] = useState("");
  const [findSomeoneAdditionalDetail, setFindSomeoneAdditionalDetail] = useState("");
  const [findSomeoneBarangays, setFindSomeoneBarangays] = useState([]);
  const [findSomeoneBarangaysLoading, setFindSomeoneBarangaysLoading] = useState(false);
  const [findSomeoneLoading, setFindSomeoneLoading] = useState(false);
  const [findSomeoneResults, setFindSomeoneResults] = useState([]);
  const [findSomeoneHint, setFindSomeoneHint] = useState("");
  const [findSomeoneSearched, setFindSomeoneSearched] = useState(false);
  const [foundPersonLocation, setFoundPersonLocation] = useState(null);
  const [findSomeoneMapNotice, setFindSomeoneMapNotice] = useState("");

  // Building details modal (independent of center card)
  const [buildingModalOpen, setBuildingModalOpen] = useState(false);
  const [selectedBuildingId, setSelectedBuildingId] = useState(null);
  const [selectedBuildingData, setSelectedBuildingData] = useState(null);
  const [privateBuildingView, setPrivateBuildingView] = useState(false);

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
  const [centerPanelScrolled, setCenterPanelScrolled] = useState(false);

  const clearFoundPersonLocation = useCallback(() => {
    const foundId = mapRef.current?.__foundPersonBuildingId;
    setUserBuilding(mapRef.current, null, "found");
    setFoundPersonLocation(null);
    if (foundId != null) {
      setSelectedBuildingId((id) => String(id) === String(foundId) ? null : id);
      setSelectedBuilding(mapRef.current, null);
    }
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapLoaded || !map || !foundPersonLocation) return;
    const dismissOnMapClick = (event) => {
      if (pickingLocationRef.current) return;
      const layer = "evacway-buildings-fill";
      const features = map.getLayer(layer) ? map.queryRenderedFeatures(event.point, { layers: [layer] }) : [];
      const onFoundBuilding = features.some((feature) =>
        String(feature.properties?.id ?? feature.id) === String(foundPersonLocation.buildingId));
      if (!onFoundBuilding) clearFoundPersonLocation();
    };
    map.on("click", dismissOnMapClick);
    return () => map.off("click", dismissOnMapClick);
  }, [mapLoaded, foundPersonLocation, clearFoundPersonLocation]);

  useEffect(() => {
    if (!findSomeoneMapNotice) return;
    const timeout = setTimeout(() => setFindSomeoneMapNotice(""), 4000);
    return () => clearTimeout(timeout);
  }, [findSomeoneMapNotice]);

  // --------------------------------------------------
  // Keep pickingLocationRef in sync with pickingLocation
  // --------------------------------------------------

  useEffect(() => {
    pickingLocationRef.current = pickingLocation;
    if (mapRef.current) {
      mapRef.current.__pickingLocation = pickingLocation;
      if (pickingLocation) {
        removeBuildingTooltip(mapRef.current);
      }
    }
  }, [pickingLocation]);

  // --------------------------------------------------
  // Only one sheet open at a time: opening the center
  // details closes More / Help.
  // --------------------------------------------------

  useEffect(() => {
    if (selectedCenter) {
      setMoreMenuOpen(false);
      setHelpOpen(false);
      setMapLayersOpen(false);
    }
  }, [selectedCenter]);

  // Escape closes any open sheet
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key !== "Escape") return;
      setMoreMenuOpen(false);
      setHelpOpen(false);
      setMapLayersOpen(false);
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

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const mq = window.matchMedia("(max-width: 768px)");
    const onChange = (event) => setIsMobileMap(event.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  // Keyboard close for popovers/sheets/cards
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "Escape") {
        setHelpOpen(false);
        setMoreMenuOpen(false);
        setMapLayersOpen(false);
        setShowSearchResults(false);
        if (selectedCenter) {
          clearFoundPersonLocation();
          setSelectedCenter(null);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedCenter, clearFoundPersonLocation]);

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
            "text-size": 14,
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
      if (pickingLocationRef.current) return;
      const feature = event.features?.[0];
      if (!feature) return;

      const popup = new mapboxgl.Popup({
        offset: [0, -20],
        className: "ew-popup",
        maxWidth: "440px",
        closeButton: false,
        closeOnClick: true,
      });
      popup.on("close", () => {
        setIsHazardPopupOpen(false);
        if (hazardPopupRef.current === popup) {
          hazardPopupRef.current = null;
        }
      });
      popup.on("open", () => {
        setIsHazardPopupOpen(true);
      });
      popup
        .setLngLat(event.lngLat)
        .setDOMContent(
          createHazardPopup(feature.properties || {}, [], {
            onClose: () => {
              popup.remove();
              setIsHazardPopupOpen(false);
            },
            popup,
          })
        )
        .addTo(map);
      hazardPopupRef.current = popup;
      setIsHazardPopupOpen(true);
    };

    const handleMouseEnter = () => {
      try {
        if (pickingLocationRef.current) return;
        map.getCanvas().style.cursor = "pointer";
      } catch (e) { }
    };
    const handleMouseLeave = () => {
      try {
        if (pickingLocationRef.current) return;
        map.getCanvas().style.cursor = "";
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

  // Put photo-bearing hazard reports on the map as native WebGL symbols.
  // Anchored mathematically to the exact road coordinates, moving with 100% GPU smoothness
  // and automatic collision decluttering so close icons never stack or overlap on zoom out.
  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded) return;

    const sourceId = "resident-hazard-reports-source";
    const layerIdFull = "resident-hazard-reports-layer";
    const layerIdCompact = "resident-hazard-reports-layer-compact";

    // Clean up any legacy DOM markers if present
    hazardMarkersRef.current.forEach((marker) => marker.remove());
    hazardMarkersRef.current = [];

    const features = [];
    const seenReportIds = new Set();

    hazardReports.forEach((report) => {
      if (!report || report.id == null) return;
      const reportIdStr = String(report.id);
      if (seenReportIds.has(reportIdStr)) return;
      seenReportIds.add(reportIdStr);

      const coordinates = getValidCoordinates([
        report.longitude ?? report.lng,
        report.latitude ?? report.lat,
      ]);

      if (!coordinates) return;

      const blocked = isBlockedRoadReport(report);
      const labelText = blocked ? "Road blocked" : report.report_type || "Hazard";
      const iconDef = blocked ? faBan : faTriangleExclamation;
      const iconNameFull = ensureHazardImage(map, blocked, labelText, iconDef, true);
      const iconNameCompact = ensureHazardImage(map, blocked, labelText, iconDef, false);

      features.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates,
        },
        properties: {
          id: report.id,
          icon_name: iconNameFull,
          icon_name_full: iconNameFull,
          icon_name_compact: iconNameCompact,
          is_blocked: blocked,
          report_type: report.report_type || "",
        },
      });
    });

    console.log(
      `[Hazard Reports] Validated reports: ${hazardReports.length}, Features drawn: ${features.length}`
    );

    const geojsonData = {
      type: "FeatureCollection",
      features,
    };

    try {
      const existingSource = map.getSource(sourceId);
      if (existingSource) {
        existingSource.setData(geojsonData);
      } else {
        map.addSource(sourceId, {
          type: "geojson",
          data: geojsonData,
        });
      }

      const hazardFullMinZoom = isMobileMap ? 16 : 15;
      const hazardCompactIconSize = isMobileMap ? 30 / 34 : 1.0;

      // Compact layer (< 15 desktop, < 16 mobile): badge icon ONLY, no label
      if (!map.getLayer(layerIdCompact)) {
        map.addLayer({
          id: layerIdCompact,
          type: "symbol",
          source: sourceId,
          maxzoom: hazardFullMinZoom,
          layout: {
            "icon-image": ["get", "icon_name_compact"],
            "icon-anchor": "center",
            "icon-size": hazardCompactIconSize,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "icon-padding": 0,
          },
        });
      } else {
        map.setLayerZoomRange(layerIdCompact, 0, hazardFullMinZoom);
        map.setLayoutProperty(layerIdCompact, "icon-size", hazardCompactIconSize);
      }

      // Full layer (>= 15 desktop, >= 16 mobile): badge icon + "Road blocked" label underneath
      if (!map.getLayer(layerIdFull)) {
        map.addLayer({
          id: layerIdFull,
          type: "symbol",
          source: sourceId,
          minzoom: hazardFullMinZoom,
          layout: {
            "icon-image": ["get", "icon_name_full"],
            "icon-anchor": "center",
            "icon-size": 1.0,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "icon-padding": 0,
          },
        });
      } else {
        map.setLayerZoomRange(layerIdFull, hazardFullMinZoom, 24);
      }

      // Always hoist the hazard symbols above all road lines and route layers
      try {
        if (map.getLayer(layerIdCompact)) map.moveLayer(layerIdCompact);
        if (map.getLayer(layerIdFull)) map.moveLayer(layerIdFull);
      } catch { }
    } catch (err) {
      console.warn("Error updating hazard reports layer:", err);
    }

    function handleHazardSymbolClick(e) {
      if (pickingLocationRef.current) return;
      const feature = e.features?.[0];
      if (!feature) return;
      const reportId = feature.properties?.id;
      const targetReport = hazardReports.find((r) => String(r.id) === String(reportId));
      if (!targetReport) return;

      const coordinates = getValidCoordinates([
        targetReport.longitude ?? targetReport.lng,
        targetReport.latitude ?? targetReport.lat,
      ]);
      if (!coordinates) return;

      // Close previous popup if open
      if (hazardPopupRef.current) {
        try {
          hazardPopupRef.current.remove();
        } catch { }
        hazardPopupRef.current = null;
        setIsHazardPopupOpen(false);
      }

      const closedRoadNames = Array.isArray(targetReport.closed_roads)
        ? targetReport.closed_roads
        : [];

      const fullReport = {
        ...targetReport,
        closed_roads: closedRoadNames.length > 0 ? closedRoadNames : targetReport.closed_roads,
      };

      // Open blockage details popup directly on the map (no white circle, no pulsing ring)
      const popup = new mapboxgl.Popup({
        offset: [0, -28],
        className: "ew-popup",
        maxWidth: "440px",
        closeButton: false,
        closeOnClick: true,
      });
      popup.on("close", () => {
        setIsHazardPopupOpen(false);
        if (hazardPopupRef.current === popup) {
          hazardPopupRef.current = null;
        }
      });
      popup.on("open", () => {
        setIsHazardPopupOpen(true);
      });
      popup
        .setLngLat(coordinates)
        .setDOMContent(
          createReportPopup(fullReport, {
            onClose: () => {
              popup.remove();
              setIsHazardPopupOpen(false);
            },
            popup,
          })
        )
        .addTo(map);

      hazardPopupRef.current = popup;
      setIsHazardPopupOpen(true);
    }

    function handleHazardSymbolMouseEnter() {
      if (!pickingLocationRef.current) {
        map.getCanvas().style.cursor = "pointer";
      }
    }

    function handleHazardSymbolMouseLeave() {
      if (!pickingLocationRef.current) {
        map.getCanvas().style.cursor = "";
      }
    }

    try {
      [layerIdCompact, layerIdFull].forEach((lId) => {
        if (map.getLayer(lId)) {
          map.on("click", lId, handleHazardSymbolClick);
          map.on("mouseenter", lId, handleHazardSymbolMouseEnter);
          map.on("mouseleave", lId, handleHazardSymbolMouseLeave);
        }
      });
    } catch (e) { }

    return () => {
      cancelAnimationFrame(flowFrameRef.current);
      flowFrameRef.current = null;
      if (hazardPopupRef.current) {
        try {
          hazardPopupRef.current.remove();
        } catch { }
        hazardPopupRef.current = null;
        setIsHazardPopupOpen(false);
      }
      if (savedReportHighlightRef.current) {
        savedReportHighlightRef.current.remove();
        savedReportHighlightRef.current = null;
      }
      try {
        [layerIdCompact, layerIdFull].forEach((lId) => {
          if (map.getLayer(lId)) {
            map.off("click", lId, handleHazardSymbolClick);
            map.off("mouseenter", lId, handleHazardSymbolMouseEnter);
            map.off("mouseleave", lId, handleHazardSymbolMouseLeave);
          }
        });
      } catch (e) { }
    };
  }, [hazardReports, roads, mapLoaded, mapStyle, styleVersion, isMobileMap]);

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
  // Remove lookup data saved by the earlier name-only flow.
  useEffect(() => {
    clearSavedResident();
  }, []);

  // Load the signed-in resident's own assigned center and room.
  useEffect(() => {
    if (!isLoggedInResident) {
      setMyCenter(null);
      return undefined;
    }
    let active = true;
    api.getMyEvacuationCenter()
      .then((result) => {
        if (!active) return;
        if (!result.center_name) {
          setMyCenter(null);
          return;
        }
        setMyCenter({
          evacuation_center: { name: result.center_name },
          room: result.room || null,
          resident_id: user?.resident_id,
          is_checked_in: result.is_checked_in,
        });
      })
      .catch(() => {
        if (active) setMyCenter(null);
      });
    return () => { active = false; };
  }, [user, isLoggedInResident]);

  useEffect(() => {
    const centerName = myCenter?.evacuation_center?.name;
    if (!centerName || myCenter.evacuation_center.id != null) return;
    const feature = evacCenters?.features?.find((center) => {
      const properties = center.properties || center;
      return String(properties.name || "").trim().toLowerCase() ===
        String(centerName).trim().toLowerCase();
    });
    const id = feature?.properties?.id ?? feature?.id;
    if (id == null) return;
    setMyCenter((previous) => previous ? {
      ...previous,
      evacuation_center: { ...previous.evacuation_center, id },
    } : previous);
  }, [myCenter, evacCenters]);

  // Automatic GPS arrival & check-in detection
  // --------------------------------------------------
  const autoCheckInAttemptedRef = useRef(false);

  useEffect(() => {
    if (!isLoggedInResident || !myLocation || !myCenter || myCenter.is_checked_in) return;
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
  }, [myLocation, myCenter, evacCenters, isLoggedInResident]);

  // --------------------------------------------------
  // Initialize the online Mapbox map or the cached offline OpenFreeMap map.
  // --------------------------------------------------

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return;
    }

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,

      style: getBasemapStyleUrl(mapStyle, isOnline, MAPBOX_ACCESS_TOKEN),
      transformRequest: transformOpenFreeMapRequest,

      center: [SOGOD_CENTER[1], SOGOD_CENTER[0]],

      zoom: 14.5,

      pitch: 0,
      bearing: 0,

      minZoom: 11,
      maxZoom: 18,

      attributionControl: true,

      projection: "mercator",
    });

    mapRef.current = map;
    window.__evacwayMap = map;

    map.on("style.load", () => simplifyPublicBaseMap(map));

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
    map.on("click", async (e) => {
      if (!pickingLocationRef.current) {
        return;
      }

      if (!isInsideSogodBoundary([e.lngLat.lng, e.lngLat.lat], sogodBoundaryRef.current)) {
        setRouteError(sogodBoundaryRef.current
          ? "Choose a pin location inside the Sogod boundary."
          : "Sogod boundary is still loading. Please try again.");
        return;
      }
      setRouteError("");

      const loc = {
        lat: e.lngLat.lat,
        lng: e.lngLat.lng,
      };

      if (pickingPurposeRef.current === "route") {
        const manualLoc = {
          ...loc,
          accuracy: 0,
          is_manual_pin: true,
          location_source: "manual",
        };
        setMyLocation(manualLoc);
        setLocationPermission("manual");
        setShowRoutePinOption(false);
        setPickingLocation(false);
        setRouteError("Starting point set. Choose Go to nearest safe place to calculate the route.");
        return;
      }

      if (pickingPurposeRef.current === "rescue") {
        const manualLoc = {
          ...loc,
          is_manual_pin: true,
          location_source: "manual",
        };
        setRescueCoordinates(manualLoc);
        setRescueAlertOpen(true);
        setPickingLocation(false);
        setOrUpdateSelectedLocationMarker(
          map,
          selectedLocationMarkerRef,
          loc,
          undefined,
          { draggable: false }
        );
      } else {
        // Hazard reporting: click is ONLY valid directly on a road
        const bbox = [
          [e.point.x - 8, e.point.y - 8],
          [e.point.x + 8, e.point.y + 8],
        ];
        let hitRoadLayer = false;
        let roadFeatures = [];
        try {
          if (map.getLayer("roads-layer")) {
            const features = map.queryRenderedFeatures(bbox, { layers: ["roads-layer"] });
            if (features && features.length > 0) {
              hitRoadLayer = true;
              roadFeatures = features;
            }
          }
        } catch (err) {
          console.warn("Could not query roads layer:", err);
        }

        // If not directly clicking on a road, outside area is UNCLICKABLE - do nothing!
        if (!hitRoadLayer || roadFeatures.length === 0) {
          return;
        }

        let bestTarget = null;
        let minProjDist = Infinity;
        for (const rf of roadFeatures) {
          const projectCoordinate = (coordinate) => map.project(coordinate);
          const proj = projectPointToLineStringGeometry(
            [loc.lng, loc.lat],
            rf.geometry,
            projectCoordinate
          );
          const projected = projectCoordinate(proj);
          const d = Math.hypot(projected.x - e.point.x, projected.y - e.point.y);
          if (d < minProjDist) {
            minProjDist = d;
            const rProps = rf.properties || {};
            bestTarget = {
              lng: Number(proj[0].toFixed(6)),
              lat: Number(proj[1].toFixed(6)),
              road_name: rProps.road_name || rProps.name || "Road",
            };
          }
        }

        const targetLoc = bestTarget || {
          lat: Number(loc.lat.toFixed(6)),
          lng: Number(loc.lng.toFixed(6)),
          road_name: "Road",
        };

        setPendingSuggestedRoad(null);
        setPendingReportLocation(targetLoc);
        setPickingLocation(false);
        setOrUpdateSelectedLocationMarker(map, selectedLocationMarkerRef, targetLoc, async (updatedLoc) => {
          let reSnapped = updatedLoc;
          try {
            const snapRes = await api.snapCoordinate(updatedLoc.lat, updatedLoc.lng, { snapToIntersection: false });
            if (snapRes && Number.isFinite(snapRes.snapped_lat) && Number.isFinite(snapRes.snapped_lng)) {
              reSnapped = {
                lat: snapRes.snapped_lat,
                lng: snapRes.snapped_lng,
                road_name: snapRes.nearest_road || targetLoc.road_name,
              };
              if (selectedLocationMarkerRef.current) {
                selectedLocationMarkerRef.current.setLngLat([reSnapped.lng, reSnapped.lat]);
              }
            }
          } catch (err) {
            console.warn("Could not re-snap dragged hazard marker:", err);
          }
          setPendingReportLocation(reSnapped);
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

  useEffect(() => {
    const updateBasemapForNetwork = () => {
      const online = navigator.onLine;
      setIsOnline(online);
      const map = mapRef.current;
      if (!map) return;

      setMapLoaded(false);
      const styleUrl = getBasemapStyleUrl(mapStyle, online, MAPBOX_ACCESS_TOKEN);
      if (online) {
        map.setStyle(styleUrl);
        return;
      }

      let styleApplied = false;
      const applyOfflineStyle = () => {
        if (styleApplied) return;
        styleApplied = true;
        map.setStyle(styleUrl);
      };
      try {
        mapboxgl.clearStorage(applyOfflineStyle);
      } catch {
        applyOfflineStyle();
      }
    };

    window.addEventListener("online", updateBasemapForNetwork);
    window.addEventListener("offline", updateBasemapForNetwork);
    return () => {
      window.removeEventListener("online", updateBasemapForNetwork);
      window.removeEventListener("offline", updateBasemapForNetwork);
    };
  }, [mapStyle]);

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

    const newStyle = getBasemapStyleUrl(style, navigator.onLine, MAPBOX_ACCESS_TOKEN);

    map.setStyle(newStyle);

    map.once("style.load", () => {
      setMapLoaded(true);
      setStyleVersion((v) => v + 1);
    });
  }

  async function prefetchOpenFreeMapStyleAssets() {
    const assetUrls = new Set();
    for (const styleUrl of [OPENFREEMAP_STYLE_URL, OPENFREEMAP_ALTERNATE_STYLE_URL]) {
      const styleResponse = await fetch(styleUrl, { credentials: "omit", cache: "no-store" });
      if (!styleResponse.ok) throw new Error("Offline map style assets are temporarily unavailable.");
      const style = await styleResponse.json();
      Object.values(style.sources || {}).forEach((source) => {
        if (source.url) assetUrls.add(source.url);
      });
      if (style.sprite) {
        [".json", "@2x.json", ".png", "@2x.png"].forEach((suffix) => assetUrls.add(`${style.sprite}${suffix}`));
      }
      const fontStacks = new Set((style.layers || []).flatMap((layer) => (
        Array.isArray(layer.layout?.["text-font"]) ? layer.layout["text-font"] : []
      )));
      if (style.glyphs) {
        fontStacks.forEach((fontStack) => {
          ["0-255", "8192-8447"].forEach((range) => {
            assetUrls.add(style.glyphs
              .replace("{fontstack}", encodeURIComponent(fontStack))
              .replace("{range}", range));
          });
        });
      }
    }

    const urls = [...assetUrls].filter((value) => {
      try {
        return new URL(value).hostname === "tiles.openfreemap.org";
      } catch {
        return false;
      }
    });
    let nextAsset = 0;
    let assetError = null;
    const cacheAssetWorker = async () => {
      while (nextAsset < urls.length && !assetError) {
        const url = urls[nextAsset];
        nextAsset += 1;
        try {
          const response = await fetch(url, { credentials: "omit", cache: "no-store" });
          if (!response.ok) throw new Error("Offline map style assets are temporarily unavailable.");
        } catch (error) {
          assetError = error;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, urls.length) }, cacheAssetWorker));
    if (assetError) throw assetError;
  }

  async function handleSaveSogodOfflineMap() {
    const tiles = getSogodOfflineTileCoordinates();
    let completed = 0;
    setOfflineMapDownload({ status: "downloading", completed, total: tiles.length, error: "" });
    try {
      await prefetchOpenFreeMapStyleAssets();
      const tileCache = await caches.open("evacway-public-map-tiles-v1");
      let downloadedBytes = 0;
      let nextTile = 0;
      let downloadError = null;
      const downloadWorker = async () => {
        while (nextTile < tiles.length && !downloadError) {
          const tile = tiles[nextTile];
          nextTile += 1;
          const url = buildOfflineTileUrl(tile);
          try {
            if (await tileCache.match(url)) {
              completed += 1;
              setOfflineMapDownload({ status: "downloading", completed, total: tiles.length, error: "" });
              continue;
            }

            let response;
            for (let attempt = 0; attempt < 3; attempt += 1) {
              try {
                response = await fetch(url, { credentials: "omit", cache: "no-store" });
                if (response.ok || response.status < 500) break;
              } catch (error) {
                if (attempt === 2) throw error;
              }
              if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)));
            }
            if (!response?.ok) throw new Error("Map tiles are temporarily unavailable.");
            const buffer = await response.clone().arrayBuffer();
            downloadedBytes += buffer.byteLength;
            if (downloadedBytes > OFFLINE_MAP_MAX_BYTES) {
              throw new Error("The map download reached the 50 MB offline limit.");
            }

            if (!navigator.serviceWorker.controller) {
              const headers = new Headers(response.headers);
              headers.set("X-EvacWay-Tile-Bytes", buffer.byteLength);
              headers.set("X-EvacWay-Saved-At", new Date().toISOString());
              await tileCache.put(url, new Response(buffer, { status: 200, headers }));
            }
            completed += 1;
            setOfflineMapDownload({ status: "downloading", completed, total: tiles.length, error: "" });
          } catch (error) {
            downloadError = error;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(2, tiles.length) }, downloadWorker));
      if (downloadError) throw downloadError;
      const savedAt = new Date().toISOString();
      localStorage.setItem("evacway_sogod_offline_map_saved_at", savedAt);
      setOfflineMapDownload({ status: "saved", completed: tiles.length, total: tiles.length, error: "" });
    } catch (error) {
      setOfflineMapDownload({
        status: "error",
        completed,
        total: tiles.length,
        error: error.message || "Could not save the Sogod map. Try again when connected.",
      });
    }
  }

  // --------------------------------------------------
  // Update click behavior & cursor
  // --------------------------------------------------

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded) {
      return;
    }

    map.__pickingLocation = pickingLocation;
    const isPickingHazard = pickingLocation && pickingPurposeRef.current === "hazard";

    if (!isPickingHazard) {
      try {
        const resetCursor = pickingLocation ? "crosshair" : "";
        map.getCanvas().style.cursor = resetCursor;
        if (map.getCanvasContainer()) {
          map.getCanvasContainer().style.cursor = resetCursor;
        }
      } catch (e) { }
      return;
    }

    // Default cursor is not-allowed (block) when off-road
    try {
      map.getCanvas().style.cursor = "not-allowed";
      if (map.getCanvasContainer()) {
        map.getCanvasContainer().style.cursor = "not-allowed";
      }
    } catch (e) { }

    const handleMouseMove = (e) => {
      if (!pickingLocationRef.current || pickingPurposeRef.current !== "hazard") return;

      const bbox = [
        [e.point.x - 7, e.point.y - 7],
        [e.point.x + 7, e.point.y + 7],
      ];
      let isOnRoad = false;
      try {
        if (map.getLayer("roads-layer")) {
          const features = map.queryRenderedFeatures(bbox, { layers: ["roads-layer"] });
          if (features && features.length > 0) {
            isOnRoad = true;
          }
        }
      } catch (err) { }

      const nextCursor = isOnRoad ? "crosshair" : "not-allowed";
      try {
        map.getCanvas().style.cursor = nextCursor;
        if (map.getCanvasContainer()) {
          map.getCanvasContainer().style.cursor = nextCursor;
        }
      } catch (e) { }
    };

    map.on("mousemove", handleMouseMove);

    return () => {
      try {
        map.off("mousemove", handleMouseMove);
        map.getCanvas().style.cursor = "";
        if (map.getCanvasContainer()) {
          map.getCanvasContainer().style.cursor = "";
        }
      } catch (e) { }
    };
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
    const closureDisplayData = {
      type: "FeatureCollection",
      features: (data.features || []).flatMap((feature) => {
        if (!feature.properties?.is_closed) return [];

        const trimLine = (coordinates) => {
          if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
          const points = coordinates.map((point) => [...point]);
          const segmentLengthMeters = (a, b) => {
            const latitude = ((a[1] + b[1]) / 2) * Math.PI / 180;
            const dx = (b[0] - a[0]) * 111320 * Math.cos(latitude);
            const dy = (b[1] - a[1]) * 111320;
            return Math.hypot(dx, dy);
          };
          const trimEnd = (fromStart) => {
            let remaining = 3;
            while (points.length > 1 && remaining > 0) {
              const firstIndex = fromStart ? 0 : points.length - 1;
              const secondIndex = fromStart ? 1 : points.length - 2;
              const first = points[firstIndex];
              const second = points[secondIndex];
              const length = segmentLengthMeters(first, second);
              if (length <= remaining) {
                remaining -= length;
                points.splice(firstIndex, 1);
              } else {
                const fraction = remaining / length;
                const trimmed = [
                  first[0] + (second[0] - first[0]) * fraction,
                  first[1] + (second[1] - first[1]) * fraction,
                  ...first.slice(2),
                ];
                points[firstIndex] = trimmed;
                remaining = 0;
              }
            }
          };

          trimEnd(true);
          trimEnd(false);
          return points.length > 1 ? points : null;
        };

        const geometry = feature.geometry;
        if (geometry?.type === "LineString") {
          const coordinates = trimLine(geometry.coordinates);
          return coordinates ? [{ ...feature, geometry: { ...geometry, coordinates } }] : [];
        }
        if (geometry?.type === "MultiLineString") {
          const coordinates = geometry.coordinates.map(trimLine).filter(Boolean);
          return coordinates.length
            ? [{ ...feature, geometry: { ...geometry, coordinates } }]
            : [];
        }
        return [];
      }),
    };
    const beforeId = map.getLayer("resident-hazard-reports-layer-compact")
      ? "resident-hazard-reports-layer-compact"
      : map.getLayer("resident-hazard-reports-layer")
        ? "resident-hazard-reports-layer"
        : undefined;

    try {
      if (map.getLayer("roads-closed-stripes")) {
        map.removeLayer("roads-closed-stripes");
      }
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
          layout: {
            "line-cap": "round",
            "line-join": "round",
          },
          paint: {
            "line-color": "#94a3b8",

            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              10, 1,
              14, 2,
              18, 3,
            ],

            "line-opacity": 0.5,
          },
        }, beforeId);
      }

      const closedRoadsSourceId = "roads-closed-display";
      const closedRoadsSource = map.getSource(closedRoadsSourceId);
      if (closedRoadsSource) {
        closedRoadsSource.setData(closureDisplayData);
      } else {
        map.addSource(closedRoadsSourceId, {
          type: "geojson",
          data: closureDisplayData,
        });
      }

      const closedRoadsLayerId = "roads-closed-display-layer";
      if (!map.getLayer(closedRoadsLayerId)) {
        map.addLayer({
          id: closedRoadsLayerId,
          type: "line",
          source: closedRoadsSourceId,
          layout: {
            "line-cap": "round",
            "line-join": "round",
          },
          paint: {
            "line-color": "#dc2626",
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              10, 3.5,
              14, 4.5,
              18, 6,
            ],
            "line-opacity": 1,
          },
        }, beforeId);
      }

      // Ensure the hazard icon layers always remain on top of the road lines
      if (map.getLayer("resident-hazard-reports-layer-compact")) {
        try {
          map.moveLayer("resident-hazard-reports-layer-compact");
        } catch { }
      }
      if (map.getLayer("resident-hazard-reports-layer-compact")) {
        try {
          map.moveLayer("resident-hazard-reports-layer-compact");
        } catch { }
      }
      if (map.getLayer("resident-hazard-reports-layer")) {
        try {
          map.moveLayer("resident-hazard-reports-layer");
        } catch { }
      }
    } catch (err) {
      console.warn("Error updating roads layer:", err);
      return;
    }

    function handleRoadClick(e) {
      if (pickingLocationRef.current) {
        return;
      }

      const hazardLayerIds = ["resident-hazard-reports-layer", "resident-hazard-reports-layer-compact"].filter((id) => map.getLayer(id));
      if (hazardLayerIds.length > 0) {
        const hazardFeatures = map.queryRenderedFeatures(e.point, { layers: hazardLayerIds });
        if (hazardFeatures && hazardFeatures.length > 0) {
          return;
        }
      }

      const feature = e.features?.[0];

      if (!feature) {
        return;
      }

      const properties = feature.properties || {};
      if (properties.is_closed) {
        const report = findReportForRoad(properties, hazardReports);
        if (report) {
          const coordinates = getValidCoordinates([
            report.longitude ?? report.lng,
            report.latitude ?? report.lat,
          ]) || [e.lngLat.lng, e.lngLat.lat];

          if (hazardPopupRef.current) {
            try {
              hazardPopupRef.current.remove();
            } catch { }
            hazardPopupRef.current = null;
            setIsHazardPopupOpen(false);
          }

          const closedRoadNames = Array.isArray(report.closed_roads)
            ? report.closed_roads
            : [];

          const fullReport = {
            ...report,
            closed_roads: closedRoadNames.length > 0 ? closedRoadNames : report.closed_roads,
          };

          const popup = new mapboxgl.Popup({
            offset: [0, -28],
            className: "ew-popup",
            maxWidth: "440px",
            closeButton: false,
            closeOnClick: true,
          });
          popup.on("close", () => {
            setIsHazardPopupOpen(false);
            if (hazardPopupRef.current === popup) {
              hazardPopupRef.current = null;
            }
          });
          popup.on("open", () => {
            setIsHazardPopupOpen(true);
          });
          popup
            .setLngLat(coordinates)
            .setDOMContent(
              createReportPopup(fullReport, {
                onClose: () => {
                  popup.remove();
                  setIsHazardPopupOpen(false);
                },
                popup,
              })
            )
            .addTo(map);

          hazardPopupRef.current = popup;
          setIsHazardPopupOpen(true);
        }
        return;
      }

      const content = createRoadPopup(properties);

      new mapboxgl.Popup({
        offset: 10,
      })
        .setLngLat(e.lngLat)
        .setDOMContent(content)
        .addTo(map);
    }

    function handleRoadMouseEnter() {
      if (!pickingLocationRef.current) {
        map.getCanvas().style.cursor = "pointer";
      }
    }

    function handleRoadMouseLeave() {
      if (!pickingLocationRef.current) {
        map.getCanvas().style.cursor = "";
      }
    }

    try {
      map.on("click", layerId, handleRoadClick);
      map.on("mouseenter", layerId, handleRoadMouseEnter);
      map.on("mouseleave", layerId, handleRoadMouseLeave);
    } catch (e) { }

    return () => {
      try {
        map.off("click", layerId, handleRoadClick);
        map.off("mouseenter", layerId, handleRoadMouseEnter);
        map.off("mouseleave", layerId, handleRoadMouseLeave);
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
            mapStyle === "bright" ? "rgba(0, 0, 0, 0.65)" : "rgba(255, 255, 255, 0.85)"
          );
        }
        if (map.getLayer(layerId)) {
          map.setPaintProperty(
            layerId,
            "line-color",
            mapStyle === "bright" ? "#38bdf8" : "#1e3a8a"
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
            "line-color": mapStyle === "bright" ? "rgba(0, 0, 0, 0.65)" : "rgba(255, 255, 255, 0.85)",
            "line-width": 4.5,
          },
        });
      }

      if (!map.getLayer(layerId)) {
        map.addLayer({
          id: layerId,
          type: "line",
          source: sourceId,
          layout: {
            "line-cap": "round",
            "line-join": "round",
          },
          paint: {
            "line-color": mapStyle === "bright" ? "#38bdf8" : "#1e3a8a",
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
          minzoom: CENTER_MARKER_MAX_ZOOM,
          layout: {
            "text-field": ["get", "name"],
            "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
            "text-size": 14,
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

      if (map.getLayer("evacuation-centers-label")) {
        map.setLayerZoomRange("evacuation-centers-label", CENTER_MARKER_MAX_ZOOM, 24);
      }
    } catch (err) {
      console.warn("Error updating evacuation centers layer:", err);
      return;
    }

    const handleMouseEnter = () => {
      try {
        if (pickingLocationRef.current) return;
        map.getCanvas().style.cursor = "pointer";
      } catch (e) { }
    };

    const handleMouseLeave = () => {
      try {
        if (pickingLocationRef.current) return;
        map.getCanvas().style.cursor = "";
      } catch (e) { }
    };

    const handleEvacCenterClick = (e) => {
      if (pickingLocationRef.current) return;
      // If a building was clicked at this point, building details handles it
      try {
        const buildingHits = map.queryRenderedFeatures(e.point, {
          layers: ["evacway-buildings-fill", "evacway-buildings-outline"],
        });
        if (buildingHits && buildingHits.length > 0) {
          return;
        }
      } catch (err) { }

      const feature = e.features?.[0];

      if (!feature) {
        return;
      }

      clearFoundPersonLocation();
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
  }, [evacCenters, mapLoaded, mapStyle, styleVersion, clearFoundPersonLocation]);

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
    const selectedCenterId = selectedCenter?.properties?.id ?? selectedCenter?.id ?? null;
    const markerEntries = [];

    function removeCenterMarkers() {
      evacuationMarkersRef.current.forEach((marker) => marker.remove());

      evacuationMarkersRef.current = [];
      markerEntries.length = 0;
    }

    function updateCenterMarkerVisibility() {
      const zoom = map.getZoom();
      if (zoom >= CENTER_MARKER_MAX_ZOOM) {
        markerEntries.forEach((entry) => {
          entry.element.style.display = "none";
          entry.element.classList.remove("show-label");
        });
        return;
      }

      const labelMinZoom = isMobileMap ? 15.5 : 14;
      const allowZoomLabels = zoom >= labelMinZoom;
      const mapCenterPt = map.project(map.getCenter());

      // Prioritized label at any zoom: selected center first, otherwise assigned center (one at a time)
      const priorityEntry =
        markerEntries.find((entry) => entry.isSelected) ||
        markerEntries.find((entry) => entry.isMine) ||
        null;

      const visibleLabelIds = new Set();
      const keptRects = [];

      const makeLabelRect = (entry) => {
        const pt = map.project(entry.coordinates);
        const maxW = isMobileMap ? 120 : 220;
        const w = Math.min(maxW, Math.max(76, entry.name.length * 6.2 + 22));
        const h = isMobileMap ? 22 : 24;
        const halfW = w / 2;
        const top = pt.y + 6;
        return {
          left: pt.x - halfW,
          right: pt.x + halfW,
          top,
          bottom: top + h,
          dist: Math.hypot(pt.x - mapCenterPt.x, pt.y - mapCenterPt.y),
        };
      };

      const rectsIntersect = (a, b) =>
        !(a.right + 6 < b.left || a.left - 6 > b.right || a.bottom + 4 < b.top || a.top - 4 > b.bottom);

      if (priorityEntry) {
        visibleLabelIds.add(priorityEntry.key);
        keptRects.push(makeLabelRect(priorityEntry));
      }

      if (allowZoomLabels) {
        const candidates = markerEntries
          .filter((entry) => !visibleLabelIds.has(entry.key))
          .map((entry) => ({ entry, rect: makeLabelRect(entry) }))
          .sort((a, b) => a.rect.dist - b.rect.dist);

        candidates.forEach(({ entry, rect }) => {
          if (!keptRects.some((kept) => rectsIntersect(rect, kept))) {
            visibleLabelIds.add(entry.key);
            keptRects.push(rect);
          }
        });
      }

      markerEntries.forEach((entry) => {
        entry.element.style.display = "";
        entry.element.classList.toggle("is-selected", entry.isSelected);
        entry.element.classList.toggle("show-label", visibleLabelIds.has(entry.key));
      });
    }

    function showCenterMarkers() {
      removeCenterMarkers();

      (evacCenters.features || []).forEach((center, idx) => {
        const properties = center.properties || center || {};

        const centerCoords = getCenterCoordinates(center, buildingsGeoJSON);
        if (!centerCoords) {
          return;
        }
        const coordinates = [centerCoords.longitude, centerCoords.latitude];

        const centerId = properties.id ?? center.id;
        const centerKey = centerId != null ? String(centerId) : `idx-${idx}`;
        const isMine =
          myCenterId != null && String(centerId) === String(myCenterId);
        const isSelected =
          selectedCenterId != null && String(centerId) === String(selectedCenterId);

        const centerName = displayEntityName(
          properties.name ?? center.name ?? properties.center_name,
          "Evacuation Center"
        );

        const cap = properties.capacity || 0;
        const occ = properties.occupied ?? properties.current_occupancy ?? 0;
        const pct = cap > 0 ? Math.min(100, Math.round((occ / cap) * 100)) : 0;

        let statusColor = "#16a34a"; // Green: Normal
        if (cap > 0 && occ >= cap) {
          statusColor = "#dc2626"; // Red: Full
        } else if (cap > 0 && occ / cap >= .9) {
          statusColor = "#d97706"; // Amber: High
        }
        if (isMine) {
          statusColor = "#2563eb"; // Blue: User Center
        }

        const pinColor = isMine ? "#1d4ed8" : "#2563eb";

        const element = document.createElement("button");
        element.type = "button";
        element.title = centerName;
        element.className = `evacway-center-marker${isMine ? " evacway-center-marker-mine" : ""}${isSelected ? " is-selected" : ""}`;
        element.setAttribute(
          "aria-label",
          `Evacuation Center: ${centerName}, ${pct}% occupied`
        );

        const iconElement = document.createElement("span");
        iconElement.className = "evacway-center-icon";
        iconElement.style.setProperty("--pin-bg", pinColor);
        iconElement.style.backgroundColor = pinColor;
        iconElement.innerHTML = EVAC_SHELTER_ICON_HTML;

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
          if (pickingLocationRef.current) return;
          event.stopPropagation();
          clearFoundPersonLocation();
          setSelectedCenter(center);
        });

        const marker = new mapboxgl.Marker({
          element,
          anchor: "bottom",
        })
          .setLngLat(coordinates)
          .addTo(map);

        evacuationMarkersRef.current.push(marker);
        markerEntries.push({
          key: centerKey,
          name: centerName,
          coordinates,
          isMine,
          isSelected,
          element,
        });
      });

      updateCenterMarkerVisibility();
    }

    function handleMapBackgroundClick(e) {
      if (pickingLocationRef.current) return;

      const clickableLayers = [
        "evacuation-centers-fill",
        "evacuation-centers-line",
        "evacway-buildings-fill",
        "evacway-buildings-outline",
      ].filter((layerId) => map.getLayer(layerId));

      try {
        if (
          clickableLayers.length > 0 &&
          map.queryRenderedFeatures(e.point, { layers: clickableLayers }).length > 0
        ) {
          return;
        }
      } catch (error) {
        // Keep the background clear behavior if the style is reloading.
      }

      setSelectedCenter(null);
    }

    showCenterMarkers();

    map.on("zoom", updateCenterMarkerVisibility);
    map.on("zoomend", updateCenterMarkerVisibility);
    map.on("moveend", updateCenterMarkerVisibility);
    map.on("click", handleMapBackgroundClick);

    return () => {
      map.off("zoom", updateCenterMarkerVisibility);
      map.off("zoomend", updateCenterMarkerVisibility);
      map.off("moveend", updateCenterMarkerVisibility);
      map.off("click", handleMapBackgroundClick);

      removeCenterMarkers();
    };
  }, [evacCenters, mapLoaded, myCenter, buildingsGeoJSON, selectedCenter, isMobileMap, clearFoundPersonLocation]);

  // --------------------------------------------------
  // Native Mapbox Building Layers (clickable buildings instead of room pills)
  // --------------------------------------------------

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    window.__mapboxMap = map;
    window.__evacwaySelectBuilding = (bId) => {
      if (pickingLocationRef.current) return;
      const bFeature = buildingsGeoJSON?.features?.find(
        (f) => String(f.id) === String(bId) || String(f.properties?.id) === String(bId)
      );
      if (String(bId) !== String(map.__foundPersonBuildingId)) {
        clearFoundPersonLocation();
        setPrivateBuildingView(false);
      }
      setSelectedBuildingId(bId);
      setSelectedBuildingData(bFeature?.properties || { id: bId });
      setBuildingModalOpen(true);
    };

    initBuildingLayers(
      map,
      (buildingFeature) => {
        if (pickingLocationRef.current) return;
        const bProps = buildingFeature.properties || {};
        const bId = bProps.id ?? buildingFeature.id;
        if (String(bId) !== String(map.__foundPersonBuildingId)) {
          clearFoundPersonLocation();
          setPrivateBuildingView(false);
        }
        setSelectedBuildingId(bId);
        setSelectedBuildingData(bProps);
        setBuildingModalOpen(true);
      },
      { enableTooltip: true }
    );

    setBuildingsGeoJSON(map, buildingsGeoJSON);
    setSelectedBuilding(map, selectedBuildingId);

    const ownBuilding = resolveRoomBuilding(myCenter?.room, buildingsGeoJSON, myCenter?.evacuation_center?.id);
    setUserBuilding(map, ownBuilding?.id ?? null);
    setUserBuilding(map, foundPersonLocation?.buildingId ?? null, "found");

    // Completely remove the "Your room" pin marker from the map (only highlight the building)
    if (userRoomMarkerRef.current) {
      userRoomMarkerRef.current.remove();
      userRoomMarkerRef.current = null;
    }

    return () => {
      removeBuildingTooltip(map);
    };
  }, [mapLoaded, buildingsGeoJSON, mapStyle, styleVersion, selectedBuildingId, myCenter, foundPersonLocation, clearFoundPersonLocation]);

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
      if (navigationActive) {
        const curLngLat = oldMarker.getLngLat();
        if (markerAnimationCleanupRef.current) {
          markerAnimationCleanupRef.current();
          markerAnimationCleanupRef.current = null;
        }
        markerAnimationCleanupRef.current = animateLocationTransition({
          map,
          marker: oldMarker,
          fromLng: curLngLat.lng,
          fromLat: curLngLat.lat,
          toLng: userCoordinates[0],
          toLat: userCoordinates[1],
          fromAccuracy: accuracyCircleStateRef.current?.accuracy || 30,
          toAccuracy: Math.min(myLocation.accuracy || 30, 80),
          duration: 300,
        });
        accuracyCircleStateRef.current = myLocation;
        const arrow = oldMarker.getElement()?.querySelector(".nav-arrow-svg");
        if (arrow) {
          const heading = myLocation.heading || lastHeadingRef.current || 0;
          arrow.style.transform = `rotate(${heading}deg)`;
        }
      } else {
        oldMarker.setLngLat(userCoordinates);
        if (myLocation.is_manual_pin) {
          removeAccuracyCircle(map);
        } else {
          setOrUpdateAccuracyCircle(
            map,
            userCoordinates[0],
            userCoordinates[1],
            myLocation.accuracy || 30
          );
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
      }).setText(
        navigationActive
          ? "Your live location"
          : myLocation.is_manual_pin
            ? "Chosen starting point"
            : "You are here"
      );

      const marker = new mapboxgl.Marker({
        element: markerElement,
        anchor: "center",
        draggable: false,
      })
        .setLngLat(userCoordinates)
        .setPopup(popup)
        .addTo(map);

      marker.__isUserMarker = true;
      marker.__navMode = navigationActive;

      routeMarkersRef.current.push(marker);

      if (!myLocation.is_manual_pin) {
        setOrUpdateAccuracyCircle(
          map,
          userCoordinates[0],
          userCoordinates[1],
          navigationActive ? Math.min(myLocation.accuracy || 30, 80) : (myLocation.accuracy || 30)
        );
      } else {
        removeAccuracyCircle(map);
      }
    }
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

    if (!route || route.no_roads_available || !Array.isArray(route.route) || route.route.length === 0) {
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

      if (map.getLayer("resident-hazard-reports-layer-compact")) {
        try {
          map.moveLayer("resident-hazard-reports-layer-compact");
        } catch { }
      }
      if (map.getLayer("resident-hazard-reports-layer")) {
        try {
          map.moveLayer("resident-hazard-reports-layer");
        } catch { }
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
    destinationInfo.textContent = `${route.distance_km ?? "?"} km away - about ${route.estimated_time_min ?? "?"
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

  useEffect(() => {
    const map = mapRef.current;
    if (!navigationActive || !map || !mapLoaded || !route) return undefined;

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return undefined;

    let lastUpdate = null;
    const animateArrows = (frameTime) => {
      if (!navigationActiveRef.current || !map.isStyleLoaded()) {
        arrowAnimRef.current = null;
        return;
      }

      if (!document.hidden && shouldUpdateRouteArrowAnimation(frameTime, lastUpdate)) {
        lastUpdate = frameTime;
        const progress = (Date.now() % 1500) / 1500;
        for (let k = 0; k < 4; k++) {
          const phase = (progress - k / 4 + 1) % 1;
          const opacity = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(phase * 2 * Math.PI));
          const layerName = `evacuation-route-arrows-${k}`;
          if (map.getLayer(layerName)) {
            map.setPaintProperty(layerName, "icon-opacity", opacity);
          }
        }
      }

      arrowAnimRef.current = requestAnimationFrame(animateArrows);
    };

    arrowAnimRef.current = requestAnimationFrame(animateArrows);
    return () => {
      if (arrowAnimRef.current) cancelAnimationFrame(arrowAnimRef.current);
      arrowAnimRef.current = null;
    };
  }, [navigationActive, mapLoaded, route, mapStyle, styleVersion]);

  // --------------------------------------------------
  // Enable browser location
  // --------------------------------------------------

  function handleEnableLocation() {
    setRouteError("");

    if (!navigator.geolocation) {
      setRouteError("Your browser doesn't support location access.");
      setShowRoutePinOption(true);

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
        setShowRoutePinOption(true);

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

  function handlePickRouteStart() {
    pickingPurposeRef.current = "route";
    setRouteError("");
    setPickingLocation(true);
  }

  // --------------------------------------------------
  // Find a route
  //
  // If the resident is verified, the route goes to
  // THEIR assigned evacuation center. Otherwise it goes
  // to the nearest one.
  // --------------------------------------------------

  function handleFindRoute(targetCenterId = null) {
    setNavigationLocationConfirmation(null);
    setAssistanceLocationConfirmation(null);
    setRouteError("");
    setShowRoutePinOption(false);
    setRoute(null);
    routeDataRef.current = null;
    stopWalkingNavigation("");

    if (!navigator.geolocation && !myLocation?.is_manual_pin) {
      setRouteError("Your browser doesn't support location access.");
      setShowRoutePinOption(true);

      return;
    }

    const assignedCenterId =
      targetCenterId != null
        ? targetCenterId
        : (myCenter?.evacuation_center?.id ?? null);

    setFindingRoute(true);

    const requestOrigin = myLocation?.is_manual_pin
      ? (onSuccess) => onSuccess({ coords: { latitude: myLocation.lat, longitude: myLocation.lng, accuracy: myLocation.accuracy ?? 0 } })
      : navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    requestOrigin(
      async (pos) => {
        const loc = {
          ...(myLocation?.is_manual_pin ? myLocation : {}),
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };

        setMyLocation(loc);
        setLocationPermission(loc.is_manual_pin ? "manual" : "granted");
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

          if (
            !result ||
            result.no_roads_available ||
            result.all_blocked ||
            !result.route ||
            result.route.length === 0
          ) {
            const blockedNotice = {
              no_roads_available: true,
              all_blocked: true,
              evacuation_center:
                result?.evacuation_center ||
                myCenter?.evacuation_center || { name: "Evacuation Center" },
              message:
                result?.message ||
                "No roads available. All routes to your evacuation center are blocked.",
              alternative_center: result?.alternative_center || null,
              selection_reason: result?.selection_reason || null,
              no_safe_center: Boolean(result?.no_safe_center),
              fallback_state: result?.fallback_state || "no_safe_center",
              assigned_center: result?.assigned_center || null,
              _requestedCenterId: assignedCenterId,
              _requestedOrigin: loc,
              route: [],
              distance_km: null,
              estimated_time_min: null,
            };
            setAssistanceSent(false);
            routeSafetySignatureRef.current = routeSafetySignature;
            routeDataRef.current = blockedNotice;
            setRoute(blockedNotice);
            setFindingRoute(false);
            return;
          }

          if (result.error) {
            const blockedNotice = {
              no_roads_available: true,
              all_blocked: true,
              evacuation_center:
                myCenter?.evacuation_center || { name: "Evacuation Center" },
              message:
                "No roads available. All routes to your evacuation center are blocked.",
              route: [],
              distance_km: null,
              estimated_time_min: null,
            };
            setAssistanceSent(false);
            routeDataRef.current = blockedNotice;
            setRoute(blockedNotice);
            setFindingRoute(false);
            return;
          }

          let walkingSteps = [];
          if (result.evacuation_center && result.route && result.route.length > 0) {
            try {
              const walkingTarget =
                result.chosen_entrance || result.evacuation_center;
              const walkingDirections = await getWalkingDirections(
                [pos.coords.latitude, pos.coords.longitude],
                walkingTarget
              );
              // Mapbox directions may be used ONLY for turn-by-turn steps,
              // and ONLY when its geometry stays within 15 m of the backend route.
              const staysWithin15m = mapboxRouteMatchesBackend(
                walkingDirections.route,
                result.route,
                15.0
              );
              if (staysWithin15m && Array.isArray(walkingDirections.walking_steps)) {
                walkingSteps = walkingDirections.walking_steps;
              }
            } catch {
              // Mapbox directions unavailable or deviated: route safely without Mapbox steps
            }
          }

          const routeToDisplay = {
            ...result,
            _requestedOrigin: loc,
            _requestedCenterId: assignedCenterId,
            route: result.route, // ALWAYS keep the backend route geometry
            walking_steps: walkingSteps,
            final_leg: result.final_leg,
            start_leg: result.start_leg,
            chosen_entrance: result.chosen_entrance,
          };

          activeEntranceRef.current = routeToDisplay.chosen_entrance || null;
          routeSafetySignatureRef.current = routeSafetySignature;
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
          const blockedNotice = {
            no_roads_available: true,
            all_blocked: true,
            evacuation_center:
              myCenter?.evacuation_center || { name: "Evacuation Center" },
            message:
              "No roads available. All routes to your evacuation center are blocked.",
            route: [],
            distance_km: null,
            estimated_time_min: null,
          };
          setAssistanceSent(false);
          routeDataRef.current = blockedNotice;
          setRoute(blockedNotice);
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
        setShowRoutePinOption(true);

        setFindingRoute(false);
      },

      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  }

  useEffect(() => {
    if (!route || !routeSafetySignature || !route._requestedOrigin) return;
    if (routeSafetySignatureRef.current == null) {
      routeSafetySignatureRef.current = routeSafetySignature;
      return;
    }
    if (
      routeSafetySignatureRef.current === routeSafetySignature
      || findingRoute
      || navigationActive
    ) return;

    routeSafetySignatureRef.current = routeSafetySignature;
    handleFindRoute(route._requestedCenterId ?? null);
  }, [route, routeSafetySignature, findingRoute, navigationActive, handleFindRoute]);

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
        bearing: lastHeadingRef.current || 0,
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
    setLostSignal(false);

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

    if (myLocation?.is_manual_pin && currentRoute._requestedOrigin &&
      (myLocation.lat !== currentRoute._requestedOrigin.lat || myLocation.lng !== currentRoute._requestedOrigin.lng)) {
      handleFindRoute(destination.id);
      return;
    }
    if (needsLocationConfirmation(myLocation) &&
      (navigationLocationConfirmation?.location !== myLocation || navigationLocationConfirmation?.route !== currentRoute)) {
      setNavigationLocationConfirmation({ location: myLocation, route: currentRoute });
      return;
    }
    setNavigationLocationConfirmation(null);

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

        const now = Date.now();

        // Ignore reading if accuracy > 100 m and better reading arrived within last 10s
        if (accuracy > 100 && now - lastGoodReadingTimeRef.current < 10000) {
          return;
        }
        if (accuracy <= 100) {
          lastGoodReadingTimeRef.current = now;
        }

        // Battery: lower update rate to once every 5s if user hasn't moved > 5 m
        if (lastBatteryThrottleRef.current) {
          const timeSince = now - lastBatteryThrottleRef.current.time;
          if (timeSince < 5000) {
            const movedDist = getDistanceMeters(
              [lastBatteryThrottleRef.current.lat, lastBatteryThrottleRef.current.lng],
              [rawLat, rawLng]
            );
            if (movedDist < 5) {
              return;
            }
          }
        }
        lastBatteryThrottleRef.current = { lat: rawLat, lng: rawLng, time: now };
        setLostSignal(false);

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

        // Check arrival (within 30m of chosen entrance)
        if (arrivalCoordinates) {
          const arrivalLatLng = [arrivalCoordinates[1], arrivalCoordinates[0]];
          const distToDest = getDistanceMeters(rawLocation, arrivalLatLng);
          if (distToDest <= 30) {
            setNavigationRemainingMeters(0);
            navigationRemainingMetersRef.current = 0;
            setNavigationRemainingSeconds(0);
            const arrivalMsg = "You have arrived";
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
              }).catch(() => { });
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

          // Camera follow: keep map centered, rotate toward heading when available
          if (autoFollowRef.current) {
            const reducedMotion =
              typeof window !== "undefined" &&
              window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
            currentMap.easeTo({
              center: [displayLng, displayLat],
              pitch: 0,
              bearing: heading != null && Number.isFinite(heading) ? heading : currentMap.getBearing(),
              duration: reducedMotion ? 0 : 400,
            });
          }
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

        // Off-route check: if > 50m for consecutive updates (throttled to at most once per 10s)
        if (snap.distanceToRoute > 50) {
          consecutiveOffRouteRef.current += 1;
          const nowReroute = Date.now();
          if (
            consecutiveOffRouteRef.current >= 2 &&
            !reroutingRef.current &&
            nowReroute - lastRerouteAtRef.current >= 10000
          ) {
            reroutingRef.current = true;
            lastRerouteAtRef.current = nowReroute;
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
        if (error.code === 2 || error.code === 3) {
          // Lost signal / temporary timeout: retain last known position, show gray note
          setLostSignal(true);
          setNavigationStatus("Searching for location...");
          return;
        }
        stopWalkingNavigation("GPS tracking stopped.");
        setRouteError("Location access was denied. Allow location access to navigate.");
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  }

  // --------------------------------------------------
  // Clear route
  // --------------------------------------------------

  function handleClearRoute() {
    setNavigationLocationConfirmation(null);
    setAssistanceLocationConfirmation(null);
    stopWalkingNavigation("");
    setRoute(null);
    routeDataRef.current = null;
    activeEntranceRef.current = null;
    navigationRemainingMetersRef.current = null;
    setRouteError("");
    setArrivalToast("");
    setNavPillExpanded(false);
    setAssistanceSent(false);
    setRequestingAssistance(false);

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

    const applyLocationFix = (pos) => {
      const acc = pos.coords.accuracy ?? null;
      const isApprox = acc != null && acc > 100;
      const loc = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: acc,
        is_manual_pin: false,
        location_source: isApprox ? "approximate" : "gps",
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

    };

    refineGeolocation({
      onFirstFix: (pos) => {
        applyLocationFix(pos);
      },
      onImprovement: (pos) => {
        applyLocationFix(pos);
      },
    })
      .then((bestPos) => {
        applyLocationFix(bestPos);
      })
      .catch((err) => {
        setRouteError(err.message || "Couldn't get your location. Pin on the map instead.");
      })
      .finally(() => {
        setLocating(false);
      });
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
    setPendingSuggestedRoad(null);
  }

  function handleQuickUseMyLocation() {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser.");
      return;
    }
    setQuickLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const rawLat = pos.coords.latitude;
        const rawLng = pos.coords.longitude;
        if (!isInsideSogodBoundary([rawLng, rawLat], sogodBoundaryRef.current)) {
          setQuickLocating(false);
          setRouteError(sogodBoundaryRef.current
            ? "Your current location is outside Sogod. Choose a location inside the boundary."
            : "Sogod boundary is still loading. Please try again.");
          return;
        }
        try {
          const snapData = await api.snapCoordinate(rawLat, rawLng);
          setQuickLocating(false);
          const targetLoc = {
            lat: snapData.snapped_lat,
            lng: snapData.snapped_lng,
            road_name: snapData.nearest_road,
            accuracy: pos.coords.accuracy,
          };
          if (!isInsideSogodBoundary([targetLoc.lng, targetLoc.lat], sogodBoundaryRef.current)) {
            setRouteError("Your nearest road is outside Sogod. Choose a location inside the boundary.");
            return;
          }
          const sugg = {
            road_name: snapData.nearest_road || "Unnamed road",
            distance_meters: snapData.snap_distance_meters,
            lat: snapData.snapped_lat,
            lng: snapData.snapped_lng,
            rawLat,
            rawLng,
          };
          setPendingSuggestedRoad(sugg);
          setPendingReportLocation(targetLoc);
          setPickingLocation(false);
          setOrUpdateSelectedLocationMarker(mapRef.current, selectedLocationMarkerRef, targetLoc);
        } catch (err) {
          setQuickLocating(false);
          console.warn("Could not snap GPS location to road:", err);
        }
      },
      (err) => {
        setQuickLocating(false);
        console.warn("GPS location error:", err);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  function handleReportLocationChange(newLoc) {
    if (!isInsideSogodBoundary([newLoc.lng, newLoc.lat], sogodBoundaryRef.current)) {
      selectedLocationMarkerRef.current?.setLngLat([
        pendingReportLocation.lng,
        pendingReportLocation.lat,
      ]);
      setRouteError("Hazard report pins must stay inside the Sogod boundary.");
      return;
    }
    setRouteError("");
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
      setOrUpdateSelectedLocationMarker(map, selectedLocationMarkerRef, newLoc, async (updatedLoc) => {
        let reSnapped = updatedLoc;
        try {
          const snapRes = await api.snapCoordinate(updatedLoc.lat, updatedLoc.lng, { snapToIntersection: false });
          if (snapRes && Number.isFinite(snapRes.snapped_lat) && Number.isFinite(snapRes.snapped_lng)) {
            reSnapped = {
              lat: snapRes.snapped_lat,
              lng: snapRes.snapped_lng,
              road_name: snapRes.nearest_road,
            };
            if (!isInsideSogodBoundary([reSnapped.lng, reSnapped.lat], sogodBoundaryRef.current)) {
              selectedLocationMarkerRef.current?.setLngLat([newLoc.lng, newLoc.lat]);
              setRouteError("The nearest road is outside Sogod. Choose a location inside the boundary.");
              return;
            }
            if (selectedLocationMarkerRef.current) {
              selectedLocationMarkerRef.current.setLngLat([reSnapped.lng, reSnapped.lat]);
            }
          }
        } catch (err) {
          console.warn("Could not re-snap dragged hazard marker:", err);
        }
        setPendingReportLocation(reSnapped);
      });
    }
  }

  function handleCloseReportModal() {
    setPendingReportLocation(null);
    setPendingSuggestedRoad(null);
    if (selectedLocationMarkerRef.current) {
      selectedLocationMarkerRef.current.remove();
      selectedLocationMarkerRef.current = null;
    }
    accuracyCircleStateRef.current = null;
    removeAccuracyCircle(mapRef.current);
  }

  function handleReportSubmitted() {
    setPendingReportLocation(null);
    setPendingSuggestedRoad(null);
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

  async function handleRequestAssistance() {
    if (requestingAssistance) return;
    if (!user) {
      openLoginDialog("Please log in to send a rescue request to EvacWay response staff.");
      return;
    }
    if (needsLocationConfirmation(myLocation) && assistanceLocationConfirmation !== myLocation) {
      setAssistanceLocationConfirmation(myLocation);
      return;
    }
    setRequestingAssistance(true);
    try {
      const lat = myLocation?.lat ?? myLocation?.latitude;
      const lng = myLocation?.lng ?? myLocation?.longitude;
      const centerName = displayEntityName(
        route?.evacuation_center?.name || myCenter?.evacuation_center?.name,
        "Evacuation Center"
      );
      const loggedInName = (
        user?.name ||
        user?.full_name ||
        (user?.first_name ? `${user.first_name} ${user.last_name || ""}`.trim() : "") ||
        user?.email ||
        "Resident"
      ).trim();
      const contact = (user?.contact_number || user?.phone || "Not provided").trim();

      const formData = new FormData();
      formData.append(
        "description",
        `Emergency: No roads available to reach ${centerName}. All routes are blocked. Requesting immediate rescue assistance.`
      );
      formData.append("requester_name", loggedInName);
      formData.append("requester_contact", contact);
      formData.append(
        "location_description",
        `Stuck en route to ${centerName}${lat && lng ? ` (GPS: ${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)})` : ""}`
      );
      if (lat != null && lng != null) {
        formData.append("latitude", String(lat));
        formData.append("longitude", String(lng));
      }

      await api.submitRescueRequest(formData);
      try {
        await queryClient.invalidateQueries({ queryKey: queryKeys.rescueRequests });
      } catch (qErr) {
        // ignore cache invalidation error
      }
      setAssistanceSent(true);
      setReportConfirmation("Rescue assistance request sent to emergency response staff.");
      window.setTimeout(() => setReportConfirmation(""), 5000);
    } catch (reqError) {
      setRouteError(reqError.message || "Failed to submit assistance request. Please try again or tap 'I need rescue'.");
    } finally {
      setRequestingAssistance(false);
    }
  }

  function handlePinRescueOnMap() {
    pickingPurposeRef.current = "rescue";
    setRescueAlertOpen(false);
    setPickingLocation(true);
  }

  function handleAdjustHazardOnMap() {
    pickingPurposeRef.current = "hazard";
    setPendingReportLocation(null);
    setPendingSuggestedRoad(null);
    setPickingLocation(true);
  }

  function handleRescueLocationCaptured(captured) {
    const locWithSource = {
      lat: captured.lat,
      lng: captured.lng,
      accuracy: captured.accuracy,
      is_manual_pin: Boolean(captured.is_manual_pin),
      location_source:
        captured.location_source ||
        (captured.accuracy != null && captured.accuracy > 100 ? "approximate" : "gps"),
    };
    accuracyCircleStateRef.current = locWithSource;
    const map = mapRef.current;
    if (map) {
      map.flyTo({
        center: [captured.lng, captured.lat],
        zoom: 16,
        essential: true,
      });
      setMyLocation(locWithSource);
      setOrUpdateAccuracyCircle(map, captured.lng, captured.lat, captured.accuracy || 30);
      setOrUpdateSelectedLocationMarker(
        map,
        selectedLocationMarkerRef,
        captured,
        undefined,
        { draggable: false }
      );
    }
  }

  // --------------------------------------------------
  // "My evacuation center" verification form
  // --------------------------------------------------

  const centerView = useCallback((centerName, room = null, details = {}) => {
    const feature = evacCenters?.features?.find((center) => {
      const properties = center.properties || center;
      return String(properties.name || "").trim().toLowerCase() ===
        String(centerName || "").trim().toLowerCase();
    });
    const properties = feature?.properties || feature || {};
    return {
      evacuation_center: {
        ...(properties.id != null ? { id: properties.id } : {}),
        name: centerName,
      },
      room,
      ...details,
    };
  }, [evacCenters]);

  const openMyCenter = useCallback(async () => {
    setLookupError("");
    setMyCenterOpen(true);
    api.getPublicBarangays()
      .then((barangays) => setLookupBarangays(Array.isArray(barangays) ? barangays : []))
      .catch(() => setLookupBarangays([]));
    if (user?.role === "resident") {
      try {
        const result = await api.getMyEvacuationCenter();
        if (result.center_name) {
          setMyCenter(centerView(result.center_name, result.room || null, {
            resident_id: user?.resident_id,
            is_checked_in: result.is_checked_in,
          }));
        } else {
          setMyCenter(null);
          setLookupError("No match found.");
        }
      } catch (error) {
        setMyCenter(null);
        setLookupError(error.status === 429 ? error.message : "No match found.");
      }
      return;
    }

    setMyCenter(null);
  }, [centerView, user]);

  useEffect(() => {
    if (!location.state?.openMyCenter) return;
    window.setTimeout(() => openMyCenter(), 0);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.key, location.pathname, location.state, navigate, openMyCenter]);

  function closeMyCenter() {
    setMyCenterOpen(false);
    setLookupError("");
    setLookupName("");
    setLookupBarangayId("");
    setLookupBirthdate("");
  }

  async function handleLookupSubmit(event) {
    event.preventDefault();
    setLookupLoading(true);
    setLookupError("");
    setMyCenter(null);
    clearSavedResident();

    try {
      const result = await api.lookupMyEvacuationCenter({
        full_name: lookupName.trim(),
        barangay_id: lookupBarangayId,
        birthdate: lookupBirthdate,
      });
      if (!result.center_name) {
        setLookupError("No match found.");
      } else {
        setMyCenter(centerView(result.center_name));
      }
    } catch (error) {
      setLookupError(error.status === 429 ? error.message : "No match found.");
    } finally {
      setLookupLoading(false);
    }
  }

  function handleFindMyCenterFromModal() {
    closeMyCenter();
    handleFindRoute();
  }

  // --------------------------------------------------
  // "Find someone" handlers
  // --------------------------------------------------

  function openFindSomeone() {
    clearFoundPersonLocation();
    setFindSomeoneOpen(true);
    setFindSomeoneBarangayId("");
    setFindSomeoneAdditionalDetail("");
    setFindSomeoneBarangaysLoading(true);
    api.getPublicBarangays()
      .then((barangays) => setFindSomeoneBarangays(Array.isArray(barangays) ? barangays : []))
      .catch(() => setFindSomeoneBarangays([]))
      .finally(() => setFindSomeoneBarangaysLoading(false));
  }

  // Search for a resident's evacuation center. The server returns center names only.
  const closeFindSomeone = () => {
    setFindSomeoneOpen(false);
    setFindSomeoneName("");
    setFindSomeoneBarangayId("");
    setFindSomeoneAdditionalDetail("");
    setFindSomeoneHint("");
    setFindSomeoneResults([]);
    setFindSomeoneSearched(false);
  };

  const handleFindSomeoneSubmit = async (event) => {
    event.preventDefault();
    clearFoundPersonLocation();
    const query = findSomeoneName.trim();
    if (query.split(/\s+/).filter(Boolean).length < 2) {
      setFindSomeoneHint("Enter the person's full name.");
      return;
    }
    if (!findSomeoneBarangayId) {
      setFindSomeoneHint("Choose a barangay.");
      return;
    }

    setFindSomeoneHint("");
    setFindSomeoneLoading(true);
    setFindSomeoneSearched(true);
    setFindSomeoneResults([]);
    try {
      const result = await api.findSomeoneCenter(
        query,
        findSomeoneBarangayId,
        findSomeoneAdditionalDetail.trim(),
      );
      setFindSomeoneResults(result.center_name ? [{ center_name: result.center_name }] : []);
    } catch (error) {
      setFindSomeoneResults([]);
      setFindSomeoneHint(error.status === 429 ? error.message : "No match found.");
    } finally {
      setFindSomeoneLoading(false);
    }
  };

  const handleViewPersonCenterOnMap = (match) => {
    const centerName = match?.center_name;
    if (!centerName) return;
    setFindSomeoneOpen(false);
    setFindSomeoneMapNotice("");
    const feature = evacCenters?.features?.find((center) => {
      const properties = center.properties || center;
      return String(properties.name || "").trim().toLowerCase() ===
        String(centerName).trim().toLowerCase();
    });
    if (!feature) {
      setFindSomeoneMapNotice("This center is not on the map yet.");
      return;
    }
    const coords = getCenterCoordinates(feature, buildingsGeoJSON);
    if (!coords) {
      setFindSomeoneMapNotice("This center is not on the map yet.");
      return;
    }
    setSelectedCenter(feature);
    const map = mapRef.current;
    if (map) {
      map.flyTo({
        center: [coords.longitude, coords.latitude],
        zoom: 16.5,
        duration: 1200,
        essential: false,
      });
    }
  };

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
      clearFoundPersonLocation();
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
    clearFoundPersonLocation();
    setSelectedCenter(null);
    setCenterPanelScrolled(false);
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

  const selectedCenterAddress = useMemo(() => {
    if (selectedCenterBarangays && selectedCenterBarangays.length > 0) {
      return selectedCenterBarangays.map((b) => displayEntityName(b.name)).join(", ");
    }
    if (selectedCenterProperties.address) {
      return selectedCenterProperties.address;
    }
    return "";
  }, [selectedCenterProperties.address, selectedCenterBarangays]);

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
    Array.isArray(selectedCenterProperties.amenities) && selectedCenterProperties.amenities.length > 0
      ? selectedCenterProperties.amenities.map((a) => (typeof a === 'string' ? a : a.name || a.code)).filter(Boolean).join(', ')
      : (typeof selectedCenterProperties.amenities === 'string' ? selectedCenterProperties.amenities : null);

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
    return getMappedBuildingsForCenter(buildingsGeoJSON, selectedCenterId);
  }, [selectedCenterId, buildingsGeoJSON]);

  const handleShowMyRoomOnMap = () => {
    const map = mapRef.current;
    if (!map) return;

    clearFoundPersonLocation();
    const building = resolveRoomBuilding(myCenter?.room, buildingsGeoJSON, myCenter?.evacuation_center?.id);
    const bId = building?.id;
    const bFeature = building?.feature;

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
    if (!myCenter?.evacuation_center?.id) return;
    handleFindRoute(myCenter.evacuation_center.id);
  };

  // --------------------------------------------------
  // Render
  // --------------------------------------------------

  const possibleNames = [
    user?.first_name ? `${user.first_name} ${user.last_name || ""}`.trim() : "",
    user?.full_name,
    myCenter?.household_head_name,
    myCenter?.resident_name,
    user?.name,
  ].filter(Boolean);

  const fullNameWithSpace = possibleNames.find(
    (n) => typeof n === "string" && n.trim().includes(" ")
  );

  const rawFullName =
    fullNameWithSpace ||
    possibleNames[0] ||
    user?.email?.split("@")[0] ||
    "Resident";

  const fullName = formatFirstAndLastName(rawFullName) || "Resident";

  const firstName =
    fullName.split(" ")[0] ||
    myCenter?.household_head_name?.split(" ")[0] ||
    myCenter?.resident_name?.split(" ")[0] ||
    user?.name?.split(" ")[0] ||
    "";

  const userInitial = (firstName || fullName || "").charAt(0).toUpperCase();
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
    setMapLayersOpen(false);

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
          <EvacShelterIcon size={15} />
        </div>
        <span>Safe evacuation center where your family can stay.</span>
      </div>
      <div className="legend-item">
        <div className="legend-icon-wrapper road-blocked">
          <FontAwesomeIcon icon={faTriangleExclamation} />
        </div>
        <span>Road that is blocked or closed and cannot be passed.</span>
      </div>

      <div className="help-section-divider" role="separator" />

      <div className="help-section-heading">How full is the building?</div>

      <div className="legend-item">
        <div className="legend-icon-wrapper">
          <span className="legend-status-dot dot-green" aria-hidden="true" />
        </div>
        <span>
          <strong>Plenty of space.</strong>{" "}
          <span className="legend-desc-muted">You can go here.</span>
        </span>
      </div>
      <div className="legend-item">
        <div className="legend-icon-wrapper">
          <span className="legend-status-dot dot-orange" aria-hidden="true" />
        </div>
        <span>
          <strong>Getting crowded.</strong>{" "}
          <span className="legend-desc-muted">Space is running low, so go soon.</span>
        </span>
      </div>
      <div className="legend-item">
        <div className="legend-icon-wrapper">
          <span className="legend-status-dot dot-red" aria-hidden="true" />
        </div>
        <span>
          <strong>Full.</strong>{" "}
          <span className="legend-desc-muted">No space left. Choose another center.</span>
        </span>
      </div>
      <div className="legend-item">
        <div className="legend-icon-wrapper">
          <span className="legend-status-dot dot-gray" aria-hidden="true" />
        </div>
        <span>
          <strong>No information yet.</strong>{" "}
          <span className="legend-desc-muted">Check with your barangay or the center.</span>
        </span>
      </div>
    </div>
  );

  const hasAssigned = Boolean(myCenter && (myCenter.room || myCenter.evacuation_center));
  const isRoomCardVisible = Boolean(
    hasAssigned && !route && !navigationActive && !hideRoomBarForSearch && !(isMobile && isHazardPopupOpen)
  );

  const isRoomCardExpanded = Boolean(
    isRoomCardVisible && roomCardExpanded && !selectedCenter
  );

  const hasRoom = Boolean(myCenter?.room);
  const roomNum = myCenter?.room?.room_name || (
    myCenter?.room?.room_number
      ? (String(myCenter.room.room_number).toLowerCase().startsWith("room")
        ? myCenter.room.room_number
        : `Room ${myCenter.room.room_number}`)
      : "Room 29"
  );
  const hasBuilding = Boolean(myCenter?.room?.building_id && myCenter?.room?.building_name);
  const myCheckinStatus =
    myCenter?.is_checked_in || myCenter?.room?.is_checked_in
      ? "Checked in"
      : "Reserved for your family";
  const centerDisplayName =
    myCenter?.evacuation_center?.name || "Sogod Central School";
  const roomTitle = hasRoom
    ? (myCenter?.room?.room_name || roomNum)
    : (hasBuilding ? myCenter.room.building_name : "General Shelter");
  const roomFloorLabel = Number(myCenter?.room?.building_floors || 1) > 1 ? formatFloorLabel(myCenter?.room?.floor) : "";
  const roomSubtitle = hasBuilding
    ? [myCenter.room.building_name, roomFloorLabel, centerDisplayName].filter(Boolean).join(" · ")
    : centerDisplayName;
  const roomSubtitleContent = isMobile && hasBuilding
    ? <><span>{myCenter.room.building_name}{roomFloorLabel ? ` · ${roomFloorLabel}` : ""}</span><span>{centerDisplayName}</span></>
    : roomSubtitle;
  const roomLabel = `${roomTitle} · ${roomSubtitle}`;
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
    clearFoundPersonLocation();
    const building = resolveRoomBuilding(myCenter?.room, buildingsGeoJSON, myCenter?.evacuation_center?.id);
    const bId = building?.id;
    const bFeature = building?.feature;

    if (bId != null) {
      setPrivateBuildingView(false);
      setSelectedBuildingId(bId);
      setSelectedBuildingData(
        bFeature?.properties || { id: bId, name: myCenter?.room?.building_name }
      );
      setBuildingModalOpen(true);
    }
  }, [myCenter, buildingsGeoJSON, clearFoundPersonLocation]);

  const handleSheetTouchStart = (e) => {
    touchStartYRef.current = e.touches[0].clientY;
  };
  const handleSheetTouchEnd = (e) => {
    const deltaY = e.changedTouches[0].clientY - touchStartYRef.current;
    if (deltaY > 35) {
      setRoomCardExpanded(false);
    }
  };

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    applyPublicMapLayerVisibility(
      mapRef.current,
      publicMapLayers,
      evacuationMarkersRef.current
    );
  }, [
    mapLoaded,
    publicMapLayers,
    styleVersion,
    evacCenters,
    buildingsGeoJSON,
    entrancesGeoJSON,
    hazardReports,
    filteredHazardZones,
    roads,
    selectedCenter,
    myCenter,
    isMobileMap,
  ]);

  return (
    <div
      className={`resident-home ${isRoomCardVisible ? "has-room-card" : ""} ${isRoomCardExpanded ? "has-room-card-expanded" : ""
        } ${isHazardPopupOpen ? "has-hazard-popup" : ""} ${pickingLocation && pickingPurposeRef.current === "hazard" ? "picking-hazard-mode" : ""} ${pickingLocation && pickingPurposeRef.current === "route" ? "picking-route-mode" : ""}`}
    >
      {/* Public map */}
      <div
        ref={mapContainerRef}
        className={`map-container ${pickingLocation && pickingPurposeRef.current === "hazard" ? "is-picking-hazard" : ""} ${pickingLocation && pickingPurposeRef.current === "route" ? "is-picking-route" : ""
          }`}
      />
      {formatPublicCenterUpdateTime(evacCenters?.last_updated) && (
        <div className="public-centers-updated" aria-label={`Evacuation center list last updated ${formatPublicCenterUpdateTime(evacCenters.last_updated)}`}>
          Center data updated {formatPublicCenterUpdateTime(evacCenters.last_updated)}
        </div>
      )}

      {/* Header (slim 48px bar on phones) */}
      <header className="top-bar">
        <Link to="/" className="brand brand-link" aria-label="EvacWay Home" title="EvacWay Home">
          <img src="/evacway-logo-text.png" alt="EvacWay" className="brand-logo brand-logo-wide" />
          <img src="/evacway-app.png" alt="EvacWay" className="brand-logo brand-logo-square" />
        </Link>

        {/* Search evacuation center bar: centered in header between logo and user actions */}
        <div className="top-bar-search">
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
                  setShowSearchResults(true);
                } else {
                  setShowSearchResults(false);
                }
              }}
              onFocus={() => {
                if (searchResults.length > 0 || searchText.trim().length >= 2) {
                  setShowSearchResults(true);
                }
              }}
              onBlur={() => {
                setTimeout(() => {
                  if (!selectingSuggestionRef.current) {
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
                }}
                title="Clear search"
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
            <div className="top-bar-user-wrap" ref={profileDropdownRef}>
              <button
                type="button"
                className="header-profile-btn"
                onClick={() => setProfileDropdownOpen((prev) => !prev)}
                aria-label="Account menu"
                aria-expanded={profileDropdownOpen}
                title={`Signed in as ${fullName}`}
              >
                <span className="header-profile-avatar" aria-hidden="true">
                  <FontAwesomeIcon icon={faUser} />
                </span>
                <span className="header-profile-name">{fullName}</span>
                <FontAwesomeIcon
                  icon={faChevronDown}
                  className={`header-profile-chevron ${profileDropdownOpen ? "open" : ""}`}
                  aria-hidden="true"
                />
              </button>

              {profileDropdownOpen && (
                <div className="header-profile-dropdown" role="menu" aria-label="Account options">
                  <div className="profile-dropdown-user-info">
                    <div className="profile-dropdown-avatar" aria-hidden="true">
                      <FontAwesomeIcon icon={faUser} />
                    </div>
                    <div className="profile-dropdown-text">
                      <strong className="profile-dropdown-name">{fullName}</strong>
                      {user?.email && <span className="profile-dropdown-email">{user.email}</span>}
                    </div>
                  </div>
                  <div className="profile-dropdown-divider" aria-hidden="true" />
                  {isLoggedInResident && (
                    <div className="profile-dropdown-privacy">
                      <label>
                        <input
                          type="checkbox"
                          checked={findSomeoneSearchable}
                          disabled={findSomeonePrivacyLoading || findSomeonePrivacySaving}
                          onChange={handleFindSomeonePrivacyChange}
                        />
                        <span>Let others find my family's evacuation center?</span>
                      </label>
                      {findSomeonePrivacyError && (
                        <span className="profile-dropdown-privacy-error" role="status">
                          {findSomeonePrivacyError}
                        </span>
                      )}
                    </div>
                  )}
                  {isLoggedInResident && <div className="profile-dropdown-divider" aria-hidden="true" />}
                  <button
                    type="button"
                    className="profile-dropdown-logout-btn"
                    role="menuitem"
                    onClick={() => {
                      setProfileDropdownOpen(false);
                      handleLogout();
                    }}
                  >
                    <FontAwesomeIcon icon={faRightFromBracket} />
                    <span>Log Out</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Hazard road location picking instruction banner */}
      {pickingLocation && pickingPurposeRef.current === "hazard" && (
        <div className="hazard-pick-banner" role="status">
          <div className="hazard-pick-banner-content">
            <div className="hazard-pick-banner-text">
              <span className="hazard-pick-banner-title">
                <FontAwesomeIcon icon={faMapPin} /> Click on a road to report danger
              </span>
              <span className="hazard-pick-banner-sub">
                Only roads can be selected
              </span>
            </div>
            <div className="hazard-pick-banner-actions">
              <button
                type="button"
                className="hazard-pick-gps-btn"
                onClick={handleQuickUseMyLocation}
                disabled={quickLocating}
                title="Detect GPS and suggest nearest road"
              >
                <FontAwesomeIcon icon={faLocationCrosshairs} spin={quickLocating} />
                <span>{quickLocating ? "Locating..." : "Use My Location"}</span>
              </button>
              <button
                type="button"
                className="hazard-pick-cancel-btn"
                onClick={() => setPickingLocation(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {pickingLocation && pickingPurposeRef.current === "route" && (
        <div className="route-start-pick-banner" role="status">
          <span><FontAwesomeIcon icon={faMapPin} /> Tap the map inside Sogod to set your starting point.</span>
          <button type="button" onClick={() => setPickingLocation(false)}>Cancel</button>
        </div>
      )}

      {/* "Your room" / "Your shelter" card: collapsed bar by default; expanded under search on desktop, bottom sheet on mobile */}
      <div className="assigned-room-overlay" hidden={!isRoomCardVisible}>
      {hasAssigned && (
        !(roomCardExpanded && !selectedCenter) ? (
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
                  <div className="your-room-main-title">{roomTitle}</div>
                  <div className="your-room-sub-title">
                    {roomSubtitleContent}
                  </div>
                </div>
              </div>
              <div className="your-room-collapsed-right">
                <button
                  type="button"
                  className="your-room-collapsed-nav-btn"
                  onClick={handleStartWalkingToMyRoom}
                  title="Start walking navigation"
                  aria-label="Start walking navigation"
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
                    <div className="your-room-main-title">{roomTitle}</div>
                    <div className="your-room-sub-title">{roomSubtitleContent}</div>
                  </div>
                </div>
                <button
                  type="button"
                  className="your-room-collapsed-expand-btn is-expanded"
                  onClick={() => setRoomCardExpanded(false)}
                  title="Collapse room details"
                  aria-label="Collapse room details"
                  aria-expanded="true"
                >
                  <FontAwesomeIcon icon={faChevronDown} />
                </button>
              </div>
              <div className="your-room-divider" aria-hidden="true" />
              <div className="your-room-expanded-content">
                <p className="pinned-room-details-line">
                  <strong>{myCheckinStatus}</strong>
                  {" · "}
                  {hasRoom && myCenter.room ? (
                    <>
                      {roomFloorLabel ? `Floor: ${roomFloorLabel}. ` : ""}
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
                <div className="your-room-text-stack">
                  <div className="your-room-main-title">{roomTitle}</div>
                  <div className="your-room-sub-title">{roomSubtitleContent}</div>
                </div>
              </div>
              <button
                type="button"
                className="your-room-collapsed-expand-btn is-expanded"
                onClick={() => setRoomCardExpanded(false)}
                title="Collapse room details"
                aria-label="Collapse room details"
                aria-expanded="true"
              >
                <FontAwesomeIcon icon={faChevronDown} />
              </button>
            </div>
            <div className="your-room-divider" aria-hidden="true" />
            <div className="your-room-expanded-content">
              <p className="pinned-room-details-line">
                <strong>{myCheckinStatus}</strong>
                {" · "}
                {hasRoom && myCenter.room ? (
                  <>
                    {roomFloorLabel ? `Floor: ${roomFloorLabel}. ` : ""}
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
      </div>

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
          <span className="map-control-tooltip" role="tooltip">My location</span>
        </button>

        <button
          type="button"
          onClick={() =>
            handleMapStyleChange(mapStyle === "street" ? "bright" : "street")
          }
          className={`control-stack-btn ${mapStyle === "bright" ? "active" : ""}`}
          title={
            mapStyle === "street"
              ? (isOnline ? "Switch to Satellite Map" : "Switch to Bright Map")
              : "Switch to Street Map"
          }
          aria-label={
            mapStyle === "street"
              ? (isOnline ? "Switch to Satellite Map" : "Switch to Bright Map")
              : "Switch to Street Map"
          }
          aria-pressed={mapStyle === "bright"}
        >
          <FontAwesomeIcon icon={faSatelliteDish} />
          <span className="map-control-tooltip" role="tooltip">
            {mapStyle === "street"
              ? (isOnline ? "Switch to Satellite Map" : "Switch to Bright Map")
              : "Switch to Street Map"}
          </span>
        </button>

        <div className="control-stack-layers-wrap">
          <button
            type="button"
            onClick={() => setMapLayersOpen((open) => !open)}
            className={`control-stack-btn ${mapLayersOpen ? "active" : ""}`}
            title="Map layers and legend"
            aria-label="Map layers and legend"
            aria-expanded={mapLayersOpen}
          >
            <FontAwesomeIcon icon={faLayerGroup} />
            <span className="map-control-tooltip" role="tooltip">Map layers and legend</span>
          </button>

          {mapLayersOpen && (
            <section className="map-layers-popover" id="public-map-layers" aria-label="Map layers and legend">
              <div className="map-layers-heading">
                <h3>Map layers</h3>
                <button
                  type="button"
                  className="map-layers-close"
                  onClick={() => setMapLayersOpen(false)}
                  title="Close map layers"
                  aria-label="Close map layers"
                >
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              </div>

              <fieldset className="map-layer-toggles">
                <legend>Show on map</legend>
                {[
                  ["centers", "Evacuation centers"],
                  ["hazards", "Hazards and closed roads"],
                  ["boundaries", "Sogod boundary"],
                ].map(([key, label]) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={publicMapLayers[key]}
                      onChange={(event) => setPublicMapLayers((current) => ({
                        ...current,
                        [key]: event.target.checked,
                      }))}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </fieldset>

            </section>
          )}
        </div>

        <button
          type="button"
          onClick={handleSaveSogodOfflineMap}
          disabled={offlineMapDownload.status === "downloading"}
          className={`control-stack-btn offline-map-download-btn ${offlineMapDownload.status === "saved" ? "active" : ""}`}
          aria-label={offlineMapDownload.status === "downloading"
            ? `Saving Sogod map, ${offlineMapDownload.completed} of ${offlineMapDownload.total} tiles`
            : "Save the Sogod map for offline use"}
        >
          {offlineMapDownload.status === "downloading" ? (
            <span className="offline-map-download-icon" aria-hidden="true">
              <FontAwesomeIcon icon={faDownload} className="offline-map-download-icon-base" />
              <span
                className="offline-map-download-icon-fill"
                style={{ clipPath: `inset(${100 - offlineMapProgress}% 0 0 0)` }}
              >
                <FontAwesomeIcon icon={faDownload} />
              </span>
            </span>
          ) : (
            <FontAwesomeIcon icon={offlineMapDownload.status === "saved" ? faCircleCheck : faDownload} />
          )}
          <span className="map-control-tooltip" role="tooltip">
            {offlineMapDownload.status === "downloading"
              ? `Saving Sogod map: ${offlineMapDownload.completed} of ${offlineMapDownload.total} tiles`
              : "Save the Sogod map for offline use"}
          </span>
        </button>
        {(offlineMapDownload.status === "downloading"
          || offlineMapDownload.status === "saved"
          || offlineMapDownload.status === "error") && (
          <div
            className={`offline-map-download-status ${offlineMapDownload.status === "saved" ? "is-saved" : ""}`}
            role="status"
            aria-live="polite"
          >
            {offlineMapDownload.status === "downloading"
              ? `Saving Sogod map: ${offlineMapDownload.completed} of ${offlineMapDownload.total} tiles`
              : offlineMapDownload.status === "saved"
                ? "Sogod map saved for offline use."
                : offlineMapDownload.error}
          </div>
        )}

        <button
          type="button"
          onClick={() => (helpOpen ? setHelpOpen(false) : openSheet("help"))}
          className={`control-stack-btn ${helpOpen ? "active" : ""}`}
          title="Help"
          aria-label="Help"
          aria-expanded={helpOpen}
        >
          <FontAwesomeIcon icon={faCircleQuestion} />
          <span className="map-control-tooltip" role="tooltip">Help</span>
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
                title="Close help"
                aria-label="Close help"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            <div className={isMobile ? "sheet-body" : ""}>
              {helpIconsList}
              <div className="map-legend-content" aria-label="Map key">
                <h4>Map key</h4>
                <div className="map-legend-row"><span className="map-legend-dot status-available" />Available center</div>
                <div className="map-legend-row"><span className="map-legend-dot status-almost-full" />Almost full center (90%+)</div>
                <div className="map-legend-row"><span className="map-legend-dot status-full" />Full center</div>
                <div className="map-legend-row"><span className="map-legend-dot status-family" />Your assigned center</div>
                <div className="map-legend-row"><span className="map-legend-line road-closed" />Closed road</div>
                <div className="map-legend-row"><span className="map-legend-symbol hazard-symbol" aria-hidden="true">!</span>Hazard report</div>
                <div className="map-legend-row"><span className="map-legend-polygon flood-polygon" />Flood area</div>
                <div className="map-legend-row"><span className="map-legend-polygon landslide-polygon" />Landslide area</div>
                <div className="map-legend-row"><span className="map-legend-line center-boundary" />Evacuation center boundary</div>
                <div className="map-legend-row"><span className="map-legend-line municipal-boundary" />Sogod municipal boundary (blue dashed)</div>
              </div>
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
      {selectedCenter && (
        <PublicMapDialogShell onClose={closeCenterDetails} labelledBy="center-card-title" hasHandle>
          <div className={`center-bottom-card ${isMobile ? "mobile" : ""}`}>
          {/* Fixed Top Section: Header, Quick Stats, My Room, Primary Action */}
          <div className={`center-card-top-fixed ${centerPanelScrolled ? "is-scrolled" : ""}`}>
            {isMobile && <div className="sheet-handle" aria-hidden="true" />}

            {/* Header */}
            <div className="center-card-header">
              <div className="center-card-header-main">
                <div className="center-card-name-row">
                  <h3 id="center-card-title" className="center-card-title">{selectedCenterName}</h3>
                  {selectedCenterIsMine ? (
                    <span className="center-status-badge mine">
                      <span className="center-status-dot" />
                      Your Assigned Center
                    </span>
                  ) : (
                    <span className="center-status-badge open">
                      <span className="center-status-dot" />
                      Open Center
                    </span>
                  )}
                </div>
                {selectedCenterAddress && (
                  <div className="center-card-address" title={selectedCenterAddress}>
                    {selectedCenterAddress}
                  </div>
                )}
              </div>

              <button
                type="button"
                className="center-card-close-btn"
                onClick={closeCenterDetails}
                aria-label="Close details"
                title="Close"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            {/* Quick stats: 3 small stat tiles */}
            <div className="center-stat-tiles-row">
              {/* Distance */}
              <div className="center-stat-tile">
                <div className="center-stat-val-row">
                  <FontAwesomeIcon icon={faLocationDot} className="center-stat-pin-icon" />
                  <span className="center-stat-num">{selectedCenterDistance || "Nearby"}</span>
                </div>
                <span className="center-stat-lbl">distance</span>
              </div>

              {/* Here */}
              <div className="center-stat-tile">
                <div className="center-stat-val-row">
                  <span className="center-stat-num">{selectedCenterOccupied ?? 0}</span>
                </div>
                <span className="center-stat-lbl">here</span>
              </div>

              {/* Assigned */}
              <div className="center-stat-tile">
                <div className="center-stat-val-row">
                  <span className="center-stat-num">{selectedCenterAssigned ?? 0}</span>
                  {selectedCenterCapacity != null && (
                    <span className="center-stat-sub">of {selectedCenterCapacity}</span>
                  )}
                </div>
                <span className="center-stat-lbl">assigned</span>
              </div>
            </div>

            {/* Assigned Room Callout (if this is the resident's assigned center) */}
            {selectedCenterIsMine && (
              <div className="cd-your-room">
                <FontAwesomeIcon icon={faCircleCheck} />
                <span>
                  {myCenter?.room?.room_number ? (
                    <>
                      Your assigned room: <strong>{myCenter.room.room_number}</strong>{roomFloorLabel ? ` · ${roomFloorLabel}` : ""} · {myCheckinStatus}
                    </>
                  ) : (
                    <>
                      Your assigned shelter (1 space) · {myCheckinStatus}
                    </>
                  )}
                </span>
              </div>
            )}

            {/* Primary Action Button: Navigate to this Center */}
            {foundPersonLocation?.room && (
              <div className="cd-your-room found-person-room-text">
                {[foundPersonLocation.room.building_name, formatFloorLabel(foundPersonLocation.room.floor), foundPersonLocation.room.room_number || "Room assigned"].filter(Boolean).join(" · ")}
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
          </div>

          {/* Scrollable Body: Buildings List Only */}
          <div
            className="center-card-scroll-body"
            onScroll={(e) => setCenterPanelScrolled(e.currentTarget.scrollTop > 4)}
          >
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
                      <span className="buildings-header-title">Shelter Space</span>
                      <span className="buildings-header-sub">
                        {cType === "private_property"
                          ? "Private Property"
                          : "Single Open Space"}
                      </span>
                    </div>
                    <div className="center-shelter-space-card">
                      <div className="center-shelter-row">
                        <span className="center-shelter-label">Capacity</span>
                        <strong className="center-shelter-val">{cap} people</strong>
                      </div>
                      <div className="center-shelter-row">
                        <span className="center-shelter-label">Space remaining</span>
                        <strong
                          className="center-shelter-val"
                          style={{
                            color: spaceLeft > 0 ? "#16a34a" : "#dc2626",
                          }}
                        >
                          {spaceLeft} space{spaceLeft === 1 ? "" : "s"} left
                        </strong>
                      </div>
                      {selectedCenter.properties?.building_material && (
                        <div className="center-shelter-row">
                          <span className="center-shelter-label">
                            Building material
                          </span>
                          <span className="center-shelter-val">
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
                    <span className="buildings-header-title">
                      Buildings ({selectedCenterBuildings.length})
                    </span>
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

                        // Unified status colors
                        let statusKey = "available";
                        let statusLabel = "Available";
                        let statusDotColor = "#16a34a";
                        let bColor = "#16a34a";

                        if (bCap === 0) {
                          statusKey = "no-data";
                          statusLabel = "No data";
                          statusDotColor = "#94a3b8";
                          bColor = "#94a3b8";
                        } else if (bOcc >= bCap) {
                          statusKey = "full";
                          statusLabel = "Full";
                          statusDotColor = "#dc2626";
                          bColor = "#dc2626";
                        } else if (bAssigned >= bCap) {
                          statusKey = "fully-assigned";
                          statusLabel = "Fully assigned";
                          statusDotColor = "#d97706";
                          bColor = "#d97706";
                        } else if (bPct >= 70) {
                          statusKey = "filling";
                          statusLabel = "Filling";
                          statusDotColor = "#d97706";
                          bColor = "#d97706";
                        }

                        const isUserBuilding =
                          myCenter?.room?.building_id != null &&
                          String(myCenter.room.building_id) === String(b.id);

                        return (
                          <button
                            type="button"
                            key={b.id}
                            className={`center-building-card ${isUserBuilding ? "is-user-building" : ""
                              }`}
                            onClick={() => {
                              setPrivateBuildingView(false);
                              setSelectedBuildingId(b.id);
                              setSelectedBuildingData(b);
                              setBuildingModalOpen(true);
                              closeCenterDetails();
                            }}
                            role="listitem"
                            aria-label={`${b.name || "Building"}, ${b.room_count || 0} rooms, ${statusLabel}, ${bOcc} of ${bCap} here, ${bAssigned} assigned`}
                          >
                            <div className="center-building-card-main">
                              {/* 40px soft-tinted rounded icon square */}
                              <div className="center-building-icon-square" aria-hidden="true">
                                <FontAwesomeIcon icon={faBuilding} />
                              </div>

                              {/* Building Name & Subtitle */}
                              <div className="center-building-card-info">
                                <div className="center-building-name-line">
                                  <span className="center-building-card-name">
                                    {b.name || `Building #${b.id}`}
                                  </span>
                                  {isUserBuilding && (
                                    <span className="bldg-badge-yours">
                                      Your building
                                    </span>
                                  )}
                                </div>
                                <div className="center-building-card-sub">
                                  {bOcc} of {bCap} here · {bAssigned} assigned
                                </div>
                              </div>

                              {/* Right: room count + chevron and status pill */}
                              <div className="center-building-card-right">
                                <div className="center-building-rooms-wrap">
                                  <span className="center-building-rooms-text">
                                    {b.room_count || 0}{" "}
                                    {b.room_count === 1 ? "room" : "rooms"}
                                  </span>
                                  <FontAwesomeIcon
                                    icon={faChevronRight}
                                    className="center-building-chevron"
                                  />
                                </div>
                                <span className={`center-bldg-badge is-${statusKey}`}>
                                  <span
                                    className="center-bldg-dot"
                                    style={{ backgroundColor: statusDotColor }}
                                  />
                                  {statusLabel}
                                </span>
                              </div>
                            </div>

                            {/* Thin 4px progress bar with percentage */}
                            <div className="center-building-bar-row">
                              <div className="center-building-bar-track" aria-hidden="true">
                                {bAssignedPct > 0 && (
                                  <div
                                    className="center-building-bar-assigned"
                                    style={{ width: `${Math.min(100, bAssignedPct)}%` }}
                                  />
                                )}
                                <div
                                  className="center-building-bar-fill"
                                  style={{
                                    width: `${Math.min(100, bPct)}%`,
                                    backgroundColor: bColor,
                                  }}
                                />
                              </div>
                              <span className="center-building-pct-text">
                                {bPct}%
                              </span>
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
          </div>
        </PublicMapDialogShell>
      )}

      {/* Bottom Action Bar: Google Earth-style round icon button row in bottom-right corner */}
      <div
        className="bottom-actions-container"
        role="toolbar"
        aria-label="Quick actions"
      >
        {locationPermission !== "granted" && !myLocation?.is_manual_pin ? (
          <button
            type="button"
            onClick={handleEnableLocation}
            className="action-btn-circle action-btn-primary"
            title="Go to nearest safe place"
            aria-label="Go to nearest safe place"
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="6" cy="19" r="2.5" />
              <path d="M8.5 19h6a4.5 4.5 0 0 0 0-9H9.5a4.5 4.5 0 0 1 0-9H15" />
              <polyline points="13 3.5 15.5 1 18 3.5" />
            </svg>
            <span className="action-tooltip" role="tooltip">
              Go to nearest safe place
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => handleFindRoute()}
            disabled={findingRoute}
            className="action-btn-circle action-btn-primary"
            title={findingRoute ? "Finding route..." : myCenter ? "Go to my evacuation center" : "Go to nearest safe place"}
            aria-label={
              findingRoute
                ? "Finding route..."
                : myCenter
                  ? "Go to my evacuation center"
                  : "Go to nearest safe place"
            }
          >
            {findingRoute ? (
              <svg
                className="spin-icon"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="12" y1="2" x2="12" y2="6" />
                <line x1="12" y1="18" x2="12" y2="22" />
                <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
                <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
                <line x1="2" y1="12" x2="6" y2="12" />
                <line x1="18" y1="12" x2="22" y2="12" />
                <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
                <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
              </svg>
            ) : (
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="6" cy="19" r="2.5" />
                <path d="M8.5 19h6a4.5 4.5 0 0 0 0-9H9.5a4.5 4.5 0 0 1 0-9H15" />
                <polyline points="13 3.5 15.5 1 18 3.5" />
              </svg>
            )}
            <span className="action-tooltip" role="tooltip">
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
          className="action-btn-circle action-btn-secondary"
          title={pickingLocation ? "Tap map to mark danger" : "Report a danger"}
          aria-label={pickingLocation ? "Tap map to mark danger" : "Report a danger"}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          <span className="action-tooltip" role="tooltip">
            {pickingLocation ? "Tap map to mark danger" : "Report a danger"}
          </span>
        </button>

        <button
          type="button"
          onClick={openMyCenter}
          className={`action-btn-circle action-btn-secondary ${myCenter ? "verified" : ""}`}
          title={myCenter ? `My Evacuation Center (${firstName})` : "My Evacuation Center"}
          aria-label={myCenter ? `My Evacuation Center (${firstName})` : "My Evacuation Center"}
        >
          {myCenter ? (
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          ) : (
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          )}
          <span className="action-tooltip" role="tooltip">
            {myCenter ? `My Evacuation Center (${firstName})` : "My Evacuation Center"}
          </span>
        </button>

        {isLoggedInResident && (
        <button
          type="button"
          onClick={openFindSomeone}
          className="action-btn-circle action-btn-secondary"
          title="Find someone"
          aria-label="Find someone"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="10" cy="7" r="4" />
            <path d="M10.3 15H7a4 4 0 0 0-4 4v2" />
            <circle cx="17" cy="17" r="3" />
            <line x1="19.2" y1="19.2" x2="22" y2="22" />
          </svg>
          <span className="action-tooltip" role="tooltip">
            Find someone
          </span>
        </button>
        )}

        <button
          type="button"
          onClick={() => setRescueAlertOpen(true)}
          className="action-btn-circle action-btn-sos"
          title="I need rescue"
          aria-label="I need rescue"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span className="action-tooltip" role="tooltip">
            I need rescue
          </span>
        </button>
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
                title="Close"
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
        <div className="nav-active-top-bar route-nav-compact" role="region" aria-label="Walking navigation">
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
                {lostSignal ? (
                  <span className="nav-signal-lost-pill">Searching for location...</span>
                ) : navigationStatus && navigationStatus.includes("Off route") ? (
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
            <button
              type="button"
              className="nav-bar-stop-btn"
              onClick={() => stopWalkingNavigation()}
              aria-label="End navigation"
              title="End navigation"
            >
              End
            </button>
          </div>
      )}

      {/* Route preview stays below the header, clear of the map controls and bottom dock. */}
      {route && !navigationActive && (
        <div
          className={`route-preview-card ${route.no_roads_available ? "route-blocked-card" : "route-card-compact"} ${isMobile ? (route.no_roads_available ? "mobile-top-card" : "mobile-bottom-sheet") : ""} ${routeDetailsOpen && !route.no_roads_available ? "is-expanded" : ""}`}
          role="region"
          aria-label={route.no_roads_available ? "Roads blocked notice" : "Route preview"}
        >
          {route.no_roads_available ? (
            <div className="route-blocked-content">
              <div className="route-blocked-header">
                <div className="route-blocked-title-row">
                  <div className="route-blocked-icon-badge" aria-hidden="true">
                    <FontAwesomeIcon icon={faTriangleExclamation} />
                  </div>
                  <div className="route-blocked-header-text">
                    <span className="route-blocked-dest">
                      {displayEntityName(route.evacuation_center?.name, "Evacuation Center")}
                    </span>
                    <span className="route-blocked-status-tag">
                      {route.no_safe_center ? "No Safe Center" : "Access Blocked"}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleClearRoute}
                  className="route-preview-close"
                  aria-label="Close"
                  title="Close"
                >
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              </div>

              <div className="route-blocked-notice-message">
                {route.no_safe_center ? (
                  <>
                    <p>No safe evacuation center with available family slots and people spaces can be reached.</p>
                    <button
                      type="button"
                      className="route-request-assistance-btn"
                      onClick={() => {
                        setRescueCoordinates(myLocation);
                        setRescueAlertOpen(true);
                      }}
                    >
                      <FontAwesomeIcon icon={faTriangleExclamation} />
                      <span>Request rescue</span>
                    </button>
                  </>
                ) : (
                  <p>{route.message || "No roads available. All routes to your evacuation center are blocked."}</p>
                )}
              </div>

              {!route.no_safe_center && route.alternative_center?.evacuation_center?.id != null && (
                <>
                  <button
                    type="button"
                    className="route-other-centers-toggle"
                    onClick={() => setOtherCentersOpen((open) => !open)}
                    aria-expanded={otherCentersOpen}
                  >
                    {otherCentersOpen ? "Hide other centers" : "Other centers"}
                  </button>
                  {otherCentersOpen && (
                    <RouteAlternativeCard
                      alternative={route.alternative_center}
                      rooms={rooms}
                      onSelect={() => handleFindRoute(route.alternative_center?.evacuation_center?.id)}
                    />
                  )}
                </>
              )}

              {!route.no_safe_center && (assistanceSent ? (
                <div className="route-assistance-sent-box" role="status">
                  <FontAwesomeIcon icon={faCircleCheck} className="route-assistance-sent-icon" />
                  <div className="route-assistance-sent-text">
                    <strong>Request sent</strong>
                    <span>Emergency response staff has been notified of your location and blocked route.</span>
                  </div>
                </div>
              ) : (
                <>
                {assistanceLocationConfirmation === myLocation && needsLocationConfirmation(myLocation) && (
                  <p className="route-location-confirmation" role="status">Check your location on the map, then confirm to send help.</p>
                )}
                <button
                  type="button"
                  className="route-request-assistance-btn"
                  onClick={handleRequestAssistance}
                  disabled={requestingAssistance}
                >
                  <FontAwesomeIcon
                    icon={requestingAssistance ? faSpinner : faTriangleExclamation}
                    spin={requestingAssistance}
                  />
                  <span>{requestingAssistance ? "Sending request..." : assistanceLocationConfirmation === myLocation && needsLocationConfirmation(myLocation) ? "Confirm and send" : "Request assistance"}</span>
                </button>
                </>
              ))}
            </div>
          ) : (
            <>
              {route.fallback_state === "fallback" && (
                <div className="route-fallback-banner" role="status">
                  <strong>Your center can't be reached. Showing the nearest safe center.</strong>
                  <span>
                    {route.evacuation_center?.free_family_slots ?? "—"} family slots and {route.evacuation_center?.free_people_spaces ?? "—"} people spaces are free. {route.selection_reason}
                  </span>
                </div>
              )}
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
                  </div>
                  <p className="route-preview-meta route-preview-compact-meta">
                    {Number(route.distance_km || 0).toFixed(1)} km · {routeWalkMinutes} min walking
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleClearRoute}
                  className="route-preview-close"
                  aria-label="Close"
                  title="Close"
                >
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              </div>
              <div className="route-availability-row">
                <div className={`route-availability-pill route-availability-${routeAvailability.status}`} role="status">
                  {routeAvailability.status === "full"
                    ? "Full"
                    : routeAvailability.status === "almost-full"
                      ? "Almost full"
                      : routeAvailability.status === "available"
                        ? `Available · ${routeAvailability.freePeopleSpaces} spaces left`
                        : "Availability unavailable"}
                </div>
                <button
                  type="button"
                  className="route-details-toggle"
                  onClick={() => setRouteDetailsOpen((open) => !open)}
                  aria-expanded={routeDetailsOpen}
                >
                  <span>Details</span>
                  <FontAwesomeIcon icon={routeDetailsOpen ? faChevronUp : faChevronDown} aria-hidden="true" />
                </button>
              </div>
              {routeWalkMinutes > LONG_WALK_THRESHOLD_MINUTES && (
                <div className="route-long-walk" role="note">
                  <div className="route-long-walk-copy">
                    <span>Walking routes only.</span>
                    <strong>This is a long walk</strong>
                  </div>
                  <div className="route-long-walk-actions">
                    {configuredHotline?.number && (
                      <a
                        className="route-safety-action"
                        href={`tel:${configuredHotline.number.replace(/[^\d+]/g, "")}`}
                      >
                        Call hotline
                      </a>
                    )}
                    <button
                      type="button"
                      className="route-safety-action"
                      onClick={() => {
                        setRescueCoordinates(myLocation);
                        setRescueAlertOpen(true);
                      }}
                    >
                      Request rescue
                    </button>
                  </div>
                </div>
              )}
              {routeWalkMinutes <= LONG_WALK_THRESHOLD_MINUTES && (
                <p className="route-mode-note route-mode-note-compact">Walking routes only.</p>
              )}
              {navigationLocationConfirmation?.location === myLocation && navigationLocationConfirmation?.route === route && needsLocationConfirmation(myLocation) && (
                <p className="route-location-confirmation" role="status">Check your starting point on the map, then confirm to start.</p>
              )}
              <button
                type="button"
                className="route-preview-start-btn"
                onClick={handleStartWalkingNavigation}
              >
                <FontAwesomeIcon icon={faPersonWalking} />
                <span>{navigationLocationConfirmation?.location === myLocation && navigationLocationConfirmation?.route === route && needsLocationConfirmation(myLocation) ? "Confirm and start" : "Start walking navigation"}</span>
              </button>
              {routeDetailsOpen && (
                <div className="route-preview-details">
                  <CenterCapacityFacts
                    centerId={route.evacuation_center?.id}
                    rooms={rooms}
                    capacityOverride={route.evacuation_center}
                  />
                  <p className="route-mode-note">
                    Walking routes only. Motorcycle and tricycle routing aren’t supported.
                  </p>
                  <p className="route-choice-reason">
                    {route.selection_reason || "Shortest reachable walking distance."}
                  </p>
                  {route.alternative_center?.evacuation_center?.id != null && (
                    <>
                      <button
                        type="button"
                        className="route-other-centers-toggle"
                        onClick={() => setOtherCentersOpen((open) => !open)}
                        aria-expanded={otherCentersOpen}
                      >
                        {otherCentersOpen ? "Hide other centers" : "Other centers"}
                      </button>
                      {otherCentersOpen && (
                        <RouteAlternativeCard
                          alternative={route.alternative_center}
                          rooms={rooms}
                          onSelect={() => handleFindRoute(route.alternative_center?.evacuation_center?.id)}
                        />
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Re-center button when user panned away during active navigation */}
      {navigationActive && isPannedAway && (
        <button
          type="button"
          className="nav-recenter-btn"
          onClick={handleRecenter}
          aria-label="Re-center map"
        >
          <FontAwesomeIcon icon={faLocationCrosshairs} />
          <span>Re-center</span>
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
      {routeError && (
        <div className={`toast-error ${showRoutePinOption ? "route-pin-error" : ""}`} role="alert">
          <span>{routeError}</span>
          {showRoutePinOption && (
            <button type="button" onClick={handlePickRouteStart}>Choose starting point on map</button>
          )}
        </div>
      )}
      {findSomeoneMapNotice && <div className="toast-error" role="status">{findSomeoneMapNotice}</div>}

      {/* Success */}
      {reportConfirmation && (
        <div className="toast-success">{reportConfirmation}</div>
      )}

      {/* My evacuation center verification */}
      {myCenterOpen && (
        <PublicMapDialogShell onClose={closeMyCenter} labelledBy="mc-title">
          <div
            className="mc-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mc-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mc-header">
              <h3 id="mc-title">My evacuation center</h3>
              <button type="button" className="mc-close" onClick={closeMyCenter} title="Close" aria-label="Close">
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            {myCenter ? (
              <div className="mc-body">
                <div className="mc-result">
                  <div className="mc-result-row">
                    <span>Evacuation center</span>
                    <strong>{myCenter.evacuation_center?.name}</strong>
                  </div>
                  {isLoggedInResident && myCenter.room && (
                    <>
                      {myCenter.room.building_name && (
                        <div className="mc-result-row">
                          <span>Building</span>
                          <strong>{myCenter.room.building_name}</strong>
                        </div>
                      )}
                      {myCenter.room.room_number && (
                        <div className="mc-result-row">
                          <span>Assigned room</span>
                          <strong>{myCenter.room.room_number}</strong>
                        </div>
                      )}
                    </>
                  )}
                </div>
                {lookupError && <div className="mc-error" role="status">{lookupError}</div>}
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
                  {!isLoggedInResident && (
                    <button
                      type="button"
                      className="mc-btn"
                      onClick={() => {
                        setMyCenter(null);
                        setLookupName("");
                        setLookupBarangayId("");
                        setLookupBirthdate("");
                        setLookupError("");
                      }}
                    >
                      Search again
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <form className="mc-body" onSubmit={handleLookupSubmit} noValidate>
                <p className="mc-hint">
                  Enter the family head's full name, barangay, and birthdate.
                </p>

                <label className="mc-label" htmlFor="mc-name">Family head's full name</label>
                <input
                  id="mc-name"
                  type="text"
                  className="mc-input"
                  value={lookupName}
                  onChange={(event) => {
                    setLookupName(event.target.value);
                    setLookupError("");
                  }}
                  placeholder="Full name"
                  autoComplete="name"
                  required
                  autoFocus
                />

                <label className="mc-label" htmlFor="mc-barangay">Barangay</label>
                <select
                  id="mc-barangay"
                  className="mc-input"
                  value={lookupBarangayId}
                  onChange={(event) => {
                    setLookupBarangayId(event.target.value);
                    setLookupError("");
                  }}
                  required
                >
                  <option value="">Select barangay</option>
                  {lookupBarangays.map((barangay) => (
                    <option key={barangay.id} value={barangay.id}>{barangay.name}</option>
                  ))}
                </select>

                <label className="mc-label" htmlFor="mc-birthdate">Birthdate</label>
                <input
                  id="mc-birthdate"
                  type="date"
                  className="mc-input"
                  value={lookupBirthdate}
                  onChange={(event) => {
                    setLookupBirthdate(event.target.value);
                    setLookupError("");
                  }}
                  required
                />

                {lookupError && <div className="mc-error" role="status">{lookupError}</div>}
                <div className="mc-actions">
                  <button type="submit" className="mc-btn mc-btn-primary" disabled={lookupLoading}>
                    <FontAwesomeIcon icon={faMagnifyingGlass} spin={lookupLoading} />
                    {lookupLoading ? "Checking..." : "Find my center"}
                  </button>
                  <button type="button" className="mc-btn" onClick={closeMyCenter}>Cancel</button>
                </div>
              </form>
            )}
          </div>
        </PublicMapDialogShell>
      )}

      {/* Find someone: resident access only */}
      {findSomeonePrivacyPromptOpen && isLoggedInResident && (
        <PublicMapDialogShell
          onClose={() => setFindSomeonePrivacyPromptOpen(false)}
          labelledBy="find-someone-prompt-title"
        >
          <div
            className="mc-modal find-someone-prompt"
            role="dialog"
            aria-modal="true"
            aria-labelledby="find-someone-prompt-title"
          >
            <div className="mc-header">
              <h3 id="find-someone-prompt-title">Family search preference</h3>
              <button
                type="button"
                className="mc-close"
                onClick={() => setFindSomeonePrivacyPromptOpen(false)}
                aria-label="Close"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
            <div className="mc-body">
              <p className="mc-hint">Let others find my family's evacuation center?</p>
              <fieldset className="find-someone-prompt-options">
                <legend>Choose Yes or No. No is selected by default.</legend>
                <label>
                  <input
                    type="radio"
                    name="family-searchable-first-login"
                    checked={findSomeonePromptChoice}
                    onChange={() => setFindSomeonePromptChoice(true)}
                  />
                  <span>Yes</span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="family-searchable-first-login"
                    checked={!findSomeonePromptChoice}
                    onChange={() => setFindSomeonePromptChoice(false)}
                  />
                  <span>No</span>
                </label>
              </fieldset>
              <p className="mc-hint find-someone-prompt-note">
                If you choose Yes, other signed-in residents can search with the family member's full name and barangay.
              </p>
              {findSomeonePrivacyError && (
                <div className="mc-error" role="alert">{findSomeonePrivacyError}</div>
              )}
              <div className="mc-actions">
                <button
                  type="button"
                  className="mc-btn mc-btn-primary"
                  disabled={findSomeonePrivacySaving}
                  onClick={saveFindSomeonePromptChoice}
                >
                  {findSomeonePrivacySaving ? "Saving..." : "Save choice"}
                </button>
              </div>
            </div>
          </div>
        </PublicMapDialogShell>
      )}

      {findSomeoneOpen && isLoggedInResident && (
        <PublicMapDialogShell onClose={closeFindSomeone} labelledBy="fs-modal-title">
          <div
            className="mc-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="fs-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mc-header">
              <h3 id="fs-modal-title">Find someone</h3>
              <button type="button" className="mc-close" onClick={closeFindSomeone} title="Close" aria-label="Close">
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            <div className="mc-body">
              <p className="mc-hint">
                Enter the full name and barangay. Only the evacuation center is shown.
              </p>
              <form onSubmit={handleFindSomeoneSubmit}>
                <label className="mc-label" htmlFor="fs-name">Full name</label>
                <input
                  id="fs-name"
                  type="text"
                  className="mc-input"
                  value={findSomeoneName}
                  onChange={(event) => {
                    setFindSomeoneName(event.target.value);
                    if (findSomeoneHint) setFindSomeoneHint("");
                  }}
                  placeholder="Full name"
                  autoComplete="off"
                  autoFocus
                />
                <label className="mc-label" htmlFor="fs-barangay">Barangay</label>
                <select
                  id="fs-barangay"
                  className="mc-input"
                  value={findSomeoneBarangayId}
                  disabled={findSomeoneBarangaysLoading}
                  onChange={(event) => {
                    setFindSomeoneBarangayId(event.target.value);
                    if (findSomeoneHint) setFindSomeoneHint("");
                  }}
                  required
                >
                  <option value="">{findSomeoneBarangaysLoading ? "Loading barangays..." : "Select a barangay"}</option>
                  {findSomeoneBarangays.map((barangay) => (
                    <option key={barangay.id} value={barangay.id}>{barangay.name}</option>
                  ))}
                </select>
                <label className="mc-label" htmlFor="fs-additional-detail">Purok or additional detail (optional)</label>
                <input
                  id="fs-additional-detail"
                  type="text"
                  className="mc-input"
                  value={findSomeoneAdditionalDetail}
                  onChange={(event) => {
                    setFindSomeoneAdditionalDetail(event.target.value);
                    if (findSomeoneHint) setFindSomeoneHint("");
                  }}
                  placeholder="For example, Purok 4"
                  autoComplete="off"
                  maxLength={100}
                />
                {findSomeoneHint && (
                  <div className="mc-error" role="status" style={{ marginTop: "8px" }}>
                    {findSomeoneHint}
                  </div>
                )}
                <div className="mc-actions find-someone-actions">
                  <button type="submit" className="mc-btn mc-btn-primary" disabled={findSomeoneLoading}>
                    <FontAwesomeIcon icon={faMagnifyingGlass} spin={findSomeoneLoading} />
                    {findSomeoneLoading ? "Searching..." : "Search"}
                  </button>
                  <button type="button" className="mc-btn find-someone-cancel-btn" onClick={closeFindSomeone}>
                    Cancel
                  </button>
                </div>
              </form>

              {findSomeoneSearched && !findSomeoneLoading && (
                findSomeoneResults.length > 0 ? (
                  <div className="find-someone-results">
                    <div className="find-someone-count">
                      Evacuation center
                    </div>
                    {findSomeoneResults.map((item, index) => (
                      <div key={`${item.center_name}-${index}`} className="find-someone-card">
                        <div className="find-someone-info">
                          <div className="find-someone-name">{item.center_name}</div>
                        </div>
                        <button
                          type="button"
                          className="find-someone-view-btn"
                          onClick={() => handleViewPersonCenterOnMap(item)}
                        >
                          View on map
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="find-someone-empty">
                    No match found. Check the full name and barangay, or add a purok detail and try again.
                  </div>
                )
              )}
            </div>
          </div>
        </PublicMapDialogShell>
      )}

      {/* Deep-link / notification opening a saved hazard report */}
      {/* Rescue Alert Modal */}
      {rescueAlertOpen && (
        <RescueAlertModal
          onClose={handleCloseRescueModal}
          onSubmitted={handleRescueSubmitted}
          initialCoordinates={rescueCoordinates || myLocation}
          onPinOnMap={handlePinRescueOnMap}
          onLocationCaptured={handleRescueLocationCaptured}
          isLocationAllowed={(location) => isInsideSogodBoundary([
            Number(location.lng ?? location.longitude),
            Number(location.lat ?? location.latitude),
          ], sogodBoundaryRef.current)}
          onOpenLogin={openLoginDialog}
          onOpenSignUp={openSignUpDialog}
        />
      )}

      {/* Hazard Report Modal */}
      {pendingReportLocation && (
        <HazardReportModal
          location={pendingReportLocation}
          initialSuggestedRoad={pendingSuggestedRoad}
          onClose={handleCloseReportModal}
          onSubmitted={handleReportSubmitted}
          onLocationChange={handleReportLocationChange}
          onAdjustOnMap={handleAdjustHazardOnMap}
          isLocationAllowed={(location) => isInsideSogodBoundary([location.lng, location.lat], sogodBoundaryRef.current)}
        />
      )}


      {/* Building Details Modal (independent of center card) */}
      <BuildingDetailsModal
        isOpen={buildingModalOpen}
        buildingId={selectedBuildingId}
        initialBuildingData={selectedBuildingData}
        onClose={() => {
          setBuildingModalOpen(false);
          clearFoundPersonLocation();
          setPrivateBuildingView(false);
        }}
        highlightedRoom={foundPersonLocation?.buildingId != null ? foundPersonLocation.room : null}
        hideHouseholds={privateBuildingView}
        usePublicMapShell
        isStaff={false}
      />

      {/* Login and Resident Sign-Up Dialogs */}
      <LoginDialog
        dialogRef={loginDialogRef}
        usePublicMapShell
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
        usePublicMapShell
        isOpen={signUpOpen}
        onClose={() => setSignUpOpen(false)}
        onOpenLogin={() => openLoginDialog()}
      />

    </div>
  );
};

export default ResidentHome;

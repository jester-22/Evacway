import { useState, useEffect, useRef, useMemo } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

import { Link } from "react-router-dom";
import { api, BASE_URL } from "../../services/api";
import HazardReportModal from "../../components/HazardReportModal";
import RescueAlertModal from "../../components/RescueAlertModal";
import { MapLegend } from "../../components/MapOverlays";
import { createReportPopup } from "../../components/mapReports";
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
  faPersonWalking,
  faXmark,
  faSliders,
  faUser,
  faCircleCheck,
  faMagnifyingGlass,
  faBuildingColumns,
  faDoorOpen,
  faChevronRight,
  faArrowUp,
  faTriangleExclamation,
  faBan,
  faLayerGroup,
  faEllipsis,
  faCircle,
  faCircleQuestion,
} from "@fortawesome/free-solid-svg-icons";

import "../../components_css/MyLocationMarker.css";
import "../../components_css/MapOverlays.css";
import "./ResidentHome.css";
import "./ResidentHome.motion.css";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const SOGOD_CENTER = [10.435, 124.996];

const SOGOD_BOUNDS = [
  [10.35, 124.89],
  [10.56, 125.11],
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
// Get center point of evacuation building polygon
// --------------------------------------------------

function getGeometryCenter(geometry) {
  if (!geometry || !geometry.coordinates) {
    return null;
  }

  if (
    geometry.type === "Polygon" &&
    Array.isArray(geometry.coordinates[0])
  ) {
    const ring = geometry.coordinates[0];

    if (!ring.length) {
      return null;
    }

    let totalLng = 0;
    let totalLat = 0;
    let count = 0;

    ring.forEach((coordinate) => {
      const valid = getValidCoordinates(coordinate);

      if (valid) {
        totalLng += valid[0];
        totalLat += valid[1];
        count++;
      }
    });

    if (count === 0) {
      return null;
    }

    return [totalLng / count, totalLat / count];
  }

  if (geometry.type === "MultiPolygon") {
    let totalLng = 0;
    let totalLat = 0;
    let count = 0;

    geometry.coordinates.forEach((polygon) => {
      if (!Array.isArray(polygon) || !Array.isArray(polygon[0])) {
        return;
      }

      polygon[0].forEach((coordinate) => {
        const valid = getValidCoordinates(coordinate);

        if (valid) {
          totalLng += valid[0];
          totalLat += valid[1];
          count++;
        }
      });
    });

    if (count === 0) {
      return null;
    }

    return [totalLng / count, totalLat / count];
  }

  if (geometry.type === "Point") {
    return getValidCoordinates(geometry.coordinates);
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

  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const flowFrameRef = useRef(null);

  const hazardMarkersRef = useRef([]);
  const evacuationMarkersRef = useRef([]);
  const entranceMarkersRef = useRef([]);
  const roomMarkersRef = useRef([]);
  const routeMarkersRef = useRef([]);

  const [mapLoaded, setMapLoaded] = useState(false);
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
    visibleLayers,
    setVisibleLayers,
    filteredHazardZones
  } = useHazardData(PUBLIC_MAP_QUERY_OPTIONS);

  const {
    evacCenters,
    rooms
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

  const [layersOpen, setLayersOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const [showCentersLayer, setShowCentersLayer] = useState(true);
  const [showHazardsLayer, setShowHazardsLayer] = useState(true);
  const [showClosedRoadsLayer, setShowClosedRoadsLayer] = useState(true);

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

  // --------------------------------------------------
  // "My evacuation center" (name verification)
  // --------------------------------------------------

  const [myCenter, setMyCenter] = useState(null);
  const [myCenterOpen, setMyCenterOpen] = useState(false);
  const [lookupName, setLookupName] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [lookupMatches, setLookupMatches] = useState([]);

  // --------------------------------------------------
  // Search (evacuation centers + barangays)
  // --------------------------------------------------

  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);

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
  // details closes More / Help / Layers / Legend.
  // --------------------------------------------------

  useEffect(() => {
    if (selectedCenter) {
      setMoreMenuOpen(false);
      setHelpOpen(false);
      setLayersOpen(false);
      setLegendOpen(false);
    }
  }, [selectedCenter]);

  // Escape closes any open sheet
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key !== "Escape") return;
      setMoreMenuOpen(false);
      setHelpOpen(false);
      setLayersOpen(false);
      setLegendOpen(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    routeDataRef.current = route;
  }, [route]);

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
        setLayersOpen(false);
        setLegendOpen(false);
        setMoreMenuOpen(false);
        setShowSearchResults(false);
        if (selectedCenter) setSelectedCenter(null);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedCenter]);

  // Toggle Evacuation Centers layer visibility
  useEffect(() => {
    const map = mapRef.current;
    evacuationMarkersRef.current.forEach((marker) => {
      const el = marker.getElement();
      if (el) el.style.display = showCentersLayer ? "" : "none";
    });
    entranceMarkersRef.current.forEach((marker) => {
      const el = marker.getElement();
      if (el) el.style.display = showCentersLayer ? "" : "none";
    });
    if (map && mapLoaded && map.isStyleLoaded()) {
      try {
        if (map.getLayer("evacuation-centers-fill")) {
          map.setLayoutProperty(
            "evacuation-centers-fill",
            "visibility",
            showCentersLayer ? "visible" : "none"
          );
        }
        if (map.getLayer("evacuation-centers-line")) {
          map.setLayoutProperty(
            "evacuation-centers-line",
            "visibility",
            showCentersLayer ? "visible" : "none"
          );
        }
      } catch (e) { }
    }
  }, [showCentersLayer, mapLoaded]);

  // Toggle Hazards layer visibility
  useEffect(() => {
    const map = mapRef.current;
    hazardMarkersRef.current.forEach((marker) => {
      const el = marker.getElement();
      if (el) el.style.display = showHazardsLayer ? "" : "none";
    });
    if (map && mapLoaded && map.isStyleLoaded()) {
      try {
        [
          "resident-hazard-fill",
          "resident-hazard-outline",
          "resident-hazard-labels",
        ].forEach((layerId) => {
          if (map.getLayer(layerId)) {
            map.setLayoutProperty(
              layerId,
              "visibility",
              showHazardsLayer ? "visible" : "none"
            );
          }
        });
      } catch (e) { }
    }
  }, [showHazardsLayer, mapLoaded]);

  // Toggle Closed Roads layer filter
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !map.isStyleLoaded()) return;
    try {
      if (map.getLayer("roads-layer")) {
        map.setFilter(
          "roads-layer",
          showClosedRoadsLayer ? null : ["!=", ["get", "is_closed"], true]
        );
      }
    } catch (e) { }
  }, [showClosedRoadsLayer, mapLoaded]);

  // --------------------------------------------------
  // Load remaining data
  // --------------------------------------------------

  // Display interactive hazard-zone outlines for the selected map layers.
  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded || !filteredHazardZones || !map.isStyleLoaded()) return;

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
  }, [filteredHazardZones, mapLoaded, pickingLocation, mapStyle]);

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
  // Restore the resident saved on this device
  // (re-checked so a changed assignment is picked up)
  // --------------------------------------------------

  useEffect(() => {
    const saved = readSavedResident();

    if (!saved?.name) {
      return;
    }

    api
      .findMyEvacuationCenter(saved.name)
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
  // Check location permission
  // --------------------------------------------------

  useEffect(() => {
    if (!navigator.permissions) {
      return;
    }

    navigator.permissions
      .query({
        name: "geolocation",
      })
      .then((result) => {
        const updatePermission = () => {
          setLocationPermission(
            result.state === "granted"
              ? "granted"
              : result.state === "denied"
                ? "denied"
                : "unknown"
          );
        };

        updatePermission();

        result.onchange = updatePermission;
      })
      .catch(() => { });
  }, []);

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

      minZoom: 1,
      maxZoom: 18,

      attributionControl: true,

      projection: "mercator",
    });

    mapRef.current = map;

    // Restrict map to Sogod area
    map.setMaxBounds([
      [SOGOD_BOUNDS[0][1], SOGOD_BOUNDS[0][0]],
      [SOGOD_BOUNDS[1][1], SOGOD_BOUNDS[1][0]],
    ]);

    map.on("load", () => setMapLoaded(true));

    map.on("style.load", () => {
      setMapLoaded(true);
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
    const map = mapRef.current;

    if (!map || !mapLoaded || !map.isStyleLoaded()) return;

    try {
      if (map.getLayer("evacway-buildings")) return;

      map.addLayer({
        id: "evacway-buildings",
        type: "fill",
        source: "composite",
        "source-layer": "building",
        minzoom: 12,
        paint: {
          "fill-color": "#d6d3d1",
          "fill-opacity": 0.65,
          "fill-outline-color": "#b8b5b2",
        },
      });
    } catch (err) {
      console.warn("Error adding evacway buildings:", err);
    }
  }, [mapLoaded, mapStyle]);

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

    if (!map || !mapLoaded || !map.isStyleLoaded()) {
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
  }, [roads, hazardReports, mapLoaded, mapStyle]);

  // --------------------------------------------------
  // Add Sogod boundary
  // (source created once, updated via setData afterwards)
  // --------------------------------------------------

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded || !map.isStyleLoaded()) {
      return;
    }

    const sourceId = "sogod-boundary";
    const layerId = "sogod-boundary-line";

    const data = sogodBoundary || EMPTY_FEATURE_COLLECTION;

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
            "line-color": "#1e3a8a",
            "line-width": 2,
            "line-dasharray": [6, 4],
          },
        });
      }
    } catch (err) {
      console.warn("Error updating sogod boundary layer:", err);
    }
  }, [sogodBoundary, mapLoaded, mapStyle]);

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

    if (!map || !mapLoaded || !evacCenters || !map.isStyleLoaded()) {
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
      } else {
        map.addSource(sourceId, {
          type: "geojson",
          data,
        });

        map.addLayer({
          id: fillLayerId,
          type: "fill",
          source: sourceId,

          paint: {
            "fill-color": "#2563eb",
            "fill-opacity": 0.25,
          },
        });

        map.addLayer({
          id: lineLayerId,
          type: "line",
          source: sourceId,

          paint: {
            "line-color": "#1d4ed8",
            "line-width": 3,
            "line-opacity": 0.9,
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
      const feature = e.features?.[0];

      if (!feature) {
        return;
      }

      setSelectedCenter(feature);
    };

    try {
      map.on("click", fillLayerId, handleEvacCenterClick);
      map.on("mouseenter", fillLayerId, handleMouseEnter);
      map.on("mouseleave", fillLayerId, handleMouseLeave);
    } catch (e) { }

    validFeatures.forEach((center) => {
      const properties = center.properties || {};

      if (!Array.isArray(properties.entrances)) {
        return;
      }

      properties.entrances.forEach((entrance) => {
        if (!entrance) {
          return;
        }

        const entranceCoordinates = getValidCoordinates([
          entrance.lng ?? entrance.longitude,
          entrance.lat ?? entrance.latitude,
        ]);

        if (!entranceCoordinates) {
          console.warn(
            "Skipping invalid evacuation center entrance:",
            entrance
          );

          return;
        }

        const entranceElement = createSimpleMarker(
          "evacuation-entrance-marker"
        );
        entranceElement.style.visibility = "hidden";

        const entranceLabel = document.createElement("span");
        entranceLabel.className = "evacuation-entrance-label";
        entranceLabel.textContent = "Entrance";
        entranceElement.appendChild(entranceLabel);

        const entrancePopup = new mapboxgl.Popup({
          offset: 8,
        }).setText(`Entrance - ${properties.name || "Evacuation Center"}`);

        const entranceMarker = new mapboxgl.Marker({
          element: entranceElement,
          anchor: "center",
        })
          .setLngLat(entranceCoordinates)
          .setPopup(entrancePopup)
          .addTo(map);

        entranceMarkersRef.current.push(entranceMarker);
      });
    });

    const updateEntranceVisibility = () => {
      try {
        const visible = map.getZoom() >= ROOM_MIN_ZOOM;

        entranceMarkersRef.current.forEach((marker) => {
          marker.getElement().style.visibility = visible ? "visible" : "hidden";
        });
      } catch (e) { }
    };

    updateEntranceVisibility();
    try {
      map.on("zoomend", updateEntranceVisibility);
    } catch (e) { }

    return () => {
      try {
        map.off("click", fillLayerId, handleEvacCenterClick);
        map.off("mouseenter", fillLayerId, handleMouseEnter);
        map.off("mouseleave", fillLayerId, handleMouseLeave);
        map.off("zoomend", updateEntranceVisibility);
      } catch (e) { }
    };
  }, [evacCenters, mapLoaded, mapStyle]);

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
        const properties = center.properties || {};

        const coordinates =
          getGeometryCenter(center.geometry) ??
          getValidCoordinates([
            properties.longitude ?? properties.lng,
            properties.latitude ?? properties.lat,
          ]);

        if (!coordinates) {
          return;
        }

        const isMine =
          myCenterId != null && String(properties.id) === String(myCenterId);

        const element = document.createElement("div");

        element.className = `evacway-center-marker${isMine ? " evacway-center-marker-mine" : ""
          }`;

        const iconElement = document.createElement("span");
        iconElement.className = "evacway-center-icon";
        iconElement.innerHTML = icon(faBuildingColumns).html.join("");

        const label = document.createElement("span");
        label.className = "evacway-center-label";
        label.textContent = properties.name || "Evacuation Center";

        element.appendChild(iconElement);
        element.appendChild(label);

        if (isMine) {
          const tag = document.createElement("span");
          tag.className = "evacway-center-tag";
          tag.textContent = "Your center";
          element.appendChild(tag);
        }

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

    map.on("zoomend", showCenterMarkers);

    return () => {
      map.off("zoomend", showCenterMarkers);

      removeCenterMarkers();
    };
  }, [evacCenters, mapLoaded, myCenter]);

  // --------------------------------------------------
  // Room ICONS (zoomed in)
  // --------------------------------------------------

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded) {
      return;
    }

    const myRoomId = myCenter?.room?.id;

    function removeRoomMarkers() {
      roomMarkersRef.current.forEach((marker) => marker.remove());

      roomMarkersRef.current = [];
    }

    function showRoomMarkers() {
      removeRoomMarkers();

      if (map.getZoom() < ROOM_MIN_ZOOM) {
        return;
      }

      rooms.forEach((room) => {
        // Rooms not mapped yet have no coordinates
        if (room.latitude == null || room.longitude == null) {
          return;
        }

        const coordinates = getValidCoordinates([
          room.longitude,
          room.latitude,
        ]);

        if (!coordinates) {
          return;
        }

        const isMine =
          myRoomId != null && String(room.id) === String(myRoomId);

        const element = document.createElement("div");

        element.className = `evacway-room-marker${isMine ? " evacway-room-marker-mine" : ""
          }`;

        const iconElement = document.createElement("span");
        iconElement.className = "evacway-room-icon";
        iconElement.innerHTML = icon(faDoorOpen).html.join("");

        const label = document.createElement("span");
        label.className = "evacway-room-label";
        label.textContent = room.room_number || "Room";

        element.appendChild(iconElement);
        element.appendChild(label);

        const popup = new mapboxgl.Popup({
          offset: 12,
        }).setDOMContent(createRoomPopup(room, isMine));

        const marker = new mapboxgl.Marker({
          element,
          anchor: "bottom",
        })
          .setLngLat(coordinates)
          .setPopup(popup)
          .addTo(map);

        roomMarkersRef.current.push(marker);
      });
    }

    showRoomMarkers();

    map.on("zoomend", showRoomMarkers);

    return () => {
      map.off("zoomend", showRoomMarkers);

      removeRoomMarkers();
    };
  }, [rooms, mapLoaded, myCenter]);

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

    if (oldMarker) {
      oldMarker.remove();

      routeMarkersRef.current = routeMarkersRef.current.filter(
        (marker) => marker !== oldMarker
      );
    }

    const markerElement = createMyLocationMarker();

    const popup = new mapboxgl.Popup({
      offset: 12,
    }).setText("You are here");

    const marker = new mapboxgl.Marker({
      element: markerElement,
      anchor: "center",
    })
      .setLngLat(userCoordinates)
      .setPopup(popup)
      .addTo(map);

    marker.__isUserMarker = true;

    routeMarkersRef.current.push(marker);

    setOrUpdateAccuracyCircle(
      map,
      userCoordinates[0],
      userCoordinates[1],
      myLocation.accuracy || 30
    );
  }, [myLocation, mapLoaded]);

  // --------------------------------------------------
  // Draw evacuation route
  // --------------------------------------------------

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded || !map.isStyleLoaded()) {
      return;
    }

    const sourceId = "evacuation-route";
    const layerId = "evacuation-route-line";
    const flowLayerId = "evacuation-route-flow";

    cancelAnimationFrame(flowFrameRef.current);
    flowFrameRef.current = null;

    try {
      if (map.getLayer(flowLayerId)) {
        map.removeLayer(flowLayerId);
      }

      if (map.getLayer(layerId)) {
        map.removeLayer(layerId);
      }

      if (map.getSource(sourceId)) {
        map.removeSource(sourceId);
      }
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
          "line-width": 5,
          "line-opacity": 0.9,
        },
      });
    } catch (err) {
      console.warn("Error drawing route layer:", err);
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

    try {
      map.addLayer({
        id: flowLayerId,
        type: "line",
        source: sourceId,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#ffffff",
          "line-width": 2,
          "line-opacity": 0.85,
          "line-dasharray": [0, 4, 3],
        },
      });
    } catch (err) {
      console.warn("Error adding route flow layer:", err);
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

    if (coordinates.length > 0) {
      const bounds = new mapboxgl.LngLatBounds();

      coordinates.forEach((coordinate) => {
        bounds.extend(coordinate);
      });

      map.fitBounds(bounds, {
        padding: 80,
        duration: 1000,
        maxZoom: 16,
      });
    }

    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const sequence = [
        [0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5],
        [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0], [0, 0.5, 3, 3.5],
        [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2],
        [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5],
      ];
      let lastFrame = -1;

      const animateRoute = (timestamp) => {
        try {
          if (mapRef.current !== map || !map.isStyleLoaded() || !map.getLayer(flowLayerId)) {
            flowFrameRef.current = null;
            return;
          }

          const frame = Math.floor(timestamp / 60) % sequence.length;
          if (frame !== lastFrame) {
            map.setPaintProperty(flowLayerId, "line-dasharray", sequence[frame]);
            lastFrame = frame;
          }

          flowFrameRef.current = requestAnimationFrame(animateRoute);
        } catch (e) {
          flowFrameRef.current = null;
        }
      };

      flowFrameRef.current = requestAnimationFrame(animateRoute);
    }

    return () => {
      cancelAnimationFrame(flowFrameRef.current);
      flowFrameRef.current = null;
      try {
        if (map.isStyleLoaded() && map.getLayer(flowLayerId)) {
          map.removeLayer(flowLayerId);
        }
      } catch (err) {
        // ignore
      }
    };
  }, [route, mapLoaded, mapStyle]);

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
      () => {
        setLocationPermission("granted");
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

          setMyLocation({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          });

          setRouteIsMine(
            myCenter?.evacuation_center?.id != null &&
            String(assignedCenterId) === String(myCenter.evacuation_center.id)
          );

          let routeToDisplay = result;
          if (result.evacuation_center) {
            try {
              routeToDisplay = {
                ...result,
                ...(await getWalkingDirections(
                  [pos.coords.latitude, pos.coords.longitude],
                  result.evacuation_center
                )),
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

          routeDataRef.current = routeToDisplay;
          setRoute(routeToDisplay);
          activeWalkingStepRef.current = 0;
          setActiveWalkingStep(0);
          setNavigationRemainingMeters(routeToDisplay.walking_distance_meters ?? null);
          setNavigationRemainingSeconds(routeToDisplay.walking_duration_seconds ?? null);

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

  function stopWalkingNavigation(status = "Navigation stopped.") {
    navigationActiveRef.current = false;
    setNavigationActive(false);
    setNavigationStatus(status);

    if (navigationWatchIdRef.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(navigationWatchIdRef.current);
      navigationWatchIdRef.current = null;
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
    }

    setRouteError("");
    navigationActiveRef.current = true;
    setNavigationActive(true);
    setNavigationStatus("Waiting for GPS...");
    lastRerouteAtRef.current = 0;

    navigationWatchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        if (!navigationActiveRef.current) return;

        const location = [position.coords.latitude, position.coords.longitude];
        const accuracy = Math.round(position.coords.accuracy || 0);
        setMyLocation({ lat: location[0], lng: location[1] });
        setNavigationAccuracy(accuracy);
        setLocationPermission("granted");

        const map = mapRef.current;
        if (map) {
          map.easeTo({
            center: [location[1], location[0]],
            zoom: Math.max(map.getZoom(), 16),
            pitch: 40,
            bearing:
              Number.isFinite(position.coords.heading) && position.coords.heading >= 0
                ? position.coords.heading
                : map.getBearing(),
            duration: 500,
            essential: true,
          });
        }

        const latestRoute = routeDataRef.current || currentRoute;
        const target = latestRoute?.evacuation_center || destination;
        const targetCoordinates = getValidCoordinates([
          target.longitude ?? target.lng,
          target.latitude ?? target.lat,
        ]);

        if (targetCoordinates) {
          const targetLatLng = [targetCoordinates[1], targetCoordinates[0]];
          if (getDistanceMeters(location, targetLatLng) <= 25) {
            setNavigationRemainingMeters(0);
            setNavigationRemainingSeconds(0);
            stopWalkingNavigation("Arrived at the evacuation center.");
            return;
          }
        }

        const steps = latestRoute?.walking_steps || [];
        let closestStep = activeWalkingStepRef.current;
        let closestDistance = Infinity;
        steps.forEach((step, index) => {
          if (index < activeWalkingStepRef.current) return;
          const maneuver = step.maneuver?.location;
          if (!Array.isArray(maneuver)) return;

          const distance = getDistanceMeters(location, [maneuver[1], maneuver[0]]);
          if (distance < closestDistance) {
            closestDistance = distance;
            closestStep = index;
          }
        });

        if (steps.length > 0) {
          activeWalkingStepRef.current = closestStep;
          setActiveWalkingStep(closestStep);
          const remainingSteps = steps.slice(closestStep);
          setNavigationRemainingMeters(
            remainingSteps.reduce((total, step) => total + Number(step.distance || 0), 0)
          );
          setNavigationRemainingSeconds(
            remainingSteps.reduce((total, step) => total + Number(step.duration || 0), 0)
          );
          setNavigationStatus(
            steps[closestStep]?.maneuver?.instruction || "Continue along the route."
          );
        } else {
          setNavigationStatus("Follow the highlighted route to the center.");
        }

        const offRouteDistance = getDistanceFromRoute(location, latestRoute?.route || []);
        const now = Date.now();
        if (
          offRouteDistance > 60 &&
          !reroutingRef.current &&
          now - lastRerouteAtRef.current > 15000
        ) {
          reroutingRef.current = true;
          lastRerouteAtRef.current = now;
          setNavigationStatus("Off route. Recalculating...");

          getWalkingDirections(location, target)
            .then((walkingDirections) => {
              const updatedRoute = { ...latestRoute, ...walkingDirections };
              routeDataRef.current = updatedRoute;
              setRoute(updatedRoute);
              activeWalkingStepRef.current = 0;
              setActiveWalkingStep(0);
              setNavigationRemainingMeters(walkingDirections.walking_distance_meters);
              setNavigationRemainingSeconds(walkingDirections.walking_duration_seconds);
            })
            .catch((error) => {
              setNavigationStatus(error.message || "Unable to recalculate route.");
            })
            .finally(() => {
              reroutingRef.current = false;
            });
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
    setRouteError("");

    cancelAnimationFrame(flowFrameRef.current);
    flowFrameRef.current = null;

    const map = mapRef.current;

    if (!map) {
      return;
    }

    try {
      if (map.isStyleLoaded()) {
        if (map.getLayer("evacuation-route-flow")) {
          map.removeLayer("evacuation-route-flow");
        }

        if (map.getLayer("evacuation-route-line")) {
          map.removeLayer("evacuation-route-line");
        }

        if (map.getSource("evacuation-route")) {
          map.removeSource("evacuation-route");
        }
      }
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
  // Search (evacuation centers + barangays)
  // --------------------------------------------------

  useEffect(() => {
    const query = searchText.trim();

    if (query.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    const timeout = setTimeout(async () => {
      setSearching(true);

      try {
        const results = [];

        /*
         * Search evacuation centers already loaded on the map
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
                  ? `Evacuation Center - ${barangay}`
                  : "Evacuation Center",
                feature: center,
              });
            }
          });
        }

        /*
         * Search barangays using Mapbox
         */
        const encodedQuery = encodeURIComponent(query);

        const centerLngLat = [SOGOD_CENTER[1], SOGOD_CENTER[0]];

        const bbox =
          `${SOGOD_BOUNDS[0][1]},${SOGOD_BOUNDS[0][0]},` +
          `${SOGOD_BOUNDS[1][1]},${SOGOD_BOUNDS[1][0]}`;

        const url =
          `https://api.mapbox.com/search/geocode/v6/forward` +
          `?q=${encodedQuery}` +
          `&proximity=${centerLngLat[0]},${centerLngLat[1]}` +
          `&bbox=${bbox}` +
          `&limit=5` +
          `&access_token=${mapboxgl.accessToken}`;

        const response = await fetch(url);

        if (response.ok) {
          const data = await response.json();

          const barangayResults = (data.features || [])
            .filter((feature) => {
              const name = feature.properties?.name || feature.text || "";

              return (
                /barangay/i.test(name) ||
                /barangay/i.test(feature.properties?.name_preferred || "")
              );
            })
            .map((feature) => ({
              type: "barangay",
              name:
                feature.properties?.name_preferred ||
                feature.properties?.name ||
                feature.text ||
                "Barangay",
              subtitle: "Barangay",
              center: feature.geometry?.coordinates,
              bbox: feature.bbox,
            }));

          results.push(...barangayResults);
        }

        setSearchResults(results.slice(0, 8));
      } catch (error) {
        console.error("Search error:", error);

        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);

    return () => clearTimeout(timeout);
  }, [searchText, evacCenters]);

  function zoomToSearchResult(result) {
    const map = mapRef.current;

    if (!map || !result) return;

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

  function handleRoomRowClick(room) {
    const map = mapRef.current;

    const lat = Number(room.latitude);
    const lng = Number(room.longitude);

    if (!map || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return;
    }

    setSelectedCenter(null);

    map.flyTo({
      center: [lng, lat],
      zoom: Math.max(map.getZoom(), ROOM_MIN_ZOOM + 1),
      duration: 900,
      essential: true,
    });
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

  // --------------------------------------------------
  // Render
  // --------------------------------------------------

  const firstName = myCenter?.household_head_name?.split(" ")[0] || "";
  const currentWalkingManeuver =
    route?.walking_steps?.[activeWalkingStep]?.maneuver || null;

  const activeHazardCount = hazardReports.length;
  const updatedTimeText = useMemo(() => {
    const timestamp = hazardReportsQuery.dataUpdatedAt || Date.now();
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }, [hazardReportsQuery.dataUpdatedAt]);

  const selectedCenterDistance = useMemo(() => {
    if (!myLocation || !selectedCenter) return null;
    const geomCenter = getGeometryCenter(selectedCenter.geometry);
    const props = selectedCenter.properties || {};
    const coords =
      geomCenter ||
      getValidCoordinates([
        props.longitude ?? props.lng,
        props.latitude ?? props.lat,
      ]);
    if (!coords) return null;
    const meters = getDistanceMeters([myLocation.lat, myLocation.lng], [coords[1], coords[0]]);
    if (!Number.isFinite(meters)) return null;
    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(1)} km away`;
    }
    return `${Math.round(meters)} m away`;
  }, [myLocation, selectedCenter]);

  // --------------------------------------------------
  // Sheets: only one open at a time
  // --------------------------------------------------

  function openSheet(name) {
    setLayersOpen(false);
    setLegendOpen(false);
    setMoreMenuOpen(name === "more");
    setHelpOpen(name === "help");

    if (selectedCenter) {
      closeCenterDetails();
    }
  }

  // --------------------------------------------------
  // Shared UI pieces (used by desktop popovers AND the
  // phone/tablet Help sheet)
  // --------------------------------------------------

  const statusChip = (
    <div
      className={`status-chip ${isMobile ? "compact" : ""}`}
      role="status"
      aria-live="polite"
    >
      <span
        className={`status-chip-dot ${activeHazardCount > 0 ? "has-hazards" : "all-clear"
          }`}
        aria-hidden="true"
      />
      <span>
        {isMobile
          ? activeHazardCount === 0
            ? "No danger reported right now"
            : `${activeHazardCount} ${activeHazardCount === 1 ? "danger" : "dangers"
            } reported nearby`
          : `${activeHazardCount} active ${activeHazardCount === 1 ? "hazard" : "hazards"
          } · Updated ${updatedTimeText}`}
      </span>
    </div>
  );

  const layerOptionsContent = (
    <>
      <div className="popover-section">
        <div className="popover-section-label">Hazard Zones</div>
        <button
          type="button"
          onClick={() => setVisibleLayers((v) => ({ ...v, flood: !v.flood }))}
          className={`layer-option-row ${visibleLayers.flood ? "active" : ""}`}
          aria-pressed={!!visibleLayers.flood}
        >
          <div className="layer-option-left">
            <FontAwesomeIcon icon={faWater} className="layer-icon-blue" />
            <span>Flood Zones</span>
          </div>
          <span className="layer-checkbox">{visibleLayers.flood ? "✓" : ""}</span>
        </button>

        <button
          type="button"
          onClick={() =>
            setVisibleLayers((v) => ({ ...v, landslide: !v.landslide }))
          }
          className={`layer-option-row ${visibleLayers.landslide ? "active" : ""}`}
          aria-pressed={!!visibleLayers.landslide}
        >
          <div className="layer-option-left">
            <FontAwesomeIcon icon={faMountain} className="layer-icon-amber" />
            <span>Landslide Zones</span>
          </div>
          <span className="layer-checkbox">{visibleLayers.landslide ? "✓" : ""}</span>
        </button>
      </div>

      <div className="popover-section">
        <div className="popover-section-label">Map View</div>
        <button
          type="button"
          onClick={() => handleMapStyleChange("street")}
          className={`layer-option-row ${mapStyle === "street" ? "active" : ""}`}
          aria-pressed={mapStyle === "street"}
        >
          <div className="layer-option-left">
            <FontAwesomeIcon icon={faMapPin} />
            <span>Street View</span>
          </div>
          <span className="layer-checkbox">{mapStyle === "street" ? "✓" : ""}</span>
        </button>

        <button
          type="button"
          onClick={() => handleMapStyleChange("satellite")}
          className={`layer-option-row ${mapStyle === "satellite" ? "active" : ""}`}
          aria-pressed={mapStyle === "satellite"}
        >
          <div className="layer-option-left">
            <FontAwesomeIcon icon={faSatelliteDish} />
            <span>Satellite</span>
          </div>
          <span className="layer-checkbox">{mapStyle === "satellite" ? "✓" : ""}</span>
        </button>
      </div>
    </>
  );

  const legendContent = (
    <div className="legend-groups">
      {/* Hazards */}
      <div className="legend-group">
        <div className="legend-group-title">Hazards</div>
        <div className="legend-item">
          <div className="legend-icon-wrapper hazard-flood">
            <FontAwesomeIcon icon={faWater} />
          </div>
          <span>Flood hazard</span>
        </div>
        <div className="legend-item">
          <div className="legend-icon-wrapper hazard-landslide">
            <FontAwesomeIcon icon={faMountain} />
          </div>
          <span>Landslide hazard</span>
        </div>
        <div className="legend-item">
          <div className="legend-icon-wrapper hazard-report">
            <FontAwesomeIcon icon={faTriangleExclamation} />
          </div>
          <span>Hazard report</span>
        </div>
      </div>

      {/* Roads */}
      <div className="legend-group">
        <div className="legend-group-title">Roads</div>
        <div className="legend-item">
          <div className="legend-icon-wrapper road-blocked">
            <FontAwesomeIcon icon={faBan} />
          </div>
          <span>Blocked road</span>
        </div>
        <div className="legend-item">
          <div className="legend-icon-wrapper road-closed">
            <span className="legend-line-closed" />
          </div>
          <span>Closed road</span>
        </div>
      </div>

      {/* Places */}
      <div className="legend-group">
        <div className="legend-group-title">Places</div>
        <div className="legend-item">
          <div className="legend-icon-wrapper place-center">
            <FontAwesomeIcon icon={faBuildingColumns} />
          </div>
          <span>Evacuation center</span>
        </div>
        <div className="legend-item">
          <div className="legend-icon-wrapper place-room">
            <FontAwesomeIcon icon={faDoorOpen} />
          </div>
          <span>Room</span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="resident-home">
      {/* Mapbox map */}
      <div ref={mapContainerRef} className="map-container" />

      {/* Header (slim 48px bar on phones) */}
      <header className="top-bar">
        <div className="brand">EvacWay</div>

        <div className="top-bar-actions">
          <Link
            to="/"
            className="home-ghost-btn"
            aria-label="Go to home page"
            title="Home"
          >
            <FontAwesomeIcon icon={faHome} />
            <span className="home-ghost-label">Home</span>
          </Link>
        </div>
      </header>

      {/* Desktop: status chip centered under the header */}
      {!isMobile && statusChip}

      {/* Top area: search (+ status chip on phones/tablets, filter chips on desktop) */}
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
              setSearchText(e.target.value);
              setShowSearchResults(true);
            }}
            onFocus={() => {
              if (searchResults.length > 0) {
                setShowSearchResults(true);
              }
            }}
            placeholder="Search centers or barangays"
            className="resident-search-input"
            aria-label="Search centers or barangays"
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
              No evacuation center or barangay found.
            </div>
          )}

        {isMobile ? (
          statusChip
        ) : (
          /* Desktop: horizontally scrollable filter chips */
          <div className="filter-chips-row" role="toolbar" aria-label="Map layer filters">
            <button
              type="button"
              className={`filter-chip ${showCentersLayer ? "active" : ""}`}
              onClick={() => setShowCentersLayer((prev) => !prev)}
              aria-pressed={showCentersLayer}
            >
              <FontAwesomeIcon icon={faBuildingColumns} />
              <span>Evacuation Centers</span>
            </button>

            <button
              type="button"
              className={`filter-chip ${showHazardsLayer ? "active" : ""}`}
              onClick={() => setShowHazardsLayer((prev) => !prev)}
              aria-pressed={showHazardsLayer}
            >
              <FontAwesomeIcon icon={faTriangleExclamation} />
              <span>Hazards</span>
            </button>

            <button
              type="button"
              className={`filter-chip ${showClosedRoadsLayer ? "active" : ""}`}
              onClick={() => setShowClosedRoadsLayer((prev) => !prev)}
              aria-pressed={showClosedRoadsLayer}
            >
              <FontAwesomeIcon icon={faBan} />
              <span>Closed Roads</span>
            </button>
          </div>
        )}
      </div>

      {/* Right control stack.
          Phones/tablets: only "My location" + "Help", sitting above the dock.
          Desktop: Locate, Layers, Legend. */}
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

        {isMobile ? (
          <button
            type="button"
            onClick={() => (helpOpen ? setHelpOpen(false) : openSheet("help"))}
            className={`control-stack-btn ${helpOpen ? "active" : ""}`}
            title="Help and map key"
            aria-label="Help"
            aria-expanded={helpOpen}
          >
            <FontAwesomeIcon icon={faCircleQuestion} />
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                setLayersOpen((prev) => !prev);
                setLegendOpen(false);
              }}
              className={`control-stack-btn ${layersOpen ? "active" : ""}`}
              title="Map layers & view"
              aria-label="Layers"
              aria-expanded={layersOpen}
            >
              <FontAwesomeIcon icon={faLayerGroup} />
            </button>

            <button
              type="button"
              onClick={() => {
                setLegendOpen((prev) => !prev);
                setLayersOpen(false);
              }}
              className={`control-stack-btn ${legendOpen ? "active" : ""}`}
              title="Map key & legend"
              aria-label="Legend"
              aria-expanded={legendOpen}
            >
              <FontAwesomeIcon icon={faMapPin} />
            </button>
          </>
        )}
      </div>

      {/* Desktop: Layers popover */}
      {layersOpen && !isMobile && (
        <div className="layers-popover" role="dialog" aria-label="Map Layers">
          <div className="popover-header">
            <h4>Map Layers</h4>
            <button
              type="button"
              className="popover-close-btn"
              onClick={() => setLayersOpen(false)}
              aria-label="Close layers"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>

          {layerOptionsContent}
        </div>
      )}

      {/* Desktop: Legend popover */}
      {legendOpen && !isMobile && (
        <div className="legend-popover" role="dialog" aria-label="Map Legend">
          <div className="popover-header">
            <h4>Map Legend</h4>
            <button
              type="button"
              className="popover-close-btn"
              onClick={() => setLegendOpen(false)}
              aria-label="Close legend"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>

          {legendContent}
        </div>
      )}

      {/* Phones/tablets: Help bottom sheet (layers, map view and map key) */}
      {helpOpen && isMobile && (
        <>
          <div
            className="popover-backdrop"
            onClick={() => setHelpOpen(false)}
            aria-hidden="true"
          />
          <div
            className="rh-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Help and map key"
          >
            <div className="sheet-handle" aria-hidden="true" />

            <div className="popover-header">
              <h4>Help &amp; map key</h4>
              <button
                type="button"
                className="popover-close-btn"
                onClick={() => setHelpOpen(false)}
                aria-label="Close help"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            <div className="sheet-body">
              <div className="popover-section">
                <div className="popover-section-label">Show on map</div>

                <button
                  type="button"
                  onClick={() => setShowCentersLayer((prev) => !prev)}
                  className={`layer-option-row ${showCentersLayer ? "active" : ""}`}
                  aria-pressed={showCentersLayer}
                >
                  <div className="layer-option-left">
                    <FontAwesomeIcon icon={faBuildingColumns} className="layer-icon-blue" />
                    <span>Evacuation centers</span>
                  </div>
                  <span className="layer-checkbox">{showCentersLayer ? "✓" : ""}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowHazardsLayer((prev) => !prev)}
                  className={`layer-option-row ${showHazardsLayer ? "active" : ""}`}
                  aria-pressed={showHazardsLayer}
                >
                  <div className="layer-option-left">
                    <FontAwesomeIcon icon={faTriangleExclamation} className="layer-icon-red" />
                    <span>Reported dangers</span>
                  </div>
                  <span className="layer-checkbox">{showHazardsLayer ? "✓" : ""}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowClosedRoadsLayer((prev) => !prev)}
                  className={`layer-option-row ${showClosedRoadsLayer ? "active" : ""}`}
                  aria-pressed={showClosedRoadsLayer}
                >
                  <div className="layer-option-left">
                    <FontAwesomeIcon icon={faBan} className="layer-icon-red" />
                    <span>Closed roads</span>
                  </div>
                  <span className="layer-checkbox">{showClosedRoadsLayer ? "✓" : ""}</span>
                </button>
              </div>

              {layerOptionsContent}

              <div className="popover-section">
                <div className="popover-section-label">Map key</div>
                {legendContent}
              </div>
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
                    Capacity: <strong>{selectedCenterCapacity} people</strong>
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

          {selectedCenterIsMine && myCenter?.room?.room_number && (
            <div className="cd-your-room">
              <FontAwesomeIcon icon={faCircleCheck} />
              <span>
                Your assigned room: <strong>{myCenter.room.room_number}</strong>
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

          {selectedCenterRooms.length > 0 && (
            <div className="center-card-rooms-preview">
              <div className="rooms-preview-header">
                <span>Rooms ({selectedCenterRooms.length})</span>
              </div>
              <div className="rooms-preview-list">
                {selectedCenterRooms.map((room, index) => {
                  const isMineRoom =
                    myCenter?.room?.id != null &&
                    String(myCenter.room.id) === String(room.id);
                  const isMapped =
                    room.latitude != null && room.longitude != null;
                  return (
                    <button
                      type="button"
                      key={room.id ?? `${room.room_number}-${index}`}
                      className={`room-preview-chip ${isMineRoom ? "is-mine" : ""}`}
                      onClick={() => handleRoomRowClick(room)}
                      disabled={!isMapped}
                      title={
                        isMapped
                          ? `Zoom to room ${room.room_number}`
                          : "Location not yet mapped"
                      }
                    >
                      <FontAwesomeIcon icon={faDoorOpen} />
                      <span>{room.room_number || "Room"}</span>
                      {room.capacity != null && (
                        <small>({room.capacity})</small>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Floating rescue action during active navigation */}
      {navigationActive && (
        <button
          type="button"
          className="rescue-floating-action"
          onClick={() => setRescueAlertOpen(true)}
          aria-label="Request emergency rescue"
        >
          <FontAwesomeIcon icon={faTriangleExclamation} /> Request Rescue
        </button>
      )}

      {/* Bottom Action Bar */}
      {!navigationActive && (
        <div className={`bottom-actions-container ${isMobile ? "mobile" : ""}`}>
          {isMobile ? (
            /* Phones/tablets: 2-row dock */
            <div className="mobile-action-dock">
              {locationPermission !== "granted" ? (
                <button
                  type="button"
                  onClick={handleEnableLocation}
                  className="action-btn-primary mobile-route-btn"
                >
                  <FontAwesomeIcon icon={faLocationCrosshairs} />
                  <span>Turn on my location</span>
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
                      ? "Finding route..."
                      : myCenter
                        ? "Go to my evacuation center"
                        : "Go to nearest safe place"}
                  </span>
                </button>
              )}

              <div className="mobile-dock-row">
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
            </div>
          ) : (
            /* Desktop Row */
            <div className="desktop-action-bar">
              <div className="desktop-primary-group">
                <button
                  type="button"
                  onClick={handleReportMapClick}
                  className="action-btn-secondary"
                >
                  <FontAwesomeIcon icon={faMapPin} />
                  <span>{pickingLocation ? "Tap map..." : "Report Hazard"}</span>
                </button>

                <button
                  type="button"
                  onClick={openMyCenter}
                  className={`action-btn-secondary ${myCenter ? "verified" : ""}`}
                  title={myCenter ? "My Evacuation Center" : "Find My Evacuation Center"}
                >
                  <FontAwesomeIcon icon={myCenter ? faCircleCheck : faUser} />
                  <span>{myCenter ? `My Center (${firstName})` : "My Evacuation Center"}</span>
                </button>

                {locationPermission !== "granted" ? (
                  <button
                    type="button"
                    onClick={handleEnableLocation}
                    className="action-btn-primary"
                  >
                    <FontAwesomeIcon icon={faLocationCrosshairs} />
                    <span>Enable Location</span>
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
                          ? "Find My Center"
                          : "Find Nearest Evacuation Route"}
                    </span>
                  </button>
                )}
              </div>

              <div className="desktop-sos-divider" aria-hidden="true" />

              <button
                type="button"
                onClick={() => setRescueAlertOpen(true)}
                className="action-btn-sos"
                aria-label="Request emergency rescue"
              >
                <FontAwesomeIcon icon={faTriangleExclamation} />
                <span>Request Rescue</span>
              </button>
            </div>
          )}
        </div>
      )}

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

      {/* Route panel */}
      {route && (
        <div className={`route-panel ${navigationActive ? "is-navigating" : ""}`}>
          <button
            onClick={handleClearRoute}
            className="route-panel-close"
            aria-label="Clear route"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>

          <div className="route-panel-title">
            <FontAwesomeIcon icon={faRoute} />

            {displayEntityName(route.evacuation_center?.name, "Evacuation Center")}
          </div>

          {routeIsMine && myCenter?.room?.room_number && (
            <div className="route-panel-room">
              Your room: {myCenter.room.room_number}
            </div>
          )}

          <div className="route-panel-distance">
            {navigationActive && navigationRemainingMeters != null
              ? `${(navigationRemainingMeters / 1000).toFixed(1)} km remaining · ${Math.ceil(
                (navigationRemainingSeconds || 0) / 60
              )} min`
              : `${Number(route.distance_km || 0).toFixed(1)} km by walking`}
          </div>

          <div className="route-modes">
            <div className="route-mode route-mode-walking">
              <FontAwesomeIcon icon={faPersonWalking} />
              <span>
                {route.estimated_time_min ??
                  estimateTravelTimes(route.distance_km || 0).walking} min
              </span>
            </div>
          </div>

          <div className="route-guidance">
            <div className="route-turn-arrow" aria-hidden="true">
              <FontAwesomeIcon
                icon={faArrowUp}
                style={{
                  transform: `rotate(${getManeuverRotation(
                    currentWalkingManeuver?.modifier
                  )}deg)`,
                }}
              />
            </div>
            <div className="route-guidance-copy">
              <span>{navigationActive ? "NEXT INSTRUCTION" : "WALKING DIRECTIONS"}</span>
              <strong>
                {currentWalkingManeuver?.instruction ||
                  (navigationActive
                    ? navigationStatus || "Follow the highlighted route."
                    : "Start navigation to get live turn-by-turn guidance.")}
              </strong>
              {navigationActive && navigationAccuracy != null && (
                <small>GPS accuracy approximately {navigationAccuracy} m</small>
              )}
            </div>
          </div>

          {navigationStatus && (
            <div className="route-navigation-status">{navigationStatus}</div>
          )}

          <button
            type="button"
            className={`walking-navigation-button ${navigationActive ? "is-active" : ""}`}
            onClick={
              navigationActive
                ? () => stopWalkingNavigation()
                : handleStartWalkingNavigation
            }
          >
            <FontAwesomeIcon icon={navigationActive ? faXmark : faPersonWalking} />
            {navigationActive ? "Stop navigation" : "Start walking navigation"}
          </button>
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
                <p className="mc-hint">
                  Enter the full name of the head of your household to find the
                  evacuation center assigned to you.
                </p>

                <label className="mc-label" htmlFor="mc-name">
                  Full name
                </label>

                <input
                  id="mc-name"
                  type="text"
                  className="mc-input"
                  value={lookupName}
                  onChange={(e) => setLookupName(e.target.value)}
                  placeholder="e.g. Juan Dela Cruz"
                  autoComplete="name"
                  autoFocus
                />

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
          onAdjustOnMap={() => { }}
        />
      )}

    </div>
  );
};

export default ResidentHome;
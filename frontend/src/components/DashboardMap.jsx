import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { icon } from "@fortawesome/fontawesome-svg-core";

import {
  faWater,
  faMountain,
  faTriangleExclamation,
  faSearch,
  faLocationDot,
  faMapPin,
  faDoorOpen,
  faPen,
  faXmark,
  faArrowLeft,
  faBuildingColumns,
  faChevronRight,
  faLayerGroup,
  faCheck,
  faHand,
  faLocationCrosshairs,
  faSatellite,
  faMap,
  faPlus,
  faMinus,
  faCompass,
} from "@fortawesome/free-solid-svg-icons";

import { BASE_URL } from "../services/api";
import {
  usePublicHazardReports,
  useRoadSegments,
  useRoomsForCenters,
  useRoomFamilies,
  useSogodBoundary,
} from "../hooks/useEvacuationQueries";
import { displayEntityName } from "../utils/displayEntityName";
import "../components_css/DashboardMap.css";
import { isValidatedReport, createReportMarker, createReportPopup } from "./mapReports";
import "../components_css/MapOverlays.css";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const MAPBOX_STYLE_STREETS = "mapbox://styles/mapbox/standard";
const MAPBOX_STYLE_SATELLITE = "mapbox://styles/mapbox/satellite-streets-v12";

const SOGOD_CENTER = [124.996, 10.435];

const SOGOD_BOUNDS = [
  [124.89, 10.35],
  [125.11, 10.56],
];

const PLACEMENT_MAP_STYLE_KEY = "evacway_placement_map_style";

function getInitialPlacementStyle() {
  try {
    return sessionStorage.getItem(PLACEMENT_MAP_STYLE_KEY) || "satellite";
  } catch {
    return "satellite";
  }
}

/*
 * Stable empty array. A default prop like `rooms = []` creates a NEW
 * array on every render, which made the room-loading effect re-run
 * forever when the dashboard did not pass `rooms`.
 */
const EMPTY_ARRAY = [];

/*
 * Rooms are only drawn from this zoom level and up.
 */
const ROOM_MIN_ZOOM = 17;

/*
 * Normalizes the getRoomFamilies response and removes duplicate
 * rows (a family repeated because the backend returns one row per
 * member).
 */
function normalizeRoomFamilies(data, capacity = 0) {
  const raw = Array.isArray(data)
    ? data
    : Array.isArray(data?.families)
    ? data.families
    : [];

  const seen = new Set();

  const families = raw.filter((family) => {
    const key = [
      family.household_head_name,
      family.address,
      family.barangay,
    ]
      .map((value) => String(value ?? "").trim().toLowerCase())
      .join("|");

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });

  const occupied = families.reduce(
    (total, family) => total + Number(family.family_members || 0),
    0
  );

  return {
    families,
    occupied,
    available: Math.max(Number(capacity || 0) - occupied, 0),
  };
}

function createPopup(title, content) {
  const popup = new mapboxgl.Popup({
    offset: 12,
    closeButton: true,
    closeOnClick: true,
  });

  const element = document.createElement("div");

  const titleElement = document.createElement("strong");
  titleElement.textContent = title;

  const contentElement = document.createElement("div");
  contentElement.style.marginTop = "4px";
  contentElement.innerHTML = content;

  element.appendChild(titleElement);
  element.appendChild(contentElement);

  popup.setDOMContent(element);

  return popup;
}

function createHazardPopup(properties = {}) {
  const container = document.createElement("div");
  container.className = "dashboard-hazard-popup";

  const title = document.createElement("strong");
  title.textContent =
    properties.name || properties.hazard_name || properties.hazard_type || "Hazard zone";
  container.appendChild(title);

  const type = document.createElement("div");
  type.textContent = `Type: ${properties.hazard_type || "Unknown"}`;
  container.appendChild(type);

  const risk = document.createElement("div");
  risk.textContent = `Risk: ${properties.risk_level || "Unspecified"}`;
  risk.className = `dashboard-hazard-popup-risk risk-${String(
    properties.risk_level || "unknown"
  ).toLowerCase()}`;
  container.appendChild(risk);

  const description = properties.description || properties.details;
  if (description) {
    const details = document.createElement("p");
    details.textContent = description;
    container.appendChild(details);
  }

  const photoPath =
    properties.photo_url || properties.image_url || properties.photo_path || properties.photo;
  if (photoPath) {
    const photo = document.createElement("img");
    photo.src = /^https?:\/\//i.test(photoPath)
      ? photoPath
      : `${BASE_URL}${photoPath.startsWith("/") ? "" : "/"}${photoPath}`;
    photo.alt = "Hazard zone reference";
    photo.className = "dashboard-hazard-popup-photo";
    photo.onerror = () => photo.remove();
    container.appendChild(photo);
  } else {
    const noPhoto = document.createElement("small");
    noPhoto.className = "dashboard-hazard-popup-no-photo";
    noPhoto.textContent = "No photo attached";
    container.appendChild(noPhoto);
  }

  return container;
}

function getGeometryBounds(geometry) {
  if (!geometry) return null;

  const coordinates = [];

  function collect(coords) {
    if (!Array.isArray(coords)) return;

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

  if (coordinates.length === 0) return null;

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

export function isCenterMapped(center) {
  if (!center) return false;
  const geom = center.geometry || center.geom;
  if (geom && Array.isArray(geom.coordinates) && geom.coordinates.length > 0) {
    return true;
  }
  const props = center.properties || center;
  if (props.has_map !== undefined) {
    return Boolean(props.has_map);
  }
  const lat = Number(props.latitude ?? center.latitude);
  const lng = Number(props.longitude ?? center.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng);
}

export function getOccupancyStatus(occupied = 0, capacity = 0) {
  const cap = Number(capacity) || 0;
  const occ = Number(occupied) || 0;
  const percent =
    cap > 0 ? Math.min(100, Math.round((occ / cap) * 100)) : occ > 0 ? 100 : 0;
  const spacesLeft = Math.max(0, cap - occ);

  if (percent >= 90) {
    return {
      percent,
      color: "#dc2626", // Red: 90% and above
      statusText: "Full",
      spacesLeftText: `${spacesLeft} spaces left`,
    };
  }
  if (percent >= 70) {
    return {
      percent,
      color: "#d97706", // Amber: 70% to 89%
      statusText: "High",
      spacesLeftText: `${spacesLeft} spaces left`,
    };
  }
  return {
    percent,
    color: "#16a34a", // Green: below 70%
    statusText: "Normal",
    spacesLeftText: `${spacesLeft} spaces left`,
  };
}

export function getCenterCoordinates(center) {
  if (!center) return null;
  const geom = center.geometry || center.geom;
  if (geom && geom.coordinates) {
    const coordinates = [];
    function collect(coords) {
      if (!Array.isArray(coords)) return;
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
    collect(geom.coordinates);

    if (coordinates.length > 0) {
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

      return {
        latitude: (minLat + maxLat) / 2,
        longitude: (minLng + maxLng) / 2,
      };
    }
  }

  const props = center.properties || center;
  const lat = Number(props.latitude ?? center.latitude);
  const lng = Number(props.longitude ?? center.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { latitude: lat, longitude: lng };
  }
  return null;
}

/**
 * Checks whether a point is inside or near (tolerance meters) a polygon.
 */
export function isPointInOrNearPolygon(point, polygonPoints, toleranceMeters = 15) {
  if (!polygonPoints || polygonPoints.length < 3) return true;

  const x = Number(point?.lng ?? point?.longitude);
  const y = Number(point?.lat ?? point?.latitude);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;

  // Ray-casting for point-in-polygon
  let inside = false;
  for (let i = 0, j = polygonPoints.length - 1; i < polygonPoints.length; j = i++) {
    const xi = Number(polygonPoints[i].lng ?? polygonPoints[i].longitude);
    const yi = Number(polygonPoints[i].lat ?? polygonPoints[i].latitude);
    const xj = Number(polygonPoints[j].lng ?? polygonPoints[j].longitude);
    const yj = Number(polygonPoints[j].lat ?? polygonPoints[j].latitude);

    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  if (inside) return true;

  // Check proximity to polygon boundary
  const degTolerance = toleranceMeters / 111320;
  const degTolSq = degTolerance * degTolerance;
  for (let i = 0, j = polygonPoints.length - 1; i < polygonPoints.length; j = i++) {
    const x1 = Number(polygonPoints[i].lng ?? polygonPoints[i].longitude);
    const y1 = Number(polygonPoints[i].lat ?? polygonPoints[i].latitude);
    const x2 = Number(polygonPoints[j].lng ?? polygonPoints[j].longitude);
    const y2 = Number(polygonPoints[j].lat ?? polygonPoints[j].latitude);

    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) continue;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lenSq));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    const distSq = (x - projX) * (x - projX) + (y - projY) * (y - projY);
    if (distSq <= degTolSq) {
      return true;
    }
  }

  return false;
}

function DashboardMap({
  centers,
  hazardZones,
  onCenterClick,
  drawMode = "none",
  onMapClick,
  pendingFootprint = EMPTY_ARRAY,
  pendingEntrances = EMPTY_ARRAY,
  rooms = EMPTY_ARRAY,
  onRoomClick,
  pendingRoomLocation = null,
  focusLocation = null,
  selectedCenter: selectedCenterProp = undefined,
  editingCenter = null,
  mappingTool = "draw",
  onMappingToolChange,
  currentZoom: currentZoomProp,
  onZoomChange,
  hideInternalPanel = false,
  hideSearch = false,
  hideZoomControls = false,
  onCloseShape,
  onOutsideOutlineClick,
}) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const hazardMarkersRef = useRef([]);
  const centerMarkersRef = useRef([]);
  const focusPointMarkerRef = useRef(null);

  const [mapLoaded, setMapLoaded] = useState(false);

  const isDrawing =
    drawMode === "footprint" ||
    drawMode === "entrance" ||
    drawMode === "confirm";
  const [mapStyle, setMapStyle] = useState(() => {
    return isDrawing ? getInitialPlacementStyle() : "streets";
  });
  const [styleVersion, setStyleVersion] = useState(0);
  const [currentZoom, setCurrentZoom] = useState(currentZoomProp || 12);
  const userLocationMarkerRef = useRef(null);
  const [locatingUser, setLocatingUser] = useState(false);

  // Drawing geocoding search states
  const [drawingSearchText, setDrawingSearchText] = useState("");
  const [drawingSearchResults, setDrawingSearchResults] = useState([]);
  const [drawingSearching, setDrawingSearching] = useState(false);
  const [showDrawingSearchResults, setShowDrawingSearchResults] = useState(false);

  // Center start view tracking
  const initializedCenterIdRef = useRef(null);
  const prevDrawModeRef = useRef(drawMode);

  const { rooms: loadedRooms } = useRoomsForCenters(centers);
  const { data: sogodBoundary = null } = useSogodBoundary();
  const { data: roads = null } = useRoadSegments();
  const hazardReportsQuery = usePublicHazardReports();
  const hazardReports = useMemo(() => {
    const response = hazardReportsQuery.data;
    const reports = Array.isArray(response)
      ? response
      : Array.isArray(response?.reports)
        ? response.reports
        : [];
    return reports.filter(isValidatedReport);
  }, [hazardReportsQuery.data]);

  /*
   * Selected center / room for the details panels
   */
  const [selectedCenter, setSelectedCenter] = useState(selectedCenterProp || null);
  const [selectedRoom, setSelectedRoom] = useState(null);

  useEffect(() => {
    if (selectedCenterProp !== undefined) {
      setSelectedCenter(selectedCenterProp);
    }
  }, [selectedCenterProp]);

  /*
   * Auto-center map on selectedCenterProp when requested (non-drawing mode)
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !selectedCenterProp || isDrawing) return;

    const feature =
      selectedCenterProp.geometry
        ? selectedCenterProp
        : (centers?.features || []).find(
            (c) =>
              String(c.properties?.id) ===
              String(selectedCenterProp.id ?? selectedCenterProp.properties?.id)
          );

    if (feature?.geometry) {
      const bounds = getGeometryBounds(feature.geometry);
      if (bounds) {
        if (bounds[0][0] === bounds[1][0] && bounds[0][1] === bounds[1][1]) {
          map.flyTo({
            center: bounds[0],
            zoom: 17,
            duration: 900,
          });
        } else {
          map.fitBounds(bounds, {
            padding: 100,
            maxZoom: 17,
            duration: 900,
          });
        }
      }
    } else {
      const props = feature?.properties || selectedCenterProp?.properties || selectedCenterProp;
      const lat = Number(props?.latitude ?? selectedCenterProp?.latitude);
      const lng = Number(props?.longitude ?? selectedCenterProp?.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        map.flyTo({
          center: [lng, lat],
          zoom: 17,
          duration: 900,
        });
      }
    }
  }, [mapLoaded, selectedCenterProp, centers]);

  /*
   * Families assigned to the selected room
   */
  const roomFamiliesQuery = useRoomFamilies(selectedRoom?.id);
  const roomFamilies = useMemo(
    () => normalizeRoomFamilies(roomFamiliesQuery.data, selectedRoom?.capacity),
    [roomFamiliesQuery.data, selectedRoom?.capacity]
  );
  const familiesLoading = roomFamiliesQuery.isLoading;
  const familiesError = roomFamiliesQuery.error?.message || "";

  const [visibleLayers, setVisibleLayers] = useState({
    flood: false,
    landslide: false,
  });
  const [showReports, setShowReports] = useState(true);
  const [layersMenuOpen, setLayersMenuOpen] = useState(false);

  const activeLayerCount =
    (visibleLayers.flood ? 1 : 0) +
    (visibleLayers.landslide ? 1 : 0) +
    (showReports ? 1 : 0);

  /*
   * Search
   */
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);

  /*
   * Always points at the latest room-marker click handler, so the
   * markers do not have to be rebuilt when the handler changes.
   */
  const roomMarkerClickRef = useRef(null);

  roomMarkerClickRef.current = (room) => {
    /*
     * Inside EvacuationCenterManager, the manager handles the click.
     */
    if (onRoomClick) {
      onRoomClick(room);
      return;
    }

    /*
     * Standalone dashboard: open the details here.
     */
    const center = (centers?.features || []).find(
      (item) =>
        String(item.properties?.id) === String(room.evacuation_center_id)
    );

    if (center) {
      setSelectedCenter(center);
    }

    setSelectedRoom(room);
  };

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !focusLocation) return;
    const latitude = Number(focusLocation.latitude);
    const longitude = Number(focusLocation.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      if (focusLocation.zoom) {
        map.flyTo({
          zoom: focusLocation.zoom,
          duration: 800,
        });
      }
      return;
    }

    const currentCenter = map.getCenter();
    const isSameLocation =
      Math.abs(currentCenter.lat - latitude) < 0.0001 &&
      Math.abs(currentCenter.lng - longitude) < 0.0001;

    if (!isSameLocation) {
      map.flyTo({
        center: [longitude, latitude],
        zoom: focusLocation.zoom || Math.max(map.getZoom(), 16),
        duration: 900,
      });
    }

    if (focusPointMarkerRef.current) {
      focusPointMarkerRef.current.remove();
      focusPointMarkerRef.current = null;
    }

    const pinEl = document.createElement("div");
    pinEl.className = "dashboard-focus-pin";
    const labelText = focusLocation.label || "Inspection Location";
    pinEl.innerHTML = `
      <div class="dashboard-focus-beacon"></div>
      <div class="dashboard-focus-dot"></div>
      <span class="dashboard-focus-label">${labelText}</span>
    `;

    const pinMarker = new mapboxgl.Marker({
      element: pinEl,
      anchor: "center",
    })
      .setLngLat([longitude, latitude])
      .addTo(map);

    focusPointMarkerRef.current = pinMarker;
  }, [mapLoaded, focusLocation]);

  /*
   * Helper to re-add custom sources and layers after a style change
   */
  const readdCustomSourcesAndLayers = (map) => {
    if (!map || !map.isStyleLoaded()) return;

    // 1. Sogod boundary
    if (sogodBoundary && !map.getSource("sogod-boundary")) {
      try {
        map.addSource("sogod-boundary", {
          type: "geojson",
          data: sogodBoundary,
        });
        if (!map.getLayer("sogod-boundary-casing")) {
          map.addLayer({
            id: "sogod-boundary-casing",
            type: "line",
            source: "sogod-boundary",
            paint: {
              "line-color": mapStyle === "satellite" ? "rgba(0, 0, 0, 0.65)" : "rgba(255, 255, 255, 0.85)",
              "line-width": 4.5,
            },
          });
        }
        if (!map.getLayer("sogod-boundary-line")) {
          map.addLayer({
            id: "sogod-boundary-line",
            type: "line",
            source: "sogod-boundary",
            paint: {
              "line-color": mapStyle === "satellite" ? "#38bdf8" : "#1e3a8a",
              "line-width": 2.5,
              "line-dasharray": [4, 3],
            },
          });
        }
      } catch (e) {
        // ignore
      }
    }

    // 2. Roads
    if (roads && !map.getSource("roads")) {
      try {
        map.addSource("roads", {
          type: "geojson",
          data: roads,
        });
        map.addLayer({
          id: "roads-open",
          type: "line",
          source: "roads",
          filter: ["==", ["get", "is_closed"], false],
          paint: {
            "line-color": "#94a3b8",
            "line-width": 2,
            "line-opacity": 0.65,
          },
        });
        map.addLayer({
          id: "roads-closed",
          type: "line",
          source: "roads",
          filter: ["==", ["get", "is_closed"], true],
          paint: {
            "line-color": "#dc2626",
            "line-width": 4,
            "line-opacity": 0.9,
          },
        });
      } catch (e) {
        // ignore
      }
    }

    // 3. Hazard zones
    if (hazardZones && !map.getSource("hazard-zones")) {
      try {
        const filtered = {
          ...hazardZones,
          features: (hazardZones.features || []).filter(
            (feature) => visibleLayers[feature.properties?.hazard_type] === true
          ),
        };
        map.addSource("hazard-zones", {
          type: "geojson",
          data: filtered,
        });
        map.addLayer({
          id: "hazard-zones-fill",
          type: "fill",
          source: "hazard-zones",
          paint: {
            "fill-color": [
              "match",
              ["get", "hazard_type"],
              "flood",
              "#0a9fb5",
              "landslide",
              "#8b5e34",
              "#c8372d",
            ],
            "fill-opacity": [
              "match",
              ["get", "risk_level"],
              "high",
              0.34,
              "medium",
              0.25,
              0.18,
            ],
          },
        });
        map.addLayer({
          id: "hazard-zones-line",
          type: "line",
          source: "hazard-zones",
          paint: {
            "line-color": [
              "match",
              ["get", "hazard_type"],
              "flood",
              "#087e99",
              "landslide",
              "#684323",
              "#a82e27",
            ],
            "line-width": 2.5,
          },
        });
      } catch (e) {
        // ignore
      }
    }

    // 4. Evacuation centers
    if (centers?.features && !map.getSource("evacuation-centers")) {
      try {
        const centerFeatures = (centers.features || [])
          .filter((center) => center.geometry)
          .map((center) => ({
            type: "Feature",
            geometry: center.geometry,
            properties: {
              center_id: center.properties?.id ?? center.id,
              center_name: center.properties?.name || "Evacuation Center",
              center_active: Boolean(center.properties?.is_active),
            },
          }));

        map.addSource("evacuation-centers", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: centerFeatures,
          },
        });

        map.addLayer({
          id: "evac-centers-fill",
          type: "fill",
          source: "evacuation-centers",
          paint: {
            "fill-color": ["case", ["get", "center_active"], "#16a34a", "#9ca3af"],
            "fill-opacity": 0.25,
          },
        });

        map.addLayer({
          id: "evac-centers-line",
          type: "line",
          source: "evacuation-centers",
          paint: {
            "line-color": ["case", ["get", "center_active"], "#16a34a", "#9ca3af"],
            "line-width": 2,
          },
        });
      } catch (e) {
        // ignore
      }
    }

    // 5. Outline / Pending footprint
    try {
      const isActive =
        (drawMode === "footprint" || drawMode === "entrance") &&
        pendingFootprint &&
        pendingFootprint.length > 0;

      const polygonCoordinates = isActive
        ? [pendingFootprint.map((point) => [point.lng, point.lat])]
        : [];

      const footprintData = {
        type: "FeatureCollection",
        features:
          polygonCoordinates.length > 0
            ? [
                {
                  type: "Feature",
                  properties: {},
                  geometry: {
                    type: "Polygon",
                    coordinates: polygonCoordinates,
                  },
                },
              ]
            : [],
      };

      if (!map.getSource("pending-footprint")) {
        map.addSource("pending-footprint", {
          type: "geojson",
          data: footprintData,
        });
        map.addLayer({
          id: "pending-footprint-fill",
          type: "fill",
          source: "pending-footprint",
          paint: {
            "fill-color": "#2563eb",
            "fill-opacity": 0.2,
          },
        });
        map.addLayer({
          id: "pending-footprint-line",
          type: "line",
          source: "pending-footprint",
          paint: {
            "line-color": "#2563eb",
            "line-width": 2,
            "line-dasharray": [2, 2],
          },
        });
      } else {
        map.getSource("pending-footprint").setData(footprintData);
      }
    } catch (e) {
      // ignore
    }
  };

  const changeMapStyle = (newStyle) => {
    if (isDrawing) {
      try {
        sessionStorage.setItem(PLACEMENT_MAP_STYLE_KEY, newStyle);
      } catch {}
    }
    const map = mapRef.current;
    if (!map || mapStyle === newStyle) return;
    const url = newStyle === "satellite" ? MAPBOX_STYLE_SATELLITE : MAPBOX_STYLE_STREETS;
    setMapStyle(newStyle);
    try {
      map.setStyle(url);
      map.once("style.load", () => {
        try {
          readdCustomSourcesAndLayers(map);
        } catch (e) {
          // ignore during style reload
        }
        setStyleVersion((v) => v + 1);
      });
    } catch (e) {
      console.warn("Failed to set map style:", e);
    }
  };

  /*
   * Default to Satellite while drawing (remember choice for session)
   */
  useEffect(() => {
    const wasDrawing =
      prevDrawModeRef.current === "footprint" ||
      prevDrawModeRef.current === "entrance" ||
      prevDrawModeRef.current === "confirm";
    const isDrawingNow =
      drawMode === "footprint" ||
      drawMode === "entrance" ||
      drawMode === "confirm";
    prevDrawModeRef.current = drawMode;

    if (!wasDrawing && isDrawingNow) {
      const preferred = getInitialPlacementStyle();
      if (mapRef.current && mapStyle !== preferred) {
        changeMapStyle(preferred);
      }
    }
  }, [drawMode, mapStyle]);

  /*
   * Start view for drawing:
   * If center already has a saved location use it;
   * otherwise geocode "<first barangay>, Sogod, Southern Leyte" and open at zoom 16,
   * falling back to Sogod town at zoom 14.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !isDrawing) return;

    const activeCenter = editingCenter || selectedCenterProp || selectedCenter;
    const activeCenterId =
      activeCenter?.id || activeCenter?.properties?.id || null;
    if (!activeCenterId || initializedCenterIdRef.current === activeCenterId) return;

    initializedCenterIdRef.current = activeCenterId;

    const geom = activeCenter?.geometry;
    const bounds = geom ? getGeometryBounds(geom) : null;
    const props = activeCenter?.properties || activeCenter || {};
    const lat = Number(props.latitude ?? activeCenter?.latitude);
    const lng = Number(props.longitude ?? activeCenter?.longitude);
    const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lng);

    if (bounds) {
      map.fitBounds(bounds, {
        padding: 80,
        maxZoom: 18,
        duration: 900,
      });
    } else if (hasCoordinates) {
      map.flyTo({
        center: [lng, lat],
        zoom: 18,
        duration: 900,
      });
    } else {
      const barangays = props.barangays || activeCenter?.barangays || props.barangay_breakdown || [];
      const firstBarangay =
        (Array.isArray(barangays) && barangays.length > 0 && (barangays[0].name || barangays[0].barangay_name)) ||
        props.barangay ||
        activeCenter?.barangay ||
        "";

      if (firstBarangay && mapboxgl.accessToken) {
        const query = `${firstBarangay}, Sogod, Southern Leyte`;
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?country=ph&proximity=${SOGOD_CENTER[0]},${SOGOD_CENTER[1]}&limit=1&access_token=${mapboxgl.accessToken}`;

        fetch(url)
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            const feat = data?.features?.[0];
            const coords = feat?.center || feat?.geometry?.coordinates;
            if (coords && Array.isArray(coords) && coords.length === 2) {
              map.flyTo({
                center: coords,
                zoom: 16,
                duration: 1000,
              });
            } else {
              map.flyTo({
                center: SOGOD_CENTER,
                zoom: 14,
                duration: 1000,
              });
            }
          })
          .catch(() => {
            map.flyTo({
              center: SOGOD_CENTER,
              zoom: 14,
              duration: 1000,
            });
          });
      } else {
        map.flyTo({
          center: SOGOD_CENTER,
          zoom: 14,
          duration: 1000,
        });
      }
    }
  }, [mapLoaded, isDrawing, editingCenter, selectedCenterProp, selectedCenter]);

  /*
   * General start view:
   * Fit the map to the mapped centers; when none are mapped,
   * center on Sogod, Southern Leyte at zoom 12 (geocoded).
   */
  const hasFittedGeneralStartViewRef = useRef(false);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || isDrawing || hasFittedGeneralStartViewRef.current) return;
    if (selectedCenterProp || focusLocation) return;
    if (!centers?.features) return;

    hasFittedGeneralStartViewRef.current = true;

    const mappedCoords = [];
    (centers.features || []).forEach((c) => {
      const geom = c.geometry || c.geom;
      if (geom && geom.coordinates) {
        function collect(coords) {
          if (!Array.isArray(coords)) return;
          if (
            coords.length >= 2 &&
            typeof coords[0] === "number" &&
            typeof coords[1] === "number"
          ) {
            mappedCoords.push(coords);
            return;
          }
          coords.forEach(collect);
        }
        collect(geom.coordinates);
      } else {
        const props = c.properties || c;
        const lat = Number(props.latitude ?? c.latitude);
        const lng = Number(props.longitude ?? c.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          mappedCoords.push([lng, lat]);
        }
      }
    });

    if (mappedCoords.length > 0) {
      let minLng = mappedCoords[0][0];
      let maxLng = mappedCoords[0][0];
      let minLat = mappedCoords[0][1];
      let maxLat = mappedCoords[0][1];

      mappedCoords.forEach(([lng, lat]) => {
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
      });

      if (minLng === maxLng && minLat === maxLat) {
        map.flyTo({ center: [minLng, minLat], zoom: 15, duration: 900 });
      } else {
        map.fitBounds(
          [
            [minLng, minLat],
            [maxLng, maxLat],
          ],
          {
            padding: 80,
            maxZoom: 16,
            duration: 900,
          }
        );
      }
    } else {
      // When none are mapped: center on Sogod, Southern Leyte at zoom 12 (geocode it)
      const query = "Sogod, Southern Leyte, Philippines";
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?country=ph&limit=1&access_token=${mapboxgl.accessToken}`;

      fetch(url)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          const feat = data?.features?.[0];
          const coords = feat?.center || feat?.geometry?.coordinates;
          if (coords && Array.isArray(coords) && coords.length === 2) {
            map.flyTo({
              center: coords,
              zoom: 12,
              duration: 900,
            });
          } else {
            map.flyTo({
              center: SOGOD_CENTER,
              zoom: 12,
              duration: 900,
            });
          }
        })
        .catch(() => {
          map.flyTo({
            center: SOGOD_CENTER,
            zoom: 12,
            duration: 900,
          });
        });
    }
  }, [mapLoaded, centers, isDrawing, selectedCenterProp, focusLocation]);

  /*
   * Initialize Mapbox
   */
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapboxgl.accessToken) {
      console.error(
        "Mapbox token is missing. Check VITE_MAPBOX_TOKEN in .env"
      );
      return;
    }

    const initialStyle = (drawMode === "footprint" || drawMode === "entrance" || drawMode === "confirm")
      ? (getInitialPlacementStyle() === "streets" ? MAPBOX_STYLE_STREETS : MAPBOX_STYLE_SATELLITE)
      : MAPBOX_STYLE_STREETS;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: initialStyle,
      center: SOGOD_CENTER,
      zoom: 12,
      minZoom: 12,
      maxZoom: 18,
      pitch: 0,
      bearing: 0,
      maxBounds: SOGOD_BOUNDS,
      attributionControl: false,
    });

    mapRef.current = map;

    map.on("zoom", () => {
      const z = map.getZoom();
      setCurrentZoom(z);
      if (onZoomChange) onZoomChange(z);
      const isZ14 = z >= 14;
      centerMarkersRef.current.forEach(({ element }) => {
        if (element) {
          element.classList.toggle("show-label", isZ14);
        }
      });
    });

    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(mapContainerRef.current);

    map.on("load", () => {
      setMapLoaded(true);
      const z = map.getZoom();
      setCurrentZoom(z);
      if (onZoomChange) onZoomChange(z);
      const isZ14 = z >= 14;
      centerMarkersRef.current.forEach(({ element }) => {
        if (element) {
          element.classList.toggle("show-label", isZ14);
        }
      });
    });

    map.on("error", (event) => {
      console.error("Mapbox error:", event);
    });

    return () => {
      resizeObserver.disconnect();
      if (centerMarkersRef.current) {
        centerMarkersRef.current.forEach((item) => {
          if (item.marker) item.marker.remove();
        });
        centerMarkersRef.current = [];
      }
      if (userLocationMarkerRef.current) {
        userLocationMarkerRef.current.remove();
        userLocationMarkerRef.current = null;
      }
      if (focusPointMarkerRef.current) {
        focusPointMarkerRef.current.remove();
        focusPointMarkerRef.current = null;
      }
      map.remove();
      mapRef.current = null;
    };
  }, []);

  /*
   * Add/update Sogod boundary
   */
  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded || !sogodBoundary || !map.isStyleLoaded()) return;

    try {
      const source = map.getSource("sogod-boundary");

      if (source) {
        source.setData(sogodBoundary);
        if (map.getLayer("sogod-boundary-casing")) {
          map.setPaintProperty(
            "sogod-boundary-casing",
            "line-color",
            mapStyle === "satellite" ? "rgba(0, 0, 0, 0.65)" : "rgba(255, 255, 255, 0.85)"
          );
        }
        if (map.getLayer("sogod-boundary-line")) {
          map.setPaintProperty(
            "sogod-boundary-line",
            "line-color",
            mapStyle === "satellite" ? "#38bdf8" : "#1e3a8a"
          );
        }
        return;
      }

      map.addSource("sogod-boundary", {
        type: "geojson",
        data: sogodBoundary,
      });

      if (!map.getLayer("sogod-boundary-casing")) {
        map.addLayer({
          id: "sogod-boundary-casing",
          type: "line",
          source: "sogod-boundary",
          paint: {
            "line-color": mapStyle === "satellite" ? "rgba(0, 0, 0, 0.65)" : "rgba(255, 255, 255, 0.85)",
            "line-width": 4.5,
          },
        });
      }

      if (!map.getLayer("sogod-boundary-line")) {
        map.addLayer({
          id: "sogod-boundary-line",
          type: "line",
          source: "sogod-boundary",
          paint: {
            "line-color": mapStyle === "satellite" ? "#38bdf8" : "#1e3a8a",
            "line-width": 2.5,
            "line-dasharray": [4, 3],
          },
        });
      }
    } catch (e) {
      // Ignored during style reload
    }
  }, [mapLoaded, sogodBoundary, styleVersion, mapStyle]);

  /*
   * Roads
   */
  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded || !roads || !map.isStyleLoaded()) return;

    try {
      const existingSource = map.getSource("roads");

      if (existingSource) {
        existingSource.setData(roads);
        return;
      }

      map.addSource("roads", {
        type: "geojson",
        data: roads,
      });

      map.addLayer({
        id: "roads-open",
        type: "line",
        source: "roads",
        filter: ["==", ["get", "is_closed"], false],
        paint: {
          "line-color": "#94a3b8",
          "line-width": 2,
          "line-opacity": 0.65,
        },
      });

      map.addLayer({
        id: "roads-closed",
        type: "line",
        source: "roads",
        filter: ["==", ["get", "is_closed"], true],
        paint: {
          "line-color": "#dc2626",
          "line-width": 4,
          "line-opacity": 0.9,
        },
      });

      const handleOpenRoadClick = (e) => {
        const feature = e.features?.[0];

        if (!feature) return;

        const name = feature.properties?.road_name || "Unnamed road";

        createPopup(name, `<span style="color:#16a34a;">Open</span>`)
          .setLngLat(e.lngLat)
          .addTo(map);
      };

      const handleClosedRoadClick = (e) => {
        const feature = e.features?.[0];

        if (!feature) return;

        const name = feature.properties?.road_name || "Unnamed road";

        createPopup(name, `<span style="color:#dc2626;">🚫 Closed</span>`)
          .setLngLat(e.lngLat)
          .addTo(map);
      };

      const handleMouseEnter = () => {
        map.getCanvas().style.cursor = "pointer";
      };

      const handleMouseLeave = () => {
        map.getCanvas().style.cursor = "";
      };

      if (map.getLayer("roads-open")) {
        map.on("click", "roads-open", handleOpenRoadClick);
        map.on("mouseenter", "roads-open", handleMouseEnter);
        map.on("mouseleave", "roads-open", handleMouseLeave);
      }

      if (map.getLayer("roads-closed")) {
        map.on("click", "roads-closed", handleClosedRoadClick);
        map.on("mouseenter", "roads-closed", handleMouseEnter);
        map.on("mouseleave", "roads-closed", handleMouseLeave);
      }

      return () => {
        try {
          map.off("click", "roads-open", handleOpenRoadClick);
          map.off("click", "roads-closed", handleClosedRoadClick);

          map.off("mouseenter", "roads-open", handleMouseEnter);
          map.off("mouseleave", "roads-open", handleMouseLeave);

          map.off("mouseenter", "roads-closed", handleMouseEnter);
          map.off("mouseleave", "roads-closed", handleMouseLeave);
        } catch (e) {
          // Safe ignore
        }
      };
    } catch (e) {
      // Ignored during style reload
    }
  }, [mapLoaded, roads, styleVersion]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !map.style) return;

    hazardMarkersRef.current.forEach((marker) => marker.remove());
    hazardMarkersRef.current = [];
    if (!showReports) return;

    hazardReports.forEach((report) => {
      const lng = Number(report.longitude ?? report.lng);
      const lat = Number(report.latitude ?? report.lat);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

      const element = createReportMarker(report);
      if (drawMode !== "none") element.style.pointerEvents = "none";

      const marker = new mapboxgl.Marker({ element, anchor: "bottom" })
        .setLngLat([lng, lat])
        .setPopup(
          new mapboxgl.Popup({
            offset: [0, -52],
            className: "ew-popup",
            maxWidth: "290px",
          }).setDOMContent(createReportPopup(report))
        )
        .addTo(map);
      hazardMarkersRef.current.push(marker);
    });

    return () => {
      hazardMarkersRef.current.forEach((marker) => marker.remove());
      hazardMarkersRef.current = [];
    };
  }, [mapLoaded, hazardReports, showReports, drawMode, styleVersion]);

  /*
   * Hazard zones
   */
  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded || !hazardZones || !map.isStyleLoaded()) return;

    try {
      const filtered = {
        ...hazardZones,
        features: (hazardZones.features || []).filter(
          (feature) => visibleLayers[feature.properties?.hazard_type] === true
        ),
      };

      const source = map.getSource("hazard-zones");

      if (source) {
        source.setData(filtered);
        return;
      }

      map.addSource("hazard-zones", {
        type: "geojson",
        data: filtered,
      });

      map.addLayer({
        id: "hazard-zones-fill",
        type: "fill",
        source: "hazard-zones",
        paint: {
          "fill-color": [
            "match",
            ["get", "hazard_type"],
            "flood",
            "#0a9fb5",
            "landslide",
            "#8b5e34",
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

      map.addLayer({
        id: "hazard-zones-line",
        type: "line",
        source: "hazard-zones",
        paint: {
          "line-color": [
            "match",
            ["get", "hazard_type"],
            "flood",
            "#087e99",
            "landslide",
            "#684323",
            "#a82e27",
          ],
          "line-width": 2.5,
        },
      });

      map.addLayer({
        id: "hazard-zones-labels",
        type: "symbol",
        source: "hazard-zones",
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
    } catch (e) {
      // Ignored during style reload
    }
  }, [mapLoaded, hazardZones, visibleLayers, styleVersion]);

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded || !hazardZones) return;

    try {
      hazardMarkersRef.current.forEach((marker) => marker.remove());
      hazardMarkersRef.current = [];

      const visibleFeatures = (hazardZones.features || []).filter(
        (feature) => visibleLayers[feature.properties?.hazard_type] === true
      );

      visibleFeatures.forEach((feature) => {
        const bounds = getGeometryBounds(feature.geometry);
        if (!bounds) return;

        const coordinates = [
          (bounds[0][0] + bounds[1][0]) / 2,
          (bounds[0][1] + bounds[1][1]) / 2,
        ];
        const properties = feature.properties || {};
        const hazardType = String(properties.hazard_type || "hazard").toLowerCase();
        const riskLevel = String(properties.risk_level || "unknown").toLowerCase();
        const element = document.createElement("button");
        element.type = "button";
        element.className = `dashboard-hazard-marker risk-${riskLevel}`;
        element.setAttribute(
          "aria-label",
          `View ${hazardType} hazard: ${properties.name || "Hazard zone"}`
        );

        const badge = document.createElement("span");
        badge.className = "dashboard-hazard-marker-icon";
        badge.innerHTML = icon(
          hazardType === "flood" ? faWater : hazardType === "landslide" ? faMountain : faTriangleExclamation
        ).html.join("");

        const label = document.createElement("span");
        label.className = "dashboard-hazard-marker-label";
        label.textContent = properties.name || `${hazardType} hazard`;
        element.append(badge, label);

        const marker = new mapboxgl.Marker({ element, anchor: "bottom" })
          .setLngLat(coordinates)
          .setPopup(
            new mapboxgl.Popup({ offset: 12 }).setDOMContent(
              createHazardPopup(properties)
            )
          )
          .addTo(map);

        hazardMarkersRef.current.push(marker);
      });

      const handleHazardClick = (event) => {
        const feature = event.features?.[0];
        if (!feature) return;

        new mapboxgl.Popup({ offset: 10 })
          .setLngLat(event.lngLat)
          .setDOMContent(createHazardPopup(feature.properties || {}))
          .addTo(map);
      };

      const handleMouseEnter = () => {
        map.getCanvas().style.cursor = "pointer";
      };
      const handleMouseLeave = () => {
        map.getCanvas().style.cursor = "";
      };

      if (map.getLayer("hazard-zones-fill")) {
        map.on("click", "hazard-zones-fill", handleHazardClick);
        map.on("mouseenter", "hazard-zones-fill", handleMouseEnter);
        map.on("mouseleave", "hazard-zones-fill", handleMouseLeave);
      }

      return () => {
        try {
          hazardMarkersRef.current.forEach((marker) => marker.remove());
          hazardMarkersRef.current = [];
          map.off("click", "hazard-zones-fill", handleHazardClick);
          map.off("mouseenter", "hazard-zones-fill", handleMouseEnter);
          map.off("mouseleave", "hazard-zones-fill", handleMouseLeave);
        } catch (e) {
          // Safe ignore
        }
      };
    } catch (e) {
      // Ignored during style reload
    }
  }, [mapLoaded, hazardZones, visibleLayers, styleVersion]);

  /*
   * Evacuation centers
   */
  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded || !centers || !map.isStyleLoaded()) return;

    try {
      const centerFeatures = (centers.features || []).map((center) => ({
      ...center,
      properties: {
        ...center.properties,
        center_id: center.properties?.id,
        center_name: center.properties?.name || "Evacuation Center",
        center_active: Boolean(center.properties?.is_active),
      },
    }));

    const centerGeoJSON = {
      type: "FeatureCollection",
      features: centerFeatures,
    };

    const existingSource = map.getSource("evacuation-centers");

    if (existingSource) {
      existingSource.setData(centerGeoJSON);
    } else {
      map.addSource("evacuation-centers", {
        type: "geojson",
        data: centerGeoJSON,
      });

      map.addLayer({
        id: "evac-centers-fill",
        type: "fill",
        source: "evacuation-centers",
        paint: {
          "fill-color": ["case", ["get", "center_active"], "#16a34a", "#9ca3af"],
          "fill-opacity": 0.25,
        },
      });

      map.addLayer({
        id: "evac-centers-line",
        type: "line",
        source: "evacuation-centers",
        paint: {
          "line-color": ["case", ["get", "center_active"], "#16a34a", "#9ca3af"],
          "line-width": 2,
        },
      });
    }

    /*
     * Center click
     */
    const centerClick = (e) => {
      if (drawMode === "room") {
        return;
      }

      const feature = e.features?.[0];

      if (!feature) return;

      const originalCenter = (centers.features || []).find(
        (center) =>
          String(center.properties?.id) === String(feature.properties?.center_id)
      );

      if (!originalCenter) return;

      setSelectedRoom(null);
      setSelectedCenter(originalCenter);
      if (onCenterClick) {
        onCenterClick(originalCenter);
      }
    };

    const handleMouseEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };

    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = "";
    };

    map.off("click", "evac-centers-fill", centerClick);
    map.on("click", "evac-centers-fill", centerClick);

    map.on("mouseenter", "evac-centers-fill", handleMouseEnter);
    map.on("mouseleave", "evac-centers-fill", handleMouseLeave);

    /*
     * Entrance markers
     */
    const oldMarkers = map.__evacwayEntranceMarkers || [];

    oldMarkers.forEach((marker) => {
      marker.remove();
    });

    const newMarkers = [];

    (centers.features || []).forEach((center) => {
      const entrances = center.properties?.entrances || [];

      entrances.forEach((entrance) => {
        const lng = Number(entrance?.lng ?? entrance?.longitude);
        const lat = Number(entrance?.lat ?? entrance?.latitude);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

        const element = document.createElement("div");

        element.style.width = "14px";
        element.style.height = "14px";
        element.style.borderRadius = "50%";
        element.style.background = "#2563eb";
        element.style.border = "2px solid white";
        element.style.boxShadow = "0 2px 6px rgba(0,0,0,0.3)";
        element.style.cursor = "pointer";

        const marker = new mapboxgl.Marker({
          element,
          anchor: "center",
        })
          .setLngLat([lng, lat])
          .setPopup(
            createPopup(
              "Entrance",
              `Entrance — ${center.properties?.name || "Evacuation Center"}`
            )
          )
          .addTo(map);

        newMarkers.push(marker);
      });
    });

    map.__evacwayEntranceMarkers = newMarkers;

    return () => {
      try {
        map.off("click", "evac-centers-fill", centerClick);
        map.off("mouseenter", "evac-centers-fill", handleMouseEnter);
        map.off("mouseleave", "evac-centers-fill", handleMouseLeave);
      } catch (e) {}
    };
    } catch (e) {
      // Ignored during style reload
    }
  }, [mapLoaded, centers, onCenterClick, drawMode, styleVersion]);

  /*
   * Center markers for mapped centers:
   * A round marker with a building icon, colored by occupancy rule.
   * Selected center is larger with a ring.
   * Name label appears from zoom 14.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !centers || !map.style) return;

    centerMarkersRef.current.forEach((item) => {
      if (item.marker) item.marker.remove();
    });
    centerMarkersRef.current = [];

    const mappedCenters = (centers.features || []).filter(isCenterMapped);
    const currentZ = map.getZoom();
    const isZ14 = currentZ >= 14;

    const activeSelected =
      selectedCenterProp !== undefined ? selectedCenterProp : selectedCenter;
    const selectedId =
      activeSelected?.properties?.id ?? activeSelected?.id ?? null;

    const newMarkers = [];

    mappedCenters.forEach((center) => {
      const coords = getCenterCoordinates(center);
      if (!coords) return;

      const props = center.properties || center || {};
      const centerId = props.id ?? center.id;
      const isSelected =
        selectedId !== null && String(centerId) === String(selectedId);
      const capacity = Number(props.capacity || 0);
      const occupied = Number(props.occupied || 0);
      const occStatus = getOccupancyStatus(occupied, capacity);

      const element = document.createElement("button");
      element.type = "button";
      element.className = `evacway-center-marker ${
        isSelected ? "is-selected" : ""
      } ${isZ14 ? "show-label" : ""}`;
      element.setAttribute(
        "aria-label",
        `Evacuation Center: ${props.name || "Center"}, ${occStatus.percent}% occupied (${occStatus.statusText})`
      );

      const pin = document.createElement("span");
      pin.className = "evacway-center-pin";
      pin.style.backgroundColor = occStatus.color;
      pin.innerHTML = icon(faBuildingColumns).html.join("");

      const label = document.createElement("span");
      label.className = "evacway-center-label";
      label.textContent = props.name || "Evacuation Center";

      element.appendChild(pin);
      element.appendChild(label);

      element.addEventListener("click", (e) => {
        e.stopPropagation();
        setSelectedCenter(center);
        if (onCenterClick) {
          onCenterClick(center);
        }
      });

      const marker = new mapboxgl.Marker({
        element,
        anchor: "center",
      })
        .setLngLat([coords.longitude, coords.latitude])
        .addTo(map);

      newMarkers.push({ marker, element, label, centerId });
    });

    centerMarkersRef.current = newMarkers;

    return () => {
      newMarkers.forEach((item) => {
        if (item.marker) item.marker.remove();
      });
    };
  }, [
    mapLoaded,
    centers,
    selectedCenter,
    selectedCenterProp,
    onCenterClick,
    styleVersion,
  ]);

  /*
   * =========================================================
   * ROOM MARKERS
   * =========================================================
   *
   * Fresh rooms from the manager come FIRST so they win over the
   * (possibly stale) database copy when removing duplicates.
   */
  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded) return;

    function removeRoomMarkers() {
      const oldMarkers = map.__evacwayRoomMarkers || [];

      oldMarkers.forEach((marker) => {
        marker.remove();
      });

      map.__evacwayRoomMarkers = [];
    }

    function showRoomMarkers() {
      removeRoomMarkers();

      if (map.getZoom() < ROOM_MIN_ZOOM) {
        return;
      }

      const allRooms = [...rooms, ...loadedRooms];

      const uniqueRooms = [];
      const roomKeys = new Set();

      allRooms.forEach((room) => {
        const key =
          room.id != null
            ? `id-${room.id}`
            : `room-${room.evacuation_center_id}-${room.room_number}-${room.latitude}-${room.longitude}`;

        if (roomKeys.has(key)) {
          return;
        }

        roomKeys.add(key);
        uniqueRooms.push(room);
      });

      const newMarkers = [];

      uniqueRooms.forEach((room) => {
        /*
         * Not mapped yet: do not display.
         */
        if (room.latitude == null || room.longitude == null) {
          return;
        }

        const latitude = Number(room.latitude);
        const longitude = Number(room.longitude);

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          return;
        }

        const element = document.createElement("div");
        element.className = "evacway-room-marker";

        const iconElement = document.createElement("span");
        iconElement.className = "evacway-room-icon";
        iconElement.innerHTML = icon(faDoorOpen).html.join("");

        const label = document.createElement("span");
        label.className = "evacway-room-label";
        label.textContent = room.room_number || "Room";

        element.appendChild(iconElement);
        element.appendChild(label);

        element.addEventListener("click", (event) => {
          event.stopPropagation();
          roomMarkerClickRef.current?.(room);
        });

        const marker = new mapboxgl.Marker({
          element,
          anchor: "bottom",
        })
          .setLngLat([longitude, latitude])
          .addTo(map);

        newMarkers.push(marker);
      });

      map.__evacwayRoomMarkers = newMarkers;
    }

    showRoomMarkers();

    const handleZoom = () => {
      showRoomMarkers();
    };

    map.on("zoomend", handleZoom);

    return () => {
      map.off("zoomend", handleZoom);
      removeRoomMarkers();
    };
  }, [mapLoaded, loadedRooms, rooms]);


  /*
  * Evacuation center icon markers (zoomed out)
  */
  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded) return;

    function removeCenterMarkers() {
      (map.__evacwayCenterMarkers || []).forEach((marker) => {
        marker.remove();
      });

      map.__evacwayCenterMarkers = [];
    }

    function showCenterMarkers() {
      removeCenterMarkers();

      // Zoomed in: the polygon and room markers are visible instead
      if (map.getZoom() >= ROOM_MIN_ZOOM) {
        return;
      }

      const newMarkers = [];

      (centers?.features || []).forEach((center) => {
        const bounds = getGeometryBounds(center.geometry);

        if (!bounds) return;

        const lng = (bounds[0][0] + bounds[1][0]) / 2;
        const lat = (bounds[0][1] + bounds[1][1]) / 2;

        const active = Boolean(center.properties?.is_active);
        const isSelected =
          Boolean(selectedCenter) &&
          String(selectedCenter.properties?.id ?? selectedCenter.id) ===
            String(center.properties?.id ?? center.id);

        const element = document.createElement("div");
        element.className = `evacway-center-marker ${
          active ? "" : "evacway-center-marker-inactive"
        } ${isSelected ? "is-selected" : ""}`;

        if (isSelected) {
          const beacon = document.createElement("span");
          beacon.className = "center-pulse-beacon";
          element.appendChild(beacon);
        }

        const iconElement = document.createElement("span");
        iconElement.className = "evacway-center-icon";
        iconElement.innerHTML = icon(faBuildingColumns).html.join("");

        const label = document.createElement("span");
        label.className = "evacway-center-label";
        label.textContent = center.properties?.name || "Evacuation Center";

        element.appendChild(iconElement);
        element.appendChild(label);

        element.addEventListener("click", (event) => {
          event.stopPropagation();

          if (drawMode === "room") return;

          setSelectedRoom(null);
          setSelectedCenter(center);
          if (onCenterClick) {
            onCenterClick(center);
          }
        });

        const marker = new mapboxgl.Marker({
          element,
          anchor: "bottom",
        })
          .setLngLat([lng, lat])
          .addTo(map);

        newMarkers.push(marker);
      });

      map.__evacwayCenterMarkers = newMarkers;
    }

    showCenterMarkers();

    map.on("zoomend", showCenterMarkers);

    return () => {
      map.off("zoomend", showCenterMarkers);
      removeCenterMarkers();
    };
  }, [mapLoaded, centers, drawMode, styleVersion, selectedCenter]);

  /*
   * Temporary room location marker
   */
  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded) return;

    const oldMarker = map.__evacwayPendingRoomMarker;

    if (oldMarker) {
      oldMarker.remove();
      map.__evacwayPendingRoomMarker = null;
    }

    if (drawMode !== "room" || !pendingRoomLocation) {
      return;
    }

    const latitude = Number(pendingRoomLocation.lat);
    const longitude = Number(pendingRoomLocation.lng);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      console.warn("INVALID PENDING ROOM LOCATION:", pendingRoomLocation);
      return;
    }

    const element = document.createElement("div");

    element.style.width = "20px";
    element.style.height = "20px";
    element.style.borderRadius = "50%";
    element.style.background = "#dc2626";
    element.style.border = "3px solid white";
    element.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.45)";
    element.style.boxSizing = "border-box";
    element.style.cursor = "pointer";
    element.title = "Selected room location";

    const marker = new mapboxgl.Marker({
      element,
      anchor: "center",
    })
      .setLngLat([longitude, latitude])
      .addTo(map);

    map.__evacwayPendingRoomMarker = marker;

    return () => {
      if (map.__evacwayPendingRoomMarker === marker) {
        marker.remove();
        map.__evacwayPendingRoomMarker = null;
      }
    };
  }, [mapLoaded, drawMode, pendingRoomLocation, styleVersion]);

  /*
   * Pending footprint (only displayed when drawMode === "footprint" or "entrance")
   */
  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded || !map.style) return;

    const isActive =
      (drawMode === "footprint" || drawMode === "entrance") &&
      pendingFootprint &&
      pendingFootprint.length > 0;

    const polygonCoordinates = isActive
      ? [pendingFootprint.map((point) => [point.lng, point.lat])]
      : [];

    const footprintData = {
      type: "FeatureCollection",
      features:
        polygonCoordinates.length > 0
          ? [
              {
                type: "Feature",
                properties: {},
                geometry: {
                  type: "Polygon",
                  coordinates: polygonCoordinates,
                },
              },
            ]
          : [],
    };

    try {
      const source = map.getSource("pending-footprint");

      if (source) {
        source.setData(footprintData);
      } else {
        map.addSource("pending-footprint", {
          type: "geojson",
          data: footprintData,
        });

        map.addLayer({
          id: "pending-footprint-fill",
          type: "fill",
          source: "pending-footprint",
          paint: {
            "fill-color": "#2563eb",
            "fill-opacity": 0.15,
          },
        });

        map.addLayer({
          id: "pending-footprint-line",
          type: "line",
          source: "pending-footprint",
          paint: {
            "line-color": "#2563eb",
            "line-width": 2.5,
          },
        });
      }
    } catch (e) {
      // Map style not ready or map destroyed
    }

    const oldMarkers = map.__evacwayFootprintMarkers || [];
    oldMarkers.forEach((marker) => {
      marker.remove();
    });
    map.__evacwayFootprintMarkers = [];

    if (isActive) {
      const newMarkers = [];
      pendingFootprint.forEach((point, index) => {
        const lng = Number(point?.lng ?? point?.longitude);
        const lat = Number(point?.lat ?? point?.latitude);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

        const isFirst = index === 0;
        const element = document.createElement("div");
        element.className = `cpf-vertex-marker ${isFirst ? "cpf-first-vertex" : ""}`;

        if (isFirst) {
          element.setAttribute("aria-label", "First vertex - click to close shape");
          if (pendingFootprint.length >= 3) {
            element.title = "Click to close shape";
            element.addEventListener("click", (e) => {
              e.stopPropagation();
              if (onCloseShape) onCloseShape();
            });
          }
        }

        const marker = new mapboxgl.Marker({
          element,
          anchor: "center",
        })
          .setLngLat([lng, lat])
          .addTo(map);

        newMarkers.push(marker);
      });

      map.__evacwayFootprintMarkers = newMarkers;
    }

    return () => {
      try {
        const markers = map.__evacwayFootprintMarkers || [];
        markers.forEach((m) => m.remove());
        map.__evacwayFootprintMarkers = [];
        if (mapRef.current === map && map.style && typeof map.getSource === "function") {
          const s = map.getSource("pending-footprint");
          if (s) {
            s.setData({ type: "FeatureCollection", features: [] });
          }
        }
      } catch (e) {
        // Safe ignore during unmount / destruction
      }
    };
  }, [mapLoaded, drawMode, pendingFootprint, styleVersion, onCloseShape]);

  /*
   * Pending entrances (only displayed when drawMode === "entrance")
   */
  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded || !map.style) return;

    const oldMarkers = map.__evacwayPendingEntranceMarkers || [];
    oldMarkers.forEach((marker) => {
      marker.remove();
    });
    map.__evacwayPendingEntranceMarkers = [];

    const isActive =
      (drawMode === "entrance" || drawMode === "confirm") &&
      pendingEntrances &&
      pendingEntrances.length > 0;

    if (isActive) {
      const newMarkers = [];
      pendingEntrances.forEach((point, index) => {
        const lng = Number(point?.lng ?? point?.longitude);
        const lat = Number(point?.lat ?? point?.latitude);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

        const element = document.createElement("div");
        element.className = "cpf-entrance-marker";
        element.title = `Entrance ${index + 1}`;
        element.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 20V6a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v14"/><path d="M2 20h20"/><path d="M14 12v.01"/></svg>`;

        const marker = new mapboxgl.Marker({
          element,
          anchor: "center",
        })
          .setLngLat([lng, lat])
          .setPopup(createPopup(`Entrance ${index + 1}`, "Building entrance"))
          .addTo(map);

        newMarkers.push(marker);
      });

      map.__evacwayPendingEntranceMarkers = newMarkers;
    }

    return () => {
      try {
        const markers = map.__evacwayPendingEntranceMarkers || [];
        markers.forEach((m) => m.remove());
        map.__evacwayPendingEntranceMarkers = [];
      } catch (e) {
        // Safe ignore
      }
    };
  }, [mapLoaded, drawMode, pendingEntrances, styleVersion]);

  /*
   * Drawing / map click & cursor tracking
   */
  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded || !map.style) return;

    const handleMouseMove = (event) => {
      if (mappingTool === "pan") {
        map.getCanvas().style.cursor = "grab";
        return;
      }
      if (drawMode === "entrance") {
        const isInside = isPointInOrNearPolygon(
          { lng: event.lngLat.lng, lat: event.lngLat.lat },
          pendingFootprint,
          15
        );
        map.getCanvas().style.cursor = isInside ? "crosshair" : "not-allowed";
      } else if (drawMode === "footprint") {
        map.getCanvas().style.cursor = "crosshair";
      } else {
        map.getCanvas().style.cursor = "";
      }
    };

    const handleClick = (event) => {
      if (drawMode === "none" || !onMapClick) return;
      if (mappingTool === "pan") return; // In Pan mode taps place nothing

      if (drawMode === "entrance") {
        const isInside = isPointInOrNearPolygon(
          { lng: event.lngLat.lng, lat: event.lngLat.lat },
          pendingFootprint,
          15
        );
        if (!isInside) {
          if (onOutsideOutlineClick) onOutsideOutlineClick();
          return;
        }
      }

      onMapClick({
        lat: event.lngLat.lat,
        lng: event.lngLat.lng,
      });
    };

    map.on("mousemove", handleMouseMove);
    map.on("click", handleClick);

    try {
      if (drawMode !== "none") {
        map.getCanvas().style.cursor = mappingTool === "pan" ? "grab" : "crosshair";
      } else {
        map.getCanvas().style.cursor = "";
      }
    } catch (e) {
      // Ignored
    }

    return () => {
      try {
        map.off("mousemove", handleMouseMove);
        map.off("click", handleClick);

        if (mapRef.current === map && map.style) {
          const canvas = map.getCanvas?.();

          if (canvas) {
            canvas.style.cursor = "";
          }
        }
      } catch {
        // Ignored
      }
    };
  }, [
    mapLoaded,
    drawMode,
    onMapClick,
    mappingTool,
    pendingFootprint,
    onOutsideOutlineClick,
  ]);

  /*
   * Geocoding search for drawing mode using Mapbox Geocoding API
   */
  useEffect(() => {
    const query = drawingSearchText.trim();
    if (query.length < 2) {
      const timeout = setTimeout(() => {
        setDrawingSearchResults([]);
        setDrawingSearching(false);
      }, 0);
      return () => clearTimeout(timeout);
    }

    const timeout = setTimeout(async () => {
      setDrawingSearching(true);
      try {
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?country=ph&proximity=${SOGOD_CENTER[0]},${SOGOD_CENTER[1]}&limit=5&access_token=${mapboxgl.accessToken}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          setDrawingSearchResults(data.features || []);
        } else {
          setDrawingSearchResults([]);
        }
      } catch (err) {
        console.warn("Geocoding search failed:", err);
        setDrawingSearchResults([]);
      } finally {
        setDrawingSearching(false);
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [drawingSearchText]);

  const selectDrawingSearchResult = (feature) => {
    const map = mapRef.current;
    if (!map || !feature) return;
    const coords = feature.center || feature.geometry?.coordinates;
    if (coords && Array.isArray(coords) && coords.length === 2) {
      map.flyTo({
        center: coords,
        zoom: 18,
        duration: 1000,
      });
    }
    setDrawingSearchText(feature.text || feature.place_name);
    setShowDrawingSearchResults(false);
  };

  /*
   * My Location button (navigator.geolocation) flies to user at zoom 18 and shows blue dot
   */
  const handleMyLocation = () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser.");
      return;
    }
    setLocatingUser(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocatingUser(false);
        const { longitude, latitude } = position.coords;
        const map = mapRef.current;
        if (map) {
          map.flyTo({
            center: [longitude, latitude],
            zoom: 18,
            duration: 1000,
          });

          if (userLocationMarkerRef.current) {
            userLocationMarkerRef.current.setLngLat([longitude, latitude]);
          } else {
            const el = document.createElement("div");
            el.className = "ecm-blue-dot-marker";
            userLocationMarkerRef.current = new mapboxgl.Marker({
              element: el,
              anchor: "center",
            })
              .setLngLat([longitude, latitude])
              .addTo(map);
          }
        }
      },
      (err) => {
        setLocatingUser(false);
        console.warn("Geolocation failed:", err);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  /*
   * Search
   */
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
         * Search evacuation centers
         */
        if (centers?.features) {
          centers.features.forEach((center) => {
            const name = displayEntityName(
              center.properties?.name ?? center.properties?.center_name,
              "Evacuation Center"
            );

            const address = displayEntityName(
              center.properties?.address ?? center.properties?.location
            );

            const searchValue = `${name} ${address}`.toLowerCase();

            if (searchValue.includes(query.toLowerCase())) {
              results.push({
                type: "evacuation_center",
                name,
                subtitle: "Evacuation Center",
                feature: center,
              });
            }
          });
        }

        /*
         * Search barangays using Mapbox
         */
        const encodedQuery = encodeURIComponent(query);

        const url =
          `https://api.mapbox.com/search/geocode/v6/forward` +
          `?q=${encodedQuery}` +
          `&proximity=${SOGOD_CENTER[0]},${SOGOD_CENTER[1]}` +
          `&bbox=${SOGOD_BOUNDS[0][0]},${SOGOD_BOUNDS[0][1]},${SOGOD_BOUNDS[1][0]},${SOGOD_BOUNDS[1][1]}` +
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
  }, [searchText, centers]);

  /*
   * Zoom to search result
   */
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

      setSelectedRoom(null);
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

  /*
   * Edit selected center
   */
  function handleEditCenter() {
    if (!selectedCenter) return;

    if (onCenterClick) {
      onCenterClick(selectedCenter);
    }

    setSelectedRoom(null);
    setSelectedCenter(null);
  }

  /*
   * Close center details
   */
  function handleCloseCenterDetails() {
    setSelectedRoom(null);
    setSelectedCenter(null);
  }

  /*
   * Back from room details
   */
  function handleBackToCenterDetails() {
    setSelectedRoom(null);
  }

  /*
   * Selected center properties
   */
  const selectedCenterProperties = selectedCenter?.properties || {};

  const selectedCenterId =
    selectedCenterProperties.id ??
    selectedCenterProperties.center_id ??
    selectedCenterProperties.evacuation_center_id ??
    selectedCenter?.id ??
    null;

  const selectedCenterName =
    displayEntityName(
      selectedCenterProperties.name ?? selectedCenterProperties.center_name,
      "Evacuation Center"
    );

  const selectedCenterAddress =
    displayEntityName(selectedCenterProperties.address ?? selectedCenterProperties.location) || null;

  const selectedCenterBarangays = Array.isArray(selectedCenterProperties.barangays)
    ? selectedCenterProperties.barangays
    : (selectedCenterProperties.barangay_name ?? selectedCenterProperties.barangay)
      ? [{ name: selectedCenterProperties.barangay_name ?? selectedCenterProperties.barangay }]
      : [];

  const selectedCenterCapacity =
    selectedCenterProperties.capacity ??
    selectedCenterProperties.max_capacity ??
    null;

  const selectedCenterActive = selectedCenterProperties.is_active;

  const selectedCenterDescription = selectedCenterProperties.description || null;

  /*
   * All rooms of the selected center (database rooms included, so
   * Center Details works without EvacuationCenterManager).
   */
  const selectedCenterRooms = (() => {
    if (selectedCenterId == null) {
      return [];
    }

    const allRooms = [...rooms, ...loadedRooms];

    const matchingRooms = allRooms.filter((room) => {
      const roomCenterId =
        room.evacuation_center_id ??
        room.center_id ??
        room.evacuationCenterId ??
        room.evacuation_center?.id ??
        room.center?.id;

      if (roomCenterId == null) {
        return false;
      }

      return String(roomCenterId) === String(selectedCenterId);
    });

    const uniqueRooms = [];
    const roomKeys = new Set();

    matchingRooms.forEach((room) => {
      const key =
        room.id != null
          ? `id-${room.id}`
          : `room-${room.room_number}-${room.capacity}`;

      if (roomKeys.has(key)) {
        return;
      }

      roomKeys.add(key);
      uniqueRooms.push(room);
    });

    uniqueRooms.sort((a, b) =>
      String(a.room_number ?? "").localeCompare(
        String(b.room_number ?? ""),
        undefined,
        {
          numeric: true,
          sensitivity: "base",
        }
      )
    );

    return uniqueRooms;
  })();

  /*
   * Selected room occupancy
   */
  const selectedRoomCapacity = Number(selectedRoom?.capacity || 0);

  const selectedRoomPercent =
    selectedRoomCapacity > 0
      ? Math.min(
          100,
          Math.round((roomFamilies.occupied / selectedRoomCapacity) * 100)
        )
      : 0;

  /*
   * Layer buttons
   */
  function toggleFlood() {
    setVisibleLayers((current) => ({
      ...current,
      flood: !current.flood,
    }));
  }

  function toggleLandslide() {
    setVisibleLayers((current) => ({
      ...current,
      landslide: !current.landslide,
    }));
  }

  return (
    <div className="dashboard-map">
      <div ref={mapContainerRef} className="dashboard-map-container" />

      {/* DRAWING MODE OVERLAYS: Top-Left Search, Top-Right Map/Satellite, Bottom-Right Zoom Stack */}
      {isDrawing && (
        <>
          {/* Top-Left Search Pill (320px wide, 44px tall) */}
          <div className="map-drawing-search">
            <div className="map-drawing-search-box">
              <FontAwesomeIcon icon={faSearch} className="map-drawing-search-icon" />
              <input
                type="text"
                value={drawingSearchText}
                onChange={(e) => {
                  setDrawingSearchText(e.target.value);
                  setShowDrawingSearchResults(true);
                }}
                onFocus={() => {
                  if (drawingSearchResults.length > 0) {
                    setShowDrawingSearchResults(true);
                  }
                }}
                placeholder="Search location in Sogod..."
                className="map-drawing-search-input"
                aria-label="Search location on map"
              />
              {drawingSearching && <span className="map-drawing-search-spinner">...</span>}
              {drawingSearchText && (
                <button
                  type="button"
                  className="map-drawing-search-clear"
                  onClick={() => {
                    setDrawingSearchText("");
                    setDrawingSearchResults([]);
                  }}
                  aria-label="Clear search"
                >
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              )}
            </div>

            {showDrawingSearchResults && drawingSearchResults.length > 0 && (
              <div className="map-drawing-search-results">
                {drawingSearchResults.map((result, idx) => (
                  <button
                    key={result.id || idx}
                    type="button"
                    className="map-drawing-search-result-item"
                    onClick={() => selectDrawingSearchResult(result)}
                  >
                    <FontAwesomeIcon icon={faLocationDot} className="map-drawing-result-icon" />
                    <div className="map-drawing-result-text">
                      <strong>{result.text}</strong>
                      <small>{result.place_name}</small>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Top-Right Map | Satellite Segmented Control */}
          <div className="map-drawing-top-right-style">
            <div className="map-style-toggle-pill" role="group" aria-label="Base map style">
              <button
                type="button"
                className={`map-style-btn ${mapStyle === "streets" ? "is-active" : ""}`}
                onClick={() => changeMapStyle("streets")}
                title="Standard Streets Map"
              >
                <FontAwesomeIcon icon={faMap} />
                <span>Map</span>
              </button>
              <button
                type="button"
                className={`map-style-btn ${mapStyle === "satellite" ? "is-active" : ""}`}
                onClick={() => changeMapStyle("satellite")}
                title="Satellite Streets Map"
              >
                <FontAwesomeIcon icon={faSatellite} />
                <span>Satellite</span>
              </button>
            </div>
          </div>

          {/* Bottom-Right ONE vertical group: zoom in, zoom out, my location */}
          <div className="map-drawing-bottom-right-stack" role="toolbar" aria-label="Map controls">
            <button
              type="button"
              className="map-ctrl-btn"
              onClick={() => mapRef.current?.zoomIn()}
              title="Zoom In"
              aria-label="Zoom in"
            >
              <FontAwesomeIcon icon={faPlus} />
            </button>
            <button
              type="button"
              className="map-ctrl-btn"
              onClick={() => mapRef.current?.zoomOut()}
              title="Zoom Out"
              aria-label="Zoom out"
            >
              <FontAwesomeIcon icon={faMinus} />
            </button>
            <button
              type="button"
              className="map-ctrl-btn"
              onClick={handleMyLocation}
              title="Fly to My Current Location"
              disabled={locatingUser}
              aria-label="My location"
            >
              <FontAwesomeIcon icon={faLocationCrosshairs} spin={locatingUser} />
            </button>
          </div>
        </>
      )}

      {/* TOP RIGHT: Single Layers button + Popover with 3 switches & legend (Hidden while drawing) */}
      {!isDrawing && (
        <div className="map-top-right-layers">
          <button
            type="button"
            className={`map-layers-trigger-btn ${activeLayerCount > 0 ? "has-active" : ""}`}
            onClick={() => setLayersMenuOpen((open) => !open)}
            aria-expanded={layersMenuOpen}
            aria-label="Toggle map hazard layers and legend"
            title="Hazard Layers"
          >
            <FontAwesomeIcon icon={faLayerGroup} />
            <span>Layers</span>
            {activeLayerCount > 0 && (
              <span className="map-layers-badge">{activeLayerCount}</span>
            )}
          </button>

          {layersMenuOpen && (
            <div className="map-layers-popover" role="dialog" aria-label="Hazard Layers and Legend">
              <div className="map-layers-popover-header">
                <h4>Hazard Layers</h4>
                <button
                  type="button"
                  className="map-layers-close-btn"
                  onClick={() => setLayersMenuOpen(false)}
                  aria-label="Close layers menu"
                >
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              </div>

              <div className="map-layers-list">
                {/* Flood Switch */}
                <label className="map-layer-row">
                  <div className="map-layer-info">
                    <span className="map-layer-indicator flood-indicator" />
                    <div className="map-layer-texts">
                      <strong>Flood Hazard</strong>
                      <small>MGB high/medium/low flood risk</small>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    className="map-switch"
                    checked={visibleLayers.flood}
                    onChange={toggleFlood}
                  />
                </label>

                {/* Landslide Switch */}
                <label className="map-layer-row">
                  <div className="map-layer-info">
                    <span className="map-layer-indicator landslide-indicator" />
                    <div className="map-layer-texts">
                      <strong>Landslide Hazard</strong>
                      <small>Rain-induced susceptibility zones</small>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    className="map-switch"
                    checked={visibleLayers.landslide}
                    onChange={toggleLandslide}
                  />
                </label>

                {/* Hazard Reports Switch */}
                <label className="map-layer-row">
                  <div className="map-layer-info">
                    <span className="map-layer-indicator reports-indicator" />
                    <div className="map-layer-texts">
                      <strong>Hazard Reports</strong>
                      <small>Validated community alerts ({hazardReports.length})</small>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    className="map-switch"
                    checked={showReports}
                    onChange={() => setShowReports((v) => !v)}
                  />
                </label>
              </div>

              {/* Legend section */}
              <div className="map-layers-legend">
                <span className="map-legend-title">Legend</span>
                <div className="map-legend-items">
                  <div className="map-legend-item">
                    <span className="legend-swatch swatch-flood" />
                    <span>Flood zone</span>
                  </div>
                  <div className="map-legend-item">
                    <span className="legend-swatch swatch-landslide" />
                    <span>Landslide zone</span>
                  </div>
                  <div className="map-legend-item">
                    <span className="legend-swatch swatch-report" />
                    <span>Active report</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* BOTTOM RIGHT: Zoom (+/-), Compass, My Location, and Map/Satellite Toggle (Hidden while drawing) */}
      {!isDrawing && (
        <div className="map-bottom-right-controls" role="toolbar" aria-label="Map Controls">
          {/* Zoom & Compass group */}
          {!hideZoomControls && (
            <div className="map-control-btn-group" role="group" aria-label="Zoom and bearing">
              <button
                type="button"
                className="map-ctrl-btn"
                onClick={() => mapRef.current?.zoomIn()}
                title="Zoom In"
                aria-label="Zoom in"
              >
                <FontAwesomeIcon icon={faPlus} />
              </button>
              <button
                type="button"
                className="map-ctrl-btn"
                onClick={() => mapRef.current?.zoomOut()}
                title="Zoom Out"
                aria-label="Zoom out"
              >
                <FontAwesomeIcon icon={faMinus} />
              </button>
              <button
                type="button"
                className="map-ctrl-btn"
                onClick={() => mapRef.current?.resetNorthPitch({ duration: 300 })}
                title="Reset Compass (Facing North)"
                aria-label="Reset compass"
              >
                <FontAwesomeIcon icon={faCompass} />
              </button>
            </div>
          )}

          {/* My Location Button */}
          <button
            type="button"
            className="map-ctrl-btn map-my-loc-btn"
            onClick={handleMyLocation}
            title="Fly to My Current Location"
            disabled={locatingUser}
            aria-label="My location"
          >
            <FontAwesomeIcon icon={faLocationCrosshairs} spin={locatingUser} />
            <span className="map-loc-label">My location</span>
          </button>

          {/* Map / Satellite Toggle */}
          <div className="map-style-toggle-pill" role="group" aria-label="Base map style">
            <button
              type="button"
              className={`map-style-btn ${mapStyle === "streets" ? "is-active" : ""}`}
              onClick={() => changeMapStyle("streets")}
              title="Standard Streets Map"
            >
              <FontAwesomeIcon icon={faMap} />
              <span>Map</span>
            </button>
            <button
              type="button"
              className={`map-style-btn ${mapStyle === "satellite" ? "is-active" : ""}`}
              onClick={() => changeMapStyle("satellite")}
              title="Satellite Streets Map"
            >
              <FontAwesomeIcon icon={faSatellite} />
              <span>Satellite</span>
            </button>
          </div>
        </div>
      )}

      {/* =====================================================
          ROOM DETAILS
          ===================================================== */}
      {!hideInternalPanel && selectedCenter && selectedRoom && (
        <aside className="mdp-panel">
          <header className="mdp-header">
            <div className="mdp-badge">
              <FontAwesomeIcon icon={faDoorOpen} />
            </div>

            <div className="mdp-heading">
              <small>{selectedCenterName}</small>
              <h3>{selectedRoom.room_number || "Room"}</h3>
            </div>

            <button
              type="button"
              className="mdp-icon-btn"
              onClick={handleCloseCenterDetails}
              aria-label="Close"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </header>

          <div className="mdp-body">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <button
                type="button"
                className="mdp-back"
                onClick={handleBackToCenterDetails}
                style={{ margin: 0 }}
              >
                <FontAwesomeIcon icon={faArrowLeft} /> Back to center
              </button>
              <span
                className={`mdp-pill ${
                  (roomFamilies.families.length > 0 || roomFamilies.occupied > 0)
                    ? "mdp-pill-on"
                    : "mdp-pill-off"
                }`}
              >
                {(roomFamilies.families.length > 0 || roomFamilies.occupied > 0)
                  ? "Assigned"
                  : "Unassigned"}
              </span>
            </div>

            <div className="mdp-occupancy">
              <div className="mdp-occupancy-numbers">
                <div>
                  <strong>{roomFamilies.occupied}</strong>
                  <span>Assigned</span>
                </div>

                <div>
                  <strong>{roomFamilies.available}</strong>
                  <span>Remaining</span>
                </div>

                <div>
                  <strong>{selectedRoomCapacity}</strong>
                  <span>Capacity</span>
                </div>
              </div>

              <div className="mdp-bar">
                <div
                  className={`mdp-bar-fill ${
                    selectedRoomPercent >= 90 ? "mdp-bar-full" : ""
                  }`}
                  style={{ width: `${selectedRoomPercent}%` }}
                />
              </div>
            </div>

            <h4 className="mdp-section-title">
              Assigned families ({roomFamilies.families.length})
            </h4>

            {familiesError && <div className="mdp-error">{familiesError}</div>}

            {familiesLoading ? (
              <div className="mdp-empty">Loading families...</div>
            ) : roomFamilies.families.length === 0 ? (
              <div className="mdp-empty">
                No families are assigned to this room.
              </div>
            ) : (
              <div className="mdp-list">
                {roomFamilies.families.map((family, index) => {
                  const members = Number(family.family_members || 0);
                  const headName = family.household_head_name || "Unnamed";

                  return (
                    <div
                      className="mdp-family"
                      key={
                        family.assignment_id ??
                        family.resident_id ??
                        family.id ??
                        `${headName}-${index}`
                      }
                    >
                      <span className="mdp-avatar">
                        {headName.charAt(0).toUpperCase()}
                      </span>

                      <span className="mdp-list-text">
                        <strong>{headName}</strong>
                        <small>
                          {members} {members === 1 ? "member" : "members"}
                          {displayEntityName(family.barangay) ? `, ${displayEntityName(family.barangay)}` : ""}
                        </small>
                        {family.address && <small>{family.address}</small>}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>
      )}

      {/* =====================================================
          CENTER DETAILS
          ===================================================== */}
      {!hideInternalPanel && selectedCenter && !selectedRoom && (
        <aside className="mdp-panel">
          <header className="mdp-header">
            <div className="mdp-badge">
              <FontAwesomeIcon icon={faBuildingColumns} />
            </div>

            <div className="mdp-heading">
              <small>Evacuation center</small>
              <h3>{selectedCenterName}</h3>
            </div>

            <button
              type="button"
              className="mdp-icon-btn"
              onClick={handleCloseCenterDetails}
              aria-label="Close"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </header>

          <div className="mdp-body">
            <span
              className={`mdp-pill ${
                selectedCenterActive ? "mdp-pill-on" : "mdp-pill-off"
              }`}
            >
              {selectedCenterActive ? "Active" : "Deactivated"}
            </span>

            <div className="mdp-rows">
              {selectedCenterBarangays.length > 0 && (
                <div className="mdp-row">
                  <span>Barangay</span>
                  <div className="mdp-barangay-badges">
                    {selectedCenterBarangays.map((barangay) => (
                      <span
                        key={barangay.id ?? barangay.name}
                        style={{ "--barangay-color": barangay.color || "#2563eb" }}
                      >
                        {displayEntityName(barangay.name)}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {selectedCenterAddress && (
                <div className="mdp-row">
                  <span>Address</span>
                  <strong>{selectedCenterAddress}</strong>
                </div>
              )}

              {selectedCenterCapacity != null && (
                <div className="mdp-row">
                  <span>Capacity</span>
                  <strong>{selectedCenterCapacity} people</strong>
                </div>
              )}
            </div>

            {selectedCenterDescription && (
              <p className="mdp-note">{selectedCenterDescription}</p>
            )}

            <h4 className="mdp-section-title">
              Rooms ({selectedCenterRooms.length})
            </h4>

            {selectedCenterRooms.length === 0 ? (
              <div className="mdp-empty">No rooms added yet.</div>
            ) : (
              <div className="mdp-list">
                {selectedCenterRooms.map((room, index) => {
                  const isRoomAssigned = Boolean(
                    room.is_assigned ||
                    room.assignment_status === "Assigned" ||
                    Number(room.occupied || 0) > 0
                  );
                  return (
                    <button
                      type="button"
                      key={room.id ?? `${room.room_number}-${index}`}
                      className="mdp-list-item"
                      onClick={() => setSelectedRoom(room)}
                    >
                      <span className="mdp-list-icon">
                        <FontAwesomeIcon icon={faDoorOpen} />
                      </span>

                      <span className="mdp-list-text">
                        <strong>{room.room_number || "Room"}</strong>
                        <small>
                          {isRoomAssigned ? "Assigned" : "Unassigned"}
                          {room.capacity != null ? ` · Cap ${room.capacity}` : ""}
                        </small>
                      </span>

                      <FontAwesomeIcon
                        icon={faChevronRight}
                        className="mdp-chevron"
                      />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <footer className="mdp-footer">
            {onCenterClick && (
              <button
                type="button"
                className="mdp-btn mdp-btn-primary"
                onClick={handleEditCenter}
              >
                <FontAwesomeIcon icon={faPen} /> Edit
              </button>
            )}

            <button
              type="button"
              className="mdp-btn"
              onClick={handleCloseCenterDetails}
            >
              Close
            </button>
          </footer>
        </aside>
      )}

    </div>
  );
}

export default DashboardMap;
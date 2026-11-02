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

import { BASE_URL } from "../../services/api";
import {
  usePublicHazardReports,
  useRoadSegments,
  useRoomsForCenters,
  useRoomFamilies,
  useSogodBoundary,
} from "../../hooks/useEvacuationQueries";
import { displayEntityName } from "../../utils/displayEntityName";
import "./DashboardMap.css";
import { isValidatedReport, createReportMarker, createReportPopup } from "../mapReports/mapReports";
import "./MapOverlays.css";
import {
  BUILDINGS_FILL_LAYER,
  initBuildingLayers,
  setSelectedBuilding,
  setBuildingsGeoJSON,
  initEntranceLayers,
  setEntrancesGeoJSON,
} from "../../utils/mapBuildingLayers";
import { polygonToPoints } from "../CenterPlacementFlow/CenterPlacementFlow";
import { createVertexHandleMarkers, updateVertexHandleMarkers } from "../../utils/mapVertexHandles";
import { snapToPolygonEdge } from "../../utils/polygonSnap";

// Max screen distance (px) from the outline for an entrance click to count.
const ENTRANCE_SNAP_TOLERANCE_PX = 14;

/**
 * Snaps a screen point to the footprint outline, in screen-pixel space.
 * Returns the snapped { lng, lat } (ready to store) or null if beyond tolerance.
 */
function snapScreenPointToOutline(map, screenPoint, footprint, tolerancePx) {
  if (!map || !footprint || footprint.length < 3) return null;
  const ringPx = footprint.map((p) =>
    map.project([Number(p.lng ?? p.longitude), Number(p.lat ?? p.latitude)])
  );
  const snapped = snapToPolygonEdge({ x: screenPoint.x, y: screenPoint.y }, ringPx, tolerancePx);
  if (!snapped) return null;
  const ll = map.unproject([snapped.x, snapped.y]);
  return { lng: ll.lng, lat: ll.lat };
}

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
  buildingsGeoJSON = null,
  selectedBuildingId = null,
  onBuildingClick = null,
  onRoomClick,
  hoveredRoomId = null,
  selectedRoomId = null,
  pendingRoomLocation = null,
  focusLocation = null,
  selectedCenter: selectedCenterProp = undefined,
  panelSubView = "details",
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
  onMapBackgroundClick,
  hiddenCenterId = null,
  hiddenBuildingId = null,
  onBasemapBuildingClick,
  onDoubleTapFinish,
  // Entrance edit mode props
  onEntranceDrag = null,
  // Building edit mode props
  editingBuildingId = null,
  editingBuildingPoints = null,
  onEditingBuildingPointsChange = null,
  // Center edit polygon props
  editablePolygon = null,
  onEditablePolygonChange = null,
}) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const hazardMarkersRef = useRef([]);
  const centerMarkersRef = useRef([]);
  const focusPointMarkerRef = useRef(null);
  const currentRoomPopupRef = useRef(null);
  const roomElementsMapRef = useRef({});
  const onRoomClickRef = useRef(onRoomClick);
  onRoomClickRef.current = onRoomClick;
  const onMapBackgroundClickRef = useRef(onMapBackgroundClick);
  onMapBackgroundClickRef.current = onMapBackgroundClick;
  const lastFramedCenterKeyRef = useRef(null);
  const buildingsGeoJSONRef = useRef(buildingsGeoJSON);
  buildingsGeoJSONRef.current = buildingsGeoJSON;
  const selectedBuildingIdRef = useRef(selectedBuildingId);
  selectedBuildingIdRef.current = selectedBuildingId;
  const onBuildingClickRef = useRef(onBuildingClick);
  onBuildingClickRef.current = onBuildingClick;
  const centersRef = useRef(centers);
  centersRef.current = centers;
  const onCenterClickRef = useRef(onCenterClick);
  onCenterClickRef.current = onCenterClick;

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
  const drawModeRef = useRef(drawMode);
  drawModeRef.current = drawMode;
  const roomCursorMarkerRef = useRef(null);
  const entranceCursorMarkerRef = useRef(null);
  const entranceMarkersRef = useRef([]);
  const entranceDragRef = useRef(onEntranceDrag);
  entranceDragRef.current = onEntranceDrag;
  const pendingFootprintRef = useRef(pendingFootprint);
  pendingFootprintRef.current = pendingFootprint;



  // Callback refs so a parent re-render never rebuilds the drawing preview
  const onMapClickRef = useRef(onMapClick);
  const onCloseShapeRef = useRef(onCloseShape);
  const onOutsideOutlineClickRef = useRef(onOutsideOutlineClick);
  const onDoubleTapFinishRef = useRef(onDoubleTapFinish);
  onMapClickRef.current = onMapClick;
  onCloseShapeRef.current = onCloseShape;
  onOutsideOutlineClickRef.current = onOutsideOutlineClick;
  onDoubleTapFinishRef.current = onDoubleTapFinish;
  const fittedRoomBoundsRef = useRef(false);
  const lastFocusRequestedAtRef = useRef(null);

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
   * Framing: when an evacuation center is selected (or when in map_rooms/room mode),
   * fit the map to the school outline (and its room markers) using padding that
   * accounts for the floating sidebar card, so the whole site is visible beside the card,
   * not hidden under it.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || isDrawing) return;

    const activeSelected =
      selectedCenterProp !== undefined ? selectedCenterProp : selectedCenter;
    if (!activeSelected) {
      lastFramedCenterKeyRef.current = null;
      return;
    }

    const centerId =
      activeSelected.properties?.id ?? activeSelected.id ?? null;
    const isRoomMode = drawMode === "room";
    const isMapRooms = panelSubView === "map_rooms";
    const focusStamp = activeSelected._focusAt || "";
    const frameKey = `${centerId}-${isRoomMode ? "room" : isMapRooms ? "maprooms" : "center"}-${focusStamp}`;

    if (lastFramedCenterKeyRef.current === frameKey) return;

    const feature =
      activeSelected.geometry
        ? activeSelected
        : (centers?.features || []).find(
            (c) =>
              String(c.properties?.id ?? c.id) === String(centerId)
          );

    const coordsToInclude = [];

    // 1. School outline coordinates from geometry
    if (feature?.geometry) {
      function collect(coords) {
        if (!Array.isArray(coords)) return;
        if (
          coords.length >= 2 &&
          typeof coords[0] === "number" &&
          typeof coords[1] === "number" &&
          coords[0] !== 0 &&
          coords[1] !== 0
        ) {
          coordsToInclude.push(coords);
          return;
        }
        coords.forEach(collect);
      }
      collect(feature.geometry.coordinates);
    }

    // 2. Also check pendingFootprint if geometry not yet in feature
    if (
      coordsToInclude.length === 0 &&
      pendingFootprint &&
      pendingFootprint.length >= 3
    ) {
      pendingFootprint.forEach((p) => {
        if (p.lng == null && p.longitude == null) return;
        if (p.lat == null && p.latitude == null) return;
        const lng = Number(p.lng ?? p.longitude);
        const lat = Number(p.lat ?? p.latitude);
        if (Number.isFinite(lng) && Number.isFinite(lat) && lng !== 0 && lat !== 0) {
          coordsToInclude.push([lng, lat]);
        }
      });
    }

    // 3. Room markers for this center
    const allRooms = [...rooms, ...loadedRooms];
    allRooms.forEach((r) => {
      if (centerId && String(r.evacuation_center_id) !== String(centerId)) return;
      if (r.latitude == null || r.longitude == null) return;
      const lat = Number(r.latitude);
      const lng = Number(r.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0) {
        coordsToInclude.push([lng, lat]);
      }
    });

    // 4. Fallback to center point if no polygon
    if (coordsToInclude.length === 0) {
      const props =
        feature?.properties || activeSelected.properties || activeSelected;
      if (props.latitude != null && props.longitude != null) {
        const lat = Number(props.latitude);
        const lng = Number(props.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0) {
          coordsToInclude.push([lng, lat]);
        }
      }
    }

    if (coordsToInclude.length === 0) return;
    lastFramedCenterKeyRef.current = frameKey;

    let minLng = coordsToInclude[0][0];
    let maxLng = coordsToInclude[0][0];
    let minLat = coordsToInclude[0][1];
    let maxLat = coordsToInclude[0][1];

    coordsToInclude.forEach(([lng, lat]) => {
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    });

    const isMobile =
      typeof window !== "undefined" ? window.innerWidth <= 768 : false;
    // On desktop, the floating sidebar card is at left: 16px, width: 320px (~336px).
    // Padding of left: 400px ensures at least 40px+ clearance from the card, with at least 60px on other sides.
    const padding = isMobile
      ? { top: 60, bottom: 280, left: 40, right: 40 }
      : { top: 60, bottom: 60, left: 400, right: 60 };

    if (minLng === maxLng && minLat === maxLat) {
      map.flyTo({
        center: [minLng, minLat],
        zoom: isMapRooms || isRoomMode ? 18 : 17,
        padding,
        duration: 800,
      });
    } else {
      map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat],
        ],
        {
          padding,
          maxZoom: isMapRooms || isRoomMode ? 18.5 : 18,
          duration: 800,
        }
      );
    }
  }, [
    mapLoaded,
    selectedCenterProp,
    selectedCenter,
    centers,
    rooms,
    loadedRooms,
    drawMode,
    panelSubView,
    pendingFootprint,
    isDrawing,
  ]);

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
    if (!map || !mapLoaded) return;

    // When in room placement mode, hide the focus pin
    if (drawMode === "room") {
      if (focusPointMarkerRef.current) {
        focusPointMarkerRef.current.remove();
        focusPointMarkerRef.current = null;
      }
      return;
    }

    if (!focusLocation) {
      if (focusPointMarkerRef.current) {
        focusPointMarkerRef.current.remove();
        focusPointMarkerRef.current = null;
      }
      return;
    }
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

    const requestedAt = focusLocation.requestedAt;
    const isNewRequest =
      !requestedAt || requestedAt !== lastFocusRequestedAtRef.current;

    if (isNewRequest && !isSameLocation) {
      if (requestedAt) lastFocusRequestedAtRef.current = requestedAt;
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

    // Only create focus marker pin if focusLocation has a specific incident label (e.g. Hazard Report, Rescue Request)
    // and noPin is not true. Do NOT drop a pin for normal center/place navigation.
    if (!focusLocation.label || focusLocation.noPin === true) {
      return;
    }

    const pinEl = document.createElement("div");
    pinEl.className = "dashboard-focus-pin";
    const labelText = focusLocation.label;
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
  }, [mapLoaded, focusLocation, drawMode]);

  /*
   * Helper to suppress basemap commercial POIs (shops, restaurants)
   * so evacuation center room markers and outlines remain most prominent.
   */
  const suppressPOILayers = (map) => {
    if (!map) return;
    try {
      if (typeof map.setConfigProperty === "function") {
        map.setConfigProperty("basemap", "showPointOfInterestLabels", false);
      }
    } catch (e) {}

    try {
      const layers = map.getStyle()?.layers || [];
      layers.forEach((layer) => {
        if (!layer.id) return;
        const idLower = layer.id.toLowerCase();
        if (
          idLower.includes("poi") ||
          idLower.includes("shop") ||
          idLower.includes("restaurant") ||
          idLower.includes("food") ||
          idLower.includes("commercial")
        ) {
          if (layer.type === "symbol") {
            map.setLayoutProperty(layer.id, "visibility", "none");
          }
        }
      });
    } catch (e) {}
  };

  /*
   * Helper to re-add custom sources and layers after a style change
   */
  const readdCustomSourcesAndLayers = (map) => {
    if (!map || !map.isStyleLoaded()) return;
    suppressPOILayers(map);

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
    // 4. Evacuation centers
    if (centers?.features && !map.getSource("evacuation-centers")) {
      try {
        const centerFeatures = (centers.features || [])
          .filter(
            (center) =>
              center.geometry &&
              (center.geometry.type === "Polygon" ||
                center.geometry.type === "MultiPolygon")
          )
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
          slot: "top",
          paint: {
            "fill-color": ["case", ["get", "center_active"], "#16a34a", "#9ca3af"],
            "fill-opacity": 0.04,
          },
        });

        map.addLayer({
          id: "evac-centers-line",
          type: "line",
          source: "evacuation-centers",
          slot: "top",
          paint: {
            "line-color": ["case", ["get", "center_active"], "#16a34a", "#9ca3af"],
            "line-width": 2,
          },
        });
      } catch (e) {
        // ignore
      }
    }

    // Selected center outline highlight
    try {
      const activeSelected =
        selectedCenterProp !== undefined ? selectedCenterProp : selectedCenter;
      const geom = activeSelected?.geometry;
      const hasGeom =
        geom &&
        (geom.type === "Polygon" || geom.type === "MultiPolygon") &&
        Array.isArray(geom.coordinates) &&
        geom.coordinates.length > 0;

      const selectedData = {
        type: "FeatureCollection",
        features: hasGeom
          ? [
              {
                type: "Feature",
                geometry: geom,
                properties: {},
              },
            ]
          : [],
      };

      if (!map.getSource("selected-center-footprint")) {
        map.addSource("selected-center-footprint", {
          type: "geojson",
          data: selectedData,
        });
        map.addLayer({
          id: "selected-center-fill",
          type: "fill",
          source: "selected-center-footprint",
          slot: "top",
          paint: {
            "fill-color": "#2563eb",
            "fill-opacity": 0.04,
          },
        });
        map.addLayer({
          id: "selected-center-line",
          type: "line",
          source: "selected-center-footprint",
          slot: "top",
          paint: {
            "line-color": "#1d4ed8",
            "line-width": 2,
          },
        });
      } else {
        map.getSource("selected-center-footprint").setData(selectedData);
      }
    } catch (e) {
      // ignore
    }

    // Re-add building layers on style changes
    if (buildingsGeoJSON) {
      try {
        initBuildingLayers(map, onBuildingClick);
        // Filter out the building being edited so it doesn't show in the static layer
        const filteredGeoJSON = editingBuildingId
          ? {
              ...buildingsGeoJSON,
              features: (buildingsGeoJSON.features || []).filter(
                (f) => Number(f.properties?.id ?? f.id) !== Number(editingBuildingId)
              ),
            }
          : buildingsGeoJSON;
        setBuildingsGeoJSON(map, filteredGeoJSON);
        setSelectedBuilding(map, selectedBuildingId);
      } catch (e) {
        // ignore
      }
    }

    // Building edit mode: vertex handles for the polygon being edited
    if (editingBuildingId && editingBuildingPoints && editingBuildingPoints.length >= 3 && onEditingBuildingPointsChange) {
      try {
        // Clean up existing vertex handles
        if (map.__buildingVertexHandles) {
          map.__buildingVertexHandles.removeAll();
          map.__buildingVertexHandles = null;
        }

        // Create vertex handles
        const handles = createVertexHandleMarkers(map, editingBuildingPoints, {
          onVertexDrag: (index, point, isFinal) => {
            const newPoints = [...editingBuildingPoints];
            newPoints[index] = point;
            onEditingBuildingPointsChange(newPoints, isFinal);
          },
          onVertexDelete: (index) => {
            if (editingBuildingPoints.length > 3) {
              const newPoints = editingBuildingPoints.filter((_, i) => i !== index);
              onEditingBuildingPointsChange(newPoints, true);
            }
          },
          onMidpointDrag: (index, point, isFinal) => {
            const newPoints = [...editingBuildingPoints];
            // Insert new vertex after the current index
            newPoints.splice(index + 1, 0, point);
            onEditingBuildingPointsChange(newPoints, isFinal);
          },
          showMidpoints: true,
          minVertices: 3,
        });

        map.__buildingVertexHandles = handles;

        // Also create/edit the editable polygon layer for the building being edited
        const editableCoords = [editingBuildingPoints.map((p) => [p.lng, p.lat])];
        const editableData = {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: { editing: true },
              geometry: {
                type: "Polygon",
                coordinates: editableCoords,
              },
            },
          ],
        };

        if (!map.getSource("editing-building-footprint")) {
          map.addSource("editing-building-footprint", {
            type: "geojson",
            data: editableData,
          });
          map.addLayer({
            id: "editing-building-fill",
            type: "fill",
            source: "editing-building-footprint",
            slot: "top",
            paint: {
              "fill-color": "#2563eb",
              "fill-opacity": 0.15,
            },
          });
          map.addLayer({
            id: "editing-building-line",
            type: "line",
            source: "editing-building-footprint",
            slot: "top",
            paint: {
              "line-color": "#1d4ed8",
              "line-width": 3,
              "line-dasharray": [4, 4],
            },
          });
        } else {
          map.getSource("editing-building-footprint").setData(editableData);
        }
      } catch (e) {
        // ignore
      }
    } else {
      // Clean up vertex handles and editable layer when not editing
      if (map.__buildingVertexHandles) {
        map.__buildingVertexHandles.removeAll();
        map.__buildingVertexHandles = null;
      }
      if (map.getLayer("editing-building-line")) {
        map.removeLayer("editing-building-line");
      }
      if (map.getLayer("editing-building-fill")) {
        map.removeLayer("editing-building-fill");
      }
      if (map.getSource("editing-building-footprint")) {
        map.removeSource("editing-building-footprint");
      }
    }

    // Center edit polygon mode: vertex handles for the center footprint being edited
    if (editablePolygon && editablePolygon.length >= 3 && onEditablePolygonChange) {
      try {
        // Clean up existing vertex handles
        if (map.__centerVertexHandles) {
          map.__centerVertexHandles.removeAll();
          map.__centerVertexHandles = null;
        }

        // Create vertex handles
        const handles = createVertexHandleMarkers(map, editablePolygon, {
          onVertexDrag: (index, point, isFinal) => {
            const newPoints = [...editablePolygon];
            newPoints[index] = point;
            onEditablePolygonChange(newPoints, isFinal);
          },
          onVertexDelete: (index) => {
            if (editablePolygon.length > 3) {
              const newPoints = editablePolygon.filter((_, i) => i !== index);
              onEditablePolygonChange(newPoints, true);
            }
          },
          onMidpointDrag: (index, point, isFinal) => {
            const newPoints = [...editablePolygon];
            // Insert new vertex after the current index
            newPoints.splice(index + 1, 0, point);
            onEditablePolygonChange(newPoints, isFinal);
          },
          showMidpoints: true,
          minVertices: 3,
        });

        map.__centerVertexHandles = handles;

        // Also create/edit the editable polygon layer for the center being edited
        const editableCoords = [editablePolygon.map((p) => [p.lng, p.lat])];
        const editableData = {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: { editing: true },
              geometry: {
                type: "Polygon",
                coordinates: editableCoords,
              },
            },
          ],
        };

        if (!map.getSource("editing-center-footprint")) {
          map.addSource("editing-center-footprint", {
            type: "geojson",
            data: editableData,
          });
          map.addLayer({
            id: "editing-center-fill",
            type: "fill",
            source: "editing-center-footprint",
            slot: "top",
            paint: {
              "fill-color": "#2563eb",
              "fill-opacity": 0.15,
            },
          });
          map.addLayer({
            id: "editing-center-line",
            type: "line",
            source: "editing-center-footprint",
            slot: "top",
            paint: {
              "line-color": "#1d4ed8",
              "line-width": 3,
              "line-dasharray": [4, 4],
            },
          });
        } else {
          map.getSource("editing-center-footprint").setData(editableData);
        }
      } catch (e) {
        // ignore
      }
    } else {
      // Clean up vertex handles and editable layer when not editing
      if (map.__centerVertexHandles) {
        map.__centerVertexHandles.removeAll();
        map.__centerVertexHandles = null;
      }
      if (map.getLayer("editing-center-line")) {
        map.removeLayer("editing-center-line");
      }
      if (map.getLayer("editing-center-fill")) {
        map.removeLayer("editing-center-fill");
      }
      if (map.getSource("editing-center-footprint")) {
        map.removeSource("editing-center-footprint");
      }
    }

    // 5. Outline / Pending footprint (only for non-mapping display; mapping uses draw-preview)
    try {
      const isMappingStep =
        drawMode === "footprint" ||
        drawMode === "entrance" ||
        drawMode === "confirm" ||
        drawMode === "room";

      const isActive =
        !isMappingStep &&
        (drawMode === "footprint" ||
          drawMode === "entrance" ||
          drawMode === "room") &&
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
          slot: "top",
          paint: {
            "fill-color": "#2563eb",
            "fill-opacity": 0.2,
          },
        });
        map.addLayer({
          id: "pending-footprint-line",
          type: "line",
          source: "pending-footprint",
          slot: "top",
          paint: {
            "line-color": "#1d4ed8",
            "line-width": 3.5,
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

  const ensureCenterOutlineLayers = (mapInstance) => {
    const map = mapInstance || mapRef.current;
    const currentCenters = centersRef.current;
    if (!map || !currentCenters) return;

    if (!map.getStyle()) {
      const retry = () => ensureCenterOutlineLayers(map);
      map.once("style.load", retry);
      map.once("load", retry);
      return;
    }

    const centerFeatures = (currentCenters.features || [])
      .filter(
        (center) =>
          center.geometry &&
          (center.geometry.type === "Polygon" ||
            center.geometry.type === "MultiPolygon")
      )
      .map((center) => ({
        ...center,
        properties: {
          ...center.properties,
          center_id: center.properties?.id ?? center.id,
          center_name: center.properties?.name || "Evacuation Center",
          center_active: Boolean(center.properties?.is_active),
        },
      }));

    const centerGeoJSON = {
      type: "FeatureCollection",
      features: centerFeatures,
    };

    try {
      const existingSource = map.getSource("evacuation-centers");
      if (existingSource) {
        existingSource.setData(centerGeoJSON);
      } else {
        map.addSource("evacuation-centers", {
          type: "geojson",
          data: centerGeoJSON,
        });
      }
    } catch (err) {
      const retry = () => ensureCenterOutlineLayers(map);
      map.once("style.load", retry);
      map.once("idle", retry);
      return;
    }

    const beforeLayer = map.getLayer(BUILDINGS_FILL_LAYER)
      ? BUILDINGS_FILL_LAYER
      : undefined;

    try {
      if (!map.getLayer("evac-centers-fill")) {
        map.addLayer(
          {
            id: "evac-centers-fill",
            type: "fill",
            source: "evacuation-centers",
            paint: {
              "fill-color": "#2563eb",
              "fill-opacity": 0.04,
            },
          },
          beforeLayer
        );
      } else {
        map.setPaintProperty("evac-centers-fill", "fill-color", "#2563eb");
        map.setPaintProperty("evac-centers-fill", "fill-opacity", 0.04);
      }

      if (!map.getLayer("evac-centers-line")) {
        map.addLayer(
          {
            id: "evac-centers-line",
            type: "line",
            source: "evacuation-centers",
            layout: {
              "line-join": "round",
              "line-cap": "round",
            },
            paint: {
              "line-color": "#2563eb",
              "line-width": 2,
            },
          },
          beforeLayer
        );
      } else {
        map.setPaintProperty("evac-centers-line", "line-color", "#2563eb");
        map.setPaintProperty("evac-centers-line", "line-width", 2);
      }

      if (map.getLayer(BUILDINGS_FILL_LAYER)) {
        if (map.getLayer("evac-centers-fill")) {
          map.moveLayer("evac-centers-fill", BUILDINGS_FILL_LAYER);
        }
        if (map.getLayer("evac-centers-line")) {
          map.moveLayer("evac-centers-line", BUILDINGS_FILL_LAYER);
        }
      }
    } catch (err) {
      const retry = () => ensureCenterOutlineLayers(map);
      map.once("style.load", retry);
      map.once("idle", retry);
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
          map.setConfigProperty("basemap", "show3dObjects", false);
          map.setConfigProperty("basemap", "showPointOfInterestLabels", false);
        } catch (e) {}
        suppressPOILayers(map);
        try {
          initBuildingLayers(map, (b) => {
            if (onBuildingClickRef.current) onBuildingClickRef.current(b);
          });
          if (buildingsGeoJSONRef.current) {
            setBuildingsGeoJSON(map, buildingsGeoJSONRef.current);
          }
          if (selectedBuildingIdRef.current) {
            setSelectedBuilding(map, selectedBuildingIdRef.current);
          }
          ensureCenterOutlineLayers(map);
        } catch (e) {
          console.warn("Failed to re-add building/center layers on style reload:", e);
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
    if (selectedCenterProp || selectedCenter || focusLocation) return;
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
      minZoom: 11,
      maxZoom: 18.5,
      pitch: 0,
      bearing: 0,
      attributionControl: false,
    });

    mapRef.current = map;
    window.__evacwayMap = map;

    map.on("zoom", () => {
      const z = map.getZoom();
      setCurrentZoom(z);
      if (onZoomChange) onZoomChange(z);
    });

    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(mapContainerRef.current);

    map.on("load", () => {
      try {
        map.setConfigProperty("basemap", "show3dObjects", false);
        map.setConfigProperty("basemap", "showPointOfInterestLabels", false);
      } catch (e) {}
      suppressPOILayers(map);
      setMapLoaded(true);
      const z = map.getZoom();
      setCurrentZoom(z);
      if (onZoomChange) onZoomChange(z);
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

        createPopup(name, `<span style="color:#dc2626;">ðŸš« Closed</span>`)
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
            " Â· ",
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
      ensureCenterOutlineLayers(map);
    } catch (e) {
      // Ignored during style reload
    }

    const syncEntrances = () => {
      try {
        const entranceFeatures = [];
        (centers.features || []).forEach((center) => {
          const entrances = center.properties?.entrances || [];
          entrances.forEach((entrance) => {
            const lng = Number(entrance?.lng ?? entrance?.longitude);
            const lat = Number(entrance?.lat ?? entrance?.latitude);
            if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
            entranceFeatures.push({
              type: "Feature",
              id: entrance.id,
              geometry: { type: "Point", coordinates: [lng, lat] },
              properties: {
                id: entrance.id,
                center_id: center.properties?.id ?? center.id,
                name: entrance.name || "Entrance",
                is_chosen: false,
                is_dimmed: false,
              },
            });
          });
        });

        initEntranceLayers(map);
        setEntrancesGeoJSON(map, { type: "FeatureCollection", features: entranceFeatures });
      } catch (e) {}
    };

    if (map.isStyleLoaded()) {
      syncEntrances();
    } else {
      map.once("style.load", syncEntrances);
      map.once("idle", syncEntrances);
    }

    /*
     * Center click
     */
    const centerClick = (e) => {
      if (drawMode === "room") {
        return;
      }

      if (map.getLayer(BUILDINGS_FILL_LAYER) && e.point) {
        const pad = 12;
        const bbox = [
          [e.point.x - pad, e.point.y - pad],
          [e.point.x + pad, e.point.y + pad],
        ];
        try {
          const bHits = map.queryRenderedFeatures(bbox, {
            layers: [BUILDINGS_FILL_LAYER],
          });
          if (bHits && bHits.length > 0) {
            return;
          }
        } catch (err) {}
      }

      const feature = e.features?.[0];

      if (!feature) return;

      const originalCenter = (centers.features || []).find(
        (center) =>
          String(center.properties?.id ?? center.id) ===
          String(feature.properties?.center_id)
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

    try {
      map.off("click", "evac-centers-fill", centerClick);
      map.on("click", "evac-centers-fill", centerClick);
      map.on("mouseenter", "evac-centers-fill", handleMouseEnter);
      map.on("mouseleave", "evac-centers-fill", handleMouseLeave);
    } catch (e) {}

    return () => {
      try {
        map.off("click", "evac-centers-fill", centerClick);
        map.off("mouseenter", "evac-centers-fill", handleMouseEnter);
        map.off("mouseleave", "evac-centers-fill", handleMouseLeave);
      } catch (e) {}
    };
  }, [mapLoaded, centers, onCenterClick, drawMode, styleVersion]);

  /*
   * Selected center outline highlight effect:
   * Keeps the 2px royal blue (#2563eb) outline below building layers
   * at all zoom levels for whichever evacuation center is currently selected.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !map.style) return;

    const activeSelected =
      selectedCenterProp !== undefined ? selectedCenterProp : selectedCenter;
    const geom = activeSelected?.geometry;
    const hasGeom =
      geom &&
      (geom.type === "Polygon" || geom.type === "MultiPolygon") &&
      Array.isArray(geom.coordinates) &&
      geom.coordinates.length > 0;

    const selectedData = {
      type: "FeatureCollection",
      features: hasGeom
        ? [
            {
              type: "Feature",
              geometry: geom,
              properties: {},
            },
          ]
        : [],
    };

    const applySelectedCenterOutline = () => {
      try {
        const beforeLayer = map.getLayer(BUILDINGS_FILL_LAYER)
          ? BUILDINGS_FILL_LAYER
          : undefined;
        const source = map.getSource("selected-center-footprint");
        if (source) {
          source.setData(selectedData);
          if (map.getLayer("selected-center-fill")) {
            map.setPaintProperty("selected-center-fill", "fill-opacity", 0);
            map.setPaintProperty("selected-center-fill", "fill-color", "#2563eb");
          }
          if (map.getLayer("selected-center-line")) {
            map.setPaintProperty("selected-center-line", "line-width", 2);
            map.setPaintProperty("selected-center-line", "line-color", "#2563eb");
          }
        } else {
          map.addSource("selected-center-footprint", {
            type: "geojson",
            data: selectedData,
          });
          map.addLayer(
            {
              id: "selected-center-fill",
              type: "fill",
              source: "selected-center-footprint",
              paint: {
                "fill-color": "#2563eb",
                "fill-opacity": 0,
              },
            },
            beforeLayer
          );
          map.addLayer(
            {
              id: "selected-center-line",
              type: "line",
              source: "selected-center-footprint",
              paint: {
                "line-color": "#2563eb",
                "line-width": 2,
              },
            },
            beforeLayer
          );
        }
        if (map.getLayer(BUILDINGS_FILL_LAYER)) {
          if (map.getLayer("selected-center-fill")) {
            map.moveLayer("selected-center-fill", BUILDINGS_FILL_LAYER);
          }
          if (map.getLayer("selected-center-line")) {
            map.moveLayer("selected-center-line", BUILDINGS_FILL_LAYER);
          }
        }
      } catch (e) {
        // Style reload in progress
      }
    };

    if (map.isStyleLoaded()) {
      applySelectedCenterOutline();
    } else {
      map.once("style.load", applySelectedCenterOutline);
      map.once("idle", applySelectedCenterOutline);
    }
  }, [mapLoaded, selectedCenter, selectedCenterProp, styleVersion]);

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

      const hasFootprint = Boolean(
        center.geometry &&
        (center.geometry.type === "Polygon" || center.geometry.type === "MultiPolygon")
      );

      const element = document.createElement("button");
      element.type = "button";
      element.className = `evacway-center-marker ${isSelected ? "is-selected" : ""}`;
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
        if (drawMode === "room") return;
        setSelectedRoom(null);
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

      element.__marker = marker;
      element.dataset.lng = coords.longitude;
      element.dataset.lat = coords.latitude;

      newMarkers.push({ marker, element, label, centerId, hasFootprint });
    });

    centerMarkersRef.current = newMarkers;

    function updateMarkerVisibility() {
      const currentZ = map.getZoom();
      const isZoomedIn = currentZ >= 16;
      const isRoomMode = drawMode === "room";

      centerMarkersRef.current.forEach(({ element, centerId, hasFootprint }) => {
        const isSelected =
          selectedId !== null && String(centerId) === String(selectedId);

        // When zoomed in (currentZ >= 16) or in room placement mode:
        // HIDE the center icon and its name if it has a footprint so building polygon outline is visible.
        // If it has NO footprint (e.g. single venue or private house without polygon), keep the marker visible!
        const hideCenterPin = isRoomMode || (isZoomedIn && hasFootprint);

        if (hideCenterPin) {
          element.style.display = "none";
        } else {
          element.style.display = "flex";
          element.style.pointerEvents = "";
          element.style.opacity = "";
          if (isSelected) {
            element.classList.add("is-selected");
          } else {
            element.classList.remove("is-selected");
          }
          // When zoomed out, view the icon and its name
          element.classList.add("show-label");
        }
      });
    }

    updateMarkerVisibility();
    map.on("zoom", updateMarkerVisibility);
    map.on("zoomend", updateMarkerVisibility);

    return () => {
      map.off("zoom", updateMarkerVisibility);
      map.off("zoomend", updateMarkerVisibility);
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
    drawMode,
  ]);

  /*
   * =========================================================
   * ROOM MARKERS
   * =========================================================
   *
   * Fresh rooms from the manager come FIRST so they win over the
   * (possibly stale) database copy when removing duplicates.
   */
  /*
   * Helper: extract room number for compact badge (e.g. "Room 17" -> "17")
   */
  function getRoomBadgeText(roomNumber) {
    if (!roomNumber) return "â€¢";
    const str = String(roomNumber).trim();
    const cleaned = str.replace(/^room\s*/i, "").trim();
    return cleaned || str;
  }

  /*
   * Dynamic hover / selection sync for room markers
   */
  useEffect(() => {
    const elMap = roomElementsMapRef.current || {};
    Object.entries(elMap).forEach(([roomId, el]) => {
      if (!el) return;
      const isHov = hoveredRoomId != null && String(hoveredRoomId) === String(roomId);
      const isSel = selectedRoomId != null && String(selectedRoomId) === String(roomId);
      el.classList.toggle("is-hovered", isHov);
      el.classList.toggle("is-selected", isSel);
    });

    if (selectedRoomId != null && mapRef.current && Array.isArray(rooms)) {
      const targetRoom = rooms.find((r) => String(r.id) === String(selectedRoomId));
      if (targetRoom && targetRoom.latitude != null && targetRoom.longitude != null) {
        const lng = Number(targetRoom.longitude);
        const lat = Number(targetRoom.latitude);
        const cur = mapRef.current.getCenter();
        if (Math.abs(cur.lng - lng) > 0.00005 || Math.abs(cur.lat - lat) > 0.00005) {
          mapRef.current.easeTo({ center: [lng, lat], duration: 500 });
        }
      }
      if (currentRoomPopupRef.current) {
        try {
          currentRoomPopupRef.current.remove();
        } catch (e) {}
        currentRoomPopupRef.current = null;
      }
    }
  }, [hoveredRoomId, selectedRoomId, rooms]);

  /*
   * =========================================================
   * NATIVE MAPBOX BUILDING LAYERS (Replacing Room Pills)
   * =========================================================
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const applyBuildings = () => {
      try {
        initBuildingLayers(map, (buildingFeature) => {
          if (onBuildingClick) {
            onBuildingClick(buildingFeature);
          }
        });

        setBuildingsGeoJSON(map, buildingsGeoJSON);
        setSelectedBuilding(map, selectedBuildingId);
        ensureCenterOutlineLayers(map);
      } catch (e) {
        // Ignored during style reload
      }
    };

    if (map.isStyleLoaded()) {
      applyBuildings();
    } else {
      map.once("style.load", applyBuildings);
      map.once("idle", applyBuildings);
    }
  }, [mapLoaded, buildingsGeoJSON, styleVersion, onBuildingClick, selectedBuildingId]);




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
   * Draw-preview: GeoJSON source + layers for live footprint/outline drawing.
   * Replaces DOM-marker preview. One source "draw-preview" with line, fill and circle layers.
   * Active in ALL mapping steps: footprint, entrance, confirm, room, and building redraw.
   */
  const drawPreviewRef = useRef({ sourceAdded: false, layersAdded: false });

  // Determine if we're in any mapping step where the outline should be visible
  const isMappingStep =
    drawMode === "footprint" ||
    drawMode === "entrance" ||
    drawMode === "confirm" ||
    drawMode === "room";

  function ensureDrawPreviewLayers(map) {
    if (!map || !map.getStyle()) return false;
    try {
      if (!map.getSource("draw-preview")) {
        map.addSource("draw-preview", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        drawPreviewRef.current.sourceAdded = true;
      }
      // Line layer - base style (solid for entrance/confirm, will be updated per step)
      if (!map.getLayer("draw-preview-line")) {
        map.addLayer({ id: "draw-preview-line", type: "line", source: "draw-preview", slot: "top",
          filter: ["==", ["get", "kind"], "line"],
          paint: { "line-color": "#1d4ed8", "line-width": 3 } });
      }
      // Fill layer
      if (!map.getLayer("draw-preview-fill")) {
        map.addLayer({ id: "draw-preview-fill", type: "fill", source: "draw-preview", slot: "top",
          filter: ["==", ["get", "kind"], "fill"],
          paint: { "fill-color": "#2563eb", "fill-opacity": 0.15 } });
      }
      // Circle layer (corner dots)
      if (!map.getLayer("draw-preview-circle")) {
        map.addLayer({ id: "draw-preview-circle", type: "circle", source: "draw-preview", slot: "top",
          filter: ["==", ["get", "kind"], "point"],
          paint: {
            "circle-radius": ["case", ["==", ["get", "isFirst"], true], 8, 6],
            "circle-color": ["case", ["==", ["get", "isFirst"], true], "#2563eb", "#ffffff"],
            "circle-stroke-color": "#2563eb",
            "circle-stroke-width": 2,
          } });
        drawPreviewRef.current.layersAdded = true;
      }
      // Closing segment layer (dashed line from last point to first) - only for footprint step
      if (!map.getLayer("draw-preview-closing")) {
        map.addLayer({ id: "draw-preview-closing", type: "line", source: "draw-preview", slot: "top",
          filter: ["==", ["get", "kind"], "closing"],
          paint: { "line-color": "#1d4ed8", "line-width": 3, "line-dasharray": [4, 4] } });
      }
      return true;
    } catch (e) { return false; }
  }

  function updateDrawPreviewStyle(map, step) {
    if (!map || !map.getStyle()) return;
    try {
      const isFootprint = step === "footprint";
      const isEntranceOrConfirm = step === "entrance" || step === "confirm";
      const isRoom = step === "room";

      // Line: solid for all mapping steps (closing segment handles dashed preview in footprint step)
      if (map.getLayer("draw-preview-line")) {
        map.setPaintProperty("draw-preview-line", "line-width", 3);
        map.setPaintProperty("draw-preview-line", "line-color", "#1d4ed8");
      }

      // Fill: light fill for all steps when polygon is closed (3+ points)
      if (map.getLayer("draw-preview-fill")) {
        map.setPaintProperty("draw-preview-fill", "fill-color", "#2563eb");
        map.setPaintProperty("draw-preview-fill", "fill-opacity", 0.15);
      }

      // Circles: radius 4 for entrance/confirm/room (small corner dots), 6/8 for footprint
      if (map.getLayer("draw-preview-circle")) {
        if (isEntranceOrConfirm || isRoom) {
          // Small corner dots: radius 4, white with #2563eb stroke (all same size)
          map.setPaintProperty("draw-preview-circle", "circle-radius", 4);
          map.setPaintProperty("draw-preview-circle", "circle-color", "#ffffff");
          map.setPaintProperty("draw-preview-circle", "circle-stroke-color", "#2563eb");
          map.setPaintProperty("draw-preview-circle", "circle-stroke-width", 2);
        } else {
          // Footprint step: larger dots, first point blue
          map.setPaintProperty("draw-preview-circle", "circle-radius", ["case", ["==", ["get", "isFirst"], true], 8, 6]);
          map.setPaintProperty("draw-preview-circle", "circle-color", ["case", ["==", ["get", "isFirst"], true], "#2563eb", "#ffffff"]);
          map.setPaintProperty("draw-preview-circle", "circle-stroke-color", "#2563eb");
          map.setPaintProperty("draw-preview-circle", "circle-stroke-width", 2);
        }
      }

      // Closing segment: only visible in footprint step
      if (map.getLayer("draw-preview-closing")) {
        map.setLayoutProperty("draw-preview-closing", "visibility", isFootprint ? "visible" : "none");
      }
    } catch (e) {}
  }

  function rebuildDrawPreview(map, points, step) {
    if (!map || !map.getStyle()) return;
    // Ensure layers exist (create if missing, no-op if present)
    ensureDrawPreviewLayers(map);
    const features = [];
    if (points && points.length > 0) {
      // Main line. In the footprint step it's open (the dashed "closing" segment previews
      // the last edge). In every later step the shape is finished, so close the ring.
      const lineCoords = points.map((p) => [Number(p.lng ?? p.longitude), Number(p.lat ?? p.latitude)]);
      if (step !== "footprint" && lineCoords.length >= 3) {
        lineCoords.push(lineCoords[0]);
      }
      features.push({
        type: "Feature", properties: { kind: "line" },
        geometry: { type: "LineString", coordinates: lineCoords },
      });
      // Closing segment (from last point to first) - only for footprint step
      if (step === "footprint" && points.length >= 2) {
        const coords = points.map((p) => [Number(p.lng ?? p.longitude), Number(p.lat ?? p.latitude)]);
        features.push({
          type: "Feature", properties: { kind: "closing" },
          geometry: { type: "LineString", coordinates: [coords[coords.length - 1], coords[0]] },
        });
      }
      // Fill (closed polygon) - when 3+ points (visible in ALL mapping steps)
      if (points.length >= 3) {
        const ring = points.map((p) => [Number(p.lng ?? p.longitude), Number(p.lat ?? p.latitude)]);
        ring.push(ring[0]);
        features.push({ type: "Feature", properties: { kind: "fill" },
          geometry: { type: "Polygon", coordinates: [ring] } });
      }
      // Corner dots
      points.forEach((p, i) => {
        features.push({ type: "Feature", properties: { kind: "point", isFirst: i === 0 },
          geometry: { type: "Point",
            coordinates: [Number(p.lng ?? p.longitude), Number(p.lat ?? p.latitude)] } });
      });
    }
    try {
      const source = map.getSource("draw-preview");
      if (source) source.setData({ type: "FeatureCollection", features });
    } catch (e) {}
    // Update styling based on step
    updateDrawPreviewStyle(map, step);
  }

  function removeDrawPreview(map) {
    if (!map || !map.getStyle()) return;
    try {
      if (map.getLayer("draw-preview-circle")) map.removeLayer("draw-preview-circle");
      if (map.getLayer("draw-preview-fill")) map.removeLayer("draw-preview-fill");
      if (map.getLayer("draw-preview-line")) map.removeLayer("draw-preview-line");
      if (map.getLayer("draw-preview-closing")) map.removeLayer("draw-preview-closing");
      if (map.getSource("draw-preview")) map.removeSource("draw-preview");
    } catch (e) {}
    drawPreviewRef.current.sourceAdded = false;
    drawPreviewRef.current.layersAdded = false;
  }

  // This effect manages the draw-preview lifecycle across mapping steps.
  // It ensures the outline persists in ALL mapping steps (footprint, entrance, confirm, room)
  // and only removes it when exiting mapping mode entirely (drawMode becomes "none").
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // Only remove draw-preview when EXITING mapping mode entirely (drawMode becomes "none")
    const wasMapping = drawPreviewRef.current.wasMapping ?? false;
    const isMappingNow = isMappingStep;

    // Track if we were in mapping mode before
    drawPreviewRef.current.wasMapping = isMappingNow;

    // If we just exited mapping mode, clean up
    if (wasMapping && !isMappingNow) {
      removeDrawPreview(map);
      return;
    }

    // If we're in a mapping step, ensure layers exist and rebuild with current points + step
    if (isMappingNow) {
      const points = pendingFootprint && pendingFootprint.length > 0 ? pendingFootprint : [];

      // Handle style changes: recreate layers and repaint data
      const handleStyleData = () => {
        drawPreviewRef.current.sourceAdded = false;
        drawPreviewRef.current.layersAdded = false;
        ensureDrawPreviewLayers(map);
        rebuildDrawPreview(map, points, drawMode);
      };
      map.once("styledata", handleStyleData);

      // Ensure layers exist now (or on next idle/style.load if style not ready)
      if (!ensureDrawPreviewLayers(map)) {
        const onIdle = () => {
          ensureDrawPreviewLayers(map);
          rebuildDrawPreview(map, points, drawMode);
        };
        map.once("idle", onIdle);
        map.once("style.load", onIdle);
      }

      // Always rebuild with current step's styling
      rebuildDrawPreview(map, points, drawMode);

      return () => {
        try { map.off("styledata", handleStyleData); } catch {}
      };
    }
  }, [mapLoaded, drawMode, pendingFootprint, styleVersion]);
  // Apply/remove layer filters for hidden center/building during redraw
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !map.getStyle()) return;

    // Center filter
    const centerFill = map.getLayer("evac-centers-fill");
    const centerLine = map.getLayer("evac-centers-line");
    if (hiddenCenterId) {
      if (centerFill) map.setFilter("evac-centers-fill", ["!=", ["get", "id"], String(hiddenCenterId)]);
      if (centerLine) map.setFilter("evac-centers-line", ["!=", ["get", "id"], String(hiddenCenterId)]);
    } else {
      if (centerFill) map.setFilter("evac-centers-fill", null);
      if (centerLine) map.setFilter("evac-centers-line", null);
    }

    // Building filter
    const bldFill = map.getLayer("evacway-buildings-fill");
    const bldOutline = map.getLayer("evacway-buildings-outline");
    const bldHalo = map.getLayer("evacway-buildings-outline-halo");
    const bldSymbol = map.getLayer("evacway-buildings-symbol");
    if (hiddenBuildingId) {
      if (bldFill) map.setFilter("evacway-buildings-fill", ["!=", ["get", "id"], String(hiddenBuildingId)]);
      if (bldOutline) map.setFilter("evacway-buildings-outline", ["!=", ["get", "id"], String(hiddenBuildingId)]);
      if (bldHalo) map.setFilter("evacway-buildings-outline-halo", ["!=", ["get", "id"], String(hiddenBuildingId)]);
      if (bldSymbol) map.setFilter("evacway-buildings-symbol", ["!=", ["get", "id"], String(hiddenBuildingId)]);
    } else {
      if (bldFill) map.setFilter("evacway-buildings-fill", null);
      if (bldOutline) map.setFilter("evacway-buildings-outline", null);
      if (bldHalo) map.setFilter("evacway-buildings-outline-halo", null);
      if (bldSymbol) map.setFilter("evacway-buildings-symbol", null);
    }
  }, [mapLoaded, styleVersion, hiddenCenterId, hiddenBuildingId]);

  /*
   * Pending entrances (only displayed when drawMode === "entrance" or "confirm")
   * In edit mode (editingCenter), markers are draggable to adjust entrance positions.
   */
  // NOTE: These are DOM markers, so they do NOT depend on the style being loaded.
  // Previously this effect bailed out on `!map.isStyleLoaded()`, which is false
  // whenever tiles are still loading (e.g. right after a click / pan / zoom), so the
  // entrance was added to state ("1 entrance") but no marker was ever drawn.
  const hasEntranceDrag = Boolean(onEntranceDrag);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const isEditMode = Boolean(editingCenter && hasEntranceDrag);
    const isVisible =
      (drawMode === "entrance" || drawMode === "confirm" || isEditMode) &&
      Array.isArray(pendingEntrances) &&
      pendingEntrances.length > 0;

    const points = isVisible
      ? pendingEntrances
          .map((point, index) => ({
            index,
            lng: Number(point?.lng ?? point?.longitude),
            lat: Number(point?.lat ?? point?.latitude),
          }))
          .filter((p) => Number.isFinite(p.lng) && Number.isFinite(p.lat))
      : [];

    const existing = entranceMarkersRef.current;
    const canReuse =
      existing.length === points.length &&
      existing.every((m, i) => m.__editMode === isEditMode && m.__index === points[i].index);

    if (canReuse) {
      // Same set of entrances: just move them (never tear down a marker mid-drag)
      existing.forEach((m, i) => {
        if (!m.__dragging) m.setLngLat([points[i].lng, points[i].lat]);
      });
      return;
    }

    // Don't rebuild while the user is dragging; the drag end will trigger a re-sync
    if (existing.some((m) => m.__dragging)) return;

    existing.forEach((m) => m.remove());
    entranceMarkersRef.current = points.map((p) => {
      // Saved/placed entrance: numbered blue badge. Clearly different from the
      // outline's small white corner dots and from the translucent cursor preview.
      const element = document.createElement("div");
      element.className = "evacway-entrance-marker";
      element.title = `Entrance ${p.index + 1}`;
      element.textContent = String(p.index + 1);
      Object.assign(element.style, {
        width: "26px",
        height: "26px",
        borderRadius: "50%",
        background: "#2563eb",
        border: "3px solid #ffffff",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.45)",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#ffffff",
        font: "700 12px/1 system-ui, -apple-system, Segoe UI, sans-serif",
        pointerEvents: isEditMode ? "auto" : "none",
        cursor: isEditMode ? "grab" : "default",
        zIndex: "5",
      });

      const marker = new mapboxgl.Marker({
        element,
        anchor: "center",
        draggable: isEditMode,
      }).setLngLat([p.lng, p.lat]);

      if (isEditMode) {
        marker.setPopup(createPopup(`Entrance ${p.index + 1}`, "Building entrance"));
        marker.on("dragstart", () => {
          marker.__dragging = true;
          element.style.cursor = "grabbing";
        });
        // Keep dragged entrances on the outline (no tolerance: always snap to nearest edge)
        const snapMarkerToOutline = () => {
          const ll = marker.getLngLat();
          const snapped = snapScreenPointToOutline(
            map,
            map.project(ll),
            pendingFootprintRef.current,
            Infinity
          );
          if (snapped) marker.setLngLat([snapped.lng, snapped.lat]);
          return snapped || { lng: ll.lng, lat: ll.lat };
        };
        marker.on("drag", () => {
          const ll = snapMarkerToOutline();
          entranceDragRef.current?.(p.index, { lat: ll.lat, lng: ll.lng });
        });
        marker.on("dragend", () => {
          marker.__dragging = false;
          element.style.cursor = "grab";
          const ll = snapMarkerToOutline();
          entranceDragRef.current?.(p.index, { lat: ll.lat, lng: ll.lng }, true);
        });
      }

      marker.addTo(map);
      marker.__editMode = isEditMode;
      marker.__index = p.index;
      return marker;
    });
  }, [mapLoaded, drawMode, pendingEntrances, editingCenter, hasEntranceDrag]);

  // Remove entrance markers on unmount
  useEffect(() => {
    return () => {
      entranceMarkersRef.current.forEach((m) => {
        try { m.remove(); } catch { /* ignore */ }
      });
      entranceMarkersRef.current = [];
    };
  }, []);

  /*
   * Drawing / map click & cursor tracking
   */
  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded) return;

    const handleMouseMove = (event) => {
      if (mappingTool === "pan") {
        map.getCanvas().style.cursor = "grab";
        if (roomCursorMarkerRef.current) {
          roomCursorMarkerRef.current.getElement().style.display = "none";
        }
        if (entranceCursorMarkerRef.current) {
          entranceCursorMarkerRef.current.getElement().style.display = "none";
        }
        return;
      }
      if (drawMode === "entrance" || drawMode === "room") {
        const hasOutline = pendingFootprint && pendingFootprint.length >= 3;
        // Entrance: same snap + tolerance as the click handler, so the preview
        // shows exactly where the entrance will be stored.
        const entranceSnap =
          drawMode === "entrance" && hasOutline
            ? snapScreenPointToOutline(map, event.point, pendingFootprint, ENTRANCE_SNAP_TOLERANCE_PX)
            : null;
        const isInside = !hasOutline
          ? true
          : drawMode === "entrance"
          ? Boolean(entranceSnap)
          : isPointInOrNearPolygon(
              { lng: event.lngLat.lng, lat: event.lngLat.lat },
              pendingFootprint,
              15
            );
        const previewLngLat = entranceSnap || event.lngLat;
        map.getCanvas().style.cursor = isInside ? "crosshair" : "not-allowed";

        if (drawMode === "room") {
          if (isInside) {
            if (!roomCursorMarkerRef.current) {
              const el = document.createElement("div");
              el.className = "evacway-room-cursor-pin";
              el.style.width = "20px";
              el.style.height = "20px";
              el.style.borderRadius = "50%";
              el.style.background = "#dc2626";
              el.style.border = "3px solid #ffffff";
              el.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.45)";
              el.style.pointerEvents = "none";
              el.style.boxSizing = "border-box";

              roomCursorMarkerRef.current = new mapboxgl.Marker({
                element: el,
                anchor: "center",
              })
                .setLngLat([event.lngLat.lng, event.lngLat.lat])
                .addTo(map);
            } else {
              roomCursorMarkerRef.current.setLngLat([
                event.lngLat.lng,
                event.lngLat.lat,
              ]);
              roomCursorMarkerRef.current.getElement().style.display = "block";
            }
          } else {
            if (roomCursorMarkerRef.current) {
              roomCursorMarkerRef.current.getElement().style.display = "none";
            }
          }
        }

        // Entrance cursor preview (shows where entrance will be placed)
        if (drawMode === "entrance") {
          if (isInside) {
            if (!entranceCursorMarkerRef.current) {
              // Ghost preview: hollow, translucent ring (the placed entrance is a
              // solid numbered badge, so the two are never confused).
              const el = document.createElement("div");
              el.className = "evacway-entrance-cursor";
              Object.assign(el.style, {
                width: "22px",
                height: "22px",
                borderRadius: "50%",
                background: "rgba(37, 99, 235, 0.18)",
                border: "2px dashed #2563eb",
                boxSizing: "border-box",
                pointerEvents: "none",
              });
              entranceCursorMarkerRef.current = new mapboxgl.Marker({
                element: el,
                anchor: "center",
              })
                .setLngLat([previewLngLat.lng, previewLngLat.lat])
                .addTo(map);
            } else {
              entranceCursorMarkerRef.current.setLngLat([
                previewLngLat.lng,
                previewLngLat.lat,
              ]);
              entranceCursorMarkerRef.current.getElement().style.display = "block";
            }
          } else {
            if (entranceCursorMarkerRef.current) {
              entranceCursorMarkerRef.current.getElement().style.display = "none";
            }
          }
        }
      } else if (drawMode === "footprint") {
        map.getCanvas().style.cursor = "crosshair";
      } else {
        map.getCanvas().style.cursor = "";
      }
    };

    const handleMouseLeave = () => {
      if (roomCursorMarkerRef.current) {
        roomCursorMarkerRef.current.getElement().style.display = "none";
      }
      if (entranceCursorMarkerRef.current) {
        entranceCursorMarkerRef.current.getElement().style.display = "none";
      }
    };

    const handleClick = (event) => {
      if (drawMode === "none") {
        if (onMapBackgroundClickRef.current) {
          onMapBackgroundClickRef.current(event);
        }
        return;
      }
      if (!onMapClickRef.current) return;
      if (mappingTool === "pan") return; // In Pan mode taps place nothing

      if (drawMode === "footprint" && onBasemapBuildingClick) {
        try {
          const features = map.queryRenderedFeatures(event.point);
          const bFeat = features.find(
            (f) =>
              f.geometry &&
              (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon") &&
              (String(f.layer?.id || "").toLowerCase().includes("building") ||
                f.sourceLayer === "building" ||
                f.properties?.type === "building")
          );
          if (bFeat) {
            const pts = polygonToPoints(bFeat.geometry);
            if (pts && pts.length >= 3) {
              onBasemapBuildingClick(pts);
              return;
            }
          }
        } catch {
          // Ignored
        }
      }

      // Entrances: store the closest point ON the outline (screen-px projection),
      // never the raw click. Clicks farther than the tolerance are rejected.
      let entranceSnapped = null;
      if (drawMode === "entrance" && pendingFootprint && pendingFootprint.length >= 3) {
        entranceSnapped = snapScreenPointToOutline(
          map,
          event.point,
          pendingFootprint,
          ENTRANCE_SNAP_TOLERANCE_PX
        );
        if (!entranceSnapped) {
          if (onOutsideOutlineClickRef.current) onOutsideOutlineClickRef.current();
          return;
        }
      }

      if (drawMode === "room") {
        if (pendingFootprint && pendingFootprint.length >= 3) {
          const isInside = isPointInOrNearPolygon(
            { lng: event.lngLat.lng, lat: event.lngLat.lat },
            pendingFootprint,
            15
          );
          if (!isInside) {
            if (onOutsideOutlineClickRef.current) onOutsideOutlineClickRef.current();
            return;
          }
        }
      }

      if (roomCursorMarkerRef.current) {
        roomCursorMarkerRef.current.getElement().style.display = "none";
      }
      if (entranceCursorMarkerRef.current) {
        entranceCursorMarkerRef.current.getElement().style.display = "none";
      }

      // First-corner close: click within 12px of first corner closes the shape
      if (drawMode === "footprint" && pendingFootprint && pendingFootprint.length >= 3) {
        const first = pendingFootprint[0];
        const firstPx = map.project([Number(first.lng ?? first.longitude), Number(first.lat ?? first.latitude)]);
        const dx = event.point.x - firstPx.x;
        const dy = event.point.y - firstPx.y;
        if (Math.sqrt(dx * dx + dy * dy) <= 12) {
          if (onCloseShapeRef.current) onCloseShapeRef.current();
          return;
        }
      }

      onMapClickRef.current(
        entranceSnapped || {
          lat: event.lngLat.lat,
          lng: event.lngLat.lng,
        }
      );
    };

    const handleDblClick = (event) => {
      if (drawMode === "footprint" && onDoubleTapFinishRef.current) {
        event.preventDefault();
        onDoubleTapFinishRef.current();
      }
    };

    map.on("mousemove", handleMouseMove);
    map.on("mouseout", handleMouseLeave);
    map.on("click", handleClick);
    map.on("dblclick", handleDblClick);

    try {
      if (drawMode !== "none") {
        map.doubleClickZoom?.disable();
        map.getCanvas().style.cursor = mappingTool === "pan" ? "grab" : "crosshair";
      } else {
        map.doubleClickZoom?.enable();
        map.getCanvas().style.cursor = "";
      }
    } catch (e) {
      // Ignored
    }

    return () => {
      try {
        map.off("mousemove", handleMouseMove);
        map.off("mouseout", handleMouseLeave);
        map.off("click", handleClick);
        map.off("dblclick", handleDblClick);

        if (roomCursorMarkerRef.current) {
          roomCursorMarkerRef.current.remove();
          roomCursorMarkerRef.current = null;
        }
        if (entranceCursorMarkerRef.current) {
          entranceCursorMarkerRef.current.remove();
          entranceCursorMarkerRef.current = null;
        }

        if (mapRef.current === map && map.style) {
          map.doubleClickZoom?.enable();
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
    mappingTool,
    pendingFootprint,
    onBasemapBuildingClick,
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
                          {room.capacity != null ? ` Â· Cap ${room.capacity}` : ""}
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

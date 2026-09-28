import { useState, useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

import { Link } from "react-router-dom";
import { api, BASE_URL } from "../../services/api";
import HazardReportModal from "../../components/HazardReportModal";

import { useHazardData } from "../../hooks/useHazardData";
import { useEvacuationData } from "../../hooks/useEvacuationData";
import { useRouting } from "../../hooks/useRouting";

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
  faMotorcycle,
  faCar,
  faXmark,
  faSliders,
  faUser,
  faCircleCheck,
  faMagnifyingGlass,
  faBuildingColumns,
  faDoorOpen,
  faChevronRight,
  faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";

import "../../components_css/MyLocationMarker.css";
import "./ResidentHome.css";

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

function estimateTravelTimes(distanceKm) {
  return {
    walking: Math.round((distanceKm / TRAVEL_SPEEDS.walking) * 60),
    motorcycle: Math.round((distanceKm / TRAVEL_SPEEDS.motorcycle) * 60),
    car: Math.round((distanceKm / TRAVEL_SPEEDS.car) * 60),
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

function useIsMobile(breakpoint = 640) {
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

function createHazardPopup(properties) {
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

  const photoPath = properties.photo_url || properties.image_url || properties.photo;
  if (photoPath) {
    const photo = document.createElement("img");
    photo.src = /^https?:\/\//i.test(photoPath)
      ? photoPath
      : `${BASE_URL}${photoPath.startsWith("/") ? "" : "/"}${photoPath}`;
    photo.alt = "Photo attached to hazard report";
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
  const isMobile = useIsMobile();

  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);

  const hazardMarkersRef = useRef([]);
  const evacuationMarkersRef = useRef([]);
  const entranceMarkersRef = useRef([]);
  const roomMarkersRef = useRef([]);
  const routeMarkersRef = useRef([]);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [hazardReports, setHazardReports] = useState([]);

  // --------------------------------------------------
  // Use Custom Hooks for Logic
  // --------------------------------------------------
  const { 
    hazardZones, 
    visibleLayers, 
    setVisibleLayers, 
    refreshHazardZones, 
    filteredHazardZones 
  } = useHazardData();

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
    setFindingRoute, 
    findRoute 
  } = useRouting();

  // --------------------------------------------------
  // Map style
  // Street is the default
  // --------------------------------------------------

  const [mapStyle, setMapStyle] = useState("street");

  const [mapOptionsOpen, setMapOptionsOpen] = useState(false);

  const [sogodBoundary, setSogodBoundary] = useState(null);
  const [roads, setRoads] = useState(null);

  const [pickingLocation, setPickingLocation] = useState(false);

  // Kept in sync with pickingLocation below. The Mapbox click
  // listener is registered once, inside the map-init effect
  // (empty dependency array), so it closes over pickingLocation
  // as it was AT MOUNT TIME. Reading a ref instead lets that
  // long-lived listener see the current value on every click.
  const pickingLocationRef = useRef(false);

  const [pendingReportLocation, setPendingReportLocation] = useState(null);

  const [reportConfirmation, setReportConfirmation] = useState("");

  const [locationPermission, setLocationPermission] = useState("unknown");

  const [myLocation, setMyLocation] = useState(null);
  const [locating, setLocating] = useState(false);

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
  // Load remaining data
  // --------------------------------------------------

  useEffect(() => {
    api
      .getRoadSegments()
      .then(setRoads)
      .catch((err) => {
        console.error("Failed to load road segments:", err);
      });

    fetch("/sogod_boundary.geojson")
      .then((res) => res.json())
      .then(setSogodBoundary)
      .catch((err) => {
        console.error("Failed to load Sogod boundary:", err);
      });
  }, []);

  useEffect(() => {
    api
      .getHazardReports()
      .then((reports) => setHazardReports(Array.isArray(reports) ? reports : []))
      .catch((error) => console.error("Hazard reports loading error:", error));
  }, []);

  // Display interactive hazard-zone outlines for the selected map layers.
  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded || !filteredHazardZones) return;

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
            ["get", "risk_level"],
            "high", "#d94736",
            "medium", "#e29a32",
            "#e5bd43",
          ],
          "fill-opacity": 0.28,
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
            ["get", "risk_level"],
            "high", "#b83228",
            "medium", "#bd7418",
            "#a88a20",
          ],
          "line-width": 2,
        },
      });
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
      map.getCanvas().style.cursor = "pointer";
    };
    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = pickingLocation ? "crosshair" : "";
    };

    map.on("click", "resident-hazard-fill", handleZoneClick);
    map.on("mouseenter", "resident-hazard-fill", handleMouseEnter);
    map.on("mouseleave", "resident-hazard-fill", handleMouseLeave);

    return () => {
      map.off("click", "resident-hazard-fill", handleZoneClick);
      map.off("mouseenter", "resident-hazard-fill", handleMouseEnter);
      map.off("mouseleave", "resident-hazard-fill", handleMouseLeave);
    };
  }, [filteredHazardZones, mapLoaded, pickingLocation]);

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

      const element = document.createElement("button");
      element.type = "button";
      element.className = "resident-hazard-marker";
      element.setAttribute(
        "aria-label",
        `View hazard: ${report.report_type || "Hazard report"}`
      );

      const iconElement = document.createElement("span");
      iconElement.className = "resident-hazard-marker-icon";
      iconElement.innerHTML = icon(faTriangleExclamation).html.join("");

      const label = document.createElement("span");
      label.className = "resident-hazard-marker-label";
      label.textContent = report.report_type || "Hazard";

      element.append(iconElement, label);

      const marker = new mapboxgl.Marker({ element, anchor: "bottom" })
        .setLngLat(coordinates)
        .setPopup(
          new mapboxgl.Popup({ offset: 12 }).setDOMContent(
            createHazardPopup(report)
          )
        )
        .addTo(map);

      hazardMarkersRef.current.push(marker);
    });

    return () => {
      hazardMarkersRef.current.forEach((marker) => marker.remove());
      hazardMarkersRef.current = [];
    };
  }, [hazardReports, mapLoaded]);

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
      .catch(() => {});
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
      .catch(() => {});
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

    map.on("load", () => {
      setMapLoaded(true);

      // Show building footprints at an earlier zoom level
      if (!map.getLayer("evacway-buildings")) {
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
      }
    });

    map.on("error", (event) => {
      console.error("Mapbox error:", event);
    });

    // Clicking the map while reporting a hazard.
    //
    // This listener is only ever registered once (this effect
    // has an empty dependency array), so it must NOT read
    // `pickingLocation` directly - that would always see the
    // value from the first render. Read pickingLocationRef.current
    // instead, which is kept up to date by a separate effect.
    map.on("click", (e) => {
      if (!pickingLocationRef.current) {
        return;
      }

      setPendingReportLocation({
        lat: e.lngLat.lat,
        lng: e.lngLat.lng,
      });

      setPickingLocation(false);
    });

    return () => {
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

    if (!map || !mapLoaded) {
      return;
    }

    const sourceId = "roads";
    const layerId = "roads-layer";

    const data = roads || EMPTY_FEATURE_COLLECTION;

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

    function handleRoadClick(e) {
      const feature = e.features?.[0];

      if (!feature) {
        return;
      }

      new mapboxgl.Popup({
        offset: 10,
      })
        .setLngLat(e.lngLat)
        .setDOMContent(createRoadPopup(feature.properties || {}))
        .addTo(map);
    }

    map.on("click", layerId, handleRoadClick);

    return () => {
      map.off("click", layerId, handleRoadClick);
    };
  }, [roads, mapLoaded]);

  // --------------------------------------------------
  // Add Sogod boundary
  // (source created once, updated via setData afterwards)
  // --------------------------------------------------

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded) {
      return;
    }

    const sourceId = "sogod-boundary";
    const layerId = "sogod-boundary-line";

    const data = sogodBoundary || EMPTY_FEATURE_COLLECTION;

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
  }, [sogodBoundary, mapLoaded]);

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

    const handleMouseEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };

    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = pickingLocation ? "crosshair" : "";
    };

    const handleEvacCenterClick = (e) => {
      const feature = e.features?.[0];

      if (!feature) {
        return;
      }

      setSelectedCenter(feature);
    };

    map.on("click", fillLayerId, handleEvacCenterClick);
    map.on("mouseenter", fillLayerId, handleMouseEnter);
    map.on("mouseleave", fillLayerId, handleMouseLeave);

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

    return () => {
      map.off("click", fillLayerId, handleEvacCenterClick);
      map.off("mouseenter", fillLayerId, handleMouseEnter);
      map.off("mouseleave", fillLayerId, handleMouseLeave);
    };
  }, [evacCenters, mapLoaded, pickingLocation]);

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

        element.className = `evacway-center-marker${
          isMine ? " evacway-center-marker-mine" : ""
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

        element.className = `evacway-room-marker${
          isMine ? " evacway-room-marker-mine" : ""
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
  }, [myLocation, mapLoaded]);

  // --------------------------------------------------
  // Draw evacuation route
  // --------------------------------------------------

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded) {
      return;
    }

    const sourceId = "evacuation-route";
    const layerId = "evacuation-route-line";

    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }

    if (map.getSource(sourceId)) {
      map.removeSource(sourceId);
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

    if (myLocation) {
      const userCoordinates = getValidCoordinates([
        myLocation.lng,
        myLocation.lat,
      ]);

      if (userCoordinates) {
        coordinates.push(userCoordinates);
      }
    }

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
  }, [route, mapLoaded, myLocation]);

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

  function handleFindRoute() {
    setRouteError("");
    setRoute(null);

    if (!navigator.geolocation) {
      setRouteError("Your browser doesn't support location access.");

      return;
    }

    const assignedCenterId = myCenter?.evacuation_center?.id ?? null;

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

          setRouteIsMine(assignedCenterId != null);

          setRoute(result);

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

  // --------------------------------------------------
  // Clear route
  // --------------------------------------------------

  function handleClearRoute() {
    setRoute(null);
    setRouteError("");

    const map = mapRef.current;

    if (!map) {
      return;
    }

    if (map.getLayer("evacuation-route-line")) {
      map.removeLayer("evacuation-route-line");
    }

    if (map.getSource("evacuation-route")) {
      map.removeSource("evacuation-route");
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
        };

        setMyLocation(loc);

        setLocationPermission("granted");

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
    setPickingLocation(true);
    setPendingReportLocation(null);
  }

  function handleReportSubmitted() {
    setPendingReportLocation(null);

    setPickingLocation(false);

    setReportConfirmation(
      "Thank you - your report has been submitted for review."
    );

    refreshHazardZones();

    setTimeout(() => setReportConfirmation(""), 4000);
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

            const name = properties.name || "Evacuation Center";
            const barangay = properties.barangay || "";

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
    selectedCenterProperties.name || "Evacuation Center";

  const selectedCenterBarangay = selectedCenterProperties.barangay || null;

  const selectedCenterCapacity = selectedCenterProperties.capacity ?? null;

  const selectedCenterBuildingMaterial =
    selectedCenterProperties.building_material || null;

  const selectedCenterAccessibility =
    selectedCenterProperties.accessibility_notes || null;

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

  return (
    <div className="resident-home">
      {/* Mapbox map */}
      <div ref={mapContainerRef} className="map-container" />

      {/* Top bar */}
      <div className="top-bar">
        <div className="brand">EvacWay</div>

        <Link to="/" className="home-btn">
          <FontAwesomeIcon icon={faHome} />

          {!isMobile && <span>Home</span>}
        </Link>
      </div>

      {/* Search */}
      <div
        className={
          isMobile
            ? "resident-search-container mobile"
            : "resident-search-container"
        }
      >
        <div className="resident-search-box">
          <FontAwesomeIcon
            icon={faMagnifyingGlass}
            className="resident-search-icon"
          />

          <input
            type="text"
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
            placeholder="Search evacuation center or barangay"
            className="resident-search-input"
          />

          {searching && (
            <span className="resident-search-loading">Searching...</span>
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
                  icon={result.type === "barangay" ? faLocationDot : faMapPin}
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
      </div>

      {/* Map Options */}
      <div className={isMobile ? "map-options mobile" : "map-options"}>
        <button
          onClick={() => setMapOptionsOpen((value) => !value)}
          className={
            mapOptionsOpen ? "map-options-toggle active" : "map-options-toggle"
          }
          title="Map options"
        >
          <FontAwesomeIcon icon={faSliders} />

          {!isMobile && <span>Map Options</span>}
        </button>

        {mapOptionsOpen && (
          <div className="map-options-dropdown">
            {/* Hazards */}
            <div className="map-options-group">
              <div className="map-options-label">Hazards</div>

              <button
                onClick={() =>
                  setVisibleLayers((v) => ({
                    ...v,
                    flood: !v.flood,
                  }))
                }
                className={
                  visibleLayers.flood
                    ? "map-options-item flood-active"
                    : "map-options-item"
                }
              >
                <FontAwesomeIcon icon={faWater} />

                <span>Flood</span>

                {visibleLayers.flood && (
                  <span className="map-options-check">✓</span>
                )}
              </button>

              <button
                onClick={() =>
                  setVisibleLayers((v) => ({
                    ...v,
                    landslide: !v.landslide,
                  }))
                }
                className={
                  visibleLayers.landslide
                    ? "map-options-item landslide-active"
                    : "map-options-item"
                }
              >
                <FontAwesomeIcon icon={faMountain} />

                <span>Landslide</span>

                {visibleLayers.landslide && (
                  <span className="map-options-check">✓</span>
                )}
              </button>
            </div>

            {/* Map View */}
            <div className="map-options-group">
              <div className="map-options-label">Map View</div>

              <button
                onClick={() => handleMapStyleChange("street")}
                className={
                  mapStyle === "street"
                    ? "map-options-item view-active"
                    : "map-options-item"
                }
              >
                <FontAwesomeIcon icon={faMapPin} />

                <span>Street</span>

                {mapStyle === "street" && (
                  <span className="map-options-check">✓</span>
                )}
              </button>

              <button
                onClick={() => handleMapStyleChange("satellite")}
                className={
                  mapStyle === "satellite"
                    ? "map-options-item view-active"
                    : "map-options-item"
                }
              >
                <FontAwesomeIcon icon={faSatelliteDish} />

                <span>Satellite</span>

                {mapStyle === "satellite" && (
                  <span className="map-options-check">✓</span>
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Evacuation center details */}
      {selectedCenter && (
        <aside className={isMobile ? "cd-panel mobile" : "cd-panel"}>
          <header className="cd-header">
            <div className="cd-badge">
              <FontAwesomeIcon icon={faBuildingColumns} />
            </div>

            <div className="cd-heading">
              <small>Evacuation center</small>
              <h3>{selectedCenterName}</h3>
            </div>

            <button
              type="button"
              className="cd-close"
              onClick={closeCenterDetails}
              aria-label="Close"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </header>

          <div className="cd-body">
            {selectedCenterIsMine && (
              <span className="cd-pill">Your evacuation center</span>
            )}

            {selectedCenterIsMine && myCenter?.room?.room_number && (
              <div className="cd-your-room">
                <FontAwesomeIcon icon={faCircleCheck} />
                <span>
                  Your assigned room: <strong>{myCenter.room.room_number}</strong>
                </span>
              </div>
            )}

            <div className="cd-rows">
              {selectedCenterBarangay && (
                <div className="cd-row">
                  <span>Barangay</span>
                  <strong>{selectedCenterBarangay}</strong>
                </div>
              )}

              {selectedCenterCapacity != null && (
                <div className="cd-row">
                  <span>Capacity</span>
                  <strong>{selectedCenterCapacity} people</strong>
                </div>
              )}

              {selectedCenterBuildingMaterial && (
                <div className="cd-row">
                  <span>Building</span>
                  <strong>{selectedCenterBuildingMaterial}</strong>
                </div>
              )}
            </div>

            {selectedCenterAccessibility && (
              <p className="cd-note">{selectedCenterAccessibility}</p>
            )}

            <h4 className="cd-section-title">
              Rooms ({selectedCenterRooms.length})
            </h4>

            {selectedCenterRooms.length === 0 ? (
              <div className="cd-empty">
                No rooms have been added for this center yet.
              </div>
            ) : (
              <div className="cd-list">
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
                      className="cd-list-item"
                      onClick={() => handleRoomRowClick(room)}
                      disabled={!isMapped}
                    >
                      <span className="cd-list-icon">
                        <FontAwesomeIcon icon={faDoorOpen} />
                      </span>

                      <span className="cd-list-text">
                        <strong>{room.room_number || "Room"}</strong>
                        <small>
                          {room.capacity != null
                            ? `Capacity ${room.capacity}`
                            : "Capacity unknown"}
                          {!isMapped && " - location not yet mapped"}
                        </small>
                      </span>

                      {isMineRoom && (
                        <span className="cd-list-tag">Your room</span>
                      )}

                      <FontAwesomeIcon
                        icon={faChevronRight}
                        className="cd-chevron"
                      />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>
      )}

      {/* Locate Me */}
      <button
        onClick={handleLocateMe}
        disabled={locating}
        className="locate-btn"
        title="Update my location"
      >
        <FontAwesomeIcon icon={faLocationCrosshairs} spin={locating} />
      </button>

      {/* Bottom action bar */}
      <div className={isMobile ? "bottom-bar mobile" : "bottom-bar"}>
        <button onClick={handleReportMapClick} className="action-btn">
          <FontAwesomeIcon icon={faMapPin} />

          <span>{pickingLocation ? "Tap the map..." : "Report Hazard"}</span>
        </button>

        <button
          onClick={openMyCenter}
          className={myCenter ? "action-btn verified" : "action-btn"}
          title={myCenter ? "My evacuation center" : "Enter your name"}
        >
          <FontAwesomeIcon icon={myCenter ? faCircleCheck : faUser} />

          {!isMobile && <span>{myCenter ? firstName : "Enter Your Name"}</span>}
        </button>

        {locationPermission !== "granted" ? (
          <button onClick={handleEnableLocation} className="action-btn-primary">
            <FontAwesomeIcon icon={faLocationCrosshairs} />

            {!isMobile && <span>Enable Location</span>}
          </button>
        ) : (
          <button
            onClick={handleFindRoute}
            disabled={findingRoute}
            className="action-btn-primary"
          >
            <FontAwesomeIcon icon={faRoute} spin={findingRoute} />

            {!isMobile && (
              <span>
                {findingRoute
                  ? "Finding route..."
                  : myCenter
                  ? "Find My Center"
                  : "Find Nearest Evacuation Route"}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Route panel */}
      {route && (
        <div className="route-panel">
          <button
            onClick={handleClearRoute}
            className="route-panel-close"
            aria-label="Clear route"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>

          <div className="route-panel-title">
            <FontAwesomeIcon icon={faRoute} />

            {route.evacuation_center?.name || "Evacuation Center"}
          </div>

          {routeIsMine && myCenter?.room?.room_number && (
            <div className="route-panel-room">
              Your room: {myCenter.room.room_number}
            </div>
          )}

          <div className="route-panel-distance">{route.distance_km} km away</div>

          <div className="route-modes">
            <div className="route-mode">
              <FontAwesomeIcon icon={faPersonWalking} />

              <span>{estimateTravelTimes(route.distance_km).walking} min</span>
            </div>

            <div className="route-mode">
              <FontAwesomeIcon icon={faMotorcycle} />

              <span>
                {estimateTravelTimes(route.distance_km).motorcycle} min
              </span>
            </div>

            <div className="route-mode">
              <FontAwesomeIcon icon={faCar} />

              <span>{estimateTravelTimes(route.distance_km).car} min</span>
            </div>
          </div>
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

      {/* Hazard report modal */}
      {pendingReportLocation && (
        <HazardReportModal
          location={pendingReportLocation}
          onClose={() => setPendingReportLocation(null)}
          onSubmitted={handleReportSubmitted}
        />
      )}
    </div>
  );
};

export default ResidentHome;
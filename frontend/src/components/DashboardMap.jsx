import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { icon } from "@fortawesome/fontawesome-svg-core";

import {
  faWater,
  faMountain,
  faSearch,
  faLocationDot,
  faMapPin,
  faDoorOpen,
  faPen,
  faXmark,
  faArrowLeft,
  faBuildingColumns,
  faChevronRight,
} from "@fortawesome/free-solid-svg-icons";

import { api } from "../services/api";
import "../components_css/DashboardMap.css";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const SOGOD_CENTER = [124.996, 10.435];

const SOGOD_BOUNDS = [
  [124.89, 10.35],
  [125.11, 10.56],
];

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
}) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);

  const [mapLoaded, setMapLoaded] = useState(false);

  /*
   * Rooms loaded directly from the database.
   * This makes the dashboard independent from
   * EvacuationCenterManager.
   */
  const [loadedRooms, setLoadedRooms] = useState([]);

  /*
   * Selected center / room for the details panels
   */
  const [selectedCenter, setSelectedCenter] = useState(null);
  const [selectedRoom, setSelectedRoom] = useState(null);

  /*
   * Families assigned to the selected room
   */
  const [roomFamilies, setRoomFamilies] = useState({
    families: [],
    occupied: 0,
    available: 0,
  });
  const [familiesLoading, setFamiliesLoading] = useState(false);
  const [familiesError, setFamiliesError] = useState("");

  const [visibleLayers, setVisibleLayers] = useState({
    flood: false,
    landslide: false,
  });

  const [sogodBoundary, setSogodBoundary] = useState(null);
  const [roads, setRoads] = useState(null);

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

  /*
   * Load Sogod boundary
   */
  useEffect(() => {
    fetch("/sogod_boundary.geojson")
      .then((res) => {
        if (!res.ok) {
          throw new Error("Failed to load Sogod boundary.");
        }

        return res.json();
      })
      .then(setSogodBoundary)
      .catch((err) => {
        console.error("Boundary error:", err);
      });
  }, []);

  /*
   * Load roads
   */
  useEffect(() => {
    api
      .getRoadSegments()
      .then(setRoads)
      .catch((err) => {
        console.error("Road loading error:", err);
      });
  }, []);

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

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/standard",
      center: SOGOD_CENTER,
      zoom: 12,
      minZoom: 12,
      maxZoom: 18,
      pitch: 0,
      bearing: 0,
      maxBounds: SOGOD_BOUNDS,
      attributionControl: true,
    });

    mapRef.current = map;

    map.addControl(
      new mapboxgl.NavigationControl({
        visualizePitch: true,
      }),
      "top-left"
    );

    map.on("load", () => {
      setMapLoaded(true);
    });

    map.on("error", (event) => {
      console.error("Mapbox error:", event);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  /*
   * Add/update Sogod boundary
   */
  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded || !sogodBoundary) return;

    const source = map.getSource("sogod-boundary");

    if (source) {
      source.setData(sogodBoundary);
      return;
    }

    map.addSource("sogod-boundary", {
      type: "geojson",
      data: sogodBoundary,
    });

    map.addLayer({
      id: "sogod-boundary-line",
      type: "line",
      source: "sogod-boundary",
      paint: {
        "line-color": "#1e3a8a",
        "line-width": 2,
        "line-dasharray": [3, 2],
      },
    });
  }, [mapLoaded, sogodBoundary]);

  /*
   * Roads
   */
  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded || !roads) return;

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

    map.on("click", "roads-open", handleOpenRoadClick);
    map.on("click", "roads-closed", handleClosedRoadClick);

    map.on("mouseenter", "roads-open", handleMouseEnter);
    map.on("mouseleave", "roads-open", handleMouseLeave);

    map.on("mouseenter", "roads-closed", handleMouseEnter);
    map.on("mouseleave", "roads-closed", handleMouseLeave);

    return () => {
      map.off("click", "roads-open", handleOpenRoadClick);
      map.off("click", "roads-closed", handleClosedRoadClick);

      map.off("mouseenter", "roads-open", handleMouseEnter);
      map.off("mouseleave", "roads-open", handleMouseLeave);

      map.off("mouseenter", "roads-closed", handleMouseEnter);
      map.off("mouseleave", "roads-closed", handleMouseLeave);
    };
  }, [mapLoaded, roads]);

  /*
   * Hazard zones
   */
  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded || !hazardZones) return;

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
          ["get", "risk_level"],
          "high",
          "#dc2626",
          "medium",
          "#f59e0b",
          "#facc15",
        ],
        "fill-opacity": 0.3,
      },
    });

    map.addLayer({
      id: "hazard-zones-line",
      type: "line",
      source: "hazard-zones",
      paint: {
        "line-color": [
          "match",
          ["get", "risk_level"],
          "high",
          "#dc2626",
          "medium",
          "#f59e0b",
          "#facc15",
        ],
        "line-width": 1.5,
      },
    });
  }, [mapLoaded, hazardZones, visibleLayers]);

  /*
   * Evacuation centers
   */
  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded || !centers) return;

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
          .setLngLat([entrance.lng, entrance.lat])
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
      map.off("click", "evac-centers-fill", centerClick);
      map.off("mouseenter", "evac-centers-fill", handleMouseEnter);
      map.off("mouseleave", "evac-centers-fill", handleMouseLeave);
    };
  }, [mapLoaded, centers, onCenterClick, drawMode]);

  /*
   * =========================================================
   * LOAD SAVED ROOMS FROM DATABASE
   * =========================================================
   *
   * Runs on its own, so rooms show on the dashboard even when
   * EvacuationCenterManager is not open.
   *
   * A room without a location (latitude/longitude = null) stays
   * loaded but is not drawn until its location has been saved.
   */
  useEffect(() => {
    let cancelled = false;

    async function loadRooms() {
      if (!centers?.features?.length) {
        setLoadedRooms([]);
        return;
      }

      const results = await Promise.all(
        centers.features.map(async (center) => {
          const centerId =
            center.properties?.id ??
            center.properties?.center_id ??
            center.properties?.evacuation_center_id ??
            center.id;

          if (centerId == null) {
            console.warn("NO CENTER ID FOUND:", center);
            return [];
          }

          try {
            const response = await api.getRooms(centerId);

            let centerRooms = [];

            if (Array.isArray(response)) {
              centerRooms = response;
            } else if (Array.isArray(response?.rooms)) {
              centerRooms = response.rooms;
            } else if (Array.isArray(response?.data)) {
              centerRooms = response.data;
            }

            return centerRooms.map((room) => ({
              ...room,
              evacuation_center_id:
                room.evacuation_center_id ??
                room.center_id ??
                room.evacuationCenterId ??
                centerId,
            }));
          } catch (error) {
            console.error(
              `FAILED TO LOAD ROOMS FOR CENTER ${centerId}:`,
              error
            );

            return [];
          }
        })
      );

      if (!cancelled) {
        setLoadedRooms(results.flat());
      }
    }

    loadRooms();

    return () => {
      cancelled = true;
    };
  }, [centers, rooms]);

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

        const element = document.createElement("div");
        element.className = `evacway-center-marker ${
          active ? "" : "evacway-center-marker-inactive"
        }`;

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
  }, [mapLoaded, centers, drawMode]);

  /*
   * Load the families of the selected room
   */
  useEffect(() => {
    if (!selectedRoom?.id) {
      setRoomFamilies({ families: [], occupied: 0, available: 0 });
      setFamiliesError("");
      return;
    }

    let cancelled = false;

    setFamiliesLoading(true);
    setFamiliesError("");

    api
      .getRoomFamilies(selectedRoom.id)
      .then((data) => {
        if (!cancelled) {
          setRoomFamilies(normalizeRoomFamilies(data, selectedRoom.capacity));
        }
      })
      .catch((err) => {
        console.error("FAILED TO LOAD ASSIGNED FAMILIES:", err);

        if (!cancelled) {
          setRoomFamilies({ families: [], occupied: 0, available: 0 });
          setFamiliesError(err.message || "Failed to load assigned families.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setFamiliesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedRoom]);

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
  }, [mapLoaded, drawMode, pendingRoomLocation]);

  /*
   * Pending footprint
   */
  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded) return;

    const polygonCoordinates =
      pendingFootprint.length > 0
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
    }

    const oldMarkers = map.__evacwayFootprintMarkers || [];

    oldMarkers.forEach((marker) => {
      marker.remove();
    });

    const newMarkers = [];

    pendingFootprint.forEach((point) => {
      const element = document.createElement("div");

      element.style.width = "10px";
      element.style.height = "10px";
      element.style.borderRadius = "50%";
      element.style.background = "white";
      element.style.border = "2px solid #1e3a8a";
      element.style.boxSizing = "border-box";

      const marker = new mapboxgl.Marker({
        element,
        anchor: "center",
      })
        .setLngLat([point.lng, point.lat])
        .addTo(map);

      newMarkers.push(marker);
    });

    map.__evacwayFootprintMarkers = newMarkers;
  }, [mapLoaded, pendingFootprint]);

  /*
   * Pending entrances
   */
  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded) return;

    const oldMarkers = map.__evacwayPendingEntranceMarkers || [];

    oldMarkers.forEach((marker) => {
      marker.remove();
    });

    const newMarkers = [];

    pendingEntrances.forEach((point, index) => {
      const element = document.createElement("div");

      element.style.width = "16px";
      element.style.height = "16px";
      element.style.borderRadius = "50%";
      element.style.background = "#dc2626";
      element.style.border = "2px solid white";
      element.style.boxShadow = "0 2px 6px rgba(0,0,0,0.3)";
      element.style.cursor = "pointer";

      const marker = new mapboxgl.Marker({
        element,
        anchor: "center",
      })
        .setLngLat([point.lng, point.lat])
        .setPopup(createPopup(`Entrance ${index + 1}`, "New entrance"))
        .addTo(map);

      newMarkers.push(marker);
    });

    map.__evacwayPendingEntranceMarkers = newMarkers;
  }, [mapLoaded, pendingEntrances]);

  /*
   * Drawing / map click
   */
  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded) return;

    const handleClick = (event) => {
      if (drawMode !== "none" && onMapClick) {
        onMapClick({
          lat: event.lngLat.lat,
          lng: event.lngLat.lng,
        });
      }
    };

    map.on("click", handleClick);

    if (drawMode !== "none") {
      map.getCanvas().style.cursor = "crosshair";
    } else {
      map.getCanvas().style.cursor = "";
    }

    return () => {
      map.off("click", handleClick);

      if (mapRef.current === map) {
        const canvas = map.getCanvas();

        if (canvas) {
          canvas.style.cursor = "";
        }
      }
    };
  }, [mapLoaded, drawMode, onMapClick]);

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
            const name =
              center.properties?.name ||
              center.properties?.center_name ||
              "Evacuation Center";

            const address =
              center.properties?.address || center.properties?.location || "";

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
    selectedCenterProperties.name ||
    selectedCenterProperties.center_name ||
    "Evacuation Center";

  const selectedCenterAddress =
    selectedCenterProperties.address || selectedCenterProperties.location || null;

  const selectedCenterBarangay =
    selectedCenterProperties.barangay_name ||
    selectedCenterProperties.barangay ||
    null;

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

      {/* Search */}
      <div className="map-search-container">
        <div className="map-search-box">
          <FontAwesomeIcon icon={faSearch} className="map-search-icon" />

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
            placeholder="Search barangay or evacuation center"
            className="map-search-input"
          />

          {searching && <div className="map-search-loading">Searching...</div>}
        </div>

        {showSearchResults && searchResults.length > 0 && (
          <div className="map-search-results">
            {searchResults.map((result, index) => (
              <button
                key={`${result.type}-${result.name}-${index}`}
                className="map-search-result"
                onClick={() => zoomToSearchResult(result)}
              >
                <div className="map-search-result-icon">
                  <FontAwesomeIcon
                    icon={result.type === "barangay" ? faLocationDot : faMapPin}
                  />
                </div>

                <div className="map-search-result-text">
                  <strong>{result.name}</strong>
                  <span>{result.subtitle}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        {showSearchResults &&
          !searching &&
          searchText.trim().length >= 2 &&
          searchResults.length === 0 && (
            <div className="map-search-no-results">
              No barangay or evacuation center found.
            </div>
          )}
      </div>

      {/* Hazard Layer Buttons */}
      <div className="dashboard-layer-tabs">
        <button
          onClick={toggleFlood}
          className={`layer-tab ${
            visibleLayers.flood ? "layer-tab-flood-active" : ""
          }`}
        >
          <FontAwesomeIcon icon={faWater} />
          <span>Flood</span>
        </button>

        <button
          onClick={toggleLandslide}
          className={`layer-tab ${
            visibleLayers.landslide ? "layer-tab-landslide-active" : ""
          }`}
        >
          <FontAwesomeIcon icon={faMountain} />
          <span>Landslide</span>
        </button>
      </div>

      {/* =====================================================
          ROOM DETAILS
          ===================================================== */}
      {selectedCenter && selectedRoom && (
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
            <button
              type="button"
              className="mdp-back"
              onClick={handleBackToCenterDetails}
            >
              <FontAwesomeIcon icon={faArrowLeft} /> Back to center
            </button>

            <div className="mdp-occupancy">
              <div className="mdp-occupancy-numbers">
                <div>
                  <strong>{roomFamilies.occupied}</strong>
                  <span>Occupied</span>
                </div>

                <div>
                  <strong>{roomFamilies.available}</strong>
                  <span>Available</span>
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
                          {family.barangay ? `, ${family.barangay}` : ""}
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
      {selectedCenter && !selectedRoom && (
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
              {selectedCenterBarangay && (
                <div className="mdp-row">
                  <span>Barangay</span>
                  <strong>{selectedCenterBarangay}</strong>
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
                {selectedCenterRooms.map((room, index) => (
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
                      {room.capacity != null && (
                        <small>Capacity {room.capacity}</small>
                      )}
                    </span>

                    <FontAwesomeIcon
                      icon={faChevronRight}
                      className="mdp-chevron"
                    />
                  </button>
                ))}
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
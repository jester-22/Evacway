import { useState, useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faSearch,
  faXmark,
  faHouseFlag,
  faLocationDot,
  faArrowUpRightFromSquare,
  faDrawPolygon,
  faCheck,
  faArrowLeft,
  faChevronLeft,
  faMapPin,
  faBuildingColumns,
} from "@fortawesome/free-solid-svg-icons";

import { api } from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import {
  queryKeys,
  useEvacuationCenters,
  useHazardZones,
  useNotifications,
  useHazardReports,
  usePublicHazardReports,
} from "../../hooks/useEvacuationQueries";
import Sidebar from "../../components/Sidebar";
import DashboardMap, {
  isCenterMapped,
  getOccupancyStatus,
  getCenterCoordinates,
} from "../../components/DashboardMap";
import CenterPlacementFlow, { polygonToPoints } from "../../components/CenterPlacementFlow";
import { displayEntityName } from "../../utils/displayEntityName";
import "../../components_css/AdminMap.css";

const MOBILE_BREAKPOINT = 768;

function useIsMobile(breakpoint = MOBILE_BREAKPOINT) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth <= breakpoint : false
  );

  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth <= breakpoint);
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [breakpoint]);

  return isMobile;
}

export { isCenterMapped, getOccupancyStatus, getCenterCoordinates };

export default function AdminMap() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, logout } = useAuth();
  const isAdmin = user?.role === "admin";
  const isMobile = useIsMobile();

  const searchParams = useMemo(
    () => new URLSearchParams(location.search),
    [location.search]
  );
  const deepLinkedCenterId = searchParams.get("center");
  const initialMode = searchParams.get("mode");
  const notificationId = searchParams.get("notificationId");
  const deepLinkedLat = searchParams.get("lat");
  const deepLinkedLng = searchParams.get("lng");
  const deepLinkedHazardId = searchParams.get("hazard");
  const deepLinkedRescueId = searchParams.get("rescue");
  const deepLinkedType = searchParams.get("type");
  const deepLinkedBarangay = searchParams.get("barangay");

  // Geocoded barangay fallback state for deep linked coordinates
  const [geoBarangay, setGeoBarangay] = useState("");

  // Centers & hazard zones data
  const centersQuery = useEvacuationCenters(true);
  const hazardZonesQuery = useHazardZones();
  const allHazardReportsQuery = useHazardReports("all", {
    enabled: Boolean(deepLinkedHazardId),
  });
  const publicHazardReportsQuery = usePublicHazardReports({
    enabled: Boolean(deepLinkedHazardId),
  });
  const notificationsQuery = useNotifications({
    enabled: Boolean(notificationId),
  });

  const centers = centersQuery.data ?? null;
  const hazardZones = hazardZonesQuery.data ?? null;

  // Match hazard report across both admin and public queries
  const matchedHazardReport = useMemo(() => {
    if (!deepLinkedHazardId) return null;
    const all = [
      ...(Array.isArray(allHazardReportsQuery.data)
        ? allHazardReportsQuery.data
        : allHazardReportsQuery.data?.data ||
          allHazardReportsQuery.data?.reports ||
          []),
      ...(Array.isArray(publicHazardReportsQuery.data)
        ? publicHazardReportsQuery.data
        : publicHazardReportsQuery.data?.data ||
          publicHazardReportsQuery.data?.reports ||
          []),
    ];
    return (
      all.find((r) => String(r.id) === String(deepLinkedHazardId)) || null
    );
  }, [
    deepLinkedHazardId,
    allHazardReportsQuery.data,
    publicHazardReportsQuery.data,
  ]);

  // Match hazard zone features
  const matchedHazardZone = useMemo(() => {
    if (!deepLinkedHazardId || !hazardZones?.features) return null;
    return (
      hazardZones.features.find((f) => {
        const id = f.properties?.id ?? f.id;
        return String(id) === String(deepLinkedHazardId);
      }) || null
    );
  }, [deepLinkedHazardId, hazardZones]);

  // Selected center for map & summary card
  const [selectedCenter, setSelectedCenter] = useState(null);
  const [mapFocusLocation, setMapFocusLocation] = useState(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState("all"); // "all" | "mapped" | "unmapped"
  const [geocodingResults, setGeocodingResults] = useState([]);
  const [geocodingLoading, setGeocodingLoading] = useState(false);

  // Panel state: Desktop floating panel collapsed by default unless deep linked
  const [panelCollapsed, setPanelCollapsed] = useState(() => !deepLinkedCenterId);

  // Mobile Bottom Sheet state: closed by default
  const [bottomSheetOpen, setBottomSheetOpen] = useState(false);

  // Placement Flow state
  const [isMapping, setIsMapping] = useState(false);
  const [mappingStep, setMappingStep] = useState("footprint"); // "footprint" | "entrance" | "confirm"
  const [editingCenter, setEditingCenter] = useState(null);
  const [footprintPoints, setFootprintPoints] = useState([]);
  const [entrancePoints, setEntrancePoints] = useState([]);
  const [mappingTool, setMappingTool] = useState("draw"); // "draw" | "pan"
  const [mapZoom, setMapZoom] = useState(12);
  const [savingMap, setSavingMap] = useState(false);

  // Placement flow toast message (e.g. Entrance must be on outline)
  const showPlacementToast = (msg) => {
    setPlacementToast(msg);
    setTimeout(() => {
      setPlacementToast(null);
    }, 2500);
  };
  const [placementToast, setPlacementToast] = useState(null);

  // Success Notice with "Back to center" button
  const [saveNotice, setSaveNotice] = useState(null);

  // Track if deep link center & mode=place have been initialized
  const handledModePlaceRef = useRef(false);

  // Handle escape key to close bottom sheet
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "Escape") {
        if (bottomSheetOpen) {
          setBottomSheetOpen(false);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [bottomSheetOpen]);

  // Mapbox Geocoding for "Places" search group (limited to PH near Sogod, Southern Leyte)
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setGeocodingResults([]);
      setGeocodingLoading(false);
      return;
    }

    const timer = setTimeout(async () => {
      setGeocodingLoading(true);
      try {
        const token = import.meta.env.VITE_MAPBOX_TOKEN;
        if (!token) return;
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
          q
        )}.json?country=ph&proximity=124.996,10.435&limit=4&access_token=${token}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          setGeocodingResults(data.features || []);
        } else {
          setGeocodingResults([]);
        }
      } catch (err) {
        console.warn("Places geocoding search failed:", err);
        setGeocodingResults([]);
      } finally {
        setGeocodingLoading(false);
      }
    }, 280);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Deep Link Handling: <route>?center=<id>
  useEffect(() => {
    if (!centers?.features) return;

    if (deepLinkedCenterId) {
      const match = centers.features.find((c) => {
        const id = c.properties?.id ?? c.id;
        return String(id) === String(deepLinkedCenterId);
      });

      if (match) {
        setSelectedCenter(match);
        const coords = getCenterCoordinates(match);
        if (coords) {
          setMapFocusLocation({
            latitude: coords.latitude,
            longitude: coords.longitude,
            requestedAt: Date.now(),
          });
        }

        // Read mode=place once and start the placement flow
        if (initialMode === "place" && !handledModePlaceRef.current) {
          handledModePlaceRef.current = true;
          startPlacementFlow(match);

          // Remove mode=place from URL once read
          const nextSearch = new URLSearchParams(window.location.search);
          nextSearch.delete("mode");
          const query = nextSearch.toString();
          navigate(`${window.location.pathname}${query ? `?${query}` : ""}`, {
            replace: true,
          });
        }
      }
    }
  }, [centers, deepLinkedCenterId, initialMode, navigate]);

  function formatHazardType(rawType) {
    if (!rawType) return "Hazard";
    const cleaned = String(rawType).trim();
    return cleaned
      .split(/[\s_-]+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
  }

  function formatBarangayLabel(rawBrgy) {
    if (!rawBrgy) return "";
    const cleaned = String(rawBrgy).trim();
    if (!cleaned) return "";
    if (/^(brgy\.?|barangay)\s+/i.test(cleaned)) {
      return cleaned.replace(/^(brgy\.?|barangay)\s+/i, "Brgy. ");
    }
    return `Brgy. ${cleaned}`;
  }

  // Reverse geocode deep-linked coordinates to obtain the barangay automatically
  useEffect(() => {
    if (!deepLinkedLat || !deepLinkedLng) {
      setGeoBarangay("");
      return;
    }
    const lat = Number(deepLinkedLat);
    const lng = Number(deepLinkedLng);
    const token = import.meta.env.VITE_MAPBOX_TOKEN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !token) return;

    let cancelled = false;
    const url = `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${lng}&latitude=${lat}&types=locality,neighborhood,place&access_token=${encodeURIComponent(
      token
    )}`;

    fetch(url)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        if (cancelled) return;
        const properties = data.features?.[0]?.properties;
        const context = properties?.context || {};
        const resolved =
          context.neighborhood?.name ||
          context.locality?.name ||
          context.place?.name ||
          properties?.name ||
          "";
        if (resolved) {
          setGeoBarangay(resolved);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [deepLinkedLat, deepLinkedLng]);

  // Deep Link Handling: <route>?lat=<lat>&lng=<lng>
  useEffect(() => {
    if (deepLinkedLat && deepLinkedLng) {
      const lat = Number(deepLinkedLat);
      const lng = Number(deepLinkedLng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        let label = "Incident Location";

        if (deepLinkedHazardId) {
          const rawType =
            deepLinkedType ||
            matchedHazardReport?.report_type ||
            matchedHazardReport?.hazard_type ||
            matchedHazardReport?.type ||
            matchedHazardZone?.properties?.hazard_type ||
            matchedHazardZone?.properties?.name ||
            "";

          const rawBarangay =
            deepLinkedBarangay ||
            matchedHazardReport?.barangay ||
            matchedHazardReport?.barangay_name ||
            matchedHazardZone?.properties?.barangay ||
            matchedHazardZone?.properties?.barangay_name ||
            geoBarangay ||
            "";

          const typeName = rawType ? formatHazardType(rawType) : "Hazard";

          if (rawBarangay) {
            label = `${typeName} • ${formatBarangayLabel(rawBarangay)}`;
          } else if (rawType) {
            label = `${typeName} Report`;
          } else {
            label = "Reported Hazard";
          }
        } else if (deepLinkedRescueId) {
          const rescueBarangay = deepLinkedBarangay || geoBarangay || "";
          if (rescueBarangay) {
            label = `Rescue Request • ${formatBarangayLabel(rescueBarangay)}`;
          } else {
            label = "Rescue Request";
          }
        }

        setMapFocusLocation({
          latitude: lat,
          longitude: lng,
          zoom: 16,
          hazardId: deepLinkedHazardId,
          rescueId: deepLinkedRescueId,
          label,
          requestedAt: Date.now(),
        });
      }
    }
  }, [
    deepLinkedLat,
    deepLinkedLng,
    deepLinkedHazardId,
    deepLinkedRescueId,
    deepLinkedType,
    deepLinkedBarangay,
    matchedHazardReport,
    matchedHazardZone,
    geoBarangay,
  ]);

  // Start placement flow for a center
  function startPlacementFlow(center) {
    if (!center) return;
    const props = center.properties || center;
    setEditingCenter(center);
    setSelectedCenter(center);
    setFootprintPoints(polygonToPoints(center.geometry));

    const rawEntrances = Array.isArray(props.entrances) ? props.entrances : [];
    const normalizedEntrances = rawEntrances
      .map((e) => {
        const lat = Number(e?.lat ?? e?.latitude);
        const lng = Number(e?.lng ?? e?.longitude);
        return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
      })
      .filter(Boolean);
    setEntrancePoints(normalizedEntrances);

    setMappingTool("draw");
    setMappingStep("footprint");
    setIsMapping(true);
    setSaveNotice(null);
    setPlacementToast(null);
    if (bottomSheetOpen) {
      setBottomSheetOpen(false);
    }
  }

  // Cancel placement flow without saving
  function cancelPlacementFlow() {
    setIsMapping(false);
    setMappingStep("footprint");
    setEditingCenter(null);
    setFootprintPoints([]);
    setEntrancePoints([]);
    setMappingTool("draw");
    setSavingMap(false);
    setPlacementToast(null);
  }

  // Save placement flow (outline + entrances)
  async function handleSaveMapPlacement() {
    if (!editingCenter) return;
    const centerId = editingCenter.properties?.id || editingCenter.id;
    if (!centerId) return;

    setSavingMap(true);
    try {
      let geojsonPolygon = null;
      if (footprintPoints.length >= 3) {
        const ring = footprintPoints.map((pt) => [pt.lng, pt.lat]);
        if (
          ring[0][0] !== ring[ring.length - 1][0] ||
          ring[0][1] !== ring[ring.length - 1][1]
        ) {
          ring.push([ring[0][0], ring[0][1]]);
        }
        geojsonPolygon = {
          type: "Polygon",
          coordinates: [ring],
        };
      }

      const payload = {
        geometry: geojsonPolygon,
        entrances: entrancePoints.map((p) => ({
          lat: Number(p.lat),
          lng: Number(p.lng),
        })),
      };

      if (footprintPoints.length > 0) {
        let sumLat = 0;
        let sumLng = 0;
        footprintPoints.forEach((pt) => {
          sumLat += Number(pt.lat);
          sumLng += Number(pt.lng);
        });
        payload.latitude = sumLat / footprintPoints.length;
        payload.longitude = sumLng / footprintPoints.length;
      }

      await api.patch(`/evacuation-centers/${centerId}/mapping`, payload);

      await queryClient.invalidateQueries({
        queryKey: queryKeys.evacuationCenters(true),
      });

      const updatedName =
        editingCenter.properties?.name || editingCenter.name || "Center";

      const savedCenter = editingCenter;
      setIsMapping(false);
      setEditingCenter(null);
      setSelectedCenter(savedCenter);
      setPanelCollapsed(false);
      setFootprintPoints([]);
      setEntrancePoints([]);
      setMappingStep("footprint");
      setPlacementToast(null);

      setSaveNotice({
        centerId,
        message: `Saved outline and entrances for ${updatedName}`,
      });
    } catch (err) {
      console.error("Failed to save mapping placement:", err);
      alert(
        err?.response?.data?.message ||
          "Failed to save map placement. Please ensure footprint has at least 3 points."
      );
    } finally {
      setSavingMap(false);
    }
  }

  // Select a center: focus map and switch panel/sheet to detail view
  function handleSelectCenter(center) {
    if (!center) return;
    setSelectedCenter(center);
    setPanelCollapsed(false);
    if (isMobile) {
      setBottomSheetOpen(true);
    }
    const coords = getCenterCoordinates(center);
    if (coords) {
      setMapFocusLocation({
        latitude: coords.latitude,
        longitude: coords.longitude,
        zoom: 16,
        requestedAt: Date.now(),
      });
    }
  }

  // Selecting a place from geocoding search flies map to zoom 16
  function handleSelectPlace(feature) {
    if (!feature?.center) return;
    const [lng, lat] = feature.center;
    setMapFocusLocation({
      latitude: lat,
      longitude: lng,
      zoom: 16,
      requestedAt: Date.now(),
    });
    if (isMobile) {
      setBottomSheetOpen(false);
    }
  }



  // Sidebar navigation handler
  function handleTabChange(nextTab) {
    if (nextTab === "map") return;
    if (nextTab === "dashboard") {
      navigate("/dashboard");
      return;
    }
    if (nextTab === "profile") {
      navigate("/profile");
      return;
    }
    const path = isAdmin ? "/admin" : "/lgu";
    navigate(`${path}?tab=${encodeURIComponent(nextTab)}`);
  }

  function handleNotificationSelect(notification) {
    const path = isAdmin ? "/admin" : "/lgu";
    const tab =
      notification.resource_type === "hazard_report" ? "reports" : "rescue";
    navigate(`${path}?tab=${tab}&notificationId=${notification.id}`);
  }

  // List calculations
  const allCentersList = useMemo(() => {
    return centers?.features || [];
  }, [centers]);

  const mappedCount = useMemo(() => {
    return allCentersList.filter(isCenterMapped).length;
  }, [allCentersList]);

  const unmappedCount = allCentersList.length - mappedCount;

  const filteredCenters = useMemo(() => {
    return allCentersList.filter((center) => {
      const props = center.properties || center;
      const mapped = isCenterMapped(center);

      if (filter === "mapped" && !mapped) return false;
      if (filter === "unmapped" && mapped) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      const name = String(props.name || "").toLowerCase();
      const address = String(props.address || "").toLowerCase();
      const barangays = (props.barangays || [])
        .map((b) => String(b.name || "").toLowerCase())
        .join(" ");
      return name.includes(q) || address.includes(q) || barangays.includes(q);
    });
  }, [allCentersList, filter, searchQuery]);


  // Render Center List Item
  function renderCenterItem(center) {
    const props = center.properties || center;
    const centerId = props.id ?? center.id;
    const mapped = isCenterMapped(center);
    const isSelected =
      selectedCenter &&
      String(selectedCenter.properties?.id ?? selectedCenter.id) ===
        String(centerId);
    const active = Boolean(props.is_active);

    return (
      <button
        key={centerId}
        type="button"
        className={`admin-map-center-item ${isSelected ? "is-selected" : ""}`}
        onClick={() => handleSelectCenter(center)}
        aria-selected={isSelected}
      >
        <div className="admin-map-item-main">
          <div className="admin-map-item-title-row">
            <span
              className={`admin-map-status-dot ${
                active ? "is-active" : "is-inactive"
              }`}
              title={active ? "Active" : "Inactive"}
              aria-label={active ? "Active" : "Inactive"}
            />
            <span className="admin-map-item-name">
              {props.name || "Evacuation Center"}
            </span>
          </div>

          <div className="admin-map-item-sub">
            {props.barangays && props.barangays.length > 0
              ? props.barangays
                  .map((b) => displayEntityName(b.name || b))
                  .join(", ")
              : "No barangay assigned"}
          </div>
        </div>

        <div className="admin-map-item-badge-wrap">
          {!mapped ? (
            <span className="admin-map-unmapped-tag">Not mapped</span>
          ) : (
            <span className="admin-map-mapped-tag">
              {props.capacity ? `${props.capacity} cap` : "Mapped"}
            </span>
          )}
        </div>
      </button>
    );
  }

  // Detail View when a center is selected
  function renderDetailView() {
    if (!selectedCenter) return null;
    const props = selectedCenter.properties || selectedCenter || {};
    const centerId = props.id ?? selectedCenter.id;
    const active = Boolean(props.is_active);
    const mapped = isCenterMapped(selectedCenter);
    const capacity = Number(props.capacity || 0);
    const occupied = Number(props.occupied || 0);
    const occ = getOccupancyStatus(occupied, capacity);
    const barangays = props.barangays || props.barangay_breakdown || [];
    const contactNumber = props.contact_number || props.contact || null;
    const basePath = isAdmin ? "/admin" : "/lgu";

    return (
      <div className="admin-map-detail-view">
        <div className="admin-map-detail-top-row">
          <button
            type="button"
            className="admin-map-back-btn"
            onClick={() => setSelectedCenter(null)}
            aria-label="Back to centers list"
          >
            <FontAwesomeIcon icon={faChevronLeft} />
            <span>Back</span>
          </button>
          {isMobile && (
            <button
              type="button"
              className="admin-map-sheet-close"
              onClick={() => setBottomSheetOpen(false)}
              aria-label="Close bottom sheet"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          )}
        </div>

        <div className="admin-map-detail-title-row">
          <h2 className="admin-map-detail-name">
            {props.name || "Evacuation Center"}
          </h2>
          <span
            className={`admin-map-detail-badge ${
              active ? "is-active" : "is-inactive"
            }`}
          >
            {active ? "Active" : "Inactive"}
          </span>
        </div>

        <div className="admin-map-detail-section">
          <div className="admin-map-detail-label">
            Barangays: {barangays.length}
          </div>
          <div className="admin-map-detail-barangays-text">
            {barangays.length > 0
              ? barangays.map((b) => displayEntityName(b.name || b)).join(", ")
              : "No barangays assigned"}
          </div>
        </div>

        <div className="admin-map-detail-section">
          <div className="admin-map-detail-occ-header">
            <span className="admin-map-detail-label">Occupancy</span>
            <span className="admin-map-detail-occ-count">
              {occupied} of {capacity} people
            </span>
          </div>
          <div className="admin-map-slim-progress-track" aria-hidden="true">
            <div
              className="admin-map-slim-progress-fill"
              style={{
                width: `${occ.percent}%`,
                backgroundColor: occ.color,
              }}
            />
          </div>
          <div className="admin-map-detail-occ-sub">
            <span style={{ color: occ.color, fontWeight: 600 }}>
              {occ.percent}% ({occ.statusText})
            </span>
            <span className="admin-map-detail-muted-text">
              {occ.spacesLeftText}
            </span>
          </div>
        </div>

        <div className="admin-map-detail-section">
          <div className="admin-map-detail-label">Contact number</div>
          <div className="admin-map-detail-contact-text">
            {contactNumber || "None provided"}
          </div>
        </div>

        <div className="admin-map-detail-actions">
          {!mapped ? (
            <>
              <button
                type="button"
                className="admin-map-btn admin-map-btn-primary"
                onClick={() => startPlacementFlow(selectedCenter)}
              >
                <FontAwesomeIcon icon={faDrawPolygon} />
                <span>Place on map</span>
              </button>
              <button
                type="button"
                className="admin-map-btn-link"
                onClick={() => {
                  navigate(`${basePath}?tab=centers&center=${centerId}`);
                }}
              >
                <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                <span>View details</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="admin-map-btn admin-map-btn-primary"
                onClick={() => {
                  navigate(`${basePath}?tab=centers&center=${centerId}`);
                }}
              >
                <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                <span>View details</span>
              </button>
              <button
                type="button"
                className="admin-map-btn admin-map-btn-secondary"
                onClick={() => startPlacementFlow(selectedCenter)}
              >
                <FontAwesomeIcon icon={faDrawPolygon} />
                <span>Edit outline</span>
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // Common Search & List View used inside Desktop Panel & Mobile Bottom Sheet
  function renderPanelContent() {
    const isSearching = searchQuery.trim().length >= 2;

    return (
      <>
        {/* ONE SEARCH: Unified search field for Centers and Places */}
        <div className="admin-map-search-wrap">
          <FontAwesomeIcon icon={faSearch} className="admin-map-search-icon" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search center, barangay or place..."
            className="admin-map-search-input"
            aria-label="Search evacuation centers or places"
          />
          {searchQuery && (
            <button
              type="button"
              className="admin-map-search-clear"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search query"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          )}
        </div>

        {/* Filter pills: shown when idle (not typing search) */}
        {!isSearching && (
          <div
            className="admin-map-filter-row"
            role="group"
            aria-label="Filter centers by mapping status"
          >
            <button
              type="button"
              className={`admin-map-filter-btn ${
                filter === "all" ? "is-active" : ""
              }`}
              onClick={() => setFilter("all")}
            >
              <span>All</span>
              <span className="admin-map-filter-pill">
                {allCentersList.length}
              </span>
            </button>

            <button
              type="button"
              className={`admin-map-filter-btn ${
                filter === "mapped" ? "is-active" : ""
              }`}
              onClick={() => setFilter("mapped")}
            >
              <span>Mapped</span>
              <span className="admin-map-filter-pill">{mappedCount}</span>
            </button>

            <button
              type="button"
              className={`admin-map-filter-btn ${
                filter === "unmapped" ? "is-active" : ""
              }`}
              onClick={() => setFilter("unmapped")}
            >
              <span>Not mapped</span>
              <span className="admin-map-filter-pill">{unmappedCount}</span>
            </button>
          </div>
        )}

        {/* Panel Body / Results List */}
        <div className="admin-map-list" role="list">
          {isSearching ? (
            <div className="admin-map-search-groups">
              {/* Group 1: Centers */}
              <div className="admin-map-group">
                <div className="admin-map-group-heading">
                  <FontAwesomeIcon icon={faHouseFlag} />
                  <span>Centers ({filteredCenters.length})</span>
                </div>

                {filteredCenters.length > 0 ? (
                  <div className="admin-map-group-items">
                    {filteredCenters.map(renderCenterItem)}
                  </div>
                ) : (
                  <div className="admin-map-search-empty">
                    No evacuation centers matching &ldquo;{searchQuery}&rdquo;
                  </div>
                )}
              </div>

              {/* Group 2: Places (Mapbox Geocoding near Sogod) */}
              <div className="admin-map-group">
                <div className="admin-map-group-heading">
                  <FontAwesomeIcon icon={faMapPin} />
                  <span>
                    Places{" "}
                    {geocodingLoading
                      ? "..."
                      : `(${geocodingResults.length})`}
                  </span>
                </div>

                {geocodingResults.length > 0 ? (
                  <div className="admin-map-group-items">
                    {geocodingResults.map((place) => (
                      <button
                        key={place.id}
                        type="button"
                        className="admin-map-place-item"
                        onClick={() => handleSelectPlace(place)}
                        title="Fly map to this place"
                      >
                        <FontAwesomeIcon
                          icon={faLocationDot}
                          className="admin-map-place-icon"
                        />
                        <div className="admin-map-place-text">
                          <strong>{place.text || place.place_name}</strong>
                          <small>{place.place_name}</small>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  !geocodingLoading && (
                    <div className="admin-map-search-empty">
                      No places found near Sogod
                    </div>
                  )
                )}
              </div>
            </div>
          ) : filteredCenters.length > 0 ? (
            filteredCenters.map(renderCenterItem)
          ) : (
            <div className="admin-map-empty">
              <p>No evacuation centers match your filter.</p>
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <div className="dashboard-layout">
      {/* Admin Sidebar with "Map" tab active */}
      <Sidebar
        tab="map"
        setTab={handleTabChange}
        user={user}
        logout={logout}
        isMobile={isMobile}
        onSelectNotification={handleNotificationSelect}
      />

      <div className="dashboard-content">
        <main
          className={`admin-map-page ${
            panelCollapsed ? "is-panel-collapsed" : ""
          } ${isMapping ? "in-mapping-mode" : ""} ${
            selectedCenter ? "has-selected-center" : ""
          }`}
          aria-label="Admin Map View"
        >
          {/* ---------------------------------------------------------
              MAP CANVAS & PLACEMENT FLOW WORKSPACE (Fills entire area)
              --------------------------------------------------------- */}
          <div className="admin-map-canvas-wrap">
            {/* Active Center Placement Flow (Full-Screen Workspace overlay) */}
            {isMapping ? (
              <CenterPlacementFlow
                center={editingCenter}
                step={mappingStep}
                onStepChange={setMappingStep}
                footprintPoints={footprintPoints}
                onFootprintPointsChange={setFootprintPoints}
                entrancePoints={entrancePoints}
                onEntrancePointsChange={setEntrancePoints}
                mappingTool={mappingTool}
                onMappingToolChange={setMappingTool}
                mapZoom={mapZoom}
                onCancel={cancelPlacementFlow}
                onSave={handleSaveMapPlacement}
                saving={savingMap}
                onZoomIn={() => {
                  setMapFocusLocation({
                    zoom: 18,
                    requestedAt: Date.now(),
                  });
                }}
                toastMessage={placementToast}
              >
                <DashboardMap
                  centers={centers}
                  hazardZones={hazardZones}
                  selectedCenter={selectedCenter}
                  editingCenter={editingCenter}
                  mappingTool={mappingTool}
                  onMappingToolChange={setMappingTool}
                  currentZoom={mapZoom}
                  onZoomChange={setMapZoom}
                  onCenterClick={(center) => handleSelectCenter(center)}
                  focusLocation={mapFocusLocation}
                  hideInternalPanel={true}
                  hideSearch={true}
                  hideZoomControls={true}
                  drawMode={
                    mappingStep === "footprint"
                      ? "footprint"
                      : mappingStep === "entrance"
                      ? "entrance"
                      : "confirm"
                  }
                  pendingFootprint={footprintPoints}
                  pendingEntrances={entrancePoints}
                  onCloseShape={() => {
                    if (footprintPoints.length >= 3) {
                      setMappingStep("entrance");
                    }
                  }}
                  onOutsideOutlineClick={() => {
                    showPlacementToast("Entrance must be on the outline");
                  }}
                  onMapClick={(latlng) => {
                    if (mappingTool === "pan") return;
                    if (mappingStep === "footprint") {
                      setFootprintPoints((pts) => [...pts, latlng]);
                    } else if (mappingStep === "entrance") {
                      setEntrancePoints((pts) => [...pts, latlng]);
                    }
                  }}
                />
              </CenterPlacementFlow>
            ) : (
              <DashboardMap
                centers={centers}
                hazardZones={hazardZones}
                selectedCenter={selectedCenter}
                editingCenter={editingCenter}
                currentZoom={mapZoom}
                onZoomChange={setMapZoom}
                onCenterClick={(center) => handleSelectCenter(center)}
                focusLocation={mapFocusLocation}
                hideInternalPanel={true}
                hideSearch={true}
                hideZoomControls={true}
              />
            )}

            {/* Post-Save Toast with "Back to center" Button */}
            {saveNotice && !isMapping && (
              <div className="admin-map-save-banner" role="status">
                <div className="admin-map-save-banner-text">
                  <FontAwesomeIcon icon={faCheck} className="text-green-400" />
                  <span>{saveNotice.message}</span>
                </div>

                <button
                  type="button"
                  className="btn-back"
                  onClick={() => {
                    const basePath = isAdmin ? "/admin" : "/lgu";
                    navigate(
                      `${basePath}?tab=centers&center=${saveNotice.centerId}`
                    );
                  }}
                  title="Open this center on the Evacuation Centers page"
                >
                  <FontAwesomeIcon icon={faArrowLeft} />
                  <span>Back to center</span>
                </button>

                <button
                  type="button"
                  className="btn-dismiss"
                  onClick={() => setSaveNotice(null)}
                  aria-label="Dismiss notification"
                  title="Dismiss notification"
                >
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              </div>
            )}

          </div>

          {/* ---------------------------------------------------------
              DESKTOP FLOATING PANEL (Width 320px, left 16px, top 16px)
              --------------------------------------------------------- */}
          {!isMobile && !panelCollapsed && !isMapping && (
            <aside
              className="admin-map-floating-panel"
              aria-label="Evacuation Centers Panel"
            >
              {selectedCenter ? (
                <div className="admin-map-panel-body">
                  {renderDetailView()}
                </div>
              ) : (
                <>
                  <header className="admin-map-panel-header">
                    <div className="admin-map-panel-title-row">
                      <h2>
                        <FontAwesomeIcon
                          icon={faBuildingColumns}
                          className="text-blue-600"
                        />
                        <span>Centers</span>
                      </h2>
                      {unmappedCount > 0 && (
                        <span className="admin-map-unmapped-badge">
                          {unmappedCount}
                        </span>
                      )}
                      <button
                        type="button"
                        className="admin-map-panel-collapse-btn"
                        onClick={() => setPanelCollapsed(true)}
                        title="Collapse panel"
                        aria-label="Collapse centers panel"
                      >
                        <FontAwesomeIcon icon={faChevronLeft} />
                      </button>
                    </div>
                  </header>

                  <div className="admin-map-panel-body">
                    {renderPanelContent()}
                  </div>
                </>
              )}
            </aside>
          )}

          {/* Collapsed "Centers" button (Desktop & Mobile) */}
          {((!isMobile && panelCollapsed) || (isMobile && !bottomSheetOpen)) &&
            !isMapping && (
              <button
                type="button"
                className="admin-map-collapsed-btn"
                onClick={() => {
                  if (isMobile) {
                    setBottomSheetOpen(true);
                  } else {
                    setPanelCollapsed(false);
                  }
                }}
                aria-label={
                  unmappedCount > 0
                    ? `Centers, ${unmappedCount} not mapped`
                    : "Centers"
                }
              >
                <FontAwesomeIcon icon={faBuildingColumns} />
                <span>Centers</span>
                {unmappedCount > 0 && (
                  <span className="admin-map-unmapped-badge">
                    {unmappedCount}
                  </span>
                )}
              </button>
            )}

          {/* ---------------------------------------------------------
              MOBILE BOTTOM SHEET (Full width, 70% height, visible <= 768px)
              --------------------------------------------------------- */}
          {isMobile && !isMapping && (
            <>
              <div
                className={`admin-map-bottom-sheet-backdrop ${
                  bottomSheetOpen ? "is-open" : ""
                }`}
                onClick={() => setBottomSheetOpen(false)}
                aria-hidden={!bottomSheetOpen}
              />

              <section
                className={`admin-map-bottom-sheet ${
                  bottomSheetOpen ? "is-open" : ""
                }`}
                role="dialog"
                aria-modal="true"
                aria-label="Evacuation Centers"
                aria-hidden={!bottomSheetOpen}
              >
                <div
                  className="admin-map-sheet-handle-bar"
                  aria-hidden="true"
                />

                {selectedCenter ? (
                  <div className="admin-map-sheet-body">
                    {renderDetailView()}
                  </div>
                ) : (
                  <>
                    <div className="admin-map-sheet-header">
                      <h3>
                        <FontAwesomeIcon
                          icon={faBuildingColumns}
                          className="text-blue-600"
                        />
                        <span>Centers</span>
                      </h3>
                      {unmappedCount > 0 && (
                        <span className="admin-map-unmapped-badge">
                          {unmappedCount}
                        </span>
                      )}

                      <button
                        type="button"
                        className="admin-map-sheet-close"
                        onClick={() => setBottomSheetOpen(false)}
                        aria-label="Close bottom sheet"
                      >
                        <FontAwesomeIcon icon={faXmark} />
                      </button>
                    </div>

                    <div className="admin-map-sheet-body">
                      {renderPanelContent()}
                    </div>
                  </>
                )}
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

import { useState, useEffect, useRef, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useAuth } from "../context/AuthContext";
import { api, BASE_URL } from "../services/api";
import { queryKeys, useHazardReports, useRoadSegments } from "../hooks/useEvacuationQueries";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheck,
  faXmark,
  faImage,
  faLocationDot,
  faClock,
  faMagnifyingGlassPlus,
  faRoad,
  faWater,
  faMountain,
  faTriangleExclamation,
  faSearch,
  faLayerGroup,
  faCompass,
  faCircleCheck,
  faChevronLeft,
  faChevronRight,
  faShieldHalved,
  faFileCsv,
  faFilter,
  faUser,
} from "@fortawesome/free-solid-svg-icons";
import { highlightAndOpenSavedReport } from "../utils/mapLocationIndicators";
import "../components_css/HazardReportReview.css";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "validated", label: "Validated" },
  { key: "resolved", label: "Resolved" },
  { key: "rejected", label: "Rejected" },
];

const HAZARD_TYPE_FILTERS = [
  { key: "all", label: "All Types" },
  { key: "flood", label: "Flood" },
  { key: "landslide", label: "Landslide" },
  { key: "road blockage", label: "Road Blockage" },
  { key: "other", label: "Other" },
];

const CANNED_RESPONSES = [
  "Verified by Barangay Tanod",
  "MDRRMO / DPWH clearing crew dispatched",
  "Duplicate report — linked to existing incident",
  "Hazard cleared — road safely reopened",
  "Inaccurate location / unverifiable photo",
];

const STATUS_META = {
  pending: { label: "Pending", color: "#2563eb", bg: "rgba(37, 99, 235, 0.1)" },
  validated: { label: "Validated", color: "#dc2626", bg: "rgba(220, 38, 38, 0.1)" },
  rejected: { label: "Rejected", color: "#64748b", bg: "rgba(100, 116, 139, 0.1)" },
  resolved: { label: "Resolved", color: "#16a34a", bg: "rgba(22, 163, 74, 0.1)" },
  all: { label: "All", color: "#0f172a", bg: "rgba(15, 23, 42, 0.08)" },
};

function statusMeta(status) {
  return STATUS_META[status] || { label: status, color: "#64748b", bg: "#f1f5f9" };
}

function reportIcon(reportType = "") {
  const type = String(reportType).toLowerCase();
  if (type.includes("road") || type.includes("block") || type.includes("obstruct")) return faRoad;
  if (type.includes("flood")) return faWater;
  if (type.includes("landslide")) return faMountain;
  return faTriangleExclamation;
}

function reportPhotoUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  const base = BASE_URL.endsWith("/") ? BASE_URL.slice(0, -1) : BASE_URL;
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

function formatRelativeTime(dateString) {
  if (!dateString) return "Recently";
  const date = new Date(dateString);
  const now = new Date();
  const diffInMinutes = Math.floor((now - date) / (1000 * 60));
  if (diffInMinutes < 1) return "Just now";
  if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}h ago`;
  const diffInDays = Math.floor(diffInHours / 24);
  return `${diffInDays}d ago`;
}

function distanceInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function createGeoJSONCircle(centerLng, centerLat, radiusInMeters = 100, points = 64) {
  const km = radiusInMeters / 1000;
  const distanceX = km / (111.32 * Math.cos((centerLat * Math.PI) / 180));
  const distanceY = km / 110.574;
  const ret = [];
  for (let i = 0; i < points; i++) {
    const theta = (i / points) * (2 * Math.PI);
    const x = distanceX * Math.cos(theta);
    const y = distanceY * Math.sin(theta);
    ret.push([centerLng + x, centerLat + y]);
  }
  ret.push(ret[0]);
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [ret],
    },
    properties: {},
  };
}

function getReportStreetOrPlace(report, roadSegmentsData) {
  if (report?.street) return report.street;
  if (report?.place_name) return report.place_name;
  if (report?.address?.street) return report.address.street;
  if (report?.location_name) return report.location_name;

  const lat = Number(report?.latitude);
  const lng = Number(report?.longitude);
  if (roadSegmentsData && Number.isFinite(lat) && Number.isFinite(lng)) {
    const features = Array.isArray(roadSegmentsData) ? roadSegmentsData : roadSegmentsData?.features || [];
    let closestName = null;
    let minDistance = 250;
    for (const feat of features) {
      const coords = feat.geometry?.coordinates;
      if (!coords) continue;
      const roadName = feat.properties?.road_name || feat.properties?.name;
      if (!roadName) continue;
      const lines = feat.geometry.type === "MultiLineString" ? coords : [coords];
      for (const line of lines) {
        for (const [pLng, pLat] of line) {
          const d = distanceInMeters(lat, lng, pLat, pLng);
          if (d < minDistance) {
            minDistance = d;
            closestName = roadName;
          }
        }
      }
    }
    if (closestName) return closestName;
  }

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
  return "Incident Location";
}

function getReportBarangay(report, resolvedBarangay) {
  if (resolvedBarangay) return resolvedBarangay;
  return (
    report?.barangay_name ||
    report?.barangay ||
    report?.location?.barangay ||
    report?.address?.barangay ||
    "Barangay Poblacion"
  );
}

function getReportReporter(report) {
  return (
    report?.reporter_name ||
    report?.reporter ||
    report?.submitted_by_name ||
    report?.resident_name ||
    "Citizen Reporter"
  );
}

function HazardReportReview({ focusReportId, onOpenMap }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  const reportsQuery = useHazardReports("all");
  const reports = reportsQuery.data || [];
  const loading = reportsQuery.isLoading;

  const roadSegmentsQuery = useRoadSegments();
  const roadSegmentsData = roadSegmentsQuery.data;

  const [selected, setSelected] = useState(null);
  const [activePhotoIdx, setActivePhotoIdx] = useState(0);
  const [responseNotes, setResponseNotes] = useState("");
  const [lightbox, setLightbox] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [barangayName, setBarangayName] = useState("");
  const [barangayLoading, setBarangayLoading] = useState(false);

  // Drawer accessibility refs
  const drawerRef = useRef(null);
  const closeBtnRef = useRef(null);
  const lastActiveRowRef = useRef(null);

  const dynamicStatusFilters = useMemo(() => {
    const base = [...STATUS_FILTERS];
    const knownKeys = new Set(base.map((b) => b.key));
    reports.forEach((r) => {
      if (r.status && !knownKeys.has(r.status)) {
        knownKeys.add(r.status);
        base.push({
          key: r.status,
          label: r.status.charAt(0).toUpperCase() + r.status.slice(1),
        });
      }
    });
    return base;
  }, [reports]);

  const dynamicTypeFilters = useMemo(() => {
    const base = [...HAZARD_TYPE_FILTERS];
    const knownKeys = new Set(base.map((b) => b.key.toLowerCase()));
    reports.forEach((r) => {
      const type = (r.report_type || "").trim().toLowerCase();
      if (type && !knownKeys.has(type)) {
        knownKeys.add(type);
        base.push({
          key: type,
          label: r.report_type.charAt(0).toUpperCase() + r.report_type.slice(1),
        });
      }
    });
    return base;
  }, [reports]);

  function clearAllFilters() {
    setStatusFilter("all");
    setTypeFilter("all");
    setSearchQuery("");
  }

  // Mapbox mini-map refs
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const mapMarkerRef = useRef(null);

  // Top header section measurement for desktop height calc
  const topSectionRef = useRef(null);
  const [headerOffset, setHeaderOffset] = useState(280);

  useEffect(() => {
    if (!topSectionRef.current) return;
    const updateOffset = () => {
      if (topSectionRef.current) {
        const rect = topSectionRef.current.getBoundingClientRect();
        const offset = Math.round(rect.bottom + 16);
        setHeaderOffset(offset > 0 ? offset : 280);
      }
    };

    updateOffset();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateOffset) : null;
    if (ro && topSectionRef.current) ro.observe(topSectionRef.current);
    window.addEventListener("resize", updateOffset);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener("resize", updateOffset);
    };
  }, []);

  // Auto-select focused report if provided from notification
  useEffect(() => {
    if (focusReportId == null || !reports.length) return;
    const target = reports.find((item) => String(item.id) === String(focusReportId));
    if (target) {
      openReport(target);
    }
  }, [focusReportId, reports]);

  // Keep selected report synchronized if reports list updates
  useEffect(() => {
    if (!selected) return;
    const fresh = reports.find((r) => r.id === selected.id);
    if (fresh && (fresh.status !== selected.status || fresh.response_notes !== selected.response_notes)) {
      setSelected(fresh);
    }
  }, [reports, selected]);

  // Resolve barangay for selected report
  useEffect(() => {
    if (!selected) {
      setBarangayName("");
      setBarangayLoading(false);
      return undefined;
    }

    const knownBarangay =
      selected.barangay_name ||
      selected.barangay ||
      selected.location?.barangay ||
      selected.address?.barangay;

    if (knownBarangay) {
      setBarangayName(knownBarangay);
      setBarangayLoading(false);
      return undefined;
    }

    const lat = Number(selected.latitude);
    const lng = Number(selected.longitude);
    const token = import.meta.env.VITE_MAPBOX_TOKEN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !token) {
      setBarangayName("");
      setBarangayLoading(false);
      return undefined;
    }

    let cancelled = false;
    setBarangayLoading(true);

    const url =
      `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${lng}` +
      `&latitude=${lat}&types=locality,neighborhood,place&access_token=${encodeURIComponent(token)}`;

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
        setBarangayName(resolved);
      })
      .catch(() => {
        if (!cancelled) setBarangayName("");
      })
      .finally(() => {
        if (!cancelled) setBarangayLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selected]);

  // Multi-photo normalized list for selected report
  const selectedPhotos = useMemo(() => {
    if (!selected) return [];
    if (Array.isArray(selected.photos) && selected.photos.length > 0) {
      return selected.photos;
    }
    return selected.photo_url ? [selected.photo_url] : [];
  }, [selected]);

  // Nearby affected road segments (within 100 meters)
  const nearbyRoads = useMemo(() => {
    if (!selected || !roadSegmentsData) return [];
    const lat = Number(selected.latitude);
    const lng = Number(selected.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];

    const features = Array.isArray(roadSegmentsData)
      ? roadSegmentsData
      : roadSegmentsData?.features || [];

    const matchedNames = new Set();

    features.forEach((feat) => {
      const coords = feat.geometry?.coordinates;
      if (!coords) return;
      const roadName = feat.properties?.road_name || feat.properties?.name || `Road #${feat.properties?.id || ""}`;

      const lines = feat.geometry.type === "MultiLineString" ? coords : [coords];
      for (const line of lines) {
        for (const [pLng, pLat] of line) {
          if (distanceInMeters(lat, lng, pLat, pLng) <= 100) {
            matchedNames.add(roadName);
            return;
          }
        }
      }
    });

    return Array.from(matchedNames);
  }, [selected, roadSegmentsData]);

  // Mini-map initialization and lifecycle inside Drawer
  useEffect(() => {
    if (!selected || !mapContainerRef.current) return undefined;
    const lat = Number(selected.latitude);
    const lng = Number(selected.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;

    let map = mapInstanceRef.current;

    if (!map) {
      map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: "mapbox://styles/mapbox/streets-v12",
        center: [lng, lat],
        zoom: 15.5,
        attributionControl: false,
      });

      mapInstanceRef.current = map;

      map.on("load", () => {
        const circleGeoJSON = createGeoJSONCircle(lng, lat, 100);
        map.addSource("hazard-buffer", {
          type: "geojson",
          data: circleGeoJSON,
        });

        map.addLayer({
          id: "hazard-buffer-fill",
          type: "fill",
          source: "hazard-buffer",
          paint: {
            "fill-color": "#ef4444",
            "fill-opacity": 0.15,
          },
        });

        map.addLayer({
          id: "hazard-buffer-line",
          type: "line",
          source: "hazard-buffer",
          paint: {
            "line-color": "#dc2626",
            "line-width": 2,
            "line-dasharray": [2, 2],
          },
        });

        map.resize();
        highlightAndOpenSavedReport(map, mapMarkerRef, selected, false);
      });
    } else {
      try {
        if (typeof map.isStyleLoaded === "function" && map.isStyleLoaded() && map.getSource("hazard-buffer")) {
          map.getSource("hazard-buffer").setData(createGeoJSONCircle(lng, lat, 100));
        }
      } catch (err) {
        // ignore
      }
      highlightAndOpenSavedReport(map, mapMarkerRef, selected, false);
      setTimeout(() => map.resize(), 100);
    }

    return () => {};
  }, [selected]);

  // Cleanup map instance on drawer close or unmount
  useEffect(() => {
    if (!selected) {
      if (mapMarkerRef.current) {
        mapMarkerRef.current.remove();
        mapMarkerRef.current = null;
      }
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    }
  }, [selected]);

  // Keyboard navigation for Lightbox and Drawer Escape
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "Escape") {
        if (lightbox) {
          e.stopPropagation();
          setLightbox(false);
          return;
        }
        if (selected) {
          closeDrawer();
        }
      }
      if (lightbox && selectedPhotos.length > 1) {
        if (e.key === "ArrowLeft") {
          setActivePhotoIdx((prev) => (prev > 0 ? prev - 1 : selectedPhotos.length - 1));
        }
        if (e.key === "ArrowRight") {
          setActivePhotoIdx((prev) => (prev < selectedPhotos.length - 1 ? prev + 1 : 0));
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lightbox, selected, selectedPhotos]);

  // Focus management: move focus into drawer on open
  useEffect(() => {
    if (selected) {
      setTimeout(() => {
        if (closeBtnRef.current) {
          closeBtnRef.current.focus();
        } else if (drawerRef.current) {
          drawerRef.current.focus();
        }
      }, 50);
    }
  }, [selected]);

  function openReport(report, event) {
    if (event) {
      if (typeof event.stopPropagation === "function") {
        event.stopPropagation();
      }
      if (event.currentTarget) {
        lastActiveRowRef.current = event.currentTarget;
      }
    }
    setLightbox(false);
    setSelected(report);
    setActivePhotoIdx(0);
    setResponseNotes(report.response_notes || "");
  }

  function closeDrawer() {
    setLightbox(false);
    setSelected(null);
    setTimeout(() => {
      lastActiveRowRef.current?.focus();
    }, 50);
  }

  function handleViewOnMap() {
    if (!selected) return;
    if (typeof onOpenMap === "function") {
      onOpenMap(selected);
      return;
    }
    const lat = Number(selected.latitude ?? selected.lat);
    const lng = Number(selected.longitude ?? selected.lng);
    const isLgu = user?.role === "lgu_personnel";
    const staffMapPath = isLgu ? "/lgu/map" : "/admin/map";
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const params = new URLSearchParams();
      params.set("lat", lat);
      params.set("lng", lng);
      params.set("hazard", selected.id);

      const hType = selected.report_type || selected.hazard_type || selected.type || "";
      const bName = barangayName || selected.barangay_name || selected.barangay || "";
      if (hType) params.set("type", hType);
      if (bName) params.set("barangay", bName);

      navigate(`${staffMapPath}?${params.toString()}`);
    } else {
      navigate(staffMapPath);
    }
  }

  function applyCannedChip(text) {
    if (!responseNotes.trim()) {
      setResponseNotes(text);
    } else {
      setResponseNotes((prev) => `${prev}. ${text}`);
    }
  }

  async function handleValidate(status) {
    if (!selected) return;
    try {
      const result = await api.validateHazardReport(selected.id, status, responseNotes);
      setSelected(result);
      setResponseNotes(result.response_notes || "");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["hazard-reports"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.roadSegments }),
      ]);

      if (result.closed_roads && result.closed_roads.length > 0) {
        alert(`Road(s) automatically closed due to this confirmed hazard:\n\n${result.closed_roads.join("\n")}`);
      }
    } catch (err) {
      alert(`Failed to update report: ${err.message}`);
    }
  }

  async function handleResolve() {
    if (!selected) return;
    if (selected.status === "validated") {
      await handleReopenRoad();
    } else {
      await handleValidate("resolved");
    }
  }

  async function handleReopenRoad() {
    if (!selected) return;
    const confirmed = window.confirm(
      "Mark the road(s) tied to this report as fixed and reopen them for routing?"
    );
    if (!confirmed) return;

    setReopening(true);
    try {
      const result = await api.reopenRoad(selected.id);
      setSelected(result);
      queryClient.setQueryData(queryKeys.hazardReports(result.status), (previous = []) =>
        previous.map((report) => (report.id === result.id ? result : report))
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["hazard-reports"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.roadSegments }),
      ]);

      if (result.reopened_roads?.length) {
        alert(`Reopened:\n\n${result.reopened_roads.join("\n")}`);
      }
      if (result.still_closed?.length) {
        alert(
          `Still closed — another active report is still nearby:\n\n${result.still_closed.join("\n")}`
        );
      }
      if (!result.reopened_roads?.length && !result.still_closed?.length) {
        alert("Report marked resolved.");
      }
    } catch (err) {
      alert(`Failed to reopen road: ${err.message}`);
    } finally {
      setReopening(false);
    }
  }

  function exportCSV() {
    if (!reports.length) return;
    const headers = ["ID", "Type", "Status", "Description", "Latitude", "Longitude", "Submitted At", "Validated By", "Validated At"];
    const rows = reports.map((r) => [
      r.id,
      `"${r.report_type || ""}"`,
      r.status,
      `"${(r.description || "").replace(/"/g, '""')}"`,
      r.latitude,
      r.longitude,
      r.submitted_at || "",
      `"${r.validated_by_name || r.validated_by || ""}"`,
      r.validated_at || "",
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `hazard_reports_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // KPI counts
  const totalCount = reports.length;
  const pendingCount = reports.filter((r) => r.status === "pending").length;
  const validatedCount = reports.filter((r) => r.status === "validated").length;
  const resolvedCount = reports.filter((r) => r.status === "resolved").length;

  // Filtered reports list
  const filteredReports = useMemo(() => {
    return reports.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (typeFilter !== "all" && !String(r.report_type || "").toLowerCase().includes(typeFilter)) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesId = String(r.id).includes(q);
        const matchesType = String(r.report_type || "").toLowerCase().includes(q);
        const matchesDesc = String(r.description || "").toLowerCase().includes(q);
        const matchesNotes = String(r.response_notes || "").toLowerCase().includes(q);
        const matchesValidator = String(r.validated_by_name || "").toLowerCase().includes(q);
        if (!matchesId && !matchesType && !matchesDesc && !matchesNotes && !matchesValidator) {
          return false;
        }
      }
      return true;
    });
  }, [reports, statusFilter, typeFilter, searchQuery]);

  return (
    <div className="hr-page">
      <div className="hr-container" style={{ "--hr-header": `${headerOffset}px` }}>
        {/* TOP COMMAND HEADER & METRIC KPI CARDS */}
        <div ref={topSectionRef} className="hr-top-section">
          <header className="hr-top-header">
            <div className="hr-header-titles">
              <div className="hr-badge-ticker">
                <span className="hr-ticker-beacon" />
                <span>Incident Command Feed</span>
              </div>
              <h1 className="hr-main-title">Hazard Reports & Road Dispatch</h1>
              <p className="hr-subtitle">
                Verify citizen-submitted road hazards, monitor 100m impact zones, and control dynamic route closures.
              </p>
            </div>
            <div className="hr-header-actions">
              <button type="button" onClick={exportCSV} className="hr-export-btn" title="Export incident reports to CSV">
                <FontAwesomeIcon icon={faFileCsv} />
                <span>Export CSV</span>
              </button>
            </div>
          </header>

          {/* 4 CLICKABLE STAT CARDS */}
          <section className="hr-kpi-grid" aria-label="Incident Overview Statistics">
            <button
              type="button"
              onClick={() => setStatusFilter("pending")}
              className={`hr-kpi-card is-pending ${statusFilter === "pending" ? "is-selected-card" : ""} ${pendingCount > 0 ? "has-amber-accent" : ""}`}
              aria-pressed={statusFilter === "pending"}
            >
              <div className="hr-kpi-info">
                <span className="hr-kpi-label">Pending Review</span>
                <strong className="hr-kpi-num">{pendingCount}</strong>
                <small className="hr-kpi-hint">
                  {pendingCount > 0 ? "⚠️ Requires staff triage" : "All reports triaged"}
                </small>
              </div>
              <span className="hr-kpi-icon-pill">
                <FontAwesomeIcon icon={faTriangleExclamation} />
              </span>
            </button>

            <button
              type="button"
              onClick={() => setStatusFilter("validated")}
              className={`hr-kpi-card is-active ${statusFilter === "validated" ? "is-selected-card" : ""}`}
              aria-pressed={statusFilter === "validated"}
            >
              <div className="hr-kpi-info">
                <span className="hr-kpi-label">Active Hazards</span>
                <strong className="hr-kpi-num">{validatedCount}</strong>
                <small className="hr-kpi-hint">Confirmed & affecting routes</small>
              </div>
              <span className="hr-kpi-icon-pill">
                <FontAwesomeIcon icon={faRoad} />
              </span>
            </button>

            <button
              type="button"
              onClick={() => setStatusFilter("resolved")}
              className={`hr-kpi-card is-resolved ${statusFilter === "resolved" ? "is-selected-card" : ""}`}
              aria-pressed={statusFilter === "resolved"}
            >
              <div className="hr-kpi-info">
                <span className="hr-kpi-label">Hazards Cleared</span>
                <strong className="hr-kpi-num">{resolvedCount}</strong>
                <small className="hr-kpi-hint">Roads safely reopened</small>
              </div>
              <span className="hr-kpi-icon-pill">
                <FontAwesomeIcon icon={faCircleCheck} />
              </span>
            </button>

            <button
              type="button"
              onClick={() => setStatusFilter("all")}
              className={`hr-kpi-card is-total ${statusFilter === "all" ? "is-selected-card" : ""}`}
              aria-pressed={statusFilter === "all"}
            >
              <div className="hr-kpi-info">
                <span className="hr-kpi-label">Total Submissions</span>
                <strong className="hr-kpi-num">{totalCount}</strong>
                <small className="hr-kpi-hint">All historical incident logs</small>
              </div>
              <span className="hr-kpi-icon-pill">
                <FontAwesomeIcon icon={faLayerGroup} />
              </span>
            </button>
          </section>
        </div>

        {/* WORKSPACE SHELL: LIST FULL WIDTH */}
        <div className="hr-shell">
          <aside className="hr-list-panel">
            {/* SEARCH & FILTERS */}
            <div className="hr-controls-bar">
              <div className="hr-search-wrap">
                <FontAwesomeIcon icon={faSearch} className="hr-search-icon" />
                <input
                  type="text"
                  placeholder="Search ID, street, keywords..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="hr-search-input"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="hr-search-clear"
                    aria-label="Clear search input"
                  >
                    <FontAwesomeIcon icon={faXmark} />
                  </button>
                )}
              </div>

              {/* FILTERS WRAP OR SCROLL HORIZONTALLY */}
              <div className="hr-controls-filters-row">
                <div className="hr-status-tabs" role="tablist" aria-label="Filter hazard reports by status">
                  {dynamicStatusFilters.map((s) => {
                    const active = statusFilter === s.key;
                    const count =
                      s.key === "all"
                        ? reports.length
                        : reports.filter((r) => r.status === s.key).length;
                    return (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() => setStatusFilter(s.key)}
                        className={`hr-tab-btn ${active ? "is-active" : ""}`}
                        role="tab"
                        aria-selected={active}
                      >
                        <span>{s.label}</span>
                        <span className="hr-tab-count">{count}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="hr-type-select-wrap">
                  <label htmlFor="hr-type-select" className="hr-type-select-label">
                    Type
                  </label>
                  <select
                    id="hr-type-select"
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                    className="hr-type-select"
                  >
                    {dynamicTypeFilters.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* SCROLLABLE LIST */}
            <div className="hr-list-scroll">
              {loading && <div className="hr-loading">Loading reports…</div>}

              {/* EMPTY STATE 1: No reports in system at all */}
              {!loading && reports.length === 0 && (
                <div className="hr-empty">
                  <FontAwesomeIcon icon={faTriangleExclamation} className="hr-empty-icon" />
                  <p className="hr-empty-title">No hazard reports yet</p>
                  <p className="hr-empty-text">New citizen reports will appear here for review.</p>
                </div>
              )}

              {/* EMPTY STATE 2: Filters hide everything */}
              {!loading && reports.length > 0 && filteredReports.length === 0 && (
                <div className="hr-empty">
                  <FontAwesomeIcon icon={faSearch} className="hr-empty-icon" />
                  <p className="hr-empty-title">No matching reports</p>
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="hr-clear-filters-btn"
                  >
                    Clear filters
                  </button>
                </div>
              )}

              {/* FULL-WIDTH REPORT ROWS */}
              {filteredReports.map((r) => {
                const meta = statusMeta(r.status);
                const isSelected = selected?.id === r.id;
                const streetOrPlace = getReportStreetOrPlace(r, roadSegmentsData);
                const barangay = getReportBarangay(r, isSelected ? barangayName : null);
                const reporter = getReportReporter(r);

                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={(e) => openReport(r, e)}
                    className={`hr-row-item ${isSelected ? "is-selected" : ""}`}
                    style={{ borderLeftColor: meta.color }}
                    aria-selected={isSelected}
                  >
                    <div className="hr-row-main-group">
                      <span className="hr-row-type-icon" style={{ color: meta.color }}>
                        <FontAwesomeIcon icon={reportIcon(r.report_type)} />
                      </span>
                      <div className="hr-row-place-wrap">
                        <strong className="hr-row-street">{streetOrPlace}</strong>
                        <span className="hr-row-id">#{r.id}</span>
                      </div>
                      <span className="hr-row-barangay">{barangay}</span>
                    </div>

                    <div className="hr-row-meta-group">
                      <span className="hr-row-reporter" title={`Reporter: ${reporter}`}>
                        <FontAwesomeIcon icon={faUser} />
                        <span>{reporter}</span>
                      </span>

                      <span className="hr-row-time">
                        <FontAwesomeIcon icon={faClock} />
                        <span>{formatRelativeTime(r.submitted_at)}</span>
                      </span>

                      <span
                        className="hr-pill"
                        style={{ background: meta.bg, color: meta.color }}
                      >
                        {meta.label}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>
        </div>
      </div>

      {/* DETAIL DRAWER OVER DIMMED BACKDROP */}
      {selected && (
        <div className="hr-drawer-overlay" onClick={closeDrawer} role="presentation">
          <aside
            ref={drawerRef}
            className="hr-drawer-panel"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Hazard Report Detail"
            tabIndex={-1}
          >
            {/* STICKY HEADER WITH STATUS BADGE & ACTIONS */}
            <div className="hr-drawer-sticky-header">
              <div className="hr-drawer-header-top">
                <div className="hr-drawer-badge-group">
                  <span
                    className="hr-pill hr-pill--lg"
                    style={{
                      background: statusMeta(selected.status).bg,
                      color: statusMeta(selected.status).color,
                    }}
                  >
                    {statusMeta(selected.status).label}
                  </span>
                  <span className="hr-drawer-title-id">Incident #{selected.id}</span>
                </div>

                <button
                  type="button"
                  ref={closeBtnRef}
                  onClick={closeDrawer}
                  className="hr-drawer-close-btn"
                  aria-label="Close report details"
                >
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              </div>

              {/* ACTION BUTTONS: VALIDATE, REJECT, RESOLVE (EACH >= 44PX) */}
              <div className="hr-drawer-header-actions">
                <button
                  type="button"
                  onClick={() => handleValidate("validated")}
                  className="hr-drawer-btn is-validate"
                  disabled={selected.status === "validated"}
                  title="Validate hazard report"
                >
                  <FontAwesomeIcon icon={faCheck} />
                  <span>Validate</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleValidate("rejected")}
                  className="hr-drawer-btn is-reject"
                  disabled={selected.status === "rejected"}
                  title="Reject report as invalid"
                >
                  <FontAwesomeIcon icon={faXmark} />
                  <span>Reject</span>
                </button>

                <button
                  type="button"
                  onClick={handleResolve}
                  className="hr-drawer-btn is-resolve"
                  disabled={selected.status === "resolved" || reopening}
                  title="Mark incident resolved"
                >
                  <FontAwesomeIcon icon={reopening ? faXmark : faCircleCheck} />
                  <span>{reopening ? "Reopening…" : "Resolve"}</span>
                </button>
              </div>
            </div>

            {/* MODAL BODY CONTENT */}
            <div className="hr-drawer-body">
              <div className="hr-drawer-grid">
                {/* LEFT COLUMN: EVIDENCE, DESCRIPTION, DISPATCH NOTES */}
                <div className="hr-drawer-col">
                    {/* PHOTO SECTION */}
                    <div className="hr-drawer-section">
                      <span className="hr-drawer-section-title">Photographic Evidence</span>
                      {selectedPhotos.length > 0 ? (
                        <div className="hr-photo-view-box">
                          <div
                            className="hr-photo-main"
                            onClick={(e) => {
                              e.stopPropagation();
                              setLightbox(true);
                            }}
                            role="button"
                            tabIndex={0}
                            aria-label="View photo in full size lightbox"
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                e.stopPropagation();
                                setLightbox(true);
                              }
                            }}
                          >
                            <img
                              src={reportPhotoUrl(selectedPhotos[activePhotoIdx])}
                              alt={`${selected.report_type} evidence ${activePhotoIdx + 1}`}
                              className="hr-photo-img"
                            />
                            <button
                              type="button"
                              className="hr-photo-zoom-tag"
                              onClick={(e) => {
                                e.stopPropagation();
                                setLightbox(true);
                              }}
                              aria-label="Open full size photo viewer"
                            >
                              <FontAwesomeIcon icon={faMagnifyingGlassPlus} /> Full Size ({activePhotoIdx + 1}/{selectedPhotos.length})
                            </button>
                          </div>

                          {selectedPhotos.length > 1 && (
                            <div className="hr-thumbnail-row">
                              {selectedPhotos.map((url, idx) => (
                                <button
                                  key={url}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActivePhotoIdx(idx);
                                  }}
                                  className={`hr-thumb-btn ${activePhotoIdx === idx ? "is-active" : ""}`}
                                >
                                  <img src={reportPhotoUrl(url)} alt={`Thumbnail ${idx + 1}`} />
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="hr-no-photo-box">
                          <FontAwesomeIcon icon={faImage} />
                          <span>No photo attached to this report</span>
                        </div>
                      )}
                    </div>

                  {/* CITIZEN DESCRIPTION */}
                  <div className="hr-drawer-section">
                    <span className="hr-drawer-section-title">Citizen Description</span>
                    <p className="hr-drawer-description-text">
                      {selected.description || "No specific details provided by resident."}
                    </p>
                  </div>

                  {/* RESPONSE NOTES & LOG */}
                  <div className="hr-drawer-section">
                    <div className="hr-canned-row">
                      <span className="hr-canned-label">Quick Response Notes:</span>
                      <div className="hr-chips-wrap">
                        {CANNED_RESPONSES.map((chip) => (
                          <button
                            key={chip}
                            type="button"
                            onClick={() => applyCannedChip(chip)}
                            className="hr-canned-btn"
                          >
                            + {chip}
                          </button>
                        ))}
                      </div>
                    </div>

                    <label className="hr-textarea-label" htmlFor="hr-notes-input">
                      Official Response Notes
                    </label>
                    <textarea
                      id="hr-notes-input"
                      value={responseNotes}
                      onChange={(e) => setResponseNotes(e.target.value)}
                      className="hr-textarea"
                      placeholder="Enter dispatch notes, actions taken, or reason for decision…"
                    />
                  </div>
                </div>

                {/* RIGHT COLUMN: LOCATION, MINI-MAP, AFFECTED ROADS, AUDIT */}
                <div className="hr-drawer-col">
                  {/* LOCATION AS TEXT */}
                  <div className="hr-drawer-section">
                    <span className="hr-drawer-section-title">
                      <FontAwesomeIcon icon={faLocationDot} /> Location Details
                    </span>
                    <div className="hr-drawer-location-box">
                      <div className="hr-drawer-loc-row">
                        <span className="hr-drawer-loc-label">Street / Place:</span>
                        <strong className="hr-drawer-loc-val">
                          {getReportStreetOrPlace(selected, roadSegmentsData)}
                        </strong>
                      </div>
                      <div className="hr-drawer-loc-row">
                        <span className="hr-drawer-loc-label">Barangay:</span>
                        <strong className="hr-drawer-loc-val">
                          {barangayLoading ? "Resolving..." : (barangayName || getReportBarangay(selected))}
                        </strong>
                      </div>
                      <div className="hr-drawer-loc-row">
                        <span className="hr-drawer-loc-label">Coordinates:</span>
                        <span className="hr-drawer-loc-coords">
                          {Number(selected.latitude).toFixed(5)}, {Number(selected.longitude).toFixed(5)}
                        </span>
                      </div>
                    </div>

                    {/* VIEW ON MAP BUTTON */}
                    <button
                      type="button"
                      onClick={handleViewOnMap}
                      className="hr-view-map-btn"
                      title="View hazard on live interactive staff map"
                    >
                      <FontAwesomeIcon icon={faCompass} />
                      <span>View on map</span>
                    </button>
                  </div>

                  {/* INTERACTIVE MINI-MAP PREVIEW & 100M IMPACT ZONE */}
                  <div className="hr-drawer-section">
                    <div className="hr-minimap-wrap">
                      <div ref={mapContainerRef} className="hr-minimap-container" />
                      <div className="hr-minimap-legend">
                        <span className="hr-legend-dot" /> 100m Impact & Road Closure Zone
                      </div>
                    </div>

                    {nearbyRoads.length > 0 && (
                      <div className="hr-affected-roads-box">
                        <span className="hr-subhead">
                          <FontAwesomeIcon icon={faRoad} /> Affected Streets in 100m Radius
                        </span>
                        <div className="hr-road-tags-list">
                          {nearbyRoads.map((name) => (
                            <span key={name} className="hr-road-tag">
                              {name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* REPORTER INFO & VERIFICATION AUDIT */}
                  <div className="hr-drawer-section">
                    <span className="hr-drawer-section-title">
                      <FontAwesomeIcon icon={faUser} /> Reporter & Audit
                    </span>
                    <div className="hr-reporter-info-card">
                      <div className="hr-reporter-row">
                        <span className="hr-reporter-label">Reported By:</span>
                        <strong className="hr-reporter-val">{getReportReporter(selected)}</strong>
                      </div>
                      <div className="hr-reporter-row">
                        <span className="hr-reporter-label">Submission Channel:</span>
                        <span className="hr-reporter-val">Evacway Resident Web App</span>
                      </div>
                      <div className="hr-reporter-row">
                        <span className="hr-reporter-label">Submitted:</span>
                        <span className="hr-reporter-val">
                          {selected.submitted_at
                            ? new Date(selected.submitted_at).toLocaleString()
                            : "Unknown"}{" "}
                          ({formatRelativeTime(selected.submitted_at)})
                        </span>
                      </div>
                      <div className="hr-reporter-row">
                        <span className="hr-reporter-label">Current Status:</span>
                        <strong style={{ color: statusMeta(selected.status).color }}>
                          {statusMeta(selected.status).label}
                        </strong>
                      </div>
                      <div className="hr-reporter-row">
                        <span className="hr-reporter-label">Verified By:</span>
                        <span className="hr-reporter-val">
                          {selected.validated_by_name ||
                            (selected.validated_by
                              ? `Staff Officer #${selected.validated_by}`
                              : selected.status === "pending"
                              ? "Awaiting review"
                              : "System logged")}
                        </span>
                      </div>
                      {selected.validated_at && (
                        <div className="hr-reporter-row">
                          <span className="hr-reporter-label">Verified At:</span>
                          <span className="hr-reporter-val">
                            {new Date(selected.validated_at).toLocaleString()}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* LIGHTBOX FOR FULL SIZE PHOTO VIEWING */}
      {lightbox && selectedPhotos.length > 0 && (
        <div
          className="hr-lightbox-overlay"
          onClick={(e) => {
            e.stopPropagation();
            setLightbox(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Full size photo preview"
        >
          <button
            type="button"
            className="hr-lightbox-close"
            onClick={(e) => {
              e.stopPropagation();
              setLightbox(false);
            }}
            aria-label="Close photo preview"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>

          <div
            className="hr-lightbox-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            {selectedPhotos.length > 1 && (
              <div className="hr-lightbox-bar">
                <span className="hr-lightbox-counter">
                  Photo {activePhotoIdx + 1} of {selectedPhotos.length}
                </span>
              </div>
            )}

            <div className="hr-lightbox-body">
              {selectedPhotos.length > 1 && (
                <button
                  type="button"
                  className="hr-lightbox-arrow is-prev"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActivePhotoIdx((prev) => (prev > 0 ? prev - 1 : selectedPhotos.length - 1));
                  }}
                  aria-label="Previous photo"
                >
                  <FontAwesomeIcon icon={faChevronLeft} />
                </button>
              )}

              <img
                src={reportPhotoUrl(selectedPhotos[activePhotoIdx])}
                alt={`Hazard report high resolution ${activePhotoIdx + 1}`}
                className="hr-lightbox-img"
              />

              {selectedPhotos.length > 1 && (
                <button
                  type="button"
                  className="hr-lightbox-arrow is-next"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActivePhotoIdx((prev) => (prev < selectedPhotos.length - 1 ? prev + 1 : 0));
                  }}
                  aria-label="Next photo"
                >
                  <FontAwesomeIcon icon={faChevronRight} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default HazardReportReview;
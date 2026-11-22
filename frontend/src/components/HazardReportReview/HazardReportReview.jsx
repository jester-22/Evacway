import { useState, useEffect, useRef, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Compass,
  Construction,
  Download,
  ImageOff,
  Layers,
  Link2,
  MapPin,
  Maximize2,
  Mountain,
  Route,
  Search,
  User,
  Waves,
  X,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { api, BASE_URL } from "../../services/api";
import { queryKeys, useHazardReports, useRoadSegments } from "../../hooks/useEvacuationQueries";
import { formatManilaDateTime, parseTimestamp } from "../../utils/dateTime";
import { Button, StatCard, StatusPill } from "../ui";
import "./HazardReportReview.css";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const HAZARD_TYPE_FILTERS = [
  { key: "all", label: "All Types" },
  { key: "flood", label: "Flood" },
  { key: "landslide", label: "Landslide" },
  { key: "road blockage", label: "Road Blockage" },
  { key: "other", label: "Other" },
];

const ROAD_CLOSURE_RECHECK_HOURS = 24;

const CANNED_RESPONSES = [
  "Verified by Barangay Tanod",
  "MDRRMO / DPWH clearing crew dispatched",
  "Hazard cleared — road safely reopened",
  "Inaccurate location / unverifiable photo",
];

function doesReportNeedRecheck(report) {
  if (!report) return false;
  if (typeof report.needs_recheck === "boolean") {
    return report.needs_recheck;
  }
  if (String(report.status || "").toLowerCase() !== "validated" || !report.blocks_road) {
    return false;
  }
  const sinceRaw = report.validated_at || report.submitted_at;
  if (!sinceRaw) return false;
  const since = parseTimestamp(sinceRaw);
  if (!since) return false;
  const thresholdHours = Number(report.recheck_threshold_hours) || ROAD_CLOSURE_RECHECK_HOURS;
  return Date.now() - since.getTime() >= thresholdHours * 60 * 60 * 1000;
}

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

function getHazardLucideIcon(reportType = "") {
  const type = String(reportType).toLowerCase();
  if (type.includes("road") || type.includes("block") || type.includes("obstruct")) {
    return Construction;
  }
  if (type.includes("flood")) return Waves;
  if (type.includes("landslide")) return Mountain;
  return AlertTriangle;
}

function getReporterInitials(name = "") {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function getStatusPillVariant(status = "") {
  const normalized = String(status).toLowerCase();
  if (normalized === "validated") return "validated";
  if (normalized === "resolved") return "resolved";
  if (normalized === "rejected") return "rejected";
  return "pending";
}

function reportPhotoUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  const base = BASE_URL.endsWith("/") ? BASE_URL.slice(0, -1) : BASE_URL;
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

function formatRelativeTime(dateString) {
  if (!dateString) return "Recently";
  const date = parseTimestamp(dateString);
  if (!date) return "Recently";
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

function isUnnamedRoadName(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return true;
  return /^unnamed\b/i.test(trimmed);
}

function getReportBarangay(report, resolvedBarangaysById) {
  const stored = String(report?.barangay_name || "").trim();
  if (stored) return stored;
  const resolved = String(resolvedBarangaysById?.[report?.id] || "").trim();
  if (resolved) return resolved;
  return "";
}

function getReportStreetOrPlace(report, roadSegmentsData, barangayName = "") {
  const explicitCandidates = [
    report?.street,
    report?.place_name,
    report?.address?.street,
    report?.location_name,
  ];
  for (const candidate of explicitCandidates) {
    if (!isUnnamedRoadName(candidate)) {
      return String(candidate).trim();
    }
  }

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
      if (isUnnamedRoadName(roadName)) continue;
      const lines = feat.geometry.type === "MultiLineString" ? coords : [coords];
      for (const line of lines) {
        for (const [pLng, pLat] of line) {
          const d = distanceInMeters(lat, lng, pLat, pLng);
          if (d < minDistance) {
            minDistance = d;
            closestName = String(roadName).trim();
          }
        }
      }
    }
    if (closestName) return closestName;
  }

  const cleanBarangay = String(barangayName || report?.barangay_name || "").trim();
  if (cleanBarangay) return cleanBarangay;

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
  return "Incident Location";
}

function getReportReporter(report, currentUserRole) {
  if (
    currentUserRole &&
    currentUserRole !== "admin" &&
    currentUserRole !== "lgu_personnel"
  ) {
    return { text: "Deleted user", isDeleted: true };
  }
  const username = String(
    report?.reporter_username || report?.reporter_name || ""
  ).trim();
  if (username && !report?.reporter_deleted) {
    return { text: username, isDeleted: false };
  }
  return { text: "Deleted user", isDeleted: true };
}

const VALID_STATUS_FILTERS = ["all", "pending", "validated", "resolved"];

function HazardReportReview({ focusReportId, onOpenMap }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();

  const rawFilter = String(searchParams.get("filter") || "all").toLowerCase();
  const statusFilter = VALID_STATUS_FILTERS.includes(rawFilter) ? rawFilter : "all";
  const [typeFilter, setTypeFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const listScrollRef = useRef(null);

  const reportsQuery = useHazardReports("all");
  const reports = reportsQuery.data || [];
  const loading = reportsQuery.isLoading;

  const roadSegmentsQuery = useRoadSegments();
  const roadSegmentsData = roadSegmentsQuery.data;

  const [selected, setSelected] = useState(null);
  const [activePhotoIdx, setActivePhotoIdx] = useState(0);
  const [failedImages, setFailedImages] = useState({});
  const [responseNotes, setResponseNotes] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [rejectDuplicateOf, setRejectDuplicateOf] = useState("");
  const [duplicateOfInput, setDuplicateOfInput] = useState("");
  const [savingDuplicate, setSavingDuplicate] = useState(false);
  const [submittingAction, setSubmittingAction] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [resolvedBarangaysById, setResolvedBarangaysById] = useState({});
  const [resolvingBarangayIds, setResolvingBarangayIds] = useState({});
  const attemptedBarangayLookupIdsRef = useRef(new Set());
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const touchStartXRef = useRef(null);

  // Drawer accessibility refs
  const drawerRef = useRef(null);
  const closeBtnRef = useRef(null);
  const lastActiveRowRef = useRef(null);
  const lightboxRef = useRef(null);
  const lightboxCloseBtnRef = useRef(null);

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

  function handleStatusFilterChange(nextStatus) {
    const safeStatus = VALID_STATUS_FILTERS.includes(nextStatus) ? nextStatus : "all";
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("filter", safeStatus);
      return next;
    });
    setPage(1);
  }

  function clearAllFilters() {
    handleStatusFilterChange("all");
    setTypeFilter("all");
    setSearchQuery("");
    setPage(1);
  }

  function handleTypeFilterChange(nextType) {
    setTypeFilter(nextType);
    setPage(1);
  }

  function handleSearchChange(nextSearch) {
    setSearchQuery(nextSearch);
    setPage(1);
  }

  // Mapbox mini-map refs
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const mapMarkerRef = useRef(null);
  const handledFocusReportIdRef = useRef(null);

  useEffect(() => {
    if (listScrollRef.current) {
      listScrollRef.current.scrollTop = 0;
    }
  }, [page, pageSize]);

  // Auto-select focused report once when provided from notification or map "Go back"
  useEffect(() => {
    if (focusReportId == null) {
      handledFocusReportIdRef.current = null;
      return;
    }
    const focusKey = String(focusReportId);
    if (handledFocusReportIdRef.current === focusKey || !reports.length) return;
    const target = reports.find((item) => String(item.id) === focusKey);
    if (target) {
      handledFocusReportIdRef.current = focusKey;
      openReport(target);
    }
  }, [focusReportId, reports]);

  // Keep selected report synchronized if reports list updates
  useEffect(() => {
    if (!selected) return;
    const fresh = reports.find((r) => r.id === selected.id);
    if (
      fresh &&
      (fresh.status !== selected.status ||
        fresh.response_notes !== selected.response_notes ||
        fresh.rejection_reason !== selected.rejection_reason ||
        fresh.duplicate_of !== selected.duplicate_of ||
        fresh.needs_recheck !== selected.needs_recheck ||
        fresh.barangay_name !== selected.barangay_name)
    ) {
      setSelected(fresh);
      setDuplicateOfInput(fresh.duplicate_of ? String(fresh.duplicate_of) : "");
    }
  }, [reports, selected]);

  // Clear any pending notification for this hazard report when opened
  useEffect(() => {
    if (!selected?.id) return;
    api.clearNotificationsByResource("hazard_report", selected.id)
      .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.notifications }))
      .catch(() => {});
  }, [selected?.id, queryClient]);

  // Multi-photo normalized list for selected report
  const selectedPhotos = useMemo(() => {
    if (!selected) return [];
    if (Array.isArray(selected.photos) && selected.photos.length > 0) {
      return selected.photos
        .map((p) => (typeof p === "string" ? p : p?.photo_path || p?.url || ""))
        .filter(Boolean);
    }
    return selected.photo_url ? [selected.photo_url] : [];
  }, [selected]);

  function handlePrevPhoto() {
    if (selectedPhotos.length <= 1) return;
    setActivePhotoIdx((prev) => (prev > 0 ? prev - 1 : selectedPhotos.length - 1));
  }

  function handleNextPhoto() {
    if (selectedPhotos.length <= 1) return;
    setActivePhotoIdx((prev) => (prev < selectedPhotos.length - 1 ? prev + 1 : 0));
  }

  function handleTouchStart(e) {
    if (e.touches && e.touches.length === 1) {
      touchStartXRef.current = e.touches[0].clientX;
    }
  }

  function handleTouchEnd(e) {
    if (touchStartXRef.current === null) return;
    const touchEndX = e.changedTouches[0].clientX;
    const diff = touchStartXRef.current - touchEndX;
    if (diff > 40) {
      handleNextPhoto();
    } else if (diff < -40) {
      handlePrevPhoto();
    }
    touchStartXRef.current = null;
  }

  function handleCarouselKeyDown(e) {
    if (selectedPhotos.length > 1) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        handlePrevPhoto();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        handleNextPhoto();
      }
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      setLightbox(true);
    }
  }

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

    const placeStaticPin = (targetMap) => {
      if (mapMarkerRef.current) {
        mapMarkerRef.current.remove();
        mapMarkerRef.current = null;
      }
      mapMarkerRef.current = new mapboxgl.Marker({
        color: "#dc2626",
        anchor: "bottom",
      })
        .setLngLat([lng, lat])
        .addTo(targetMap);
    };

    let map = mapInstanceRef.current;
    let resizeTimer;

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
        map.resize();
        map.jumpTo({ center: [lng, lat], zoom: 15.5 });
        placeStaticPin(map);
      });
    } else {
      map.jumpTo({ center: [lng, lat], zoom: 15.5 });
      placeStaticPin(map);
      resizeTimer = setTimeout(() => {
        map.resize();
        map.jumpTo({ center: [lng, lat], zoom: 15.5 });
      }, 100);
    }

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
    };
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

  // Keyboard navigation, Escape close, and Focus Trap for Incident Modal & Lightbox
  useEffect(() => {
    if (!selected && !lightbox) return undefined;

    function handleKeyDown(e) {
      if (e.key === "Escape") {
        if (lightbox) {
          e.stopPropagation();
          setLightbox(false);
          return;
        }
        if (selected) {
          e.preventDefault();
          closeDrawer();
          return;
        }
      }

      if (e.key === "Tab") {
        const container = lightbox ? lightboxRef.current : drawerRef.current;
        if (!container) return;

        const focusables = Array.from(
          container.querySelectorAll(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => el.offsetParent !== null);

        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey) {
          if (
            document.activeElement === first ||
            !container.contains(document.activeElement)
          ) {
            e.preventDefault();
            last.focus();
          }
        } else if (
          document.activeElement === last ||
          !container.contains(document.activeElement)
        ) {
          e.preventDefault();
          first.focus();
        }
        return;
      }

      if (selectedPhotos.length > 1) {
        const isEditing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
        if (!isEditing && (lightbox || drawerRef.current?.contains(document.activeElement))) {
          if (e.key === "ArrowLeft") {
            setActivePhotoIdx((prev) => (prev > 0 ? prev - 1 : selectedPhotos.length - 1));
          } else if (e.key === "ArrowRight") {
            setActivePhotoIdx((prev) => (prev < selectedPhotos.length - 1 ? prev + 1 : 0));
          }
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lightbox, selected, selectedPhotos]);

  // Focus management: move focus into lightbox on open, restore to modal on close
  useEffect(() => {
    if (lightbox) {
      const id = setTimeout(() => {
        lightboxCloseBtnRef.current?.focus();
      }, 30);
      return () => clearTimeout(id);
    }
    if (selected && drawerRef.current && !drawerRef.current.contains(document.activeElement)) {
      closeBtnRef.current?.focus();
    }
    return undefined;
  }, [lightbox, selected]);

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
    setFailedImages({});
    setResponseNotes(report.response_notes || "");
    setShowRejectForm(false);
    setRejectionReason("");
    setRejectDuplicateOf("");
    setDuplicateOfInput(report.duplicate_of ? String(report.duplicate_of) : "");
  }

  function closeDrawer() {
    setLightbox(false);
    setShowRejectForm(false);
    setRejectionReason("");
    setRejectDuplicateOf("");
    setDuplicateOfInput("");
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
      const bName = getReportBarangay(selected, resolvedBarangaysById);
      if (hType) params.set("type", hType);
      if (bName) params.set("barangay", bName);
      if (selected.status) params.set("status", String(selected.status).toLowerCase());

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

  async function handleValidate(status, reasonArg, duplicateOfArg) {
    if (!selected) return;
    const trimmedReason =
      status === "rejected" ? String(reasonArg ?? rejectionReason).trim() : undefined;
    if (status === "rejected" && !trimmedReason) {
      alert("Please enter a reason before rejecting this incident.");
      return;
    }

    const parsedDuplicateOf =
      status === "rejected" && duplicateOfArg
        ? Number(duplicateOfArg)
        : undefined;

    setSubmittingAction(true);
    try {
      const result = await api.validateHazardReport(
        selected.id,
        status,
        responseNotes,
        trimmedReason,
        parsedDuplicateOf
      );
      setSelected(result);
      setResponseNotes(result.response_notes || "");
      setDuplicateOfInput(result.duplicate_of ? String(result.duplicate_of) : "");
      setShowRejectForm(false);
      setRejectionReason("");
      setRejectDuplicateOf("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["hazard-reports"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.roadSegments }),
      ]);

      if (result.closed_roads && result.closed_roads.length > 0) {
        alert(`Road(s) automatically closed due to this confirmed hazard:\n\n${result.closed_roads.join("\n")}`);
      }
    } catch (err) {
      alert(`Failed to update report: ${err.message}`);
    } finally {
      setSubmittingAction(false);
    }
  }

  async function handleSaveDuplicateLink() {
    if (!selected) return;
    const nextValue = duplicateOfInput ? Number(duplicateOfInput) : null;
    setSavingDuplicate(true);
    try {
      const result = await api.setHazardReportDuplicate(selected.id, nextValue);
      setSelected(result);
      setDuplicateOfInput(result.duplicate_of ? String(result.duplicate_of) : "");
      await queryClient.invalidateQueries({ queryKey: ["hazard-reports"] });
    } catch (err) {
      alert(`Failed to update duplicate link: ${err.message}`);
    } finally {
      setSavingDuplicate(false);
    }
  }

  function openLinkedIncident(targetId) {
    const target = reports.find((item) => item.id === Number(targetId));
    if (target) {
      openReport(target);
    } else {
      alert(`Incident #${targetId} is no longer in the list.`);
    }
  }

  function handleOpenRejectForm() {
    if (!selected || String(selected.status || "pending").toLowerCase() !== "pending") return;
    setShowRejectForm((prev) => !prev);
  }

  async function handleResolve() {
    if (!selected) return;
    if (String(selected.status || "pending").toLowerCase() !== "validated") return;
    await handleReopenRoad();
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
    const rowsToExport = filteredReports;
    if (!rowsToExport.length) return;
    const headers = [
      "ID",
      "Type",
      "Status",
      "Reporter",
      "Description",
      "Latitude",
      "Longitude",
      "Submitted At",
      "Validated By",
      "Validated At",
    ];
    const rows = rowsToExport.map((r) => {
      const reporterText = getReportReporter(r, user?.role).text.replace(/"/g, '""');
      const validatorText = String(r.validated_by_name || r.validated_by || "").replace(/"/g, '""');
      return [
        r.id,
        `"${String(r.report_type || "").replace(/"/g, '""')}"`,
        r.status,
        `"${reporterText}"`,
        `"${String(r.description || "").replace(/"/g, '""')}"`,
        r.latitude,
        r.longitude,
        r.submitted_at || "",
        `"${validatorText}"`,
        r.validated_at || "",
      ];
    });
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `hazard_reports_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // KPI & status counts
  const statusCounts = useMemo(() => {
    const counts = { all: reports.length };
    for (const r of reports) {
      if (r.status) {
        counts[r.status] = (counts[r.status] || 0) + 1;
      }
    }
    return counts;
  }, [reports]);

  const totalCount = reports.length;
  const pendingCount = statusCounts.pending || 0;
  const validatedCount = statusCounts.validated || 0;
  const resolvedCount = statusCounts.resolved || 0;

  // Filtered reports list
  const filteredReports = useMemo(() => {
    return reports.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (typeFilter !== "all" && !String(r.report_type || "").toLowerCase().includes(typeFilter)) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const barangay = getReportBarangay(r, resolvedBarangaysById);
        const matchesId = String(r.id).includes(q);
        const matchesStreet = getReportStreetOrPlace(r, roadSegmentsData, barangay).toLowerCase().includes(q);
        const matchesBarangay = barangay.toLowerCase().includes(q);
        const matchesReporter = getReportReporter(r, user?.role).text.toLowerCase().includes(q);
        const matchesType = String(r.report_type || "").toLowerCase().includes(q);
        const matchesDesc = String(r.description || "").toLowerCase().includes(q);
        const matchesNotes = String(r.response_notes || "").toLowerCase().includes(q);
        const matchesValidator = String(r.validated_by_name || "").toLowerCase().includes(q);
        if (
          !matchesId &&
          !matchesStreet &&
          !matchesBarangay &&
          !matchesReporter &&
          !matchesType &&
          !matchesDesc &&
          !matchesNotes &&
          !matchesValidator
        ) {
          return false;
        }
      }
      return true;
    });
  }, [reports, statusFilter, typeFilter, searchQuery, roadSegmentsData, resolvedBarangaysById, user?.role]);

  const totalFiltered = filteredReports.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safePage = Math.min(page, totalPages);

  const paginatedReports = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredReports.slice(start, start + pageSize);
  }, [filteredReports, safePage, pageSize]);

  // Legacy fallback ONLY for older reports saved before backend barangay_name existed.
  // Scoped to the visible page + selected incident; uses isMountedRef so clicking a row
  // mid-fetch never cancels the update or leaves "Resolving..." stuck.
  useEffect(() => {
    const token = import.meta.env.VITE_MAPBOX_TOKEN;
    if (!token) return;

    const candidates = selected ? [selected, ...paginatedReports] : paginatedReports;
    const seen = new Set();
    const toResolve = [];
    for (const r of candidates) {
      if (!r?.id || seen.has(r.id)) continue;
      seen.add(r.id);
      if (String(r.barangay_name || "").trim()) continue;
      if (attemptedBarangayLookupIdsRef.current.has(r.id)) continue;
      if (!Number.isFinite(Number(r.latitude)) || !Number.isFinite(Number(r.longitude))) continue;
      toResolve.push(r);
    }

    if (toResolve.length === 0) return;

    toResolve.forEach((r) => attemptedBarangayLookupIdsRef.current.add(r.id));
    setResolvingBarangayIds((prev) => {
      const next = { ...prev };
      toResolve.forEach((r) => {
        next[r.id] = true;
      });
      return next;
    });

    toResolve.forEach((r) => {
      const lat = Number(r.latitude);
      const lng = Number(r.longitude);
      const url =
        `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${lng}` +
        `&latitude=${lat}&types=locality,neighborhood,place&access_token=${encodeURIComponent(token)}`;

      fetch(url)
        .then((res) => (res.ok ? res.json() : Promise.reject()))
        .then((data) => {
          if (!isMountedRef.current) return;
          const properties = data.features?.[0]?.properties;
          const context = properties?.context || {};
          const resolved =
            context.neighborhood?.name ||
            context.locality?.name ||
            context.place?.name ||
            properties?.name ||
            "";
          if (resolved) {
            setResolvedBarangaysById((prev) => ({ ...prev, [r.id]: resolved }));
          }
        })
        .catch(() => {})
        .finally(() => {
          if (isMountedRef.current) {
            setResolvingBarangayIds((prev) => {
              const next = { ...prev };
              delete next[r.id];
              return next;
            });
          }
        });
    });
  }, [paginatedReports, selected]);

  const selectedStatus = String(selected?.status || "pending").toLowerCase();
  const canValidate = selectedStatus === "pending";
  const canReject = selectedStatus === "pending";
  const canResolve = selectedStatus === "validated";
  const selectedNeedsRecheck = doesReportNeedRecheck(selected);
  const candidateOriginalReports = useMemo(
    () => (selected ? reports.filter((r) => r.id !== selected.id) : []),
    [reports, selected]
  );

  const drawerActionButtons = selected ? (
    <>
      <Button
        variant="primary"
        className="hr-modal-action-btn"
        onClick={() => handleValidate("validated")}
        disabled={!canValidate || submittingAction || reopening}
        title={
          canValidate
            ? "Validate hazard report"
            : "Only pending incidents can be validated"
        }
      >
        <Check size={16} strokeWidth={2} aria-hidden="true" />
        <span>Validate</span>
      </Button>

      <Button
        variant="danger-outline"
        className="hr-modal-action-btn hr-modal-action-reject"
        onClick={handleOpenRejectForm}
        disabled={!canReject || submittingAction || reopening}
        title={
          canReject
            ? "Reject report as invalid (reason required)"
            : "Only pending incidents can be rejected"
        }
      >
        <X size={16} strokeWidth={2} aria-hidden="true" />
        <span>Reject</span>
      </Button>

      <Button
        variant="secondary"
        className="hr-modal-action-btn"
        onClick={handleResolve}
        disabled={!canResolve || submittingAction || reopening}
        title={
          canResolve
            ? "Mark incident resolved"
            : "Only validated incidents can be resolved"
        }
      >
        <CheckCircle2 size={16} strokeWidth={2} aria-hidden="true" />
        <span>{reopening ? "Reopening…" : "Resolve"}</span>
      </Button>
    </>
  ) : null;

  return (
    <div className="hr-page">
      <div className="hr-container">
        {/* TOP COMMAND HEADER & DISPLAY-ONLY STAT CARDS */}
        <div className="hr-top-section hr-top-redesigned">
          <header className="hr-top-header-v2">
            <div className="hr-header-titles-v2">
              <span className="hr-command-chip">
                <span className="hr-command-chip-dot" aria-hidden="true" />
                <span>Incident command feed</span>
              </span>
              <h1 className="hr-main-title-v2">Hazard Reports &amp; Road Dispatch</h1>
              <p className="hr-subtitle-v2">
                Verify citizen-submitted road hazards, monitor 100m impact zones, and control dynamic route closures.
              </p>
            </div>
            <div className="hr-header-actions-v2">
              <Button
                variant="secondary"
                onClick={exportCSV}
                disabled={filteredReports.length === 0}
                title="Export matching incident reports to CSV"
              >
                <Download size={16} strokeWidth={2} aria-hidden="true" />
                <span>Export CSV</span>
              </Button>
            </div>
          </header>

          {/* 4 DISPLAY-ONLY STAT CARDS */}
          {loading ? (
            <div className="hr-stats-grid-v2" aria-hidden="true">
              {Array.from({ length: 4 }).map((_, idx) => (
                <div key={idx} className="hr-skel-stat-card">
                  <div className="hr-skel-row">
                    <span className="hr-skel hr-skel-tile" />
                    <span className="hr-skel hr-skel-label" />
                  </div>
                  <span className="hr-skel hr-skel-value" />
                  <span className="hr-skel hr-skel-helper" />
                </div>
              ))}
            </div>
          ) : (
            <section className="hr-stats-grid-v2" aria-label="Filter hazard reports by status">
              <StatCard
                icon={Layers}
                iconTone="primary"
                label="Total submissions"
                value={totalCount}
                showProgress={false}
                helper="All historical incident logs"
                active={statusFilter === "all"}
                onClick={() => handleStatusFilterChange("all")}
              />
              <StatCard
                icon={AlertTriangle}
                tint="warn"
                label="Pending review"
                value={pendingCount}
                showProgress={false}
                helper={pendingCount > 0 ? "Requires staff triage" : "All reports triaged"}
                active={statusFilter === "pending"}
                onClick={() => handleStatusFilterChange("pending")}
              />
              <StatCard
                icon={Route}
                tint="danger"
                label="Active hazards"
                value={validatedCount}
                showProgress={false}
                helper="Confirmed & affecting routes"
                active={statusFilter === "validated"}
                onClick={() => handleStatusFilterChange("validated")}
              />
              <StatCard
                icon={CheckCircle2}
                tint="success"
                label="Hazards cleared"
                value={resolvedCount}
                showProgress={false}
                helper="Roads safely reopened"
                active={statusFilter === "resolved"}
                onClick={() => handleStatusFilterChange("resolved")}
              />
            </section>
          )}
        </div>

        {/* SINGLE TABLE CARD (--radius-xl) */}
        <section className="hr-table-card" aria-label="Hazard reports list">
          {/* TOOLBAR: SEARCH + ALL TYPES SELECT */}
          <div className="hr-toolbar-v2">
            <div className="hr-search-wrap-v2">
              <Search
                size={16}
                strokeWidth={2}
                className="hr-search-icon-v2"
                aria-hidden="true"
              />
              <input
                type="search"
                placeholder="Search ID, street, reporter, keywords..."
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="hr-search-input-v2"
                aria-label="Search hazard reports"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => handleSearchChange("")}
                  className="hr-search-clear-v2"
                  aria-label="Clear search"
                >
                  <X size={15} strokeWidth={2} aria-hidden="true" />
                </button>
              )}
            </div>

            <select
              id="hr-type-select"
              value={typeFilter}
              onChange={(e) => handleTypeFilterChange(e.target.value)}
              className="hr-type-select-v2"
              aria-label="Filter by hazard type"
            >
              {dynamicTypeFilters.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {/* TABLE BODY: SKELETON / ERROR / EMPTY / ROWS */}
          {loading ? (
            <div
              ref={listScrollRef}
              className="hr-table-scroll"
              aria-busy="true"
              aria-label="Loading hazard reports"
            >
              <div className="hr-table-grid hr-table-head" aria-hidden="true">
                <span>INCIDENT</span>
                <span>REPORTER</span>
                <span>REPORTED</span>
                <span>STATUS</span>
                <span />
              </div>
              {Array.from({ length: 6 }).map((_, idx) => (
                <div key={idx} className="hr-table-grid hr-skel-row" aria-hidden="true">
                  <div className="hr-incident-cell">
                    <span className="hr-skel hr-skel-icon-tile" />
                    <div className="hr-skel-stack">
                      <span className="hr-skel hr-skel-street" />
                      <span className="hr-skel hr-skel-brgy" />
                    </div>
                  </div>
                  <div className="hr-reporter-cell">
                    <span className="hr-skel hr-skel-avatar" />
                    <span className="hr-skel hr-skel-name" />
                  </div>
                  <span className="hr-skel hr-skel-time" />
                  <span className="hr-skel hr-skel-pill" />
                  <span />
                </div>
              ))}
            </div>
          ) : reportsQuery.error ? (
            <div className="hr-state-box" role="alert">
              <span className="hr-state-icon is-error" aria-hidden="true">
                <AlertTriangle size={20} strokeWidth={2} />
              </span>
              <h3>Could not load hazard reports</h3>
              <p>
                {reportsQuery.error?.message ||
                  "Something went wrong while fetching hazard reports."}
              </p>
              <Button variant="secondary" onClick={() => reportsQuery.refetch()}>
                Try again
              </Button>
            </div>
          ) : reports.length === 0 ? (
            <div className="hr-state-box" role="status">
              <span className="hr-state-icon" aria-hidden="true">
                <AlertTriangle size={20} strokeWidth={2} />
              </span>
              <h3>No hazard reports yet</h3>
              <p>New citizen-submitted road hazards will appear here for review.</p>
            </div>
          ) : filteredReports.length === 0 ? (
            <div className="hr-state-box" role="status">
              <span className="hr-state-icon" aria-hidden="true">
                <Search size={20} strokeWidth={2} />
              </span>
              <h3>No matching reports</h3>
              <p>Try adjusting your status chip, hazard type, or search query.</p>
              <Button variant="secondary" onClick={clearAllFilters}>
                Clear filters
              </Button>
            </div>
          ) : (
            <>
              <div ref={listScrollRef} className="hr-table-scroll">
                <div className="hr-table-grid hr-table-head" role="row">
                  <span role="columnheader">INCIDENT</span>
                  <span role="columnheader">REPORTER</span>
                  <span role="columnheader">REPORTED</span>
                  <span role="columnheader">STATUS</span>
                  <span role="columnheader" aria-hidden="true" />
                </div>

                <div className="hr-table-rows" role="list">
                  {paginatedReports.map((r) => {
                    const isSelected = selected?.id === r.id;
                    const barangay = getReportBarangay(r, resolvedBarangaysById);
                    const streetOrPlace = getReportStreetOrPlace(r, roadSegmentsData, barangay);
                    const reporter = getReportReporter(r, user?.role);
                    const photoCount =
                      Array.isArray(r.photos) && r.photos.length > 0
                        ? r.photos.length
                        : r.photo_url
                          ? 1
                          : 0;
                    const IconComp = getHazardLucideIcon(r.report_type);
                    const statusVariant = getStatusPillVariant(r.status);
                    const tileToneClass =
                      statusVariant === "validated"
                        ? "is-validated"
                        : statusVariant === "resolved"
                          ? "is-resolved"
                          : statusVariant === "pending"
                            ? "is-pending"
                            : "is-rejected";

                    return (
                      <button
                        key={r.id}
                        type="button"
                        role="listitem"
                        onClick={(e) => openReport(r, e)}
                        className={`hr-table-grid hr-table-row ${isSelected ? "is-selected" : ""}`}
                        aria-label={`Open incident #${r.id} at ${streetOrPlace}, ${statusMeta(r.status).label}`}
                      >
                        {/* INCIDENT */}
                        <span className="hr-incident-cell">
                          <span
                            className={`hr-incident-tile ${tileToneClass}`}
                            aria-hidden="true"
                          >
                            <IconComp size={18} strokeWidth={2} />
                          </span>
                          <span className="hr-incident-copy">
                            <span className="hr-incident-top">
                              <span className="hr-incident-street">{streetOrPlace}</span>
                              <span className="hr-incident-id">#{r.id}</span>
                            </span>
                            <span className="hr-incident-bottom">
                              <span className="hr-brgy-chip">{barangay || "Unknown barangay"}</span>
                              {doesReportNeedRecheck(r) && (
                                <span
                                  className="hr-recheck-chip"
                                  title={`Road closed for ${r.recheck_threshold_hours || ROAD_CLOSURE_RECHECK_HOURS}+ hours — needs re-check`}
                                >
                                  <AlertTriangle size={12} strokeWidth={2} aria-hidden="true" />
                                  <span>Needs re-check</span>
                                </span>
                              )}
                              {r.duplicate_of && (
                                <span
                                  className="hr-duplicate-chip"
                                  title={`Marked as duplicate of Incident #${r.duplicate_of}`}
                                >
                                  <Link2 size={12} strokeWidth={2} aria-hidden="true" />
                                  <span>Duplicate of #{r.duplicate_of}</span>
                                </span>
                              )}
                              {photoCount > 1 && (
                                <span
                                  className="hr-photo-chip"
                                  title={`${photoCount} photos attached`}
                                >
                                  <Camera size={12} strokeWidth={2} aria-hidden="true" />
                                  <span>{photoCount}</span>
                                </span>
                              )}
                            </span>
                          </span>
                        </span>

                        {/* REPORTER */}
                        <span className="hr-reporter-cell">
                          <span
                            className={`hr-reporter-avatar ${reporter.isDeleted ? "is-deleted" : ""}`}
                            aria-hidden="true"
                          >
                            {reporter.isDeleted ? "—" : getReporterInitials(reporter.text)}
                          </span>
                          <span
                            className={`hr-reporter-name ${reporter.isDeleted ? "is-deleted" : ""}`}
                            title={reporter.text}
                          >
                            {reporter.text}
                          </span>
                        </span>

                        {/* REPORTED */}
                        <span className="hr-reported-cell">
                          <Clock size={15} strokeWidth={2} aria-hidden="true" />
                          <span>{formatRelativeTime(r.submitted_at)}</span>
                        </span>

                        {/* STATUS */}
                        <span className="hr-status-cell">
                          <StatusPill variant={statusVariant} />
                        </span>

                        {/* CHEVRON */}
                        <span className="hr-chevron-cell" aria-hidden="true">
                          <ChevronRight size={16} strokeWidth={2} className="hr-row-chevron" />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* FOOTER */}
              <footer className="hr-table-footer">
                <span className="hr-footer-info">
                  Showing {(safePage - 1) * pageSize + 1} to{" "}
                  {Math.min(safePage * pageSize, totalFiltered)} of {totalFiltered}
                </span>

                <div className="hr-footer-controls">
                  <label className="hr-rows-per-page">
                    <span>Rows per page</span>
                    <select
                      className="hr-rows-select"
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setPage(1);
                      }}
                      aria-label="Rows per page"
                    >
                      <option value={10}>10</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                    </select>
                  </label>

                  <Button
                    variant="secondary"
                    className="hr-footer-btn"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    className="hr-footer-btn"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next
                  </Button>
                </div>
              </footer>
            </>
          )}
        </section>
      </div>

      {/* INCIDENT DETAIL MODAL OVER DIMMED BACKDROP */}
      {selected && (
        <div
          className="hr-modal-backdrop"
          onClick={closeDrawer}
          role="presentation"
        >
          <section
            ref={drawerRef}
            className="hr-modal-dialog"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="hr-incident-modal-title"
            tabIndex={-1}
          >
            {/* FIXED HEADER & ACTION BAR */}
            <div className="hr-modal-fixed-top">
              <header className="hr-modal-header">
                <div className="hr-modal-header-left">
                  <StatusPill variant={getStatusPillVariant(selected.status)} />
                  <h2 id="hr-incident-modal-title" className="hr-modal-title">
                    Incident #{selected.id}
                  </h2>
                  {selectedNeedsRecheck && (
                    <span
                      className="hr-recheck-chip is-modal"
                      title={`Road has been closed for ${selected.recheck_threshold_hours || ROAD_CLOSURE_RECHECK_HOURS}+ hours — re-check if still blocked`}
                    >
                      <AlertTriangle size={13} strokeWidth={2} aria-hidden="true" />
                      <span>Needs re-check</span>
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  ref={closeBtnRef}
                  onClick={closeDrawer}
                  className="hr-modal-close-btn"
                  aria-label="Close"
                >
                  <X size={18} strokeWidth={2} aria-hidden="true" />
                </button>
              </header>

              {/* FIXED ACTION ROW: VALIDATE, REJECT, RESOLVE */}
              <div className="hr-modal-action-bar">
                {drawerActionButtons}
              </div>

              {showRejectForm && canReject && (
                <div className="hr-reject-reason-box" role="region" aria-label="Rejection reason">
                  <label className="hr-reject-reason-label" htmlFor="hr-reject-reason-input">
                    Rejection reason <span className="hr-required-mark">*</span>
                  </label>
                  <textarea
                    id="hr-reject-reason-input"
                    className="hr-reject-reason-textarea"
                    rows={2}
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    placeholder="Explain why this incident report is being rejected…"
                    disabled={submittingAction}
                    required
                  />
                  <label className="hr-reject-duplicate-label" htmlFor="hr-reject-duplicate-select">
                    Duplicate of existing incident (optional)
                  </label>
                  <select
                    id="hr-reject-duplicate-select"
                    className="hr-duplicate-select"
                    value={rejectDuplicateOf}
                    onChange={(e) => {
                      const val = e.target.value;
                      setRejectDuplicateOf(val);
                      if (val && !rejectionReason.trim()) {
                        setRejectionReason(`Duplicate of Incident #${val}`);
                      }
                    }}
                    disabled={submittingAction}
                  >
                    <option value="">None (not a duplicate)</option>
                    {candidateOriginalReports.map((orig) => (
                      <option key={orig.id} value={String(orig.id)}>
                        #{orig.id} — {orig.report_type || "Hazard"} · {getReportStreetOrPlace(orig, roadSegmentsData, getReportBarangay(orig, resolvedBarangaysById))} ({statusMeta(orig.status).label})
                      </option>
                    ))}
                  </select>
                  <div className="hr-reject-reason-actions">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setShowRejectForm(false);
                        setRejectionReason("");
                        setRejectDuplicateOf("");
                      }}
                      disabled={submittingAction}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="danger-outline"
                      onClick={() => handleValidate("rejected", rejectionReason, rejectDuplicateOf)}
                      disabled={!rejectionReason.trim() || submittingAction}
                    >
                      {submittingAction ? "Rejecting…" : "Confirm Reject"}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* SCROLLABLE MODAL BODY */}
            <div className="hr-modal-body">
              <div className="hr-modal-grid">
                {/* LEFT COLUMN: EVIDENCE, DESCRIPTION, QUICK RESPONSE NOTES */}
                <div className="hr-modal-col">
                  {/* PHOTOGRAPHIC EVIDENCE */}
                  <section className="hr-modal-section" aria-label="Photographic evidence">
                    <h3 className="hr-section-label">
                      <Camera size={14} aria-hidden="true" />
                      <span>Photographic evidence</span>
                    </h3>
                    {selectedPhotos.length > 0 ? (
                      <div
                        className="hr-photo-carousel"
                        role="group"
                        aria-roledescription="carousel"
                        aria-label="Hazard report photos carousel"
                      >
                        <div className="hr-photo-stage">
                          <button
                            type="button"
                            className="hr-photo-trigger"
                            onClick={(e) => {
                              e.stopPropagation();
                              setLightbox(true);
                            }}
                            onTouchStart={handleTouchStart}
                            onTouchEnd={handleTouchEnd}
                            onKeyDown={handleCarouselKeyDown}
                            aria-label={
                              selectedPhotos.length > 1
                                ? `Photo ${activePhotoIdx + 1} of ${selectedPhotos.length}. Click or press Enter to view in full size.`
                                : "View photo in full size"
                            }
                          >
                            {failedImages[selectedPhotos[activePhotoIdx]] ? (
                              <span className="hr-photo-fallback" aria-label="Photo could not be loaded">
                                <ImageOff size={24} aria-hidden="true" />
                                <span>Image unavailable</span>
                              </span>
                            ) : (
                              <img
                                src={reportPhotoUrl(selectedPhotos[activePhotoIdx])}
                                alt={`${selected.report_type || "Hazard"} evidence ${activePhotoIdx + 1}`}
                                className="hr-photo-media"
                                onError={() => {
                                  const url = selectedPhotos[activePhotoIdx];
                                  setFailedImages((prev) => ({ ...prev, [url]: true }));
                                }}
                              />
                            )}
                          </button>

                          {/* Counter pill for multiple photos */}
                          {selectedPhotos.length > 1 && (
                            <div className="hr-photo-counter" aria-live="polite">
                              {activePhotoIdx + 1} / {selectedPhotos.length}
                            </div>
                          )}

                          {/* Previous Arrow Button */}
                          {selectedPhotos.length > 1 && (
                            <button
                              type="button"
                              className="hr-photo-nav is-prev"
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePrevPhoto();
                              }}
                              aria-label="Previous photo"
                            >
                              <ChevronLeft size={18} aria-hidden="true" />
                            </button>
                          )}

                          {/* Next Arrow Button */}
                          {selectedPhotos.length > 1 && (
                            <button
                              type="button"
                              className="hr-photo-nav is-next"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleNextPhoto();
                              }}
                              aria-label="Next photo"
                            >
                              <ChevronRight size={18} aria-hidden="true" />
                            </button>
                          )}

                          {/* Full Size button */}
                          <button
                            type="button"
                            className="hr-photo-fullsize-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setLightbox(true);
                            }}
                            aria-label="Open full size photo viewer"
                          >
                            <Maximize2 size={14} aria-hidden="true" />
                            <span>
                              {selectedPhotos.length > 1
                                ? `Full Size (${activePhotoIdx + 1}/${selectedPhotos.length})`
                                : "Full Size"}
                            </span>
                          </button>
                        </div>

                        {/* Pagination Dots */}
                        {selectedPhotos.length > 1 && (
                          <div
                            className="hr-photo-dots"
                            role="tablist"
                            aria-label="Photo carousel pagination"
                          >
                            {selectedPhotos.map((_, idx) => (
                              <button
                                key={idx}
                                type="button"
                                className={`hr-photo-dot ${activePhotoIdx === idx ? "is-active" : ""}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActivePhotoIdx(idx);
                                }}
                                role="tab"
                                aria-selected={activePhotoIdx === idx}
                                aria-label={`Go to photo ${idx + 1}`}
                              />
                            ))}
                          </div>
                        )}

                        {/* Thumbnail strip */}
                        {selectedPhotos.length > 1 && (
                          <div className="hr-photo-thumbs">
                            {selectedPhotos.map((url, idx) => (
                              <button
                                key={url + idx}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActivePhotoIdx(idx);
                                }}
                                className={`hr-photo-thumb ${activePhotoIdx === idx ? "is-active" : ""}`}
                                aria-label={`Thumbnail ${idx + 1}`}
                              >
                                {failedImages[url] ? (
                                  <span className="hr-photo-thumb-fallback">
                                    <ImageOff size={14} aria-hidden="true" />
                                  </span>
                                ) : (
                                  <img
                                    src={reportPhotoUrl(url)}
                                    alt={`Thumbnail ${idx + 1}`}
                                    onError={() => {
                                      setFailedImages((prev) => ({ ...prev, [url]: true }));
                                    }}
                                  />
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="hr-photo-empty">
                        <ImageOff size={22} aria-hidden="true" />
                        <span>No photo provided</span>
                      </div>
                    )}
                  </section>

                  {/* CITIZEN DESCRIPTION */}
                  <section className="hr-modal-section" aria-label="Citizen description">
                    <h3 className="hr-section-label">Citizen description</h3>
                    <div className="hr-description-card">
                      <p className="hr-description-text">
                        {selected.description || "No specific details provided by resident."}
                      </p>
                    </div>
                  </section>

                  {/* QUICK RESPONSE NOTES & OFFICIAL NOTES */}
                  <section className="hr-modal-section" aria-label="Quick response notes">
                    <h3 className="hr-section-label">Quick response notes</h3>
                    <div className="hr-quick-notes-pills">
                      {CANNED_RESPONSES.map((chip) => (
                        <button
                          key={chip}
                          type="button"
                          onClick={() => applyCannedChip(chip)}
                          className="hr-quick-note-pill"
                        >
                          + {chip}
                        </button>
                      ))}
                    </div>

                    <div className="hr-notes-field">
                      <label className="hr-notes-label" htmlFor="hr-notes-input">
                        Official response notes
                      </label>
                      <textarea
                        id="hr-notes-input"
                        value={responseNotes}
                        onChange={(e) => setResponseNotes(e.target.value)}
                        className="hr-notes-textarea"
                        placeholder="Enter dispatch notes, actions taken, or reason for decision…"
                      />
                    </div>
                  </section>

                  {/* DUPLICATE INCIDENT LINK */}
                  <section className="hr-modal-section" aria-label="Duplicate incident link">
                    <h3 className="hr-section-label">
                      <Link2 size={14} aria-hidden="true" />
                      <span>Duplicate incident link</span>
                    </h3>
                    <div className="hr-duplicate-card">
                      {selected.duplicate_of && (
                        <div className="hr-duplicate-current">
                          <span>Linked as duplicate of</span>
                          <button
                            type="button"
                            className="hr-duplicate-link-btn"
                            onClick={() => openLinkedIncident(selected.duplicate_of)}
                          >
                            <Link2 size={13} aria-hidden="true" />
                            <span>Incident #{selected.duplicate_of}</span>
                          </button>
                        </div>
                      )}
                      <div className="hr-duplicate-controls">
                        <select
                          aria-label="Link as duplicate of existing incident"
                          className="hr-duplicate-select"
                          value={duplicateOfInput}
                          onChange={(e) => setDuplicateOfInput(e.target.value)}
                          disabled={savingDuplicate}
                        >
                          <option value="">Not linked to another incident</option>
                          {candidateOriginalReports.map((orig) => (
                            <option key={orig.id} value={String(orig.id)}>
                              #{orig.id} — {orig.report_type || "Hazard"} · {getReportStreetOrPlace(orig, roadSegmentsData, getReportBarangay(orig, resolvedBarangaysById))} ({statusMeta(orig.status).label})
                            </option>
                          ))}
                        </select>
                        <Button
                          variant="secondary"
                          onClick={handleSaveDuplicateLink}
                          disabled={
                            savingDuplicate ||
                            String(selected.duplicate_of || "") === duplicateOfInput
                          }
                        >
                          {savingDuplicate ? "Saving…" : "Save link"}
                        </Button>
                      </div>
                    </div>
                  </section>
                </div>

                {/* RIGHT COLUMN: LOCATION, VIEW ON MAP, MAP PREVIEW, AFFECTED STREETS, REPORTER & AUDIT */}
                <div className="hr-modal-col">
                  {/* LOCATION DETAILS */}
                  <section className="hr-modal-section" aria-label="Location details">
                    <h3 className="hr-section-label">
                      <MapPin size={14} aria-hidden="true" />
                      <span>Location details</span>
                    </h3>
                    <dl className="hr-detail-card hr-meta-list">
                      <div className="hr-meta-row">
                        <dt className="hr-meta-term">Street / Place</dt>
                        <dd className="hr-meta-value is-strong">
                          {getReportStreetOrPlace(
                            selected,
                            roadSegmentsData,
                            getReportBarangay(selected, resolvedBarangaysById)
                          )}
                        </dd>
                      </div>
                      <div className="hr-meta-row">
                        <dt className="hr-meta-term">Barangay</dt>
                        <dd className="hr-meta-value is-strong">
                          {getReportBarangay(selected, resolvedBarangaysById) ||
                            (resolvingBarangayIds[selected.id] ? "Resolving..." : "Unknown barangay")}
                        </dd>
                      </div>
                      <div className="hr-meta-row">
                        <dt className="hr-meta-term">Coordinates</dt>
                        <dd className="hr-meta-value hr-meta-coords">
                          {Number(selected.latitude).toFixed(5)}, {Number(selected.longitude).toFixed(5)}
                        </dd>
                      </div>
                    </dl>

                    <button
                      type="button"
                      onClick={handleViewOnMap}
                      className="hr-view-on-map-btn"
                      title="View hazard on live interactive staff map"
                    >
                      <Compass size={16} aria-hidden="true" />
                      <span>View on map</span>
                    </button>
                  </section>

                  {/* MAP PREVIEW */}
                  <section className="hr-modal-section" aria-label="Map preview">
                    <div className="hr-map-preview-frame">
                      <div ref={mapContainerRef} className="hr-minimap-container" />
                    </div>
                  </section>

                  {/* AFFECTED STREETS IN 100M RADIUS */}
                  {nearbyRoads.length > 0 && (
                    <section className="hr-modal-section" aria-label="Affected streets in 100m radius">
                      <h3 className="hr-section-label">
                        <Route size={14} aria-hidden="true" />
                        <span>Affected streets in 100m radius</span>
                      </h3>
                      <div className="hr-affected-roads-pills">
                        {nearbyRoads.map((name) => (
                          <span key={name} className="hr-affected-road-pill">
                            {name}
                          </span>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* REPORTER & AUDIT */}
                  <section className="hr-modal-section" aria-label="Reporter and audit">
                    <h3 className="hr-section-label">
                      <User size={14} aria-hidden="true" />
                      <span>Reporter &amp; audit</span>
                    </h3>
                    <dl className="hr-detail-card hr-meta-list">
                      <div className="hr-meta-row">
                        <dt className="hr-meta-term">Reported by</dt>
                        <dd
                          className={`hr-meta-value is-strong ${
                            getReportReporter(selected, user?.role).isDeleted ? "is-deleted" : ""
                          }`}
                        >
                          {getReportReporter(selected, user?.role).text}
                        </dd>
                      </div>
                      <div className="hr-meta-row">
                        <dt className="hr-meta-term">Submission channel</dt>
                        <dd className="hr-meta-value">EvacWay Resident Web App</dd>
                      </div>
                      <div className="hr-meta-row">
                        <dt className="hr-meta-term">Submitted</dt>
                        <dd className="hr-meta-value">
                          {selected.submitted_at
                            ? formatManilaDateTime(selected.submitted_at, {}, "Unknown")
                            : "Unknown"}{" "}
                          ({formatRelativeTime(selected.submitted_at)})
                        </dd>
                      </div>
                      <div className="hr-meta-row">
                        <dt className="hr-meta-term">Current status</dt>
                        <dd className="hr-meta-value">
                          <StatusPill variant={getStatusPillVariant(selected.status)} />
                        </dd>
                      </div>
                      <div className="hr-meta-row">
                        <dt className="hr-meta-term">Verified by</dt>
                        <dd className="hr-meta-value">
                          {selected.validated_by_name ||
                            (selected.validated_by
                              ? `Staff Officer #${selected.validated_by}`
                              : selected.status === "pending"
                              ? "Awaiting review"
                              : "System logged")}
                        </dd>
                      </div>
                      {selected.validated_at && (
                        <div className="hr-meta-row">
                          <dt className="hr-meta-term">Verified at</dt>
                          <dd className="hr-meta-value">
                            {formatManilaDateTime(selected.validated_at)}
                          </dd>
                        </div>
                      )}
                      {selected.rejection_reason && (
                        <div className="hr-meta-row">
                          <dt className="hr-meta-term">Rejection reason</dt>
                          <dd className="hr-meta-value hr-rejection-reason-value">
                            {selected.rejection_reason}
                          </dd>
                        </div>
                      )}
                      {selected.duplicate_of && (
                        <div className="hr-meta-row">
                          <dt className="hr-meta-term">Duplicate of</dt>
                          <dd className="hr-meta-value">
                            <button
                              type="button"
                              className="hr-duplicate-link-btn"
                              onClick={() => openLinkedIncident(selected.duplicate_of)}
                            >
                              <Link2 size={13} aria-hidden="true" />
                              <span>Incident #{selected.duplicate_of}</span>
                            </button>
                          </dd>
                        </div>
                      )}
                    </dl>
                  </section>
                </div>
              </div>
            </div>

            {/* FIXED MOBILE ACTION BAR (BOTTOM) */}
            <div className="hr-modal-mobile-footer">
              <div className="hr-modal-mobile-actions">
                {drawerActionButtons}
              </div>
            </div>
          </section>
        </div>
      )}

      {/* LIGHTBOX FOR FULL SIZE PHOTO VIEWING */}
      {lightbox && selectedPhotos.length > 0 && (
        <div
          ref={lightboxRef}
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
            ref={lightboxCloseBtnRef}
            type="button"
            className="hr-lightbox-close"
            onClick={(e) => {
              e.stopPropagation();
              setLightbox(false);
            }}
            aria-label="Close photo preview"
          >
            <X size={20} aria-hidden="true" />
          </button>

          <div
            className="hr-lightbox-dialog"
            onClick={(e) => e.stopPropagation()}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
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
                    handlePrevPhoto();
                  }}
                  aria-label="Previous photo"
                >
                  <ChevronLeft size={20} aria-hidden="true" />
                </button>
              )}

              {failedImages[selectedPhotos[activePhotoIdx]] ? (
                <div className="hr-lightbox-placeholder">
                  <ImageOff size={28} aria-hidden="true" />
                  <span>Photo could not be loaded</span>
                </div>
              ) : (
                <img
                  src={reportPhotoUrl(selectedPhotos[activePhotoIdx])}
                  alt={`Hazard report high resolution ${activePhotoIdx + 1}`}
                  className="hr-lightbox-img"
                  onError={() => {
                    const url = selectedPhotos[activePhotoIdx];
                    setFailedImages((prev) => ({ ...prev, [url]: true }));
                  }}
                />
              )}

              {selectedPhotos.length > 1 && (
                <button
                  type="button"
                  className="hr-lightbox-arrow is-next"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleNextPhoto();
                  }}
                  aria-label="Next photo"
                >
                  <ChevronRight size={20} aria-hidden="true" />
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
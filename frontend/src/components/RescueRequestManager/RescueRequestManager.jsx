import { useEffect, useState, useMemo, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Compass,
  FileText,
  ImageOff,
  Inbox,
  MapPin,
  Maximize2,
  Phone,
  RotateCcw,
  Search,
  Truck,
  User,
  X,
} from "lucide-react";
import { api, BASE_URL } from "../../services/api";
import { formatManilaDateTime, formatManilaTime, parseTimestamp } from "../../utils/dateTime";
import { useAuth } from "../../context/AuthContext";
import { queryKeys, useRescueRequests } from "../../hooks/useEvacuationQueries";
import {
  RESCUE_OVERDUE_THRESHOLD_HOURS,
  countOpenRescueRequests,
  isOpenRescueStatus,
  isRescueOverdue,
} from "../../utils/rescueStatus";
import {
  Button,
  LocationAccuracyPill,
  StatCard,
  StatusPill,
} from "../ui";
import "./RescueRequestManager.css";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

const STATUS_OPTIONS = ["pending", "acknowledged", "responding", "resolved"];

const AGENCY_SUGGESTIONS = [
  "MDRRMO Sogod",
  "BFP Sogod",
  "PNP Sogod",
  "Philippine Coast Guard",
  "Barangay Tanod / BDRRMC",
  "RHU / Medical Team",
];

const STATUS_LABELS = {
  pending: "Pending",
  acknowledged: "Acknowledged",
  responding: "Responding",
  resolved: "Resolved",
};

function isOpenStatus(statusOrItem) {
  return isOpenRescueStatus(statusOrItem);
}

function isInProgressStatus(status) {
  const s = String(status || "").trim().toLowerCase();
  return (
    s === "acknowledged" ||
    s === "responding" ||
    s === "in_progress"
  );
}

function isResolvedStatus(statusOrItem) {
  return !isOpenRescueStatus(statusOrItem);
}

function getRescueStatusPillVariant(status) {
  switch (status) {
    case "pending":
    case "open":
      return "pending";
    case "acknowledged":
      return "acknowledged";
    case "responding":
    case "in_progress":
      return "responding";
    case "resolved":
      return "resolved";
    default:
      return "pending";
  }
}

function getLocationSourceInfo(item) {
  if (!item) return null;
  const isManual = Boolean(item.is_manual_pin || item.location_source === "manual");
  const acc =
    item.accuracy != null && Number.isFinite(Number(item.accuracy))
      ? Number(item.accuracy)
      : null;
  const isApprox =
    !isManual &&
    (item.location_source === "approximate" || (acc != null && acc > 100));

  if (isManual) {
    return {
      type: "manual",
      label: "Manually pinned",
      accuracyText: null,
      fullAccuracyText: null,
    };
  }
  if (isApprox) {
    return {
      type: "approximate",
      label: "Approximate",
      accuracyText: acc != null ? `±${Math.round(acc)}m` : null,
      fullAccuracyText: acc != null ? `Accuracy: about ${Math.round(acc)} m` : "Approximate location",
    };
  }
  if (item.latitude != null && Number.isFinite(Number(item.latitude))) {
    return {
      type: "gps",
      label: "GPS",
      accuracyText: acc != null ? `±${Math.round(acc)}m` : null,
      fullAccuracyText: acc != null ? `Accuracy: about ${Math.round(acc)} m` : "GPS fix",
    };
  }
  return null;
}

function resolveProofImageUrl(img) {
  if (!img || typeof img !== "string") return "";
  if (img.startsWith("http://") || img.startsWith("https://") || img.startsWith("data:")) {
    return img;
  }
  return `${BASE_URL}${img.startsWith("/") ? "" : "/"}${img}`;
}

/**
 * Context-aware time status formatting.
 * For resolved alerts: shows "Resolved · 4d ago" instead of "waiting 4d".
 * For in-progress alerts: shows "Responding · 45m".
 * For open alerts: shows "Waiting 15m" (with urgency flags if >30m).
 */
function getAlertTimeStatus(item, now = Date.now()) {
  const status = item?.status;
  const statusSince = item?.status_updated_at || item?.updated_at || item?.created_at;
  const updatedAt = item?.updated_at || item?.resolved_at || item?.created_at;
  const overdue = isRescueOverdue(item, now);

  if (isResolvedStatus(status)) {
    if (!updatedAt) {
      return { text: "Resolved", icon: CheckCircle2, statusClass: "is-resolved", isUrgent: false, isOverdue: false };
    }
    const date = parseTimestamp(updatedAt);
    const diffMs = Math.max(0, now - (date ? date.getTime() : now));
    const minutes = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    let text = "Resolved";
    if (days >= 1) text = `Resolved · ${days}d ago`;
    else if (hours >= 1) text = `Resolved · ${hours}h ago`;
    else text = `Resolved · ${Math.max(1, minutes)}m ago`;

    return { text, icon: CheckCircle2, statusClass: "is-resolved", isUrgent: false, isOverdue: false };
  }

  if (isInProgressStatus(status)) {
    const labelPrefix = status === "acknowledged" ? "Acknowledged" : "Responding";
    if (!statusSince) {
      return { text: labelPrefix, icon: Truck, statusClass: "is-in-progress", isUrgent: overdue, isOverdue: overdue };
    }
    const date = parseTimestamp(statusSince);
    const diffMs = Math.max(0, now - (date ? date.getTime() : now));
    const minutes = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const remMinutes = minutes % 60;

    let text = labelPrefix;
    if (days >= 1) {
      text = `${labelPrefix} · ${days}d`;
    } else if (hours >= 1) {
      text = remMinutes > 0 ? `${labelPrefix} · ${hours}h ${remMinutes}m` : `${labelPrefix} · ${hours}h`;
    } else {
      text = `${labelPrefix} · ${Math.max(1, minutes)}m`;
    }

    return { text, icon: Truck, statusClass: "is-in-progress", isUrgent: overdue, isOverdue: overdue };
  }

  // Open / Pending
  if (!statusSince) {
    return { text: "Waiting for response", icon: Clock, statusClass: "is-waiting", isUrgent: overdue, isOverdue: overdue };
  }
  const date = parseTimestamp(statusSince);
  const diffMs = Math.max(0, now - (date ? date.getTime() : now));
  const minutes = Math.floor(diffMs / (1000 * 60));
  const isUrgent = overdue || minutes >= 30;

  if (minutes < 1) {
    return { text: "Waiting < 1 min", icon: Clock, statusClass: "is-waiting", isUrgent: false, isOverdue: false };
  }
  if (minutes < 60) {
    return { text: `Waiting ${minutes} min`, icon: Clock, statusClass: "is-waiting", isUrgent, isOverdue: overdue };
  }
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) {
    return {
      text: remMinutes > 0 ? `Waiting ${hours}h ${remMinutes}m` : `Waiting ${hours}h`,
      icon: Clock,
      statusClass: "is-waiting",
      isUrgent: true,
      isOverdue: overdue,
    };
  }
  const days = Math.floor(hours / 24);
  return { text: `Waiting ${days}d`, icon: Clock, statusClass: "is-waiting", isUrgent: true, isOverdue: overdue };
}

export default function RescueRequestManager({ initialRequestId, onOpenMap }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const requestsQuery = useRescueRequests();
  const refetchRequests = requestsQuery.refetch;
  const requests = requestsQuery.data || [];
  const loading = requestsQuery.isLoading;
  const isError = requestsQuery.isError;

  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState(null);
  const [selectedId, setSelectedId] = useState(initialRequestId || null);
  const [pendingStatusChange, setPendingStatusChange] = useState(null);
  const [agencyDraft, setAgencyDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailsSaved, setDetailsSaved] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const [lightboxImage, setLightboxImage] = useState(null);
  const [activeProofIdx, setActiveProofIdx] = useState(0);
  const [failedProofImages, setFailedProofImages] = useState({});
  const [mapImgFailed, setMapImgFailed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [now, setNow] = useState(() => Date.now());
  const listScrollRef = useRef(null);
  const proofTouchStartXRef = useRef(null);
  const lastActiveRowRef = useRef(null);
  const modalRef = useRef(null);
  const closeBtnRef = useRef(null);
  const lightboxRef = useRef(null);
  const lightboxCloseBtnRef = useRef(null);

  const rawFilterParam = (searchParams.get("filter") || "all").toLowerCase();
  const filterStatus = [
    "all",
    "open",
    "in_progress",
    "pending",
    "acknowledged",
    "responding",
    "resolved",
  ].includes(rawFilterParam)
    ? rawFilterParam
    : "all";

  useEffect(() => {
    if (listScrollRef.current) {
      listScrollRef.current.scrollTop = 0;
    }
  }, [page, pageSize]);

  // Periodically refresh waiting timer calculations
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  // Sync initialRequestId from props if changed
  useEffect(() => {
    if (initialRequestId) {
      setSelectedId(initialRequestId);
    }
  }, [initialRequestId]);

  // Reset map image fallback state and clear any notification when selected request changes
  useEffect(() => {
    setMapImgFailed(false);
    setLightboxImage(null);
    setPendingStatusChange(null);
    if (selectedId != null) {
      api.clearNotificationsByResource("rescue_request", selectedId)
        .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.notifications }))
        .catch(() => { });
    }
  }, [selectedId, queryClient]);

  // Refresh data when window becomes visible
  useEffect(() => {
    function refreshWhenVisible() {
      if (document.visibilityState === "visible") refetchRequests();
    }

    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => document.removeEventListener("visibilitychange", refreshWhenVisible);
  }, [refetchRequests]);

  function openRequest(id, event) {
    if (event?.currentTarget) {
      lastActiveRowRef.current = event.currentTarget;
    }
    setSelectedId(id);
    setActiveProofIdx(0);
    setFailedProofImages({});
  }

  function closeRequest() {
    setSelectedId(null);
    setLightboxImage(null);
    setTimeout(() => {
      if (lastActiveRowRef.current && typeof lastActiveRowRef.current.focus === "function") {
        lastActiveRowRef.current.focus();
      }
    }, 30);
  }

  // Close lightbox or modal on Escape key press & trap Tab focus inside modal
  useEffect(() => {
    if (!selectedId && !lightboxImage) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        if (lightboxImage) {
          event.stopPropagation();
          setLightboxImage(null);
        } else {
          event.preventDefault();
          closeRequest();
        }
        return;
      }

      if (event.key === "Tab") {
        const container = lightboxImage ? lightboxRef.current : modalRef.current;
        if (!container) return;

        const focusables = Array.from(
          container.querySelectorAll(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => el.offsetParent !== null);

        if (focusables.length === 0) {
          event.preventDefault();
          return;
        }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (event.shiftKey) {
          if (
            document.activeElement === first ||
            !container.contains(document.activeElement)
          ) {
            event.preventDefault();
            last.focus();
          }
        } else if (
          document.activeElement === last ||
          !container.contains(document.activeElement)
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedId, lightboxImage]);

  // Move focus into lightbox on open, restore to modal on close
  useEffect(() => {
    if (lightboxImage) {
      const id = setTimeout(() => {
        lightboxCloseBtnRef.current?.focus();
      }, 30);
      return () => clearTimeout(id);
    }
    if (selectedId && modalRef.current && !modalRef.current.contains(document.activeElement)) {
      closeBtnRef.current?.focus();
    }
    return undefined;
  }, [lightboxImage, selectedId]);

  // Move focus into modal on open
  useEffect(() => {
    if (selectedId) {
      const id = setTimeout(() => {
        if (closeBtnRef.current) {
          closeBtnRef.current.focus();
        } else if (modalRef.current) {
          modalRef.current.focus();
        }
      }, 40);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [selectedId]);

  async function updateStatus(requestId, status) {
    setUpdatingId(requestId);
    setError("");
    try {
      const updated = await api.updateRescueRequest(requestId, status);
      queryClient.setQueryData(queryKeys.rescueRequests, (current = []) =>
        current.map((item) => (item.id === updated.id ? updated : item))
      );
      setPendingStatusChange(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.rescueRequests }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboardSummary }),
      ]);
    } catch (requestError) {
      setError(requestError.message || "Rescue request status could not be updated.");
    } finally {
      setUpdatingId(null);
    }
  }

  function handleSelectStatusStep(requestId, targetStatus, currentStatus) {
    if (!requestId || !targetStatus || targetStatus === currentStatus) return;
    const fromIdx = STATUS_OPTIONS.indexOf(currentStatus);
    const toIdx = STATUS_OPTIONS.indexOf(targetStatus);
    setPendingStatusChange({
      requestId,
      fromStatus: currentStatus,
      toStatus: targetStatus,
      isRevert: toIdx < fromIdx,
      isReopen: currentStatus === "resolved" && targetStatus !== "resolved",
      isResolve: targetStatus === "resolved",
    });
  }

  async function saveRescueDetails(event) {
    event.preventDefault();
    if (!selected || savingDetails) return;
    setSavingDetails(true);
    setDetailsError("");
    setDetailsSaved(false);
    try {
      const updated = await api.updateRescueRequest(selected.id, {
        handed_to_agency: agencyDraft.trim(),
        notes: notesDraft.trim(),
      });
      queryClient.setQueryData(queryKeys.rescueRequests, (current = []) =>
        current.map((item) => (item.id === updated.id ? updated : item))
      );
      setAgencyDraft(updated.handed_to_agency || "");
      setNotesDraft(updated.notes || "");
      setDetailsSaved(true);
    } catch (requestError) {
      setDetailsError(requestError.message || "Could not save rescue handoff details.");
    } finally {
      setSavingDetails(false);
    }
  }

  // Calculate status counts
  const openCount = useMemo(
    () => countOpenRescueRequests(requests),
    [requests]
  );
  const inProgressCount = useMemo(
    () => requests.filter((r) => isInProgressStatus(r.status)).length,
    [requests]
  );
  const resolvedCount = useMemo(
    () => requests.filter((r) => isResolvedStatus(r)).length,
    [requests]
  );
  const totalCount = requests.length;

  // Filter requests based on search query and selected filter
  const filteredRequests = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const cleanQ = q.replace(/^#/, "").replace(/^rescue alert\s*#?/i, "").trim();

    return requests.filter((item) => {
      if (filterStatus === "open" && !isOpenStatus(item)) return false;
      if (filterStatus === "pending" && String(item.status || "").toLowerCase() !== "pending") return false;
      if (filterStatus === "in_progress" && !isInProgressStatus(item.status)) return false;
      if (filterStatus === "acknowledged" && item.status !== "acknowledged") return false;
      if (
        filterStatus === "responding" &&
        item.status !== "responding" &&
        item.status !== "in_progress"
      ) {
        return false;
      }
      if (filterStatus === "resolved" && !isResolvedStatus(item)) return false;

      if (q) {
        const idStr = String(item.id || "");
        const matchId = cleanQ ? idStr.includes(cleanQ) : false;
        const name = (
          item.requester_name ||
          item.name ||
          item.user_name ||
          item.full_name ||
          ""
        ).toLowerCase();
        const matchName = name.includes(q);
        const contact = (
          item.requester_contact ||
          item.contact_number ||
          item.phone ||
          ""
        ).toLowerCase();
        const matchContact = contact.includes(q);
        const barangay = (item.barangay || item.barangay_name || "").toLowerCase();
        const matchBarangay = barangay.includes(q);
        const locDesc = (item.location_description || "").toLowerCase();
        const matchLoc = locDesc.includes(q);
        const desc = (item.description || "").toLowerCase();
        const matchDesc = desc.includes(q);
        const agency = (item.handed_to_agency || "").toLowerCase();
        const matchAgency = agency.includes(q);
        const notes = (item.notes || "").toLowerCase();
        const matchNotes = notes.includes(q);

        if (
          !matchId &&
          !matchName &&
          !matchContact &&
          !matchBarangay &&
          !matchLoc &&
          !matchDesc &&
          !matchAgency &&
          !matchNotes
        ) {
          return false;
        }
      }
      return true;
    });
  }, [requests, filterStatus, searchQuery]);

  // Open requests sort oldest first; non-open sort newest first
  const sortedRequests = useMemo(() => {
    return [...filteredRequests].sort((a, b) => {
      const aOpen = isOpenStatus(a.status);
      const bOpen = isOpenStatus(b.status);

      if (aOpen && !bOpen) return -1;
      if (!aOpen && bOpen) return 1;

      const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;

      if (aOpen && bOpen) {
        return timeA - timeB;
      }

      return timeB - timeA;
    });
  }, [filteredRequests]);

  const totalFiltered = sortedRequests.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safePage = Math.min(page, totalPages);

  const paginatedRequests = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return sortedRequests.slice(start, start + pageSize);
  }, [sortedRequests, safePage, pageSize]);

  const selected = requests.find((item) => item.id === selectedId);
  const visibleError = error || requestsQuery.error?.message || "";

  useEffect(() => {
    setAgencyDraft(selected?.handed_to_agency || "");
    setNotesDraft(selected?.notes || "");
    setDetailsError("");
    setDetailsSaved(false);
  }, [selected?.id, selected?.handed_to_agency, selected?.notes]);

  const isDetailsDirty = Boolean(
    selected &&
      (agencyDraft.trim() !== (selected.handed_to_agency || "").trim() ||
        notesDraft.trim() !== (selected.notes || "").trim())
  );

  function handleSearchChange(nextQuery) {
    setSearchQuery(nextQuery);
    setPage(1);
  }

  function handleFilterStatusChange(nextStatus) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (!nextStatus || nextStatus === "all") {
          next.set("filter", "all");
        } else {
          next.set("filter", nextStatus);
        }
        return next;
      },
      { replace: true }
    );
    setPage(1);
  }

  function clearFilters() {
    setSearchQuery("");
    handleFilterStatusChange("all");
  }

  function handleViewOnMap() {
    if (!selected) return;
    if (typeof onOpenMap === "function") {
      onOpenMap(selected);
      return;
    }
    const lat = Number(selected.latitude);
    const lng = Number(selected.longitude);
    const isLgu = user?.role === "lgu_personnel";
    const staffMapPath = isLgu ? "/lgu/map" : "/admin/map";
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const params = new URLSearchParams();
      params.set("lat", lat);
      params.set("lng", lng);
      params.set("rescue", selected.id);

      const bName = selected.barangay || selected.barangay_name || "";
      if (bName) params.set("barangay", bName);
      if (selected.status) params.set("status", String(selected.status).toLowerCase());

      navigate(`${staffMapPath}?${params.toString()}`);
    } else {
      navigate(staffMapPath);
    }
  }

  const selectedContactNumber =
    selected?.requester_contact ||
    selected?.contact_number ||
    selected?.phone_number ||
    selected?.phone ||
    selected?.contact ||
    null;

  const selectedRequesterName =
    selected?.requester_name ||
    selected?.name ||
    selected?.user_name ||
    selected?.full_name ||
    null;

  const selectedPeopleCount =
    selected?.people_count ??
    selected?.number_of_people ??
    selected?.people_count ??
    selected?.num_people ??
    selected?.people ??
    selected?.family_members ??
    null;

  const selectedTimeStatus = selected ? getAlertTimeStatus(selected, now) : null;
  const currentStatusIndex = selected
    ? STATUS_OPTIONS.indexOf(selected.status)
    : -1;

  const hasSelectedCoords =
    selected &&
    selected.latitude != null &&
    selected.longitude != null &&
    Number.isFinite(Number(selected.latitude)) &&
    Number.isFinite(Number(selected.longitude));

  const proofImages = useMemo(() => {
    if (!selected || !Array.isArray(selected.proof_images)) return [];
    return selected.proof_images.map(resolveProofImageUrl).filter(Boolean);
  }, [selected]);

  const safeProofIdx =
    proofImages.length > 0 ? Math.min(activeProofIdx, proofImages.length - 1) : 0;

  function handlePrevProof() {
    if (proofImages.length <= 1) return;
    setActiveProofIdx((prev) => (prev > 0 ? prev - 1 : proofImages.length - 1));
  }

  function handleNextProof() {
    if (proofImages.length <= 1) return;
    setActiveProofIdx((prev) => (prev < proofImages.length - 1 ? prev + 1 : 0));
  }

  function handleProofTouchStart(e) {
    if (e.touches && e.touches.length === 1) {
      proofTouchStartXRef.current = e.touches[0].clientX;
    }
  }

  function handleProofTouchEnd(e) {
    if (proofTouchStartXRef.current === null) return;
    const diff = proofTouchStartXRef.current - e.changedTouches[0].clientX;
    if (diff > 40) {
      handleNextProof();
    } else if (diff < -40) {
      handlePrevProof();
    }
    proofTouchStartXRef.current = null;
  }

  function handleProofKeyDown(e) {
    if (proofImages.length > 1) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        handlePrevProof();
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        handleNextProof();
        return;
      }
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      const currentUrl = proofImages[safeProofIdx];
      if (currentUrl) setLightboxImage(currentUrl);
    }
  }

  return (
    <main className="rescue-queue-page">
      {/* 1. HEADER & DISPLAY-ONLY STAT CARDS */}
      <div className="rq-top-section">
        <header className="rq-header">
          <div className="rq-header-titles">
            <h1 className="rq-title">Rescue Alerts</h1>
            <p className="rq-subtitle">
              Review and respond to emergency rescue requests from residents in real-time.
            </p>
          </div>
          <div className="rq-header-right" aria-live="polite">
            <StatusPill
              variant={openCount > 0 ? "danger" : "resolved"}
              label={
                openCount > 0
                  ? `${openCount} ${openCount === 1 ? "open alert" : "open alerts"}`
                  : "All clear · 0 open alerts"
              }
            />
          </div>
        </header>

        {visibleError && (
          <p className="rescue-queue-error" role="alert">
            {visibleError}
          </p>
        )}

        {/* 2. 4 DISPLAY-ONLY STAT CARDS */}
        {loading ? (
          <div className="rq-stats-grid" aria-hidden="true">
            {Array.from({ length: 4 }).map((_, idx) => (
              <div key={idx} className="rq-skel-stat-card">
                <div className="rq-skel-stat-top">
                  <span className="rq-skel rq-skel-tile" />
                  <span className="rq-skel rq-skel-label" />
                </div>
                <span className="rq-skel rq-skel-value" />
                <span className="rq-skel rq-skel-helper" />
              </div>
            ))}
          </div>
        ) : (
          <section
            className="rq-stats-grid"
            aria-label="Filter rescue alerts by status"
          >
            <StatCard
              icon={Inbox}
              iconTone="primary"
              label="Total requests"
              value={totalCount}
              showProgress={false}
              helper="All time recorded"
              active={filterStatus === "all"}
              onClick={() => handleFilterStatusChange("all")}
            />
            <StatCard
              icon={AlertTriangle}
              iconTone="warn"
              label="Open alerts"
              value={openCount}
              showProgress={false}
              helper={openCount > 0 ? "Requires response" : "All clear"}
              active={filterStatus === "open" || filterStatus === "pending"}
              onClick={() => handleFilterStatusChange("open")}
            />
            <StatCard
              icon={Truck}
              iconTone="primary"
              label="In progress"
              value={inProgressCount}
              showProgress={false}
              helper={inProgressCount > 0 ? "Responders active" : "None active"}
              active={
                filterStatus === "in_progress" ||
                filterStatus === "acknowledged" ||
                filterStatus === "responding"
              }
              onClick={() => handleFilterStatusChange("in_progress")}
            />
            <StatCard
              icon={CheckCircle2}
              tint="success"
              label="Resolved"
              value={resolvedCount}
              showProgress={false}
              helper="Successfully assisted"
              active={filterStatus === "resolved"}
              onClick={() => handleFilterStatusChange("resolved")}
            />
          </section>
        )}
      </div>

      <section className="rq-table-card" aria-label="Rescue requests list">
        <div className="rq-table-toolbar">
          <div className="rq-search-field">
            <Search size={16} className="rq-search-icon" aria-hidden="true" />
            <input
              type="search"
              className="rq-search-input"
              placeholder="Search by requester name, contact, ID, or location…"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              aria-label="Search rescue requests"
            />
            {searchQuery && (
              <button
                type="button"
                className="rq-search-clear"
                onClick={() => handleSearchChange("")}
                aria-label="Clear search"
              >
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        {/* TABLE SCROLL CONTAINER */}
        <div ref={listScrollRef} className="rq-table-scroll">
          {loading ? (
            <div className="rq-table-body" role="status" aria-label="Loading rescue requests">
              <div className="rq-table-grid rq-table-head" aria-hidden="true">
                <span>REQUESTER</span>
                <span>LOCATION</span>
                <span>TIME</span>
                <span>STATUS</span>
                <span className="rq-chevron-col" />
              </div>
              {Array.from({ length: 6 }).map((_, idx) => (
                <div key={idx} className="rq-table-grid rq-skel-row" aria-hidden="true">
                  <div className="rq-requester-cell">
                    <span className="rq-skel rq-skel-icon-tile" />
                    <div className="rq-skel-stack">
                      <span className="rq-skel rq-skel-name" />
                      <span className="rq-skel rq-skel-phone" />
                    </div>
                  </div>
                  <div className="rq-location-cell">
                    <span className="rq-skel rq-skel-chip" />
                    <span className="rq-skel rq-skel-acc" />
                  </div>
                  <div className="rq-time-cell">
                    <span className="rq-skel rq-skel-time" />
                  </div>
                  <div className="rq-status-cell">
                    <span className="rq-skel rq-skel-pill" />
                    <span className="rq-skel rq-skel-note" />
                  </div>
                  <div className="rq-chevron-cell" />
                </div>
              ))}
            </div>
          ) : isError && requests.length === 0 ? (
            <div className="rq-state-box" role="alert">
              <span className="rq-state-icon is-error" aria-hidden="true">
                <AlertTriangle size={22} />
              </span>
              <h3>Unable to load rescue alerts</h3>
              <p>
                {requestsQuery.error?.message ||
                  "A network or server error occurred while fetching rescue alerts."}
              </p>
              <Button variant="secondary" onClick={() => refetchRequests()}>
                Try again
              </Button>
            </div>
          ) : requests.length === 0 ? (
            <div className="rq-state-box">
              <span className="rq-state-icon" aria-hidden="true">
                <CheckCircle2 size={22} />
              </span>
              <h3>No rescue requests yet</h3>
              <p>Emergency rescue signals from residents will appear here immediately.</p>
            </div>
          ) : sortedRequests.length === 0 ? (
            <div className="rq-state-box">
              <span className="rq-state-icon" aria-hidden="true">
                <Search size={22} />
              </span>
              <h3>No matching requests</h3>
              <p>No alerts match your current search or status filter.</p>
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            </div>
          ) : (
            <div className="rq-table-body" role="list">
              <div className="rq-table-grid rq-table-head" aria-hidden="true">
                <span>REQUESTER</span>
                <span>LOCATION</span>
                <span>TIME</span>
                <span>STATUS</span>
                <span className="rq-chevron-col" />
              </div>

              {paginatedRequests.map((item) => {
                const requesterName =
                  item.requester_name ||
                  item.name ||
                  item.user_name ||
                  item.full_name ||
                  `Rescue Alert #${item.id}`;
                const requesterContact =
                  item.requester_contact ||
                  item.contact_number ||
                  item.phone_number ||
                  item.phone ||
                  item.contact ||
                  null;
                const barangayText =
                  item.barangay ||
                  item.barangay_name ||
                  item.location_description ||
                  "Sogod, Southern Leyte";
                const photoCount = Array.isArray(item.proof_images)
                  ? item.proof_images.length
                  : 0;
                const timeStatus = getAlertTimeStatus(item, now);
                const timeText = item.created_at
                  ? formatManilaTime(item.created_at, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "";
                const isStillOpen = isOpenStatus(item);
                const isResolved = isResolvedStatus(item);
                const isOverdue = Boolean(timeStatus.isOverdue);
                const isSelected = selectedId === item.id;
                const TileIcon = isStillOpen
                  ? AlertTriangle
                  : isResolved
                    ? CheckCircle2
                    : Truck;
                const tileToneClass = isOverdue
                  ? "is-overdue"
                  : isStillOpen
                    ? "is-pending"
                    : isResolved
                      ? "is-resolved"
                      : "is-progress";
                const locSource = getLocationSourceInfo(item);

                return (
                  <button
                    type="button"
                    key={item.id}
                    role="listitem"
                    className={`rq-table-grid rq-table-row ${isSelected ? "is-selected" : ""} ${isOverdue ? "is-overdue" : ""}`}
                    onClick={(e) => openRequest(item.id, e)}
                    aria-label={`View details for Rescue Alert #${item.id}, requested by ${requesterName}${isOverdue ? ", overdue" : ""}`}
                  >
                    {/* REQUESTER */}
                    <div className="rq-requester-cell">
                      <span className={`rq-row-icon-tile ${tileToneClass}`} aria-hidden="true">
                        <TileIcon size={20} strokeWidth={2} />
                      </span>
                      <div className="rq-requester-stack">
                        <div className="rq-requester-title-row">
                          <span className="rq-requester-name">{requesterName}</span>
                          <span className="rq-requester-id">#{item.id}</span>
                        </div>
                        <div className={`rq-requester-phone ${!requesterContact ? "is-missing" : ""}`}>
                          <Phone size={13} aria-hidden="true" />
                          <span>{requesterContact || "Not provided"}</span>
                        </div>
                      </div>
                    </div>

                    {/* LOCATION */}
                    <div className="rq-location-cell">
                      <span className="rq-landmark-chip">
                        <MapPin size={12} aria-hidden="true" />
                        <span>{barangayText}</span>
                      </span>
                      {locSource && (
                        <LocationAccuracyPill
                          variant={locSource.type}
                          accuracyText={locSource.accuracyText}
                        />
                      )}
                      {photoCount > 0 && (
                        <span className="rq-photo-chip">
                          <Camera size={12} aria-hidden="true" />
                          <span>
                            {photoCount} {photoCount === 1 ? "photo" : "photos"}
                          </span>
                        </span>
                      )}
                      {item.handed_to_agency && (
                        <span className="rq-agency-chip" title={`Handed to ${item.handed_to_agency}`}>
                          <Building2 size={12} aria-hidden="true" />
                          <span>{item.handed_to_agency}</span>
                        </span>
                      )}
                    </div>

                    {/* TIME */}
                    <div className="rq-time-cell">
                      <Clock size={14} aria-hidden="true" />
                      <span>{timeText || "—"}</span>
                    </div>

                    {/* STATUS */}
                    <div className="rq-status-cell">
                      <div className="rq-status-pill-row">
                        <StatusPill variant={getRescueStatusPillVariant(item.status)} />
                        {isOverdue && (
                          <span
                            className="rq-overdue-chip"
                            title={`In current status longer than ${RESCUE_OVERDUE_THRESHOLD_HOURS} hours`}
                          >
                            Overdue
                          </span>
                        )}
                      </div>
                      {timeStatus.text && (
                        <span className={`rq-status-note ${isOverdue ? "is-overdue" : ""}`}>
                          {timeStatus.text}
                        </span>
                      )}
                    </div>

                    {/* CHEVRON */}
                    <div className="rq-chevron-cell" aria-hidden="true">
                      <ChevronRight size={18} className="rq-row-chevron" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* FOOTER */}
        {!loading && totalFiltered > 0 && (
          <footer className="rq-table-footer" aria-label="Pagination">
            <span className="rq-footer-info">
              Showing {(safePage - 1) * pageSize + 1} to{" "}
              {Math.min(safePage * pageSize, totalFiltered)} of {totalFiltered}
            </span>

            <div className="rq-footer-controls">
              <label className="rq-rows-per-page">
                <span>Rows per page</span>
                <select
                  className="rq-rows-select"
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
                className="rq-footer-btn"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label="Previous page"
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                className="rq-footer-btn"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                aria-label="Next page"
              >
                Next
              </Button>
            </div>
          </footer>
        )}
      </section>

      {/* 4. DETAIL MODAL & BACKDROP */}
      {selected && (
        <div
          className="rq-modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeRequest();
          }}
          role="presentation"
        >
          <section
            ref={modalRef}
            className="rq-modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rq-modal-title"
            tabIndex={-1}
          >
            {/* FIXED HEADER */}
            <header className="rq-modal-header">
              <div className="rq-modal-header-left">
                <div className="rq-modal-meta-row">
                  <span className="rq-modal-id-chip">
                    Rescue Alert #{selected.id}
                  </span>
                  <StatusPill variant={getRescueStatusPillVariant(selected.status)} />
                  {selectedTimeStatus && (
                    <span
                      className={`rq-modal-duration-chip ${
                        selectedTimeStatus.isOverdue
                          ? "is-overdue"
                          : isOpenStatus(selected) && selectedTimeStatus.isUrgent
                            ? "is-urgent"
                            : ""
                      }`}
                    >
                      {isResolvedStatus(selected) ? (
                        <CheckCircle2 size={13} aria-hidden="true" />
                      ) : isInProgressStatus(selected.status) ? (
                        <Truck size={13} aria-hidden="true" />
                      ) : (
                        <Clock size={13} aria-hidden="true" />
                      )}
                      <span>
                        {selectedTimeStatus.isOverdue
                          ? `Overdue · ${selectedTimeStatus.text}`
                          : selectedTimeStatus.text}
                      </span>
                    </span>
                  )}
                </div>
                <h2 id="rq-modal-title" className="rq-modal-title">
                  {selectedRequesterName || `Emergency Request #${selected.id}`}
                </h2>
              </div>

              <div className="rq-modal-header-right">
                {/* REVERSIBLE STATUS SEGMENTED CONTROL */}
                <div
                  className="rq-status-segmented"
                  role="group"
                  aria-label="Update request status"
                >
                  {STATUS_OPTIONS.map((status, idx) => {
                    const isCurrent = selected.status === status;
                    const isCompleted = currentStatusIndex > idx;
                    const isNextStep =
                      currentStatusIndex !== -1 && idx === currentStatusIndex + 1;
                    const isDisabled = updatingId === selected.id || isCurrent;

                    return (
                      <button
                        type="button"
                        key={status}
                        disabled={isDisabled}
                        aria-pressed={isCurrent}
                        className={[
                          "rq-status-segment",
                          `status-${status}`,
                          isCurrent ? "is-current" : "",
                          isCompleted ? "is-completed" : "",
                          isNextStep ? "is-next-step" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={() =>
                          handleSelectStatusStep(selected.id, status, selected.status)
                        }
                        title={
                          isCurrent
                            ? `Currently ${STATUS_LABELS[status]}`
                            : isCompleted
                              ? `Revert status back to ${STATUS_LABELS[status]}`
                              : `Change status to ${STATUS_LABELS[status]}`
                        }
                      >
                        {isCompleted && (
                          <Check
                            size={13}
                            strokeWidth={2.5}
                            className="rq-status-segment-check"
                            aria-hidden="true"
                          />
                        )}
                        <span>{STATUS_LABELS[status]}</span>
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  ref={closeBtnRef}
                  className="rq-modal-close-btn"
                  onClick={closeRequest}
                  aria-label="Close"
                >
                  <X size={18} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            </header>

            {/* MODAL BODY: 2x2 GRID OF WHITE CARDS ON --bg */}
            <div className="rq-modal-body">
              <div className="rq-modal-grid">
                {/* 1. TOP-LEFT: EMERGENCY SITUATION */}
                <section className="rq-modal-card" aria-label="Emergency situation">
                  <div className="rq-card-head">
                    <h3 className="rq-card-title">Emergency situation</h3>
                  </div>
                  <p className="rq-situation-text">
                    {selected.description || "No description provided."}
                  </p>
                  {Array.isArray(selected.selected_needs) && selected.selected_needs.length > 0 && (
                    <div className="rq-rescue-detail-group">
                      <strong>Selected needs</strong>
                      <div className="rq-rescue-detail-chips">
                        {selected.selected_needs.map((need) => (
                          <span className="rq-rescue-detail-chip" key={need}>{need}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {Array.isArray(selected.vulnerability_flags) && selected.vulnerability_flags.length > 0 && (
                    <div className="rq-rescue-detail-group">
                      <strong>Needs extra assistance</strong>
                      <div className="rq-rescue-detail-chips">
                        {selected.vulnerability_flags.map((flag) => (
                          <span className="rq-rescue-detail-chip" key={flag}>{flag}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </section>

                {/* 2. TOP-RIGHT: REQUESTER & CONTACT */}
                <section className="rq-modal-card" aria-label="Requester and contact">
                  <div className="rq-card-head">
                    <h3 className="rq-card-title">Requester &amp; contact</h3>
                    {selectedContactNumber && (
                      <a
                        href={`tel:${selectedContactNumber}`}
                        className="ui-btn ui-btn--primary rq-call-btn"
                        aria-label={`Call contact number ${selectedContactNumber}`}
                      >
                        <Phone size={15} strokeWidth={2} aria-hidden="true" />
                        <span>Call</span>
                      </a>
                    )}
                  </div>

                  <dl className="rq-contact-list">
                    <div className="rq-contact-row">
                      <span className="rq-contact-icon-tile" aria-hidden="true">
                        <User size={16} strokeWidth={2} />
                      </span>
                      <div className="rq-contact-meta">
                        <dt className="rq-contact-label">Requester name</dt>
                        <dd className="rq-contact-value">
                          {selectedRequesterName || "Not provided"}
                          {selectedPeopleCount != null && selectedPeopleCount !== "" && (
                            <span className="rq-contact-people">
                              {" "}
                              · {selectedPeopleCount}{" "}
                              {Number(selectedPeopleCount) === 1 ? "person" : "people"}
                            </span>
                          )}
                        </dd>
                      </div>
                    </div>

                    <div className="rq-contact-row">
                      <span className="rq-contact-icon-tile" aria-hidden="true">
                        <Phone size={16} strokeWidth={2} />
                      </span>
                      <div className="rq-contact-meta">
                        <dt className="rq-contact-label">Contact number</dt>
                        <dd className="rq-contact-value">
                          {selectedContactNumber || "Not provided"}
                        </dd>
                      </div>
                    </div>

                    <div className="rq-contact-row">
                      <span className="rq-contact-icon-tile" aria-hidden="true">
                        <Clock size={16} strokeWidth={2} />
                      </span>
                      <div className="rq-contact-meta">
                        <dt className="rq-contact-label">Reported time</dt>
                        <dd className="rq-contact-value">
                          {selected.created_at
                            ? formatManilaDateTime(selected.created_at, {}, "Unknown")
                            : "Unknown"}
                        </dd>
                      </div>
                    </div>
                  </dl>
                </section>

                {/* 3. BOTTOM-LEFT: PHOTO PROOF */}
                <section className="rq-modal-card" aria-label="Photo proof">
                  <div className="rq-card-head">
                    <h3 className="rq-card-title">Photo proof</h3>
                    {proofImages.length > 0 && (
                      <span className="rq-photo-chip">
                        <Camera size={12} aria-hidden="true" />
                        <span>
                          {proofImages.length}{" "}
                          {proofImages.length === 1 ? "photo" : "photos"}
                        </span>
                      </span>
                    )}
                  </div>

                  {proofImages.length > 0 ? (
                    <div
                      className="rq-proof-carousel"
                      role="group"
                      aria-roledescription="carousel"
                      aria-label="Photo proof carousel"
                    >
                      <div className="rq-proof-stage">
                        <button
                          type="button"
                          className="rq-proof-trigger"
                          onClick={() => {
                            const currentUrl = proofImages[safeProofIdx];
                            if (currentUrl) setLightboxImage(currentUrl);
                          }}
                          onTouchStart={handleProofTouchStart}
                          onTouchEnd={handleProofTouchEnd}
                          onKeyDown={handleProofKeyDown}
                          aria-label={
                            proofImages.length > 1
                              ? `Photo ${safeProofIdx + 1} of ${proofImages.length}. Click or press Enter to view full size.`
                              : "View photo proof full size"
                          }
                        >
                          {failedProofImages[proofImages[safeProofIdx]] ? (
                            <span className="rq-proof-broken" aria-label="Photo unavailable">
                              <ImageOff size={24} aria-hidden="true" />
                              <span>Image unavailable</span>
                            </span>
                          ) : (
                            <img
                              src={proofImages[safeProofIdx]}
                              alt={`Proof ${safeProofIdx + 1}`}
                              className="rq-proof-stage-img"
                              onError={() => {
                                const brokenUrl = proofImages[safeProofIdx];
                                setFailedProofImages((prev) => ({
                                  ...prev,
                                  [brokenUrl]: true,
                                }));
                              }}
                            />
                          )}
                        </button>

                        <div className="rq-proof-counter" aria-live="polite">
                          {safeProofIdx + 1} / {proofImages.length}
                        </div>

                        {proofImages.length > 1 && (
                          <button
                            type="button"
                            className="rq-proof-arrow is-prev"
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePrevProof();
                            }}
                            aria-label="Previous photo"
                          >
                            <ChevronLeft size={18} aria-hidden="true" />
                          </button>
                        )}

                        {proofImages.length > 1 && (
                          <button
                            type="button"
                            className="rq-proof-arrow is-next"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleNextProof();
                            }}
                            aria-label="Next photo"
                          >
                            <ChevronRight size={18} aria-hidden="true" />
                          </button>
                        )}

                        <button
                          type="button"
                          className="rq-proof-fullsize-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            const currentUrl = proofImages[safeProofIdx];
                            if (currentUrl) setLightboxImage(currentUrl);
                          }}
                          aria-label="Open full size photo viewer"
                        >
                          <Maximize2 size={14} aria-hidden="true" />
                          <span>Full size</span>
                        </button>
                      </div>

                      {proofImages.length > 1 && (
                        <div
                          className="rq-proof-dots"
                          role="tablist"
                          aria-label="Photo proof slides"
                        >
                          {proofImages.map((_, idx) => (
                            <button
                              key={idx}
                              type="button"
                              className={`rq-proof-dot ${safeProofIdx === idx ? "is-active" : ""}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveProofIdx(idx);
                              }}
                              role="tab"
                              aria-selected={safeProofIdx === idx}
                              aria-label={`Go to photo ${idx + 1}`}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rq-proof-empty">
                      <ImageOff size={22} aria-hidden="true" />
                      <span>No photos attached</span>
                    </div>
                  )}
                </section>

                {/* 4. BOTTOM-RIGHT: LOCATION DETAILS */}
                <section className="rq-modal-card" aria-label="Location details">
                  <div className="rq-card-head">
                    <h3 className="rq-card-title">Location details</h3>
                    {hasSelectedCoords && (
                      <Button
                        variant="primary"
                        className="rq-locate-btn"
                        onClick={handleViewOnMap}
                      >
                        <Compass size={15} strokeWidth={2} aria-hidden="true" />
                        <span>Locate on map</span>
                      </Button>
                    )}
                  </div>

                  <div className="rq-loc-coords-block">
                    {hasSelectedCoords ? (
                      <>
                        <p className="rq-coords-text">
                          {Number(selected.latitude).toFixed(5)}° N,{" "}
                          {Number(selected.longitude).toFixed(5)}° E
                        </p>
                        {(() => {
                          const locSource = getLocationSourceInfo(selected);
                          if (!locSource) return null;
                          return (
                            <div className="rq-loc-accuracy-row">
                              <LocationAccuracyPill
                                variant={locSource.type}
                                accuracyText={locSource.accuracyText}
                              />
                              {locSource.fullAccuracyText && (
                                <span className="rq-accuracy-note">
                                  {locSource.fullAccuracyText}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </>
                    ) : (
                      <p className="rq-coords-text is-muted">
                        GPS coordinates were not provided.
                      </p>
                    )}
                  </div>

                  {(selected.barangay || selected.location_description) && (
                    <dl className="rq-loc-meta-list">
                      {selected.barangay && (
                        <div className="rq-loc-meta-item">
                          <dt className="rq-contact-label">Barangay</dt>
                          <dd className="rq-loc-meta-val">{selected.barangay}</dd>
                        </div>
                      )}
                      {selected.location_description && (
                        <div className="rq-loc-meta-item">
                          <dt className="rq-contact-label">Landmark / directions</dt>
                          <dd className="rq-loc-meta-val">{selected.location_description}</dd>
                        </div>
                      )}
                    </dl>
                  )}

                  {hasSelectedCoords && MAPBOX_TOKEN && !mapImgFailed && (
                    <div className="rq-minimap">
                      <img
                        src={`https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/pin-s+dc2626(${Number(selected.longitude)},${Number(selected.latitude)})/${Number(selected.longitude)},${Number(selected.latitude)},15,0/480x280@2x?access_token=${encodeURIComponent(MAPBOX_TOKEN)}`}
                        alt="Rescue location preview map"
                        className="rq-minimap-img"
                        onError={() => setMapImgFailed(true)}
                      />
                    </div>
                  )}
                </section>

                {/* 5. FULL-WIDTH: RESPONDER RELAY & NOTES */}
                <section className="rq-modal-card rq-handoff-card" aria-label="Responder relay and notes">
                  <div className="rq-card-head">
                    <h3 className="rq-card-title">Responder relay &amp; notes</h3>
                  </div>
                  <form className="rq-handoff-form" onSubmit={saveRescueDetails}>
                    <div className="rq-handoff-field">
                      <label className="rq-handoff-label" htmlFor="rq-handed-to-agency">
                        <Building2 size={14} aria-hidden="true" />
                        <span>Relayed to (responder agency)</span>
                      </label>
                      <input
                        id="rq-handed-to-agency"
                        type="text"
                        className="rq-handoff-input"
                        list="rq-agency-suggestions"
                        maxLength={150}
                        value={agencyDraft}
                        onChange={(e) => {
                          setAgencyDraft(e.target.value);
                          setDetailsSaved(false);
                        }}
                        placeholder="e.g. MDRRMO Sogod, BFP Sogod, PNP, Coast Guard"
                        disabled={savingDetails}
                      />
                      <div className="rq-agency-quick-picks" aria-label="Quick select responder agency">
                        {AGENCY_SUGGESTIONS.map((agency) => {
                          const isSelectedAgency = agencyDraft.trim().toLowerCase() === agency.toLowerCase();
                          return (
                            <button
                              key={agency}
                              type="button"
                              className={`rq-agency-pick-chip ${isSelectedAgency ? "is-active" : ""}`}
                              disabled={savingDetails}
                              onClick={() => {
                                setAgencyDraft(isSelectedAgency ? "" : agency);
                                setDetailsSaved(false);
                              }}
                            >
                              {agency}
                            </button>
                          );
                        })}
                      </div>
                      <datalist id="rq-agency-suggestions">
                        {AGENCY_SUGGESTIONS.map((agency) => (
                          <option key={agency} value={agency} />
                        ))}
                      </datalist>
                    </div>

                    <div className="rq-handoff-field">
                      <label className="rq-handoff-label" htmlFor="rq-dispatch-notes">
                        <FileText size={14} aria-hidden="true" />
                        <span>Notes</span>
                      </label>
                      <textarea
                        id="rq-dispatch-notes"
                        className="rq-handoff-textarea"
                        rows={3}
                        maxLength={2000}
                        value={notesDraft}
                        onChange={(e) => {
                          setNotesDraft(e.target.value);
                          setDetailsSaved(false);
                        }}
                        placeholder="Add responder updates, handoff details, or follow-up notes..."
                        disabled={savingDetails}
                      />
                    </div>

                    {detailsError && (
                      <p className="rq-handoff-feedback is-error" role="alert">
                        {detailsError}
                      </p>
                    )}

                    <div className="rq-handoff-actions">
                      {detailsSaved && !isDetailsDirty && (
                        <span className="rq-handoff-feedback is-saved" role="status">
                          <Check size={14} aria-hidden="true" />
                          <span>Saved</span>
                        </span>
                      )}
                      <Button
                        type="submit"
                        variant="primary"
                        disabled={savingDetails || !isDetailsDirty}
                      >
                        <span>{savingDetails ? "Saving..." : "Save details"}</span>
                      </Button>
                    </div>
                  </form>
                </section>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* 5. STATUS CHANGE CONFIRMATION MODAL */}
      {selected && pendingStatusChange && pendingStatusChange.requestId === selected.id && (
        <div
          className="rq-confirm-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget && updatingId !== selected.id) {
              setPendingStatusChange(null);
            }
          }}
          role="presentation"
        >
          <section
            className="rq-confirm-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="rq-confirm-modal-title"
            aria-describedby="rq-confirm-modal-desc"
          >
            <div className="rq-confirm-header">
              <span
                className={`rq-confirm-icon ${
                  pendingStatusChange.isResolve
                    ? "is-resolve"
                    : pendingStatusChange.isRevert
                      ? "is-revert"
                      : "is-advance"
                }`}
                aria-hidden="true"
              >
                {pendingStatusChange.isResolve ? (
                  <CheckCircle2 size={20} strokeWidth={2.2} />
                ) : pendingStatusChange.isRevert ? (
                  <RotateCcw size={20} strokeWidth={2.2} />
                ) : (
                  <Truck size={20} strokeWidth={2.2} />
                )}
              </span>
              <h3 id="rq-confirm-modal-title" className="rq-confirm-title">
                {pendingStatusChange.isReopen
                  ? `Reopen Rescue Alert #${selected.id}?`
                  : pendingStatusChange.isResolve
                    ? `Mark Rescue Alert #${selected.id} as Resolved?`
                    : pendingStatusChange.isRevert
                      ? `Revert status to ${STATUS_LABELS[pendingStatusChange.toStatus]}?`
                      : `Update status to ${STATUS_LABELS[pendingStatusChange.toStatus]}?`}
              </h3>
            </div>

            <p id="rq-confirm-modal-desc" className="rq-confirm-desc">
              {pendingStatusChange.isReopen ? (
                <>
                  Reopen this rescue alert for{" "}
                  <strong>{selectedRequesterName || `Request #${selected.id}`}</strong> and set its
                  status from{" "}
                  <strong>{STATUS_LABELS[pendingStatusChange.fromStatus]}</strong> back to{" "}
                  <strong>{STATUS_LABELS[pendingStatusChange.toStatus]}</strong>?
                </>
              ) : pendingStatusChange.isResolve ? (
                <>
                  Confirm marking the rescue request from{" "}
                  <strong>{selectedRequesterName || `Request #${selected.id}`}</strong> as{" "}
                  <strong>Resolved</strong>? This removes it from the open emergency queue. You can
                  click an earlier status anytime to reopen it if needed.
                </>
              ) : pendingStatusChange.isRevert ? (
                <>
                  Revert the status of{" "}
                  <strong>{selectedRequesterName || `Rescue Alert #${selected.id}`}</strong> from{" "}
                  <strong>{STATUS_LABELS[pendingStatusChange.fromStatus]}</strong> back to{" "}
                  <strong>{STATUS_LABELS[pendingStatusChange.toStatus]}</strong>?
                </>
              ) : (
                <>
                  Change the status of{" "}
                  <strong>{selectedRequesterName || `Rescue Alert #${selected.id}`}</strong> from{" "}
                  <strong>{STATUS_LABELS[pendingStatusChange.fromStatus]}</strong> to{" "}
                  <strong>{STATUS_LABELS[pendingStatusChange.toStatus]}</strong>?
                </>
              )}
            </p>

            <div className="rq-confirm-actions">
              <Button
                variant="secondary"
                disabled={updatingId === selected.id}
                onClick={() => setPendingStatusChange(null)}
              >
                <span>Cancel</span>
              </Button>
              <Button
                variant="primary"
                disabled={updatingId === selected.id}
                onClick={() => updateStatus(selected.id, pendingStatusChange.toStatus)}
              >
                <span>
                  {updatingId === selected.id
                    ? "Updating..."
                    : pendingStatusChange.isReopen
                      ? "Reopen Alert"
                      : pendingStatusChange.isResolve
                        ? "Confirm Resolved"
                        : pendingStatusChange.isRevert
                          ? `Revert to ${STATUS_LABELS[pendingStatusChange.toStatus]}`
                          : `Set to ${STATUS_LABELS[pendingStatusChange.toStatus]}`}
                </span>
              </Button>
            </div>
          </section>
        </div>
      )}

      {/* 6. FULLSCREEN PHOTO LIGHTBOX */}
      {lightboxImage && (
        <div
          ref={lightboxRef}
          className="rescue-lightbox-overlay"
          onClick={() => setLightboxImage(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Full size photo preview"
        >
          <button
            ref={lightboxCloseBtnRef}
            type="button"
            className="rescue-lightbox-close"
            onClick={() => setLightboxImage(null)}
            aria-label="Close photo preview"
          >
            <X size={20} strokeWidth={2} aria-hidden="true" />
          </button>
          <img
            src={lightboxImage}
            alt="Full size rescue proof"
            className="rescue-lightbox-img"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </main>
  );
}

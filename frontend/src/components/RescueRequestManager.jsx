import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faLocationDot,
  faTriangleExclamation,
  faSearch,
  faXmark,
  faPhone,
  faClock,
  faUsers,
  faUser,
  faCompass,
  faImages,
  faCheck,
  faExpand,
} from "@fortawesome/free-solid-svg-icons";
import { api, BASE_URL } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { queryKeys, useRescueRequests } from "../hooks/useEvacuationQueries";
import "../components_css/RescueRequestManager.css";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

const STATUS_OPTIONS = ["pending", "acknowledged", "responding", "resolved"];

const STATUS_LABELS = {
  pending: "Pending",
  acknowledged: "Acknowledged",
  responding: "Responding",
  resolved: "Resolved",
};

function isOpenStatus(status) {
  return status === "pending" || status === "open";
}

function isInProgressStatus(status) {
  return (
    status === "acknowledged" ||
    status === "responding" ||
    status === "in_progress"
  );
}

function isResolvedStatus(status) {
  return status === "resolved";
}

function resolveProofImageUrl(img) {
  if (!img || typeof img !== "string") return "";
  if (img.startsWith("http://") || img.startsWith("https://") || img.startsWith("data:")) {
    return img;
  }
  return `${BASE_URL}${img.startsWith("/") ? "" : "/"}${img}`;
}

function getWaitingTimer(createdAt, now = Date.now()) {
  if (!createdAt) return { text: "just now", minutes: 0 };
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return { text: "just now", minutes: 0 };
  const diffMs = Math.max(0, now - created);
  const minutes = Math.floor(diffMs / (1000 * 60));
  if (minutes < 1) return { text: "waiting < 1 min", minutes: 0 };
  if (minutes < 60) return { text: `waiting ${minutes} min`, minutes };
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) {
    return {
      text: remMinutes > 0 ? `waiting ${hours}h ${remMinutes}m` : `waiting ${hours}h`,
      minutes,
    };
  }
  const days = Math.floor(hours / 24);
  return { text: `waiting ${days}d`, minutes };
}

export default function RescueRequestManager({ initialRequestId, onOpenMap }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const requestsQuery = useRescueRequests();
  const refetchRequests = requestsQuery.refetch;
  const requests = requestsQuery.data || [];
  const loading = requestsQuery.isLoading;

  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState(null);
  const [selectedId, setSelectedId] = useState(initialRequestId || null);
  const [lightboxImage, setLightboxImage] = useState(null);
  const [mapImgFailed, setMapImgFailed] = useState(false);
  const [filterStatus, setFilterStatus] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [now, setNow] = useState(Date.now());

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

  // Reset map image fallback state when selected request changes
  useEffect(() => {
    setMapImgFailed(false);
    setLightboxImage(null);
  }, [selectedId]);

  // Refresh data when window becomes visible
  useEffect(() => {
    function refreshWhenVisible() {
      if (document.visibilityState === "visible") refetchRequests();
    }

    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => document.removeEventListener("visibilitychange", refreshWhenVisible);
  }, [refetchRequests]);

  // Close lightbox or drawer on Escape key press
  useEffect(() => {
    if (!selectedId && !lightboxImage) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        if (lightboxImage) {
          setLightboxImage(null);
        } else {
          setSelectedId(null);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedId, lightboxImage]);

  async function updateStatus(requestId, status) {
    setUpdatingId(requestId);
    setError("");
    try {
      const updated = await api.updateRescueRequest(requestId, status);
      queryClient.setQueryData(queryKeys.rescueRequests, (current = []) =>
        current.map((item) => (item.id === updated.id ? updated : item))
      );
      await queryClient.invalidateQueries({ queryKey: queryKeys.rescueRequests });
    } catch (requestError) {
      setError(requestError.message || "Rescue request status could not be updated.");
    } finally {
      setUpdatingId(null);
    }
  }

  // Calculate status counts
  const openCount = useMemo(
    () => requests.filter((r) => isOpenStatus(r.status)).length,
    [requests]
  );
  const inProgressCount = useMemo(
    () => requests.filter((r) => isInProgressStatus(r.status)).length,
    [requests]
  );
  const resolvedCount = useMemo(
    () => requests.filter((r) => isResolvedStatus(r.status)).length,
    [requests]
  );
  const totalCount = requests.length;

  const statCards = [
    { id: "open", label: "Open Alerts", count: openCount },
    { id: "in_progress", label: "In Progress", count: inProgressCount },
    { id: "resolved", label: "Resolved", count: resolvedCount },
    { id: "all", label: "Total Requests", count: totalCount },
  ];

  const statusTabs = [
    { id: "all", label: "All", count: totalCount },
    { id: "open", label: "Open", count: openCount },
    { id: "in_progress", label: "In progress", count: inProgressCount },
    { id: "resolved", label: "Resolved", count: resolvedCount },
  ];

  // Filter requests based on search query and selected filter
  const filteredRequests = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const cleanQ = q.replace(/^#/, "").replace(/^rescue alert\s*#?/i, "").trim();

    return requests.filter((item) => {
      if (filterStatus === "open" && !isOpenStatus(item.status)) return false;
      if (filterStatus === "in_progress" && !isInProgressStatus(item.status)) return false;
      if (filterStatus === "resolved" && !isResolvedStatus(item.status)) return false;

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

        if (
          !matchId &&
          !matchName &&
          !matchContact &&
          !matchBarangay &&
          !matchLoc &&
          !matchDesc
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

  const selected = requests.find((item) => item.id === selectedId);
  const visibleError = error || requestsQuery.error?.message || "";

  function clearFilters() {
    setSearchQuery("");
    setFilterStatus("all");
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
    selected?.number_of_people ??
    selected?.people_count ??
    selected?.num_people ??
    selected?.people ??
    selected?.family_members ??
    null;

  const selectedWaiting = selected ? getWaitingTimer(selected.created_at, now) : null;
  const currentStatusIndex = selected
    ? STATUS_OPTIONS.indexOf(selected.status)
    : -1;

  const hasSelectedCoords =
    selected &&
    selected.latitude != null &&
    selected.longitude != null &&
    Number.isFinite(Number(selected.latitude)) &&
    Number.isFinite(Number(selected.longitude));

  return (
    <main className="rescue-queue-page">
      {/* 1. HEADER */}
      <header className="rescue-queue-header">
        <div className="rescue-queue-title-area">
          <h1>Rescue Alerts</h1>
          <p className="rescue-queue-subtitle">
            Review and respond to emergency rescue requests from residents.
          </p>
        </div>
        <span
          className={`rescue-open-count ${openCount > 0 ? "is-active" : "is-zero"}`}
          aria-live="polite"
        >
          <span className="rescue-open-dot" />
          {openCount} {openCount === 1 ? "open alert" : "open alerts"}
        </span>
      </header>

      {visibleError && (
        <p className="rescue-queue-error" role="alert">
          {visibleError}
        </p>
      )}

      {/* 2. STAT CARDS */}
      <section
        className="rescue-stat-cards"
        aria-label="Rescue alert summary and filters"
      >
        {statCards.map((card) => {
          const isSelected = filterStatus === card.id;
          const isRedAccent = card.id === "open" && card.count > 0;
          return (
            <button
              type="button"
              key={card.id}
              className={`rescue-stat-card ${isSelected ? "is-selected" : ""}`}
              onClick={() => setFilterStatus(card.id)}
              aria-pressed={isSelected}
            >
              <span className="rescue-stat-label">{card.label}</span>
              <span
                className={`rescue-stat-value ${isRedAccent ? "is-accent-red" : ""}`}
              >
                {card.count}
              </span>
            </button>
          );
        })}
      </section>

      {/* 3. LIST CONTROLS & STATUS TAB ROW */}
      <section className="rescue-list-section" aria-label="Rescue requests list">
        <div className="rescue-filter-toolbar">
          <div className="rescue-search-wrapper">
            <FontAwesomeIcon icon={faSearch} className="rescue-search-icon" />
            <input
              type="search"
              className="rescue-search-input"
              placeholder="Search by requester name, contact, ID, or location…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search rescue requests"
            />
            {searchQuery && (
              <button
                type="button"
                className="rescue-search-clear"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            )}
          </div>

          <div
            className="rescue-status-tabs"
            role="tablist"
            aria-label="Filter by status"
          >
            {statusTabs.map((tab) => {
              const isSelected = filterStatus === tab.id;
              return (
                <button
                  type="button"
                  key={tab.id}
                  role="tab"
                  aria-selected={isSelected}
                  className={`rescue-status-tab ${isSelected ? "is-active" : ""}`}
                  onClick={() => setFilterStatus(tab.id)}
                >
                  <span className="rescue-tab-label">{tab.label}</span>
                  <span className="rescue-tab-badge">{tab.count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* REQUESTS LIST CONTAINER */}
        <div className="rescue-request-container">
          {loading ? (
            <p className="rescue-queue-empty">Loading rescue requests…</p>
          ) : requests.length === 0 ? (
            <div className="rescue-empty-state">
              <div className="rescue-empty-icon-wrap">
                <FontAwesomeIcon icon={faTriangleExclamation} />
              </div>
              <h3>No rescue requests yet</h3>
              <p>New requests from residents will appear here immediately.</p>
            </div>
          ) : sortedRequests.length === 0 ? (
            <div className="rescue-empty-state">
              <div className="rescue-empty-icon-wrap">
                <FontAwesomeIcon icon={faSearch} />
              </div>
              <h3>No matching requests</h3>
              <p>Try adjusting your search terms or status filter.</p>
              <button
                type="button"
                className="rescue-clear-filters-btn"
                onClick={clearFilters}
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div className="rescue-request-list" role="list">
              {sortedRequests.map((item) => {
                const requesterName =
                  item.requester_name ||
                  item.name ||
                  item.user_name ||
                  item.full_name ||
                  `Rescue Alert #${item.id}`;
                const requesterContact =
                  item.requester_contact || item.contact_number || null;
                const barangayText =
                  item.barangay ||
                  item.barangay_name ||
                  item.location_description ||
                  "Sogod, Southern Leyte";
                const peopleCount =
                  item.number_of_people ??
                  item.people_count ??
                  item.num_people ??
                  item.people ??
                  item.family_members ??
                  null;
                const photoCount = Array.isArray(item.proof_images)
                  ? item.proof_images.length
                  : 0;
                const waiting = getWaitingTimer(item.created_at, now);
                const isStillOpen = isOpenStatus(item.status);
                const isTimerRed = isStillOpen && waiting.minutes >= 30;
                const isSelected = selectedId === item.id;

                return (
                  <button
                    type="button"
                    key={item.id}
                    className={`rescue-request-row ${isStillOpen ? "is-open" : ""} ${isSelected ? "is-selected" : ""}`}
                    onClick={() => setSelectedId(item.id)}
                    aria-label={`View details for Rescue Alert #${item.id}, requested by ${requesterName}`}
                  >
                    <div className="rescue-row-top">
                      <div className="rescue-row-header-info">
                        <span className={`rescue-row-icon ${isStillOpen ? "is-open" : ""}`}>
                          <FontAwesomeIcon icon={faTriangleExclamation} />
                        </span>
                        <div className="rescue-row-ident">
                          <div className="rescue-row-name-line">
                            <strong className="rescue-row-name">{requesterName}</strong>
                            <span className="rescue-row-id">#{item.id}</span>
                          </div>
                          {requesterContact && (
                            <span className="rescue-row-contact">
                              <FontAwesomeIcon icon={faPhone} /> {requesterContact}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="rescue-row-mid">
                      <div className="rescue-row-pills">
                        <span className="rescue-row-barangay">
                          <FontAwesomeIcon icon={faLocationDot} /> {barangayText}
                        </span>
                        {peopleCount != null && peopleCount !== "" && (
                          <span className="rescue-row-people">
                            <FontAwesomeIcon icon={faUsers} /> {peopleCount}{" "}
                            {Number(peopleCount) === 1 ? "person" : "people"}
                          </span>
                        )}
                        {photoCount > 0 && (
                          <span className="rescue-row-photos">
                            <FontAwesomeIcon icon={faImages} /> {photoCount}{" "}
                            {photoCount === 1 ? "photo" : "photos"}
                          </span>
                        )}
                      </div>
                      {item.description && (
                        <span className="rescue-row-desc">{item.description}</span>
                      )}
                    </div>

                    <div className="rescue-row-bottom">
                      <span className={`rescue-status-badge status-${item.status}`}>
                        {STATUS_LABELS[item.status] || item.status.replace("_", " ")}
                      </span>
                      <div className="rescue-row-time-meta">
                        <span
                          className={`rescue-row-timer ${isTimerRed ? "is-urgent" : ""}`}
                        >
                          <FontAwesomeIcon icon={faClock} /> {waiting.text}
                        </span>
                        <small className="rescue-row-date">
                          {item.created_at
                            ? new Date(item.created_at).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : ""}
                        </small>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* 4. DETAIL MODAL & BACKDROP */}
      {selected && (
        <div
          className="rescue-drawer-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedId(null);
          }}
        >
          <aside
            className="rescue-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rescue-drawer-title"
          >
            {/* STICKY HEADER */}
            <div className="rescue-drawer-header">
              <div className="rescue-drawer-header-row">
                <div className="rescue-drawer-title-stack">
                  <div className="rescue-drawer-eyebrow-row">
                    <span className="rescue-drawer-alert-id">
                      Rescue Alert #{selected.id}
                    </span>
                    <span className={`rescue-status-badge status-${selected.status}`}>
                      {STATUS_LABELS[selected.status] || selected.status.replace("_", " ")}
                    </span>
                    {selectedWaiting && (
                      <span
                        className={`rescue-drawer-wait-pill ${isOpenStatus(selected.status) && selectedWaiting.minutes >= 30 ? "is-urgent" : ""}`}
                      >
                        <FontAwesomeIcon icon={faClock} /> {selectedWaiting.text}
                      </span>
                    )}
                  </div>
                  <h2 id="rescue-drawer-title">
                    {selectedRequesterName || `Emergency Request #${selected.id}`}
                  </h2>
                </div>
                <button
                  type="button"
                  className="rescue-drawer-close-btn"
                  onClick={() => setSelectedId(null)}
                  aria-label="Close rescue alert details"
                >
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              </div>

              {/* ONE-WAY STATUS PROGRESSION BAR */}
              <div
                className="rescue-status-actions"
                role="group"
                aria-label="Update request status"
              >
                {STATUS_OPTIONS.map((status, idx) => {
                  const isCurrent = selected.status === status;
                  const isCompleted = currentStatusIndex > idx;
                  const isNextStep = currentStatusIndex !== -1 && idx === currentStatusIndex + 1;
                  const isDisabled =
                    updatingId === selected.id || isCurrent || isCompleted;

                  return (
                    <button
                      type="button"
                      key={status}
                      disabled={isDisabled}
                      className={[
                        "rescue-status-action-btn",
                        `status-${status}`,
                        isCurrent ? "is-current" : "",
                        isCompleted ? "is-completed" : "",
                        isNextStep ? "is-next-step" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => updateStatus(selected.id, status)}
                      title={
                        isCompleted
                          ? "Status cannot move backward"
                          : isCurrent
                            ? `Currently ${STATUS_LABELS[status]}`
                            : `Advance status to ${STATUS_LABELS[status]}`
                      }
                    >
                      <span className="rescue-step-indicator">
                        {isCompleted ? <FontAwesomeIcon icon={faCheck} /> : idx + 1}
                      </span>
                      <span>{STATUS_LABELS[status]}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* DRAWER BODY (2-COLUMN GRID ON DESKTOP) */}
            <div className="rescue-drawer-body">
              <div className="rescue-drawer-grid">
                {/* LEFT COLUMN: DESCRIPTION & PHOTO PROOF */}
                <div className="rescue-drawer-col">
                  <div className="rescue-drawer-card">
                    <h3 className="rescue-drawer-section-title">
                      Emergency Situation
                    </h3>
                    <p className="rescue-detail-description">
                      {selected.description || "No description provided."}
                    </p>
                  </div>

                  <div className="rescue-drawer-card">
                    <div className="rescue-drawer-card-head">
                      <h3 className="rescue-drawer-section-title">
                        Photo Proof
                      </h3>
                      {Array.isArray(selected.proof_images) &&
                        selected.proof_images.length > 0 && (
                          <span className="rescue-drawer-photo-count">
                            {selected.proof_images.length}{" "}
                            {selected.proof_images.length === 1 ? "photo" : "photos"}
                          </span>
                        )}
                    </div>

                    {Array.isArray(selected.proof_images) &&
                    selected.proof_images.length > 0 ? (
                      <div className="rescue-proof-gallery">
                        {selected.proof_images.map((img, idx) => {
                          const fullUrl = resolveProofImageUrl(img);
                          return (
                            <button
                              type="button"
                              key={idx}
                              className="rescue-proof-thumb-btn"
                              onClick={() => setLightboxImage(fullUrl)}
                              aria-label={`View photo proof ${idx + 1} full size`}
                            >
                              <img
                                src={fullUrl}
                                alt={`Proof ${idx + 1}`}
                                className="rescue-proof-img"
                              />
                              <span className="rescue-proof-zoom-badge">
                                <FontAwesomeIcon icon={faExpand} />
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rescue-proof-empty">
                        <FontAwesomeIcon icon={faImages} />
                        <span>No situation photos were attached to this alert.</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* RIGHT COLUMN: REQUESTER INFO & LOCATION DETAILS */}
                <div className="rescue-drawer-col">
                  <div className="rescue-drawer-card">
                    <h3 className="rescue-drawer-section-title">
                      Requester & Contact
                    </h3>

                    {selectedContactNumber && (
                      <a
                        href={`tel:${selectedContactNumber}`}
                        className="rescue-call-btn"
                        aria-label={`Call contact number ${selectedContactNumber}`}
                      >
                        <FontAwesomeIcon icon={faPhone} />
                        <span>Call {selectedContactNumber}</span>
                      </a>
                    )}

                    <div className="rescue-drawer-meta-list">
                      <div className="rescue-drawer-meta-item">
                        <span className="rescue-meta-icon">
                          <FontAwesomeIcon icon={faUser} />
                        </span>
                        <div>
                          <strong>Requester Name</strong>
                          <span>{selectedRequesterName || "Not provided"}</span>
                        </div>
                      </div>

                      <div className="rescue-drawer-meta-item">
                        <span className="rescue-meta-icon">
                          <FontAwesomeIcon icon={faPhone} />
                        </span>
                        <div>
                          <strong>Contact Number</strong>
                          <span>{selectedContactNumber || "Not provided"}</span>
                        </div>
                      </div>

                      {selectedPeopleCount != null && selectedPeopleCount !== "" && (
                        <div className="rescue-drawer-meta-item">
                          <span className="rescue-meta-icon">
                            <FontAwesomeIcon icon={faUsers} />
                          </span>
                          <div>
                            <strong>People Needing Rescue</strong>
                            <span>
                              {selectedPeopleCount}{" "}
                              {Number(selectedPeopleCount) === 1 ? "person" : "people"}
                            </span>
                          </div>
                        </div>
                      )}

                      <div className="rescue-drawer-meta-item">
                        <span className="rescue-meta-icon">
                          <FontAwesomeIcon icon={faClock} />
                        </span>
                        <div>
                          <strong>Reported Time</strong>
                          <span>
                            {selected.created_at
                              ? new Date(selected.created_at).toLocaleString()
                              : "Unknown"}
                          </span>
                        </div>
                      </div>

                      {selected.updated_at &&
                        selected.updated_at !== selected.created_at && (
                          <div className="rescue-drawer-meta-item">
                            <span className="rescue-meta-icon">
                              <FontAwesomeIcon icon={faClock} />
                            </span>
                            <div>
                              <strong>Last Updated</strong>
                              <span>
                                {new Date(selected.updated_at).toLocaleString()}
                              </span>
                            </div>
                          </div>
                        )}
                    </div>
                  </div>

                  {/* LOCATION DETAILS & VIEW ON MAP */}
                  <div className="rescue-drawer-card">
                    <div className="rescue-drawer-loc-head">
                      <span className="rescue-meta-icon is-blue">
                        <FontAwesomeIcon icon={faLocationDot} />
                      </span>
                      <div>
                        <h3 className="rescue-drawer-section-title">Location Details</h3>
                        {hasSelectedCoords ? (
                          <p className="rescue-drawer-coords">
                            {Number(selected.latitude).toFixed(5)}° N,{" "}
                            {Number(selected.longitude).toFixed(5)}° E
                          </p>
                        ) : (
                          <p className="rescue-drawer-coords is-muted">
                            GPS coordinates were not provided.
                          </p>
                        )}
                      </div>
                    </div>

                    {hasSelectedCoords && MAPBOX_TOKEN && !mapImgFailed && (
                      <div className="rescue-minimap">
                        <img
                          src={`https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/pin-s+dc2626(${Number(selected.longitude)},${Number(selected.latitude)})/${Number(selected.longitude)},${Number(selected.latitude)},15,0/420x180@2x?access_token=${encodeURIComponent(MAPBOX_TOKEN)}`}
                          alt="Rescue location preview map"
                          className="rescue-minimap-img"
                          onError={() => setMapImgFailed(true)}
                        />
                      </div>
                    )}

                    {selected.location_description && (
                      <div className="rescue-drawer-loc-text">
                        <strong>Landmark / Directions</strong>
                        <p>{selected.location_description}</p>
                      </div>
                    )}

                    {selected.barangay && (
                      <div className="rescue-drawer-loc-text">
                        <strong>Barangay</strong>
                        <p>{selected.barangay}</p>
                      </div>
                    )}

                    {hasSelectedCoords && (
                      <button
                        type="button"
                        className="rescue-map-btn"
                        onClick={handleViewOnMap}
                      >
                        <FontAwesomeIcon icon={faCompass} />
                        <span>Locate on Dispatch Map</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* 5. FULLSCREEN PHOTO LIGHTBOX */}
      {lightboxImage && (
        <div
          className="rescue-lightbox-overlay"
          onClick={() => setLightboxImage(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Full size photo preview"
        >
          <button
            type="button"
            className="rescue-lightbox-close"
            onClick={() => setLightboxImage(null)}
            aria-label="Close photo preview"
          >
            <FontAwesomeIcon icon={faXmark} />
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

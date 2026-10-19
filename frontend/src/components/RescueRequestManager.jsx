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
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { queryKeys, useRescueRequests } from "../hooks/useEvacuationQueries";
import "../components_css/RescueRequestManager.css";

const STATUS_OPTIONS = ["pending", "acknowledged", "responding", "resolved"];

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

  // Refresh data when window becomes visible
  useEffect(() => {
    function refreshWhenVisible() {
      if (document.visibilityState === "visible") refetchRequests();
    }

    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => document.removeEventListener("visibilitychange", refreshWhenVisible);
  }, [refetchRequests]);

  // Close drawer on Escape key press
  useEffect(() => {
    if (!selectedId) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setSelectedId(null);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedId]);

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
    { id: "open", label: "Open", count: openCount },
    { id: "in_progress", label: "In progress", count: inProgressCount },
    { id: "resolved", label: "Resolved", count: resolvedCount },
    { id: "all", label: "Total", count: totalCount },
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
      // Status filter
      if (filterStatus === "open" && !isOpenStatus(item.status)) return false;
      if (filterStatus === "in_progress" && !isInProgressStatus(item.status)) return false;
      if (filterStatus === "resolved" && !isResolvedStatus(item.status)) return false;

      // Search matching (name, id, barangay, and description)
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
        const barangay = (item.barangay || item.barangay_name || "").toLowerCase();
        const matchBarangay = barangay.includes(q);
        const locDesc = (item.location_description || "").toLowerCase();
        const matchLoc = locDesc.includes(q);
        const desc = (item.description || "").toLowerCase();
        const matchDesc = desc.includes(q);

        if (!matchId && !matchName && !matchBarangay && !matchLoc && !matchDesc) {
          return false;
        }
      }
      return true;
    });
  }, [requests, filterStatus, searchQuery]);

  // Open requests sort oldest first
  const sortedRequests = useMemo(() => {
    return [...filteredRequests].sort((a, b) => {
      const aOpen = isOpenStatus(a.status);
      const bOpen = isOpenStatus(b.status);

      // Open requests come first
      if (aOpen && !bOpen) return -1;
      if (!aOpen && bOpen) return 1;

      const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;

      // Both open: sort oldest first
      if (aOpen && bOpen) {
        return timeA - timeB;
      }

      // Non-open requests: sort newest first
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
              placeholder="Search by name, ID, or barangay…"
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
            /* 5. EMPTY STATE: NO REQUESTS AT ALL */
            <div className="rescue-empty-state">
              <div className="rescue-empty-icon-wrap">
                <FontAwesomeIcon icon={faTriangleExclamation} />
              </div>
              <h3>No rescue requests yet</h3>
              <p>New requests will appear here immediately.</p>
            </div>
          ) : sortedRequests.length === 0 ? (
            /* 5. EMPTY STATE: FILTERS HIDE EVERYTHING */
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
                const barangayText =
                  item.barangay ||
                  item.barangay_name ||
                  item.location_description ||
                  "Sogod";
                const peopleCount =
                  item.number_of_people ??
                  item.people_count ??
                  item.num_people ??
                  item.people ??
                  item.family_members ??
                  null;
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
                        <span className="rescue-row-icon">
                          <FontAwesomeIcon icon={faTriangleExclamation} />
                        </span>
                        <div className="rescue-row-ident">
                          <strong className="rescue-row-name">{requesterName}</strong>
                          <span className="rescue-row-id">#{item.id}</span>
                        </div>
                      </div>
                      <span className={`rescue-status-badge status-${item.status}`}>
                        {item.status.replace("_", " ")}
                      </span>
                    </div>

                    <div className="rescue-row-mid">
                      <span className="rescue-row-barangay">
                        <FontAwesomeIcon icon={faLocationDot} /> {barangayText}
                      </span>
                      {peopleCount != null && peopleCount !== "" && (
                        <span className="rescue-row-people">
                          <FontAwesomeIcon icon={faUsers} /> {peopleCount}{" "}
                          {Number(peopleCount) === 1 ? "person" : "people"}
                        </span>
                      )}
                      {item.description && (
                        <span className="rescue-row-desc">{item.description}</span>
                      )}
                    </div>

                    <div className="rescue-row-bottom">
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
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* 4. DETAIL MODAL & BACKDROP (CENTERED & WIDER) */}
      {selected && (
        <div
          className="rescue-drawer-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedId(null);
          }}
          aria-hidden="true"
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
                <div className="rescue-drawer-title-group">
                  <h2 id="rescue-drawer-title">Rescue Alert #{selected.id}</h2>
                  <span className={`rescue-status-badge status-${selected.status}`}>
                    {selected.status.replace("_", " ")}
                  </span>
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

              {/* EXISTING STATUS-CHANGE BUTTONS (each at least 44px tall) */}
              <div
                className="rescue-status-actions"
                role="group"
                aria-label="Change request status"
              >
                {STATUS_OPTIONS.map((status) => {
                  const isCurrent = selected.status === status;
                  return (
                    <button
                      type="button"
                      key={status}
                      disabled={updatingId === selected.id}
                      className={`rescue-status-action-btn status-${status} ${isCurrent ? "is-current" : ""}`}
                      onClick={() => updateStatus(selected.id, status)}
                    >
                      {status[0].toUpperCase() + status.slice(1).replace("_", " ")}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* DRAWER BODY (2-COLUMN GRID ON DESKTOP) */}
            <div className="rescue-drawer-body">
              <div className="rescue-drawer-grid">
                {/* LEFT COLUMN: CALL & DESCRIPTION */}
                <div className="rescue-drawer-col">
                  {/* CALL BUTTON (if contact number exists, at least 44px tall) */}
                  {selectedContactNumber && (
                    <div className="rescue-drawer-section">
                      <a
                        href={`tel:${selectedContactNumber}`}
                        className="rescue-call-btn"
                        aria-label={`Call contact number ${selectedContactNumber}`}
                      >
                        <FontAwesomeIcon icon={faPhone} />
                        <span>Call {selectedContactNumber}</span>
                      </a>
                    </div>
                  )}

                  {/* EMERGENCY DESCRIPTION */}
                  <div className="rescue-drawer-card">
                    <h3 className="rescue-drawer-section-title">Emergency Description</h3>
                    <p className="rescue-detail-description">{selected.description}</p>
                  </div>
                </div>

                {/* RIGHT COLUMN: REQUEST INFO & LOCATION DETAILS */}
                <div className="rescue-drawer-col">
                  {/* REQUEST INFORMATION */}
                  <div className="rescue-drawer-card">
                    <h3 className="rescue-drawer-section-title">Request Information</h3>
                    <div className="rescue-drawer-meta-list">
                      {selectedRequesterName && (
                        <div className="rescue-drawer-meta-item">
                          <FontAwesomeIcon icon={faUser} />
                          <div>
                            <strong>Requester</strong>
                            <span>{selectedRequesterName}</span>
                          </div>
                        </div>
                      )}

                      {selectedPeopleCount != null && selectedPeopleCount !== "" && (
                        <div className="rescue-drawer-meta-item">
                          <FontAwesomeIcon icon={faUsers} />
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
                        <FontAwesomeIcon icon={faClock} />
                        <div>
                          <strong>Reported Time</strong>
                          <span>
                            {selected.created_at
                              ? new Date(selected.created_at).toLocaleString()
                              : "Unknown"}
                            {" · "}
                            <span
                              className={`rescue-drawer-timer ${isOpenStatus(selected.status) && selectedWaiting?.minutes >= 30 ? "is-urgent" : ""}`}
                            >
                              {selectedWaiting?.text}
                            </span>
                          </span>
                        </div>
                      </div>

                      {selected.updated_at && selected.updated_at !== selected.created_at && (
                        <div className="rescue-drawer-meta-item">
                          <FontAwesomeIcon icon={faClock} />
                          <div>
                            <strong>Last Updated</strong>
                            <span>{new Date(selected.updated_at).toLocaleString()}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* LOCATION DETAILS & VIEW ON MAP */}
                  <div className="rescue-drawer-card">
                    <div className="rescue-drawer-loc-head">
                      <FontAwesomeIcon icon={faLocationDot} className="rescue-loc-icon" />
                      <div>
                        <h3 className="rescue-drawer-section-title">Location</h3>
                        {selected.latitude != null && selected.longitude != null ? (
                          <p className="rescue-drawer-coords">
                            {Number(selected.latitude).toFixed(5)}° N,{" "}
                            {Number(selected.longitude).toFixed(5)}° E
                          </p>
                        ) : (
                          <p className="rescue-drawer-coords is-muted">
                            Coordinates were not provided.
                          </p>
                        )}
                      </div>
                    </div>

                    {selected.location_description && (
                      <div className="rescue-drawer-loc-text">
                        <strong>Directions / Landmark:</strong>
                        <p>{selected.location_description}</p>
                      </div>
                    )}

                    {selected.barangay && (
                      <div className="rescue-drawer-loc-text">
                        <strong>Barangay:</strong>
                        <p>{selected.barangay}</p>
                      </div>
                    )}

                    {selected.latitude != null && selected.longitude != null && (
                      <button
                        type="button"
                        className="rescue-map-btn"
                        onClick={handleViewOnMap}
                      >
                        <FontAwesomeIcon icon={faCompass} />
                        <span>View on map</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
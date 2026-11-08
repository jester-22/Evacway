import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faUserCheck,
  faUsers,
  faBuildingColumns,
  faDoorOpen,
  faClock,
  faCheck,
  faRotateLeft,
  faMagnifyingGlass,
  faXmark,
  faSpinner,
  faUserGroup,
  faChevronDown,
  faChevronLeft,
  faChevronRight,
  faListCheck,
  faCircleCheck,
  faCircleExclamation,
  faHouseUser,
  faMapPin,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../../services/api";
import "./EvacueeCheckIn.css";

export default function EvacueeCheckIn() {
  const queryClient = useQueryClient();
  const [selectedCenterId, setSelectedCenterId] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all"); // "all" | "pending" | "partial" | "checked_in"
  const [searchQuery, setSearchQuery] = useState("");
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Member Checklist Modal State
  const [modalFamily, setModalFamily] = useState(null);
  const [selectedMemberIds, setSelectedMemberIds] = useState(new Set());

  // Fetch check-in data
  const {
    data,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["evacuee-check-in-list", selectedCenterId, filterStatus, searchQuery],
    queryFn: () =>
      api.getCheckInList({
        center_id: selectedCenterId,
        q: searchQuery,
        status: filterStatus,
      }),
    staleTime: 10_000,
  });

  const centers = data?.centers || [];
  const evacuees = data?.evacuees || [];
  const summary = data?.summary || {
    total_assigned: 0,
    total_checked_in: 0,
    total_partial: 0,
    total_pending: 0,
    occupancy_rate: 0,
  };

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedCenterId, filterStatus, searchQuery, pageSize]);

  // Derived Pagination
  const totalCount = evacuees.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalCount);

  const paginatedEvacuees = useMemo(() => {
    return evacuees.slice(startIndex, endIndex);
  }, [evacuees, startIndex, endIndex]);

  // Generate pagination buttons with smart ellipsis
  const getPageNumbers = () => {
    const pages = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (safeCurrentPage > 3) pages.push("...");
      const start = Math.max(2, safeCurrentPage - 1);
      const end = Math.min(totalPages - 1, safeCurrentPage + 1);
      for (let i = start; i <= end; i++) {
        if (!pages.includes(i)) pages.push(i);
      }
      if (safeCurrentPage < totalPages - 2) pages.push("...");
      if (!pages.includes(totalPages)) pages.push(totalPages);
    }
    return pages;
  };

  // Show auto-dismissing toast
  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3500);
  };

  // Mutation for check-in / partial / undo
  const checkInMutation = useMutation({
    mutationFn: ({ centerId, familyId, action, residentIds }) =>
      api.updateEvacueeCheckIn(centerId, {
        family_id: familyId,
        action,
        resident_ids: residentIds,
        method: "manual",
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["evacuee-check-in-list"] });
      queryClient.invalidateQueries({ queryKey: ["evacuation-centers"] });
      queryClient.invalidateQueries({ queryKey: ["evacuation-center-details"] });
      showToast(res?.message || "Successfully updated check-in status.");
    },
    onError: (err) => {
      showToast(err?.message || "Failed to update check-in status.");
    },
    onSettled: () => {
      setActionLoadingId(null);
    },
  });

  // Quick 1-click All Arrived
  const handleQuickCheckInAll = (evacuee) => {
    setActionLoadingId(evacuee.family_id);
    checkInMutation.mutate({
      centerId: evacuee.center_id,
      familyId: evacuee.family_id,
      action: "check_in",
    });
  };

  // Quick 1-click Undo Check-In
  const handleQuickUndo = (evacuee) => {
    setActionLoadingId(evacuee.family_id);
    checkInMutation.mutate({
      centerId: evacuee.center_id,
      familyId: evacuee.family_id,
      action: "check_out",
    });
  };

  // Open Member Checklist Modal
  const handleOpenMemberModal = (evacuee) => {
    setModalFamily(evacuee);
    const members = evacuee.members || [];
    const alreadyPresent = members.filter((m) => m.is_checked_in).map((m) => m.id);

    if (alreadyPresent.length > 0) {
      setSelectedMemberIds(new Set(alreadyPresent));
    } else {
      setSelectedMemberIds(new Set(members.map((m) => m.id)));
    }
  };

  // Member toggle in modal
  const handleToggleMember = (memberId) => {
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) {
        next.delete(memberId);
      } else {
        next.add(memberId);
      }
      return next;
    });
  };

  const handleSelectAllMembers = () => {
    if (!modalFamily?.members) return;
    setSelectedMemberIds(new Set(modalFamily.members.map((m) => m.id)));
  };

  const handleClearAllMembers = () => {
    setSelectedMemberIds(new Set());
  };

  const handleSaveModalCheckIn = () => {
    if (!modalFamily) return;
    const residentIdsList = Array.from(selectedMemberIds);
    setActionLoadingId(modalFamily.family_id);

    if (residentIdsList.length === 0) {
      checkInMutation.mutate({
        centerId: modalFamily.center_id,
        familyId: modalFamily.family_id,
        action: "check_out",
      }, {
        onSettled: () => setModalFamily(null),
      });
      return;
    }

    checkInMutation.mutate({
      centerId: modalFamily.center_id,
      familyId: modalFamily.family_id,
      residentIds: residentIdsList,
      action: "partial",
    }, {
      onSettled: () => setModalFamily(null),
    });
  };

  const getInitials = (name) => {
    if (!name) return "HH";
    return name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((n) => n[0].toUpperCase())
      .join("") || "HH";
  };

  const formatRoomBadge = (bldg, room) => {
    if (!room) return "General Venue";
    const str = String(room).trim();
    // If it's just digits (e.g. "27"), prepend "Room "
    let label = str;
    if (/^\d+[a-zA-Z]?$/i.test(str)) {
      label = `Room ${str}`;
    }
    return bldg ? `${bldg} · ${label}` : label;
  };

  const formatCheckinTime = (isoString) => {
    if (!isoString) return "";
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
    } catch {
      return "";
    }
  };

  return (
    <div className="checkin-container" role="main" aria-label="Evacuee Check-In Management">
      {/* Toast Alert */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="checkin-floating-toast"
        >
          <FontAwesomeIcon icon={faCheck} className="checkin-toast-check-icon" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Page Header with Center Filter Dropdown on top-right */}
      <header className="checkin-header">
        <div className="checkin-header-titles">
          <div className="checkin-title-badge-row">
            <h1>Evacuee Arrival & Check-In</h1>
            <span className="checkin-live-badge">
              <span className="checkin-live-dot" /> Live
            </span>
          </div>
          <p>Verify and update resident arrival at assigned evacuation centers in real time.</p>
        </div>

        {/* Top-Right By-Center Filter Dropdown */}
        <div className="checkin-header-center-wrap">
          <FontAwesomeIcon icon={faBuildingColumns} className="checkin-header-center-icon" />
          <span className="checkin-header-center-label">Center:</span>
          <select
            id="checkin-center-filter-select"
            className="checkin-header-center-select"
            value={selectedCenterId}
            onChange={(e) => setSelectedCenterId(e.target.value)}
            aria-label="Filter evacuees by evacuation center"
          >
            <option value="all">All Evacuation Centers ({centers.length})</option>
            {centers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.checked_in}/{c.assigned} arrived)
              </option>
            ))}
          </select>
          <FontAwesomeIcon icon={faChevronDown} className="checkin-header-center-arrow" />
        </div>
      </header>

      {/* Sleek KPI Metric Strip */}
      <section className="checkin-stats-grid" aria-label="Check-In Statistics">
        {/* Total Assigned */}
        <div className="checkin-stat-card is-total">
          <div className="checkin-stat-card-main">
            <span className="checkin-stat-card-label">Total Assigned</span>
            <span className="checkin-stat-value">{summary.total_assigned}</span>
            <span className="checkin-stat-meta">Households assigned</span>
          </div>
          <div className="checkin-stat-icon blue">
            <FontAwesomeIcon icon={faUserGroup} />
          </div>
        </div>

        {/* Fully Arrived */}
        <div className="checkin-stat-card is-arrived">
          <div className="checkin-stat-card-main">
            <span className="checkin-stat-card-label">Fully Arrived</span>
            <span className="checkin-stat-value">{summary.total_checked_in}</span>
            <span className="checkin-stat-meta">All members present</span>
          </div>
          <div className="checkin-stat-icon green">
            <FontAwesomeIcon icon={faCircleCheck} />
          </div>
        </div>

        {/* Partially Arrived */}
        <div className="checkin-stat-card is-partial">
          <div className="checkin-stat-card-main">
            <span className="checkin-stat-card-label">Partially Arrived</span>
            <span className="checkin-stat-value">{summary.total_partial || 0}</span>
            <span className="checkin-stat-meta">Some members here</span>
          </div>
          <div className="checkin-stat-icon amber">
            <FontAwesomeIcon icon={faClock} />
          </div>
        </div>

        {/* Pending Arrival */}
        <div className="checkin-stat-card is-pending">
          <div className="checkin-stat-card-main">
            <span className="checkin-stat-card-label">Pending Arrival</span>
            <span className="checkin-stat-value">{summary.total_pending}</span>
            <span className="checkin-stat-meta">Awaiting shelter arrival</span>
          </div>
          <div className="checkin-stat-icon slate">
            <FontAwesomeIcon icon={faCircleExclamation} />
          </div>
        </div>
      </section>

      {/* Unified Toolbar: Search on Left + Status Pills on Right */}
      <section className="checkin-controls-card" aria-label="Search and status filter controls">
        {/* Search Input */}
        <div className="checkin-search-wrap">
          <FontAwesomeIcon icon={faMagnifyingGlass} className="checkin-search-icon" />
          <input
            type="text"
            className="checkin-search-input"
            placeholder="Search by head, member name, code, contact, room..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search evacuees"
          />
          {searchQuery && (
            <button
              type="button"
              className="checkin-search-clear"
              onClick={() => setSearchQuery("")}
              title="Clear search"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          )}
        </div>

        {/* Segmented Status Filter Tabs */}
        <div className="checkin-filter-tabs-bar" role="tablist" aria-label="Status filters">
          <button
            type="button"
            role="tab"
            aria-selected={filterStatus === "all"}
            className={`checkin-filter-tab ${filterStatus === "all" ? "active" : ""}`}
            onClick={() => setFilterStatus("all")}
          >
            <span>All</span>
            <span className="checkin-tab-count">{summary.total_assigned}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filterStatus === "pending"}
            className={`checkin-filter-tab ${filterStatus === "pending" ? "active" : ""}`}
            onClick={() => setFilterStatus("pending")}
          >
            <span>Pending</span>
            <span className="checkin-tab-count">{summary.total_pending}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filterStatus === "partial"}
            className={`checkin-filter-tab ${filterStatus === "partial" ? "active" : ""}`}
            onClick={() => setFilterStatus("partial")}
          >
            <span>Partially Arrived</span>
            <span className="checkin-tab-count amber">{summary.total_partial || 0}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filterStatus === "checked_in"}
            className={`checkin-filter-tab ${filterStatus === "checked_in" ? "active" : ""}`}
            onClick={() => setFilterStatus("checked_in")}
          >
            <span>Fully Arrived</span>
            <span className="checkin-tab-count green">{summary.total_checked_in}</span>
          </button>
        </div>
      </section>

      {/* Evacuee List Section */}
      <section className="checkin-table-card" aria-label="Evacuee check-in list">
        {isLoading ? (
          <div className="checkin-loading-spinner" role="status">
            <FontAwesomeIcon icon={faSpinner} spin />
            <span>Loading assigned evacuees...</span>
          </div>
        ) : error ? (
          <div className="checkin-empty-state">
            <div className="checkin-empty-icon">!</div>
            <h3 className="checkin-empty-title">Error Loading Evacuees</h3>
            <p className="checkin-empty-text">{error.message || "Failed to load check-in data."}</p>
          </div>
        ) : evacuees.length === 0 ? (
          <div className="checkin-empty-state">
            <div className="checkin-empty-icon">
              <FontAwesomeIcon icon={faUsers} />
            </div>
            <h3 className="checkin-empty-title">No Evacuees Found</h3>
            <p className="checkin-empty-text">
              {searchQuery
                ? `No matching households found for "${searchQuery}".`
                : filterStatus === "pending"
                  ? "All assigned households have arrived!"
                  : filterStatus === "partial"
                    ? "No households have partial arrivals right now."
                    : "No households match the current filters."}
            </p>
          </div>
        ) : (
          <>
            {/* Desktop & Tablet Table View */}
            <div className="checkin-table-wrap">
              <table className="checkin-table">
                <thead>
                  <tr>
                    <th scope="col" className="col-household">Household</th>
                    <th scope="col" className="col-barangay">Origin Barangay</th>
                    <th scope="col" className="col-center">Assigned Shelter</th>
                    <th scope="col" className="col-members">Family Members</th>
                    <th scope="col" className="col-status">Arrival Status</th>
                    <th scope="col" className="col-action">Staff Action</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedEvacuees.map((evacuee) => {
                    const isRowLoading = actionLoadingId === evacuee.family_id;
                    const state = evacuee.checkin_state || "none";
                    const isFullyArrived = state === "full";
                    const isPartiallyArrived = state === "partial";

                    return (
                      <tr key={`${evacuee.family_id}-${evacuee.center_id}`}>
                        {/* Household Head info */}
                        <td className="col-household">
                          <div className="checkin-user-cell">
                            <div className="checkin-avatar" aria-hidden="true">
                              {getInitials(evacuee.head_name)}
                            </div>
                            <div className="checkin-user-text">
                              <span className="checkin-user-name">{evacuee.head_name}</span>
                              <span className="checkin-user-sub">
                                <span className="checkin-code-pill">{evacuee.family_code || `#${evacuee.family_id}`}</span>
                                {evacuee.contact_number && (
                                  <>
                                    <span className="checkin-sep">•</span>
                                    <span className="checkin-contact-num">{evacuee.contact_number}</span>
                                  </>
                                )}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Origin Barangay */}
                        <td className="col-barangay">
                          <div className="checkin-barangay-cell">
                            <span className="checkin-barangay-name">
                              {evacuee.barangay_name}
                            </span>
                            {evacuee.address && (
                              <span className="checkin-address-text">
                                {evacuee.address}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Center & Room */}
                        <td className="col-center">
                          <div className="checkin-center-cell">
                            <span className="checkin-center-name">
                              {evacuee.center_name}
                            </span>
                            <div>
                              <span className={`checkin-room-badge ${evacuee.room_number ? "is-assigned" : ""}`}>
                                <FontAwesomeIcon icon={faDoorOpen} />
                                <span>{formatRoomBadge(evacuee.building_name, evacuee.room_number)}</span>
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Family members & vulnerable chips */}
                        <td className="col-members">
                          <div className="checkin-members-cell">
                            <button
                              type="button"
                              className="checkin-members-chip-btn"
                              onClick={() => handleOpenMemberModal(evacuee)}
                              title="Click to view and check in individual members"
                            >
                              <FontAwesomeIcon icon={faUsers} />
                              <span>
                                {evacuee.member_count} {evacuee.member_count === 1 ? "person" : "people"}
                              </span>
                              {evacuee.checked_in_members > 0 && (
                                <span className={`checkin-members-here-pill ${isFullyArrived ? "full" : "partial"}`}>
                                  {evacuee.checked_in_members} here
                                </span>
                              )}
                            </button>

                            {evacuee.special_needs?.length > 0 && (
                              <div className="checkin-special-needs-list">
                                {evacuee.special_needs.map((flag) => (
                                  <span key={flag} className="checkin-special-chip">
                                    {flag}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Arrival Status */}
                        <td className="col-status">
                          <div className="checkin-status-cell">
                            {isFullyArrived ? (
                              <span className="checkin-status-badge arrived">
                                <FontAwesomeIcon icon={faCircleCheck} />
                                <span>Fully Arrived</span>
                              </span>
                            ) : isPartiallyArrived ? (
                              <span className="checkin-status-badge partial">
                                <span className="checkin-status-dot partial" />
                                <span>{evacuee.checked_in_members} of {evacuee.member_count} Here</span>
                              </span>
                            ) : (
                              <span className="checkin-status-badge pending">
                                <span className="checkin-status-dot pending" />
                                <span>Pending Arrival</span>
                              </span>
                            )}
                            {evacuee.checked_in_at && (
                              <div className="checkin-timestamp">
                                At {formatCheckinTime(evacuee.checked_in_at)}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Action Buttons (Sticky right) */}
                        <td className="col-action">
                          <div className="checkin-action-group">
                            {isFullyArrived ? (
                              <>
                                <button
                                  type="button"
                                  className="checkin-action-btn btn-undo"
                                  onClick={() => handleQuickUndo(evacuee)}
                                  disabled={isRowLoading}
                                  title="Undo check-in for this household"
                                  aria-label={`Undo check-in for ${evacuee.head_name}`}
                                >
                                  {isRowLoading ? (
                                    <FontAwesomeIcon icon={faSpinner} spin />
                                  ) : (
                                    <FontAwesomeIcon icon={faRotateLeft} />
                                  )}
                                  <span>Undo</span>
                                </button>
                                <button
                                  type="button"
                                  className="checkin-action-btn btn-icon-only"
                                  onClick={() => handleOpenMemberModal(evacuee)}
                                  title="Manage individual member presence"
                                  aria-label="Manage individual members"
                                >
                                  <FontAwesomeIcon icon={faListCheck} />
                                </button>
                              </>
                            ) : isPartiallyArrived ? (
                              <>
                                <button
                                  type="button"
                                  className="checkin-action-btn btn-manage"
                                  onClick={() => handleOpenMemberModal(evacuee)}
                                  disabled={isRowLoading}
                                  title="Manage or check in remaining family members"
                                  aria-label={`Manage members for ${evacuee.head_name}`}
                                >
                                  <FontAwesomeIcon icon={faListCheck} />
                                  <span>Manage ({evacuee.checked_in_members}/{evacuee.member_count})</span>
                                </button>
                                <button
                                  type="button"
                                  className="checkin-action-btn btn-icon-only green"
                                  onClick={() => handleQuickCheckInAll(evacuee)}
                                  disabled={isRowLoading}
                                  title="Mark all remaining members arrived"
                                  aria-label="Mark all arrived"
                                >
                                  <FontAwesomeIcon icon={faCheck} />
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="checkin-action-btn btn-arrive"
                                  onClick={() => handleQuickCheckInAll(evacuee)}
                                  disabled={isRowLoading}
                                  title="Mark all members of this household as arrived"
                                  aria-label={`Check in all for ${evacuee.head_name}`}
                                >
                                  {isRowLoading ? (
                                    <FontAwesomeIcon icon={faSpinner} spin />
                                  ) : (
                                    <FontAwesomeIcon icon={faCheck} />
                                  )}
                                  <span>Mark All Arrived</span>
                                </button>
                                <button
                                  type="button"
                                  className="checkin-action-btn btn-icon-only"
                                  onClick={() => handleOpenMemberModal(evacuee)}
                                  title="Check in specific family members only"
                                  aria-label="Check in specific members"
                                >
                                  <FontAwesomeIcon icon={faListCheck} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards View (Visible on viewports <= 960px) */}
            <div className="checkin-mobile-cards-wrap">
              {paginatedEvacuees.map((evacuee) => {
                const isRowLoading = actionLoadingId === evacuee.family_id;
                const state = evacuee.checkin_state || "none";
                const isFullyArrived = state === "full";
                const isPartiallyArrived = state === "partial";

                return (
                  <article
                    key={`mob-${evacuee.family_id}-${evacuee.center_id}`}
                    className="checkin-mobile-card"
                  >
                    {/* Top Row: Avatar + Head Name + Arrival Badge */}
                    <div className="checkin-mobile-card-top">
                      <div className="checkin-user-cell">
                        <div className="checkin-avatar" aria-hidden="true">
                          {getInitials(evacuee.head_name)}
                        </div>
                        <div className="checkin-user-text">
                          <span className="checkin-user-name">{evacuee.head_name}</span>
                          <span className="checkin-user-sub">
                            <span className="checkin-code-pill">{evacuee.family_code || `#${evacuee.family_id}`}</span>
                            {evacuee.contact_number && (
                              <>
                                <span className="checkin-sep">•</span>
                                <span className="checkin-contact-num">{evacuee.contact_number}</span>
                              </>
                            )}
                          </span>
                        </div>
                      </div>

                      <div className="checkin-mobile-top-status">
                        {isFullyArrived ? (
                          <span className="checkin-status-badge arrived">
                            <FontAwesomeIcon icon={faCircleCheck} />
                            <span>Fully Arrived</span>
                          </span>
                        ) : isPartiallyArrived ? (
                          <span className="checkin-status-badge partial">
                            <span className="checkin-status-dot partial" />
                            <span>{evacuee.checked_in_members}/{evacuee.member_count} Here</span>
                          </span>
                        ) : (
                          <span className="checkin-status-badge pending">
                            <span className="checkin-status-dot pending" />
                            <span>Pending</span>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Meta Grid: Origin & Assigned Shelter */}
                    <div className="checkin-mobile-card-meta">
                      <div className="checkin-mobile-meta-item">
                        <span className="checkin-mobile-meta-label">
                          <FontAwesomeIcon icon={faMapPin} /> Origin Barangay
                        </span>
                        <span className="checkin-mobile-meta-val">{evacuee.barangay_name}</span>
                        {evacuee.address && (
                          <span className="checkin-mobile-meta-sub">{evacuee.address}</span>
                        )}
                      </div>

                      <div className="checkin-mobile-meta-item">
                        <span className="checkin-mobile-meta-label">
                          <FontAwesomeIcon icon={faBuildingColumns} /> Assigned Shelter
                        </span>
                        <span className="checkin-mobile-meta-val">{evacuee.center_name}</span>
                        <span className="checkin-mobile-meta-sub">
                          {formatRoomBadge(evacuee.building_name, evacuee.room_number)}
                        </span>
                      </div>
                    </div>

                    {/* Members & Needs */}
                    <div className="checkin-mobile-members-row">
                      <button
                        type="button"
                        className="checkin-members-chip-btn"
                        onClick={() => handleOpenMemberModal(evacuee)}
                        title="Click to view and check in individual members"
                      >
                        <FontAwesomeIcon icon={faUsers} />
                        <span>
                          {evacuee.member_count} {evacuee.member_count === 1 ? "member" : "members"}
                        </span>
                        {evacuee.checked_in_members > 0 && (
                          <span className={`checkin-members-here-pill ${isFullyArrived ? "full" : "partial"}`}>
                            {evacuee.checked_in_members} here
                          </span>
                        )}
                      </button>

                      {evacuee.special_needs?.length > 0 && (
                        <div className="checkin-special-needs-list">
                          {evacuee.special_needs.map((flag) => (
                            <span key={flag} className="checkin-special-chip">
                              {flag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Mobile Action Buttons */}
                    <div className="checkin-mobile-card-actions">
                      {isFullyArrived ? (
                        <>
                          <button
                            type="button"
                            className="checkin-action-btn btn-undo"
                            onClick={() => handleQuickUndo(evacuee)}
                            disabled={isRowLoading}
                          >
                            <FontAwesomeIcon icon={faRotateLeft} />
                            <span>Undo Check-In</span>
                          </button>
                          <button
                            type="button"
                            className="checkin-action-btn btn-manage"
                            onClick={() => handleOpenMemberModal(evacuee)}
                          >
                            <FontAwesomeIcon icon={faListCheck} />
                            <span>Members</span>
                          </button>
                        </>
                      ) : isPartiallyArrived ? (
                        <>
                          <button
                            type="button"
                            className="checkin-action-btn btn-manage"
                            onClick={() => handleOpenMemberModal(evacuee)}
                            disabled={isRowLoading}
                          >
                            <FontAwesomeIcon icon={faListCheck} />
                            <span>Manage ({evacuee.checked_in_members}/{evacuee.member_count})</span>
                          </button>
                          <button
                            type="button"
                            className="checkin-action-btn btn-arrive"
                            onClick={() => handleQuickCheckInAll(evacuee)}
                            disabled={isRowLoading}
                          >
                            <FontAwesomeIcon icon={faCheck} />
                            <span>All Arrived</span>
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="checkin-action-btn btn-arrive"
                            onClick={() => handleQuickCheckInAll(evacuee)}
                            disabled={isRowLoading}
                          >
                            {isRowLoading ? (
                              <FontAwesomeIcon icon={faSpinner} spin />
                            ) : (
                              <FontAwesomeIcon icon={faCheck} />
                            )}
                            <span>Mark All Arrived</span>
                          </button>
                          <button
                            type="button"
                            className="checkin-action-btn btn-manage"
                            onClick={() => handleOpenMemberModal(evacuee)}
                          >
                            <FontAwesomeIcon icon={faListCheck} />
                            <span>Select Members</span>
                          </button>
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>

            {/* Pagination Controls Bar */}
            {totalCount > 0 && (
              <footer className="checkin-pagination-bar" aria-label="Evacuee list pagination">
                <div className="checkin-pagination-info">
                  Showing <strong>{startIndex + 1}</strong>–<strong>{endIndex}</strong> of{" "}
                  <strong>{totalCount}</strong> households
                </div>

                <div className="checkin-pagination-actions">
                  <div className="checkin-pagesize-wrap">
                    <span className="checkin-pagesize-label">Rows per page:</span>
                    <select
                      className="checkin-pagesize-select"
                      value={pageSize}
                      onChange={(e) => setPageSize(Number(e.target.value))}
                      aria-label="Select number of evacuee rows per page"
                    >
                      <option value={10}>10</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                    </select>
                  </div>

                  <nav className="checkin-page-nav" aria-label="Page navigation">
                    <button
                      type="button"
                      className="checkin-page-btn nav-arrow"
                      disabled={safeCurrentPage <= 1}
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      aria-label="Go to previous page"
                      title="Previous page"
                    >
                      <FontAwesomeIcon icon={faChevronLeft} />
                    </button>

                    <div className="checkin-page-numbers">
                      {getPageNumbers().map((item, idx) =>
                        item === "..." ? (
                          <span key={`dots-${idx}`} className="checkin-page-dots" aria-hidden="true">
                            …
                          </span>
                        ) : (
                          <button
                            key={`page-${item}`}
                            type="button"
                            className={`checkin-page-btn ${item === safeCurrentPage ? "active" : ""}`}
                            onClick={() => setCurrentPage(item)}
                            aria-current={item === safeCurrentPage ? "page" : undefined}
                            aria-label={`Page ${item}`}
                          >
                            {item}
                          </button>
                        )
                      )}
                    </div>

                    <button
                      type="button"
                      className="checkin-page-btn nav-arrow"
                      disabled={safeCurrentPage >= totalPages}
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      aria-label="Go to next page"
                      title="Next page"
                    >
                      <FontAwesomeIcon icon={faChevronRight} />
                    </button>
                  </nav>
                </div>
              </footer>
            )}
          </>
        )}
      </section>

      {/* Member Checklist Modal (For Partial / Individual Arrival) */}
      {modalFamily && (
        <div
          className="checkin-modal-backdrop"
          onClick={() => setModalFamily(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="member-modal-title"
        >
          <div
            className="checkin-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Mobile Sheet Handle */}
            <div className="checkin-modal-mobile-handle" aria-hidden="true" />

            {/* Modal Header */}
            <div className="checkin-modal-header">
              <div className="checkin-modal-titles">
                <span className="checkin-modal-tag">Household Arrival Checklist</span>
                <h2 id="member-modal-title">{modalFamily.head_name}</h2>
                <span className="checkin-modal-sub">
                  {modalFamily.family_code ? `Code: ${modalFamily.family_code} · ` : ""}
                  {modalFamily.center_name}
                  {modalFamily.room_number ? ` · Room ${modalFamily.room_number}` : ""}
                </span>
              </div>
              <button
                type="button"
                className="checkin-modal-close"
                onClick={() => setModalFamily(null)}
                aria-label="Close modal"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            {/* Quick Select Bar */}
            <div className="checkin-modal-controls">
              <div className="checkin-modal-summary-text">
                <strong>{selectedMemberIds.size}</strong> of{" "}
                <strong>{modalFamily.members?.length || modalFamily.member_count}</strong> members present
              </div>
              <div className="checkin-modal-quick-btns">
                <button
                  type="button"
                  className="checkin-modal-quick-btn"
                  onClick={handleSelectAllMembers}
                >
                  Select All
                </button>
                <button
                  type="button"
                  className="checkin-modal-quick-btn"
                  onClick={handleClearAllMembers}
                >
                  Clear All
                </button>
              </div>
            </div>

            {/* Member List */}
            <div className="checkin-modal-member-list">
              {modalFamily.members && modalFamily.members.length > 0 ? (
                modalFamily.members.map((member) => {
                  const isChecked = selectedMemberIds.has(member.id);

                  return (
                    <label
                      key={member.id}
                      className={`checkin-modal-member-row ${isChecked ? "is-selected" : ""}`}
                    >
                      <input
                        type="checkbox"
                        className="checkin-modal-checkbox"
                        checked={isChecked}
                        onChange={() => handleToggleMember(member.id)}
                      />
                      <div className="checkin-modal-member-info">
                        <div className="checkin-modal-member-name-row">
                          <span className="checkin-modal-member-name">{member.name}</span>
                          {member.is_head && (
                            <span className="checkin-modal-head-tag">Head</span>
                          )}
                          <span className="checkin-modal-rel-tag">{member.relationship}</span>
                        </div>

                        {member.special_needs?.length > 0 && (
                          <div className="checkin-modal-needs-row">
                            {member.special_needs.map((flag) => (
                              <span key={flag} className="checkin-special-chip">
                                {flag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="checkin-modal-member-status">
                        {isChecked ? (
                          <span className="checkin-modal-status-text present">
                            <FontAwesomeIcon icon={faCheck} />
                            <span>Present</span>
                          </span>
                        ) : (
                          <span className="checkin-modal-status-text absent">
                            <span>Not Here</span>
                          </span>
                        )}
                      </div>
                    </label>
                  );
                })
              ) : (
                <div style={{ padding: "24px", textAlign: "center", color: "#64748b" }}>
                  No individual member records found.
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="checkin-modal-footer">
              <button
                type="button"
                className="checkin-modal-btn is-secondary"
                onClick={() => setModalFamily(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="checkin-modal-btn is-primary"
                onClick={handleSaveModalCheckIn}
                disabled={actionLoadingId === modalFamily.family_id}
              >
                {actionLoadingId === modalFamily.family_id ? (
                  <>
                    <FontAwesomeIcon icon={faSpinner} spin />
                    <span>Saving...</span>
                  </>
                ) : selectedMemberIds.size === 0 ? (
                  <span>Mark All Absent (Undo)</span>
                ) : selectedMemberIds.size === (modalFamily.members?.length || modalFamily.member_count) ? (
                  <span>Confirm All ({selectedMemberIds.size} Present)</span>
                ) : (
                  <span>Confirm Partial ({selectedMemberIds.size} Present)</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

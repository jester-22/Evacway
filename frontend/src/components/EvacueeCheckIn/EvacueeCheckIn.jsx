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
  faFileExcel,
  faCalendarDays,
  faCalendarCheck,
  faGear,
  faDownload,
  faHourglassHalf,
  faTriangleExclamation,
  faBolt,
  faBoxArchive,
  faClockRotateLeft,
} from "@fortawesome/free-solid-svg-icons";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../services/api";
import "./EvacueeCheckIn.css";

export default function EvacueeCheckIn() {
  const queryClient = useQueryClient();
  const [selectedOperationId, setSelectedOperationId] = useState("active");
  const [selectedCenterId, setSelectedCenterId] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all"); // "all" | "pending" | "partial" | "checked_in"
  const [selectedDate, setSelectedDate] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Member Checklist Modal State
  const [modalFamily, setModalFamily] = useState(null);
  const [selectedMemberIds, setSelectedMemberIds] = useState(new Set());

  // User auth & Evacuation Schedule / Report States
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [exportingReport, setExportingReport] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [isStartingNewOp, setIsStartingNewOp] = useState(false);
  const [scheduleCenterId, setScheduleCenterId] = useState("all");
  const [scheduleOpenDate, setScheduleOpenDate] = useState("");
  const [scheduleOpenTime, setScheduleOpenTime] = useState("08:00");
  const [scheduleCutoffDate, setScheduleCutoffDate] = useState("");
  const [scheduleCutoffTime, setScheduleCutoffTime] = useState("18:00");
  const [scheduleStatus, setScheduleStatus] = useState("open");
  const [scheduleEventName, setScheduleEventName] = useState("");
  const [savingSchedule, setSavingSchedule] = useState(false);

  // Quick Extension Modal States
  const [showExtendModal, setShowExtendModal] = useState(false);
  const [extendHoursOption, setExtendHoursOption] = useState(2);
  const [customExtendDate, setCustomExtendDate] = useState("");
  const [customExtendTime, setCustomExtendTime] = useState("20:00");
  const [extendingSchedule, setExtendingSchedule] = useState(false);

  // Fetch check-in data
  const {
    data,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["evacuee-check-in-list", selectedCenterId, filterStatus, searchQuery, selectedDate, selectedOperationId],
    queryFn: () =>
      api.getCheckInList({
        center_id: selectedCenterId,
        q: searchQuery,
        status: filterStatus,
        date: selectedDate || undefined,
        operation_id: selectedOperationId,
      }),
    staleTime: 10_000,
  });

  const centers = data?.centers || [];
  const evacuees = data?.evacuees || [];
  const operations = data?.operations || [];
  const isHistorical = Boolean(data?.is_historical || (selectedOperationId !== "active" && selectedOperationId !== ""));
  const summary = data?.summary || {
    total_assigned: 0,
    total_checked_in: 0,
    total_partial: 0,
    total_pending: 0,
    occupancy_rate: 0,
  };

  const schedule = data?.evacuation_schedule || {
    center_id: "all",
    center_name: "All Evacuation Centers",
    evacuation_open_date: null,
    evacuation_open_time: "08:00",
    evacuation_cutoff_date: null,
    evacuation_cutoff_time: "18:00",
    evacuation_extension_count: 0,
    evacuation_extended_until: null,
    evacuation_status: "standby",
    evacuation_event_name: "",
    is_schedule_set: false,
    is_expired: false,
    can_check_in: false,
  };

  // Determine active center and effective schedule
  const activeCenterObj = useMemo(() => {
    if (selectedCenterId === "all") return null;
    return centers.find((c) => String(c.id) === String(selectedCenterId));
  }, [centers, selectedCenterId]);

  const effectiveSchedule = useMemo(() => {
    if (activeCenterObj) {
      return {
        ...schedule,
        ...activeCenterObj,
        is_schedule_set: Boolean(activeCenterObj.evacuation_open_date),
        can_check_in: Boolean(activeCenterObj.can_check_in),
        is_expired: Boolean(activeCenterObj.is_expired),
      };
    }
    return schedule;
  }, [schedule, activeCenterObj]);

  const isScheduleConfigured = Boolean(effectiveSchedule?.is_schedule_set || effectiveSchedule?.evacuation_open_date);
  const isCenterClosed = (effectiveSchedule?.evacuation_status || "standby") === "closed";
  const isWindowExpired = Boolean(effectiveSchedule?.is_expired);
  const canCheckIn = !isHistorical && isScheduleConfigured && !isCenterClosed;

  const getCheckInDisabledReason = (evacuee) => {
    if (isHistorical) {
      return "Viewing archived historical operation. Check-in records from past disaster events are preserved as read-only.";
    }
    if (!isScheduleConfigured) {
      return "Cannot mark as arrived: No evacuation operation has been started. An administrator must open evacuation operations.";
    }
    if (isCenterClosed) {
      return `Cannot mark as arrived: ${evacuee?.center_name || "Evacuation center"} is currently closed / concluded.`;
    }
    return null;
  };

  // Open Evacuation Schedule Modal
  const handleOpenScheduleModal = (startNew = false) => {
    setIsStartingNewOp(Boolean(startNew));
    setScheduleCenterId(selectedCenterId !== "all" ? selectedCenterId : "all");
    const today = new Date().toISOString().split("T")[0];
    if (startNew) {
      setScheduleEventName("");
      setScheduleOpenDate(today);
      setScheduleOpenTime("08:00");
      setScheduleCutoffDate(today);
      setScheduleCutoffTime("22:00");
      setScheduleStatus("open");
    } else {
      setScheduleOpenDate(effectiveSchedule?.evacuation_open_date || today);
      setScheduleOpenTime(effectiveSchedule?.evacuation_open_time || "08:00");
      setScheduleCutoffDate(effectiveSchedule?.evacuation_cutoff_date || effectiveSchedule?.evacuation_open_date || today);
      setScheduleCutoffTime(effectiveSchedule?.evacuation_cutoff_time || "18:00");
      setScheduleStatus(effectiveSchedule?.evacuation_status || "open");
      setScheduleEventName(effectiveSchedule?.evacuation_event_name || "");
    }
    setShowScheduleModal(true);
  };

  // Save Evacuation Schedule
  const handleSaveSchedule = async (e) => {
    e?.preventDefault();
    try {
      setSavingSchedule(true);
      const res = await api.updateEvacuationSchedule({
        center_id: scheduleCenterId,
        evacuation_open_date: scheduleOpenDate || null,
        evacuation_open_time: scheduleOpenTime || "08:00",
        evacuation_cutoff_date: scheduleCutoffDate || scheduleOpenDate || null,
        evacuation_cutoff_time: scheduleCutoffTime || "18:00",
        evacuation_status: scheduleStatus,
        evacuation_event_name: scheduleEventName.trim(),
        start_new_operation: isStartingNewOp,
      });
      queryClient.invalidateQueries({ queryKey: ["evacuee-check-in-list"] });
      queryClient.invalidateQueries({ queryKey: ["evacuation-centers"] });
      showToast(res?.message || (isStartingNewOp ? "New evacuation operation started." : "Evacuation operation successfully saved."));
      setShowScheduleModal(false);
      if (isStartingNewOp) {
        setSelectedOperationId("active");
      }
    } catch (err) {
      showToast(err.message || "Failed to update evacuation operation.");
    } finally {
      setSavingSchedule(false);
    }
  };

  // Quick Extension Handler
  const handleOpenExtendModal = () => {
    setCustomExtendDate(effectiveSchedule?.evacuation_cutoff_date || new Date().toISOString().split("T")[0]);
    setCustomExtendTime(effectiveSchedule?.evacuation_cutoff_time || "20:00");
    setExtendHoursOption(2);
    setShowExtendModal(true);
  };

  const handleExtendSchedule = async (presetHours) => {
    try {
      setExtendingSchedule(true);
      const payload = {
        center_id: selectedCenterId !== "all" ? selectedCenterId : "all",
      };
      if (presetHours) {
        payload.extend_hours = presetHours;
      } else if (extendHoursOption === "custom") {
        payload.custom_cutoff_date = customExtendDate;
        payload.custom_cutoff_time = customExtendTime;
      } else {
        payload.extend_hours = Number(extendHoursOption);
      }
      const res = await api.extendEvacuationSchedule(payload);
      queryClient.invalidateQueries({ queryKey: ["evacuee-check-in-list"] });
      queryClient.invalidateQueries({ queryKey: ["evacuation-centers"] });
      showToast(res?.message || "Arrival deadline extended successfully.");
      setShowExtendModal(false);
    } catch (err) {
      showToast(err.message || "Failed to extend arrival deadline.");
    } finally {
      setExtendingSchedule(false);
    }
  };

  // Export Evacuee Arrival Report (.xlsx)
  const handleExportReport = async () => {
    try {
      setExportingReport(true);
      const blob = await api.exportCheckInReport({
        center_id: selectedCenterId,
        status: filterStatus,
        q: searchQuery,
        date: selectedDate || undefined,
        operation_id: selectedOperationId,
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const centerObj = centers.find((c) => String(c.id) === String(selectedCenterId));
      const centerSlug = centerObj ? centerObj.name.replace(/\s+/g, "_") : "All_Centers";
      const opObj = operations.find((o) => String(o.id) === String(selectedOperationId));
      const opSlug = opObj ? opObj.event_name.replace(/\s+/g, "_") : (selectedOperationId === "active" ? "Active_Operation" : "Operation");
      const dateSlug = (selectedDate || new Date().toISOString().slice(0, 10)).replace(/-/g, "");
      a.download = `EvacWay-Arrival-Report-${opSlug}-${centerSlug}-${dateSlug}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      showToast("Evacuee arrival report downloaded successfully.");
    } catch (err) {
      console.error("Failed to export check-in report:", err);
      showToast(err.message || "Failed to download arrival report.");
    } finally {
      setExportingReport(false);
    }
  };

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedCenterId, filterStatus, searchQuery, selectedDate, selectedOperationId, pageSize]);

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
            {isHistorical ? (
              <span className="checkin-archive-badge" title="Historical archive view (records are read-only)">
                <FontAwesomeIcon icon={faBoxArchive} /> Archived Operation
              </span>
            ) : (
              <span className="checkin-live-badge">
                <span className="checkin-live-dot" /> Live
              </span>
            )}
          </div>
          <p>
            {isHistorical
              ? "Inspecting archived disaster check-in records and arrival timeline."
              : "Verify and update resident arrival at assigned evacuation centers in real time."}
          </p>
        </div>

        <div className="checkin-header-actions">
          {/* Operation Archive Selector Pill */}
          <div className={`checkin-pill-select-wrap ${isHistorical ? "is-archive" : "is-active"}`}>
            <FontAwesomeIcon icon={isHistorical ? faBoxArchive : faClockRotateLeft} className="checkin-pill-icon" />
            <select
              id="checkin-operation-filter-select"
              className="checkin-pill-select"
              value={selectedOperationId}
              onChange={(e) => setSelectedOperationId(e.target.value)}
              aria-label="Select evacuation operation"
            >
              <option value="active">
                Active: {operations.find((o) => o.status === "active")?.event_name || effectiveSchedule?.evacuation_event_name || "Current Evacuation"}
              </option>
              {operations.filter((o) => o.status !== "active").length > 0 && (
                <optgroup label="Past Operations">
                  {operations.filter((o) => o.status !== "active").map((op) => (
                    <option key={op.id} value={op.id}>
                      Past: {op.event_name} ({op.open_date})
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <FontAwesomeIcon icon={faChevronDown} className="checkin-pill-arrow" />
          </div>

          {/* By-Center Filter Pill */}
          <div className="checkin-pill-select-wrap">
            <FontAwesomeIcon icon={faBuildingColumns} className="checkin-pill-icon" />
            <select
              id="checkin-center-filter-select"
              className="checkin-pill-select"
              value={selectedCenterId}
              onChange={(e) => setSelectedCenterId(e.target.value)}
              aria-label="Filter evacuees by center"
            >
              <option value="all">All Shelters ({centers.length})</option>
              {centers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.checked_in}/{c.assigned})
                </option>
              ))}
            </select>
            <FontAwesomeIcon icon={faChevronDown} className="checkin-pill-arrow" />
          </div>

          {/* Downloadable Report Button */}
          <button
            type="button"
            className="checkin-export-btn"
            onClick={handleExportReport}
            disabled={exportingReport}
            title={isHistorical ? "Download historical check-in report for this archived event" : "Download Excel arrival roster and shelter summary report"}
          >
            <FontAwesomeIcon icon={exportingReport ? faSpinner : faFileExcel} spin={exportingReport} />
            <span>{exportingReport ? "Exporting..." : isHistorical ? "Export Archive" : "Export Report"}</span>
          </button>
        </div>
      </header>

      {/* Unified Single Operational Banner */}
      <div className={`checkin-banner ${isHistorical ? "is-archive" : isWindowExpired ? "is-expired" : !isScheduleConfigured ? "is-unscheduled" : isCenterClosed ? "is-closed" : "is-active"}`}>
        {isHistorical ? (
          // State 1: Historical Archive Mode (Never duplicated!)
          <div className="checkin-banner-inner">
            <div className="checkin-banner-left">
              <div className="checkin-banner-icon archive">
                <FontAwesomeIcon icon={faBoxArchive} />
              </div>
              <div className="checkin-banner-details">
                <div className="checkin-banner-title-row">
                  <span className="checkin-banner-title">
                    Archived Operation: <strong>{effectiveSchedule?.evacuation_event_name || "Past Disaster Event"}</strong>
                  </span>
                  <span className="checkin-banner-pill archive">Read-Only Archive</span>
                </div>
                <div className="checkin-banner-meta">
                  <span>
                    Concluded record from {effectiveSchedule?.evacuation_open_date || "past event"} • Check-in records are preserved for audit and historical reporting.
                  </span>
                </div>
              </div>
            </div>
            <div className="checkin-banner-actions">
              <button
                type="button"
                className="checkin-banner-btn primary"
                onClick={() => setSelectedOperationId("active")}
                title="Return to the current live active evacuation operation"
              >
                <FontAwesomeIcon icon={faRotateLeft} />
                <span>Return to Live Operation</span>
              </button>
            </div>
          </div>
        ) : !isScheduleConfigured ? (
          // State 2: No Schedule Configured
          <div className="checkin-banner-inner">
            <div className="checkin-banner-left">
              <div className="checkin-banner-icon info">
                <FontAwesomeIcon icon={faCalendarDays} />
              </div>
              <div className="checkin-banner-details">
                <div className="checkin-banner-title-row">
                  <span className="checkin-banner-title">No Evacuation Schedule Configured</span>
                  <span className="checkin-banner-pill standby">Standby</span>
                </div>
                <div className="checkin-banner-meta">
                  <span>Set an opening date and arrival deadline to enable resident check-in.</span>
                </div>
              </div>
            </div>
            {isAdmin && (
              <div className="checkin-banner-actions">
                <button
                  type="button"
                  className="checkin-banner-btn primary"
                  onClick={handleOpenScheduleModal}
                >
                  <FontAwesomeIcon icon={faCalendarDays} />
                  <span>Set Evacuation Date</span>
                </button>
              </div>
            )}
          </div>
        ) : isCenterClosed ? (
          // State 3: Shelter Closed
          <div className="checkin-banner-inner">
            <div className="checkin-banner-left">
              <div className="checkin-banner-icon neutral">
                <FontAwesomeIcon icon={faTriangleExclamation} />
              </div>
              <div className="checkin-banner-details">
                <div className="checkin-banner-title-row">
                  <span className="checkin-banner-title">
                    Evacuation Closed / Concluded — <strong>{effectiveSchedule?.evacuation_event_name || "Evacuation"}</strong>
                  </span>
                  <span className="checkin-banner-pill closed">Closed / Stand Down</span>
                </div>
                <div className="checkin-banner-meta">
                  <span>Shelters have concluded operations and are currently standing down. Check-in is paused.</span>
                </div>
              </div>
            </div>
            {isAdmin && (
              <div className="checkin-banner-actions">
                <button
                  type="button"
                  className="checkin-banner-btn secondary"
                  onClick={() => handleOpenScheduleModal(false)}
                >
                  <FontAwesomeIcon icon={faRotateLeft} />
                  <span>Reopen Operation</span>
                </button>
                <button
                  type="button"
                  className="checkin-banner-btn primary"
                  onClick={() => handleOpenScheduleModal(true)}
                  title="Start a new evacuation operation for a new disaster event"
                >
                  <FontAwesomeIcon icon={faBolt} />
                  <span>Start New Evacuation</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          // State 4: Active Live Operation (24/7 Arrivals)
          <div className="checkin-banner-inner">
            <div className="checkin-banner-left">
              <div className="checkin-banner-icon live">
                <FontAwesomeIcon icon={faCalendarCheck} />
              </div>
              <div className="checkin-banner-details">
                <div className="checkin-banner-title-row">
                  <span className="checkin-banner-title">
                    <strong>{effectiveSchedule?.evacuation_event_name || "General Municipality Evacuation"}</strong>
                  </span>
                  <span className="checkin-banner-pill open">
                    <span className="checkin-live-dot" style={{ width: 6, height: 6 }} />
                    Open for Evacuation (24/7)
                  </span>
                </div>
                <div className="checkin-banner-meta">
                  <span>
                    Started: {effectiveSchedule?.evacuation_open_date ? new Date(effectiveSchedule.evacuation_open_date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Today"}
                  </span>
                  <span className="checkin-banner-dot">•</span>
                  <span>Scope: {selectedCenterId !== "all" ? centers.find((c) => String(c.id) === String(selectedCenterId))?.name || "Selected Center" : "All Shelters"}</span>
                  <span className="checkin-banner-dot">•</span>
                  <span>Arrival check-ins active 24/7</span>
                </div>
              </div>
            </div>
            {isAdmin && (
              <div className="checkin-banner-actions">
                <button
                  type="button"
                  className="checkin-banner-btn secondary"
                  onClick={() => handleOpenScheduleModal(false)}
                  title="Edit operation parameters or conclude/archive"
                >
                  <FontAwesomeIcon icon={faGear} />
                  <span>Manage Operation</span>
                </button>
                <button
                  type="button"
                  className="checkin-banner-btn primary"
                  onClick={() => handleOpenScheduleModal(true)}
                  title="Start a fresh evacuation operation for a new disaster event"
                >
                  <FontAwesomeIcon icon={faBolt} />
                  <span>New Operation</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

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
                              <div className="checkin-timestamp arrived" title={`Recorded arrival: ${evacuee.checked_in_at_formatted || evacuee.checked_in_at}`}>
                                <FontAwesomeIcon icon={faClock} style={{ marginRight: "3px" }} />
                                <span>{evacuee.checked_in_time_only || formatCheckinTime(evacuee.checked_in_at)}</span>
                                {evacuee.checked_in_date_only && (
                                  <span className="checkin-time-date"> ({evacuee.checked_in_date_only})</span>
                                )}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Action Buttons (Sticky right) */}
                        <td className="col-action">
                          <div className="checkin-action-group">
                            {isHistorical ? (
                              <button
                                type="button"
                                className="checkin-action-btn btn-view-roster"
                                onClick={() => handleOpenMemberModal(evacuee)}
                                title="View archived arrival details and family roster"
                                aria-label={`View roster for ${evacuee.head_name}`}
                              >
                                <FontAwesomeIcon icon={faListCheck} />
                                <span>View Roster</span>
                              </button>
                            ) : isFullyArrived ? (
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
                                  disabled={isRowLoading || !canCheckIn}
                                  title={getCheckInDisabledReason(evacuee) || "Mark all remaining members arrived"}
                                  aria-label="Mark all arrived"
                                >
                                  <FontAwesomeIcon icon={faCheck} />
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className={`checkin-action-btn btn-arrive ${!canCheckIn ? "is-disabled" : ""}`}
                                  onClick={() => handleQuickCheckInAll(evacuee)}
                                  disabled={isRowLoading || !canCheckIn}
                                  title={getCheckInDisabledReason(evacuee) || "Mark all members of this household as arrived"}
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
                        {evacuee.checked_in_at && (
                          <div className="checkin-mobile-arrived-time">
                            {evacuee.checked_in_time_only || formatCheckinTime(evacuee.checked_in_at)}
                          </div>
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
                      {isHistorical ? (
                        <button
                          type="button"
                          className="checkin-action-btn btn-view-roster"
                          onClick={() => handleOpenMemberModal(evacuee)}
                          style={{ width: "100%", justifyContent: "center" }}
                        >
                          <FontAwesomeIcon icon={faListCheck} />
                          <span>View Household Roster</span>
                        </button>
                      ) : isFullyArrived ? (
                        <>
                          <button
                            type="button"
                            className="checkin-action-btn btn-undo"
                            onClick={() => handleQuickUndo(evacuee)}
                            disabled={isRowLoading}
                            title="Undo check-in for this household"
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
                            disabled={isRowLoading || !canCheckIn}
                            title={getCheckInDisabledReason(evacuee) || undefined}
                          >
                            <FontAwesomeIcon icon={faCheck} />
                            <span>All Arrived</span>
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={`checkin-action-btn btn-arrive ${!canCheckIn ? "is-disabled" : ""}`}
                            onClick={() => handleQuickCheckInAll(evacuee)}
                            disabled={isRowLoading || !canCheckIn}
                            title={getCheckInDisabledReason(evacuee) || undefined}
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
                <strong>{modalFamily.members?.length || modalFamily.member_count}</strong> members {isHistorical ? "arrived during event" : "present"}
              </div>
              {!isHistorical && (
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
              )}
            </div>

            {/* Member List */}
            <div className="checkin-modal-member-list">
              {modalFamily.members && modalFamily.members.length > 0 ? (
                modalFamily.members.map((member) => {
                  const isChecked = selectedMemberIds.has(member.id);

                  return (
                    <label
                      key={member.id}
                      className={`checkin-modal-member-row ${isChecked ? "is-selected" : ""} ${isHistorical ? "is-readonly" : ""}`}
                    >
                      <input
                        type="checkbox"
                        className="checkin-modal-checkbox"
                        checked={isChecked}
                        disabled={isHistorical}
                        onChange={() => !isHistorical && handleToggleMember(member.id)}
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
                            <span>{isHistorical ? "Did Not Arrive" : "Not Here"}</span>
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

            {/* Modal Warning Notice if Check-In Disabled */}
            {!canCheckIn && !isHistorical && (
              <div className="checkin-modal-warning-bar">
                <FontAwesomeIcon icon={faTriangleExclamation} />
                <span>{getCheckInDisabledReason(modalFamily)}</span>
              </div>
            )}
            {isHistorical && (
              <div className="checkin-modal-warning-bar is-archive">
                <FontAwesomeIcon icon={faBoxArchive} />
                <span>Viewing archived disaster record. Records are preserved as read-only.</span>
              </div>
            )}

            {/* Modal Footer */}
            <div className="checkin-modal-footer">
              {isHistorical ? (
                <button
                  type="button"
                  className="checkin-modal-btn is-secondary"
                  onClick={() => setModalFamily(null)}
                >
                  Close
                </button>
              ) : (
                <>
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
                    disabled={actionLoadingId === modalFamily.family_id || (!canCheckIn && selectedMemberIds.size > 0)}
                    title={!canCheckIn && selectedMemberIds.size > 0 ? getCheckInDisabledReason(modalFamily) : undefined}
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
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Evacuation Operation & Shelter Status Modal */}
      {showScheduleModal && (
        <div className="checkin-modal-backdrop" onClick={() => !savingSchedule && setShowScheduleModal(false)}>
          <div className="checkin-modal-card checkin-schedule-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "580px" }}>
            <div className="checkin-modal-header">
              <div className="checkin-modal-title-wrap">
                <FontAwesomeIcon icon={isStartingNewOp ? faBolt : faCalendarDays} style={{ color: "var(--brand, #2563eb)", fontSize: "20px" }} />
                <div>
                  <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700 }}>
                    {isStartingNewOp ? "Start New Evacuation Operation" : "Manage Evacuation Operation & Shelter Status"}
                  </h3>
                  <span style={{ fontSize: "12px", color: "var(--muted, #64748b)" }}>
                    {isStartingNewOp
                      ? "Archive current event and begin a fresh evacuation operation"
                      : "Control active disaster status, shelter openings, and historical archiving"}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="checkin-modal-close"
                onClick={() => setShowScheduleModal(false)}
                disabled={savingSchedule}
                aria-label="Close"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            <form onSubmit={handleSaveSchedule} className="checkin-modal-body" style={{ padding: "18px 22px" }}>
              {/* Operation Mode Selector: Current vs New */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "14px" }}>
                <button
                  type="button"
                  style={{
                    padding: "9px 12px",
                    borderRadius: "8px",
                    border: !isStartingNewOp ? "2px solid #2563eb" : "1px solid #cbd5e1",
                    background: !isStartingNewOp ? "#eff6ff" : "#ffffff",
                    color: !isStartingNewOp ? "#1d4ed8" : "#475569",
                    fontWeight: !isStartingNewOp ? 700 : 500,
                    fontSize: "13px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                  }}
                  onClick={() => setIsStartingNewOp(false)}
                >
                  <FontAwesomeIcon icon={faGear} />
                  <span>Current Operation</span>
                </button>
                <button
                  type="button"
                  style={{
                    padding: "9px 12px",
                    borderRadius: "8px",
                    border: isStartingNewOp ? "2px solid #2563eb" : "1px solid #cbd5e1",
                    background: isStartingNewOp ? "#eff6ff" : "#ffffff",
                    color: isStartingNewOp ? "#1d4ed8" : "#475569",
                    fontWeight: isStartingNewOp ? 700 : 500,
                    fontSize: "13px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                  }}
                  onClick={() => {
                    setIsStartingNewOp(true);
                    setScheduleEventName("");
                    setScheduleStatus("open");
                    const today = new Date().toISOString().split("T")[0];
                    setScheduleOpenDate(today);
                    setScheduleCutoffDate(today);
                  }}
                >
                  <FontAwesomeIcon icon={faBolt} />
                  <span>+ Start New Operation</span>
                </button>
              </div>

              {/* Informative notice when starting a new operation */}
              {isStartingNewOp && (
                <div style={{
                  padding: "10px 14px",
                  background: "#f0fdf4",
                  border: "1px solid #bbf7d0",
                  borderRadius: "8px",
                  marginBottom: "14px",
                  fontSize: "12px",
                  color: "#166534",
                  display: "flex",
                  gap: "10px",
                  alignItems: "flex-start",
                }}>
                  <FontAwesomeIcon icon={faBoxArchive} style={{ marginTop: "2px", flexShrink: 0 }} />
                  <div>
                    <strong>Clean New Disaster Operation:</strong> The previous operation ("{effectiveSchedule?.evacuation_event_name || 'Active Evacuation'}") will be archived into history. A clean check-in roster will start at 0 arrived for this new disaster.
                  </div>
                </div>
              )}

              {/* Event Name */}
              <div className="checkin-form-group">
                <label className="checkin-form-label">
                  Disaster Advisory or Event Name <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="text"
                  className="checkin-form-input"
                  placeholder="e.g. Typhoon Kristine Evacuation, Tropical Storm Pepito"
                  value={scheduleEventName}
                  onChange={(e) => setScheduleEventName(e.target.value)}
                  disabled={savingSchedule}
                  required
                />
              </div>

              {/* Target Center */}
              <div className="checkin-form-group">
                <label className="checkin-form-label">Target Shelter / Facility Scope</label>
                <select
                  className="checkin-form-input"
                  value={scheduleCenterId}
                  onChange={(e) => setScheduleCenterId(e.target.value)}
                  disabled={savingSchedule}
                >
                  <option value="all">Apply to All Evacuation Centers ({centers.length} facilities)</option>
                  {centers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Operational Status (3 Clean Vertical Options) */}
              <div className="checkin-form-group">
                <label className="checkin-form-label">Shelter Operational Status</label>
                <div className="checkin-status-cards">
                  {/* Option 1: Open */}
                  <div
                    role="button"
                    tabIndex={0}
                    className={`checkin-status-card open ${scheduleStatus === "open" ? "is-active" : ""}`}
                    onClick={() => setScheduleStatus("open")}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setScheduleStatus("open")}
                  >
                    <div className="checkin-status-card-icon open">
                      <span className="checkin-status-dot-lg open" />
                    </div>
                    <div className="checkin-status-card-text">
                      <strong className="checkin-status-card-title">Open for Evacuation (Active)</strong>
                      <span className="checkin-status-card-desc">
                        Shelters are open and ready. Staff can check in arriving residents in real time 24/7.
                      </span>
                    </div>
                    <div className="checkin-status-radio">
                      <div className={`checkin-radio-indicator ${scheduleStatus === "open" ? "is-checked" : ""}`} />
                    </div>
                  </div>

                  {/* Option 2: Standby */}
                  <div
                    role="button"
                    tabIndex={0}
                    className={`checkin-status-card standby ${scheduleStatus === "standby" ? "is-active" : ""}`}
                    onClick={() => setScheduleStatus("standby")}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setScheduleStatus("standby")}
                  >
                    <div className="checkin-status-card-icon standby">
                      <span className="checkin-status-dot-lg standby" />
                    </div>
                    <div className="checkin-status-card-text">
                      <strong className="checkin-status-card-title">Standby / Preparedness</strong>
                      <span className="checkin-status-card-desc">
                        Shelters are designated and prepared in advance. Check-ins activate once opened.
                      </span>
                    </div>
                    <div className="checkin-status-radio">
                      <div className={`checkin-radio-indicator ${scheduleStatus === "standby" ? "is-checked" : ""}`} />
                    </div>
                  </div>

                  {/* Option 3: Closed */}
                  <div
                    role="button"
                    tabIndex={0}
                    className={`checkin-status-card closed ${scheduleStatus === "closed" ? "is-active" : ""}`}
                    onClick={() => setScheduleStatus("closed")}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setScheduleStatus("closed")}
                  >
                    <div className="checkin-status-card-icon closed">
                      <span className="checkin-status-dot-lg closed" />
                    </div>
                    <div className="checkin-status-card-text">
                      <strong className="checkin-status-card-title">Conclude & Save to Archive</strong>
                      <span className="checkin-status-card-desc">
                        Evacuation has concluded. Facilities stand down and records are preserved as archive.
                      </span>
                    </div>
                    <div className="checkin-status-radio">
                      <div className={`checkin-radio-indicator ${scheduleStatus === "closed" ? "is-checked" : ""}`} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Schedule & Operational Dates */}
              {scheduleStatus !== "closed" && (
                <div className="checkin-window-card">
                  <div className="checkin-window-header">
                    <FontAwesomeIcon icon={faCalendarDays} style={{ color: "var(--brand, #2563eb)" }} />
                    <span style={{ fontWeight: 600, fontSize: "13px", color: "#1e293b" }}>Operation Date & Advisory Timeline</span>
                  </div>

                  <div className="checkin-window-grid">
                    <div className="checkin-window-col">
                      <label className="checkin-form-label-sm">Opening Date & Time</label>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <input
                          type="date"
                          className="checkin-form-input"
                          value={scheduleOpenDate}
                          onChange={(e) => {
                            setScheduleOpenDate(e.target.value);
                            if (!scheduleCutoffDate || scheduleCutoffDate < e.target.value) {
                              setScheduleCutoffDate(e.target.value);
                            }
                          }}
                          disabled={savingSchedule}
                          required
                        />
                        <input
                          type="time"
                          className="checkin-form-input"
                          style={{ width: "120px", flexShrink: 0 }}
                          value={scheduleOpenTime}
                          onChange={(e) => setScheduleOpenTime(e.target.value)}
                          disabled={savingSchedule}
                          required
                        />
                      </div>
                    </div>

                    <div className="checkin-window-col">
                      <label className="checkin-form-label-sm">Expected Arrival Target (Advisory)</label>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <input
                          type="date"
                          className="checkin-form-input"
                          value={scheduleCutoffDate}
                          onChange={(e) => setScheduleCutoffDate(e.target.value)}
                          disabled={savingSchedule}
                        />
                        <input
                          type="time"
                          className="checkin-form-input"
                          style={{ width: "120px", flexShrink: 0 }}
                          value={scheduleCutoffTime}
                          onChange={(e) => setScheduleCutoffTime(e.target.value)}
                          disabled={savingSchedule}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="checkin-window-note">
                    ℹ️ Check-ins are accessible 24/7 while shelters are open. Target deadlines are advisory and never block evacuees from checking in.
                  </div>
                </div>
              )}

              {/* Dynamic Live Summary Callout */}
              <div className={`checkin-summary-callout ${scheduleStatus}`}>
                <div className="checkin-summary-callout-text">
                  <span className="checkin-summary-callout-title">
                    {scheduleStatus === "open"
                      ? "🟢 Active Evacuation Mode"
                      : scheduleStatus === "standby"
                        ? "🟡 Standby / Preparedness Mode"
                        : "⚪ Conclude & Archive Mode"}
                  </span>
                  <span className="checkin-summary-callout-desc">
                    {scheduleStatus === "open"
                      ? `Shelters open on ${scheduleOpenDate || "today"} at ${scheduleOpenTime || "08:00"}. Evacuees can be checked in 24/7.`
                      : scheduleStatus === "standby"
                        ? `Operation scheduled in advance. Evacuee check-ins will unlock when opened.`
                        : `Operation concluded. Check-ins are disabled and official disaster records are preserved for historical audit and reporting.`}
                  </span>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="checkin-modal-footer" style={{ marginTop: "16px" }}>
                <button
                  type="button"
                  className="checkin-modal-btn is-secondary"
                  onClick={() => setShowScheduleModal(false)}
                  disabled={savingSchedule}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="checkin-modal-btn is-primary"
                  disabled={savingSchedule || (scheduleStatus !== "closed" && !scheduleOpenDate)}
                >
                  {savingSchedule && <FontAwesomeIcon icon={faSpinner} spin style={{ marginRight: "6px" }} />}
                  {savingSchedule
                    ? "Saving..."
                    : isStartingNewOp
                      ? "Start & Open New Operation"
                      : scheduleStatus === "closed"
                        ? "Conclude & Archive Operation"
                        : "Save Evacuation Operation"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quick Extension Modal */}
      {showExtendModal && (
        <div className="checkin-modal-backdrop" onClick={() => !extendingSchedule && setShowExtendModal(false)}>
          <div className="checkin-modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "480px" }}>
            <div className="checkin-modal-header">
              <div className="checkin-modal-title-wrap">
                <FontAwesomeIcon icon={faClock} style={{ color: "var(--brand, #2563eb)", fontSize: "18px" }} />
                <h3>Extend Evacuation Arrival Window</h3>
              </div>
              <button
                type="button"
                className="checkin-modal-close"
                onClick={() => setShowExtendModal(false)}
                disabled={extendingSchedule}
                aria-label="Close"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            <div className="checkin-modal-body" style={{ padding: "18px 22px" }}>
              <p style={{ fontSize: "13px", color: "var(--muted, #64748b)", margin: "0 0 16px" }}>
                Prolong the allowed arrival window for evacuees. Once extended, check-in controls will immediately reactivate so staff can continue recording arrivals.
              </p>

              <div className="checkin-form-group">
                <label className="checkin-form-label">Extension Duration</label>
                <div className="checkin-preset-btns">
                  {[2, 4, 8, 24].map((hrs) => (
                    <button
                      key={hrs}
                      type="button"
                      className={`checkin-preset-btn ${extendHoursOption === hrs ? "is-active" : ""}`}
                      onClick={() => setExtendHoursOption(hrs)}
                    >
                      +{hrs} Hours {hrs === 24 ? "(+1 Day)" : ""}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`checkin-preset-btn ${extendHoursOption === "custom" ? "is-active" : ""}`}
                    onClick={() => {
                      setExtendHoursOption("custom");
                      if (!customExtendDate) {
                        setCustomExtendDate(effectiveSchedule?.evacuation_cutoff_date || new Date().toISOString().split("T")[0]);
                      }
                    }}
                  >
                    Custom Date & Time
                  </button>
                </div>
              </div>

              {extendHoursOption === "custom" && (
                <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "10px", marginTop: "12px" }}>
                  <div className="checkin-form-group">
                    <label className="checkin-form-label">New Cutoff Date</label>
                    <input
                      type="date"
                      className="checkin-form-input"
                      value={customExtendDate}
                      onChange={(e) => setCustomExtendDate(e.target.value)}
                    />
                  </div>
                  <div className="checkin-form-group">
                    <label className="checkin-form-label">New Cutoff Time</label>
                    <input
                      type="time"
                      className="checkin-form-input"
                      value={customExtendTime}
                      onChange={(e) => setCustomExtendTime(e.target.value)}
                    />
                  </div>
                </div>
              )}

              <div className="checkin-modal-footer" style={{ marginTop: "20px" }}>
                <button
                  type="button"
                  className="checkin-modal-btn is-secondary"
                  onClick={() => setShowExtendModal(false)}
                  disabled={extendingSchedule}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="checkin-modal-btn is-primary"
                  onClick={() => handleExtendSchedule()}
                  disabled={extendingSchedule}
                >
                  {extendingSchedule && <FontAwesomeIcon icon={faSpinner} spin style={{ marginRight: "6px" }} />}
                  {extendingSchedule ? "Extending Deadline..." : "Confirm Extension"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

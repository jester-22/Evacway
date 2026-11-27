import { useState, useMemo, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatManilaDate } from "../../utils/dateTime";
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  Building2,
  Calendar,
  CalendarCheck2,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  History,
  ListChecks,
  Loader2,
  MoreVertical,
  RotateCcw,
  Search,
  Settings,
  SlidersHorizontal,
  UserPlus,
  Users,
  X,
  Zap,
} from "lucide-react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faClock,
  faCheck,
  faXmark,
  faSpinner,
  faGear,
  faTriangleExclamation,
  faBolt,
  faBoxArchive,
} from "@fortawesome/free-solid-svg-icons";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../services/api";
import { Button, Pagination, StatCard, StatusPill } from "../ui";
import "./EvacueeCheckIn.css";
import { AddNonRegisteredButton, NonRegisteredModal, NonRegisteredGroups } from './NonRegisteredEvacuees';

const URL_FILTER_TO_STATUS = {
  "all-arrivals": "all",
  pending: "pending",
  "partially-arrived": "partial",
  arrived: "checked_in",
  "non-registered": "non_registered",
};

export default function EvacueeCheckIn() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedOperationId, setSelectedOperationId] = useState("active");
  const urlCenterId = searchParams.get("center_id");
  const [selectedCenterId, setSelectedCenterId] = useState(() => urlCenterId || "all");
  useEffect(() => {
    if (urlCenterId && urlCenterId !== selectedCenterId) {
      setSelectedCenterId(urlCenterId);
    }
  }, [urlCenterId]);
  const [selectedDate] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [nonRegisteredModal, setNonRegisteredModal] = useState(null);
  const [nonRegisteredStatus, setNonRegisteredStatus] = useState('all');
  const [nonRegisteredPage, setNonRegisteredPage] = useState(1);

  const rawUrlFilter = (searchParams.get("filter") || "all-arrivals").toLowerCase();
  const activeUrlFilter = Object.hasOwn(URL_FILTER_TO_STATUS, rawUrlFilter)
    ? rawUrlFilter
    : "all-arrivals";
  const filterStatus = URL_FILTER_TO_STATUS[activeUrlFilter];

  const handleFilterChipChange = (nextUrlFilter) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("filter", nextUrlFilter);
        return next;
      },
      { replace: true }
    );
    setCurrentPage(1);
    setNonRegisteredPage(1);
  };

  const normalizedSearch = useMemo(
    () => searchQuery.trim().replace(/\s+/g, " "),
    [searchQuery]
  );
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);

  // Dropdown Menu & Mobile Filter Sheet States
  const [opMenuOpen, setOpMenuOpen] = useState(false);
  const [shelterMenuOpen, setShelterMenuOpen] = useState(false);
  const [bannerMenuOpen, setBannerMenuOpen] = useState(false);
  const [openMobileRowMenuId, setOpenMobileRowMenuId] = useState(null);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [draftCenterId, setDraftCenterId] = useState("all");

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Member Checklist Modal State
  const [modalFamily, setModalFamily] = useState(null);
  const [selectedMemberIds, setSelectedMemberIds] = useState(new Set());

  // User auth & Evacuation Operation / Report States
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [exportingReport, setExportingReport] = useState(false);
  const [showManageOpModal, setShowManageOpModal] = useState(false);
  const [showNewOpModal, setShowNewOpModal] = useState(false);
  const [pendingOpConfirm, setPendingOpConfirm] = useState(null); // null | "manage-conclude" | "new-operation"
  const [scheduleCenterId, setScheduleCenterId] = useState("all");
  const [scheduleOpenDate, setScheduleOpenDate] = useState("");
  const [scheduleOpenTime, setScheduleOpenTime] = useState("08:00");
  const [scheduleCutoffDate, setScheduleCutoffDate] = useState("");
  const [scheduleCutoffTime, setScheduleCutoffTime] = useState("18:00");
  const [scheduleStatus, setScheduleStatus] = useState("open");
  const [scheduleEventName, setScheduleEventName] = useState("");
  const [scheduleEventNameError, setScheduleEventNameError] = useState("");
  const [savingSchedule, setSavingSchedule] = useState(false);
  const savingScheduleRef = useRef(false);

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
    queryKey: ["evacuee-check-in-list", selectedCenterId, filterStatus, normalizedSearch, selectedDate, selectedOperationId],
    queryFn: () =>
      api.getCheckInList({
        center_id: selectedCenterId,
        q: normalizedSearch,
        status: filterStatus === 'non_registered' ? 'all' : filterStatus,
        date: selectedDate || undefined,
        operation_id: selectedOperationId,
      }),
    staleTime: 10_000,
  });

  const centers = useMemo(() => data?.centers || [], [data?.centers]);
  const evacuees = useMemo(() => data?.evacuees || [], [data?.evacuees]);
  const operations = useMemo(() => data?.operations || [], [data?.operations]);
  const isHistorical = Boolean(data?.is_historical || (selectedOperationId !== "active" && selectedOperationId !== ""));
  const summary = data?.summary || {
    total_assigned: 0,
    total_checked_in: 0,
    total_partial: 0,
    total_pending: 0,
    occupancy_rate: 0,
  };

  const schedule = useMemo(() => data?.evacuation_schedule || {
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
  }, [data?.evacuation_schedule]);

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
      return "Viewing an archived operation. Arrival records from past disaster events are preserved as read-only.";
    }
    if (!isScheduleConfigured) {
      return "Cannot mark as arrived: No evacuation operation has been started. An administrator must open evacuation operations.";
    }
    if (isCenterClosed) {
      return `Cannot mark as arrived: ${evacuee?.center_name || "Evacuation center"} is currently closed / concluded.`;
    }
    return null;
  };

  // Close dropdown menus, modals & filter sheet on outside click or Escape
  useEffect(() => {
    if (
      !opMenuOpen &&
      !shelterMenuOpen &&
      !bannerMenuOpen &&
      openMobileRowMenuId == null &&
      !filterSheetOpen &&
      !modalFamily &&
      !showManageOpModal &&
      !showNewOpModal &&
      !showExtendModal
    ) {
      return undefined;
    }
    const handleOutsideClick = (e) => {
      if (!e.target.closest?.(".checkin-dropdown-anchor") && !e.target.closest?.(".checkin-mobile-menu-anchor")) {
        setOpMenuOpen(false);
        setShelterMenuOpen(false);
        setBannerMenuOpen(false);
        setOpenMobileRowMenuId(null);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setOpMenuOpen(false);
        setShelterMenuOpen(false);
        setBannerMenuOpen(false);
        setOpenMobileRowMenuId(null);
        setFilterSheetOpen(false);
        if (modalFamily) setModalFamily(null);
        if (showManageOpModal && !savingSchedule) setShowManageOpModal(false);
        if (showNewOpModal && !savingSchedule) setShowNewOpModal(false);
        if (showExtendModal && !extendingSchedule) setShowExtendModal(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    opMenuOpen,
    shelterMenuOpen,
    bannerMenuOpen,
    openMobileRowMenuId,
    filterSheetOpen,
    modalFamily,
    showManageOpModal,
    showNewOpModal,
    showExtendModal,
    savingSchedule,
    extendingSchedule,
  ]);

  // Open Manage Operation Modal (prefilled with current operation details)
  const handleOpenManageOpModal = () => {
    const today = new Date().toISOString().split("T")[0];
    setScheduleCenterId(selectedCenterId !== "all" ? String(selectedCenterId) : "all");
    setScheduleOpenDate(effectiveSchedule?.evacuation_open_date || today);
    setScheduleOpenTime(effectiveSchedule?.evacuation_open_time || "08:00");
    setScheduleCutoffDate(
      effectiveSchedule?.evacuation_cutoff_date ||
      effectiveSchedule?.evacuation_open_date ||
      today
    );
    setScheduleCutoffTime(effectiveSchedule?.evacuation_cutoff_time || "18:00");
    setScheduleStatus(effectiveSchedule?.evacuation_status || "open");
    setScheduleEventName(effectiveSchedule?.evacuation_event_name || "");
    setScheduleEventNameError("");
    setPendingOpConfirm(null);
    setShowNewOpModal(false);
    setShowManageOpModal(true);
  };

  // Open New Operation Modal (starts with empty fields)
  const handleOpenNewOpModal = () => {
    setScheduleEventName("");
    setScheduleEventNameError("");
    setScheduleCenterId("all");
    setScheduleOpenDate("");
    setScheduleOpenTime("");
    setScheduleCutoffDate("");
    setScheduleCutoffTime("");
    setScheduleStatus("open");
    setPendingOpConfirm(null);
    setShowManageOpModal(false);
    setShowNewOpModal(true);
  };

  // Submit / Confirm Operation Save (with validation, confirmation, and double-click guard)
  const handleSaveOperation = async (mode, confirmed = false) => {
    if (savingScheduleRef.current) return;

    const trimmedName = scheduleEventName.trim();
    if (!trimmedName) {
      setScheduleEventNameError("Operation name is required.");
      return;
    }

    if (mode === "manage" && scheduleStatus === "closed" && !confirmed) {
      setPendingOpConfirm("manage-conclude");
      return;
    }

    if (mode === "new" && !confirmed) {
      setPendingOpConfirm("new-operation");
      return;
    }

    const today = new Date().toISOString().split("T")[0];
    const openDateValue = scheduleOpenDate || today;
    const openTimeValue = scheduleOpenTime || "08:00";
    const cutoffDateValue = scheduleCutoffDate || openDateValue;
    const cutoffTimeValue = scheduleCutoffTime || "18:00";

    try {
      savingScheduleRef.current = true;
      setSavingSchedule(true);
      const res = await api.updateEvacuationSchedule({
        center_id: scheduleCenterId,
        evacuation_open_date: openDateValue,
        evacuation_open_time: openTimeValue,
        evacuation_cutoff_date: cutoffDateValue,
        evacuation_cutoff_time: cutoffTimeValue,
        evacuation_status: scheduleStatus,
        evacuation_event_name: trimmedName,
        start_new_operation: mode === "new",
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["evacuee-check-in-list"] }),
        queryClient.invalidateQueries({ queryKey: ["evacuation-centers"] }),
      ]);
      showToast(
        res?.message ||
        (mode === "new"
          ? "New evacuation operation started."
          : "Evacuation operation successfully saved.")
      );
      setPendingOpConfirm(null);
      setShowManageOpModal(false);
      setShowNewOpModal(false);
      if (mode === "new") {
        setSelectedOperationId("active");
        setCurrentPage(1);
      }
    } catch (err) {
      showToast(err.message || "Failed to update evacuation operation.");
    } finally {
      savingScheduleRef.current = false;
      setSavingSchedule(false);
    }
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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["evacuee-check-in-list"] }),
        queryClient.invalidateQueries({ queryKey: ["evacuation-centers"] }),
      ]);
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
        q: normalizedSearch,
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
      console.error("Failed to export arrival report:", err);
      showToast(err.message || "Failed to download arrival report.");
    } finally {
      setExportingReport(false);
    }
  };

  // Derived Pagination
  const totalCount = evacuees.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalCount);

  const paginatedEvacuees = useMemo(() => {
    return evacuees.slice(startIndex, endIndex);
  }, [evacuees, startIndex, endIndex]);

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
      showToast(res?.message || "Successfully updated arrival status.");
    },
    onError: (err) => {
      showToast(err?.message || "Failed to update arrival status.");
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

  const normalizeRoomLabel = (room) => {
    if (!room) return "";
    const str = String(room).trim();
    if (!str) return "";
    return /^\d+[a-zA-Z]?$/i.test(str) ? `Room ${str}` : str;
  };

  const getEvacueeStructureMode = (evacuee) => {
    const raw = String(evacuee?.structure_mode || "").trim().toLowerCase();
    if (["open_area", "rooms_only", "buildings_and_rooms"].includes(raw)) {
      return raw;
    }
    const code = String(evacuee?.center_type || "").trim().toLowerCase();
    if (code === "single_venue") return "open_area";
    if (code === "private_property") return "rooms_only";
    return "buildings_and_rooms";
  };

  const formatRoomBadge = (bldg, room, structureMode = "buildings_and_rooms") => {
    if (structureMode === "open_area") return null;
    const label = normalizeRoomLabel(room);
    if (!label) return null;
    if (structureMode === "buildings_and_rooms" && bldg) {
      return `${bldg} · ${label}`;
    }
    return label;
  };

  const formatMobileShelterLine = (evacuee) => {
    const mode = getEvacueeStructureMode(evacuee);
    if (mode === "open_area") {
      return evacuee.center_name || "Evacuation Center";
    }
    const roomLabel = normalizeRoomLabel(evacuee.room_number);
    const venueParts =
      mode === "buildings_and_rooms"
        ? [evacuee.building_name, roomLabel].filter(Boolean).join(", ")
        : roomLabel;
    return [evacuee.center_name, venueParts].filter(Boolean).join(" · ");
  };

  const formatOpDate = (dateStr) => {
    if (!dateStr) return "";
    return formatManilaDate(dateStr, {}, dateStr);
  };

  const formatOpDateRange = (openDate, cutoffDate) => {
    const start = formatOpDate(openDate);
    const end = formatOpDate(cutoffDate);
    if (start && end && cutoffDate !== openDate) return `${start} – ${end}`;
    return start || end || "";
  };

  const activeOperation = useMemo(
    () => operations.find((op) => op.status !== "concluded") || null,
    [operations]
  );

  const nonRegisteredQuery = useQuery({
    queryKey: ['non-registered-evacuees', selectedOperationId, selectedCenterId, normalizedSearch, nonRegisteredStatus, nonRegisteredPage],
    queryFn: () => api.getNonRegisteredEvacuees({ operation_id: selectedOperationId, center_id: selectedCenterId,
      q: normalizedSearch, status: nonRegisteredStatus, page: nonRegisteredPage, per_page: 10 }),
    staleTime: 10_000,
  });
  const selectedArrivalOperation = selectedOperationId === 'active' ? activeOperation : operations.find((op) => String(op.id) === String(selectedOperationId));
  const canAddNonRegistered = Boolean(selectedArrivalOperation?.status === 'active' && !isHistorical && !isCenterClosed);
  const refreshArrivals = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['non-registered-evacuees'] }),
    queryClient.invalidateQueries({ queryKey: ['evacuee-check-in-list'] }),
    queryClient.invalidateQueries({ queryKey: ['evacuation-centers'] }),
    queryClient.invalidateQueries({ queryKey: ['evacuation-center-details'] }),
    queryClient.invalidateQueries({ queryKey: ['rooms'] }),
    queryClient.invalidateQueries({ queryKey: ['buildings'] }),
    queryClient.invalidateQueries({ queryKey: ['logs'] }),
  ]);

  const archivedOperations = useMemo(() => {
    return operations
      .filter((op) => op.status === "concluded")
      .slice()
      .sort((a, b) => {
        const aKey = a.concluded_at || a.open_date || "";
        const bKey = b.concluded_at || b.open_date || "";
        if (bKey !== aKey) return bKey.localeCompare(aKey);
        return (b.id || 0) - (a.id || 0);
      });
  }, [operations]);

  const activeOpName =
    activeOperation?.event_name ||
    (!isHistorical ? effectiveSchedule?.evacuation_event_name : "") ||
    "Current Operation";
  const activeOpDates = formatOpDateRange(
    activeOperation?.open_date || (!isHistorical ? effectiveSchedule?.evacuation_open_date : null),
    activeOperation?.cutoff_date || (!isHistorical ? effectiveSchedule?.evacuation_cutoff_date : null)
  );
  const selectedArchivedOp = useMemo(
    () => archivedOperations.find((op) => String(op.id) === String(selectedOperationId)) || null,
    [archivedOperations, selectedOperationId]
  );
  const selectedCenterObj = useMemo(
    () => (selectedCenterId === "all" ? null : centers.find((c) => String(c.id) === String(selectedCenterId)) || null),
    [centers, selectedCenterId]
  );
  const archivedBannerName =
    effectiveSchedule?.evacuation_event_name ||
    selectedArchivedOp?.event_name ||
    "Archived Operation";
  const archivedBannerDates = formatOpDateRange(
    effectiveSchedule?.evacuation_open_date || selectedArchivedOp?.open_date,
    effectiveSchedule?.evacuation_cutoff_date || selectedArchivedOp?.cutoff_date
  );

  const renderMobileOperationMenu = () => (
    <div className="ea-banner-mobile-actions checkin-dropdown-anchor">
      <button
        type="button"
        className="ea-banner-kebab-btn"
        onClick={() => {
          setOpMenuOpen(false);
          setShelterMenuOpen(false);
          setOpenMobileRowMenuId(null);
          setBannerMenuOpen((prev) => !prev);
        }}
        aria-label="Operation actions"
        aria-expanded={bannerMenuOpen}
        aria-haspopup="menu"
      >
        <MoreVertical size={16} aria-hidden="true" />
      </button>

      {bannerMenuOpen && (
        <div className="ea-select-menu ea-banner-mobile-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="ea-select-option"
            onClick={() => {
              setBannerMenuOpen(false);
              handleOpenManageOpModal();
            }}
          >
            <span className="ea-select-option-main">
              <Settings size={15} aria-hidden="true" />
              <span className="ea-select-option-name">Manage Operation</span>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="ea-select-option is-primary"
            onClick={() => {
              setBannerMenuOpen(false);
              handleOpenNewOpModal();
            }}
          >
            <span className="ea-select-option-main">
              <Zap size={15} aria-hidden="true" />
              <span className="ea-select-option-name">New Operation</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="checkin-container ea-page" role="main" aria-label="Evacuee Arrival Management">
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

      {/* Page Header: Title + Live StatusPill on left; Operation select, Shelter select, Export Report on right */}
      <header className="ea-header">
        <div className="ea-header-left">
          <h1 className="ea-title">Evacuee Arrival</h1>
          {!isHistorical ? (
            <StatusPill variant="success" label="Live" />
          ) : (
            <StatusPill variant="neutral" label="Archived" />
          )}
        </div>

        {/* Header Actions (Operation Selector, Shelter Filter, Export Report) */}
        <div className="ea-header-actions">
          {/* Operation History Selector */}
          <div className="ea-select-dropdown checkin-dropdown-anchor">
            <button
              type="button"
              id="checkin-operation-filter-select"
              className="ea-select-trigger"
              onClick={() => {
                setShelterMenuOpen(false);
                setOpMenuOpen((prev) => !prev);
              }}
              aria-haspopup="listbox"
              aria-expanded={opMenuOpen}
              aria-label="Select active or archived evacuation operation"
              title={
                isHistorical
                  ? `${archivedBannerName}${archivedBannerDates ? ` (${archivedBannerDates})` : ""}`
                  : `Active: ${activeOpName}${activeOpDates ? ` (${activeOpDates})` : ""}`
              }
            >
              <History size={15} className="ea-select-icon" aria-hidden="true" />
              <span className="ea-select-label">
                {isHistorical ? archivedBannerName : `Active: ${activeOpName}`}
              </span>
              <ChevronDown size={15} className="ea-select-arrow" aria-hidden="true" />
            </button>

            {opMenuOpen && (
              <div className="ea-select-menu" role="listbox" aria-label="Evacuation operations">
                <button
                  type="button"
                  role="option"
                  aria-selected={!isHistorical}
                  className={`ea-select-option ${!isHistorical ? "is-selected" : ""}`}
                  onClick={() => {
                    setSelectedOperationId("active");
                    setCurrentPage(1);
                    setOpMenuOpen(false);
                  }}
                >
                  <span className="ea-select-option-main">
                    <StatusPill variant="success" label="Active" />
                    <span className="ea-select-option-name">{activeOpName}</span>
                  </span>
                  {activeOpDates && (
                    <span className="ea-select-option-sub">{activeOpDates}</span>
                  )}
                </button>

                <div className="ea-select-divider" />

                {archivedOperations.length === 0 ? (
                  <div className="ea-select-empty" role="option" aria-disabled="true">
                    No archived operations yet
                  </div>
                ) : (
                  archivedOperations.map((op) => {
                    const rangeLabel = formatOpDateRange(op.open_date, op.cutoff_date);
                    const isSelected = String(op.id) === String(selectedOperationId);
                    return (
                      <button
                        key={op.id}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        className={`ea-select-option ${isSelected ? "is-selected" : ""}`}
                        onClick={() => {
                          setSelectedOperationId(String(op.id));
                          setCurrentPage(1);
                          setOpMenuOpen(false);
                        }}
                      >
                        <span className="ea-select-option-main">
                          <span className="ea-select-option-name">
                            {op.event_name || "Archived Operation"}
                          </span>
                        </span>
                        {rangeLabel && (
                          <span className="ea-select-option-sub">{rangeLabel}</span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* By-Center Shelter Filter Dropdown */}
          <div className="ea-select-dropdown checkin-dropdown-anchor">
            <button
              type="button"
              id="checkin-center-filter-select"
              className="ea-select-trigger"
              onClick={() => {
                setOpMenuOpen(false);
                setShelterMenuOpen((prev) => !prev);
              }}
              aria-haspopup="listbox"
              aria-expanded={shelterMenuOpen}
              aria-label="Filter evacuees by center"
              title={
                selectedCenterObj
                  ? `${selectedCenterObj.name} (${selectedCenterObj.checked_in}/${selectedCenterObj.assigned})`
                  : `All Shelters (${centers.length})`
              }
            >
              <Building2 size={15} className="ea-select-icon" aria-hidden="true" />
              <span className="ea-select-label">
                {selectedCenterObj ? selectedCenterObj.name : "All Shelters"}
              </span>
              <ChevronDown size={15} className="ea-select-arrow" aria-hidden="true" />
            </button>

            {shelterMenuOpen && (
              <div className="ea-select-menu" role="listbox" aria-label="Evacuation centers">
                <button
                  type="button"
                  role="option"
                  aria-selected={selectedCenterId === "all"}
                  className={`ea-select-option ${selectedCenterId === "all" ? "is-selected" : ""}`}
                  onClick={() => {
                    setSelectedCenterId("all");
                    setCurrentPage(1);
                    setShelterMenuOpen(false);
                  }}
                >
                  <span className="ea-select-option-row">
                    <span className="ea-select-option-name">All Shelters</span>
                    <span className="ea-select-option-count">({centers.length})</span>
                  </span>
                </button>

                {centers.map((c) => {
                  const isSelected = String(selectedCenterId) === String(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={`ea-select-option ${isSelected ? "is-selected" : ""}`}
                      onClick={() => {
                        setSelectedCenterId(String(c.id));
                        setCurrentPage(1);
                        setShelterMenuOpen(false);
                      }}
                    >
                      <span className="ea-select-option-row">
                        <span className="ea-select-option-name">{c.name}</span>
                        <span className="ea-select-option-count">
                          ({c.checked_in}/{c.assigned})
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Secondary Export Report Button */}
          <Button
            variant="secondary"
            className="ea-export-btn"
            onClick={handleExportReport}
            disabled={exportingReport}
            aria-label={
              exportingReport
                ? "Exporting report"
                : isHistorical
                  ? "Export Archive"
                  : "Export Report"
            }
            title={
              isHistorical
                ? "Download historical arrival report for this archived event"
                : "Download Excel arrival roster and shelter summary report"
            }
          >
            <Download size={16} strokeWidth={2} aria-hidden="true" />
            <span>
              {exportingReport
                ? "Exporting..."
                : isHistorical
                  ? "Export Archive"
                  : "Export Report"}
            </span>
          </Button>
        </div>
      </header>

      {/* Operation Banner Card (--radius-lg, 1px border, --shadow-xs) */}
      <section
        className={`ea-op-banner ${
          isHistorical
            ? "is-archive"
            : isWindowExpired
              ? "is-expired"
              : !isScheduleConfigured
                ? "is-unscheduled"
                : isCenterClosed
                  ? "is-closed"
                  : "is-active"
        }`}
        aria-label="Evacuation operation status"
      >
        {isHistorical ? (
          // State 1: Historical Archive Mode
          <div className="ea-op-banner-inner">
            <div className="ea-op-banner-left">
              <span className="ea-op-icon-tile is-neutral" aria-hidden="true">
                <Archive size={18} strokeWidth={2} />
              </span>
              <div className="ea-op-banner-copy">
                <div className="ea-op-title-row">
                  <span className="ea-op-name">Viewing archived: {archivedBannerName}</span>
                  <StatusPill variant="neutral" label="Archived record" />
                </div>
                <div className="ea-op-meta">
                  {archivedBannerDates && (
                    <>
                      <span>{archivedBannerDates}</span>
                      <span className="ea-op-dot" aria-hidden="true">•</span>
                    </>
                  )}
                  <span>Read-only historical arrival records</span>
                </div>
              </div>
            </div>
            <div className="ea-op-banner-actions">
              <Button
                variant="primary"
                className="ea-op-btn"
                onClick={() => {
                  setSelectedOperationId("active");
                  setCurrentPage(1);
                }}
                title="Return to the current active evacuation operation"
              >
                <RotateCcw size={15} strokeWidth={2} aria-hidden="true" />
                <span>Back to active operation</span>
              </Button>
            </div>
          </div>
        ) : !isScheduleConfigured ? (
          // State 2: No Schedule Configured
          <div className="ea-op-banner-inner">
            <div className="ea-op-banner-left">
              <span className="ea-op-icon-tile is-warn" aria-hidden="true">
                <Calendar size={18} strokeWidth={2} />
              </span>
              <div className="ea-op-banner-copy">
                <div className="ea-op-title-row">
                  <span className="ea-op-name">No Evacuation Schedule Configured</span>
                  <StatusPill variant="pending" label="Standby" />
                </div>
                <div className="ea-op-meta">
                  <span>Set an opening date and arrival deadline to record resident arrivals.</span>
                </div>
              </div>
            </div>
            {isAdmin && (
              <>
                <div className="ea-op-banner-actions">
                  <Button
                    variant="primary"
                    className="ea-op-btn"
                    onClick={handleOpenManageOpModal}
                  >
                    <Calendar size={15} strokeWidth={2} aria-hidden="true" />
                    <span>Set Evacuation Date</span>
                  </Button>
                </div>
                {renderMobileOperationMenu()}
              </>
            )}
          </div>
        ) : isCenterClosed ? (
          // State 3: Shelter Closed
          <div className="ea-op-banner-inner">
            <div className="ea-op-banner-left">
              <span className="ea-op-icon-tile is-neutral" aria-hidden="true">
                <AlertTriangle size={18} strokeWidth={2} />
              </span>
              <div className="ea-op-banner-copy">
                <div className="ea-op-title-row">
                  <span className="ea-op-name">
                    Evacuation Closed / Concluded — {effectiveSchedule?.evacuation_event_name || "Evacuation"}
                  </span>
                  <StatusPill variant="neutral" label="Closed / Stand Down" />
                </div>
                <div className="ea-op-meta">
                  <span>Shelters have concluded operations and are currently standing down. Check-in is paused.</span>
                </div>
              </div>
            </div>
            {isAdmin && (
              <>
                <div className="ea-op-banner-actions">
                  <Button
                    variant="secondary"
                    className="ea-op-btn"
                    onClick={handleOpenManageOpModal}
                  >
                    <RotateCcw size={15} strokeWidth={2} aria-hidden="true" />
                    <span>Reopen Operation</span>
                  </Button>
                  <Button
                    variant="primary"
                    className="ea-op-btn"
                    onClick={handleOpenNewOpModal}
                    title="Start a new evacuation operation for a new disaster event"
                  >
                    <Zap size={15} strokeWidth={2} aria-hidden="true" />
                    <span>Start New Evacuation</span>
                  </Button>
                </div>
                {renderMobileOperationMenu()}
              </>
            )}
          </div>
        ) : (
          // State 4: Active Live Operation (24/7 Arrivals)
          <div className="ea-op-banner-inner">
            <div className="ea-op-banner-left">
              <span className="ea-op-icon-tile is-success" aria-hidden="true">
                <CalendarCheck2 size={18} strokeWidth={2} />
              </span>
              <div className="ea-op-banner-copy">
                <div className="ea-op-title-row">
                  <span className="ea-op-name">
                    {effectiveSchedule?.evacuation_event_name || "General Municipality Evacuation"}
                  </span>
                  <StatusPill variant="success" label="Open for evacuation (24/7)" />
                </div>
                <div className="ea-op-meta">
                  <span>
                    Started:{" "}
                    {effectiveSchedule?.evacuation_open_date
                      ? formatManilaDate(effectiveSchedule.evacuation_open_date, {}, "Today")
                      : "Today"}
                  </span>
                  <span className="ea-op-dot" aria-hidden="true">•</span>
                  <span>
                    Scope:{" "}
                    {selectedCenterId !== "all"
                      ? centers.find((c) => String(c.id) === String(selectedCenterId))?.name ||
                        "Selected Center"
                      : "All Shelters"}
                  </span>
                  <span className="ea-op-dot" aria-hidden="true">•</span>
                  <span>Arrival recording active 24/7</span>
                </div>
              </div>
            </div>
            {isAdmin && (
              <>
                <div className="ea-op-banner-actions">
                  <Button
                    variant="secondary"
                    className="ea-op-btn"
                    onClick={handleOpenManageOpModal}
                    title="Edit operation parameters or conclude/archive"
                  >
                    <Settings size={15} strokeWidth={2} aria-hidden="true" />
                    <span>Manage Operation</span>
                  </Button>
                  <Button
                    variant="primary"
                    className="ea-op-btn"
                    onClick={handleOpenNewOpModal}
                    title="Start a fresh evacuation operation for a new disaster event"
                  >
                    <Zap size={15} strokeWidth={2} aria-hidden="true" />
                    <span>New Operation</span>
                  </Button>
                </div>
                {renderMobileOperationMenu()}
              </>
            )}
          </div>
        )}
      </section>

      {/* 5 Clickable StatCards in One Row (Filter by Arrival Status) */}
      {isLoading ? (
        <div className="ea-stats-grid" aria-hidden="true">
          {Array.from({ length: 5 }).map((_, idx) => (
            <div key={idx} className="ea-skel-stat-card">
              <div className="ea-skel-stat-top">
                <span className="ea-skel ea-skel-tile" />
                <span className="ea-skel ea-skel-label" />
              </div>
              <span className="ea-skel ea-skel-value" />
              <span className="ea-skel ea-skel-helper" />
            </div>
          ))}
        </div>
      ) : (
        <section className="ea-stats-grid" role="group" aria-label="Filter arrivals by status">
          <StatCard
            icon={Users}
            iconTone="primary"
            label="Total assigned"
            value={summary.total_assigned}
            showProgress={false}
            helper="All assigned evacuees"
            active={activeUrlFilter === "all-arrivals"}
            onClick={() => handleFilterChipChange("all-arrivals")}
          />
          <StatCard
            icon={CheckCircle2}
            tint="success"
            label="Fully arrived"
            value={summary.total_checked_in}
            showProgress={false}
            helper="All family members arrived"
            active={activeUrlFilter === "arrived"}
            onClick={() => handleFilterChipChange("arrived")}
          />
          <StatCard
            icon={Clock}
            tint="warn"
            label="Partially arrived"
            value={summary.total_partial || 0}
            showProgress={false}
            helper="Some family members arrived"
            active={activeUrlFilter === "partially-arrived"}
            onClick={() => handleFilterChipChange("partially-arrived")}
          />
          <StatCard
            icon={AlertCircle}
            iconTone="primary"
            valueTone="primary"
            label="Pending arrival"
            value={summary.total_pending}
            showProgress={false}
            helper="No family members arrived"
            active={activeUrlFilter === "pending"}
            onClick={() => handleFilterChipChange("pending")}
          />
          <StatCard
            icon={UserPlus}
            iconTone="neutral"
            label="Non-registered"
            value={nonRegisteredQuery.data?.summary?.people ?? "—"}
            showProgress={false}
            helper={`${nonRegisteredQuery.data?.summary?.present ?? 0} on-site · ${Math.max(
              0,
              Number(nonRegisteredQuery.data?.summary?.people || 0) -
                Number(nonRegisteredQuery.data?.summary?.present || 0)
            )} departed`}
            active={activeUrlFilter === "non-registered"}
            onClick={() => handleFilterChipChange("non-registered")}
          />
        </section>
      )}

      {/* Sticky Single-Row Toolbar: Search + "+ Add non-registered" Button */}
      <section className="ea-toolbar-row" aria-label="Search evacuee arrivals">
        <div className="ea-search-field">
          <Search size={16} className="ea-search-icon" aria-hidden="true" />
          <input
            type="search"
            className="ea-search-input"
            placeholder="Search by name or family code"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
              setNonRegisteredPage(1);
            }}
            aria-label="Search by name or family code"
          />
          {searchQuery && (
            <button
              type="button"
              className="ea-search-clear"
              onClick={() => {
                setSearchQuery("");
                setCurrentPage(1);
                setNonRegisteredPage(1);
              }}
              aria-label="Clear search"
              title="Clear search"
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>

        <button
          type="button"
          className={`ea-mobile-filter-btn ${selectedCenterId !== "all" ? "has-active" : ""}`}
          onClick={() => {
            setOpMenuOpen(false);
            setBannerMenuOpen(false);
            setOpenMobileRowMenuId(null);
            setDraftCenterId(selectedCenterId);
            setFilterSheetOpen(true);
          }}
          aria-haspopup="dialog"
          aria-expanded={filterSheetOpen}
          aria-label={
            selectedCenterId !== "all"
              ? "Filter by shelter (shelter selected)"
              : "Filter by shelter"
          }
        >
          <SlidersHorizontal size={15} aria-hidden="true" />
          <span>Filter</span>
          {selectedCenterId !== "all" && (
            <span className="ea-filter-dot" aria-hidden="true" />
          )}
        </button>

        <div className="ea-toolbar-actions">
          <AddNonRegisteredButton
            disabled={!canAddNonRegistered}
            onClick={() => setNonRegisteredModal({ kind: "choose" })}
          />
        </div>
      </section>

      {centers.filter((center) => (selectedCenterId === 'all' || String(center.id) === String(selectedCenterId)) && center.capacity_warning).map((center) =>
        <p key={center.id} className={`nre-capacity-warning ${center.capacity_warning === 'Shelter full' ? 'is-full' : ''}`} role="status">
          {center.name}: {center.capacity_warning} · {center.current_occupancy}/{center.capacity} people on-site
        </p>)}
      {nonRegisteredModal && <NonRegisteredModal mode={nonRegisteredModal} centers={centers} centerId={selectedCenterId}
        operation={selectedArrivalOperation} onClose={() => setNonRegisteredModal(null)} onSaved={refreshArrivals} />}

      {/* Evacuee Arrival Table Card (--radius-xl) */}
      <section className="ea-table-card" aria-label="Evacuee arrival list">
        {filterStatus === "non_registered" ? null : isLoading ? (
          <div className="ea-table-wrap" role="status" aria-label="Loading assigned families">
            <table className="ea-table">
              <thead>
                <tr>
                  <th scope="col">FAMILY</th>
                  <th scope="col">ORIGIN BARANGAY</th>
                  <th scope="col">ASSIGNED SHELTER</th>
                  <th scope="col">FAMILY MEMBERS</th>
                  <th scope="col">STATUS</th>
                  <th scope="col" className="ea-th-action">STAFF ACTION</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 6 }).map((_, idx) => (
                  <tr key={idx} className="ea-skel-row" aria-hidden="true">
                    <td>
                      <div className="ea-family-cell">
                        <span className="ea-skel ea-skel-avatar" />
                        <div className="ea-skel-stack">
                          <span className="ea-skel ea-skel-name" />
                          <span className="ea-skel ea-skel-phone" />
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="ea-skel-stack">
                        <span className="ea-skel ea-skel-brgy" />
                        <span className="ea-skel ea-skel-purok" />
                      </div>
                    </td>
                    <td>
                      <div className="ea-skel-stack">
                        <span className="ea-skel ea-skel-shelter" />
                        <span className="ea-skel ea-skel-room" />
                      </div>
                    </td>
                    <td>
                      <span className="ea-skel ea-skel-members" />
                    </td>
                    <td>
                      <span className="ea-skel ea-skel-status" />
                    </td>
                    <td className="ea-td-action">
                      <div className="ea-action-group">
                        <span className="ea-skel ea-skel-btn" />
                        <span className="ea-skel ea-skel-icon-btn" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : error ? (
          <div className="ea-state-box" role="alert">
            <span className="ea-state-icon is-error" aria-hidden="true">
              <AlertTriangle size={22} />
            </span>
            <h3>Unable to load evacuee arrivals</h3>
            <p>{error.message || "Failed to load arrival data."}</p>
            <Button
              variant="secondary"
              onClick={() =>
                queryClient.invalidateQueries({ queryKey: ["evacuee-check-in-list"] })
              }
            >
              Try again
            </Button>
          </div>
        ) : evacuees.length === 0 ? (
          <div className="ea-state-box">
            <span className="ea-state-icon" aria-hidden="true">
              <Users size={22} />
            </span>
            <h3>No families found</h3>
            <p>
              {searchQuery
                ? `No matching families found for "${searchQuery}".`
                : filterStatus === "pending"
                  ? "All assigned families have arrived!"
                  : filterStatus === "partial"
                    ? "No families have partial arrivals right now."
                    : "No families match the current filters."}
            </p>
            <AddNonRegisteredButton
              disabled={!canAddNonRegistered}
              onClick={() => setNonRegisteredModal({ kind: "choose" })}
            />
          </div>
        ) : (
          <>
            {/* Desktop & Tablet Table View */}
            <div className="ea-table-wrap">
              <table className="ea-table">
                <thead>
                  <tr>
                    <th scope="col">FAMILY</th>
                    <th scope="col">ORIGIN BARANGAY</th>
                    <th scope="col">ASSIGNED SHELTER</th>
                    <th scope="col">FAMILY MEMBERS</th>
                    <th scope="col">STATUS</th>
                    <th scope="col" className="ea-th-action">STAFF ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedEvacuees.map((evacuee) => {
                    const isRowLoading = actionLoadingId === evacuee.family_id;
                    const state = evacuee.checkin_state || "none";
                    const isFullyArrived = state === "full";
                    const isPartiallyArrived = state === "partial";
                    const roomBadge = formatRoomBadge(
                      evacuee.building_name,
                      evacuee.room_number,
                      getEvacueeStructureMode(evacuee)
                    );
                    const purokOrAddress = evacuee.purok || evacuee.address || "";

                    return (
                      <tr key={`${evacuee.family_id}-${evacuee.center_id}`} className="ea-table-row">
                        {/* FAMILY */}
                        <td>
                          <div className="ea-family-cell">
                            <span className="ea-avatar" aria-hidden="true">
                              {getInitials(evacuee.head_name)}
                            </span>
                            <div className="ea-family-stack">
                              <span className="ea-family-name">{evacuee.head_name}</span>
                              <span
                                className={`ea-family-phone ${
                                  !evacuee.contact_number ? "is-missing" : ""
                                }`}
                              >
                                {evacuee.contact_number || "Not provided"}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* ORIGIN BARANGAY */}
                        <td>
                          <div className="ea-brgy-stack">
                            <span className="ea-brgy-name">
                              {evacuee.barangay_name || "—"}
                            </span>
                            {purokOrAddress && (
                              <span className="ea-brgy-purok">{purokOrAddress}</span>
                            )}
                          </div>
                        </td>

                        {/* ASSIGNED SHELTER */}
                        <td>
                          <div className="ea-shelter-stack">
                            <span className="ea-shelter-name">{evacuee.center_name}</span>
                            {roomBadge && (
                              <div>
                                <span className="ea-room-chip">{roomBadge}</span>
                              </div>
                            )}
                          </div>
                        </td>

                        {/* FAMILY MEMBERS */}
                        <td>
                          <div className="ea-members-stack">
                            <div>
                              <button
                                type="button"
                                className="ea-members-chip"
                                onClick={() => handleOpenMemberModal(evacuee)}
                                title={
                                  evacuee.special_needs?.length
                                    ? `Tags: ${evacuee.special_needs.join(", ")} (click to view family roster)`
                                    : "Click to view family roster"
                                }
                              >
                                <Users size={13} strokeWidth={2} aria-hidden="true" />
                                <span>
                                  {evacuee.member_count}{" "}
                                  {evacuee.member_count === 1 ? "person" : "people"}
                                </span>
                                {evacuee.checked_in_members > 0 && (
                                  <span className="ea-members-here-badge">
                                    {evacuee.checked_in_members} here
                                  </span>
                                )}
                              </button>
                            </div>
                            {evacuee.special_needs?.length > 0 && (
                              <span
                                className="ea-members-tags"
                                title={`Special Needs: ${evacuee.special_needs.join(", ")}`}
                              >
                                +{evacuee.special_needs.length}{" "}
                                {evacuee.special_needs.length === 1 ? "tag" : "tags"}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* STATUS */}
                        <td>
                          {isFullyArrived ? (
                            <StatusPill
                              variant="arrived"
                              title={
                                evacuee.checked_in_at
                                  ? `Arrival: ${
                                      evacuee.checked_in_at_formatted || evacuee.checked_in_at
                                    }`
                                  : undefined
                              }
                            />
                          ) : isPartiallyArrived ? (
                            <StatusPill
                              variant="partial"
                              label={`${evacuee.checked_in_members} of ${evacuee.member_count} Here`}
                            />
                          ) : (
                            <StatusPill variant="pending-arrival" />
                          )}
                        </td>

                        {/* STAFF ACTION */}
                        <td className="ea-td-action">
                          <div className="ea-action-group">
                            {isHistorical ? (
                              <Button
                                variant="secondary"
                                className="ea-action-btn"
                                onClick={() => handleOpenMemberModal(evacuee)}
                                title="View archived arrival details and family roster"
                                aria-label={`View roster for ${evacuee.head_name}`}
                              >
                                <ListChecks size={15} strokeWidth={2} aria-hidden="true" />
                                <span>View roster</span>
                              </Button>
                            ) : isFullyArrived ? (
                              <>
                                <Button
                                  variant="secondary"
                                  className="ea-action-btn"
                                  onClick={() => handleQuickUndo(evacuee)}
                                  disabled={isRowLoading}
                                  title="Undo arrival for this family"
                                  aria-label={`Undo arrival for ${evacuee.head_name}`}
                                >
                                  {isRowLoading ? (
                                    <Loader2 size={15} className="ea-spin" aria-hidden="true" />
                                  ) : (
                                    <RotateCcw size={15} strokeWidth={2} aria-hidden="true" />
                                  )}
                                  <span>Undo</span>
                                </Button>
                                <button
                                  type="button"
                                  className="ea-manage-icon-btn"
                                  onClick={() => handleOpenMemberModal(evacuee)}
                                  title="Manage individual family members"
                                  aria-label="Manage family members"
                                >
                                  <ListChecks size={16} strokeWidth={2} aria-hidden="true" />
                                </button>
                              </>
                            ) : isPartiallyArrived ? (
                              <>
                                <Button
                                  variant="primary"
                                  className="ea-action-btn"
                                  onClick={() => handleQuickCheckInAll(evacuee)}
                                  disabled={isRowLoading || !canCheckIn}
                                  title={
                                    getCheckInDisabledReason(evacuee) ||
                                    "Mark all remaining family members as arrived"
                                  }
                                  aria-label={`Mark all arrived for ${evacuee.head_name}`}
                                >
                                  {isRowLoading ? (
                                    <Loader2 size={15} className="ea-spin" aria-hidden="true" />
                                  ) : (
                                    <Check size={15} strokeWidth={2.2} aria-hidden="true" />
                                  )}
                                  <span>Mark all arrived</span>
                                </Button>
                                <button
                                  type="button"
                                  className="ea-manage-icon-btn"
                                  onClick={() => handleOpenMemberModal(evacuee)}
                                  disabled={isRowLoading}
                                  title={`Manage family members (${evacuee.checked_in_members}/${evacuee.member_count} here)`}
                                  aria-label="Manage family members"
                                >
                                  <ListChecks size={16} strokeWidth={2} aria-hidden="true" />
                                </button>
                              </>
                            ) : (
                              <>
                                <Button
                                  variant="primary"
                                  className="ea-action-btn"
                                  onClick={() => handleQuickCheckInAll(evacuee)}
                                  disabled={isRowLoading || !canCheckIn}
                                  title={
                                    getCheckInDisabledReason(evacuee) ||
                                    "Mark all members of this family as arrived"
                                  }
                                  aria-label={`Mark all arrived for ${evacuee.head_name}`}
                                >
                                  {isRowLoading ? (
                                    <Loader2 size={15} className="ea-spin" aria-hidden="true" />
                                  ) : (
                                    <Check size={15} strokeWidth={2.2} aria-hidden="true" />
                                  )}
                                  <span>Mark all arrived</span>
                                </Button>
                                <button
                                  type="button"
                                  className="ea-manage-icon-btn"
                                  onClick={() => handleOpenMemberModal(evacuee)}
                                  title="Mark specific family members as arrived"
                                  aria-label="Manage family members"
                                >
                                  <ListChecks size={16} strokeWidth={2} aria-hidden="true" />
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

            {/* Mobile Compact Cards View (Visible on viewports <= 768px) */}
            <div className="ea-mobile-cards-wrap">
              {paginatedEvacuees.map((evacuee) => {
                const isRowLoading = actionLoadingId === evacuee.family_id;
                const state = evacuee.checkin_state || "none";
                const isFullyArrived = state === "full";
                const isPartiallyArrived = state === "partial";
                const rowMenuKey = `${evacuee.family_id}-${evacuee.center_id}`;
                const isMenuOpen = openMobileRowMenuId === rowMenuKey;
                const mobileShelterLine = formatMobileShelterLine(evacuee);

                return (
                  <article key={`mob-${rowMenuKey}`} className="ea-mobile-card">
                    <div className="ea-mobile-card-line1">
                      <button
                        type="button"
                        className="ea-mobile-name-btn"
                        onClick={() => {
                          setOpenMobileRowMenuId(null);
                          handleOpenMemberModal(evacuee);
                        }}
                      >
                        <span className="ea-family-name">{evacuee.head_name}</span>
                      </button>

                      <div className="ea-mobile-right-controls checkin-mobile-menu-anchor">
                        {isFullyArrived ? (
                          <StatusPill variant="arrived" />
                        ) : isPartiallyArrived ? (
                          <StatusPill
                            variant="partial"
                            label={`${evacuee.checked_in_members}/${evacuee.member_count} Here`}
                          />
                        ) : (
                          <StatusPill variant="pending-arrival" />
                        )}

                        <button
                          type="button"
                          className="ea-manage-icon-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpMenuOpen(false);
                            setBannerMenuOpen(false);
                            setOpenMobileRowMenuId((prev) =>
                              prev === rowMenuKey ? null : rowMenuKey
                            );
                          }}
                          aria-label={`Actions for ${evacuee.head_name}`}
                          aria-expanded={isMenuOpen}
                          aria-haspopup="menu"
                        >
                          {isRowLoading ? (
                            <Loader2 size={15} className="ea-spin" aria-hidden="true" />
                          ) : (
                            <MoreVertical size={16} aria-hidden="true" />
                          )}
                        </button>

                        {isMenuOpen && (
                          <div className="ea-select-menu ea-mobile-row-menu" role="menu">
                            {isHistorical ? (
                              <button
                                type="button"
                                role="menuitem"
                                className="ea-select-option"
                                onClick={() => {
                                  setOpenMobileRowMenuId(null);
                                  handleOpenMemberModal(evacuee);
                                }}
                              >
                                <span className="ea-select-option-main">
                                  <ListChecks size={15} aria-hidden="true" />
                                  <span>View roster</span>
                                </span>
                              </button>
                            ) : (
                              <>
                                {!isFullyArrived && (
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="ea-select-option is-primary"
                                    disabled={isRowLoading || !canCheckIn}
                                    title={getCheckInDisabledReason(evacuee) || undefined}
                                    onClick={() => {
                                      setOpenMobileRowMenuId(null);
                                      handleQuickCheckInAll(evacuee);
                                    }}
                                  >
                                    <span className="ea-select-option-main">
                                      <Check size={15} aria-hidden="true" />
                                      <span>Mark all arrived</span>
                                    </span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="ea-select-option"
                                  onClick={() => {
                                    setOpenMobileRowMenuId(null);
                                    handleOpenMemberModal(evacuee);
                                  }}
                                >
                                  <span className="ea-select-option-main">
                                    <ListChecks size={15} aria-hidden="true" />
                                    <span>Manage family members</span>
                                  </span>
                                </button>
                                {(isFullyArrived || isPartiallyArrived) && (
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="ea-select-option"
                                    disabled={isRowLoading}
                                    onClick={() => {
                                      setOpenMobileRowMenuId(null);
                                      handleQuickUndo(evacuee);
                                    }}
                                  >
                                    <span className="ea-select-option-main">
                                      <RotateCcw size={15} aria-hidden="true" />
                                      <span>Undo</span>
                                    </span>
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="ea-mobile-card-line2">
                      {evacuee.barangay_name && (
                        <>
                          <span>{evacuee.barangay_name}</span>
                          <span aria-hidden="true">·</span>
                        </>
                      )}
                      <span>
                        {evacuee.member_count}{" "}
                        {evacuee.member_count === 1 ? "person" : "people"}
                      </span>
                    </div>

                    {mobileShelterLine && (
                      <div className="ea-mobile-card-line3">{mobileShelterLine}</div>
                    )}
                  </article>
                );
              })}
            </div>

            {/* Pagination Footer */}
            {totalCount > 0 && (
              <footer className="ea-table-footer" aria-label="Evacuee list pagination">
                <div className="ea-footer-info">
                  Showing <strong>{startIndex + 1}</strong> to <strong>{endIndex}</strong> of{" "}
                  <strong>{totalCount}</strong>
                </div>

                <div className="ea-footer-controls">
                  <label className="ea-rows-per-page">
                    <span>Rows:</span>
                    <select
                      className="ea-rows-select"
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setCurrentPage(1);
                      }}
                      aria-label="Select number of evacuee rows per page"
                    >
                      <option value={10}>10</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                    </select>
                  </label>

                  <Pagination
                    currentPage={safeCurrentPage}
                    totalPages={totalPages}
                    onPageChange={(nextPage) => setCurrentPage(nextPage)}
                  />
                </div>
              </footer>
            )}
          </>
        )}
        {filterStatus === 'non_registered' && <NonRegisteredGroups
          result={nonRegisteredQuery.data} loading={nonRegisteredQuery.isLoading} error={nonRegisteredQuery.error} retry={nonRegisteredQuery.refetch}
          status={nonRegisteredStatus} setStatus={setNonRegisteredStatus} page={nonRegisteredPage} setPage={setNonRegisteredPage}
          canEdit={canAddNonRegistered} isAdmin={isAdmin} onChanged={refreshArrivals}
          onEdit={(person, group) => setNonRegisteredModal({ kind: 'edit', person, group })}
          onAdd={() => setNonRegisteredModal({ kind: 'create' })} addDisabled={!canAddNonRegistered} />}
      </section>

      {/* Member Checklist Modal (For Partial / Individual Arrival) */}
      {modalFamily && (() => {
        const modalMembers = Array.isArray(modalFamily.members) ? modalFamily.members : [];
        const totalModalMembers = modalMembers.length || Number(modalFamily.member_count || 0);
        const savedPresentIds = new Set(
          modalMembers.filter((m) => Boolean(m.is_checked_in)).map((m) => m.id)
        );
        const isSameAsSaved =
          selectedMemberIds.size === savedPresentIds.size &&
          Array.from(selectedMemberIds).every((id) => savedPresentIds.has(id));
        const isAllAlreadySavedPresent =
          totalModalMembers > 0 &&
          savedPresentIds.size === totalModalMembers &&
          selectedMemberIds.size === totalModalMembers;

        return (
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
                <span className="checkin-modal-tag">Family Arrival Checklist</span>
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
                <strong>{totalModalMembers}</strong> members {isHistorical ? "arrived during event" : "present"}
              </div>
              {!isHistorical && (
                <div className="checkin-modal-quick-btns">
                  <button
                    type="button"
                    className="checkin-modal-quick-btn"
                    onClick={handleSelectAllMembers}
                    disabled={totalModalMembers > 0 && selectedMemberIds.size === totalModalMembers}
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    className="checkin-modal-quick-btn"
                    onClick={handleClearAllMembers}
                    disabled={selectedMemberIds.size === 0}
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
                <div className="ea-modal-empty-members">
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
                    disabled={
                      actionLoadingId === modalFamily.family_id ||
                      isSameAsSaved ||
                      (!canCheckIn && selectedMemberIds.size > 0)
                    }
                    title={
                      !canCheckIn && selectedMemberIds.size > 0
                        ? getCheckInDisabledReason(modalFamily)
                        : isAllAlreadySavedPresent
                          ? "All family members are already marked present"
                          : isSameAsSaved
                            ? "No changes to save"
                            : undefined
                    }
                  >
                    {actionLoadingId === modalFamily.family_id ? (
                      <>
                        <FontAwesomeIcon icon={faSpinner} spin />
                        <span>Saving...</span>
                      </>
                    ) : isAllAlreadySavedPresent ? (
                      <span>All Present ({selectedMemberIds.size} Present)</span>
                    ) : selectedMemberIds.size === 0 ? (
                      <span>Mark All Absent (Undo)</span>
                    ) : selectedMemberIds.size === totalModalMembers ? (
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
        );
      })()}

      {/* Manage Evacuation Operation Modal */}
      {showManageOpModal && (
        <div
          className="checkin-modal-backdrop"
          onClick={() => !savingSchedule && setShowManageOpModal(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="manage-op-modal-title"
        >
          <div
            className="checkin-modal-card checkin-op-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="checkin-modal-header">
              <div className="checkin-modal-title-wrap">
                <FontAwesomeIcon icon={faGear} className="checkin-op-header-icon" />
                <div>
                  <h3 id="manage-op-modal-title" className="checkin-op-modal-title">
                    Manage Operation
                  </h3>
                  <span className="checkin-op-modal-sub">
                    Update active event name, scope, status, or conclude to archive
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="checkin-modal-close"
                onClick={() => setShowManageOpModal(false)}
                disabled={savingSchedule}
                aria-label="Close Manage Operation modal"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            {pendingOpConfirm === "manage-conclude" ? (
              <div className="checkin-op-form">
                <div className="checkin-modal-body checkin-op-confirm-body">
                  <div className="checkin-op-confirm-box is-archive">
                    <FontAwesomeIcon icon={faBoxArchive} />
                    <div>
                      <strong>Conclude &amp; Save to Archive?</strong>
                      <p>
                        Concluding &ldquo;{scheduleEventName.trim()}&rdquo; pauses arrivals and saves current records into historical archives.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="checkin-modal-footer">
                  <button
                    type="button"
                    className="checkin-modal-btn is-secondary"
                    onClick={() => setPendingOpConfirm(null)}
                    disabled={savingSchedule}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    className="checkin-modal-btn is-primary"
                    onClick={() => handleSaveOperation("manage", true)}
                    disabled={savingSchedule}
                  >
                    {savingSchedule && <FontAwesomeIcon icon={faSpinner} spin />}
                    <span>{savingSchedule ? "Saving..." : "Confirm Conclude & Archive"}</span>
                  </button>
                </div>
              </div>
            ) : (
              <form
                noValidate
                className="checkin-op-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSaveOperation("manage", false);
                }}
              >
                <div className="checkin-modal-body checkin-op-modal-body">
                  <div className="checkin-form-group">
                    <label htmlFor="manage-op-name" className="checkin-form-label">
                      Operation / Event Name <span className="checkin-required-star">*</span>
                    </label>
                    <input
                      id="manage-op-name"
                      type="text"
                      className={`checkin-form-input ${scheduleEventNameError ? "has-error" : ""}`}
                      placeholder="e.g. Pre-emptive Evacuation"
                      value={scheduleEventName}
                      onChange={(e) => {
                        setScheduleEventName(e.target.value);
                        if (scheduleEventNameError && e.target.value.trim()) {
                          setScheduleEventNameError("");
                        }
                      }}
                      disabled={savingSchedule}
                    />
                    {scheduleEventNameError && (
                      <p className="checkin-field-error" role="alert">
                        {scheduleEventNameError}
                      </p>
                    )}
                  </div>

                  <div className="checkin-form-group">
                    <label htmlFor="manage-op-scope" className="checkin-form-label">
                      Target Shelter Scope
                    </label>
                    <select
                      id="manage-op-scope"
                      className="checkin-form-input"
                      value={scheduleCenterId}
                      onChange={(e) => setScheduleCenterId(e.target.value)}
                      disabled={savingSchedule}
                    >
                      <option value="all">
                        All Evacuation Centers ({centers.length} facilities)
                      </option>
                      {centers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="checkin-form-group">
                    <label className="checkin-form-label">Operational Status</label>
                    <div
                      className="checkin-status-segmented"
                      role="radiogroup"
                      aria-label="Operational Status"
                    >
                      <button
                        type="button"
                        role="radio"
                        aria-checked={scheduleStatus === "open"}
                        className={`checkin-segment-btn is-open ${scheduleStatus === "open" ? "is-active" : ""}`}
                        onClick={() => setScheduleStatus("open")}
                        disabled={savingSchedule}
                      >
                        <span className="checkin-seg-dot open" />
                        <span>Open</span>
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={scheduleStatus === "standby"}
                        className={`checkin-segment-btn is-standby ${scheduleStatus === "standby" ? "is-active" : ""}`}
                        onClick={() => setScheduleStatus("standby")}
                        disabled={savingSchedule}
                      >
                        <span className="checkin-seg-dot standby" />
                        <span>Standby</span>
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={scheduleStatus === "closed"}
                        className={`checkin-segment-btn is-closed ${scheduleStatus === "closed" ? "is-active" : ""}`}
                        onClick={() => setScheduleStatus("closed")}
                        disabled={savingSchedule}
                        aria-label="Conclude & Save to Archive"
                      >
                        <span className="checkin-seg-dot closed" />
                        <span>Conclude &amp; Archive</span>
                      </button>
                    </div>
                  </div>

                  {scheduleStatus !== "closed" ? (
                    <div className="checkin-window-compact">
                      <div className="checkin-window-col">
                        <label className="checkin-form-label-sm">Opening Date &amp; Time</label>
                        <div className="checkin-date-time-pair">
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
                          />
                          <input
                            type="time"
                            className="checkin-form-input checkin-time-input"
                            value={scheduleOpenTime}
                            onChange={(e) => setScheduleOpenTime(e.target.value)}
                            disabled={savingSchedule}
                          />
                        </div>
                      </div>

                      <div className="checkin-window-col">
                        <label className="checkin-form-label-sm">Expected Target (Advisory)</label>
                        <div className="checkin-date-time-pair">
                          <input
                            type="date"
                            className="checkin-form-input"
                            value={scheduleCutoffDate}
                            onChange={(e) => setScheduleCutoffDate(e.target.value)}
                            disabled={savingSchedule}
                          />
                          <input
                            type="time"
                            className="checkin-form-input checkin-time-input"
                            value={scheduleCutoffTime}
                            onChange={(e) => setScheduleCutoffTime(e.target.value)}
                            disabled={savingSchedule}
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="checkin-op-short-notice is-archive">
                      <FontAwesomeIcon icon={faBoxArchive} />
                      <span>Shelters will stand down and records will be saved to history.</span>
                    </div>
                  )}
                </div>

                <div className="checkin-modal-footer">
                  <button
                    type="button"
                    className="checkin-modal-btn is-secondary"
                    onClick={() => setShowManageOpModal(false)}
                    disabled={savingSchedule}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="checkin-modal-btn is-primary"
                    disabled={savingSchedule}
                  >
                    {savingSchedule && <FontAwesomeIcon icon={faSpinner} spin />}
                    <span>
                      {savingSchedule
                        ? "Saving..."
                        : scheduleStatus === "closed"
                          ? "Conclude & Save to Archive"
                          : "Save Changes"}
                    </span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Start New Evacuation Operation Modal */}
      {showNewOpModal && (
        <div
          className="checkin-modal-backdrop"
          onClick={() => !savingSchedule && setShowNewOpModal(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-op-modal-title"
        >
          <div
            className="checkin-modal-card checkin-op-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="checkin-modal-header">
              <div className="checkin-modal-title-wrap">
                <FontAwesomeIcon icon={faBolt} className="checkin-op-header-icon" />
                <div>
                  <h3 id="new-op-modal-title" className="checkin-op-modal-title">
                    New Operation
                  </h3>
                  <span className="checkin-op-modal-sub">
                    Begin a fresh evacuation operation for a new event
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="checkin-modal-close"
                onClick={() => setShowNewOpModal(false)}
                disabled={savingSchedule}
                aria-label="Close New Operation modal"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            {pendingOpConfirm === "new-operation" ? (
              <div className="checkin-op-form">
                <div className="checkin-modal-body checkin-op-confirm-body">
                  <div className="checkin-op-confirm-box is-new">
                    <FontAwesomeIcon icon={faBolt} />
                    <div>
                      <strong>Start New Operation?</strong>
                      <p>
                        &ldquo;{effectiveSchedule?.evacuation_event_name || "Current Operation"}&rdquo; will be archived and all shelter arrival counts will reset to 0 for &ldquo;{scheduleEventName.trim()}&rdquo;.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="checkin-modal-footer">
                  <button
                    type="button"
                    className="checkin-modal-btn is-secondary"
                    onClick={() => setPendingOpConfirm(null)}
                    disabled={savingSchedule}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    className="checkin-modal-btn is-primary"
                    onClick={() => handleSaveOperation("new", true)}
                    disabled={savingSchedule}
                  >
                    {savingSchedule && <FontAwesomeIcon icon={faSpinner} spin />}
                    <span>{savingSchedule ? "Starting..." : "Confirm Start Operation"}</span>
                  </button>
                </div>
              </div>
            ) : (
              <form
                noValidate
                className="checkin-op-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSaveOperation("new", false);
                }}
              >
                <div className="checkin-modal-body checkin-op-modal-body">
                  <div className="checkin-op-short-notice is-new">
                    <FontAwesomeIcon icon={faBoxArchive} />
                    <span>Archives the current event and resets arrival counts to 0.</span>
                  </div>

                  <div className="checkin-form-group">
                    <label htmlFor="new-op-name" className="checkin-form-label">
                      Operation / Event Name <span className="checkin-required-star">*</span>
                    </label>
                    <input
                      id="new-op-name"
                      type="text"
                      className={`checkin-form-input ${scheduleEventNameError ? "has-error" : ""}`}
                      placeholder="e.g. Typhoon Kristine Evacuation"
                      value={scheduleEventName}
                      onChange={(e) => {
                        setScheduleEventName(e.target.value);
                        if (scheduleEventNameError && e.target.value.trim()) {
                          setScheduleEventNameError("");
                        }
                      }}
                      disabled={savingSchedule}
                    />
                    {scheduleEventNameError && (
                      <p className="checkin-field-error" role="alert">
                        {scheduleEventNameError}
                      </p>
                    )}
                  </div>

                  <div className="checkin-form-group">
                    <label htmlFor="new-op-scope" className="checkin-form-label">
                      Target Shelter Scope
                    </label>
                    <select
                      id="new-op-scope"
                      className="checkin-form-input"
                      value={scheduleCenterId}
                      onChange={(e) => setScheduleCenterId(e.target.value)}
                      disabled={savingSchedule}
                    >
                      <option value="all">
                        All Evacuation Centers ({centers.length} facilities)
                      </option>
                      {centers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="checkin-form-group">
                    <label className="checkin-form-label">Initial Status</label>
                    <div
                      className="checkin-status-segmented is-two"
                      role="radiogroup"
                      aria-label="Initial Status"
                    >
                      <button
                        type="button"
                        role="radio"
                        aria-checked={scheduleStatus === "open"}
                        className={`checkin-segment-btn is-open ${scheduleStatus === "open" ? "is-active" : ""}`}
                        onClick={() => setScheduleStatus("open")}
                        disabled={savingSchedule}
                      >
                        <span className="checkin-seg-dot open" />
                        <span>Open</span>
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={scheduleStatus === "standby"}
                        className={`checkin-segment-btn is-standby ${scheduleStatus === "standby" ? "is-active" : ""}`}
                        onClick={() => setScheduleStatus("standby")}
                        disabled={savingSchedule}
                      >
                        <span className="checkin-seg-dot standby" />
                        <span>Standby</span>
                      </button>
                    </div>
                  </div>

                  <div className="checkin-window-compact">
                    <div className="checkin-window-col">
                      <label className="checkin-form-label-sm">Opening Date &amp; Time</label>
                      <div className="checkin-date-time-pair">
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
                        />
                        <input
                          type="time"
                          className="checkin-form-input checkin-time-input"
                          value={scheduleOpenTime}
                          onChange={(e) => setScheduleOpenTime(e.target.value)}
                          disabled={savingSchedule}
                        />
                      </div>
                    </div>

                    <div className="checkin-window-col">
                      <label className="checkin-form-label-sm">Expected Target (Optional)</label>
                      <div className="checkin-date-time-pair">
                        <input
                          type="date"
                          className="checkin-form-input"
                          value={scheduleCutoffDate}
                          onChange={(e) => setScheduleCutoffDate(e.target.value)}
                          disabled={savingSchedule}
                        />
                        <input
                          type="time"
                          className="checkin-form-input checkin-time-input"
                          value={scheduleCutoffTime}
                          onChange={(e) => setScheduleCutoffTime(e.target.value)}
                          disabled={savingSchedule}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="checkin-modal-footer">
                  <button
                    type="button"
                    className="checkin-modal-btn is-secondary"
                    onClick={() => setShowNewOpModal(false)}
                    disabled={savingSchedule}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="checkin-modal-btn is-primary"
                    disabled={savingSchedule}
                  >
                    {savingSchedule && <FontAwesomeIcon icon={faSpinner} spin />}
                    <span>{savingSchedule ? "Starting..." : "Start New Operation"}</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Quick Extension Modal */}
      {showExtendModal && (
        <div
          className="checkin-modal-backdrop"
          onClick={() => !extendingSchedule && setShowExtendModal(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="extend-modal-title"
        >
          <div
            className="checkin-modal-card ea-extend-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="checkin-modal-header">
              <div className="checkin-modal-title-wrap">
                <FontAwesomeIcon icon={faClock} className="ea-extend-icon" />
                <h3 id="extend-modal-title">Extend Evacuation Arrival Window</h3>
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

            <div className="checkin-modal-body ea-extend-body">
              <p className="ea-extend-desc">
                Prolong the allowed arrival window for evacuees. Once extended, arrival controls will immediately reactivate so staff can continue recording arrivals.
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
                <div className="ea-extend-custom-grid">
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

              <div className="checkin-modal-footer ea-extend-footer">
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
                  {extendingSchedule && <FontAwesomeIcon icon={faSpinner} spin className="ea-spin-gap" />}
                  {extendingSchedule ? "Extending Deadline..." : "Confirm Extension"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Shelter Filter Bottom Sheet */}
      {filterSheetOpen && (
        <div
          className="checkin-filter-sheet-backdrop"
          onClick={() => setFilterSheetOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="checkin-filter-sheet-title"
        >
          <div
            className="checkin-filter-sheet"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="checkin-filter-sheet-handle" aria-hidden="true" />

            <div className="checkin-filter-sheet-header">
              <h2 id="checkin-filter-sheet-title">Filter by Shelter</h2>
              <button
                type="button"
                className="checkin-modal-close-btn"
                onClick={() => setFilterSheetOpen(false)}
                aria-label="Close shelter filter"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            <div className="checkin-filter-sheet-list" role="listbox" aria-label="Evacuation centers">
              <button
                type="button"
                role="option"
                aria-selected={draftCenterId === "all"}
                className={`checkin-filter-sheet-option ${draftCenterId === "all" ? "is-selected" : ""}`}
                onClick={() => setDraftCenterId("all")}
              >
                <span className="checkin-filter-sheet-option-main">
                  <span className="checkin-filter-sheet-option-name">All Shelters</span>
                  <span className="checkin-filter-sheet-option-count">({centers.length})</span>
                </span>
                {draftCenterId === "all" && (
                  <FontAwesomeIcon icon={faCheck} className="checkin-filter-sheet-check" />
                )}
              </button>

              {centers.map((c) => {
                const isSelected = String(draftCenterId) === String(c.id);
                return (
                  <button
                    key={`sheet-center-${c.id}`}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`checkin-filter-sheet-option ${isSelected ? "is-selected" : ""}`}
                    onClick={() => setDraftCenterId(String(c.id))}
                  >
                    <span className="checkin-filter-sheet-option-main">
                      <span className="checkin-filter-sheet-option-name">{c.name}</span>
                      <span className="checkin-filter-sheet-option-count">
                        ({c.checked_in}/{c.assigned})
                      </span>
                    </span>
                    {isSelected && (
                      <FontAwesomeIcon icon={faCheck} className="checkin-filter-sheet-check" />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="checkin-filter-sheet-footer">
              <button
                type="button"
                className="checkin-filter-sheet-btn is-reset"
                onClick={() => {
                  setDraftCenterId("all");
                  setSelectedCenterId("all");
                  setCurrentPage(1);
                  setFilterSheetOpen(false);
                }}
              >
                Reset
              </button>
              <button
                type="button"
                className="checkin-filter-sheet-btn is-apply"
                onClick={() => {
                  setSelectedCenterId(draftCenterId);
                  setCurrentPage(1);
                  setFilterSheetOpen(false);
                }}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

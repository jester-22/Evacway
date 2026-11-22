import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Info,
  Layers,
  Loader2,
  Mail,
  Pencil,
  Search,
  Unlink,
  UserCheck,
  UserPlus,
  X,
  XCircle,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../services/api";
import { queryKeys, useBarangays } from "../../hooks/useEvacuationQueries";
import { formatManilaDate } from "../../utils/dateTime";
import { Button, StatCard, StatusPill } from "../ui";
import CreateResidentAccountModal from "./CreateResidentAccountModal";
import "./ResidentRegistrations.css";

const VALID_STATUS_FILTERS = ["all", "pending", "approved", "rejected"];

const COMPARISON_FIELDS = [
  { id: "name", label: "Full name", flag: "name", format: (record) => record.full_name || joinName(record) },
  { id: "birthdate", label: "Birthdate", flag: "birthdate", format: (record) => record.birthdate || "Not provided" },
  { id: "barangay", label: "Barangay", flag: "barangay", format: (record) => record.barangay || "Not provided" },
  { id: "address", label: "Address / purok", flag: "address", format: (record) => record.address || "Not provided" },
  { id: "contact_number", label: "Contact number", flag: "contact_number", format: (record) => record.contact_number || "Not provided" },
];
const NAME_FIELD = COMPARISON_FIELDS[0];
const BARANGAY_FIELD = COMPARISON_FIELDS[2];

function joinName(record) {
  return [record.first_name, record.middle_name, record.last_name].filter(Boolean).join(" ");
}

function normalizedName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getLocalYesterdayIso() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDate(value) {
  if (!value) return "Not provided";
  return formatManilaDate(value, { dateStyle: "medium" }, value);
}

function getRosterRecord(resident) {
  const alreadyLinked = Boolean(resident.already_linked);
  return {
    id: resident.id,
    first_name: resident.first_name,
    middle_name: resident.middle_name,
    last_name: resident.last_name,
    full_name: resident.full_name || joinName(resident),
    birthdate: resident.birthdate || resident.date_of_birth || null,
    barangay: resident.barangay,
    address: resident.address,
    contact_number: resident.contact_number,
    match_flags: {},
    already_linked: alreadyLinked,
    available: !alreadyLinked,
  };
}

function normalizeContact(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("63") && digits.length === 12) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);
  return digits;
}

function getMatchResident(match) {
  return match?.resident || match || {};
}

function getMatchResidentId(match) {
  return getMatchResident(match)?.id ?? null;
}

function getComparisonValue(record, field) {
  if (!record) return "Not provided";
  if (field.id === "name") return record.full_name || joinName(record) || "Not provided";
  if (field.id === "birthdate") return formatDate(record.birthdate);
  return record[field.id] || "Not provided";
}

function isFieldMatched(request, match, field) {
  if (match?.match_flags && typeof match.match_flags[field.flag] === "boolean") {
    return match.match_flags[field.flag];
  }
  const roster = getMatchResident(match);
  if (field.id === "name") {
    return normalizedName(request.full_name || joinName(request)) === normalizedName(roster.full_name || joinName(roster));
  }
  if (field.id === "birthdate") {
    return Boolean(request.birthdate && roster.birthdate && String(request.birthdate) === String(roster.birthdate));
  }
  if (field.id === "contact_number") {
    const left = normalizeContact(request.contact_number);
    const right = normalizeContact(roster.contact_number);
    return Boolean(left && right && left === right);
  }
  const left = normalizedName(request[field.id]);
  const right = normalizedName(roster[field.id]);
  return Boolean(left && right && left === right);
}

function allFieldsMatch(request, match) {
  if (!request || !match) return false;
  return COMPARISON_FIELDS.every((field) => isFieldMatched(request, match, field));
}

function matchesAutosuggestRecord(resident, suggestion) {
  const suggestionName = normalizedName(suggestion.name);
  const residentNames = [
    resident.full_name,
    joinName(resident),
    resident.household_head_name,
  ].map(normalizedName);
  return (
    residentNames.includes(suggestionName)
    && normalizedName(resident.barangay) === normalizedName(suggestion.barangay)
  );
}

export default function ResidentRegistrations({ focusRegistrationId = null }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const queryClient = useQueryClient();
  const barangaysQuery = useBarangays();
  const barangayOptions = useMemo(() => {
    const raw = Array.isArray(barangaysQuery.data) ? barangaysQuery.data : [];
    return raw
      .map((item) => (typeof item === "string" ? item : item?.name || ""))
      .filter(Boolean);
  }, [barangaysQuery.data]);
  const [searchParams, setSearchParams] = useSearchParams();
  const rawFilter = String(searchParams.get("filter") || "all").toLowerCase();
  const activeStatus = VALID_STATUS_FILTERS.includes(rawFilter) ? rawFilter : "all";
  const [search, setSearch] = useState("");
  const [requests, setRequests] = useState([]);
  const [allRequests, setAllRequests] = useState([]);
  const [counts, setCounts] = useState({ all: 0, pending: 0, approved: 0, rejected: 0 });
  const handledFocusIdRef = useRef(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [matchResult, setMatchResult] = useState(null);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchError, setMatchError] = useState("");
  const [matchRetryKey, setMatchRetryKey] = useState(0);
  const [selectedResident, setSelectedResident] = useState(null);
  const [manualSearch, setManualSearch] = useState("");
  const [manualResults, setManualResults] = useState([]);
  const [manualLoading, setManualLoading] = useState(false);
  const [manualError, setManualError] = useState("");
  const [confirmModal, setConfirmModal] = useState(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState("");
  const [decisionResult, setDecisionResult] = useState(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetCooldowns, setResetCooldowns] = useState({});
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [editForm, setEditForm] = useState({
    first_name: "",
    middle_name: "",
    last_name: "",
    birthdate: "",
    barangay: "",
    address: "",
    contact_number: "",
    email: "",
  });

  // Manual account modal, pagination & toast notification state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [toast, setToast] = useState(null);

  const dialogRef = useRef(null);
  const confirmOverlayRef = useRef(null);
  const lastActiveRowRef = useRef(null);
  const listRequestRef = useRef(0);
  const listScrollRef = useRef(null);
  const actionLockRef = useRef(false);
  const resetLockRef = useRef(false);

  const showToast = useCallback((message, type = "success") => {
    setToast({ id: Date.now(), message, type });
  }, []);

  // Auto-dismiss floating toast after 4.5 seconds
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => {
      setToast(null);
    }, 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const refreshList = useCallback(async () => {
    const requestNumber = ++listRequestRef.current;
    setListLoading(true);
    setListError("");
    try {
      const [filtered, all] = await Promise.all([
        api.getResidentRegistrations({ status: activeStatus, search }),
        api.getResidentRegistrations({ status: "all" }),
      ]);
      if (requestNumber !== listRequestRef.current) return;
      setRequests(filtered.requests || []);
      setAllRequests(all.requests || []);
      const nextCounts = { all: 0, pending: 0, approved: 0, rejected: 0 };
      (all.requests || []).forEach((item) => {
        nextCounts.all += 1;
        if (Object.hasOwn(nextCounts, item.status)) nextCounts[item.status] += 1;
      });
      setCounts(nextCounts);
    } catch (error) {
      if (requestNumber === listRequestRef.current) {
        setRequests([]);
        setListError(error.message || "Resident registrations could not be loaded.");
      }
    } finally {
      if (requestNumber === listRequestRef.current) setListLoading(false);
    }
  }, [activeStatus, search]);

  useEffect(() => {
    const timer = window.setTimeout(refreshList, search ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [refreshKey, refreshList, search]);

  const handleStatusFilterChange = useCallback(
    (nextStatus) => {
      const safeStatus = VALID_STATUS_FILTERS.includes(nextStatus) ? nextStatus : "all";
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("filter", safeStatus);
          return next;
        },
        { replace: true }
      );
      setPage(1);
    },
    [setSearchParams]
  );

  useEffect(() => {
    if (focusRegistrationId == null) {
      handledFocusIdRef.current = null;
      return undefined;
    }
    if (handledFocusIdRef.current === String(focusRegistrationId)) return undefined;
    const match = allRequests.find(
      (item) => String(item.id) === String(focusRegistrationId)
    );
    if (!match) return undefined;
    handledFocusIdRef.current = String(focusRegistrationId);
    const timer = window.setTimeout(() => {
      if (match.status && match.status !== activeStatus) {
        handleStatusFilterChange(match.status);
      }
      openReview(match);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [focusRegistrationId, allRequests, activeStatus, handleStatusFilterChange]);

  useEffect(() => {
    if (!selectedRequest) return undefined;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();

    api.clearNotificationsByResource("resident_registration", selectedRequest.id)
      .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.notifications }))
      .catch(() => {});

    let active = true;
    api.getResidentRegistrationMatches(selectedRequest.id)
      .then(async (result) => {
        if (!active) return;
        let nextResult = result;
        const linkedId = selectedRequest.matched_resident_id;
        const apiMatches = result?.matches || [];
        const hasLinkedInMatches =
          linkedId != null &&
          apiMatches.some((item) => getMatchResidentId(item) === linkedId);

        if (
          selectedRequest.status === "approved" &&
          linkedId != null &&
          !hasLinkedInMatches
        ) {
          try {
            const allResidents = await api.getResidents();
            if (!active) return;
            const linkedResident = (Array.isArray(allResidents) ? allResidents : []).find(
              (r) => String(r.id) === String(linkedId)
            );
            if (linkedResident) {
              const linkedRecord = {
                ...getRosterRecord(linkedResident),
                already_linked: true,
                available: false,
              };
              nextResult = {
                ...result,
                status: "match",
                matches: [linkedRecord, ...apiMatches],
              };
            }
          } catch {
            // Fall back to showing matched_resident_id in the banner
          }
        }

        if (!active) return;
        setMatchResult(nextResult);
        const available = (nextResult.matches || []).filter((item) => item.available);
        if (nextResult.status === "match" && available.length === 1) {
          setSelectedResident(available[0]);
        }
      })
      .catch((error) => {
        if (active) setMatchError(error.message || "Resident matching could not be completed.");
      })
      .finally(() => {
        if (active) setMatchLoading(false);
      });

    return () => { active = false; };
  }, [selectedRequest, matchRetryKey, queryClient]);

  const visibleRequests = useMemo(() => requests, [requests]);
  const totalFiltered = visibleRequests.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safePage = Math.min(page, totalPages);

  const paginatedRequests = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return visibleRequests.slice(start, start + pageSize);
  }, [visibleRequests, safePage, pageSize]);

  useEffect(() => {
    if (listScrollRef.current) {
      listScrollRef.current.scrollTop = 0;
    }
  }, [page, pageSize, activeStatus]);

  // Explicit keyboard Tab focus-trap and Escape close for Review Modal & Confirm Dialog
  useEffect(() => {
    if (!selectedRequest) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        if (confirmModal) {
          event.preventDefault();
          event.stopPropagation();
          if (!actionLoading && !resetLoading) {
            setConfirmModal(null);
          }
          return;
        }
        if (actionLoading || resetLoading) {
          event.preventDefault();
        }
        return;
      }

      if (event.key === "Tab") {
        const container = confirmModal ? confirmOverlayRef.current : dialogRef.current;
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
          if (document.activeElement === first || !container.contains(document.activeElement)) {
            event.preventDefault();
            last.focus();
          }
        } else if (document.activeElement === last || !container.contains(document.activeElement)) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedRequest, confirmModal, actionLoading, resetLoading]);

  const activeCooldownExpiresAt = selectedRequest ? resetCooldowns[selectedRequest.id] || 0 : 0;
  useEffect(() => {
    if (!activeCooldownExpiresAt || activeCooldownExpiresAt <= Date.now()) {
      return undefined;
    }
    const tick = window.setInterval(() => {
      const currentNow = Date.now();
      setNowMs(currentNow);
      if (currentNow >= activeCooldownExpiresAt) {
        window.clearInterval(tick);
      }
    }, 1000);
    return () => window.clearInterval(tick);
  }, [activeCooldownExpiresAt]);

  function closeReview() {
    if (actionLoading || resetLoading || editSaving) return;
    dialogRef.current?.close();
  }

  function handleDialogClose() {
    setSelectedRequest(null);
    setMatchResult(null);
    setSelectedResident(null);
    setManualResults([]);
    setDecisionResult(null);
    setConfirmModal(null);
    setOverrideReason("");
    setActionError("");
    setIsEditingInfo(false);
    setEditError("");
    window.setTimeout(() => {
      if (lastActiveRowRef.current && typeof lastActiveRowRef.current.focus === "function") {
        lastActiveRowRef.current.focus();
      }
    }, 30);
  }

  function openReview(registration, options = {}) {
    if (options.triggerEl) {
      lastActiveRowRef.current = options.triggerEl;
    }
    setMatchResult(null);
    setSelectedResident(null);
    setMatchError("");
    setMatchLoading(true);
    setActionError("");
    setMatchRetryKey(0);
    setDecisionResult(null);
    setManualSearch("");
    setManualResults([]);
    setManualError("");
    setConfirmModal(options.openReject ? "reject" : null);
    setOverrideReason("");
    setRejectionReason("");
    setIsEditingInfo(false);
    setEditError("");
    setSelectedRequest(registration);
  }

  function startEditingInfo() {
    if (!selectedRequest) return;
    setEditForm({
      first_name: selectedRequest.first_name || "",
      middle_name: selectedRequest.middle_name || "",
      last_name: selectedRequest.last_name || "",
      birthdate: selectedRequest.birthdate ? String(selectedRequest.birthdate).slice(0, 10) : "",
      barangay: selectedRequest.barangay || "",
      address: selectedRequest.address || "",
      contact_number: selectedRequest.contact_number || "",
      email: selectedRequest.account_email || selectedRequest.email || "",
    });
    setEditError("");
    setIsEditingInfo(true);
  }

  function cancelEditingInfo() {
    if (editSaving) return;
    setIsEditingInfo(false);
    setEditError("");
  }

  async function saveRegistrationEdit(event) {
    event.preventDefault();
    if (!selectedRequest || editSaving) return;
    setEditSaving(true);
    setEditError("");
    try {
      const result = await api.updateResidentRegistration(selectedRequest.id, {
        first_name: editForm.first_name.trim(),
        middle_name: editForm.middle_name.trim(),
        last_name: editForm.last_name.trim(),
        birthdate: editForm.birthdate.trim(),
        barangay: editForm.barangay.trim(),
        address: editForm.address.trim(),
        contact_number: editForm.contact_number.trim(),
        email: editForm.email.trim().toLowerCase(),
      });
      const updatedReq = result.request || selectedRequest;
      const updatedMatches = result.matches || null;

      setSelectedRequest(updatedReq);
      if (updatedMatches) {
        setMatchResult(updatedMatches);
        setMatchError("");
        const available = (updatedMatches.matches || []).filter((item) => item.available);
        if (updatedReq.status === "pending") {
          setSelectedResident(
            updatedMatches.status === "match" && available.length === 1 ? available[0] : null
          );
        }
      }
      setRequests((prev) =>
        prev.map((item) => (item.id === updatedReq.id ? { ...item, ...updatedReq } : item))
      );
      setAllRequests((prev) =>
        prev.map((item) => (item.id === updatedReq.id ? { ...item, ...updatedReq } : item))
      );
      setIsEditingInfo(false);
      setRefreshKey((k) => k + 1);
      showToast(result.message || "Account info updated and roster match re-analyzed.", "success");
    } catch (error) {
      setEditError(error.message || "Could not update registration info.");
    } finally {
      setEditSaving(false);
    }
  }

  function selectMatch(match) {
    if (!match.available || match.already_linked) return;
    setSelectedResident(match);
    setOverrideReason("");
    setActionError("");
  }

  async function searchRoster(event) {
    event.preventDefault();
    const query = manualSearch.trim();
    if (query.length < 3) {
      setManualError("Enter at least 3 characters to search the roster.");
      return;
    }
    setManualLoading(true);
    setManualError("");
    setManualResults([]);
    try {
      const [suggestionResult, residentResult] = await Promise.all([
        api.autosuggestResidents(query),
        api.getResidents(),
      ]);
      const suggestions = suggestionResult.suggestions || [];
      const normalizedQuery = normalizedName(query);
      const suggestionRecords = residentResult.filter((resident) =>
        suggestions.some((suggestion) => matchesAutosuggestRecord(resident, suggestion))
      );
      const directRecords = residentResult.filter((resident) => {
        const fields = [resident.full_name, joinName(resident), resident.household_head_name];
        return fields.some((value) => normalizedName(value).includes(normalizedQuery));
      });
      const unique = new Map();
      [...suggestionRecords, ...directRecords].forEach((resident) => {
        if (!unique.has(resident.id)) unique.set(resident.id, getRosterRecord(resident));
      });
      setManualResults(Array.from(unique.values()).slice(0, 10));
      if (!unique.size) setManualError("No roster records match that search.");
    } catch (error) {
      setManualError(error.message || "The roster search could not be completed.");
    } finally {
      setManualLoading(false);
    }
  }

  async function approveRequest(event) {
    if (event) event.preventDefault();
    const matchedResidentId = getMatchResidentId(selectedResident);
    if (!selectedRequest || !matchedResidentId || actionLockRef.current || decisionResult) return;
    const trimmedOverrideReason = overrideReason.trim();
    if (hasRequiredMismatch && !trimmedOverrideReason) {
      setActionError("An override reason is required to link a mismatched record.");
      return;
    }
    actionLockRef.current = true;
    setActionLoading(true);
    setActionError("");
    try {
      const result = await api.approveResidentRegistration(
        selectedRequest.id,
        matchedResidentId,
        hasRequiredMismatch ? trimmedOverrideReason : ""
      );
      setDecisionResult({ status: "approved", result });
      setConfirmModal(null);
      setOverrideReason("");
      setSelectedRequest((current) =>
        current
          ? {
              ...current,
              ...(result.request || {}),
              status: "approved",
              matched_resident_id: matchedResidentId,
              has_account: true,
              account_email: result.account?.email || current.email,
            }
          : current
      );
      setRequests((current) => current.filter((item) => item.id !== selectedRequest.id));
      setCounts((current) => ({
        ...current,
        pending: Math.max(0, current.pending - 1),
        approved: current.approved + 1,
      }));
      showToast(`Registration approved for ${selectedRequest.full_name || joinName(selectedRequest)}!`, "success");
      setRefreshKey((current) => current + 1);
    } catch (error) {
      const message = error.message || "The registration could not be approved.";
      setActionError(message);
      setConfirmModal(null);
      showToast(message, "error");
      if (/already linked/i.test(message)) {
        setSelectedResident((current) => current ? { ...current, already_linked: true, available: false } : current);
      }
    } finally {
      actionLockRef.current = false;
      setActionLoading(false);
    }
  }

  async function rejectRequest(event) {
    if (event) event.preventDefault();
    if (!selectedRequest || actionLockRef.current || decisionResult) return;
    const reason = rejectionReason.trim();
    if (!reason) {
      setActionError("A rejection reason is required.");
      return;
    }
    actionLockRef.current = true;
    setActionLoading(true);
    setActionError("");
    try {
      const result = await api.rejectResidentRegistration(selectedRequest.id, reason);
      setDecisionResult({ status: "rejected", result });
      setConfirmModal(null);
      setSelectedRequest((current) =>
        current
          ? {
              ...current,
              ...(result.request || {}),
              status: "rejected",
              rejection_reason: reason || null,
            }
          : current
      );
      setRequests((current) => current.filter((item) => item.id !== selectedRequest.id));
      setCounts((current) => ({
        ...current,
        pending: Math.max(0, current.pending - 1),
        rejected: current.rejected + 1,
      }));
      showToast("Registration rejected.", "info");
      setRefreshKey((current) => current + 1);
    } catch (error) {
      const message = error.message || "The registration could not be rejected.";
      setActionError(message);
      setConfirmModal(null);
      showToast(message, "error");
    } finally {
      actionLockRef.current = false;
      setActionLoading(false);
    }
  }

  async function unlinkRequest() {
    if (!selectedRequest || actionLockRef.current) return;
    actionLockRef.current = true;
    setActionLoading(true);
    setActionError("");
    try {
      const result = await api.unlinkResidentRegistration(selectedRequest.id);
      const updatedReq = result.request || {
        ...selectedRequest,
        status: "pending",
        matched_resident_id: null,
        has_account: false,
        account_email: null,
      };
      setConfirmModal(null);
      setDecisionResult(null);
      setSelectedResident(null);
      setOverrideReason("");
      setSelectedRequest(updatedReq);
      if (result.matches) {
        setMatchResult(result.matches);
        setMatchError("");
      }
      setRefreshKey((current) => current + 1);
      showToast(
        result.message || "Registration unlinked from roster record.",
        "success"
      );
    } catch (error) {
      const message = error.message || "The registration could not be unlinked.";
      setActionError(message);
      setConfirmModal(null);
      showToast(message, "error");
    } finally {
      actionLockRef.current = false;
      setActionLoading(false);
    }
  }

  async function resendDecisionEmail() {
    if (!selectedRequest || actionLockRef.current || !decisionResult) return;
    actionLockRef.current = true;
    setActionLoading(true);
    setActionError("");
    try {
      const result = await api.resendResidentRegistrationEmail(selectedRequest.id);
      setDecisionResult((current) => ({
        ...current,
        result: { ...current.result, email_sent: result.email_sent },
        resendMessage: result.message,
      }));
      showToast(result.message || "Email resent successfully.", "success");
    } catch (error) {
      setActionError(error.message || "The activation email could not be resent.");
      showToast(error.message || "The activation email could not be resent.", "error");
    } finally {
      actionLockRef.current = false;
      setActionLoading(false);
    }
  }

  async function sendResetPasswordEmail() {
    if (!selectedRequest || resetLockRef.current) return;
    const requestId = selectedRequest.id;
    const targetEmail = selectedRequest.account_email || selectedRequest.email;
    resetLockRef.current = true;
    setResetLoading(true);
    try {
      const result = await api.sendResidentResetPasswordEmail(requestId);
      const sentEmail = result.email || targetEmail;
      const now = Date.now();
      setNowMs(now);
      setResetCooldowns((current) => ({ ...current, [requestId]: now + 60000 }));
      setConfirmModal(null);
      showToast(`Reset link sent to ${sentEmail}`, "success");
    } catch (error) {
      setConfirmModal(null);
      showToast(error.message || "Could not send reset password email.", "error");
    } finally {
      resetLockRef.current = false;
      setResetLoading(false);
    }
  }

  function renderComparison(match) {
    const residentRecord = getMatchResident(match);
    const residentId = residentRecord.id;
    const rosterName = residentRecord.full_name || joinName(residentRecord) || "Roster record";
    const rosterBarangay = typeof residentRecord.barangay === "string" ? residentRecord.barangay.trim() : "";
    const isSelected = residentId != null && getMatchResidentId(selectedResident) === residentId;
    const isAvailable = match.available && !match.already_linked;

    return (
      <div
        className={`rr-match-card ${isSelected ? "is-selected" : ""} ${!isAvailable ? "is-unavailable" : ""}`}
        key={residentId ?? rosterName}
      >
        <div className="rr-match-card-header">
          <div className="rr-match-identity">
            <strong className="rr-match-name">{rosterName}</strong>
            {(residentId != null || rosterBarangay) && (
              <div className="rr-match-meta">
                {residentId != null && <span className="rr-match-id">Roster #{residentId}</span>}
                {rosterBarangay && <span className="rr-match-barangay">{rosterBarangay}</span>}
              </div>
            )}
          </div>
          {isPendingRequest && !decisionResult ? (
            isAvailable ? (
              <button
                type="button"
                className={`rr-select-match-btn ${isSelected ? "is-active" : ""}`}
                onClick={() => selectMatch(match)}
              >
                {isSelected && <Check size={14} strokeWidth={2.2} aria-hidden="true" />}
                <span>{isSelected ? "Selected" : "Select this match"}</span>
              </button>
            ) : (
              <span className="rr-already-linked-chip">Already linked</span>
            )
          ) : selectedRequest?.matched_resident_id === residentId ? (
            <span className="rr-linked-badge">
              <Check size={13} strokeWidth={2.2} aria-hidden="true" />
              <span>Linked</span>
            </span>
          ) : null}
        </div>

        <div className="rr-table-box">
          <table className="rr-submitted-table rr-comparison-table">
            <thead>
              <tr>
                <th scope="col">FIELD</th>
                <th scope="col">SUBMITTED</th>
                <th scope="col">ROSTER</th>
                <th scope="col" className="is-match-col">MATCH</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON_FIELDS.map((field) => {
                const submittedVal = getComparisonValue(selectedRequest, field);
                const rosterVal = getComparisonValue(residentRecord, field);
                const matched = isFieldMatched(selectedRequest, match, field);
                return (
                  <tr key={field.id} className={matched ? "is-match" : "is-mismatch"}>
                    <td className="rr-field-col">{field.label}</td>
                    <td className="rr-val-col">{submittedVal}</td>
                    <td className="rr-val-col">{rosterVal}</td>
                    <td className="rr-match-col">
                      <span className={`rr-cmp-icon ${matched ? "is-match" : "is-mismatch"}`}>
                        {matched ? (
                          <CheckCircle2 size={16} strokeWidth={2} aria-hidden="true" />
                        ) : (
                          <AlertTriangle size={16} strokeWidth={2} aria-hidden="true" />
                        )}
                        <span className="sr-only">{matched ? "Matches" : "Mismatch"}</span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const isPendingRequest = selectedRequest?.status === "pending" && !decisionResult;
  const displayedMatches = useMemo(() => {
    const apiMatches = matchResult?.matches || [];
    if (!isPendingRequest && selectedRequest?.matched_resident_id) {
      const linked = apiMatches.find(
        (m) => getMatchResidentId(m) === selectedRequest.matched_resident_id
      );
      if (linked) return [linked];
    }
    if (matchResult?.status === "none" && selectedResident) {
      return [selectedResident];
    }
    return apiMatches;
  }, [matchResult, selectedResident, isPendingRequest, selectedRequest]);

  const activeReferenceMatch = selectedResident || displayedMatches[0] || null;
  const matchBanner = (() => {
    if (selectedRequest?.status === "approved" && selectedRequest?.matched_resident_id != null) {
      const linkedRecord = activeReferenceMatch ? getMatchResident(activeReferenceMatch) : null;
      const linkedName = linkedRecord
        ? linkedRecord.full_name || joinName(linkedRecord)
        : "";
      return {
        className: "is-success",
        text: linkedName
          ? `Linked to ${linkedName} (Roster #${selectedRequest.matched_resident_id})`
          : `Linked to Roster #${selectedRequest.matched_resident_id}`,
      };
    }
    if (!matchResult && !selectedResident) return null;
    if (!activeReferenceMatch || (matchResult?.status === "none" && !selectedResident)) {
      return { className: "is-neutral", text: "No roster match" };
    }
    if (allFieldsMatch(selectedRequest, activeReferenceMatch)) {
      return { className: "is-success", text: "Match found" };
    }
    return {
      className: "is-warning",
      text: "Partial match: check the highlighted rows",
    };
  })();

  const resetTargetEmail = selectedRequest?.account_email || selectedRequest?.email || "";
  const resetCooldownSeconds = selectedRequest
    ? Math.max(0, Math.ceil(((resetCooldowns[selectedRequest.id] || 0) - nowMs) / 1000))
    : 0;
  const hasApprovedAccount = Boolean(
    selectedRequest &&
      selectedRequest.status === "approved" &&
      (selectedRequest.has_account || decisionResult?.status === "approved")
  );
  const selectedMismatchedRequired = useMemo(() => {
    if (!selectedRequest || !selectedResident) return [];
    const missing = [];
    if (!isFieldMatched(selectedRequest, selectedResident, NAME_FIELD)) missing.push("name");
    if (!isFieldMatched(selectedRequest, selectedResident, BARANGAY_FIELD)) missing.push("barangay");
    return missing;
  }, [selectedRequest, selectedResident]);
  const hasRequiredMismatch = selectedMismatchedRequired.length > 0;
  const canApprove = Boolean(
    isPendingRequest &&
      !actionLoading &&
      !matchLoading &&
      selectedResident &&
      !selectedResident.already_linked &&
      (selectedResident.available || !selectedResident.resident) &&
      (!hasRequiredMismatch || isAdmin)
  );
  const canUnlink = Boolean(
    isAdmin &&
      selectedRequest &&
      selectedRequest.status === "approved" &&
      selectedRequest.matched_resident_id != null &&
      !actionLoading &&
      !resetLoading &&
      !editSaving
  );

  return (
    <section className="resident-registrations-page" aria-labelledby="resident-registrations-title">
      {/* Floating Toast Notification */}
      {toast && (
        <div className={`resident-floating-toast is-${toast.type}`} role="alert">
          <div className="resident-toast-icon" aria-hidden="true">
            {toast.type === "success" ? (
              <CheckCircle2 size={18} strokeWidth={2} />
            ) : toast.type === "error" ? (
              <AlertTriangle size={18} strokeWidth={2} />
            ) : (
              <Info size={18} strokeWidth={2} />
            )}
          </div>
          <span className="resident-toast-message">{toast.message}</span>
          <button
            type="button"
            className="resident-toast-close"
            onClick={() => setToast(null)}
            aria-label="Dismiss notification"
          >
            <X size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* 1. Top Header */}
      <header className="rr-header">
        <div className="rr-header-titles">
          <span className="rr-label-chip">
            <span className="rr-label-chip-dot" aria-hidden="true" />
            <span>Resident management</span>
          </span>
          <h1 id="resident-registrations-title" className="rr-title">
            Resident Registrations
          </h1>
          <p className="rr-subtitle">
            Review submitted resident accounts, link verified applicants to the roster, and manually create resident accounts.
          </p>
        </div>
        <div className="rr-header-actions">
          <Button
            variant="primary"
            className="rr-create-account-btn"
            onClick={() => setIsCreateModalOpen(true)}
          >
            <UserPlus size={16} strokeWidth={2} aria-hidden="true" />
            <span>Create Resident Account</span>
          </Button>
        </div>
      </header>

      {/* 2. 4 Clickable StatCards (?filter=all|pending|approved|rejected) */}
      {listLoading && allRequests.length === 0 ? (
        <div className="rr-stats-grid" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="rr-skel-stat-card">
              <div className="rr-skel-stat-top">
                <span className="rr-skel rr-skel-tile" />
                <span className="rr-skel rr-skel-label" />
              </div>
              <span className="rr-skel rr-skel-value" />
              <span className="rr-skel rr-skel-helper" />
            </div>
          ))}
        </div>
      ) : (
        <section className="rr-stats-grid" aria-label="Filter resident registrations by status">
          <StatCard
            icon={Layers}
            iconTone="primary"
            label="All"
            value={counts.all}
            showProgress={false}
            helper="Every registration"
            active={activeStatus === "all"}
            onClick={() => handleStatusFilterChange("all")}
          />
          <StatCard
            icon={Clock}
            iconTone="warn"
            label="Pending"
            value={counts.pending}
            showProgress={false}
            helper="Awaiting review"
            active={activeStatus === "pending"}
            onClick={() => handleStatusFilterChange("pending")}
          />
          <StatCard
            icon={CheckCircle2}
            tint="success"
            label="Approved"
            value={counts.approved}
            showProgress={false}
            helper="Linked to roster"
            active={activeStatus === "approved"}
            onClick={() => handleStatusFilterChange("approved")}
          />
          <StatCard
            icon={XCircle}
            tint="danger"
            label="Rejected"
            value={counts.rejected}
            showProgress={false}
            helper="Not accepted"
            active={activeStatus === "rejected"}
            onClick={() => handleStatusFilterChange("rejected")}
          />
        </section>
      )}

      {/* 3. Single Table Card (--radius-xl): Toolbar + Sticky Header + Rows + Footer */}
      <section className="rr-table-card" aria-label="Resident registrations">
        {/* Toolbar inside White Card */}
        <div className="rr-table-toolbar">
          <div className="rr-search-field">
            <Search size={16} strokeWidth={2} className="rr-search-icon" aria-hidden="true" />
            <input
              type="search"
              className="rr-search-input"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search name, email, contact, barangay..."
              aria-label="Search registrations"
            />
            {search && (
              <button
                type="button"
                className="rr-search-clear"
                onClick={() => {
                  setSearch("");
                  setPage(1);
                }}
                aria-label="Clear search"
              >
                <X size={14} strokeWidth={2} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        {/* Table Body: Skeleton / Error / Empty / Rows */}
        <div ref={listScrollRef} className="rr-table-scroll">
          {listLoading ? (
            <div className="rr-table-body" role="status" aria-busy="true" aria-label="Loading resident registrations">
              <div className="rr-table-grid rr-table-head" aria-hidden="true">
                <span>APPLICANT</span>
                <span>BARANGAY</span>
                <span>CONTACT</span>
                <span>SUBMITTED</span>
                <span>STATUS</span>
                <span />
              </div>
              {Array.from({ length: 6 }).map((_, idx) => (
                <div key={idx} className="rr-table-grid rr-skel-row" aria-hidden="true">
                  <div className="rr-applicant-cell">
                    <span className="rr-skel rr-skel-avatar" />
                    <div className="rr-skel-stack">
                      <span className="rr-skel rr-skel-name" />
                      <span className="rr-skel rr-skel-email" />
                    </div>
                  </div>
                  <span className="rr-skel rr-skel-chip" />
                  <span className="rr-skel rr-skel-contact" />
                  <span className="rr-skel rr-skel-date" />
                  <span className="rr-skel rr-skel-pill" />
                  <span />
                </div>
              ))}
            </div>
          ) : listError ? (
            <div className="rr-state-box" role="alert">
              <span className="rr-state-icon is-error" aria-hidden="true">
                <AlertTriangle size={22} strokeWidth={2} />
              </span>
              <h3>Could not load resident registrations</h3>
              <p>{listError}</p>
              <Button
                variant="secondary"
                onClick={() => setRefreshKey((current) => current + 1)}
              >
                Try again
              </Button>
            </div>
          ) : visibleRequests.length === 0 ? (
            <div className="rr-state-box" role="status">
              <span className="rr-state-icon" aria-hidden="true">
                {search || activeStatus !== "all" ? (
                  <Search size={22} strokeWidth={2} />
                ) : (
                  <Mail size={22} strokeWidth={2} />
                )}
              </span>
              <h3>
                {activeStatus === "all" && !search
                  ? "No resident registrations"
                  : `No ${activeStatus === "all" ? "matching" : activeStatus} registrations`}
              </h3>
              <p>
                {search || activeStatus !== "all"
                  ? "Try adjusting your search query or status filter."
                  : "New resident registration requests will appear here."}
              </p>
              {(search || activeStatus !== "all") && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch("");
                    handleStatusFilterChange("all");
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            <div className="rr-table-body" role="list" aria-label={`${activeStatus} registrations`}>
              <div className="rr-table-grid rr-table-head" aria-hidden="true">
                <span>APPLICANT</span>
                <span>BARANGAY</span>
                <span>CONTACT</span>
                <span>SUBMITTED</span>
                <span>STATUS</span>
                <span />
              </div>

              {paginatedRequests.map((item) => {
                const name = item.full_name || joinName(item) || "Unknown Resident";
                const initials =
                  name
                    .split(" ")
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((n) => n[0].toUpperCase())
                    .join("") || "?";
                const isSelected = selectedRequest?.id === item.id;

                return (
                  <button
                    type="button"
                    role="listitem"
                    className={`rr-table-grid rr-table-row ${isSelected ? "is-selected" : ""}`}
                    key={item.id}
                    onClick={(e) => openReview(item, { triggerEl: e.currentTarget })}
                    aria-label={`Review registration for ${name}, ${item.status || "pending"}`}
                  >
                    {/* APPLICANT */}
                    <span className="rr-applicant-cell">
                      <span className="rr-applicant-avatar" aria-hidden="true">
                        {initials}
                      </span>
                      <span className="rr-applicant-copy">
                        <span className="rr-applicant-name" title={name}>
                          {name}
                        </span>
                        <span className="rr-applicant-email" title={item.email || undefined}>
                          {item.email || "Not provided"}
                        </span>
                      </span>
                    </span>

                    {/* BARANGAY */}
                    <span className="rr-barangay-cell">
                      <span className="rr-barangay-chip">
                        {item.barangay || "Not provided"}
                      </span>
                    </span>

                    {/* CONTACT */}
                    <span className="rr-contact-cell">
                      {item.contact_number || "—"}
                    </span>

                    {/* SUBMITTED */}
                    <span className="rr-submitted-cell">
                      {formatDate(item.created_at?.slice(0, 10))}
                    </span>

                    {/* STATUS */}
                    <span className="rr-status-cell">
                      <StatusPill variant={item.status} />
                    </span>

                    {/* CHEVRON */}
                    <span className="rr-chevron-cell" aria-hidden="true">
                      <ChevronRight size={16} strokeWidth={2} className="rr-row-chevron" />
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {!listLoading && !listError && totalFiltered > 0 && (
          <footer className="rr-table-footer" aria-label="Pagination">
            <span className="rr-footer-info">
              Showing {(safePage - 1) * pageSize + 1} to{" "}
              {Math.min(safePage * pageSize, totalFiltered)} of {totalFiltered}
            </span>

            <div className="rr-footer-controls">
              <label className="rr-rows-per-page">
                <span>Rows per page</span>
                <select
                  className="rr-rows-select"
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
                className="rr-footer-btn"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label="Previous page"
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                className="rr-footer-btn"
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

      {/* Review Dialog */}
      <dialog
        ref={dialogRef}
        className="resident-review-dialog rr-review-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="resident-review-title"
        onCancel={(event) => {
          if (actionLoading || resetLoading) {
            event.preventDefault();
          }
        }}
        onClose={handleDialogClose}
        onClick={(event) => {
          if (event.target === dialogRef.current && !confirmModal) {
            closeReview();
          }
        }}
      >
        {selectedRequest && (
          <div className="resident-review-shell rr-review-shell">
            <header className="resident-review-header rr-review-header">
              <div className="rr-review-header-left">
                <span className="rr-review-icon-tile" aria-hidden="true">
                  <UserCheck size={20} strokeWidth={2} />
                </span>
                <div className="resident-review-header-info rr-review-header-info">
                  <div className="resident-review-meta-row rr-review-meta-row">
                    <span className="rr-review-request-id">
                      REQUEST #{selectedRequest.id}
                    </span>
                    <StatusPill variant={selectedRequest.status} />
                  </div>
                  <h2 id="resident-review-title" className="rr-review-title">
                    Review resident registration
                  </h2>
                  {(selectedRequest.account_email || selectedRequest.email) && (
                    <p className="resident-review-header-email rr-review-email">
                      <Mail size={14} strokeWidth={2} aria-hidden="true" />
                      <span>{selectedRequest.account_email || selectedRequest.email}</span>
                    </p>
                  )}
                </div>
              </div>
              <div className="rr-review-header-actions">
                {!isEditingInfo && (
                  <Button
                    variant="secondary"
                    className="rr-edit-info-btn"
                    onClick={startEditingInfo}
                    disabled={actionLoading || resetLoading || matchLoading}
                  >
                    <Pencil size={14} strokeWidth={2} aria-hidden="true" />
                    <span>Edit info</span>
                  </Button>
                )}
                <button
                  type="button"
                  className="rr-review-close-btn"
                  onClick={closeReview}
                  aria-label="Close"
                  disabled={actionLoading || resetLoading || editSaving}
                >
                  <X size={18} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            </header>

            <div className="resident-review-body rr-review-body">
              {isEditingInfo && (
                <form className="rr-edit-card" onSubmit={saveRegistrationEdit}>
                  <div className="rr-edit-card-head">
                    <span className="rr-account-label">EDIT ACCOUNT &amp; REGISTRATION INFO</span>
                    <span className="rr-edit-card-hint">
                      Saving will automatically re-analyze the roster link match.
                    </span>
                  </div>

                  {editError && (
                    <p className="rr-review-inline-error" role="alert">
                      <AlertTriangle size={15} strokeWidth={2} aria-hidden="true" />
                      <span>{editError}</span>
                    </p>
                  )}

                  <div className="rr-edit-grid-3">
                    <label className="rr-edit-field">
                      <span>First name *</span>
                      <input
                        type="text"
                        required
                        maxLength={100}
                        value={editForm.first_name}
                        onChange={(e) => setEditForm((f) => ({ ...f, first_name: e.target.value }))}
                        disabled={editSaving}
                      />
                    </label>
                    <label className="rr-edit-field">
                      <span>Middle name</span>
                      <input
                        type="text"
                        maxLength={100}
                        value={editForm.middle_name}
                        onChange={(e) => setEditForm((f) => ({ ...f, middle_name: e.target.value }))}
                        disabled={editSaving}
                      />
                    </label>
                    <label className="rr-edit-field">
                      <span>Last name *</span>
                      <input
                        type="text"
                        required
                        maxLength={100}
                        value={editForm.last_name}
                        onChange={(e) => setEditForm((f) => ({ ...f, last_name: e.target.value }))}
                        disabled={editSaving}
                      />
                    </label>
                  </div>

                  <div className="rr-edit-grid-2">
                    <label className="rr-edit-field">
                      <span>Email address *</span>
                      <input
                        type="email"
                        required
                        maxLength={120}
                        value={editForm.email}
                        onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                        disabled={editSaving}
                      />
                    </label>
                    <label className="rr-edit-field">
                      <span>Birthdate *</span>
                      <input
                        type="date"
                        required
                        max={getLocalYesterdayIso()}
                        value={editForm.birthdate}
                        onChange={(e) => setEditForm((f) => ({ ...f, birthdate: e.target.value }))}
                        disabled={editSaving}
                      />
                    </label>
                  </div>

                  <div className="rr-edit-grid-2">
                    <label className="rr-edit-field">
                      <span>Barangay *</span>
                      <input
                        type="text"
                        required
                        maxLength={100}
                        list="rr-edit-barangay-list"
                        value={editForm.barangay}
                        onChange={(e) => setEditForm((f) => ({ ...f, barangay: e.target.value }))}
                        disabled={editSaving}
                      />
                      <datalist id="rr-edit-barangay-list">
                        {barangayOptions.map((name) => (
                          <option key={name} value={name} />
                        ))}
                      </datalist>
                    </label>
                    <label className="rr-edit-field">
                      <span>Contact number</span>
                      <input
                        type="text"
                        maxLength={20}
                        value={editForm.contact_number}
                        onChange={(e) => setEditForm((f) => ({ ...f, contact_number: e.target.value }))}
                        placeholder="09XXXXXXXXX"
                        disabled={editSaving}
                      />
                    </label>
                  </div>

                  <label className="rr-edit-field">
                    <span>Address / purok</span>
                    <input
                      type="text"
                      maxLength={255}
                      value={editForm.address}
                      onChange={(e) => setEditForm((f) => ({ ...f, address: e.target.value }))}
                      disabled={editSaving}
                    />
                  </label>

                  <div className="rr-edit-actions">
                    <Button
                      variant="secondary"
                      type="button"
                      className="rr-review-footer-btn"
                      onClick={cancelEditingInfo}
                      disabled={editSaving}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      type="submit"
                      className="rr-review-footer-btn"
                      disabled={editSaving}
                    >
                      {editSaving ? (
                        <Loader2 size={15} strokeWidth={2} className="rr-spin" aria-hidden="true" />
                      ) : (
                        <Check size={15} strokeWidth={2} aria-hidden="true" />
                      )}
                      <span>{editSaving ? "Saving & re-analyzing..." : "Save & re-analyze match"}</span>
                    </Button>
                  </div>
                </form>
              )}
              {matchLoading ? (
                <div className="rr-review-state" role="status">
                  <Loader2 size={18} strokeWidth={2} className="rr-spin" aria-hidden="true" />
                  <span>Checking the resident roster…</span>
                </div>
              ) : matchError ? (
                <div className="rr-review-state is-error" role="alert">
                  <AlertTriangle size={18} strokeWidth={2} aria-hidden="true" />
                  <span>{matchError}</span>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setMatchError("");
                      setMatchLoading(true);
                      setMatchRetryKey((current) => current + 1);
                    }}
                  >
                    Retry match check
                  </Button>
                </div>
              ) : (
                <>
                  {/* 1. Blue Info Box for Roster Match Message */}
                  {matchBanner && (
                    <div className="rr-match-info-box" role="status">
                      <Info size={16} strokeWidth={2} className="rr-match-info-icon" aria-hidden="true" />
                      <span>{matchBanner.text}</span>
                    </div>
                  )}

                  {/* 2. Bordered Table (--radius-lg) with Grey Header Row (FIELD, SUBMITTED) */}
                  {displayedMatches.length > 0 ? (
                    displayedMatches.map(renderComparison)
                  ) : (
                    <div className="rr-table-box">
                      <table className="rr-submitted-table">
                        <thead>
                          <tr>
                            <th scope="col">FIELD</th>
                            <th scope="col">SUBMITTED</th>
                          </tr>
                        </thead>
                        <tbody>
                          {COMPARISON_FIELDS.map((field) => (
                            <tr key={field.id}>
                              <td className="rr-field-col">{field.label}</td>
                              <td className="rr-val-col">{getComparisonValue(selectedRequest, field)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {matchResult?.status === "none" && isPendingRequest && (
                    <form className="rr-manual-search" onSubmit={searchRoster}>
                      <label className="rr-manual-search-label" htmlFor="resident-roster-search">
                        Search the resident roster
                      </label>
                      <div className="rr-manual-search-controls">
                        <input
                          id="resident-roster-search"
                          className="rr-manual-search-input"
                          value={manualSearch}
                          onChange={(event) => setManualSearch(event.target.value)}
                          placeholder="Enter a resident name"
                        />
                        <Button variant="secondary" type="submit" disabled={manualLoading}>
                          {manualLoading ? (
                            <Loader2 size={15} strokeWidth={2} className="rr-spin" aria-hidden="true" />
                          ) : (
                            <Search size={15} strokeWidth={2} aria-hidden="true" />
                          )}
                          <span>Search</span>
                        </Button>
                      </div>
                      {manualError && <p className="rr-review-inline-error" role="alert">{manualError}</p>}
                      {manualResults.map((resident) => (
                        <button
                          type="button"
                          className={`rr-manual-result ${getMatchResidentId(selectedResident) === resident.id ? "is-selected" : ""}`}
                          key={resident.id}
                          onClick={() => setSelectedResident(resident)}
                          disabled={resident.already_linked}
                        >
                          <span className="rr-manual-result-info">
                            <strong>{resident.full_name}</strong>
                            <small>{resident.barangay ? `${resident.barangay} · ` : ""}{formatDate(resident.birthdate)}</small>
                            {resident.already_linked && (
                              <small className="rr-manual-linked-warning">Already linked to another account</small>
                            )}
                          </span>
                          <span className="rr-manual-result-tag">
                            {resident.already_linked ? "Already linked" : `#${resident.id}`}
                          </span>
                        </button>
                      ))}
                    </form>
                  )}
                </>
              )}

              {isPendingRequest && selectedResident?.already_linked && (
                <p className="rr-registration-warning" role="alert">
                  <AlertTriangle size={16} strokeWidth={2} aria-hidden="true" />
                  <span>This resident record is already linked to another account.</span>
                </p>
              )}

              {isPendingRequest && selectedResident && !selectedResident.already_linked && hasRequiredMismatch && !isAdmin && (
                <p className="rr-registration-warning" role="alert">
                  <AlertTriangle size={16} strokeWidth={2} aria-hidden="true" />
                  <span>
                    Cannot link because {selectedMismatchedRequired.join(" and ")}{" "}
                    {selectedMismatchedRequired.length === 2 ? "do" : "does"} not match. Only an admin can override a mismatch.
                  </span>
                </p>
              )}

              {selectedRequest.status === "rejected" && selectedRequest.rejection_reason && (
                <div className="rr-reviewed-notice" role="status">
                  <strong>Rejection reason</strong>
                  <span>{selectedRequest.rejection_reason}</span>
                </div>
              )}

              {actionError && <p className="rr-review-inline-error" role="alert">{actionError}</p>}

              {decisionResult && !decisionResult.result.email_sent && (
                <div className="rr-decision-result" role="status">
                  <div className="rr-email-warning">
                    <span className="rr-email-warning-text">
                      <AlertTriangle size={15} strokeWidth={2} aria-hidden="true" />
                      <span>Decision email not sent.</span>
                    </span>
                    <Button variant="secondary" onClick={resendDecisionEmail} disabled={actionLoading}>
                      {actionLoading ? (
                        <Loader2 size={14} strokeWidth={2} className="rr-spin" aria-hidden="true" />
                      ) : (
                        <Mail size={14} strokeWidth={2} aria-hidden="true" />
                      )}
                      <span>Resend email</span>
                    </Button>
                  </div>
                  {decisionResult.resendMessage && <small>{decisionResult.resendMessage}</small>}
                </div>
              )}

              {/* 3. Account Card (bg #F8FAFC, 1px border) */}
              {hasApprovedAccount && (
                <section className="rr-account-card" aria-label="Account">
                  <div className="rr-account-info">
                    <span className="rr-account-label">ACCOUNT</span>
                    <span className="rr-account-login">
                      Active resident login: <strong className="rr-account-email">{resetTargetEmail}</strong>
                    </span>
                  </div>
                  <Button
                    variant="secondary"
                    className="rr-reset-pw-btn"
                    onClick={() => setConfirmModal("reset_password")}
                    disabled={resetLoading || actionLoading || resetCooldownSeconds > 0}
                  >
                    {resetLoading ? (
                      <Loader2 size={15} strokeWidth={2} className="rr-spin" aria-hidden="true" />
                    ) : (
                      <Mail size={15} strokeWidth={2} aria-hidden="true" />
                    )}
                    <span>
                      {resetLoading
                        ? "Sending..."
                        : resetCooldownSeconds > 0
                          ? `Send reset password email (${resetCooldownSeconds}s)`
                          : "Send reset password email"}
                    </span>
                  </Button>
                </section>
              )}
            </div>

            <footer className="resident-review-footer rr-review-footer">
              {isPendingRequest ? (
                <>
                  <Button
                    variant="secondary"
                    className="rr-review-footer-btn"
                    onClick={closeReview}
                    disabled={actionLoading}
                  >
                    Close
                  </Button>
                  <Button
                    variant="danger-outline"
                    className="rr-review-footer-btn rr-review-reject-btn"
                    onClick={() => setConfirmModal("reject")}
                    disabled={actionLoading || matchLoading}
                  >
                    Reject
                  </Button>
                  <Button
                    variant="primary"
                    className="rr-review-footer-btn"
                    onClick={() => {
                      setOverrideReason("");
                      setConfirmModal("approve");
                    }}
                    disabled={!canApprove}
                  >
                    {actionLoading ? (
                      <Loader2 size={16} strokeWidth={2} className="rr-spin" aria-hidden="true" />
                    ) : (
                      <Check size={16} strokeWidth={2} aria-hidden="true" />
                    )}
                    <span>{actionLoading ? "Approving..." : "Approve"}</span>
                  </Button>
                </>
              ) : (
                <>
                  {canUnlink && (
                    <Button
                      variant="danger-outline"
                      className="rr-review-footer-btn rr-review-reject-btn"
                      onClick={() => setConfirmModal("unlink")}
                      disabled={actionLoading || resetLoading}
                    >
                      <Unlink size={15} strokeWidth={2} aria-hidden="true" />
                      <span>Unlink</span>
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    className="rr-review-footer-btn"
                    onClick={closeReview}
                    disabled={actionLoading || resetLoading}
                  >
                    Close
                  </Button>
                </>
              )}
            </footer>

            {/* In-Dialog Confirmation Prompt (Approve / Reject / Reset Password) */}
            {confirmModal && (
              <div
                ref={confirmOverlayRef}
                className="resident-confirm-overlay"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="resident-confirm-title"
                onClick={(event) => {
                  if (event.target === event.currentTarget && !actionLoading && !resetLoading) {
                    setConfirmModal(null);
                  }
                }}
              >
                {confirmModal === "approve" && (
                  <form className="resident-confirm-card" onSubmit={approveRequest}>
                    <h3 id="resident-confirm-title">Approve resident registration?</h3>
                    <p>
                      Create an active resident account for{" "}
                      <strong>{selectedRequest.full_name || joinName(selectedRequest)}</strong>{" "}
                      linked to{" "}
                      <strong>
                        {getMatchResident(selectedResident).full_name || joinName(getMatchResident(selectedResident))}
                      </strong>
                      {getMatchResidentId(selectedResident) != null
                        ? ` (Roster #${getMatchResidentId(selectedResident)})`
                        : ""}
                      ?
                    </p>
                    {hasRequiredMismatch && isAdmin && (
                      <>
                        <p className="rr-registration-warning" role="alert">
                          <AlertTriangle size={16} strokeWidth={2} aria-hidden="true" />
                          <span>
                            Mismatch detected ({selectedMismatchedRequired.join(" & ")}). Enter an override reason to link anyway.
                          </span>
                        </p>
                        <label className="resident-confirm-label" htmlFor="resident-override-reason">
                          Override reason <span aria-hidden="true">*</span>
                        </label>
                        <textarea
                          id="resident-override-reason"
                          value={overrideReason}
                          onChange={(event) => {
                            setOverrideReason(event.target.value);
                            if (event.target.value.trim()) setActionError("");
                          }}
                          placeholder="Explain why this mismatched roster record is being linked..."
                          maxLength={2000}
                          rows={3}
                          required
                          disabled={actionLoading}
                        />
                      </>
                    )}
                    <div className="resident-confirm-actions">
                      <Button
                        variant="secondary"
                        type="button"
                        onClick={() => setConfirmModal(null)}
                        disabled={actionLoading}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="primary"
                        type="submit"
                        disabled={actionLoading || (hasRequiredMismatch && !overrideReason.trim())}
                      >
                        {actionLoading && (
                          <Loader2 size={15} strokeWidth={2} className="rr-spin" aria-hidden="true" />
                        )}
                        <span>{actionLoading ? "Approving..." : "Approve"}</span>
                      </Button>
                    </div>
                  </form>
                )}

                {confirmModal === "reject" && (
                  <form className="resident-confirm-card" onSubmit={rejectRequest}>
                    <h3 id="resident-confirm-title">Reject resident registration?</h3>
                    <p>
                      This marks request #{selectedRequest.id} for{" "}
                      <strong>{selectedRequest.full_name || joinName(selectedRequest)}</strong> as rejected.
                    </p>
                    <label className="resident-confirm-label" htmlFor="resident-rejection-reason">
                      Reason <span aria-hidden="true">*</span>
                    </label>
                    <textarea
                      id="resident-rejection-reason"
                      value={rejectionReason}
                      onChange={(event) => {
                        setRejectionReason(event.target.value);
                        if (event.target.value.trim()) setActionError("");
                      }}
                      placeholder="Enter the reason to include in the decision message..."
                      maxLength={2000}
                      rows={3}
                      required
                      disabled={actionLoading}
                    />
                    <div className="resident-confirm-actions">
                      <Button
                        variant="secondary"
                        onClick={() => setConfirmModal(null)}
                        disabled={actionLoading}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="danger"
                        type="submit"
                        disabled={actionLoading || !rejectionReason.trim()}
                      >
                        {actionLoading && (
                          <Loader2 size={15} strokeWidth={2} className="rr-spin" aria-hidden="true" />
                        )}
                        <span>{actionLoading ? "Rejecting..." : "Reject"}</span>
                      </Button>
                    </div>
                  </form>
                )}

                {confirmModal === "unlink" && (
                  <div className="resident-confirm-card">
                    <h3 id="resident-confirm-title">Unlink resident registration?</h3>
                    <p>
                      Remove the roster link for{" "}
                      <strong>{selectedRequest.full_name || joinName(selectedRequest)}</strong>
                      {selectedRequest.matched_resident_id != null
                        ? ` (currently linked to Roster #${selectedRequest.matched_resident_id})`
                        : ""}
                      ? This revokes the linked resident account and removes any evacuation center
                      and room assignment it inherited from that roster family, returning the
                      request to pending review.
                    </p>
                    <div className="resident-confirm-actions">
                      <Button
                        variant="secondary"
                        onClick={() => setConfirmModal(null)}
                        disabled={actionLoading}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="danger"
                        onClick={unlinkRequest}
                        disabled={actionLoading}
                      >
                        {actionLoading && (
                          <Loader2 size={15} strokeWidth={2} className="rr-spin" aria-hidden="true" />
                        )}
                        <span>{actionLoading ? "Unlinking..." : "Unlink"}</span>
                      </Button>
                    </div>
                  </div>
                )}

                {confirmModal === "reset_password" && (
                  <div className="resident-confirm-card">
                    <h3 id="resident-confirm-title">Send reset password link?</h3>
                    <p>Send a reset password link to {resetTargetEmail}?</p>
                    <div className="resident-confirm-actions">
                      <Button
                        variant="secondary"
                        onClick={() => setConfirmModal(null)}
                        disabled={resetLoading}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="primary"
                        onClick={sendResetPasswordEmail}
                        disabled={resetLoading}
                      >
                        {resetLoading && (
                          <Loader2 size={15} strokeWidth={2} className="rr-spin" aria-hidden="true" />
                        )}
                        <span>{resetLoading ? "Sending..." : "Send"}</span>
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </dialog>

      {/* Create Account Modal */}
      <CreateResidentAccountModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={({ message }) => {
          showToast(message, "success");
          setRefreshKey((k) => k + 1);
        }}
      />
    </section>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheck,
  faCircleCheck,
  faCircleNotch,
  faEnvelope,
  faInfoCircle,
  faMagnifyingGlass,
  faRotateRight,
  faTriangleExclamation,
  faUserPlus,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../services/api";
import { queryKeys } from "../../hooks/useEvacuationQueries";
import CreateResidentAccountModal from "./CreateResidentAccountModal";
import "./ResidentRegistrations.css";

const STATUS_TABS = [
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
];

const COMPARISON_FIELDS = [
  { id: "name", label: "Full name", flag: "name", format: (record) => record.full_name || joinName(record) },
  { id: "birthdate", label: "Birthdate", flag: "birthdate", format: (record) => record.birthdate || "Not provided" },
  { id: "barangay", label: "Barangay", flag: "barangay", format: (record) => record.barangay || "Not provided" },
  { id: "address", label: "Address / purok", flag: "address", format: (record) => record.address || "Not provided" },
  { id: "contact_number", label: "Contact number", flag: "contact_number", format: (record) => record.contact_number || "Not provided" },
];

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

function formatDate(value) {
  if (!value) return "Not provided";
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(parsed);
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

function compareValue(request, resident, field) {
  if (field.id === "name") return request.full_name || joinName(request);
  return request[field.id] || "Not provided";
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
  const queryClient = useQueryClient();
  const [activeStatus, setActiveStatus] = useState("pending");
  const [search, setSearch] = useState("");
  const [requests, setRequests] = useState([]);
  const [allRequests, setAllRequests] = useState([]);
  const [counts, setCounts] = useState({ pending: 0, approved: 0, rejected: 0 });
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
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState("");
  const [decisionResult, setDecisionResult] = useState(null);

  // Manual account modal & Floating toast notification state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [toast, setToast] = useState(null);

  const dialogRef = useRef(null);
  const listRequestRef = useRef(0);

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
      const nextCounts = { pending: 0, approved: 0, rejected: 0 };
      (all.requests || []).forEach((item) => {
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

  useEffect(() => {
    if (focusRegistrationId == null) {
      handledFocusIdRef.current = null;
      return;
    }
    if (handledFocusIdRef.current === String(focusRegistrationId)) return;
    const match = allRequests.find(
      (item) => String(item.id) === String(focusRegistrationId)
    );
    if (!match) return;
    handledFocusIdRef.current = String(focusRegistrationId);
    if (match.status && match.status !== activeStatus) {
      setActiveStatus(match.status);
    }
    openReview(match);
  }, [focusRegistrationId, allRequests, activeStatus]);

  useEffect(() => {
    if (!selectedRequest) return undefined;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();

    api.clearNotificationsByResource("resident_registration", selectedRequest.id)
      .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.notifications }))
      .catch(() => {});

    let active = true;
    api.getResidentRegistrationMatches(selectedRequest.id)
      .then((result) => {
        if (!active) return;
        setMatchResult(result);
        const available = (result.matches || []).filter((item) => item.available);
        if (result.status === "match" && available.length === 1) {
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
  }, [selectedRequest, matchRetryKey]);

  const visibleRequests = useMemo(() => requests, [requests]);

  function closeReview() {
    if (actionLoading) return;
    dialogRef.current?.close();
  }

  function handleDialogClose() {
    setSelectedRequest(null);
    setMatchResult(null);
    setSelectedResident(null);
    setManualResults([]);
    setDecisionResult(null);
    setActionError("");
  }

  function openReview(registration) {
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
    setShowRejectForm(false);
    setRejectionReason("");
    setSelectedRequest(registration);
  }

  function selectMatch(match) {
    if (!match.available || match.already_linked) return;
    setSelectedResident(match);
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

  async function approveRequest() {
    if (!selectedRequest || !selectedResident || actionLoading || decisionResult) return;
    setActionLoading(true);
    setActionError("");
    try {
      const result = await api.approveResidentRegistration(selectedRequest.id, selectedResident.resident?.id || selectedResident.id);
      setDecisionResult({ status: "approved", result });
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
      showToast(message, "error");
      if (/already linked/i.test(message)) {
        setSelectedResident((current) => current ? { ...current, already_linked: true, available: false } : current);
      }
    } finally {
      setActionLoading(false);
    }
  }

  async function rejectRequest(event) {
    event.preventDefault();
    const reason = rejectionReason.trim();
    if (!reason || !selectedRequest || actionLoading || decisionResult) return;
    setActionLoading(true);
    setActionError("");
    try {
      const result = await api.rejectResidentRegistration(selectedRequest.id, reason);
      setDecisionResult({ status: "rejected", result });
      setRequests((current) => current.filter((item) => item.id !== selectedRequest.id));
      setCounts((current) => ({
        ...current,
        pending: Math.max(0, current.pending - 1),
        rejected: current.rejected + 1,
      }));
      showToast("Registration rejected.", "info");
      setRefreshKey((current) => current + 1);
    } catch (error) {
      setActionError(error.message || "The registration could not be rejected.");
      showToast(error.message || "The registration could not be rejected.", "error");
    } finally {
      setActionLoading(false);
    }
  }

  async function resendDecisionEmail() {
    if (!selectedRequest || actionLoading || !decisionResult) return;
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
      setActionLoading(false);
    }
  }

  function renderComparison(match) {
    const isSelected = selectedResident?.id === match.id;
    const isAvailable = match.available && !match.already_linked;
    return (
      <div className={`resident-match-card ${isSelected ? "is-selected" : ""} ${!isAvailable ? "is-unavailable" : ""}`} key={match.id}>
        <div className="resident-match-card-header">
          <div>
            <strong>{match.resident?.full_name || match.full_name || joinName(match)}</strong>
            <small>Roster #{match.id} · {match.barangay || "Barangay not set"}</small>
          </div>
          {isAvailable ? (
            <button
              type="button"
              className={`resident-select-match ${isSelected ? "is-active" : ""}`}
              onClick={() => selectMatch(match)}
            >
              {isSelected ? "Selected" : "Select this match"}
            </button>
          ) : (
            <span className="resident-already-linked-chip">Already linked</span>
          )}
        </div>
        <dl className="resident-match-grid">
          {COMPARISON_FIELDS.map((field) => {
            const requested = compareValue(selectedRequest, null, field);
            const roster = field.format(match.resident || match);
            const flag = match.match_flags?.[field.flag];
            const className = flag ? "is-mismatch" : "is-match";
            return (
              <div key={field.id} className={className}>
                <dt>{field.label}</dt>
                <dd><span>Submitted:</span> <strong>{requested}</strong></dd>
                <dd><span>Roster:</span> <strong>{roster}</strong></dd>
              </div>
            );
          })}
        </dl>
      </div>
    );
  }

  const matchBanner = matchResult?.status === "match"
    ? { className: "is-success", title: "Match found", text: "Name, birthdate, and barangay align with a roster record." }
    : matchResult?.status === "possible"
      ? { className: "is-warning", title: "Possible match", text: "Review the closest roster records and select the correct resident." }
      : matchResult?.status === "none"
        ? { className: "is-danger", title: "No match found", text: "This person was not found in the resident roster. You can search the roster manually or reject the request." }
        : null;
  const isPendingRequest = selectedRequest?.status === "pending";

  return (
    <section className="resident-registrations-page" aria-labelledby="resident-registrations-title">
      {/* Floating Toast Notification */}
      {toast && (
        <div className={`resident-floating-toast is-${toast.type}`} role="alert">
          <div className="resident-toast-icon">
            <FontAwesomeIcon
              icon={
                toast.type === "success"
                  ? faCircleCheck
                  : toast.type === "error"
                  ? faTriangleExclamation
                  : faInfoCircle
              }
            />
          </div>
          <span className="resident-toast-message">{toast.message}</span>
          <button
            type="button"
            className="resident-toast-close"
            onClick={() => setToast(null)}
            aria-label="Dismiss notification"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
      )}

      {/* Header */}
      <header className="resident-registrations-header">
        <div className="resident-header-left">
          <p className="resident-registrations-eyebrow">Resident Management</p>
          <h1 id="resident-registrations-title">Resident Registrations</h1>
          <p className="resident-header-description">
            Review submitted resident accounts, link verified applicants to the roster, and manually create resident accounts.
          </p>
        </div>
        <div className="resident-header-actions">
          <button
            type="button"
            className="resident-btn-create-account"
            onClick={() => setIsCreateModalOpen(true)}
          >
            <FontAwesomeIcon icon={faUserPlus} />
            <span>Create Resident Account</span>
          </button>
          
        </div>
      </header>

      {/* Toolbar */}
      <div className="resident-registration-toolbar">
        <div className="resident-registration-tabs" role="tablist" aria-label="Registration status">
          {STATUS_TABS.map((tab) => (
            <button
              type="button"
              role="tab"
              aria-selected={activeStatus === tab.id}
              className={`resident-tab-btn ${activeStatus === tab.id ? "is-active" : ""}`}
              onClick={() => setActiveStatus(tab.id)}
              key={tab.id}
            >
              <span>{tab.label}</span>
              <span className="resident-registration-count">{counts[tab.id]}</span>
            </button>
          ))}
        </div>
        <label className="resident-registration-search">
          <FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" />
          <span className="sr-only">Search registrations</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, email, contact, barangay..."
          />
          {search && (
            <button
              type="button"
              className="resident-search-clear-btn"
              onClick={() => setSearch("")}
              aria-label="Clear search"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          )}
        </label>
      </div>

      {/* Main List */}
      {listLoading ? (
        <div className="resident-registration-state" role="status">
          <FontAwesomeIcon icon={faCircleNotch} spin /> Loading resident registrations…
        </div>
      ) : listError ? (
        <div className="resident-registration-state is-error" role="alert">
          <FontAwesomeIcon icon={faTriangleExclamation} />
          <span>{listError}</span>
          <button type="button" onClick={() => setRefreshKey((current) => current + 1)}>Retry</button>
        </div>
      ) : visibleRequests.length === 0 ? (
        <div className="resident-registration-state is-empty">
          <div className="resident-empty-icon">
            <FontAwesomeIcon icon={faEnvelope} />
          </div>
          <strong>No {activeStatus} registrations</strong>
          <span>{search ? "Try a different search query." : "New resident requests will appear here."}</span>
        </div>
      ) : (
        <div className="resident-registration-list" role="list" aria-label={`${activeStatus} registrations`}>
          {visibleRequests.map((item) => {
            const name = item.full_name || joinName(item) || "Unknown Resident";
            const initials = name
              .split(" ")
              .filter(Boolean)
              .slice(0, 2)
              .map((n) => n[0].toUpperCase())
              .join("");

            return (
              <button
                type="button"
                role="listitem"
                className="resident-registration-row"
                key={item.id}
                onClick={() => openReview(item)}
              >
                <div className="resident-row-avatar" aria-hidden="true">
                  {initials}
                </div>
                <div className="resident-registration-person">
                  <strong className="resident-row-name">{name}</strong>
                  <small className="resident-row-email">{item.email}</small>
                </div>
                <div className="resident-registration-row-detail resident-row-barangay">
                  <span className="resident-badge-subtle">{item.barangay || "N/A"}</span>
                </div>
                <div className="resident-registration-row-detail resident-row-contact">
                  {item.contact_number || "—"}
                </div>
                <div className="resident-registration-row-date">
                  {formatDate(item.created_at?.slice(0, 10))}
                </div>
                <div className="resident-row-status-wrap">
                  <span className={`resident-registration-status is-${item.status}`}>
                    {item.status}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Review Dialog */}
      <dialog
        ref={dialogRef}
        className="resident-review-dialog"
        aria-labelledby="resident-review-title"
        onClose={handleDialogClose}
        onClick={(event) => event.target === dialogRef.current && closeReview()}
      >
        {selectedRequest && (
          <div className="resident-review-shell">
            <header className="resident-review-header">
              <div>
                <p className="resident-registrations-eyebrow">Request #{selectedRequest.id}</p>
                <h2 id="resident-review-title">Review resident registration</h2>
              </div>
              <button
                type="button"
                className="resident-registration-icon-button"
                onClick={closeReview}
                aria-label="Close review"
                disabled={actionLoading}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </header>

            <div className="resident-review-body">
              <section className="resident-review-submitted" aria-label="Submitted contact details">
                <div><span>Applicant</span><strong>{selectedRequest.full_name || joinName(selectedRequest)}</strong></div>
                <div><span>Birthdate</span><strong>{formatDate(selectedRequest.birthdate)}</strong></div>
                <div><span>Barangay</span><strong>{selectedRequest.barangay}</strong></div>
                <div><span>Address / purok</span><strong>{selectedRequest.address}</strong></div>
                <div><span>Contact</span><strong>{selectedRequest.contact_number}</strong></div>
                <div><span>Email</span><strong>{selectedRequest.email}</strong></div>
              </section>

              {matchLoading ? (
                <div className="resident-review-state" role="status"><FontAwesomeIcon icon={faCircleNotch} spin /> Checking the resident roster…</div>
              ) : matchError ? (
                <div className="resident-review-state is-error" role="alert">
                  <FontAwesomeIcon icon={faTriangleExclamation} /><span>{matchError}</span>
                  <button type="button" onClick={() => {
                    setMatchError("");
                    setMatchLoading(true);
                    setMatchRetryKey((current) => current + 1);
                  }}>Retry match check</button>
                </div>
              ) : matchBanner ? (
                <>
                  <div className={`resident-match-banner ${matchBanner.className}`} role="status">
                    <FontAwesomeIcon icon={matchResult.status === "match" ? faCircleCheck : faTriangleExclamation} />
                    <span><strong>{matchBanner.title}</strong>{matchBanner.text}</span>
                  </div>
                  {matchResult.status !== "none" && (matchResult.matches || []).map(renderComparison)}
                  {matchResult.status === "none" && isPendingRequest && (
                    <form className="resident-manual-search" onSubmit={searchRoster}>
                      <label htmlFor="resident-roster-search">Search the resident roster</label>
                      <div className="resident-manual-search-controls">
                        <input
                          id="resident-roster-search"
                          value={manualSearch}
                          onChange={(event) => setManualSearch(event.target.value)}
                          placeholder="Enter a resident name"
                        />
                        <button type="submit" disabled={manualLoading}>
                          <FontAwesomeIcon icon={manualLoading ? faCircleNotch : faMagnifyingGlass} spin={manualLoading} />
                          Search
                        </button>
                      </div>
                      {manualError && <p className="resident-review-inline-error" role="alert">{manualError}</p>}
                      {manualResults.map((resident) => (
                        <button
                          type="button"
                          className={`resident-manual-result ${selectedResident?.id === resident.id ? "is-selected" : ""}`}
                          key={resident.id}
                          onClick={() => setSelectedResident(resident)}
                          disabled={resident.already_linked}
                        >
                          <span>
                            <strong>{resident.full_name}</strong>
                            <small>{resident.barangay} · {formatDate(resident.birthdate)}</small>
                            {resident.already_linked && <small className="resident-manual-linked-warning">Already linked to another account</small>}
                          </span>
                          <span>{resident.already_linked ? "Already linked" : `#${resident.id}`}</span>
                        </button>
                      ))}
                    </form>
                  )}
                </>
              ) : null}

              {selectedResident && (
                selectedResident.already_linked
                  ? <p className="resident-registration-warning" role="alert"><FontAwesomeIcon icon={faTriangleExclamation} /> This resident record is already linked to another account.</p>
                  : <p className="resident-link-confirmation" role="status"><FontAwesomeIcon icon={faCheck} /> Linked record: {selectedResident.resident?.full_name || selectedResident.full_name || joinName(selectedResident)}</p>
              )}

              {!isPendingRequest && (
                <div className="resident-reviewed-notice" role="status">
                  <strong>This request has already been {selectedRequest.status}.</strong>
                  {selectedRequest.status === "rejected" && selectedRequest.rejection_reason && (
                    <span>Reason: {selectedRequest.rejection_reason}</span>
                  )}
                </div>
              )}

              {actionError && <p className="resident-review-inline-error" role="alert">{actionError}</p>}
              {decisionResult && (
                <div className="resident-decision-result" role="status">
                  <p><FontAwesomeIcon icon={faCircleCheck} /> {decisionResult.result.message}</p>
                  {!decisionResult.result.email_sent && (
                    <div className="resident-email-warning">
                      <span><FontAwesomeIcon icon={faTriangleExclamation} /> Email not sent.</span>
                      <button type="button" onClick={resendDecisionEmail} disabled={actionLoading}>
                        {actionLoading ? <FontAwesomeIcon icon={faCircleNotch} spin /> : <FontAwesomeIcon icon={faEnvelope} />}
                        Resend email
                      </button>
                    </div>
                  )}
                  {decisionResult.resendMessage && <small>{decisionResult.resendMessage}</small>}
                </div>
              )}

              {showRejectForm && !decisionResult && isPendingRequest && (
                <form className="resident-reject-form" onSubmit={rejectRequest}>
                  <label htmlFor="resident-rejection-reason">Reason for rejection <span>*</span></label>
                  <textarea
                    id="resident-rejection-reason"
                    value={rejectionReason}
                    onChange={(event) => setRejectionReason(event.target.value)}
                    maxLength={2000}
                    rows={3}
                    required
                    disabled={actionLoading}
                  />
                  <div className="resident-review-actions">
                    <button type="button" className="resident-action-secondary" onClick={() => setShowRejectForm(false)} disabled={actionLoading}>Cancel</button>
                    <button type="submit" className="resident-action-danger" disabled={actionLoading || !rejectionReason.trim()}>
                      {actionLoading ? <FontAwesomeIcon icon={faCircleNotch} spin /> : null} Confirm rejection
                    </button>
                  </div>
                </form>
              )}
            </div>

            <footer className="resident-review-footer">
              {decisionResult || !isPendingRequest ? (
                <button type="button" className="resident-action-primary" onClick={closeReview} disabled={actionLoading}>Done</button>
              ) : (
                <>
                  <button type="button" className="resident-action-secondary" onClick={closeReview} disabled={actionLoading}>Close</button>
                  {!showRejectForm && (
                    <button type="button" className="resident-action-danger" onClick={() => setShowRejectForm(true)} disabled={actionLoading || matchLoading}>
                      Reject
                    </button>
                  )}
                  {!showRejectForm && (
                    <button type="button" className="resident-action-primary" onClick={approveRequest} disabled={actionLoading || matchLoading || !selectedResident || selectedResident.already_linked || !selectedResident.available && selectedResident.resident}>
                      {actionLoading ? <FontAwesomeIcon icon={faCircleNotch} spin /> : <FontAwesomeIcon icon={faCheck} />}
                      Approve
                    </button>
                  )}
                </>
              )}
            </footer>
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

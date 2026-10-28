import { useState, useRef, useMemo, useEffect, Fragment } from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faDatabase,
  faFileExcel,
  faBuilding,
  faPlus,
  faRotate,
  faMagnifyingGlass,
  faPenToSquare,
  faTrash,
  faUpload,
  faDownload,
  faCircleCheck,
  faTriangleExclamation,
  faXmark,
  faCircleNotch,
  faUsers,
  faFileCircleCheck,
  faChevronDown,
  faChevronUp,
  faChevronRight,
  faUserPlus,
  faCalendarDays,
} from "@fortawesome/free-solid-svg-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../services/api";
import { useBarangays, invalidateEvacuationQueries } from "../../hooks/useEvacuationQueries";
import "./DataManagement.css";

// Case-insensitive, trimmed, whitespace-collapsed name used for duplicate checks.
function normalizeBarangayName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function cleanBarangayName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function DataManagement() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Role Protection: Ensure only admin can access this page
  useEffect(() => {
    if (user && user.role !== "admin") {
      navigate("/lgu", { replace: true, state: { flashMessage: "Admins only" } });
    }
  }, [user, navigate]);

  // Sub-tabs: "import" | "barangays" | "years"
  const [activeSubtab, setActiveSubtab] = useState("import");

  // Notifications
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // =========================================================================
  // SUB-TAB 3: YEARS STATE (VIEW ONLY)
  // =========================================================================
  const [years, setYears] = useState([]);
  const [loadingYears, setLoadingYears] = useState(false);
  const [yearsError, setYearsError] = useState("");

  useEffect(() => {
    if (activeSubtab === "years") {
      fetchYears();
    }
  }, [activeSubtab]);

  async function fetchYears() {
    setLoadingYears(true);
    setYearsError("");
    try {
      const data = await api.getRosterYears();
      setYears(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load roster years:", err);
      setYearsError(err.message || "Failed to load roster years.");
    } finally {
      setLoadingYears(false);
    }
  }

  // =========================================================================
  // SUB-TAB 1: IMPORT RESIDENTS STATE
  // =========================================================================
  const [importFile, setImportFile] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [validating, setValidating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importStep, setImportStep] = useState("upload"); // "upload" | "review" | "result"
  const [stagingToken, setStagingToken] = useState(null);
  const [stagedResult, setStagedResult] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [reviewTab, setReviewTab] = useState("updated"); // "updated" | "new" | "skipped"
  const [reviewSearch, setReviewSearch] = useState("");
  const [reviewPage, setReviewPage] = useState(1);
  const [expandedRowKey, setExpandedRowKey] = useState(null);
  const fileInputRef = useRef(null);
  // Incremented on every new stage / reset so late responses from an older
  // stage request are ignored and can never overwrite the current token.
  const stageRequestRef = useRef(0);

  // Refresh everything that depends on barangays / households.
  async function refreshDependentData() {
    await Promise.all([
      invalidateEvacuationQueries(queryClient),
      queryClient.invalidateQueries({ queryKey: ["evacuation-center-details"] }),
    ]);
  }

  // Stage an upload: validates the file but saves nothing to live data.
  async function runStageValidation(file) {
    if (!file) return;
    const requestId = ++stageRequestRef.current;
    setValidating(true);
    setErrorMsg("");
    setSuccessMsg("");
    setStagedResult(null);
    setStagingToken(null);
    setImportResult(null);
    setImportStep("upload");

    try {
      const staged = await api.stageFamilyImport(file);
      if (requestId !== stageRequestRef.current) return;
      setStagingToken(staged.staging_token);
      setStagedResult(staged);
      const hasUpdated = staged.families?.some((f) => f.status === "updated");
      setReviewTab(hasUpdated ? "updated" : "new");
      setReviewSearch("");
      setReviewPage(1);
      setExpandedRowKey(null);
      setImportStep("review");
    } catch (err) {
      if (requestId !== stageRequestRef.current) return;
      console.error("Stage validation failed:", err);
      setErrorMsg(err.message || "Failed to check the Excel file.");
    } finally {
      if (requestId === stageRequestRef.current) {
        setValidating(false);
      }
    }
  }

  function handleFileSelect(selected) {
    if (!selected) return;
    const name = selected.name || "";
    if (name.match(/\.xls$/i)) {
      setErrorMsg("Please save the file as .xlsx and upload again.");
      return;
    }
    if (!name.match(/\.xlsx$/i)) {
      setErrorMsg("Please select a valid Excel file (.xlsx).");
      return;
    }
    setImportFile(selected);
    runStageValidation(selected);
  }

  // Drag and drop handlers
  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  }

  function clearSelectedFile() {
    stageRequestRef.current += 1; // ignore any stage request still in flight
    setValidating(false);
    setImportFile(null);
    setStagedResult(null);
    setStagingToken(null);
    setImportResult(null);
    setReviewTab("updated");
    setReviewSearch("");
    setReviewPage(1);
    setExpandedRowKey(null);
    setImportStep("upload");
    setErrorMsg("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  // Commit Import: requires a valid staging token. Server re-validates before saving.
  async function handleCommitImport() {
    const tokenToCommit = stagingToken;
    // Only commit the token that belongs to the currently reviewed file.
    if (
      !tokenToCommit ||
      !stagedResult?.can_import ||
      stagedResult.staging_token !== tokenToCommit
    ) {
      return;
    }
    setImporting(true);
    setErrorMsg("");
    try {
      const result = await api.commitFamilyImport(tokenToCommit);
      await refreshDependentData();

      const created = result.families_created ?? 0;
      const updated = result.families_updated ?? 0;
      const skipped = result.families_skipped ?? 0;
      const membersFilled = result.members_filled ?? 0;
      setImportResult({
        status: "success",
        message: `Import completed successfully. ${created} created, ${updated} updated, ${skipped} skipped.`,
        filename: importFile?.name || stagedResult?.filename || "",
        created,
        updated,
        skipped,
        residentsAdded: result.residents_created ?? 0,
        membersFilled,
      });

      // Reset the upload state, but keep the result visible until the
      // user starts a new upload. The used token is discarded.
      stageRequestRef.current += 1;
      setImportFile(null);
      setStagedResult(null);
      setStagingToken(null);
      setShowConfirmModal(false);
      setImportStep("result");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (err) {
      console.error("Commit import failed:", err);
      setErrorMsg(err.message || "Failed to commit Excel import.");
      setShowConfirmModal(false);
    } finally {
      setImporting(false);
    }
  }

  async function handleDownloadTemplate() {
    try {
      setDownloadingTemplate(true);
      const blob = await api.downloadFamilyTemplate();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", "EvacWay_Household_Import_Template.xlsx");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download template failed:", err);
      setErrorMsg(err.message || "Failed to download Excel template.");
    } finally {
      setDownloadingTemplate(false);
    }
  }

  // =========================================================================
  // SUB-TAB 2: BARANGAYS STATE
  // =========================================================================
  const barangaysQuery = useBarangays();
  const barangays = Array.isArray(barangaysQuery.data) ? barangaysQuery.data : [];
  const [searchQuery, setSearchQuery] = useState("");

  // Add Barangay Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addName, setAddName] = useState("");
  const [addPopulation, setAddPopulation] = useState(0);
  const [addingBarangay, setAddingBarangay] = useState(false);
  const [addError, setAddError] = useState("");

  // Edit Barangay Modal
  const [editModalTarget, setEditModalTarget] = useState(null);
  const [editName, setEditName] = useState("");
  const [editPopulation, setEditPopulation] = useState(0);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState("");

  // Delete Barangay Modal
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletingBarangay, setDeletingBarangay] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  // Filtered Barangays
  const filteredBarangays = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return barangays;
    return barangays.filter((b) => (b.name || "").toLowerCase().includes(q));
  }, [barangays, searchQuery]);

  // Returns an existing barangay with the same normalized name, if any.
  function findDuplicateBarangay(name, excludeId = null) {
    const key = normalizeBarangayName(name);
    return barangays.find(
      (b) => b.id !== excludeId && normalizeBarangayName(b.name) === key
    );
  }

  // Open Add Modal
  function openAddModal() {
    setAddName("");
    setAddPopulation(0);
    setAddError("");
    setShowAddModal(true);
  }

  // Handle Add Barangay Submit
  async function handleAddBarangay(e) {
    e.preventDefault();
    const trimmed = cleanBarangayName(addName);
    if (!trimmed) {
      setAddError("Barangay name is required.");
      return;
    }
    const duplicate = findDuplicateBarangay(trimmed);
    if (duplicate) {
      setAddError(`Barangay "${duplicate.name}" already exists.`);
      return;
    }
    const pop = parseInt(addPopulation, 10);
    if (isNaN(pop) || pop < 0) {
      setAddError("Population must be a non-negative integer.");
      return;
    }

    try {
      setAddingBarangay(true);
      setAddError("");
      await api.addBarangay({ name: trimmed, population: pop });
      await refreshDependentData();
      setSuccessMsg(`Barangay "${trimmed}" created successfully.`);
      setShowAddModal(false);
    } catch (err) {
      setAddError(err.message || "Failed to create barangay.");
    } finally {
      setAddingBarangay(false);
    }
  }

  // Open Edit Modal
  function openEditModal(b) {
    setEditModalTarget(b);
    setEditName(b.name || "");
    setEditPopulation(b.population ?? 0);
    setEditError("");
  }

  // Handle Edit Barangay Submit
  async function handleEditBarangay(e) {
    e.preventDefault();
    if (!editModalTarget) return;
    const trimmed = cleanBarangayName(editName);
    if (!trimmed) {
      setEditError("Barangay name is required.");
      return;
    }
    const duplicate = findDuplicateBarangay(trimmed, editModalTarget.id);
    if (duplicate) {
      setEditError(`Barangay "${duplicate.name}" already exists.`);
      return;
    }
    const pop = parseInt(editPopulation, 10);
    if (isNaN(pop) || pop < 0) {
      setEditError("Population must be a non-negative integer.");
      return;
    }

    try {
      setSavingEdit(true);
      setEditError("");
      await api.updateBarangay(editModalTarget.id, { name: trimmed, population: pop });
      await refreshDependentData();
      setSuccessMsg(`Barangay "${trimmed}" updated successfully.`);
      setEditModalTarget(null);
    } catch (err) {
      setEditError(err.message || "Failed to update barangay.");
    } finally {
      setSavingEdit(false);
    }
  }

  // Handle Delete Barangay
  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    try {
      setDeletingBarangay(true);
      setDeleteError("");
      await api.deleteBarangay(deleteTarget.id);
      await refreshDependentData();
      setSuccessMsg(`Barangay "${deleteTarget.name}" deleted successfully.`);
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err.message || "Failed to delete barangay.");
    } finally {
      setDeletingBarangay(false);
    }
  }

  // Do not render any page content until the admin role is confirmed.
  if (!user || user.role !== "admin") {
    return null;
  }

  return (
    <div className="dm-page">
      <div className="dm-root">
        {/* Header */}
        <div className="dm-header">
          <div>
            <h2 className="dm-title">
              <FontAwesomeIcon icon={faDatabase} className="dm-title-icon" />
              Data Management
            </h2>
            <p className="dm-subtitle">
              Import resident rosters from Excel, manage registered barangays, and maintain evacuation masterlists.
            </p>
          </div>

          {/* Sub-tabs Switcher */}
          <div className="dm-subtabs">
            <button
              type="button"
              className={`dm-subtab-btn ${activeSubtab === "import" ? "is-active" : ""}`}
              onClick={() => {
                setActiveSubtab("import");
                setErrorMsg("");
              }}
            >
              <FontAwesomeIcon icon={faFileExcel} />
              Import Residents
            </button>
            <button
              type="button"
              className={`dm-subtab-btn ${activeSubtab === "barangays" ? "is-active" : ""}`}
              onClick={() => {
                setActiveSubtab("barangays");
                setErrorMsg("");
              }}
            >
              <FontAwesomeIcon icon={faBuilding} />
              Barangays
            </button>
            <button
              type="button"
              className={`dm-subtab-btn ${activeSubtab === "years" ? "is-active" : ""}`}
              onClick={() => {
                setActiveSubtab("years");
                setErrorMsg("");
              }}
            >
              <FontAwesomeIcon icon={faCalendarDays} />
              Years
            </button>
          </div>
        </div>

        {/* Global Notices */}
        {successMsg && (
          <div className="dm-alert dm-alert-success">
            <div className="dm-alert-content">
              <FontAwesomeIcon icon={faCircleCheck} />
              <span>{successMsg}</span>
            </div>
            <button
              type="button"
              className="dm-alert-close"
              onClick={() => setSuccessMsg("")}
              aria-label="Dismiss alert"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>
        )}

        {errorMsg && (
          <div className="dm-alert dm-alert-error">
            <div className="dm-alert-content">
              <FontAwesomeIcon icon={faTriangleExclamation} />
              <span>{errorMsg}</span>
            </div>
            <button
              type="button"
              className="dm-alert-close"
              onClick={() => setErrorMsg("")}
              aria-label="Dismiss alert"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>
        )}

        {/* =========================================================================
            SUB-TAB 1: IMPORT RESIDENTS
            ========================================================================= */}
        {activeSubtab === "import" && (
          <div className="dm-card">
            <div className="dm-import-intro">
              <div className="dm-import-heading">
                <h3>Excel Resident Roster Import</h3>
                <p>
                  Upload an Excel file (.xlsx) containing household heads and family members.
                  The system will check the file first and show you what will be added, updated, or left unchanged before anything is saved.
                </p>
              </div>

              <button
                type="button"
                className="dm-template-btn"
                onClick={handleDownloadTemplate}
                disabled={downloadingTemplate}
              >
                <FontAwesomeIcon icon={downloadingTemplate ? faCircleNotch : faDownload} spin={downloadingTemplate} />
                {downloadingTemplate ? "Downloading..." : "Download Excel Template"}
              </button>
            </div>

            {/* Drag & Drop File Upload Area */}
            {!importFile ? (
              <div
                className={`dm-dropzone ${dragActive ? "is-dragging" : ""}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx"
                  className="dm-file-input"
                  onChange={(e) => handleFileSelect(e.target.files?.[0])}
                />
                <FontAwesomeIcon icon={faUpload} className="dm-dropzone-icon" />
                <h4 className="dm-dropzone-title">Click to upload or drag & drop Excel file</h4>
                <p className="dm-dropzone-sub">Supports .xlsx files only</p>
              </div>
            ) : (
              <div className="dm-file-info">
                <div className="dm-file-meta">
                  <FontAwesomeIcon icon={faFileExcel} className="dm-file-icon" />
                  <div>
                    <div className="dm-file-name">{importFile.name}</div>
                    <div className="dm-file-size">{(importFile.size / 1024).toFixed(1)} KB</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <button
                    type="button"
                    className="dm-btn dm-btn-secondary dm-btn-sm"
                    onClick={() => runStageValidation(importFile)}
                    disabled={validating || importing}
                  >
                    <FontAwesomeIcon icon={faRotate} spin={validating} />
                    {validating ? "Checking..." : "Re-check"}
                  </button>
                  <button
                    type="button"
                    className="dm-file-remove"
                    onClick={clearSelectedFile}
                    disabled={validating || importing}
                    title="Remove file"
                  >
                    <FontAwesomeIcon icon={faXmark} />
                  </button>
                </div>
              </div>
            )}

            {/* File Check Loading */}
            {validating && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "30px 0", gap: "10px", color: "var(--brand, #2563eb)" }}>
                <FontAwesomeIcon icon={faCircleNotch} spin style={{ fontSize: "20px" }} />
                <span style={{ fontSize: "14px", fontWeight: "600" }}>Checking the file. Nothing is saved yet...</span>
              </div>
            )}

            {/* Validation Summary & Review */}
            {importStep === "review" && stagedResult && !validating && (() => {
              const hasErrors = stagedResult.errors?.length > 0;
              const newHouseholds = stagedResult.families?.filter((f) => f.status === "new") || [];
              const updatedHouseholds = stagedResult.families?.filter((f) => f.status === "updated") || [];
              const skippedHouseholds = stagedResult.families?.filter((f) => f.status === "skipped") || [];
              const canImport = Boolean(stagedResult.can_import && !hasErrors);

              return (
                <>
                  <div className="dm-summary-grid">
                    <div className="dm-summary-card">
                      <span className="dm-summary-label">Rows Read</span>
                      <span className="dm-summary-val">{stagedResult.rows ?? 0}</span>
                    </div>
                    <div className="dm-summary-card">
                      <span className="dm-summary-label">New Households</span>
                      <span className="dm-summary-val">{stagedResult.new_households ?? 0}</span>
                    </div>
                    <div className="dm-summary-card">
                      <span className="dm-summary-label">Updated Households</span>
                      <span className="dm-summary-val">
                        {stagedResult.updated_households ?? 0}
                        <span className="dm-summary-sub">
                          ({stagedResult.new_members_to_add ?? 0} new member{stagedResult.new_members_to_add === 1 ? "" : "s"}
                          {stagedResult.members_to_fill > 0 ? `, ${stagedResult.members_to_fill} with fields to fill` : ""})
                        </span>
                      </span>
                    </div>
                    <div className="dm-summary-card">
                      <span className="dm-summary-label">Skipped</span>
                      <span className="dm-summary-val">
                        {stagedResult.skipped_households ?? 0}
                        <span className="dm-summary-sub">Already registered</span>
                      </span>
                    </div>
                    <div
                      className={`dm-summary-card ${
                        hasErrors
                          ? "is-status-error"
                          : canImport
                          ? "is-status"
                          : "is-status-muted"
                      }`}
                    >
                      <span className="dm-summary-label">File Check</span>
                      <span
                        className={`dm-summary-status-text ${
                          hasErrors ? "fail" : canImport ? "ok" : "muted"
                        }`}
                      >
                        <FontAwesomeIcon
                          icon={
                            hasErrors
                              ? faTriangleExclamation
                              : faCircleCheck
                          }
                        />
                        {hasErrors
                          ? "Needs Fixing"
                          : canImport
                          ? "Ready to Import"
                          : "Nothing New to Import"}
                      </span>
                    </div>
                  </div>

                  {/* Errors List */}
                  {stagedResult.errors?.length > 0 && (
                    <div className="dm-issues-box is-error">
                      <h5 className="dm-issues-title">
                        <FontAwesomeIcon icon={faTriangleExclamation} />
                        {stagedResult.errors.length} Error{stagedResult.errors.length === 1 ? "" : "s"} Found in File
                      </h5>
                      <ul className="dm-issues-list">
                        {stagedResult.errors.map((err, idx) => (
                          <li key={idx}>
                            {err.row > 0 ? <strong>Row {err.row}: </strong> : null}
                            {err.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Warnings List */}
                  {stagedResult.warnings?.length > 0 && (
                    <div className="dm-issues-box is-warning">
                      <h5 className="dm-issues-title">
                        <FontAwesomeIcon icon={faTriangleExclamation} />
                        Warnings ({stagedResult.warnings.length})
                      </h5>
                      <ul className="dm-issues-list">
                        {stagedResult.warnings.map((w, idx) => (
                          <li key={idx}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Unified Review Table */}
                  <div className="dm-review-table-section">
                    <div className="dm-review-toolbar">
                      <div className="dm-review-tabs">
                        <button
                          type="button"
                          className={`dm-review-tab ${reviewTab === "updated" ? "is-active" : ""}`}
                          onClick={() => {
                            setReviewTab("updated");
                            setReviewPage(1);
                            setExpandedRowKey(null);
                          }}
                        >
                          Updated <span className="dm-review-tab-count">({updatedHouseholds.length})</span>
                        </button>
                        <button
                          type="button"
                          className={`dm-review-tab ${reviewTab === "new" ? "is-active" : ""}`}
                          onClick={() => {
                            setReviewTab("new");
                            setReviewPage(1);
                            setExpandedRowKey(null);
                          }}
                        >
                          New <span className="dm-review-tab-count">({newHouseholds.length})</span>
                        </button>
                        <button
                          type="button"
                          className={`dm-review-tab ${reviewTab === "skipped" ? "is-active" : ""}`}
                          onClick={() => {
                            setReviewTab("skipped");
                            setReviewPage(1);
                            setExpandedRowKey(null);
                          }}
                        >
                          Skipped <span className="dm-review-tab-count">({skippedHouseholds.length})</span>
                        </button>
                      </div>

                      <div className="dm-review-search-wrap">
                        <FontAwesomeIcon icon={faMagnifyingGlass} className="dm-review-search-icon" />
                        <input
                          type="text"
                          className="dm-review-search-input"
                          placeholder="Search head name, barangay, or family code..."
                          value={reviewSearch}
                          onChange={(e) => {
                            setReviewSearch(e.target.value);
                            setReviewPage(1);
                            setExpandedRowKey(null);
                          }}
                        />
                        {reviewSearch && (
                          <button
                            type="button"
                            className="dm-review-search-clear"
                            onClick={() => {
                              setReviewSearch("");
                              setReviewPage(1);
                              setExpandedRowKey(null);
                            }}
                            title="Clear search"
                          >
                            <FontAwesomeIcon icon={faXmark} />
                          </button>
                        )}
                      </div>
                    </div>

                    {reviewTab === "skipped" && (
                      <div style={{ fontSize: "13px", color: "var(--muted, #64748b)", margin: "-4px 0 2px 2px" }}>
                        These households are already registered with the same details and will not be changed.
                      </div>
                    )}

                    <div className="dm-review-table-wrapper">
                      {(() => {
                        const currentList =
                          reviewTab === "updated"
                            ? updatedHouseholds
                            : reviewTab === "new"
                            ? newHouseholds
                            : skippedHouseholds;

                        const trimmedSearch = reviewSearch.trim().toLowerCase();
                        const filteredRows = trimmedSearch
                          ? currentList.filter((f) => {
                              const head = String(f.head_name || "").toLowerCase();
                              const brgy = String(f.barangay || "").toLowerCase();
                              const code = String(f.family_code || "").toLowerCase();
                              return (
                                head.includes(trimmedSearch) ||
                                brgy.includes(trimmedSearch) ||
                                code.includes(trimmedSearch)
                              );
                            })
                          : currentList;

                        const PAGE_SIZE = 25;
                        const totalCount = filteredRows.length;
                        const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
                        const currentPage = Math.min(Math.max(1, reviewPage), totalPages);
                        const startRow = (currentPage - 1) * PAGE_SIZE;
                        const paginatedRows = filteredRows.slice(startRow, startRow + PAGE_SIZE);

                        const paginationText =
                          totalCount === 0
                            ? "Showing 0 of 0"
                            : `Showing ${startRow + 1}-${Math.min(startRow + PAGE_SIZE, totalCount)} of ${totalCount}`;

                        return (
                          <>
                            <table className="dm-review-table">
                              <thead>
                                <tr>
                                  <th style={{ width: "36%" }}>Household Head</th>
                                  <th style={{ width: "24%" }}>Barangay</th>
                                  <th style={{ width: "12%" }}>Members</th>
                                  <th style={{ width: "28%" }}>Change</th>
                                </tr>
                              </thead>
                              <tbody>
                                {paginatedRows.length === 0 ? (
                                  <tr>
                                    <td colSpan={4} className="dm-review-table-empty">
                                      {trimmedSearch ? (
                                        <>No households match &ldquo;<strong>{reviewSearch}</strong>&rdquo; in this tab.</>
                                      ) : (
                                        <>No {reviewTab} households in this file.</>
                                      )}
                                    </td>
                                  </tr>
                                ) : (
                                  paginatedRows.map((f, idx) => {
                                    const rowKey = f.family_code ? `${f.family_code}-${startRow + idx}` : `f-${f.head_name}-${startRow + idx}`;
                                    const isExpanded = expandedRowKey === rowKey;
                                    const memberCount =
                                      f.member_count ??
                                      (f.members?.length ||
                                        (f.existing_members?.length || 0) + (f.new_members?.length || 0) ||
                                        1);

                                    return (
                                      <Fragment key={rowKey}>
                                        <tr
                                          className={`dm-review-row ${isExpanded ? "is-expanded" : ""}`}
                                          onClick={() => setExpandedRowKey(isExpanded ? null : rowKey)}
                                        >
                                          <td>
                                            <div className="dm-review-head-cell">
                                              <FontAwesomeIcon
                                                icon={isExpanded ? faChevronDown : faChevronRight}
                                                className={`dm-review-expand-icon ${isExpanded ? "is-open" : ""}`}
                                              />
                                              <div className="dm-review-head-meta">
                                                <span className="dm-review-head-name">{f.head_name || "—"}</span>
                                                {f.family_code && (
                                                  <span className="dm-review-family-code">{f.family_code}</span>
                                                )}
                                              </div>
                                            </div>
                                          </td>
                                          <td>{f.barangay || "—"}</td>
                                          <td>{memberCount}</td>
                                          <td>
                                            {(f.status === "updated" || reviewTab === "updated") && (
                                              <div className="dm-change-tags">
                                                {(f.new_members?.length ?? 0) > 0 && (
                                                  <span className="dm-change-tag is-green">
                                                    +{f.new_members.length} new member{f.new_members.length === 1 ? "" : "s"}
                                                  </span>
                                                )}
                                                {(f.members_to_fill?.length ?? 0) > 0 && (
                                                  <span className="dm-change-tag is-amber">
                                                    {f.members_to_fill.length} member{f.members_to_fill.length === 1 ? "" : "s"} with fields filled
                                                  </span>
                                                )}
                                                {(!f.new_members || f.new_members.length === 0) &&
                                                  (!f.members_to_fill || f.members_to_fill.length === 0) && (
                                                    <span className="dm-change-tag is-amber">Updated</span>
                                                  )}
                                              </div>
                                            )}
                                            {(f.status === "new" || reviewTab === "new") && (
                                              <span className="dm-change-tag is-blue">New household</span>
                                            )}
                                            {f.status === "skipped" && reviewTab === "skipped" && (
                                              <span className="dm-change-tag is-gray">No changes</span>
                                            )}
                                          </td>
                                        </tr>
                                        {isExpanded && (
                                          <tr className="dm-review-expanded-row">
                                            <td colSpan={4} className="dm-review-expanded-cell">
                                              <div className="dm-review-expanded-content">
                                                <div className="dm-member-pills">
                                                  {/* New members (green "+ name") */}
                                                  {((f.status === "new" || reviewTab === "new")
                                                    ? (f.members || [])
                                                    : (f.new_members || [])
                                                  ).map((m, mIdx) => (
                                                    <span key={`new-${mIdx}`} className="dm-member-pill is-new">
                                                      + {m.full_name || `${m.first_name || ""} ${m.last_name || ""}`.trim() || "Member"}
                                                    </span>
                                                  ))}
                                                  {/* Blank fields filled members (amber "name") */}
                                                  {(f.members_to_fill || []).map((m, fillIdx) => (
                                                    <span key={`fill-${fillIdx}`} className="dm-member-pill is-filled">
                                                      {m.name}
                                                    </span>
                                                  ))}
                                                  {/* Existing members: count only */}
                                                  {(() => {
                                                    const count =
                                                      f.status === "skipped" || reviewTab === "skipped"
                                                        ? (f.existing_members?.length || f.member_count || 1)
                                                        : (f.status === "updated" || reviewTab === "updated")
                                                        ? (f.existing_members?.length || 0)
                                                        : 0;
                                                    if (count > 0) {
                                                      return (
                                                        <span className="dm-member-pill is-existing">
                                                          {count} existing member{count === 1 ? "" : "s"}
                                                        </span>
                                                      );
                                                    }
                                                    return null;
                                                  })()}
                                                </div>
                                              </div>
                                            </td>
                                          </tr>
                                        )}
                                      </Fragment>
                                    );
                                  })
                                )}
                              </tbody>
                            </table>

                            {/* Pagination */}
                            <div className="dm-review-pagination">
                              <span className="dm-pagination-info">{paginationText}</span>
                              <div className="dm-pagination-controls">
                                <button
                                  type="button"
                                  className="dm-pagination-btn"
                                  onClick={() => {
                                    setReviewPage((p) => Math.max(1, p - 1));
                                    setExpandedRowKey(null);
                                  }}
                                  disabled={currentPage <= 1}
                                >
                                  Previous
                                </button>
                                <button
                                  type="button"
                                  className="dm-pagination-btn"
                                  onClick={() => {
                                    setReviewPage((p) => Math.min(totalPages, p + 1));
                                    setExpandedRowKey(null);
                                  }}
                                  disabled={currentPage >= totalPages || totalCount === 0}
                                >
                                  Next
                                </button>
                              </div>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="dm-import-actions">
                    {!canImport && !hasErrors && (
                      <span style={{ fontSize: "13px", color: "var(--muted, #64748b)", marginRight: "auto" }}>
                        Nothing to add. Everyone in this file is already registered.
                      </span>
                    )}
                    <button
                      type="button"
                      className="dm-btn dm-btn-secondary"
                      onClick={clearSelectedFile}
                      disabled={importing}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="dm-btn dm-btn-primary"
                      disabled={!canImport || importing}
                      onClick={() => setShowConfirmModal(true)}
                    >
                      <FontAwesomeIcon icon={faFileCircleCheck} />
                      Confirm & Commit Import
                    </button>
                  </div>
                </>
              );
            })()}

            {/* Import Result Summary (stays visible until a new upload starts) */}
            {importStep === "result" && importResult && !validating && (
              <>
                <div className="dm-alert dm-alert-success">
                  <div className="dm-alert-content">
                    <FontAwesomeIcon icon={faCircleCheck} />
                    <span>
                      {importResult.message}
                      {importResult.filename ? ` (${importResult.filename})` : ""}
                    </span>
                  </div>
                </div>
                <div className="dm-summary-grid">
                  <div className="dm-summary-card">
                    <span className="dm-summary-label">Households Created</span>
                    <span className="dm-summary-val">{importResult.created}</span>
                  </div>
                  <div className="dm-summary-card">
                    <span className="dm-summary-label">Households Updated</span>
                    <span className="dm-summary-val">{importResult.updated}</span>
                  </div>
                  <div className="dm-summary-card">
                    <span className="dm-summary-label">Skipped</span>
                    <span className="dm-summary-val">{importResult.skipped}</span>
                  </div>
                  <div className="dm-summary-card is-status">
                    <span className="dm-summary-label">Residents Added</span>
                    <span className="dm-summary-val">
                      {importResult.residentsAdded}
                      {importResult.membersFilled > 0 && (
                        <span className="dm-summary-sub">
                          (+{importResult.membersFilled} blank fields filled)
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* =========================================================================
            SUB-TAB 2: BARANGAYS
            ========================================================================= */}
        {activeSubtab === "barangays" && (
          <div className="dm-card">
            {/* Toolbar */}
            <div className="dm-toolbar">
              <div className="dm-search-wrap">
                <FontAwesomeIcon icon={faMagnifyingGlass} className="dm-search-icon" />
                <input
                  type="text"
                  className="dm-search-input"
                  placeholder="Search barangays by name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <div className="dm-toolbar-actions">
                <button
                  type="button"
                  className="dm-btn dm-btn-secondary"
                  onClick={() => barangaysQuery.refetch()}
                  disabled={barangaysQuery.isLoading || barangaysQuery.isFetching}
                >
                  <FontAwesomeIcon
                    icon={faRotate}
                    spin={barangaysQuery.isLoading || barangaysQuery.isFetching}
                  />
                  Refresh
                </button>
                <button
                  type="button"
                  className="dm-btn dm-btn-primary"
                  onClick={openAddModal}
                >
                  <FontAwesomeIcon icon={faPlus} />
                  Add Barangay
                </button>
              </div>
            </div>

            {/* Content Table & Mobile Cards */}
            {barangaysQuery.isLoading ? (
              <div style={{ textAlign: "center", padding: "40px 0", color: "var(--muted, #64748b)" }}>
                <FontAwesomeIcon icon={faCircleNotch} spin style={{ fontSize: "24px", marginBottom: "8px" }} />
                <p>Loading registered barangays...</p>
              </div>
            ) : filteredBarangays.length === 0 ? (
              <div className="dm-empty-state">
                <FontAwesomeIcon icon={faBuilding} className="dm-empty-icon" />
                <p>
                  {searchQuery ? `No barangays match "${searchQuery}".` : "No barangays registered yet."}
                </p>
                {!searchQuery && (
                  <button type="button" className="dm-btn dm-btn-primary" onClick={openAddModal}>
                    <FontAwesomeIcon icon={faPlus} /> Add First Barangay
                  </button>
                )}
              </div>
            ) : (
              <>
                {/* Desktop Table View */}
                <div className="dm-table-wrap dm-desktop-table">
                  <table className="dm-table">
                    <thead>
                      <tr>
                        <th>Barangay Name</th>
                        <th>Population</th>
                        <th>Registered Residents</th>
                        <th>Linked Centers</th>
                        <th className="dm-th-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredBarangays.map((b) => {
                        const pop = Number(b.population || 0);
                        const resCount = Number(b.resident_count ?? b.total_residents ?? 0);
                        const centerCount = Number(b.evacuation_center_count ?? 0);

                        return (
                          <tr key={b.id}>
                            <td>
                              <strong style={{ fontWeight: "700", color: "var(--text-0, #0f172a)" }}>
                                {b.name}
                              </strong>
                            </td>
                            <td>{pop > 0 ? pop.toLocaleString() : "0"}</td>
                            <td>
                              <span className="dm-badge dm-badge-blue">
                                <FontAwesomeIcon icon={faUsers} style={{ marginRight: 5 }} />
                                {resCount.toLocaleString()} resident{resCount === 1 ? "" : "s"}
                              </span>
                            </td>
                            <td>
                              <span className="dm-badge dm-badge-green">
                                <FontAwesomeIcon icon={faBuilding} style={{ marginRight: 5 }} />
                                {centerCount} center{centerCount === 1 ? "" : "s"}
                              </span>
                            </td>
                            <td className="dm-td-right">
                              <div className="dm-action-btns">
                                <button
                                  type="button"
                                  className="dm-icon-btn"
                                  title="Edit Barangay"
                                  onClick={() => openEditModal(b)}
                                >
                                  <FontAwesomeIcon icon={faPenToSquare} />
                                </button>
                                <button
                                  type="button"
                                  className="dm-icon-btn is-delete"
                                  title="Delete Barangay"
                                  onClick={() => {
                                    setDeleteError("");
                                    setDeleteTarget(b);
                                  }}
                                >
                                  <FontAwesomeIcon icon={faTrash} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Cards View (< 720px) */}
                <div className="dm-mobile-cards">
                  {filteredBarangays.map((b) => {
                    const pop = Number(b.population || 0);
                    const resCount = Number(b.resident_count ?? b.total_residents ?? 0);
                    const centerCount = Number(b.evacuation_center_count ?? 0);

                    return (
                      <div key={b.id} className="dm-mobile-card">
                        <div className="dm-mobile-top">
                          <h4 className="dm-mobile-name">{b.name}</h4>
                          <span className="dm-badge dm-badge-blue">
                            {resCount} resident{resCount === 1 ? "" : "s"}
                          </span>
                        </div>

                        <div className="dm-mobile-grid">
                          <div>
                            <span>Population</span>
                            <strong>{pop > 0 ? pop.toLocaleString() : "0"}</strong>
                          </div>
                          <div>
                            <span>Residents</span>
                            <strong>{resCount.toLocaleString()}</strong>
                          </div>
                          <div>
                            <span>Centers</span>
                            <strong>{centerCount}</strong>
                          </div>
                        </div>

                        <div className="dm-mobile-actions">
                          <button
                            type="button"
                            className="dm-btn dm-btn-secondary dm-btn-sm"
                            onClick={() => openEditModal(b)}
                          >
                            <FontAwesomeIcon icon={faPenToSquare} /> Edit
                          </button>
                          <button
                            type="button"
                            className="dm-btn dm-btn-danger dm-btn-sm"
                            onClick={() => {
                              setDeleteError("");
                              setDeleteTarget(b);
                            }}
                          >
                            <FontAwesomeIcon icon={faTrash} /> Delete
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* =========================================================================
            SUB-TAB 3: YEARS (VIEW ONLY)
            ========================================================================= */}
        {activeSubtab === "years" && (
          <div className="dm-card">
            <div className="dm-card-header">
              <div>
                <h3 className="dm-card-title">
                  <FontAwesomeIcon icon={faCalendarDays} style={{ color: "var(--brand, #2563eb)", marginRight: "8px" }} />
                  Roster Years
                </h3>
                <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--muted, #64748b)" }}>
                  The active year follows the current calendar year. New years are created automatically.
                </p>
              </div>
            </div>

            {yearsError && (
              <div className="dm-alert dm-alert-error" style={{ margin: "16px 20px 0" }}>
                <div className="dm-alert-content">
                  <FontAwesomeIcon icon={faTriangleExclamation} />
                  <span>{yearsError}</span>
                </div>
              </div>
            )}

            {loadingYears ? (
              <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--muted, #64748b)" }}>
                <FontAwesomeIcon icon={faCircleNotch} spin style={{ fontSize: "24px", marginBottom: "8px" }} />
                <div>Loading roster years...</div>
              </div>
            ) : years.length === 0 ? (
              <div className="dm-empty-state">
                <FontAwesomeIcon icon={faCalendarDays} className="dm-empty-icon" />
                <p>No roster years found.</p>
              </div>
            ) : (
              <div className="dm-table-wrapper">
                <table className="dm-table">
                  <thead>
                    <tr>
                      <th style={{ width: "200px" }}>Year</th>
                      <th style={{ width: "200px" }}>Status</th>
                      <th>Households</th>
                    </tr>
                  </thead>
                  <tbody>
                    {years.map((y) => (
                      <tr key={y.id || y.year}>
                        <td>
                          <strong>{y.year}</strong>
                        </td>
                        <td>
                          {y.is_active ? (
                            <span className="dm-badge dm-badge-green">Active</span>
                          ) : (
                            <span className="dm-badge" style={{ color: "var(--muted, #64748b)" }}>Inactive</span>
                          )}
                        </td>
                        <td>
                          {(y.households ?? y.household_count ?? 0).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* =========================================================================
            MODAL 1: CONFIRM COMMIT IMPORT
            ========================================================================= */}
        {showConfirmModal && (() => {
          const newCount = stagedResult?.new_households ?? 0;
          const newResCount =
            stagedResult?.families
              ?.filter((f) => f.status === "new")
              .reduce((acc, f) => acc + (f.member_count || f.members?.length || 0), 0) ?? 0;
          const updatedCount = stagedResult?.updated_households ?? 0;
          const updatedMembersCount = stagedResult?.new_members_to_add ?? 0;
          const skippedCount = stagedResult?.skipped_households ?? 0;

          return (
            <div className="dm-modal-overlay" onClick={() => !importing && setShowConfirmModal(false)}>
              <div className="dm-modal-card" onClick={(e) => e.stopPropagation()}>
                <div className="dm-modal-header">
                  <h4 className="dm-modal-title">Confirm Roster Import</h4>
                  <button
                    type="button"
                    className="dm-modal-close"
                    onClick={() => setShowConfirmModal(false)}
                    disabled={importing}
                  >
                    <FontAwesomeIcon icon={faXmark} />
                  </button>
                </div>
                <div className="dm-modal-body">
                  <p style={{ margin: "0 0 10px", fontWeight: "600", color: "var(--text-0, #0f172a)" }}>
                    You are about to commit:
                  </p>
                  <ul style={{ margin: "0 0 14px 20px", padding: 0, fontSize: "13.5px", lineHeight: "1.6", color: "var(--text-0, #0f172a)" }}>
                    <li>
                      <strong>{newCount} new household{newCount === 1 ? "" : "s"}</strong> ({newResCount} resident{newResCount === 1 ? "" : "s"})
                    </li>
                    <li>
                      <strong>{updatedCount} updated household{updatedCount === 1 ? "" : "s"}</strong> ({updatedMembersCount} new member{updatedMembersCount === 1 ? "" : "s"} added
                      {stagedResult?.members_to_fill > 0 && `, ${stagedResult.members_to_fill} existing member${stagedResult.members_to_fill === 1 ? "" : "s"} with blank fields filled`})
                    </li>
                    <li>
                      <strong>{skippedCount} household{skippedCount === 1 ? "" : "s"} skipped</strong> (already up to date)
                    </li>
                  </ul>
                  <div className="dm-alert dm-alert-warning" style={{ margin: "0 0 12px" }}>
                    <div className="dm-alert-content">
                      <FontAwesomeIcon icon={faTriangleExclamation} />
                      <span>Existing room assignments will not be changed. Live dashboards and center statistics will automatically synchronize.</span>
                    </div>
                  </div>
                  <p style={{ margin: 0, fontWeight: "600", color: "var(--text-0, #0f172a)" }}>
                    Continue?
                  </p>
                </div>
                <div className="dm-modal-footer">
                  <button
                    type="button"
                    className="dm-btn dm-btn-secondary"
                    disabled={importing}
                    onClick={() => setShowConfirmModal(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="dm-btn dm-btn-primary"
                    disabled={importing}
                    onClick={handleCommitImport}
                  >
                    <FontAwesomeIcon icon={importing ? faCircleNotch : faFileCircleCheck} spin={importing} />
                    {importing ? "Committing Import..." : "Yes, Commit Import"}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* =========================================================================
            MODAL 2: ADD BARANGAY
            ========================================================================= */}
        {showAddModal && (
          <div className="dm-modal-overlay" onClick={() => !addingBarangay && setShowAddModal(false)}>
            <div className="dm-modal-card" onClick={(e) => e.stopPropagation()}>
              <div className="dm-modal-header">
                <h4 className="dm-modal-title">Add New Barangay</h4>
                <button
                  type="button"
                  className="dm-modal-close"
                  onClick={() => setShowAddModal(false)}
                  disabled={addingBarangay}
                >
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              </div>
              <form onSubmit={handleAddBarangay}>
                <div className="dm-modal-body">
                  {addError && (
                    <div className="dm-alert dm-alert-error" style={{ margin: 0 }}>
                      <div className="dm-alert-content">
                        <FontAwesomeIcon icon={faTriangleExclamation} />
                        <span>{addError}</span>
                      </div>
                    </div>
                  )}

                  <div className="dm-form-group">
                    <label>Barangay Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Poblacion"
                      value={addName}
                      onChange={(e) => setAddName(e.target.value)}
                    />
                  </div>

                  <div className="dm-form-group">
                    <label>Population</label>
                    <input
                      type="number"
                      min="0"
                      placeholder="e.g. 2500"
                      value={addPopulation}
                      onChange={(e) => setAddPopulation(e.target.value)}
                    />
                    <span className="dm-form-hint">Official census or registered resident estimate</span>
                  </div>
                </div>

                <div className="dm-modal-footer">
                  <button
                    type="button"
                    className="dm-btn dm-btn-secondary"
                    disabled={addingBarangay}
                    onClick={() => setShowAddModal(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="dm-btn dm-btn-primary"
                    disabled={addingBarangay}
                  >
                    <FontAwesomeIcon icon={addingBarangay ? faCircleNotch : faPlus} spin={addingBarangay} />
                    {addingBarangay ? "Adding..." : "Add Barangay"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* =========================================================================
            MODAL 3: EDIT BARANGAY
            ========================================================================= */}
        {editModalTarget && (
          <div className="dm-modal-overlay" onClick={() => !savingEdit && setEditModalTarget(null)}>
            <div className="dm-modal-card" onClick={(e) => e.stopPropagation()}>
              <div className="dm-modal-header">
                <h4 className="dm-modal-title">Edit Barangay</h4>
                <button
                  type="button"
                  className="dm-modal-close"
                  onClick={() => setEditModalTarget(null)}
                  disabled={savingEdit}
                >
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              </div>
              <form onSubmit={handleEditBarangay}>
                <div className="dm-modal-body">
                  {editError && (
                    <div className="dm-alert dm-alert-error" style={{ margin: 0 }}>
                      <div className="dm-alert-content">
                        <FontAwesomeIcon icon={faTriangleExclamation} />
                        <span>{editError}</span>
                      </div>
                    </div>
                  )}

                  <div className="dm-form-group">
                    <label>Barangay Name *</label>
                    <input
                      type="text"
                      required
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                  </div>

                  <div className="dm-form-group">
                    <label>Population</label>
                    <input
                      type="number"
                      min="0"
                      value={editPopulation}
                      onChange={(e) => setEditPopulation(e.target.value)}
                    />
                  </div>

                  <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                    <span className="dm-badge dm-badge-blue">
                      {editModalTarget.resident_count ?? editModalTarget.total_residents ?? 0} Registered Residents
                    </span>
                    <span className="dm-badge dm-badge-green">
                      {editModalTarget.evacuation_center_count ?? 0} Linked Centers
                    </span>
                  </div>
                </div>

                <div className="dm-modal-footer">
                  <button
                    type="button"
                    className="dm-btn dm-btn-secondary"
                    disabled={savingEdit}
                    onClick={() => setEditModalTarget(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="dm-btn dm-btn-primary"
                    disabled={savingEdit}
                  >
                    <FontAwesomeIcon icon={savingEdit ? faCircleNotch : faPenToSquare} spin={savingEdit} />
                    {savingEdit ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* =========================================================================
            MODAL 4: DELETE BARANGAY
            ========================================================================= */}
        {deleteTarget && (
          <div className="dm-modal-overlay" onClick={() => !deletingBarangay && setDeleteTarget(null)}>
            <div className="dm-modal-card" onClick={(e) => e.stopPropagation()}>
              <div className="dm-modal-header">
                <h4 className="dm-modal-title">Delete Barangay</h4>
                <button
                  type="button"
                  className="dm-modal-close"
                  onClick={() => setDeleteTarget(null)}
                  disabled={deletingBarangay}
                >
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              </div>
              <div className="dm-modal-body">
                {deleteError && (
                  <div className="dm-alert dm-alert-error" style={{ margin: 0 }}>
                    <div className="dm-alert-content">
                      <FontAwesomeIcon icon={faTriangleExclamation} />
                      <span>{deleteError}</span>
                    </div>
                  </div>
                )}

                <p>
                  Are you sure you want to delete <strong>{deleteTarget.name}</strong>?
                </p>
                <p style={{ fontSize: "12.5px", color: "var(--muted, #64748b)", margin: 0 }}>
                  Barangays with registered households or linked evacuation centers cannot be deleted until their associated records have been transferred or removed.
                </p>
              </div>
              <div className="dm-modal-footer">
                <button
                  type="button"
                  className="dm-btn dm-btn-secondary"
                  disabled={deletingBarangay}
                  onClick={() => setDeleteTarget(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="dm-btn dm-btn-danger"
                  disabled={deletingBarangay}
                  onClick={handleConfirmDelete}
                >
                  <FontAwesomeIcon icon={deletingBarangay ? faCircleNotch : faTrash} spin={deletingBarangay} />
                  {deletingBarangay ? "Deleting..." : "Delete Barangay"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default DataManagement;

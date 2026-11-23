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
  faSliders,
  faEye,
  faFileExport,
  faFilter,
  faWheelchair,
  faBaby,
  faPersonWalkingWithCane,
  faHouseUser,
  faNotesMedical,
} from "@fortawesome/free-solid-svg-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../services/api";
import { useBarangays, invalidateEvacuationQueries } from "../../hooks/useEvacuationQueries";
import { familyTerm } from "../EvacuationCenter/utils";
import ShelterMetadataTab from "./ShelterMetadataTab";
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

  // Auto-dismiss notification toasts after 4.5 seconds
  useEffect(() => {
    if (!errorMsg) return;
    const t = setTimeout(() => setErrorMsg(""), 4500);
    return () => clearTimeout(t);
  }, [errorMsg]);

  useEffect(() => {
    if (!successMsg) return;
    const t = setTimeout(() => setSuccessMsg(""), 4500);
    return () => clearTimeout(t);
  }, [successMsg]);

  // =========================================================================
  // SUB-TAB 3: YEARS & RESIDENTS ROSTER STATE
  // =========================================================================
  const [years, setYears] = useState([]);
  const [loadingYears, setLoadingYears] = useState(false);
  const [yearsError, setYearsError] = useState("");
  const [selectedRosterYear, setSelectedRosterYear] = useState(2026);
  const [yearFamilies, setYearFamilies] = useState([]);
  const [loadingYearResidents, setLoadingYearResidents] = useState(false);
  const [yearResidentsError, setYearResidentsError] = useState("");
  const [searchInputText, setSearchInputText] = useState("");
  const [yearSearch, setYearSearch] = useState("");

  function handleSearchInputChange(val) {
    setSearchInputText(val);
    setYearSearch(val);
    setYearPage(1);
  }

  function handleSearchSubmit(e) {
    if (e) e.preventDefault();
    setYearPage(1);
    setYearSearch(searchInputText.trim());
  }

  function handleSearchClear() {
    setSearchInputText("");
    setYearSearch("");
    setYearPage(1);
  }
  const [yearBarangayFilter, setYearBarangayFilter] = useState("");
  const [yearVulnerabilityFilter, setYearVulnerabilityFilter] = useState("all");
  const [yearViewMode, setYearViewMode] = useState("residents"); // "residents" | "households" | "overview"
  const [yearPage, setYearPage] = useState(1);
  const [yearPerPage, setYearPerPage] = useState(25);
  const [expandedHouseholdIds, setExpandedHouseholdIds] = useState(new Set());
  const [carryOverTarget, setCarryOverTarget] = useState(null);
  const [carryOverMode, setCarryOverMode] = useState("all"); // "all" | "select"
  const [carryOverSourceFamilies, setCarryOverSourceFamilies] = useState([]);
  const [loadingCarryOverFamilies, setLoadingCarryOverFamilies] = useState(false);
  const [carryOverBarangayFilter, setCarryOverBarangayFilter] = useState("");
  const [carryOverSearch, setCarryOverSearch] = useState("");
  const [carryOverSelectedIds, setCarryOverSelectedIds] = useState(() => new Set());
  const [carryOverIncludeAssignments, setCarryOverIncludeAssignments] = useState(true);
  const [carryingOver, setCarryingOver] = useState(false);
  const [carryOverError, setCarryOverError] = useState("");
  const [carryOverSuccess, setCarryOverSuccess] = useState("");

  useEffect(() => {
    fetchYears();
  }, []);

  useEffect(() => {
    if (activeSubtab === "years" || activeSubtab === "import") {
      if (years.length === 0) {
        fetchYears();
      }
    }
  }, [activeSubtab]);

  function toggleHouseholdExpand(id) {
    setExpandedHouseholdIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function calculateAge(dob) {
    if (!dob) return null;
    const birth = new Date(dob);
    if (isNaN(birth.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const m = now.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
    return age >= 0 ? age : null;
  }

  async function fetchYears(preferredYear = null) {
    setLoadingYears(true);
    setYearsError("");
    try {
      const data = await api.getRosterYears();
      const list = Array.isArray(data) ? data : [];
      setYears(list);
      const activeYearObj = list.find((y) => y.is_active);
      const targetYear = preferredYear ?? selectedRosterYear ?? activeYearObj?.year ?? list[0]?.year ?? 2026;
      setSelectedRosterYear(targetYear);
      fetchYearFamilies(targetYear);
    } catch (err) {
      console.error("Failed to load roster years:", err);
      setYearsError(err.message || "Failed to load roster years.");
    } finally {
      setLoadingYears(false);
    }
  }

  async function fetchYearFamilies(targetYear) {
    if (!targetYear && targetYear !== 0) return;
    setLoadingYearResidents(true);
    setYearResidentsError("");
    try {
      const data = await api.getFamilies({ year: targetYear, all: "true" });
      setYearFamilies(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      console.error(`Failed to load families for year ${targetYear}:`, err);
      setYearResidentsError(err.message || `Failed to load resident roster for year ${targetYear}.`);
    } finally {
      setLoadingYearResidents(false);
    }
  }

  function handleSelectYear(year) {
    setSelectedRosterYear(year);
    setYearPage(1);
    fetchYearFamilies(year);
  }

  async function openCarryOverModal(sourceYearObj) {
    setCarryOverError("");
    setCarryOverMode("all");
    setCarryOverBarangayFilter("");
    setCarryOverSearch("");
    setCarryOverSelectedIds(new Set());
    setCarryOverIncludeAssignments(true);
    setCarryOverTarget(sourceYearObj);
    setCarryOverSourceFamilies([]);
    setLoadingCarryOverFamilies(true);
    try {
      const data = await api.getFamilies({ year: sourceYearObj.year, all: "true" });
      const items = Array.isArray(data?.items) ? data.items : [];
      setCarryOverSourceFamilies(items);
    } catch {
      setCarryOverSourceFamilies([]);
    } finally {
      setLoadingCarryOverFamilies(false);
    }
  }

  const filteredCarryOverFamilies = useMemo(() => {
    const q = carryOverSearch.trim().toLowerCase();
    return carryOverSourceFamilies.filter((fam) => {
      if (carryOverBarangayFilter && String(fam.barangay_id) !== String(carryOverBarangayFilter)) {
        return false;
      }
      if (!q) return true;
      const haystack = `${fam.family_code || ""} ${fam.head_name || ""} ${fam.barangay || ""} ${fam.address || ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [carryOverSourceFamilies, carryOverBarangayFilter, carryOverSearch]);

  function toggleCarryOverFamily(familyId) {
    setCarryOverSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(familyId)) next.delete(familyId);
      else next.add(familyId);
      return next;
    });
  }

  function selectAllVisibleCarryOverFamilies() {
    setCarryOverSelectedIds((prev) => {
      const next = new Set(prev);
      filteredCarryOverFamilies.forEach((fam) => next.add(fam.id));
      return next;
    });
  }

  function clearCarryOverSelection() {
    setCarryOverSelectedIds(new Set());
  }

  async function handleConfirmCarryOver() {
    if (!carryOverTarget) return;
    if (carryOverMode === "select" && carryOverSelectedIds.size === 0) {
      setCarryOverError("Select at least one family to carry over.");
      return;
    }
    setCarryingOver(true);
    setCarryOverError("");
    setCarryOverSuccess("");
    try {
      const payload = {
        include_assignments: carryOverIncludeAssignments,
      };
      if (carryOverMode === "select") {
        payload.family_ids = Array.from(carryOverSelectedIds);
      }
      const res = await api.carryOverRosterYear(carryOverTarget.year, payload);
      setCarryOverTarget(null);
      setCarryOverSuccess(
        res?.message ||
          `Carried over roster from Census Year ${carryOverTarget.year} to the active year.`
      );
      await invalidateEvacuationQueries(queryClient);
      await fetchYears(res?.target_year ?? null);
      setYearViewMode("residents");
    } catch (err) {
      setCarryOverError(err.message || "Failed to carry over roster year.");
    } finally {
      setCarryingOver(false);
    }
  }

  // Flatten families into individual residents for the active roster year
  const allResidentsInYear = useMemo(() => {
    const list = [];
    (yearFamilies || []).forEach((family) => {
      const members = Array.isArray(family.members) && family.members.length > 0
        ? family.members
        : [
          {
            id: `head-${family.id}`,
            family_id: family.id,
            full_name: family.head_name || "Head of Family",
            relationship_to_head: "Family Head",
            is_head_of_family: true,
            contact_number: family.head_contact || family.contact_number,
          },
        ];
      members.forEach((m) => {
        const computedAge = m.age != null ? m.age : calculateAge(m.date_of_birth);
        list.push({
          ...m,
          family_id: family.id,
          family_code: family.family_code || `FAM-${family.id}`,
          family_head: family.head_name,
          family_contact: family.head_contact || family.contact_number,
          barangay_id: family.barangay_id,
          barangay_name: family.barangay || "",
          address: family.address || "",
          assignment_status: family.assignment_status || "Unassigned",
          evacuation_center: family.evacuation_center || "",
          buildings: family.buildings || "",
          rooms: family.rooms || "",
          computed_age: computedAge,
          gender: m.gender || family.gender || "",
          date_of_birth: m.date_of_birth || null,
        });
      });
    });
    return list;
  }, [yearFamilies]);

  // Filter individual residents
  const filteredResidents = useMemo(() => {
    let result = allResidentsInYear;
    const q = (yearSearch || "").trim().toLowerCase();
    if (q) {
      result = result.filter(
        (r) =>
          (r.full_name && r.full_name.toLowerCase().includes(q)) ||
          (r.first_name && r.first_name.toLowerCase().includes(q)) ||
          (r.middle_name && r.middle_name.toLowerCase().includes(q)) ||
          (r.last_name && r.last_name.toLowerCase().includes(q)) ||
          (r.family_code && r.family_code.toLowerCase().includes(q)) ||
          (r.family_head && r.family_head.toLowerCase().includes(q)) ||
          (r.barangay_name && r.barangay_name.toLowerCase().includes(q)) ||
          (r.address && r.address.toLowerCase().includes(q)) ||
          (r.relationship_to_head && r.relationship_to_head.toLowerCase().includes(q)) ||
          (r.contact_number && r.contact_number.toLowerCase().includes(q)) ||
          (r.gender && r.gender.toLowerCase().includes(q)) ||
          (r.disability_type && r.disability_type.toLowerCase().includes(q)) ||
          (r.medical_notes && r.medical_notes.toLowerCase().includes(q))
      );
    }
    if (yearBarangayFilter) {
      result = result.filter(
        (r) => String(r.barangay_id) === String(yearBarangayFilter) || r.barangay_name === yearBarangayFilter
      );
    }
    if (yearVulnerabilityFilter === "pwd") {
      result = result.filter((r) => r.is_pwd);
    } else if (yearVulnerabilityFilter === "pregnant") {
      result = result.filter((r) => r.is_pregnant || r.is_lactating);
    } else if (yearVulnerabilityFilter === "senior") {
      result = result.filter((r) => r.computed_age != null && r.computed_age >= 60);
    } else if (yearVulnerabilityFilter === "assistance") {
      result = result.filter((r) => r.needs_assistance);
    } else if (yearVulnerabilityFilter === "any_vulnerable") {
      result = result.filter(
        (r) =>
          r.is_pwd ||
          r.is_pregnant ||
          r.is_lactating ||
          r.needs_assistance ||
          (r.computed_age != null && r.computed_age >= 60)
      );
    }
    return result;
  }, [allResidentsInYear, yearSearch, yearBarangayFilter, yearVulnerabilityFilter]);

  const paginatedResidents = useMemo(() => {
    const start = (yearPage - 1) * yearPerPage;
    return filteredResidents.slice(start, start + yearPerPage);
  }, [filteredResidents, yearPage, yearPerPage]);

  const residentTotalPages = Math.max(1, Math.ceil(filteredResidents.length / yearPerPage));

  // Filter households
  const filteredFamilies = useMemo(() => {
    let result = yearFamilies || [];
    const q = (yearSearch || "").trim().toLowerCase();
    if (q) {
      result = result.filter(
        (f) =>
          (f.head_name && f.head_name.toLowerCase().includes(q)) ||
          (f.family_code && f.family_code.toLowerCase().includes(q)) ||
          (f.barangay && f.barangay.toLowerCase().includes(q)) ||
          (f.address && f.address.toLowerCase().includes(q)) ||
          (Array.isArray(f.members) &&
            f.members.some(
              (m) =>
                m.full_name?.toLowerCase().includes(q) ||
                m.first_name?.toLowerCase().includes(q) ||
                m.last_name?.toLowerCase().includes(q)
            ))
      );
    }
    if (yearBarangayFilter) {
      result = result.filter(
        (f) => String(f.barangay_id) === String(yearBarangayFilter) || f.barangay === yearBarangayFilter
      );
    }
    if (yearVulnerabilityFilter === "pwd") {
      result = result.filter((f) => f.members?.some((m) => m.is_pwd));
    } else if (yearVulnerabilityFilter === "pregnant") {
      result = result.filter((f) => f.members?.some((m) => m.is_pregnant || m.is_lactating));
    } else if (yearVulnerabilityFilter === "senior") {
      result = result.filter((f) =>
        f.members?.some((m) => (m.age != null ? m.age : calculateAge(m.date_of_birth)) >= 60)
      );
    } else if (yearVulnerabilityFilter === "assistance") {
      result = result.filter((f) => f.members?.some((m) => m.needs_assistance));
    } else if (yearVulnerabilityFilter === "any_vulnerable") {
      result = result.filter((f) =>
        f.members?.some(
          (m) =>
            m.is_pwd ||
            m.is_pregnant ||
            m.is_lactating ||
            m.needs_assistance ||
            (m.age != null ? m.age : calculateAge(m.date_of_birth)) >= 60
        )
      );
    }
    return result;
  }, [yearFamilies, yearSearch, yearBarangayFilter, yearVulnerabilityFilter]);

  const paginatedFamilies = useMemo(() => {
    const start = (yearPage - 1) * yearPerPage;
    return filteredFamilies.slice(start, start + yearPerPage);
  }, [filteredFamilies, yearPage, yearPerPage]);

  const familyTotalPages = Math.max(1, Math.ceil(filteredFamilies.length / yearPerPage));

  // =========================================================================
  // BARANGAYS QUERY & IMPORT RESIDENTS STATE
  // =========================================================================
  const barangaysQuery = useBarangays();
  const barangays = useMemo(
    () => (Array.isArray(barangaysQuery.data) ? barangaysQuery.data : []),
    [barangaysQuery.data]
  );
  const sortedBarangays = useMemo(
    () => [...barangays].sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [barangays]
  );

  // =========================================================================
  // SUB-TAB 1: IMPORT RESIDENTS STATE
  // =========================================================================
  const [selectedImportBarangayId, setSelectedImportBarangayId] = useState("");
  const selectedImportBarangay = useMemo(
    () => barangays.find((b) => String(b.id) === String(selectedImportBarangayId)) || null,
    [barangays, selectedImportBarangayId]
  );
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
    if (selectedRosterYear) {
      fetchYearFamilies(selectedRosterYear);
    }
  }

  // Stage an upload: validates the file but saves nothing to live data.
  async function runStageValidation(file, barangayIdOverride = selectedImportBarangayId) {
    if (!file) return;
    if (!barangayIdOverride) {
      setErrorMsg("Please select a barangay before uploading an Excel file.");
      return;
    }
    const requestId = ++stageRequestRef.current;
    setValidating(true);
    setErrorMsg("");
    setSuccessMsg("");
    setStagedResult(null);
    setStagingToken(null);
    setImportResult(null);
    setImportStep("upload");

    try {
      const staged = await api.stageFamilyImport(file, barangayIdOverride);
      if (requestId !== stageRequestRef.current) return;
      setStagingToken(staged.staging_token);
      setStagedResult(staged);
      const hasUpdated = staged.families?.some((f) => f.status === "updated");
      const hasNew = staged.families?.some((f) => f.status === "new");
      const hasSkipped = staged.families?.some((f) => f.status === "skipped");
      setReviewTab(hasUpdated ? "updated" : hasNew ? "new" : hasSkipped ? "skipped" : "new");
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
    if (!selectedImportBarangayId) {
      setErrorMsg("Please select a barangay before uploading an Excel file.");
      return;
    }
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
    runStageValidation(selected, selectedImportBarangayId);
  }

  // Drag and drop handlers
  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedImportBarangayId) return;
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
    if (!selectedImportBarangayId) return;
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  }

  function handleImportBarangayChange(e) {
    const nextId = e.target.value;
    setSelectedImportBarangayId(nextId);
    clearSelectedFile();
    setSuccessMsg("");
    setShowConfirmModal(false);
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
      const otherBarangaySkipped = result.other_barangay_rows_skipped ?? 0;
      const barangayName = result.barangay?.name || selectedImportBarangay?.name || "";
      setImportResult({
        status: "success",
        message:
          result.message ||
          `Import completed${barangayName ? ` for ${barangayName}` : ""}. ${created} created, ${updated} updated, ${skipped} skipped.`,
        filename: importFile?.name || stagedResult?.filename || "",
        barangayName,
        created,
        updated,
        skipped,
        otherBarangaySkipped,
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

  const [exportingMasterlist, setExportingMasterlist] = useState(false);
  const [showExcelPreview, setShowExcelPreview] = useState(false);

  function toFilenameSlug(value) {
    return (
      String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "") || "barangay"
    );
  }

  async function handleDownloadTemplate() {
    try {
      setDownloadingTemplate(true);
      const barangayIdToUse = selectedImportBarangayId || undefined;
      const blob = await api.downloadFamilyTemplate(barangayIdToUse);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const filename = selectedImportBarangay
      ? `EvacWay_Family_Import_Template_${toFilenameSlug(selectedImportBarangay.name)}.xlsx`
      : "EvacWay_Family_Import_Template.xlsx";
      link.setAttribute("download", filename);
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

  async function handleExportMasterlist(arg = null) {
    const isPlainYear =
      typeof arg === "number" || (typeof arg === "string" && /^\d{4}$/.test(arg));
    const yearToExport = isPlainYear
      ? arg
      : arg && typeof arg === "object" && "year" in arg
        ? arg.year
        : null;
    const barangayIdToExport =
      arg && typeof arg === "object" && "barangayId" in arg
        ? arg.barangayId
        : null;
    const targetBarangay = barangayIdToExport
      ? barangays.find((b) => String(b.id) === String(barangayIdToExport)) || null
      : null;

    try {
      setExportingMasterlist(true);
      setErrorMsg("");
      const filters = {};
      if (yearToExport) filters.year = yearToExport;
      if (barangayIdToExport) filters.barangay_id = barangayIdToExport;

      const blob = await api.exportFamilies(filters);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const today = new Date().toISOString().slice(0, 10);
      const fileParts = [];
      if (targetBarangay) fileParts.push(toFilenameSlug(targetBarangay.name));
      if (yearToExport) fileParts.push(yearToExport);
      const fileLabel = fileParts.length > 0 ? `_${fileParts.join("_")}` : "";
      link.setAttribute("download", `EvacWay_Resident_Masterlist${fileLabel}_${today}.xlsx`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      setSuccessMsg(
        targetBarangay
          ? `Resident masterlist for Barangay ${targetBarangay.name} exported successfully.`
          : `Resident masterlist ${yearToExport ? `for year ${yearToExport} ` : ""}exported successfully.`
      );
    } catch (err) {
      console.error("Export masterlist failed:", err);
      setErrorMsg(err.message || "Failed to export resident masterlist.");
    } finally {
      setExportingMasterlist(false);
    }
  }

  const [exportingCenters, setExportingCenters] = useState(false);

  async function handleExportCenters() {
    try {
      setExportingCenters(true);
      setErrorMsg("");
      const blob = await api.exportCenters();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const today = new Date().toISOString().slice(0, 10);
      link.setAttribute("download", `EvacWay_Evacuation_Centers_${today}.xlsx`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      setSuccessMsg("Evacuation centers inventory exported successfully.");
    } catch (err) {
      console.error("Export centers failed:", err);
      setErrorMsg(err.message || "Failed to export evacuation centers.");
    } finally {
      setExportingCenters(false);
    }
  }

  // =========================================================================
  // SUB-TAB 2: BARANGAYS STATE
  // =========================================================================
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
      if (String(deleteTarget.id) === String(selectedImportBarangayId)) {
        setSelectedImportBarangayId("");
        clearSelectedFile();
      }
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

  function renderResidentDirectorySection() {
    const activeYearEntry = years.find((y) => y.is_active) || null;
    const latestArchivedWithFamilies =
      years.find((y) => !y.is_active && (y.households ?? y.household_count ?? 0) > 0) || null;
    const activeYearHasNoFamilies =
      Boolean(activeYearEntry) &&
      (activeYearEntry.households ?? activeYearEntry.household_count ?? 0) === 0;

    return (
      <div className="dm-resident-directory-section" style={{ display: "flex", flexDirection: "column", gap: "18px", marginTop: "24px", paddingTop: "20px", borderTop: "2px solid #e2e8f0" }}>
        {carryOverSuccess && (
          <div className="dm-alert dm-alert-success" style={{ margin: 0 }}>
            <div className="dm-alert-content">
              <FontAwesomeIcon icon={faCircleCheck} />
              <span>{carryOverSuccess}</span>
            </div>
            <button
              type="button"
              className="dm-modal-close"
              onClick={() => setCarryOverSuccess("")}
              aria-label="Dismiss message"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>
        )}

        {activeYearHasNoFamilies && latestArchivedWithFamilies && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "12px",
              padding: "14px 16px",
              borderRadius: "10px",
              border: "1px solid #bfdbfe",
              background: "#eff6ff",
            }}
          >
            <div>
              <strong style={{ display: "block", fontSize: "13.5px", color: "#1e3a8a" }}>
                Start Census Year {activeYearEntry.year} from {latestArchivedWithFamilies.year}'s roster
              </strong>
              <span style={{ fontSize: "12.5px", color: "#334155" }}>
                Carry over {(latestArchivedWithFamilies.households ?? latestArchivedWithFamilies.household_count ?? 0).toLocaleString()} families and their members without re-typing unchanged households. Existing resident logins stay linked.
              </span>
            </div>
            <button
              type="button"
              className="dm-btn dm-btn-primary"
              onClick={() => openCarryOverModal(latestArchivedWithFamilies)}
              disabled={carryingOver}
              style={{ fontSize: "12.5px", padding: "8px 14px" }}
            >
              <FontAwesomeIcon icon={faRotate} />
              Carry Over from {latestArchivedWithFamilies.year}
            </button>
          </div>
        )}

        {/* Section Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px", borderBottom: "1px solid var(--line, #e2e8f0)", paddingBottom: "14px" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "var(--text-0, #0f172a)", display: "flex", alignItems: "center", gap: "8px" }}>
              <FontAwesomeIcon icon={faUsers} style={{ color: "var(--brand, #2563eb)" }} />
              Registered Resident Masterlist & Demographics
            </h3>
            <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--muted, #64748b)" }}>
              Viewing registered family heads and family members for Census Year {selectedRosterYear}. Filter by year, barangay, or vulnerabilities.
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              className="dm-btn dm-btn-primary"
              onClick={() => handleExportMasterlist(selectedRosterYear)}
              disabled={exportingMasterlist || loadingYearResidents}
              title={`Export all ${selectedRosterYear || ""} residents to Excel`}
              style={{ fontSize: "12.5px", padding: "7px 13px" }}
            >
              <FontAwesomeIcon icon={exportingMasterlist ? faCircleNotch : faFileExport} spin={exportingMasterlist} />
              {exportingMasterlist ? "Exporting..." : `Export ${selectedRosterYear || ""} Masterlist (.xlsx)`}
            </button>
          </div>
        </div>

        {/* Year Filter & Fast Toggle Bar */}
        <div className="dm-year-bar">
          <div className="dm-year-selector-group">
            <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-0, #0f172a)", display: "flex", alignItems: "center", gap: "6px" }}>
              <FontAwesomeIcon icon={faFilter} style={{ color: "var(--brand, #2563eb)" }} />
              Filter by Year:
            </span>
            <select
              value={selectedRosterYear || ""}
              onChange={(e) => handleSelectYear(Number(e.target.value))}
              className="dm-form-group select"
              style={{
                padding: "7px 12px",
                borderRadius: "7px",
                border: "1px solid #cbd5e1",
                fontWeight: 700,
                fontSize: "13.5px",
                color: "#0f172a",
                background: "#ffffff",
                cursor: "pointer",
              }}
              aria-label="Select roster year"
            >
              {years.map((y) => (
                <option key={y.id || y.year} value={y.year}>
                  Census Year {y.year} {y.is_active ? "(Active)" : "(Archived)"}
                </option>
              ))}
            </select>

            {/* Quick Year Toggle Pills */}
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginLeft: "6px" }}>
              {years.map((y) => {
                const isSelected = Number(selectedRosterYear) === Number(y.year);
                return (
                  <button
                    key={y.id || y.year}
                    type="button"
                    className={`dm-year-pill ${isSelected ? "is-active" : ""}`}
                    onClick={() => handleSelectYear(y.year)}
                  >
                    <FontAwesomeIcon icon={faCalendarDays} style={{ fontSize: "12px" }} />
                    <span>{y.year}</span>
                    {y.is_active && (
                      <span
                        style={{
                          fontSize: "10.5px",
                          padding: "1px 6px",
                          borderRadius: "10px",
                          background: isSelected ? "rgba(255,255,255,0.25)" : "#dcfce7",
                          color: isSelected ? "#ffffff" : "#166534",
                          fontWeight: 700,
                        }}
                      >
                        Active
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            className="dm-btn dm-btn-secondary"
            onClick={() => fetchYears(selectedRosterYear)}
            disabled={loadingYears || loadingYearResidents}
            style={{ fontSize: "12.5px", padding: "6px 12px" }}
          >
            <FontAwesomeIcon icon={faRotate} spin={loadingYears || loadingYearResidents} />
            Refresh
          </button>
        </div>

        {/* Quick Metrics Cards */}
        <div className="dm-year-stats-grid">
          <div className="dm-year-stat-card">
            <div className="dm-year-stat-icon blue">
              <FontAwesomeIcon icon={faHouseUser} />
            </div>
            <div className="dm-year-stat-info">
              <span className="dm-year-stat-val">{yearFamilies.length.toLocaleString()}</span>
              <span className="dm-year-stat-lbl">Families in {selectedRosterYear}</span>
            </div>
          </div>

          <div className="dm-year-stat-card">
            <div className="dm-year-stat-icon green">
              <FontAwesomeIcon icon={faUsers} />
            </div>
            <div className="dm-year-stat-info">
              <span className="dm-year-stat-val">{allResidentsInYear.length.toLocaleString()}</span>
              <span className="dm-year-stat-lbl">Residents in {selectedRosterYear}</span>
            </div>
          </div>

          <div className="dm-year-stat-card">
            <div className="dm-year-stat-icon amber">
              <FontAwesomeIcon icon={faWheelchair} />
            </div>
            <div className="dm-year-stat-info">
              <span className="dm-year-stat-val">
                {allResidentsInYear.filter((r) => r.is_pwd || r.is_pregnant || r.is_lactating || r.needs_assistance || (r.computed_age != null && r.computed_age >= 60)).length.toLocaleString()}
              </span>
              <span className="dm-year-stat-lbl">Special Needs / Vulnerable</span>
            </div>
          </div>

          <div className="dm-year-stat-card">
            <div className="dm-year-stat-icon purple">
              <FontAwesomeIcon icon={faBuilding} />
            </div>
            <div className="dm-year-stat-info">
              <span className="dm-year-stat-val">
                {yearFamilies.filter((f) => f.assignment_status === "Assigned").length.toLocaleString()}
              </span>
              <span className="dm-year-stat-lbl">Sheltered Families</span>
            </div>
          </div>
        </div>

        {/* Search, Filter & View Mode Controls */}
        <div className="dm-roster-toolbar">
          {/* Top Row: View Mode Tabs & Count Summary */}
          <div className="dm-roster-toolbar-top">
            <div className="dm-view-mode-tabs">
              <button
                type="button"
                className={`dm-view-mode-btn ${yearViewMode === "residents" ? "is-active" : ""}`}
                onClick={() => {
                  setYearPage(1);
                  setYearViewMode("residents");
                }}
              >
                <FontAwesomeIcon icon={faUsers} />
                <span>Residents ({filteredResidents.length.toLocaleString()})</span>
              </button>
              <button
                type="button"
                className={`dm-view-mode-btn ${yearViewMode === "households" ? "is-active" : ""}`}
                onClick={() => {
                  setYearPage(1);
                  setYearViewMode("households");
                }}
              >
                <FontAwesomeIcon icon={faHouseUser} />
                <span>Families ({filteredFamilies.length.toLocaleString()})</span>
              </button>
              <button
                type="button"
                className={`dm-view-mode-btn ${yearViewMode === "overview" ? "is-active" : ""}`}
                onClick={() => setYearViewMode("overview")}
              >
                <FontAwesomeIcon icon={faCalendarDays} />
                <span>Years Overview ({years.length})</span>
              </button>
            </div>

            <div style={{ fontSize: "12.5px", color: "var(--muted, #64748b)", fontWeight: 500 }}>
              {yearViewMode === "residents"
                ? `Showing ${paginatedResidents.length} of ${filteredResidents.length.toLocaleString()} residents`
                : yearViewMode === "households"
                  ? `Showing ${paginatedFamilies.length} of ${filteredFamilies.length.toLocaleString()} families`
                  : `${years.length} Census Years`}
            </div>
          </div>

          {/* Filter Bar: Live Search & Dropdowns */}
          {yearViewMode !== "overview" && (
            <div className="dm-roster-filter-bar">
              <form onSubmit={handleSearchSubmit} className="dm-roster-search-form">
                <div className="dm-search-wrap" style={{ flex: 1, position: "relative" }}>
                  <FontAwesomeIcon icon={faMagnifyingGlass} className="dm-search-icon" />
                  <input
                    type="text"
                    className="dm-search-input"
                    value={searchInputText}
                    onChange={(e) => handleSearchInputChange(e.target.value)}
                    placeholder={
                      yearViewMode === "households"
                        ? "Search family head, family code, address..."
                        : "Search resident name, family code, address..."
                    }
                  />
                  {searchInputText && (
                    <button
                      type="button"
                      className="dm-search-clear"
                      onClick={handleSearchClear}
                      title="Clear search"
                    >
                      <FontAwesomeIcon icon={faXmark} />
                    </button>
                  )}
                </div>
              </form>

              <div className="dm-roster-filter-selects">
                {/* Barangay Filter Dropdown */}
                <select
                  value={yearBarangayFilter}
                  onChange={(e) => {
                    setYearPage(1);
                    setYearBarangayFilter(e.target.value);
                  }}
                  className="dm-select-filter"
                  aria-label="Filter by barangay"
                >
                  <option value="">All Barangays ({barangays.length})</option>
                  {barangays.map((b) => (
                    <option key={b.id} value={b.name}>
                      {b.name}
                    </option>
                  ))}
                </select>

                {/* Vulnerability / Special Needs Filter */}
                <select
                  value={yearVulnerabilityFilter}
                  onChange={(e) => {
                    setYearPage(1);
                    setYearVulnerabilityFilter(e.target.value);
                  }}
                  className="dm-select-filter"
                  aria-label="Filter by vulnerability"
                >
                  <option value="all">All Demographics</option>
                  <option value="any_vulnerable">Any Special Needs / Vulnerable</option>
                  <option value="pwd">PWD / Persons with Disability</option>
                  <option value="pregnant">Pregnant / Lactating</option>
                  <option value="senior">Senior Citizens (Age 60+)</option>
                  <option value="assistance">Requires Assistance</option>
                </select>

                {(yearSearch || yearBarangayFilter || yearVulnerabilityFilter !== "all") && (
                  <button
                    type="button"
                    className="dm-btn dm-btn-secondary"
                    style={{ height: "38px", padding: "0 12px", fontSize: "12.5px", gap: "6px" }}
                    onClick={() => {
                      handleSearchClear();
                      setYearBarangayFilter("");
                      setYearVulnerabilityFilter("all");
                      setYearPage(1);
                    }}
                    title="Reset all filters"
                  >
                    <FontAwesomeIcon icon={faXmark} />
                    Reset
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Error Message */}
        {yearResidentsError && (
          <div className="dm-alert dm-alert-error" style={{ margin: "4px 0" }}>
            <div className="dm-alert-content">
              <FontAwesomeIcon icon={faTriangleExclamation} />
              <span>{yearResidentsError}</span>
            </div>
          </div>
        )}

        {/* Loading Indicator */}
        {loadingYearResidents ? (
          <div style={{ padding: "48px 20px", textAlign: "center", color: "var(--muted, #64748b)" }}>
            <FontAwesomeIcon icon={faCircleNotch} spin style={{ fontSize: "28px", color: "var(--brand, #2563eb)", marginBottom: "12px" }} />
            <div style={{ fontSize: "14px", fontWeight: 600 }}>Loading residents for Census Year {selectedRosterYear}...</div>
          </div>
        ) : yearViewMode === "residents" ? (
          /* VIEW 1: RESIDENTS */
          filteredResidents.length === 0 ? (
            <div className="dm-empty-state">
              <FontAwesomeIcon icon={faUsers} className="dm-empty-icon" />
              <p>No residents found matching the selected filters for year {selectedRosterYear}.</p>
              {(yearSearch || yearBarangayFilter || yearVulnerabilityFilter !== "all") && (
                <button
                  type="button"
                  className="dm-btn dm-btn-secondary"
                  style={{ marginTop: "10px" }}
                  onClick={() => {
                    setYearSearch("");
                    setYearBarangayFilter("");
                    setYearVulnerabilityFilter("all");
                    setYearPage(1);
                  }}
                >
                  Clear Filters
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="dm-table-wrapper dm-desktop-table">
                <table className="dm-table">
                  <thead>
                    <tr>
                      <th style={{ width: "12%" }}>Family Code</th>
                      <th style={{ width: "19%" }}>Resident Name</th>
                      <th style={{ width: "17%" }}>Barangay & Address</th>
                      <th style={{ width: "10%" }}>Relationship</th>
                      <th style={{ width: "10%" }}>Age & Gender</th>
                      <th style={{ width: "16%" }}>Special Needs</th>
                      <th style={{ width: "16%" }}>Shelter Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedResidents.map((r, idx) => {
                      const isHead = Boolean(r.is_head_of_family);
                      const isSenior = r.computed_age != null && r.computed_age >= 60;
                      return (
                        <tr key={r.id || `res-${idx}`}>
                          <td>
                            <span
                              className="dm-meta-code-pill"
                              title={r.family_code}
                              style={{ fontWeight: 700, maxWidth: "100%", display: "inline-block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                            >
                              {r.family_code}
                            </span>
                          </td>
                          <td>
                            <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                                <strong style={{ fontSize: "13px", color: "var(--text-0, #0f172a)", lineHeight: 1.3, wordBreak: "break-word" }}>
                                  {r.full_name || [r.first_name, r.middle_name, r.last_name, r.suffix].filter(Boolean).join(" ") || "Unnamed"}
                                </strong>
                                {isHead && (
                                  <span
                                    className="dm-badge dm-badge-blue"
                                    style={{ fontSize: "9.5px", padding: "1px 5px", fontWeight: 700, flexShrink: 0 }}
                                  >
                                    HEAD
                                  </span>
                                )}
                              </div>
                              {r.contact_number && (
                                <span style={{ fontSize: "11.5px", color: "var(--muted, #64748b)", whiteSpace: "nowrap" }}>
                                  {r.contact_number}
                                </span>
                              )}
                            </div>
                          </td>
                          <td>
                            <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
                              <span style={{ fontWeight: 600, fontSize: "12.5px", color: "var(--text-0, #0f172a)", wordBreak: "break-word" }}>
                                {r.barangay_name || "—"}
                              </span>
                              {r.address && (
                                <span style={{ fontSize: "11.5px", color: "var(--muted, #64748b)", wordBreak: "break-word", lineHeight: 1.25 }}>
                                  {r.address}
                                </span>
                              )}
                            </div>
                          </td>
                          <td>
                            <span style={{ fontSize: "12.5px", color: "#334155", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>
                  {familyTerm(r.relationship_to_head || (isHead ? "Family Head" : "Member"))}
                            </span>
                          </td>
                          <td>
                            <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
                              <span style={{ fontWeight: 600, fontSize: "12.5px", color: "var(--text-0, #0f172a)", whiteSpace: "nowrap" }}>
                                {r.computed_age != null
                                  ? `${r.computed_age} yrs old`
                                  : r.age != null
                                    ? `${r.age} yrs old`
                                    : r.date_of_birth
                                      ? `DOB: ${r.date_of_birth}`
                                      : "—"}
                              </span>
                              <span style={{ fontSize: "11.5px", color: r.gender ? "var(--text-1, #334155)" : "var(--muted, #94a3b8)", whiteSpace: "nowrap" }}>
                                {r.gender || "Not specified"}
                              </span>
                            </div>
                          </td>
                          <td>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "3px" }}>
                              {r.is_pwd && (
                                <span className="dm-badge dm-badge-blue" style={{ fontSize: "10px", padding: "1px 5px", whiteSpace: "nowrap" }}>
                                  <FontAwesomeIcon icon={faWheelchair} style={{ marginRight: "3px" }} />
                                  PWD{r.disability_type ? `: ${r.disability_type}` : ""}
                                </span>
                              )}
                              {isSenior && (
                                <span
                                  className="dm-badge"
                                  style={{ background: "#fef3c7", color: "#92400e", borderColor: "#fde68a", fontSize: "10px", padding: "1px 5px", whiteSpace: "nowrap" }}
                                >
                                  <FontAwesomeIcon icon={faPersonWalkingWithCane} style={{ marginRight: "3px" }} />
                                  Senior (60+)
                                </span>
                              )}
                              {r.is_pregnant && (
                                <span
                                  className="dm-badge"
                                  style={{ background: "#fdf2f8", color: "#9d174d", borderColor: "#fbcfe8", fontSize: "10px", padding: "1px 5px", whiteSpace: "nowrap" }}
                                >
                                  <FontAwesomeIcon icon={faBaby} style={{ marginRight: "3px" }} />
                                  Pregnant
                                </span>
                              )}
                              {r.is_lactating && (
                                <span
                                  className="dm-badge"
                                  style={{ background: "#fdf4ff", color: "#86198f", borderColor: "#f0abfc", fontSize: "10px", padding: "1px 5px", whiteSpace: "nowrap" }}
                                >
                                  Lactating
                                </span>
                              )}
                              {r.needs_assistance && (
                                <span
                                  className="dm-badge"
                                  style={{ background: "#fff1f2", color: "#be123c", borderColor: "#fecdd3", fontSize: "10px", padding: "1px 5px", whiteSpace: "nowrap" }}
                                >
                                  Needs Asst
                                </span>
                              )}
                              {r.medical_notes && (
                                <span
                                  className="dm-badge"
                                  title={r.medical_notes}
                                  style={{ background: "#f8fafc", color: "#475569", borderColor: "#cbd5e1", fontSize: "10px", padding: "1px 5px", whiteSpace: "nowrap" }}
                                >
                                  <FontAwesomeIcon icon={faNotesMedical} style={{ marginRight: "3px" }} />
                                  Medical
                                </span>
                              )}
                              {!r.is_pwd && !isSenior && !r.is_pregnant && !r.is_lactating && !r.needs_assistance && !r.medical_notes && (
                                <span style={{ fontSize: "12px", color: "var(--muted, #94a3b8)" }}>—</span>
                              )}
                            </div>
                          </td>
                          <td>
                            {r.assignment_status === "Assigned" ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
                                <span className="dm-badge dm-badge-green" style={{ width: "fit-content", fontSize: "10.5px", padding: "1px 6px" }}>
                                  <FontAwesomeIcon icon={faCircleCheck} style={{ marginRight: "4px" }} />
                                  Assigned
                                </span>
                                <span style={{ fontSize: "11px", color: "#334155", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }} title={`${r.evacuation_center || "Center"} ${r.rooms ? `- ${r.rooms}` : ""}`}>
                                  {r.evacuation_center || "Center"} {r.rooms ? `- ${r.rooms}` : ""}
                                </span>
                              </div>
                            ) : (
                              <span className="dm-badge" style={{ color: "var(--muted, #64748b)", background: "#f1f5f9", fontSize: "10.5px", padding: "1px 6px" }}>
                                Unassigned
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards for Residents (< 768px) */}
              <div className="dm-mobile-cards">
                {paginatedResidents.map((r, idx) => {
                  const isHead = Boolean(r.is_head_of_family);
                  const isSenior = r.computed_age != null && r.computed_age >= 60;
                  const name =
                    r.full_name ||
                    [r.first_name, r.middle_name, r.last_name, r.suffix].filter(Boolean).join(" ") ||
                    "Unnamed";
                  const ageGender = [
                    r.computed_age != null
                      ? `${r.computed_age} yrs old`
                      : r.age != null
                        ? `${r.age} yrs old`
                        : r.date_of_birth
                          ? `DOB: ${r.date_of_birth}`
                          : null,
                    r.gender || null,
                  ]
                    .filter(Boolean)
                    .join(" • ");

                  return (
                    <div key={r.id || `res-m-${idx}`} className="dm-mobile-card-roster">
                      <div className="dm-mobile-card-header">
                        <div className="dm-mobile-card-title">
                          <span className="dm-mobile-card-name">{name}</span>
                          {isHead && (
                            <span
                              className="dm-badge dm-badge-blue"
                              style={{ fontSize: "10px", padding: "1px 6px", fontWeight: 700 }}
                            >
                              HEAD
                            </span>
                          )}
                        </div>
                        {r.assignment_status === "Assigned" ? (
                          <span className="dm-badge dm-badge-green" style={{ fontSize: "11px", flexShrink: 0 }}>
                            <FontAwesomeIcon icon={faCircleCheck} style={{ marginRight: "4px" }} />
                            Assigned
                          </span>
                        ) : (
                          <span
                            className="dm-badge"
                            style={{ color: "var(--muted, #64748b)", background: "#f1f5f9", fontSize: "11px", flexShrink: 0 }}
                          >
                            Unassigned
                          </span>
                        )}
                      </div>

                      <div className="dm-mobile-card-meta">
                        <span className="dm-meta-code-pill" title={r.family_code}>
                          {r.family_code}
                        </span>
                        <span>•</span>
                    <span>{familyTerm(r.relationship_to_head || (isHead ? "Family Head" : "Member"))}</span>
                      </div>

                      <div className="dm-mobile-detail-rows">
                        <div className="dm-mobile-detail-row">
                          <span className="dm-mobile-detail-lbl">Barangay & Address</span>
                          <span className="dm-mobile-detail-val">
                            {r.barangay_name || "—"}
                            {r.address ? ` • ${r.address}` : ""}
                          </span>
                        </div>
                        <div className="dm-mobile-detail-row">
                          <span className="dm-mobile-detail-lbl">Age & Gender</span>
                          <span className="dm-mobile-detail-val">{ageGender || "—"}</span>
                        </div>
                        {r.contact_number && (
                          <div className="dm-mobile-detail-row">
                            <span className="dm-mobile-detail-lbl">Contact</span>
                            <span className="dm-mobile-detail-val">
                              <a
                                href={`tel:${r.contact_number}`}
                                style={{ color: "var(--brand, #2563eb)", textDecoration: "none" }}
                              >
                                {r.contact_number}
                              </a>
                            </span>
                          </div>
                        )}
                        {r.assignment_status === "Assigned" && (
                          <div className="dm-mobile-detail-row">
                            <span className="dm-mobile-detail-lbl">Assigned Shelter</span>
                            <span className="dm-mobile-detail-val" style={{ color: "#166534" }}>
                              {r.evacuation_center || "Center"}{r.rooms ? ` (${r.rooms})` : ""}
                            </span>
                          </div>
                        )}
                      </div>

                      {(r.is_pwd || isSenior || r.is_pregnant || r.is_lactating || r.needs_assistance || r.medical_notes) && (
                        <div className="dm-mobile-badges">
                          {r.is_pwd && (
                            <span className="dm-badge dm-badge-blue" style={{ fontSize: "11px" }}>
                              <FontAwesomeIcon icon={faWheelchair} style={{ marginRight: "4px" }} />
                              PWD{r.disability_type ? `: ${r.disability_type}` : ""}
                            </span>
                          )}
                          {isSenior && (
                            <span
                              className="dm-badge"
                              style={{ background: "#fef3c7", color: "#92400e", borderColor: "#fde68a", fontSize: "11px" }}
                            >
                              <FontAwesomeIcon icon={faPersonWalkingWithCane} style={{ marginRight: "4px" }} />
                              Senior (60+)
                            </span>
                          )}
                          {r.is_pregnant && (
                            <span
                              className="dm-badge"
                              style={{ background: "#fdf2f8", color: "#9d174d", borderColor: "#fbcfe8", fontSize: "11px" }}
                            >
                              <FontAwesomeIcon icon={faBaby} style={{ marginRight: "4px" }} />
                              Pregnant
                            </span>
                          )}
                          {r.is_lactating && (
                            <span
                              className="dm-badge"
                              style={{ background: "#fdf4ff", color: "#86198f", borderColor: "#f0abfc", fontSize: "11px" }}
                            >
                              Lactating
                            </span>
                          )}
                          {r.needs_assistance && (
                            <span
                              className="dm-badge"
                              style={{ background: "#fff1f2", color: "#be123c", borderColor: "#fecdd3", fontSize: "11px" }}
                            >
                              Needs Assistance
                            </span>
                          )}
                          {r.medical_notes && (
                            <span
                              className="dm-badge"
                              title={r.medical_notes}
                              style={{ background: "#f8fafc", color: "#475569", borderColor: "#cbd5e1", fontSize: "11px" }}
                            >
                              <FontAwesomeIcon icon={faNotesMedical} style={{ marginRight: "4px" }} />
                              {r.medical_notes}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Pagination */}
              <div className="dm-pagination-bar">
                <div style={{ fontSize: "13px", color: "var(--muted, #64748b)" }}>
                  Showing{" "}
                  <strong>
                    {filteredResidents.length > 0 ? (yearPage - 1) * yearPerPage + 1 : 0}
                  </strong>{" "}
                  to{" "}
                  <strong>
                    {Math.min(yearPage * yearPerPage, filteredResidents.length)}
                  </strong>{" "}
                  of <strong>{filteredResidents.length.toLocaleString()}</strong> residents
                </div>

                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <select
                    value={yearPerPage}
                    onChange={(e) => {
                      setYearPerPage(Number(e.target.value));
                      setYearPage(1);
                    }}
                    style={{
                      padding: "5px 10px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      fontSize: "12.5px",
                    }}
                  >
                    <option value={20}>20 per page</option>
                    <option value={25}>25 per page</option>
                    <option value={50}>50 per page</option>
                    <option value={100}>100 per page</option>
                  </select>

                  <button
                    type="button"
                    className="dm-btn dm-btn-secondary"
                    disabled={yearPage <= 1}
                    onClick={() => setYearPage((p) => Math.max(1, p - 1))}
                    style={{ padding: "6px 12px", fontSize: "12.5px" }}
                  >
                    Previous
                  </button>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-0, #0f172a)" }}>
                    Page {yearPage} of {residentTotalPages}
                  </span>
                  <button
                    type="button"
                    className="dm-btn dm-btn-secondary"
                    disabled={yearPage >= residentTotalPages}
                    onClick={() => setYearPage((p) => Math.min(residentTotalPages, p + 1))}
                    style={{ padding: "6px 12px", fontSize: "12.5px" }}
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )
        ) : yearViewMode === "households" ? (
          /* VIEW 2: HOUSEHOLDS */
          filteredFamilies.length === 0 ? (
            <div className="dm-empty-state">
              <FontAwesomeIcon icon={faHouseUser} className="dm-empty-icon" />
              <p>No families found matching your search for year {selectedRosterYear}.</p>
            </div>
          ) : (
            <>
              <div className="dm-table-wrapper dm-desktop-table">
                <table className="dm-table">
                  <thead>
                    <tr>
                      <th style={{ width: "36px", textAlign: "center" }}></th>
                      <th style={{ width: "13%" }}>Family Code</th>
                      <th style={{ width: "21%" }}>Head of Family</th>
                      <th style={{ width: "19%" }}>Barangay & Address</th>
                      <th style={{ width: "9%" }}>Members</th>
                      <th style={{ width: "19%" }}>Special Needs</th>
                      <th style={{ width: "19%" }}>Shelter Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedFamilies.map((f) => {
                      const isExpanded = expandedHouseholdIds.has(f.id);
                      const members = f.members || [];
                      const vulnerableCount = members.filter(
                        (m) =>
                          m.is_pwd ||
                          m.is_pregnant ||
                          m.is_lactating ||
                          m.needs_assistance ||
                          (m.age != null && m.age >= 60)
                      ).length;

                      return (
                        <Fragment key={f.id}>
                          <tr
                            onClick={() => toggleHouseholdExpand(f.id)}
                            style={{ cursor: "pointer", background: isExpanded ? "#f8fafc" : "transparent" }}
                          >
                            <td style={{ textAlign: "center" }}>
                              <FontAwesomeIcon
                                icon={isExpanded ? faChevronDown : faChevronRight}
                                style={{ color: "var(--muted, #64748b)", fontSize: "12px" }}
                              />
                            </td>
                            <td>
                              <span
                                className="dm-meta-code-pill"
                                title={f.family_code}
                                style={{ fontWeight: 700, maxWidth: "100%", display: "inline-block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                              >
                                {f.family_code}
                              </span>
                            </td>
                            <td>
                              <div style={{ display: "flex", flexDirection: "column" }}>
                                <strong style={{ fontSize: "13.5px" }}>{f.head_name || "Head"}</strong>
                                {f.head_contact && (
                                  <span style={{ fontSize: "11.5px", color: "var(--muted, #64748b)" }}>
                                    {f.head_contact}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td>
                              <span style={{ fontWeight: 600 }}>{f.barangay || "—"}</span>
                              {f.address && (
                                <span style={{ fontSize: "11.5px", color: "var(--muted, #64748b)", display: "block" }}>
                                  {f.address}
                                </span>
                              )}
                            </td>
                            <td>
                              <span className="dm-badge dm-badge-blue">
                                <FontAwesomeIcon icon={faUsers} style={{ marginRight: "4px" }} />
                                {f.member_count ?? members.length ?? 0}
                              </span>
                            </td>
                            <td>
                              {vulnerableCount > 0 ? (
                                <span
                                  className="dm-badge"
                                  style={{ background: "#fef3c7", color: "#92400e", borderColor: "#fde68a" }}
                                >
                                  <FontAwesomeIcon icon={faWheelchair} style={{ marginRight: "4px" }} />
                                  {vulnerableCount} with special needs
                                </span>
                              ) : (
                                <span style={{ fontSize: "12px", color: "var(--muted, #94a3b8)" }}>None</span>
                              )}
                            </td>
                            <td>
                              {f.assignment_status === "Assigned" ? (
                                <span className="dm-badge dm-badge-green">
                                  <FontAwesomeIcon icon={faCircleCheck} style={{ marginRight: "4px" }} />
                                  {f.evacuation_center || "Assigned"}
                                </span>
                              ) : (
                                <span className="dm-badge" style={{ color: "var(--muted, #64748b)", background: "#f1f5f9" }}>
                                  Unassigned
                                </span>
                              )}
                            </td>
                          </tr>

                          {/* Nested Members Row when Expanded */}
                          {isExpanded && (
                            <tr>
                              <td colSpan={7} style={{ background: "#f8fafc", padding: "14px 24px" }}>
                                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                  <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-0, #0f172a)" }}>
                                    Registered Members of Family {f.family_code} ({members.length}):
                                  </div>
                                  <div style={{ background: "#ffffff", borderRadius: "8px", border: "1px solid #e2e8f0", overflow: "hidden" }}>
                                    <table className="dm-table dm-nested-table" style={{ fontSize: "12.5px" }}>
                                      <thead>
                                        <tr style={{ background: "#f1f5f9" }}>
                                          <th style={{ width: "28%" }}>Member Name</th>
                                          <th style={{ width: "18%" }}>Relationship</th>
                                          <th style={{ width: "18%" }}>Age / Gender</th>
                                          <th style={{ width: "20%" }}>Vulnerabilities & Needs</th>
                                          <th style={{ width: "16%" }}>Medical / Remarks</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {members.map((m, mIdx) => (
                                          <tr key={m.id || mIdx}>
                                            <td>
                                              <strong>
                                                {m.full_name || [m.first_name, m.middle_name, m.last_name, m.suffix].filter(Boolean).join(" ") || "Member"}
                                              </strong>
                                              {m.is_head_of_family && (
                                                <span className="dm-badge dm-badge-blue" style={{ marginLeft: "6px", fontSize: "10px" }}>
                                                  HEAD
                                                </span>
                                              )}
                                            </td>
                  <td>{familyTerm(m.relationship_to_head || "—")}</td>
                                            <td>
                                              {m.age != null ? `${m.age} yrs` : m.date_of_birth || "—"} {m.gender ? `• ${m.gender}` : ""}
                                            </td>
                                            <td>
                                              <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                                                {m.is_pwd && (
                                                  <span className="dm-badge dm-badge-blue" style={{ fontSize: "10.5px" }}>
                                                    PWD{m.disability_type ? `: ${m.disability_type}` : ""}
                                                  </span>
                                                )}
                                                {m.is_pregnant && (
                                                  <span className="dm-badge" style={{ background: "#fdf2f8", color: "#9d174d", fontSize: "10.5px" }}>
                                                    Pregnant
                                                  </span>
                                                )}
                                                {m.needs_assistance && (
                                                  <span className="dm-badge" style={{ background: "#fff1f2", color: "#be123c", fontSize: "10.5px" }}>
                                                    Assistance
                                                  </span>
                                                )}
                                                {!m.is_pwd && !m.is_pregnant && !m.needs_assistance && (
                                                  <span style={{ color: "#94a3b8" }}>—</span>
                                                )}
                                              </div>
                                            </td>
                                            <td style={{ color: "var(--muted, #64748b)" }}>
                                              {m.medical_notes || m.notes || "—"}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards for Households (< 768px) */}
              <div className="dm-mobile-cards">
                {paginatedFamilies.map((f) => {
                  const isExpanded = expandedHouseholdIds.has(f.id);
                  const members = f.members || [];
                  const vulnerableCount = members.filter(
                    (m) =>
                      m.is_pwd ||
                      m.is_pregnant ||
                      m.is_lactating ||
                      m.needs_assistance ||
                      (m.age != null && m.age >= 60)
                  ).length;

                  return (
                    <div key={`fam-m-${f.id}`} className="dm-mobile-card-roster">
                      <div className="dm-mobile-card-header">
                        <div>
                          <div className="dm-mobile-card-name">{f.head_name || "Head of Family"}</div>
                          <div style={{ fontSize: "11.5px", color: "var(--muted, #64748b)", marginTop: "2px" }}>
                            Family Head
                          </div>
                        </div>
                        {f.assignment_status === "Assigned" ? (
                          <span className="dm-badge dm-badge-green" style={{ fontSize: "11px", flexShrink: 0 }}>
                            <FontAwesomeIcon icon={faCircleCheck} style={{ marginRight: "4px" }} />
                            Assigned
                          </span>
                        ) : (
                          <span
                            className="dm-badge"
                            style={{ color: "var(--muted, #64748b)", background: "#f1f5f9", fontSize: "11px", flexShrink: 0 }}
                          >
                            Unassigned
                          </span>
                        )}
                      </div>

                      <div className="dm-mobile-card-meta">
                        <span className="dm-meta-code-pill" title={f.family_code}>
                          {f.family_code}
                        </span>
                        <span className="dm-badge dm-badge-blue" style={{ fontSize: "11px" }}>
                          <FontAwesomeIcon icon={faUsers} style={{ marginRight: "4px" }} />
                          {f.member_count ?? members.length ?? 0} members
                        </span>
                      </div>

                      <div className="dm-mobile-detail-rows">
                        <div className="dm-mobile-detail-row">
                          <span className="dm-mobile-detail-lbl">Barangay</span>
                          <span className="dm-mobile-detail-val">{f.barangay || "—"}</span>
                        </div>
                        {f.address && (
                          <div className="dm-mobile-detail-row">
                            <span className="dm-mobile-detail-lbl">Address</span>
                            <span className="dm-mobile-detail-val">{f.address}</span>
                          </div>
                        )}
                        {f.head_contact && (
                          <div className="dm-mobile-detail-row">
                            <span className="dm-mobile-detail-lbl">Contact</span>
                            <span className="dm-mobile-detail-val">
                              <a
                                href={`tel:${f.head_contact}`}
                                style={{ color: "var(--brand, #2563eb)", textDecoration: "none" }}
                              >
                                {f.head_contact}
                              </a>
                            </span>
                          </div>
                        )}
                        <div className="dm-mobile-detail-row">
                          <span className="dm-mobile-detail-lbl">Assigned Shelter</span>
                          <span
                            className="dm-mobile-detail-val"
                            style={{ color: f.assignment_status === "Assigned" ? "#166534" : "var(--muted, #64748b)" }}
                          >
                            {f.assignment_status === "Assigned" ? (f.evacuation_center || "Assigned") : "Unassigned"}
                          </span>
                        </div>
                        {vulnerableCount > 0 && (
                          <div className="dm-mobile-detail-row">
                            <span className="dm-mobile-detail-lbl">Special Needs</span>
                            <span className="dm-mobile-detail-val" style={{ color: "#92400e" }}>
                              <FontAwesomeIcon icon={faWheelchair} style={{ marginRight: "4px" }} />
                              {vulnerableCount} vulnerable member{vulnerableCount === 1 ? "" : "s"}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Expandable Family Members Section */}
                      {members.length > 0 && (
                        <div style={{ marginTop: "4px" }}>
                          <button
                            type="button"
                            className="dm-btn dm-btn-secondary"
                            onClick={() => toggleHouseholdExpand(f.id)}
                            style={{
                              width: "100%",
                              justifyContent: "space-between",
                              fontSize: "12px",
                              padding: "8px 12px",
                              background: isExpanded ? "#f1f5f9" : "#ffffff",
                            }}
                          >
                            <span>
                              <FontAwesomeIcon icon={faUsers} style={{ marginRight: "6px" }} />
                              {isExpanded ? "Hide Members" : `View ${members.length} Family Members`}
                            </span>
                            <FontAwesomeIcon icon={isExpanded ? faChevronDown : faChevronRight} style={{ fontSize: "11px" }} />
                          </button>

                          {isExpanded && (
                            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }}>
                              {members.map((m, mIdx) => {
                                const mName =
                                  m.full_name ||
                                  [m.first_name, m.middle_name, m.last_name, m.suffix].filter(Boolean).join(" ") ||
                                  "Member";
                                return (
                                  <div
                                    key={m.id || mIdx}
                                    style={{
                                      padding: "8px 10px",
                                      background: "#f8fafc",
                                      borderRadius: "6px",
                                      border: "1px solid #e2e8f0",
                                      fontSize: "12px",
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        marginBottom: "4px",
                                      }}
                                    >
                                      <strong>{mName}</strong>
                                      {m.is_head_of_family && (
                                        <span className="dm-badge dm-badge-blue" style={{ fontSize: "9.5px", padding: "1px 5px" }}>
                                          HEAD
                                        </span>
                                      )}
                                    </div>
                                    <div style={{ color: "var(--muted, #64748b)", fontSize: "11.5px", marginBottom: "4px" }}>
                                      {familyTerm(m.relationship_to_head || "Member")} • {m.age != null ? `${m.age} yrs` : m.date_of_birth || "—"}{" "}
                                      {m.gender ? `• ${m.gender}` : ""}
                                    </div>
                                    {(m.is_pwd || m.is_pregnant || m.needs_assistance || m.medical_notes) && (
                                      <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "4px" }}>
                                        {m.is_pwd && (
                                          <span className="dm-badge dm-badge-blue" style={{ fontSize: "10px" }}>
                                            PWD{m.disability_type ? `: ${m.disability_type}` : ""}
                                          </span>
                                        )}
                                        {m.is_pregnant && (
                                          <span
                                            className="dm-badge"
                                            style={{ background: "#fdf2f8", color: "#9d174d", fontSize: "10px" }}
                                          >
                                            Pregnant
                                          </span>
                                        )}
                                        {m.needs_assistance && (
                                          <span
                                            className="dm-badge"
                                            style={{ background: "#fff1f2", color: "#be123c", fontSize: "10px" }}
                                          >
                                            Assistance
                                          </span>
                                        )}
                                        {m.medical_notes && (
                                          <span
                                            className="dm-badge"
                                            style={{ background: "#f8fafc", color: "#475569", fontSize: "10px" }}
                                          >
                                            {m.medical_notes}
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Pagination */}
              <div className="dm-pagination-bar">
                <div style={{ fontSize: "13px", color: "var(--muted, #64748b)" }}>
                  Showing{" "}
                  <strong>
                    {filteredFamilies.length > 0 ? (yearPage - 1) * yearPerPage + 1 : 0}
                  </strong>{" "}
                  to{" "}
                  <strong>
                    {Math.min(yearPage * yearPerPage, filteredFamilies.length)}
                  </strong>{" "}
                  of <strong>{filteredFamilies.length.toLocaleString()}</strong> families
                </div>

                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <button
                    type="button"
                    className="dm-btn dm-btn-secondary"
                    disabled={yearPage <= 1}
                    onClick={() => setYearPage((p) => Math.max(1, p - 1))}
                    style={{ padding: "6px 12px", fontSize: "12.5px" }}
                  >
                    Previous
                  </button>
                  <span style={{ fontSize: "13px", fontWeight: 600 }}>
                    Page {yearPage} of {familyTotalPages}
                  </span>
                  <button
                    type="button"
                    className="dm-btn dm-btn-secondary"
                    disabled={yearPage >= familyTotalPages}
                    onClick={() => setYearPage((p) => Math.min(familyTotalPages, p + 1))}
                    style={{ padding: "6px 12px", fontSize: "12.5px" }}
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )
        ) : (
          /* VIEW 3: YEARS OVERVIEW */
          <>
            <div className="dm-table-wrapper dm-desktop-table">
              <table className="dm-table">
                <thead>
                  <tr>
                    <th style={{ width: "16%" }}>Census Year</th>
                    <th style={{ width: "16%" }}>System Status</th>
                    <th style={{ width: "24%" }}>Registered Families</th>
                    <th style={{ width: "24%" }}>Registered Residents</th>
                    <th style={{ width: "20%" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {years.map((y) => {
                    const isSelected = Number(selectedRosterYear) === Number(y.year);
                    return (
                      <tr
                        key={y.id || y.year}
                        style={{ background: isSelected ? "#f0f7ff" : "transparent" }}
                      >
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <FontAwesomeIcon icon={faCalendarDays} style={{ color: isSelected ? "var(--brand, #2563eb)" : "#94a3b8" }} />
                            <strong style={{ fontSize: "15px" }}>{y.year}</strong>
                          </div>
                        </td>
                        <td>
                          {y.is_active ? (
                            <span className="dm-badge dm-badge-green">
                              <FontAwesomeIcon icon={faCircleCheck} style={{ marginRight: "4px" }} />
                              Active Census Year
                            </span>
                          ) : (
                            <span className="dm-badge" style={{ color: "var(--muted, #64748b)", background: "#f1f5f9" }}>
                              Archived Roster
                            </span>
                          )}
                        </td>
                        <td>
                          <strong style={{ fontSize: "14px" }}>
                            {(y.households ?? y.household_count ?? 0).toLocaleString()}
                          </strong>{" "}
                          <span style={{ fontSize: "12px", color: "var(--muted, #64748b)" }}>families</span>
                        </td>
                        <td>
                          <strong style={{ fontSize: "14px", color: "var(--brand, #2563eb)" }}>
                            {(y.residents ?? y.resident_count ?? 0).toLocaleString()}
                          </strong>{" "}
                          <span style={{ fontSize: "12px", color: "var(--muted, #64748b)" }}>residents</span>
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                            <button
                              type="button"
                              className="dm-btn dm-btn-primary"
                              onClick={() => {
                                handleSelectYear(y.year);
                                setYearViewMode("residents");
                              }}
                              style={{ fontSize: "12px", padding: "6px 12px" }}
                            >
                              <FontAwesomeIcon icon={faUsers} />
                              Inspect {y.year} Residents
                            </button>
                            {!y.is_active && activeYearEntry && (y.households ?? y.household_count ?? 0) > 0 && (
                              <button
                                type="button"
                                className="dm-btn dm-btn-secondary"
                                onClick={() => openCarryOverModal(y)}
                                disabled={carryingOver}
                                style={{ fontSize: "12px", padding: "6px 12px" }}
                                title={`Copy families and members from ${y.year} into ${activeYearEntry.year}`}
                              >
                                <FontAwesomeIcon icon={faRotate} />
                                Carry Over to {activeYearEntry.year}
                              </button>
                            )}
                            <button
                              type="button"
                              className="dm-btn dm-btn-secondary"
                              onClick={() => handleExportMasterlist(y.year)}
                              disabled={exportingMasterlist}
                              style={{ fontSize: "12px", padding: "6px 12px" }}
                            >
                              <FontAwesomeIcon icon={faFileExport} />
                              Export Excel
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards for Years Overview (< 768px) */}
            <div className="dm-mobile-cards">
              {years.map((y) => {
                const isSelected = Number(selectedRosterYear) === Number(y.year);
                return (
                  <div
                    key={y.id || y.year}
                    className="dm-mobile-card-roster"
                    style={{
                      borderColor: isSelected ? "var(--brand, #2563eb)" : "var(--line, #e2e8f0)",
                      background: isSelected ? "#f0f7ff" : "#ffffff",
                    }}
                  >
                    <div className="dm-mobile-card-header">
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <FontAwesomeIcon
                          icon={faCalendarDays}
                          style={{ color: isSelected ? "var(--brand, #2563eb)" : "#94a3b8" }}
                        />
                        <span className="dm-mobile-card-name" style={{ fontSize: "16px" }}>
                          Census Year {y.year}
                        </span>
                      </div>
                      {y.is_active ? (
                        <span className="dm-badge dm-badge-green" style={{ fontSize: "11px" }}>
                          <FontAwesomeIcon icon={faCircleCheck} style={{ marginRight: "4px" }} />
                          Active
                        </span>
                      ) : (
                        <span
                          className="dm-badge"
                          style={{ color: "var(--muted, #64748b)", background: "#f1f5f9", fontSize: "11px" }}
                        >
                          Archived
                        </span>
                      )}
                    </div>

                    <div className="dm-mobile-detail-rows">
                      <div className="dm-mobile-detail-row">
                        <span className="dm-mobile-detail-lbl">Families</span>
                        <span className="dm-mobile-detail-val">
                          {(y.households ?? y.household_count ?? 0).toLocaleString()} families
                        </span>
                      </div>
                      <div className="dm-mobile-detail-row">
                        <span className="dm-mobile-detail-lbl">Residents</span>
                        <span className="dm-mobile-detail-val" style={{ color: "var(--brand, #2563eb)" }}>
                          {(y.residents ?? y.resident_count ?? 0).toLocaleString()} residents
                        </span>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: "8px", marginTop: "4px", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="dm-btn dm-btn-primary"
                        onClick={() => {
                          handleSelectYear(y.year);
                          setYearViewMode("residents");
                        }}
                        style={{ flex: 1, justifyContent: "center", fontSize: "12px", padding: "8px 10px" }}
                      >
                        <FontAwesomeIcon icon={faUsers} />
                        Inspect Residents
                      </button>
                      {!y.is_active && activeYearEntry && (y.households ?? y.household_count ?? 0) > 0 && (
                        <button
                          type="button"
                          className="dm-btn dm-btn-secondary"
                          onClick={() => openCarryOverModal(y)}
                          disabled={carryingOver}
                          style={{ fontSize: "12px", padding: "8px 12px" }}
                        >
                          <FontAwesomeIcon icon={faRotate} />
                          Carry Over
                        </button>
                      )}
                      <button
                        type="button"
                        className="dm-btn dm-btn-secondary"
                        onClick={() => handleExportMasterlist(y.year)}
                        disabled={exportingMasterlist}
                        style={{ fontSize: "12px", padding: "8px 12px" }}
                      >
                        <FontAwesomeIcon icon={faFileExport} />
                        Export
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
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
              className={`dm-subtab-btn ${activeSubtab === "shelter_metadata" ? "is-active" : ""}`}
              onClick={() => {
                setActiveSubtab("shelter_metadata");
                setErrorMsg("");
              }}
            >
              <FontAwesomeIcon icon={faSliders} />
              Center Types & Amenities
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
        {(successMsg || errorMsg) && (
          <div className="dm-toast-container">
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
                  Select a barangay, then upload an Excel file (.xlsx) containing family heads and family members.
                  The preview, summary, and saved data apply only to that barangay.
                </p>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
                <button
                  type="button"
                  className="dm-btn dm-btn-secondary"
                  onClick={() => setShowExcelPreview(true)}
                  title="View required Excel format, column definitions and sample rows"
                  style={{ fontSize: "13px", padding: "8px 14px" }}
                >
                  <FontAwesomeIcon icon={faEye} />
                  Preview Excel Format
                </button>

                <button
                  type="button"
                  className="dm-template-btn"
                  onClick={handleDownloadTemplate}
                  disabled={downloadingTemplate}
                  title={
                    selectedImportBarangay
                      ? `Download Excel template pre-filled for ${selectedImportBarangay.name}`
                      : "Download blank template with guidelines"
                  }
                >
                  <FontAwesomeIcon icon={downloadingTemplate ? faCircleNotch : faDownload} spin={downloadingTemplate} />
                  {downloadingTemplate ? "Downloading..." : "Download Excel Template"}
                </button>

                <button
                  type="button"
                  className="dm-btn dm-btn-secondary"
                  onClick={() =>
                    handleExportMasterlist({
                      barangayId: selectedImportBarangayId || undefined,
                    })
                  }
                  disabled={exportingMasterlist}
                  title={
                    selectedImportBarangay
                      ? `Export registered families and residents for ${selectedImportBarangay.name} (.xlsx)`
                      : "Export registered families and residents to Excel"
                  }
                  style={{ fontSize: "13px", padding: "8px 14px", background: "#f8fafc", borderColor: "#cbd5e1", color: "#334155" }}
                >
                  <FontAwesomeIcon icon={exportingMasterlist ? faCircleNotch : faFileExport} spin={exportingMasterlist} />
                  {exportingMasterlist ? "Exporting..." : "Export Area Masterlist"}
                </button>
              </div>
            </div>

            {/* Required Target Barangay Selector */}
            <div className="dm-import-barangay-bar">
              <div className="dm-import-barangay-field">
                <label htmlFor="dm-import-barangay-select" className="dm-import-barangay-label">
                  Select barangay <span className="dm-required-star" aria-hidden="true">*</span>
                </label>
                <select
                  id="dm-import-barangay-select"
                  required
                  aria-required="true"
                  className="dm-import-barangay-select"
                  value={selectedImportBarangayId}
                  onChange={handleImportBarangayChange}
                  disabled={validating || importing || barangaysQuery.isLoading}
                >
                  <option value="">
                    {barangaysQuery.isLoading ? "Loading barangays..." : "-- Select a barangay --"}
                  </option>
                  {sortedBarangays.map((b) => (
                    <option key={b.id} value={String(b.id)}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <p className="dm-import-barangay-hint">
                {selectedImportBarangay
                  ? `Preview, counts, and saved records apply only to Barangay ${selectedImportBarangay.name}. Rows for other barangays will be flagged and skipped.`
                  : "Required: choose a barangay before uploading a roster file."}
              </p>
            </div>

            {/* Drag & Drop File Upload Area */}
            {!importFile ? (
              <div
                className={`dm-dropzone ${dragActive ? "is-dragging" : ""} ${!selectedImportBarangayId ? "is-disabled" : ""}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => {
                  if (!selectedImportBarangayId) return;
                  fileInputRef.current?.click();
                }}
                aria-disabled={!selectedImportBarangayId}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx"
                  className="dm-file-input"
                  disabled={!selectedImportBarangayId}
                  onChange={(e) => handleFileSelect(e.target.files?.[0])}
                />
                <FontAwesomeIcon icon={faUpload} className="dm-dropzone-icon" />
                <h4 className="dm-dropzone-title">
                  {selectedImportBarangay
                    ? "Click to upload or drag & drop Excel file"
                    : "Select a barangay to enable file upload"}
                </h4>
                <p className="dm-dropzone-sub">
                  {selectedImportBarangay
                    ? `Importing for Barangay ${selectedImportBarangay.name} • Supports .xlsx files only`
                    : "Choose a barangay above before uploading a .xlsx file"}
                </p>
              </div>
            ) : (
              <div className="dm-file-info">
                <div className="dm-file-meta">
                  <FontAwesomeIcon icon={faFileExcel} className="dm-file-icon" />
                  <div>
                    <div className="dm-file-name">{importFile.name}</div>
                    <div className="dm-file-size">
                      {(importFile.size / 1024).toFixed(1)} KB
                      {selectedImportBarangay ? ` • Barangay ${selectedImportBarangay.name}` : ""}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <button
                    type="button"
                    className="dm-btn dm-btn-secondary dm-btn-sm"
                    onClick={() => runStageValidation(importFile, selectedImportBarangayId)}
                    disabled={validating || importing || !selectedImportBarangayId}
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
              const targetBarangayLabel =
                stagedResult.target_barangay?.name || selectedImportBarangay?.name || "Selected Barangay";
              const newHouseholds = stagedResult.families?.filter((f) => f.status === "new") || [];
              const updatedHouseholds = stagedResult.families?.filter((f) => f.status === "updated") || [];
              const skippedHouseholds = stagedResult.families?.filter((f) => f.status === "skipped") || [];
              const otherBarangayRows = stagedResult.other_barangay_rows || [];
              const otherBarangaySkipped =
                stagedResult.other_barangay_skipped ?? otherBarangayRows.length ?? 0;
              const barangayRowCount = stagedResult.barangay_rows ?? stagedResult.rows ?? 0;
              const filteredWarnings =
                otherBarangayRows.length > 0
                  ? (stagedResult.warnings || []).filter(
                      (w) => !String(w).includes("belonged to another barangay")
                    )
                  : stagedResult.warnings || [];
              const canImport = Boolean(stagedResult.can_import && !hasErrors);

              return (
                <>
                  <div className="dm-summary-grid">
                    <div className="dm-summary-card">
                      <span className="dm-summary-label">Rows for {targetBarangayLabel}</span>
                      <span className="dm-summary-val">
                        {barangayRowCount}
                        {otherBarangaySkipped > 0 && (
                          <span className="dm-summary-sub">
                            ({otherBarangaySkipped} other barangay skipped)
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="dm-summary-card">
                      <span className="dm-summary-label">New Families</span>
                      <span className="dm-summary-val">
                        {stagedResult.new_households ?? 0}
                        {stagedResult.previous_year &&
                          ((stagedResult.returning_unchanged_households ?? 0) > 0 ||
                            (stagedResult.returning_changed_households ?? 0) > 0) && (
                            <span className="dm-summary-sub">
                              ({stagedResult.returning_unchanged_households ?? 0} same as {stagedResult.previous_year}
                              {(stagedResult.returning_changed_households ?? 0) > 0
                                ? `, ${stagedResult.returning_changed_households} updated`
                                : ""}
                              {(stagedResult.brand_new_households ?? 0) > 0
                                ? `, ${stagedResult.brand_new_households} brand new`
                                : ""})
                            </span>
                          )}
                      </span>
                    </div>
                    <div className="dm-summary-card">
                      <span className="dm-summary-label">Updated Families</span>
                      <span className="dm-summary-val">
                        {stagedResult.updated_households ?? 0}
                        <span className="dm-summary-sub">
                          ({stagedResult.new_members_to_add ?? 0} new member{stagedResult.new_members_to_add === 1 ? "" : "s"}
                          {stagedResult.members_to_fill > 0 ? `, ${stagedResult.members_to_fill} with fields to fill` : ""})
                        </span>
                      </span>
                    </div>
                    <div className="dm-summary-card">
                      <span className="dm-summary-label">Unchanged</span>
                      <span className="dm-summary-val">
                        {stagedResult.skipped_households ?? 0}
                        <span className="dm-summary-sub">Already registered</span>
                      </span>
                    </div>
                    <div
                      className={`dm-summary-card ${hasErrors
                        ? "is-status-error"
                        : canImport
                          ? "is-status"
                          : "is-status-muted"
                        }`}
                    >
                      <span className="dm-summary-label">File Check</span>
                      <span
                        className={`dm-summary-status-text ${hasErrors ? "fail" : canImport ? "ok" : "muted"
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

                  {/* Flagged Other-Barangay Rows */}
                  {otherBarangayRows.length > 0 && (
                    <div className="dm-issues-box is-warning dm-other-brgy-box">
                      <h5 className="dm-issues-title">
                        <FontAwesomeIcon icon={faTriangleExclamation} />
                        {otherBarangayRows.length} Row{otherBarangayRows.length === 1 ? "" : "s"} from Other Barangays Flagged &amp; Skipped
                      </h5>
                      <p className="dm-other-brgy-desc">
                        This import applies only to <strong>{targetBarangayLabel}</strong>. The following row{otherBarangayRows.length === 1 ? "" : "s"} belong to another barangay and will not be saved:
                      </p>
                      <div className="dm-other-brgy-table-wrap">
                        <table className="dm-other-brgy-table">
                          <thead>
                            <tr>
                              <th>Row</th>
                              <th>Barangay in File</th>
                              <th>Family Head</th>
                              <th>Member</th>
                            </tr>
                          </thead>
                          <tbody>
                            {otherBarangayRows.map((item, idx) => (
                              <tr key={`${item.row}-${idx}`}>
                                <td>Row {item.row}</td>
                                <td>
                                  <span className="dm-other-brgy-pill">{item.barangay}</span>
                                </td>
                                <td>{item.head_name || "—"}</td>
                                <td>{item.member_name || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Warnings List */}
                  {filteredWarnings.length > 0 && (
                    <div className="dm-issues-box is-warning">
                      <h5 className="dm-issues-title">
                        <FontAwesomeIcon icon={faTriangleExclamation} />
                        Warnings ({filteredWarnings.length})
                      </h5>
                      <ul className="dm-issues-list">
                        {filteredWarnings.map((w, idx) => (
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
                        These families are already registered with the same details and will not be changed.
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
                                  <th style={{ width: "36%" }}>Family Head</th>
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
                                        <>No families match &ldquo;<strong>{reviewSearch}</strong>&rdquo; in this tab.</>
                                      ) : (
                                        <>No {reviewTab} families in this file.</>
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
                                              <span className="dm-change-tag is-blue">New family</span>
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
                        {barangayRowCount === 0 && otherBarangaySkipped > 0
                          ? `No rows matched Barangay ${targetBarangayLabel}. All ${otherBarangaySkipped} row${otherBarangaySkipped === 1 ? "" : "s"} belonged to another barangay and were skipped.`
                          : `Nothing to add. Everyone for Barangay ${targetBarangayLabel} in this file is already registered.`}
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
                    <span className="dm-summary-label">Families Created</span>
                    <span className="dm-summary-val">{importResult.created}</span>
                  </div>
                  <div className="dm-summary-card">
                    <span className="dm-summary-label">Families Updated</span>
                    <span className="dm-summary-val">{importResult.updated}</span>
                  </div>
                  <div className="dm-summary-card">
                    <span className="dm-summary-label">Unchanged</span>
                    <span className="dm-summary-val">
                      {importResult.skipped}
                      {importResult.otherBarangaySkipped > 0 && (
                        <span className="dm-summary-sub">
                          (+{importResult.otherBarangaySkipped} other barangay row{importResult.otherBarangaySkipped === 1 ? "" : "s"} skipped)
                        </span>
                      )}
                    </span>
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
                        <th style={{ width: "30%" }}>Barangay Name</th>
                        <th style={{ width: "18%" }}>Population</th>
                        <th style={{ width: "20%" }}>Registered Residents</th>
                        <th style={{ width: "18%" }}>Linked Centers</th>
                        <th style={{ width: "14%" }} className="dm-th-right">Actions</th>
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
            SUB-TAB: SHELTER OPTIONS (CENTER TYPES, MATERIALS, AMENITIES)
            ========================================================================= */}
        {activeSubtab === "shelter_metadata" && (
          <ShelterMetadataTab
            onNotify={(msg, type) => {
              if (type === "error") {
                setErrorMsg(msg);
              } else {
                setSuccessMsg(msg);
              }
            }}
          />
        )}

        {/* =========================================================================
            SUB-TAB 3: YEARS & RESIDENT DIRECTORY
            ========================================================================= */}
        {activeSubtab === "years" && (
          <div className="dm-card" style={{ gap: "20px" }}>
            {renderResidentDirectorySection()}
          </div>
        )}

        {/* =========================================================================
            MODAL: EXCEL FORMAT PREVIEW & INSTRUCTIONS
            ========================================================================= */}
        {showExcelPreview && (
          <div className="dm-modal-overlay" onClick={() => setShowExcelPreview(false)}>
            <div
              className="dm-modal-card"
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: "1150px", width: "95vw", maxHeight: "90vh", display: "flex", flexDirection: "column" }}
            >
              <div className="dm-modal-header" style={{ padding: "16px 24px", borderBottom: "1px solid #e2e8f0" }}>
                <div>
                  <h4 className="dm-modal-title" style={{ fontSize: "17px", fontWeight: "700", display: "flex", alignItems: "center", gap: "8px" }}>
                    <FontAwesomeIcon icon={faFileExcel} style={{ color: "#10b981" }} />
                    Excel Resident Roster Format & Specifications
                  </h4>
                  <p style={{ margin: "4px 0 0", fontSize: "13px", color: "#64748b" }}>
                    Structure: <strong>1 row per family member</strong>. Repeat the Family Code, Head of Family, and Address for all members of the family.
                  </p>
                </div>
                <button
                  type="button"
                  className="dm-modal-close"
                  onClick={() => setShowExcelPreview(false)}
                >
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              </div>

              <div className="dm-modal-body" style={{ overflowY: "auto", padding: "20px 24px" }}>
                {/* Column Legend */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", marginBottom: "16px", padding: "12px 16px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0", fontSize: "12.5px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "50%", background: "#ef4444" }}></span>
                    <strong>Red:</strong> Required on every row
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "50%", background: "#0284c7" }}></span>
                    <strong>Blue:</strong> Family Information
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "50%", background: "#7c3aed" }}></span>
                    <strong>Purple:</strong> Vulnerability & Special Needs (Matches with Shelter Amenities)
                  </div>
                </div>

                {/* Interactive Table Preview */}
                <div style={{ overflowX: "auto", border: "1px solid #cbd5e1", borderRadius: "8px", boxShadow: "var(--shadow-xs)" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", textAlign: "left", whiteSpace: "nowrap" }}>
                    <thead>
                      <tr style={{ background: "#f1f5f9", borderBottom: "2px solid #cbd5e1" }}>
                        <th style={{ padding: "10px 12px", color: "#b91c1c", fontWeight: "700" }}>Family Code *</th>
                        <th style={{ padding: "10px 12px", color: "#b91c1c", fontWeight: "700" }}>Head of Family *</th>
                        <th style={{ padding: "10px 12px", color: "#b91c1c", fontWeight: "700" }}>Barangay *</th>
                        <th style={{ padding: "10px 12px", color: "#0369a1", fontWeight: "600" }}>Contact Number</th>
                        <th style={{ padding: "10px 12px", color: "#0369a1", fontWeight: "600" }}>Address</th>
                        <th style={{ padding: "10px 12px", color: "#b91c1c", fontWeight: "700" }}>Member First Name *</th>
                        <th style={{ padding: "10px 12px", color: "#334155", fontWeight: "600" }}>Member Middle Name</th>
                        <th style={{ padding: "10px 12px", color: "#b91c1c", fontWeight: "700" }}>Member Last Name *</th>
                        <th style={{ padding: "10px 12px", color: "#334155", fontWeight: "600" }}>Member Contact</th>
                        <th style={{ padding: "10px 12px", color: "#334155", fontWeight: "600" }}>Date of Birth</th>
                        <th style={{ padding: "10px 12px", color: "#334155", fontWeight: "600" }}>Gender</th>
                        <th style={{ padding: "10px 12px", color: "#334155", fontWeight: "600" }}>Relationship</th>
                        <th style={{ padding: "10px 12px", color: "#6b21a8", fontWeight: "700" }}>Is PWD</th>
                        <th style={{ padding: "10px 12px", color: "#6b21a8", fontWeight: "700" }}>Disability Type</th>
                        <th style={{ padding: "10px 12px", color: "#6b21a8", fontWeight: "700" }}>Is Pregnant</th>
                        <th style={{ padding: "10px 12px", color: "#6b21a8", fontWeight: "700" }}>Is Lactating</th>
                        <th style={{ padding: "10px 12px", color: "#6b21a8", fontWeight: "700" }}>Solo Parent</th>
                        <th style={{ padding: "10px 12px", color: "#6b21a8", fontWeight: "700" }}>Needs Assistance</th>
                        <th style={{ padding: "10px 12px", color: "#6b21a8", fontWeight: "700" }}>Medical Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr style={{ borderBottom: "1px solid #e2e8f0", background: "#ffffff" }}>
                        <td style={{ padding: "8px 12px", fontWeight: "600", color: "#0f172a" }}>FAM-001</td>
                        <td style={{ padding: "8px 12px" }}>Juan Dela Cruz</td>
                        <td style={{ padding: "8px 12px" }}>{selectedImportBarangay?.name || "Poblacion"}</td>
                        <td style={{ padding: "8px 12px" }}>09171234567</td>
                        <td style={{ padding: "8px 12px" }}>Purok 1</td>
                        <td style={{ padding: "8px 12px", fontWeight: "600" }}>Juan</td>
                        <td style={{ padding: "8px 12px", color: "#94a3b8" }}>—</td>
                        <td style={{ padding: "8px 12px", fontWeight: "600" }}>Dela Cruz</td>
                        <td style={{ padding: "8px 12px" }}>09171234567</td>
                        <td style={{ padding: "8px 12px" }}>1980-05-15</td>
                        <td style={{ padding: "8px 12px" }}>Male</td>
                        <td style={{ padding: "8px 12px" }}>Head</td>
                        <td style={{ padding: "8px 12px" }}>No</td>
                        <td style={{ padding: "8px 12px", color: "#94a3b8" }}>—</td>
                        <td style={{ padding: "8px 12px" }}>No</td>
                        <td style={{ padding: "8px 12px" }}>No</td>
                        <td style={{ padding: "8px 12px" }}>No</td>
                        <td style={{ padding: "8px 12px" }}>No</td>
                        <td style={{ padding: "8px 12px" }}>Hypertension maintenance</td>
                      </tr>
                      <tr style={{ borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
                        <td style={{ padding: "8px 12px", fontWeight: "600", color: "#0f172a" }}>FAM-001</td>
                        <td style={{ padding: "8px 12px" }}>Juan Dela Cruz</td>
                        <td style={{ padding: "8px 12px" }}>{selectedImportBarangay?.name || "Poblacion"}</td>
                        <td style={{ padding: "8px 12px" }}>09171234567</td>
                        <td style={{ padding: "8px 12px" }}>Purok 1</td>
                        <td style={{ padding: "8px 12px", fontWeight: "600" }}>Maria</td>
                        <td style={{ padding: "8px 12px" }}>Santos</td>
                        <td style={{ padding: "8px 12px", fontWeight: "600" }}>Dela Cruz</td>
                        <td style={{ padding: "8px 12px" }}>09187654321</td>
                        <td style={{ padding: "8px 12px" }}>1984-08-20</td>
                        <td style={{ padding: "8px 12px" }}>Female</td>
                        <td style={{ padding: "8px 12px" }}>Spouse</td>
                        <td style={{ padding: "8px 12px", color: "#7c3aed", fontWeight: "700" }}>Yes</td>
                        <td style={{ padding: "8px 12px", color: "#7c3aed" }}>Mobility / Wheelchair</td>
                        <td style={{ padding: "8px 12px" }}>No</td>
                        <td style={{ padding: "8px 12px" }}>No</td>
                        <td style={{ padding: "8px 12px" }}>No</td>
                        <td style={{ padding: "8px 12px", color: "#7c3aed", fontWeight: "700" }}>Yes</td>
                        <td style={{ padding: "8px 12px" }}>Uses wheelchair; requires ramp & ground floor room</td>
                      </tr>
                      <tr style={{ borderBottom: "1px solid #e2e8f0", background: "#ffffff" }}>
                        <td style={{ padding: "8px 12px", fontWeight: "600", color: "#0f172a" }}>FAM-001</td>
                        <td style={{ padding: "8px 12px" }}>Juan Dela Cruz</td>
                        <td style={{ padding: "8px 12px" }}>{selectedImportBarangay?.name || "Poblacion"}</td>
                        <td style={{ padding: "8px 12px" }}>09171234567</td>
                        <td style={{ padding: "8px 12px" }}>Purok 1</td>
                        <td style={{ padding: "8px 12px", fontWeight: "600" }}>Angela</td>
                        <td style={{ padding: "8px 12px" }}>Santos</td>
                        <td style={{ padding: "8px 12px", fontWeight: "600" }}>Dela Cruz</td>
                        <td style={{ padding: "8px 12px", color: "#94a3b8" }}>—</td>
                        <td style={{ padding: "8px 12px" }}>2024-01-10</td>
                        <td style={{ padding: "8px 12px" }}>Female</td>
                        <td style={{ padding: "8px 12px" }}>Daughter</td>
                        <td style={{ padding: "8px 12px" }}>No</td>
                        <td style={{ padding: "8px 12px", color: "#94a3b8" }}>—</td>
                        <td style={{ padding: "8px 12px" }}>No</td>
                        <td style={{ padding: "8px 12px" }}>No</td>
                        <td style={{ padding: "8px 12px" }}>No</td>
                        <td style={{ padding: "8px 12px" }}>No</td>
                        <td style={{ padding: "8px 12px", color: "#94a3b8" }}>—</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Guidance Banner */}
                <div style={{ marginTop: "16px", padding: "14px 18px", background: "#eff6ff", borderRadius: "8px", border: "1px solid #bfdbfe", fontSize: "13px", color: "#1e3a8a", lineHeight: "1.6" }}>
                  <strong>💡 Pro-Tips for Importing:</strong>
                  <ul style={{ margin: "6px 0 0", paddingLeft: "20px" }}>
                    <li><strong>Repeated Family Rows:</strong> If a family has 4 members, create 4 rows with the same <code>Family Code</code>, <code>Head of Family</code>, and <code>Barangay</code>.</li>
                    <li><strong>Shelter Amenities Integration:</strong> Marking <code>Is PWD</code>, <code>Disability Type</code>, or <code>Needs Assistance</code> automatically informs the system to prioritize this family for centers that feature <em>Wheelchair Ramps</em>, <em>Ground Floor Access</em>, or <em>PWD Restrooms</em>.</li>
                    <li><strong>Minimal Format Accepted:</strong> If you only have basic roster data, you can omit the optional vulnerability columns and upload just the first 9 columns.</li>
                  </ul>
                </div>
              </div>

              <div className="dm-modal-footer" style={{ padding: "14px 24px", borderTop: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "12px", color: "#64748b" }}>Supports standard Microsoft Excel (.xlsx) files.</span>
                <div style={{ display: "flex", gap: "10px" }}>
                  <button
                    type="button"
                    className="dm-btn dm-btn-secondary"
                    onClick={() => setShowExcelPreview(false)}
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    className="dm-btn dm-btn-primary"
                    onClick={() => {
                      setShowExcelPreview(false);
                      handleDownloadTemplate();
                    }}
                  >
                    <FontAwesomeIcon icon={faDownload} />
                    Download This Template
                  </button>
                </div>
              </div>
            </div>
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
          const otherBarangaySkipped = stagedResult?.other_barangay_skipped ?? 0;
          const targetBarangayName =
            stagedResult?.target_barangay?.name || selectedImportBarangay?.name || "selected barangay";

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
                    You are about to commit to <strong>Barangay {targetBarangayName}</strong>:
                  </p>
                  <ul style={{ margin: "0 0 14px 20px", padding: 0, fontSize: "13.5px", lineHeight: "1.6", color: "var(--text-0, #0f172a)" }}>
                    <li>
                      <strong>{newCount} new family{newCount === 1 ? "" : "s"}</strong> ({newResCount} resident{newResCount === 1 ? "" : "s"})
                    </li>
                    <li>
                      <strong>{updatedCount} updated family{updatedCount === 1 ? "" : "s"}</strong> ({updatedMembersCount} new member{updatedMembersCount === 1 ? "" : "s"} added
                      {stagedResult?.members_to_fill > 0 && `, ${stagedResult.members_to_fill} existing member${stagedResult.members_to_fill === 1 ? "" : "s"} with blank fields filled`})
                    </li>
                    <li>
                      <strong>{skippedCount} family{skippedCount === 1 ? "" : "s"} unchanged</strong> (already up to date)
                    </li>
                    {otherBarangaySkipped > 0 && (
                      <li>
                        <strong>{otherBarangaySkipped} row{otherBarangaySkipped === 1 ? "" : "s"} from other barangays skipped</strong> (not saved)
                      </li>
                    )}
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
                  Barangays with registered families or linked evacuation centers cannot be deleted until their associated records have been transferred or removed.
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

        {/* =========================================================================
            MODAL 5: CARRY OVER ROSTER YEAR
            ========================================================================= */}
        {carryOverTarget && (
          <div className="dm-modal-overlay" onClick={() => !carryingOver && setCarryOverTarget(null)}>
            <div
              className="dm-modal-card"
              style={{ maxWidth: carryOverMode === "select" ? "620px" : "480px" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="dm-modal-header">
                <h4 className="dm-modal-title">
                  Carry Over Census Year {carryOverTarget.year}
                </h4>
                <button
                  type="button"
                  className="dm-modal-close"
                  onClick={() => setCarryOverTarget(null)}
                  disabled={carryingOver}
                >
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              </div>
              <div className="dm-modal-body">
                {carryOverError && (
                  <div className="dm-alert dm-alert-error" style={{ margin: 0 }}>
                    <div className="dm-alert-content">
                      <FontAwesomeIcon icon={faTriangleExclamation} />
                      <span>{carryOverError}</span>
                    </div>
                  </div>
                )}

                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className={`dm-btn ${carryOverMode === "all" ? "dm-btn-primary" : "dm-btn-secondary"}`}
                    onClick={() => setCarryOverMode("all")}
                    disabled={carryingOver}
                    style={{ fontSize: "12.5px", padding: "7px 12px" }}
                  >
                    All families ({(carryOverTarget.households ?? carryOverTarget.household_count ?? 0).toLocaleString()})
                  </button>
                  <button
                    type="button"
                    className={`dm-btn ${carryOverMode === "select" ? "dm-btn-primary" : "dm-btn-secondary"}`}
                    onClick={() => setCarryOverMode("select")}
                    disabled={carryingOver}
                    style={{ fontSize: "12.5px", padding: "7px 12px" }}
                  >
                    Choose specific families ({carryOverSelectedIds.size} selected)
                  </button>
                </div>

                {carryOverMode === "all" ? (
                  <p style={{ margin: 0 }}>
                    Copy all{" "}
                    <strong>
                      {(carryOverTarget.households ?? carryOverTarget.household_count ?? 0).toLocaleString()} families
                    </strong>{" "}
                    and{" "}
                    <strong>
                      {(carryOverTarget.residents ?? carryOverTarget.resident_count ?? 0).toLocaleString()} residents
                    </strong>{" "}
                    from <strong>{carryOverTarget.year}</strong> into the current active census year?
                  </p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      <input
                        type="text"
                        value={carryOverSearch}
                        onChange={(e) => setCarryOverSearch(e.target.value)}
                        placeholder="Search family code, head, or barangay..."
                        style={{
                          flex: "1 1 180px",
                          padding: "7px 10px",
                          borderRadius: "6px",
                          border: "1px solid #cbd5e1",
                          fontSize: "12.5px",
                        }}
                      />
                      <select
                        value={carryOverBarangayFilter}
                        onChange={(e) => setCarryOverBarangayFilter(e.target.value)}
                        style={{
                          padding: "7px 10px",
                          borderRadius: "6px",
                          border: "1px solid #cbd5e1",
                          fontSize: "12.5px",
                          background: "#ffffff",
                        }}
                      >
                        <option value="">All Barangays</option>
                        {barangays.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "12px", color: "var(--muted, #64748b)" }}>
                      <span>
                        Showing {filteredCarryOverFamilies.length} of {carryOverSourceFamilies.length} families ·{" "}
                        <strong>{carryOverSelectedIds.size} selected</strong>
                      </span>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button
                          type="button"
                          className="dm-btn dm-btn-secondary"
                          onClick={selectAllVisibleCarryOverFamilies}
                          disabled={loadingCarryOverFamilies || filteredCarryOverFamilies.length === 0}
                          style={{ fontSize: "11.5px", padding: "3px 8px" }}
                        >
                          Select visible
                        </button>
                        <button
                          type="button"
                          className="dm-btn dm-btn-secondary"
                          onClick={clearCarryOverSelection}
                          disabled={carryOverSelectedIds.size === 0}
                          style={{ fontSize: "11.5px", padding: "3px 8px" }}
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    <div
                      style={{
                        maxHeight: "220px",
                        overflowY: "auto",
                        border: "1px solid var(--line, #e2e8f0)",
                        borderRadius: "8px",
                        background: "#ffffff",
                      }}
                    >
                      {loadingCarryOverFamilies ? (
                        <p style={{ padding: "16px", margin: 0, textAlign: "center", fontSize: "12.5px", color: "#64748b" }}>
                          Loading families from {carryOverTarget.year}...
                        </p>
                      ) : filteredCarryOverFamilies.length === 0 ? (
                        <p style={{ padding: "16px", margin: 0, textAlign: "center", fontSize: "12.5px", color: "#64748b" }}>
                          No matching families found.
                        </p>
                      ) : (
                        filteredCarryOverFamilies.map((fam) => {
                          const checked = carryOverSelectedIds.has(fam.id);
                          return (
                            <label
                              key={fam.id}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "10px",
                                padding: "8px 12px",
                                borderBottom: "1px solid #f1f5f9",
                                background: checked ? "#eff6ff" : "transparent",
                                cursor: "pointer",
                                fontSize: "12.5px",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleCarryOverFamily(fam.id)}
                                disabled={carryingOver}
                              />
                              <span style={{ flex: 1, minWidth: 0 }}>
                                <strong>{fam.head_name}</strong>{" "}
                                <span style={{ color: "#64748b", fontSize: "11.5px" }}>({fam.family_code})</span>
                                <span style={{ display: "block", fontSize: "11.5px", color: "#64748b" }}>
                                  {fam.barangay || "Unassigned barangay"} · {fam.member_count ?? fam.members?.length ?? 0} member(s)
                                </span>
                              </span>
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}

                <p style={{ fontSize: "12.5px", color: "var(--muted, #64748b)", margin: 0 }}>
                  Families whose family code already exists in the active year will be skipped without overwriting.
                  Existing resident login accounts will automatically stay linked to the new year's records, and the{" "}
                  {carryOverTarget.year} archive will remain untouched.
                </p>

                <label
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "10px",
                    padding: "10px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--line, #e2e8f0)",
                    background: "#f8fafc",
                    cursor: "pointer",
                    fontSize: "13px",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={carryOverIncludeAssignments}
                    onChange={(e) => setCarryOverIncludeAssignments(e.target.checked)}
                    disabled={carryingOver}
                    style={{ marginTop: "3px" }}
                  />
                  <span>
                    <strong>Keep pre-assigned evacuation centers & rooms</strong>
                    <span style={{ display: "block", fontSize: "12px", color: "var(--muted, #64748b)" }}>
                      Arrival check-in status will reset to pending for the new year.
                    </span>
                  </span>
                </label>
              </div>
              <div className="dm-modal-footer">
                <button
                  type="button"
                  className="dm-btn dm-btn-secondary"
                  disabled={carryingOver}
                  onClick={() => setCarryOverTarget(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="dm-btn dm-btn-primary"
                  disabled={carryingOver || (carryOverMode === "select" && carryOverSelectedIds.size === 0)}
                  onClick={handleConfirmCarryOver}
                >
                  <FontAwesomeIcon icon={carryingOver ? faCircleNotch : faRotate} spin={carryingOver} />
                  {carryingOver
                    ? "Carrying over..."
                    : carryOverMode === "select"
                      ? `Carry Over ${carryOverSelectedIds.size} Selected`
                      : `Carry Over All from ${carryOverTarget.year}`}
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

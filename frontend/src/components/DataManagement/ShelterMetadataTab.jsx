import { useState, useEffect, useMemo } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBuilding,
  faCube,
  faWheelchair,
  faPlus,
  faPenToSquare,
  faTrash,
  faMagnifyingGlass,
  faRotate,
  faCircleNotch,
  faXmark,
  faTriangleExclamation,
  faToggleOn,
  faToggleOff,
  faTag,
  faInfoCircle,
  faFileExcel,
  faUpload,
  faDownload,
  faFileExport,
  faCircleCheck,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../../services/api";

const TABLES = {
  center_types: {
    key: "center_types",
    tableName: "center_types",
    title: "Center Types",
    singular: "Center Type",
    icon: faBuilding,
    color: "#2563eb",
    bg: "#eff6ff",
    description: "Configurable facility & shelter types (stored in the 'center_types' table).",
    getter: api.getCenterTypes,
    creator: api.createCenterType,
    updater: api.updateCenterType,
    deleter: api.deleteCenterType,
  },
  building_materials: {
    key: "building_materials",
    tableName: "building_materials",
    title: "Building Materials",
    singular: "Building Material",
    icon: faCube,
    color: "#059669",
    bg: "#f0fdf4",
    description: "Structural building composition types (stored in the 'building_materials' table).",
    getter: api.getBuildingMaterials,
    creator: api.createBuildingMaterial,
    updater: api.updateBuildingMaterial,
    deleter: api.deleteBuildingMaterial,
  },
  amenities: {
    key: "amenities",
    tableName: "amenities",
    title: "Amenities & Facilities",
    singular: "Amenity",
    icon: faWheelchair,
    color: "#7c3aed",
    bg: "#f5f3ff",
    description: "Configurable shelter amenities and equipment (wheelchairs, backup generators, medical stations, potable water, etc. stored in the 'amenities' table).",
    getter: api.getAmenities,
    creator: api.createAmenity,
    updater: api.updateAmenity,
    deleter: api.deleteAmenity,
  },
};

function slugify(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export default function ShelterMetadataTab({ onNotify }) {
  const [activeTable, setActiveTable] = useState("center_types");
  const [tableData, setTableData] = useState({
    center_types: [],
    building_materials: [],
    amenities: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // "all" | "active" | "inactive"
  const [searchTerm, setSearchTerm] = useState("");

  // Add / Edit Modal state
  const [modalState, setModalState] = useState(null); // { mode: 'add' | 'edit', tableKey, data }
  const [savingModal, setSavingModal] = useState(false);
  const [modalError, setModalError] = useState("");
  const [customCodeUnlocked, setCustomCodeUnlocked] = useState(false);

  // Delete Modal state
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  // Excel Bulk Operations State
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [exportingCenters, setExportingCenters] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [importResult, setImportResult] = useState(null);

  // Download Center Template (.xlsx)
  async function handleDownloadCenterTemplate() {
    try {
      setDownloadingTemplate(true);
      const blob = await api.downloadCenterTemplate();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", "evacway-centers-template.xlsx");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      if (onNotify) onNotify("Downloaded Evacuation Centers Excel template.", "success");
    } catch (err) {
      console.error("Failed to download template:", err);
      if (onNotify) onNotify(err.message || "Failed to download template.", "error");
    } finally {
      setDownloadingTemplate(false);
    }
  }

  // Export All Centers (.xlsx)
  async function handleExportCenters() {
    try {
      setExportingCenters(true);
      const blob = await api.exportCenters();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", "EvacWay-Evacuation-Centers.xlsx");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      if (onNotify) onNotify("Exported all evacuation centers to Excel.", "success");
    } catch (err) {
      console.error("Failed to export centers:", err);
      if (onNotify) onNotify(err.message || "Failed to export centers.", "error");
    } finally {
      setExportingCenters(false);
    }
  }

  // Upload Centers (.xlsx)
  async function handleUploadCenters() {
    if (!importFile) return;
    try {
      setImporting(true);
      setImportError("");
      setImportResult(null);
      const res = await api.uploadCenters(importFile);
      setImportResult(res);
      if (onNotify) {
        onNotify(
          `Imported successfully: ${res.created_count || 0} created, ${res.updated_count || 0} updated.`,
          "success"
        );
      }
      fetchAllTables();
    } catch (err) {
      console.error("Failed to import centers:", err);
      setImportError(err.message || "Failed to import evacuation centers.");
    } finally {
      setImporting(false);
    }
  }

  useEffect(() => {
    fetchAllTables();
  }, []);

  async function fetchAllTables() {
    setLoading(true);
    setError("");
    try {
      const [cts, mats, ams] = await Promise.all([
        api.getCenterTypes(),
        api.getBuildingMaterials(),
        api.getAmenities(),
      ]);
      setTableData({
        center_types: Array.isArray(cts) ? cts : [],
        building_materials: Array.isArray(mats) ? mats : [],
        amenities: Array.isArray(ams) ? ams : [],
      });
    } catch (err) {
      console.error("Failed to fetch shelter tables:", err);
      setError(err.message || "Failed to load database tables.");
    } finally {
      setLoading(false);
    }
  }

  const currentConfig = TABLES[activeTable];
  const currentItems = tableData[activeTable] || [];

  // Filtered rows for currently active table
  const filteredRows = useMemo(() => {
    return currentItems.filter((row) => {
      if (statusFilter === "active" && !row.is_active) return false;
      if (statusFilter === "inactive" && row.is_active) return false;

      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matchesName = (row.name || "").toLowerCase().includes(q);
        const matchesCode = (row.code || "").toLowerCase().includes(q);
        const matchesDesc = (row.description || "").toLowerCase().includes(q);
        return matchesName || matchesCode || matchesDesc;
      }
      return true;
    });
  }, [currentItems, statusFilter, searchTerm]);

  // Quick toggle active status directly in table
  async function handleToggleActive(item) {
    const updatedStatus = !item.is_active;
    const tableKey = activeTable;

    // Optimistic UI update
    setTableData((prev) => ({
      ...prev,
      [tableKey]: prev[tableKey].map((r) =>
        r.id === item.id ? { ...r, is_active: updatedStatus } : r
      ),
    }));

    try {
      await TABLES[tableKey].updater(item.id, { is_active: updatedStatus });
      if (onNotify) {
        onNotify(`"${item.name}" is now ${updatedStatus ? "Active" : "Inactive"}.`, "success");
      }
    } catch (err) {
      // Revert optimistic update
      setTableData((prev) => ({
        ...prev,
        [tableKey]: prev[tableKey].map((r) =>
          r.id === item.id ? { ...r, is_active: item.is_active } : r
        ),
      }));
      if (onNotify) {
        onNotify(err.message || "Failed to update status", "error");
      }
    }
  }

  // Open Add Modal
  function handleOpenAdd() {
    setModalState({
      mode: "add",
      tableKey: activeTable,
      data: {
        name: "",
        code: "",
        description: "",
        is_active: true,
        display_order: 0,
      },
    });
    setCustomCodeUnlocked(false);
    setModalError("");
  }

  // Open Edit Modal
  function handleOpenEdit(item) {
    setModalState({
      mode: "edit",
      tableKey: activeTable,
      data: {
        id: item.id,
        name: item.name,
        code: item.code,
        description: item.description || "",
        is_active: item.is_active,
        display_order: item.display_order || 0,
      },
    });
    setCustomCodeUnlocked(false);
    setModalError("");
  }

  // Handle modal submit
  async function handleModalSubmit(e) {
    e.preventDefault();
    if (!modalState) return;

    const { mode, tableKey, data } = modalState;
    if (!data.name.trim()) {
      setModalError("Name is required.");
      return;
    }

    const finalCode = data.code.trim() ? slugify(data.code) : slugify(data.name);
    if (!finalCode) {
      setModalError("A valid machine code identifier is required.");
      return;
    }

    setSavingModal(true);
    setModalError("");

    try {
      const payload = {
        name: data.name.trim(),
        code: finalCode,
        description: data.description.trim() || null,
        is_active: Boolean(data.is_active),
        display_order: Number(data.display_order) || 0,
      };

      if (mode === "add") {
        const created = await TABLES[tableKey].creator(payload);
        setTableData((prev) => ({
          ...prev,
          [tableKey]: [...prev[tableKey], created],
        }));
        setModalState(null);
        if (onNotify) onNotify(`Added "${created.name}" to ${TABLES[tableKey].title}.`, "success");
      } else {
        const updated = await TABLES[tableKey].updater(data.id, payload);
        setTableData((prev) => ({
          ...prev,
          [tableKey]: prev[tableKey].map((r) => (r.id === data.id ? updated : r)),
        }));
        setModalState(null);
        if (onNotify) onNotify(`Updated "${updated.name}".`, "success");
      }
    } catch (err) {
      console.error("Modal save error:", err);
      setModalError(err.message || "Failed to save.");
    } finally {
      setSavingModal(false);
    }
  }

  // Handle Delete / Deactivate
  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError("");
    const tableKey = activeTable;

    try {
      const res = await TABLES[tableKey].deleter(deleteTarget.id);
      if (res.deactivated) {
        setTableData((prev) => ({
          ...prev,
          [tableKey]: prev[tableKey].map((r) =>
            r.id === deleteTarget.id ? { ...r, is_active: false } : r
          ),
        }));
        if (onNotify) onNotify(res.message, "warning");
      } else {
        setTableData((prev) => ({
          ...prev,
          [tableKey]: prev[tableKey].filter((r) => r.id !== deleteTarget.id),
        }));
        if (onNotify) onNotify(`"${deleteTarget.name}" deleted successfully.`, "success");
      }
      setDeleteTarget(null);
    } catch (err) {
      console.error("Delete error:", err);
      setDeleteError(err.message || "Failed to delete.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="dm-card dm-shelter-metadata">
      {/* Evacuation Centers Excel Hub */}
      <div
        className="dm-center-excel-banner"
        style={{
          background: "linear-gradient(135deg, #f0fdf4 0%, #ffffff 100%)",
          border: "1px solid #bbf7d0",
          borderRadius: "10px",
          padding: "16px 18px",
          marginBottom: "20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "14px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              width: "42px",
              height: "42px",
              borderRadius: "10px",
              background: "#dcfce7",
              color: "#166534",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "18px",
              flexShrink: 0,
            }}
          >
            <FontAwesomeIcon icon={faFileExcel} />
          </div>
          <div>
            <strong style={{ fontSize: "14px", color: "#14532d", display: "block" }}>
              Evacuation Centers Excel Hub
            </strong>
            <span style={{ fontSize: "12.5px", color: "#166534" }}>
              Bulk import or export shelters pre-linked with Center Types, Building Materials, and Amenities.
            </span>
          </div>
        </div>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            type="button"
            className="dm-btn dm-btn-secondary"
            onClick={handleDownloadCenterTemplate}
            disabled={downloadingTemplate}
            style={{ fontSize: "12.5px", padding: "7px 13px" }}
          >
            <FontAwesomeIcon icon={downloadingTemplate ? faCircleNotch : faDownload} spin={downloadingTemplate} />
            Download Center Template
          </button>
          <button
            type="button"
            className="dm-btn dm-btn-secondary"
            onClick={handleExportCenters}
            disabled={exportingCenters}
            style={{ fontSize: "12.5px", padding: "7px 13px" }}
          >
            <FontAwesomeIcon icon={exportingCenters ? faCircleNotch : faFileExport} spin={exportingCenters} />
            Export Centers (.xlsx)
          </button>
          <button
            type="button"
            className="dm-btn dm-btn-primary"
            onClick={() => {
              setImportModalOpen(true);
              setImportFile(null);
              setImportResult(null);
              setImportError("");
            }}
            style={{ fontSize: "12.5px", padding: "7px 13px" }}
          >
            <FontAwesomeIcon icon={faUpload} />
            Import Centers (.xlsx)
          </button>
        </div>
      </div>

      {/* Header Info */}
      <div className="dm-card-header" style={{ alignItems: "flex-start" }}>
        <div>
          <h3 className="dm-card-title">
            <FontAwesomeIcon icon={currentConfig.icon} style={{ color: currentConfig.color, marginRight: "8px" }} />
            {currentConfig.title} Management
          </h3>
          <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--muted, #64748b)" }}>
            {currentConfig.description} Manage database entries directly.
          </p>
        </div>

        <button
          type="button"
          className="dm-btn dm-btn-primary"
          onClick={handleOpenAdd}
        >
          <FontAwesomeIcon icon={faPlus} /> Add {currentConfig.singular}
        </button>
      </div>

      {/* Table Selector Pills */}
      <div className="dm-meta-categories">
        {Object.entries(TABLES).map(([key, cfg]) => {
          const count = (tableData[key] || []).length;
          const isActive = activeTable === key;
          return (
            <button
              key={key}
              type="button"
              className={`dm-meta-cat-pill ${isActive ? "is-active" : ""}`}
              onClick={() => {
                setActiveTable(key);
                setSearchTerm("");
              }}
            >
              <FontAwesomeIcon icon={cfg.icon} style={{ color: isActive ? "#ffffff" : cfg.color }} />
              {cfg.title}
              <span className="dm-meta-cat-badge">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Filter bar */}
      <div className="dm-filter-bar">
        <div className="dm-search-wrap">
          <FontAwesomeIcon icon={faMagnifyingGlass} className="dm-search-icon" />
          <input
            type="text"
            className="dm-search-input"
            placeholder={`Search ${currentConfig.title.toLowerCase()} by name, code...`}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button
              type="button"
              className="dm-search-clear"
              onClick={() => setSearchTerm("")}
              title="Clear search"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          )}
        </div>

        <div className="dm-filter-controls">
          <select
            className="dm-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active Only</option>
            <option value="inactive">Inactive Only</option>
          </select>

          <button
            type="button"
            className="dm-btn dm-btn-secondary"
            onClick={fetchAllTables}
            disabled={loading}
            title="Refresh database records"
          >
            <FontAwesomeIcon icon={faRotate} spin={loading} />
          </button>
        </div>
      </div>

      {/* Error Notice */}
      {error && (
        <div className="dm-alert dm-alert-error" style={{ margin: "16px 20px 0" }}>
          <div className="dm-alert-content">
            <FontAwesomeIcon icon={faTriangleExclamation} />
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Table content */}
      {loading ? (
        <div style={{ padding: "48px 20px", textAlign: "center", color: "var(--muted, #64748b)" }}>
          <FontAwesomeIcon icon={faCircleNotch} spin style={{ fontSize: "24px", marginBottom: "8px" }} />
          <div>Loading from database table '{currentConfig.tableName}'...</div>
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="dm-empty-state">
          <FontAwesomeIcon icon={currentConfig.icon} className="dm-empty-icon" />
          <p>
            {searchTerm || statusFilter !== "all"
              ? `No records match your filters in '${currentConfig.tableName}'.`
              : `No entries found in table '${currentConfig.tableName}'.`}
          </p>
          <button
            type="button"
            className="dm-btn dm-btn-primary dm-btn-sm"
            onClick={handleOpenAdd}
            style={{ marginTop: "12px" }}
          >
            <FontAwesomeIcon icon={faPlus} /> Add {currentConfig.singular}
          </button>
        </div>
      ) : (
        <div className="dm-table-wrapper">
          <table className="dm-table">
            <thead>
              <tr>
                <th style={{ width: "280px" }}>{currentConfig.singular} Name & Code</th>
                <th>Description / Operational Notes</th>
                <th style={{ width: "130px", textAlign: "center" }}>Status</th>
                <th style={{ width: "140px", textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="dm-meta-name-cell">
                      <strong className="dm-meta-name">{row.name}</strong>
                      <span className="dm-meta-code-pill" title="Machine slug code">
                        {row.code}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="dm-meta-desc">
                      {row.description || (
                        <span style={{ color: "var(--muted, #94a3b8)", fontStyle: "italic" }}>
                          No description provided
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <button
                      type="button"
                      className={`dm-status-toggle-btn ${row.is_active ? "is-active" : "is-inactive"}`}
                      onClick={() => handleToggleActive(row)}
                      title={`Click to ${row.is_active ? "deactivate" : "activate"}`}
                    >
                      <FontAwesomeIcon icon={row.is_active ? faToggleOn : faToggleOff} />
                      <span>{row.is_active ? "Active" : "Inactive"}</span>
                    </button>
                  </td>
                  <td>
                    <div className="dm-actions-cell" style={{ justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        className="dm-btn dm-btn-secondary dm-btn-sm"
                        onClick={() => handleOpenEdit(row)}
                        title="Edit record"
                      >
                        <FontAwesomeIcon icon={faPenToSquare} />
                      </button>
                      <button
                        type="button"
                        className="dm-btn dm-btn-danger dm-btn-sm"
                        onClick={() => {
                          setDeleteError("");
                          setDeleteTarget(row);
                        }}
                        title="Delete record"
                      >
                        <FontAwesomeIcon icon={faTrash} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* =========================================================================
          MODAL: ADD / EDIT
          ========================================================================= */}
      {modalState && (
        <div className="dm-modal-overlay" onClick={() => !savingModal && setModalState(null)}>
          <div className="dm-modal-card" style={{ maxWidth: "540px" }} onClick={(e) => e.stopPropagation()}>
            <div className="dm-modal-header">
              <h4 className="dm-modal-title">
                {modalState.mode === "add"
                  ? `Add ${TABLES[modalState.tableKey].singular} (Table: ${TABLES[modalState.tableKey].tableName})`
                  : `Edit ${TABLES[modalState.tableKey].singular}: ${modalState.data.name}`}
              </h4>
              <button
                type="button"
                className="dm-modal-close"
                onClick={() => setModalState(null)}
                disabled={savingModal}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            <form onSubmit={handleModalSubmit}>
              <div className="dm-modal-body">
                {modalError && (
                  <div className="dm-alert dm-alert-error" style={{ marginBottom: "16px" }}>
                    <div className="dm-alert-content">
                      <FontAwesomeIcon icon={faTriangleExclamation} />
                      <span>{modalError}</span>
                    </div>
                  </div>
                )}

                {/* Display Name */}
                <div className="dm-form-group">
                  <label className="dm-label">
                    Name <span className="dm-required">*</span>
                  </label>
                  <input
                    type="text"
                    className="dm-input"
                    placeholder={`e.g. ${
                      modalState.tableKey === "center_types"
                        ? "Covered Gymnasium, School Annex"
                        : modalState.tableKey === "building_materials"
                        ? "Reinforced Concrete, Steel"
                        : "Wheelchair Ramps, PWD Restrooms"
                    }`}
                    value={modalState.data.name}
                    onChange={(e) => {
                      const newName = e.target.value;
                      setModalState((prev) => {
                        const updatedData = { ...prev.data, name: newName };
                        if (modalState.mode === "add" && !customCodeUnlocked) {
                          updatedData.code = slugify(newName);
                        }
                        return { ...prev, data: updatedData };
                      });
                    }}
                    required
                    disabled={savingModal}
                  />
                </div>

                {/* Slug Code */}
                <div className="dm-form-group">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                    <label className="dm-label" style={{ margin: 0 }}>
                      Code Identifier <span className="dm-required">*</span>
                    </label>
                    {!customCodeUnlocked && modalState.mode === "add" && (
                      <button
                        type="button"
                        style={{
                          background: "none",
                          border: "none",
                          fontSize: "12px",
                          color: "var(--brand, #2563eb)",
                          cursor: "pointer",
                          padding: 0,
                        }}
                        onClick={() => setCustomCodeUnlocked(true)}
                      >
                        Customize Code
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    className="dm-input dm-code-input"
                    placeholder="e.g. covered_gym, reinforced_concrete"
                    value={modalState.data.code}
                    onChange={(e) =>
                      setModalState((prev) => ({
                        ...prev,
                        data: { ...prev.data, code: slugify(e.target.value) },
                      }))
                    }
                    disabled={savingModal || (!customCodeUnlocked && modalState.mode === "add" && !modalState.data.name)}
                    required
                  />
                  <span className="dm-hint">Unique snake_case identifier in the table.</span>
                </div>

                {/* Description */}
                <div className="dm-form-group">
                  <label className="dm-label">Description (Optional)</label>
                  <textarea
                    className="dm-textarea"
                    rows="3"
                    placeholder="Enter guidelines, capacity rules, or specifications..."
                    value={modalState.data.description}
                    onChange={(e) =>
                      setModalState((prev) => ({
                        ...prev,
                        data: { ...prev.data, description: e.target.value },
                      }))
                    }
                    disabled={savingModal}
                  />
                </div>

                {/* Display Order & Active status */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginTop: "12px" }}>
                  <div className="dm-form-group" style={{ margin: 0 }}>
                    <label className="dm-label">Display Order</label>
                    <input
                      type="number"
                      className="dm-input"
                      value={modalState.data.display_order}
                      onChange={(e) =>
                        setModalState((prev) => ({
                          ...prev,
                          data: { ...prev.data, display_order: e.target.value },
                        }))
                      }
                      min="0"
                      disabled={savingModal}
                    />
                  </div>

                  <div className="dm-form-group" style={{ margin: 0 }}>
                    <label className="dm-label">Status</label>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        cursor: "pointer",
                        marginTop: "8px",
                        fontSize: "13.5px",
                        fontWeight: "600",
                        color: modalState.data.is_active ? "#166534" : "#64748b",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={modalState.data.is_active}
                        onChange={(e) =>
                          setModalState((prev) => ({
                            ...prev,
                            data: { ...prev.data, is_active: e.target.checked },
                          }))
                        }
                        disabled={savingModal}
                        style={{ width: "16px", height: "16px" }}
                      />
                      {modalState.data.is_active ? "Active" : "Inactive"}
                    </label>
                  </div>
                </div>
              </div>

              <div className="dm-modal-footer">
                <button
                  type="button"
                  className="dm-btn dm-btn-secondary"
                  onClick={() => setModalState(null)}
                  disabled={savingModal}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="dm-btn dm-btn-primary"
                  disabled={savingModal}
                >
                  {savingModal ? (
                    <>
                      <FontAwesomeIcon icon={faCircleNotch} spin /> Saving...
                    </>
                  ) : modalState.mode === "add" ? (
                    "Save to Table"
                  ) : (
                    "Save Changes"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: CONFIRM DELETE / DEACTIVATE
          ========================================================================= */}
      {deleteTarget && (
        <div className="dm-modal-overlay" onClick={() => !deleting && setDeleteTarget(null)}>
          <div className="dm-modal-card" style={{ maxWidth: "480px" }} onClick={(e) => e.stopPropagation()}>
            <div className="dm-modal-header">
              <h4 className="dm-modal-title">Delete from Table '{currentConfig.tableName}'</h4>
              <button
                type="button"
                className="dm-modal-close"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
            <div className="dm-modal-body">
              {deleteError && (
                <div className="dm-alert dm-alert-error" style={{ marginBottom: "14px" }}>
                  <div className="dm-alert-content">
                    <FontAwesomeIcon icon={faTriangleExclamation} />
                    <span>{deleteError}</span>
                  </div>
                </div>
              )}
              <p style={{ margin: "0 0 10px", fontSize: "14px", color: "var(--text-0, #0f172a)" }}>
                Are you sure you want to remove <strong>"{deleteTarget.name}"</strong>?
              </p>
              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  padding: "12px",
                  background: "#eff6ff",
                  border: "1px solid #bfdbfe",
                  borderRadius: "8px",
                  fontSize: "13px",
                  color: "#1e40af",
                  lineHeight: "1.5",
                }}
              >
                <FontAwesomeIcon icon={faInfoCircle} style={{ marginTop: "2px", flexShrink: 0 }} />
                <span>
                  <strong>Safety Protection:</strong> If any evacuation center currently uses this {currentConfig.singular.toLowerCase()}, it will be safely <strong>deactivated</strong> instead of deleted so historical data is never broken.
                </span>
              </div>
            </div>
            <div className="dm-modal-footer">
              <button
                type="button"
                className="dm-btn dm-btn-secondary"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="dm-btn dm-btn-danger"
                onClick={handleConfirmDelete}
                disabled={deleting}
              >
                {deleting ? (
                  <>
                    <FontAwesomeIcon icon={faCircleNotch} spin /> Removing...
                  </>
                ) : (
                  "Confirm Remove"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Evacuation Centers Modal */}
      {importModalOpen && (
        <div className="dm-modal-overlay" onClick={() => !importing && setImportModalOpen(false)}>
          <div className="dm-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "560px" }}>
            <div className="dm-modal-header">
              <h3 className="dm-modal-title">
                <FontAwesomeIcon icon={faUpload} style={{ marginRight: "8px", color: "var(--brand, #2563eb)" }} />
                Import Evacuation Centers from Excel
              </h3>
              <button
                type="button"
                className="dm-modal-close"
                onClick={() => !importing && setImportModalOpen(false)}
                disabled={importing}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            <div className="dm-modal-body">
              <p style={{ fontSize: "13px", color: "#475569", marginBottom: "14px", lineHeight: 1.5 }}>
                Upload an Excel spreadsheet (<strong>.xlsx</strong>) with your municipality's evacuation centers.
                Center Types, Building Materials, Amenities, and Barangays will be matched automatically against your database.
              </p>

              {importError && (
                <div className="dm-alert dm-alert-danger" style={{ marginBottom: "14px" }}>
                  <FontAwesomeIcon icon={faTriangleExclamation} />
                  <span>{importError}</span>
                </div>
              )}

              {importResult && (
                <div
                  className="dm-alert dm-alert-success"
                  style={{
                    marginBottom: "14px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                    background: "#f0fdf4",
                    borderColor: "#bbf7d0",
                    color: "#166534",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 700 }}>
                    <FontAwesomeIcon icon={faCircleCheck} />
                    <span>Import Completed Successfully!</span>
                  </div>
                  <div style={{ fontSize: "12.5px" }}>
                    • <strong>{importResult.created_count}</strong> new center(s) created<br />
                    • <strong>{importResult.updated_count}</strong> existing center(s) updated
                  </div>
                  {importResult.warnings && importResult.warnings.length > 0 && (
                    <div style={{ marginTop: "6px", fontSize: "11.5px", color: "#854d0e", background: "#fef9c3", padding: "6px 8px", borderRadius: "6px" }}>
                      <strong>Notices:</strong>
                      <ul style={{ margin: "4px 0 0", paddingLeft: "16px" }}>
                        {importResult.warnings.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* File upload drag/select area */}
              <div
                style={{
                  border: "2px dashed #cbd5e1",
                  borderRadius: "10px",
                  padding: "24px 16px",
                  textAlign: "center",
                  background: "#f8fafc",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
                onClick={() => document.getElementById("ec-excel-file-input")?.click()}
              >
                <input
                  id="ec-excel-file-input"
                  type="file"
                  accept=".xlsx, .xls"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setImportFile(f);
                      setImportError("");
                      setImportResult(null);
                    }
                  }}
                />
                <FontAwesomeIcon icon={faFileExcel} style={{ fontSize: "32px", color: "#16a34a", marginBottom: "8px" }} />
                <div style={{ fontWeight: 600, fontSize: "14px", color: "#0f172a" }}>
                  {importFile ? importFile.name : "Click to select Excel file (.xlsx)"}
                </div>
                <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                  {importFile
                    ? `${(importFile.size / 1024).toFixed(1)} KB`
                    : "Supports .xlsx with Center Name, Capacity, Center Type, Building Material, Amenities"}
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "12px" }}>
                <button
                  type="button"
                  className="dm-btn dm-btn-secondary"
                  onClick={handleDownloadCenterTemplate}
                  disabled={downloadingTemplate || importing}
                  style={{ fontSize: "12px", padding: "5px 10px" }}
                >
                  <FontAwesomeIcon icon={faDownload} /> Need the template?
                </button>
              </div>
            </div>

            <div className="dm-modal-footer">
              <button
                type="button"
                className="dm-btn dm-btn-secondary"
                onClick={() => setImportModalOpen(false)}
                disabled={importing}
              >
                {importResult ? "Close" : "Cancel"}
              </button>
              <button
                type="button"
                className="dm-btn dm-btn-primary"
                onClick={handleUploadCenters}
                disabled={!importFile || importing}
              >
                {importing && <FontAwesomeIcon icon={faCircleNotch} spin />}
                {importing ? "Importing..." : "Upload & Process"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

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
    </div>
  );
}

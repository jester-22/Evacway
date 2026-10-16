import { useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSearch, faXmark } from "@fortawesome/free-solid-svg-icons";
import { displayEntityName } from "../utils/displayEntityName";
import "../components_css/BarangaysServedPicker.css";

/**
 * Reusable Barangays Served Checkbox Picker
 * - Searchable registered barangay list
 * - Two columns on desktop, single column on mobile
 * - Touch-friendly rows (>= 44px)
 * - "Select all" and "Clear" actions
 * - Pre-checked support for edit modal
 * - Confirmation hook support for unchecking assigned barangays
 */
export default function BarangaysServedPicker({
  barangays = [],
  selectedIds = [],
  onChange,
  onBeforeDeselect,
  disabled = false,
  label = "Barangays Served",
  required = false,
}) {
  const [searchTerm, setSearchTerm] = useState("");

  // Normalize selected IDs as a Set of strings for fast lookup
  const selectedSet = useMemo(() => {
    return new Set((selectedIds || []).map((id) => String(id)));
  }, [selectedIds]);

  // Filtered barangays according to search query
  const filteredBarangays = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return barangays;
    return barangays.filter((b) => {
      const name = String(b.name || "").toLowerCase();
      return name.includes(q);
    });
  }, [barangays, searchTerm]);

  async function handleToggle(barangay) {
    if (disabled) return;
    const bId = String(barangay.id);
    const isCurrentlySelected = selectedSet.has(bId);

    if (isCurrentlySelected) {
      // Unchecking: check if confirmation is required
      if (typeof onBeforeDeselect === "function") {
        const allow = await onBeforeDeselect(barangay.id, barangay.name);
        if (allow === false) {
          return;
        }
      }
      const next = Array.from(selectedSet).filter((id) => id !== bId);
      onChange?.(next);
    } else {
      // Checking: add to selected
      const next = [...Array.from(selectedSet), bId];
      onChange?.(next);
    }
  }

  function handleSelectAll() {
    if (disabled) return;
    const allIds = barangays.map((b) => String(b.id));
    onChange?.(allIds);
  }

  async function handleClearAll() {
    if (disabled || selectedSet.size === 0) return;
    if (typeof onBeforeDeselect === "function") {
      // Confirm for all currently selected
      for (const b of barangays) {
        if (selectedSet.has(String(b.id))) {
          const allow = await onBeforeDeselect(b.id, b.name);
          if (allow === false) return;
        }
      }
    }
    onChange?.([]);
  }

  const selectedCount = selectedSet.size;

  return (
    <div className="bsp-container">
      {/* Header with Selected Count and Quick Actions */}
      <div className="bsp-header">
        <label className="bsp-label">
          <span>{label} {required && "*"}</span>
          <span className="bsp-count-badge">
            {selectedCount} selected
          </span>
        </label>

        <div className="bsp-actions">
          <button
            type="button"
            className="bsp-action-btn"
            onClick={handleSelectAll}
            disabled={disabled || selectedCount === barangays.length}
          >
            Select all
          </button>
          <span style={{ color: "#cbd5e1" }}>|</span>
          <button
            type="button"
            className="bsp-action-btn"
            onClick={handleClearAll}
            disabled={disabled || selectedCount === 0}
          >
            Clear
          </button>
        </div>
      </div>

      {/* Quick Search Input */}
      <div className="bsp-search-wrap">
        <FontAwesomeIcon icon={faSearch} className="bsp-search-icon" />
        <input
          type="text"
          className="bsp-search-input"
          placeholder="Search barangay..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          disabled={disabled}
          aria-label="Filter barangays"
        />
        {searchTerm && (
          <button
            type="button"
            className="bsp-search-clear"
            onClick={() => setSearchTerm("")}
            aria-label="Clear search"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        )}
      </div>

      {/* Checkbox List inside fixed-height scrolling container */}
      <div className="bsp-list-container">
        {filteredBarangays.length === 0 ? (
          <div className="bsp-empty-msg">
            No barangays match &ldquo;{searchTerm}&rdquo;
          </div>
        ) : (
          <div className="bsp-grid">
            {filteredBarangays.map((barangay) => {
              const bId = String(barangay.id);
              const isChecked = selectedSet.has(bId);

              return (
                <label
                  key={barangay.id}
                  className={`bsp-row ${isChecked ? "is-checked" : ""}`}
                >
                  <input
                    type="checkbox"
                    className="bsp-checkbox"
                    checked={isChecked}
                    disabled={disabled}
                    onChange={() => handleToggle(barangay)}
                  />
                  <span className="bsp-name">
                    {displayEntityName(barangay.name, `Barangay ${barangay.id}`)}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

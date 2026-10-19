import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPen,
  faHand,
  faXmark,
  faRotateLeft,
  faTrashCan,
  faCheck,
  faMagnifyingGlassPlus,
  faSpinner,
} from "@fortawesome/free-solid-svg-icons";
import "../components_css/CenterPlacementFlow.css";

const INSTRUCTION_STORAGE_KEY = "evacway_placement_instruction_dismissed";

/**
 * Extracts [{ lat, lng }] coordinate points from a GeoJSON Polygon geometry.
 * Safely handles null, undefined, strings, Points, Polygons, and MultiPolygons.
 */
export function polygonToPoints(geometry) {
  if (!geometry) return [];
  let geom = geometry;
  if (typeof geom === "string") {
    try {
      geom = JSON.parse(geom);
    } catch {
      return [];
    }
  }
  if (!geom || typeof geom !== "object") return [];

  // Point geometry has no polygon vertices
  if (geom.type === "Point") return [];

  let ring = null;
  if (geom.type === "Polygon" && Array.isArray(geom.coordinates)) {
    ring = geom.coordinates[0];
  } else if (geom.type === "MultiPolygon" && Array.isArray(geom.coordinates)) {
    const firstPoly = geom.coordinates[0];
    if (Array.isArray(firstPoly)) ring = firstPoly[0];
  } else if (Array.isArray(geom.coordinates)) {
    ring = geom.coordinates[0];
  } else if (Array.isArray(geom)) {
    ring = geom;
  }

  if (!Array.isArray(ring) || ring.length < 3) return [];

  const points = ring
    .map((item) => {
      if (Array.isArray(item) && item.length >= 2) {
        const lng = Number(item[0]);
        const lat = Number(item[1]);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          return { lat, lng };
        }
      } else if (item && typeof item === "object") {
        const lat = Number(item.lat ?? item.latitude);
        const lng = Number(item.lng ?? item.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          return { lat, lng };
        }
      }
      return null;
    })
    .filter(Boolean);

  if (points.length >= 4) {
    const first = points[0];
    const last = points[points.length - 1];
    if (Math.abs(first.lat - last.lat) < 1e-6 && Math.abs(first.lng - last.lng) < 1e-6) {
      return points.slice(0, -1);
    }
  }

  return points;
}

/**
 * Calculates geodesic building footprint area in square meters.
 */
export function calculatePolygonAreaM2(points) {
  if (!points || points.length < 3) return 0;
  const R = 6378137; // Earth's mean radius in meters
  const coords = points.map((p) => {
    const lat = Number(p.lat ?? p.latitude);
    const lng = Number(p.lng ?? p.longitude);
    return [lng * (Math.PI / 180), lat * (Math.PI / 180)];
  });

  let total = 0;
  const n = coords.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const [lng1, lat1] = coords[i];
    const [lng2, lat2] = coords[j];
    total += (lng2 - lng1) * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  const area = Math.abs((total * R * R) / 2.0);
  return Math.round(area);
}

/**
 * Reusable full-screen placement workspace for Evacuation Centers.
 * Handles Step 1 (Building Outline), Step 2 (Entrances), and Step 3 (Confirm).
 */
export default function CenterPlacementFlow({
  center,
  step = "footprint",
  onStepChange,
  footprintPoints = [],
  onFootprintPointsChange,
  entrancePoints = [],
  onEntrancePointsChange,
  mappingTool = "draw",
  onMappingToolChange,
  mapZoom = 12,
  onCancel,
  onSave,
  saving = false,
  onZoomIn,
  toastMessage = null,
  children,
}) {
  const centerProps = center?.properties || center || {};
  const centerName = centerProps.name || centerProps.center_name || "Evacuation Center";

  // Discard confirmation dialog state
  const [showDiscardModal, setShowDiscardModal] = useState(false);

  // Focus management & scroll lock
  const previousFocusRef = useRef(null);
  const workspaceRef = useRef(null);
  const cancelBtnRef = useRef(null);

  // Lock page scroll (body overflow hidden) while open and restore on close
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  // Move focus into the workspace on open, return to trigger on close
  useEffect(() => {
    previousFocusRef.current = document.activeElement;

    const timer = setTimeout(() => {
      if (cancelBtnRef.current) {
        cancelBtnRef.current.focus();
      } else if (workspaceRef.current) {
        workspaceRef.current.focus();
      }
    }, 50);

    return () => {
      clearTimeout(timer);
      if (
        previousFocusRef.current &&
        typeof previousFocusRef.current.focus === "function"
      ) {
        previousFocusRef.current.focus();
      }
    };
  }, []);

  // Instruction card dismissal state (persisted per session)
  const [instructionDismissed, setInstructionDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(INSTRUCTION_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  const dismissInstructionCard = useCallback(() => {
    setInstructionDismissed(true);
    try {
      sessionStorage.setItem(INSTRUCTION_STORAGE_KEY, "true");
    } catch {}
  }, []);

  // Compute step validity
  const isStep1Valid = footprintPoints.length >= 3;
  const isStep2Valid = entrancePoints.length >= 1;

  // Handle cancel action: if points exist, confirm first
  const handleCancelRequest = useCallback(() => {
    const hasPoints = footprintPoints.length > 0 || entrancePoints.length > 0;
    if (hasPoints) {
      setShowDiscardModal(true);
    } else if (onCancel) {
      onCancel();
    }
  }, [footprintPoints.length, entrancePoints.length, onCancel]);

  // Handle primary button click (Next or Save center)
  const handlePrimaryClick = useCallback(() => {
    if (step === "footprint") {
      if (isStep1Valid && onStepChange) {
        onStepChange("entrance");
      }
    } else if (step === "entrance") {
      if (isStep2Valid && onStepChange) {
        onStepChange("confirm");
      }
    } else if (step === "confirm") {
      if (!saving && onSave) {
        onSave();
      }
    }
  }, [step, isStep1Valid, isStep2Valid, saving, onStepChange, onSave]);

  // Handle Undo
  const handleUndo = useCallback(() => {
    if (step === "footprint" && footprintPoints.length > 0 && onFootprintPointsChange) {
      onFootprintPointsChange(footprintPoints.slice(0, -1));
    } else if (step === "entrance" && entrancePoints.length > 0 && onEntrancePointsChange) {
      onEntrancePointsChange(entrancePoints.slice(0, -1));
    }
  }, [step, footprintPoints, entrancePoints, onFootprintPointsChange, onEntrancePointsChange]);

  // Handle Clear
  const handleClear = useCallback(() => {
    if (step === "footprint" && footprintPoints.length > 0 && onFootprintPointsChange) {
      onFootprintPointsChange([]);
    } else if (step === "entrance" && entrancePoints.length > 0 && onEntrancePointsChange) {
      onEntrancePointsChange([]);
    }
  }, [step, footprintPoints.length, entrancePoints.length, onFootprintPointsChange, onEntrancePointsChange]);

  // Keyboard Shortcuts:
  // Escape asks "Discard this placement?" when any point exists
  // Enter goes to next step when valid
  // Ctrl+Z or Backspace undoes
  // Tab stays inside the workspace
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "Tab") {
        const container = workspaceRef.current;
        if (!container) return;

        const modalCard = container.querySelector(".cpf-modal-card");
        const activeScope = showDiscardModal && modalCard ? modalCard : container;

        const focusableSelector =
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
        const focusableElements = Array.from(
          activeScope.querySelectorAll(focusableSelector)
        ).filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);

        if (focusableElements.length === 0) {
          e.preventDefault();
          return;
        }

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (
            document.activeElement === firstElement ||
            !activeScope.contains(document.activeElement)
          ) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (
            document.activeElement === lastElement ||
            !activeScope.contains(document.activeElement)
          ) {
            e.preventDefault();
            firstElement.focus();
          }
        }
        return;
      }

      if (["INPUT", "TEXTAREA"].includes(e.target?.tagName)) return;

      if (e.key === "Escape") {
        e.preventDefault();
        if (showDiscardModal) {
          setShowDiscardModal(false);
        } else {
          handleCancelRequest();
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        handlePrimaryClick();
      } else if (
        e.key === "Backspace" ||
        (e.key === "z" && (e.ctrlKey || e.metaKey))
      ) {
        e.preventDefault();
        handleUndo();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleCancelRequest, handlePrimaryClick, handleUndo, showDiscardModal]);

  // Calculate footprint area
  const footprintArea = useMemo(
    () => (footprintPoints.length >= 3 ? calculatePolygonAreaM2(footprintPoints) : 0),
    [footprintPoints]
  );

  // Live text for toolbar
  const liveText = useMemo(() => {
    const pts = footprintPoints.length;
    const ents = entrancePoints.length;
    if (step === "footprint") {
      const pLabel = `${pts} ${pts === 1 ? "point" : "points"}`;
      return pts >= 3
        ? `${pLabel} • Footprint about ${footprintArea.toLocaleString()} m²`
        : pLabel;
    }
    if (step === "entrance") {
      return `${ents} ${ents === 1 ? "entrance" : "entrances"}`;
    }
    // confirm step
    return `${pts} points • ${ents} ${ents === 1 ? "entrance" : "entrances"} • Footprint about ${footprintArea.toLocaleString()} m²`;
  }, [step, footprintPoints.length, entrancePoints.length, footprintArea]);

  // Can undo / clear
  const canUndo =
    (step === "footprint" && footprintPoints.length > 0) ||
    (step === "entrance" && entrancePoints.length > 0);
  const canClear =
    (step === "footprint" && footprintPoints.length > 0) ||
    (step === "entrance" && entrancePoints.length > 0);

  // Stepper state numbers
  const stepIndex = step === "footprint" ? 1 : step === "entrance" ? 2 : 3;

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={workspaceRef}
      className="cpf-workspace"
      role="dialog"
      aria-modal="true"
      aria-label="Center Placement Workspace"
      tabIndex={-1}
    >
      {/* =========================================================
          TOP BAR (56px, white, bottom border)
          Left: ONE Cancel (X), title & center name
          Middle: 3-step stepper (compact on <=640px)
          Right: ONE primary button (Next / Save center)
          ========================================================= */}
      <header className="cpf-top-bar" role="banner">
        <div className="cpf-top-left">
          <button
            ref={cancelBtnRef}
            type="button"
            className="cpf-icon-btn-cancel"
            onClick={handleCancelRequest}
            aria-label="Cancel placement (Escape)"
            title="Cancel placement (Escape)"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>

          <div className="cpf-title-block">
            <span className="cpf-title-main">Place center</span>
            <span className="cpf-title-sub" title={centerName}>
              {centerName}
            </span>
          </div>
        </div>

        {/* 3-Step Stepper */}
        <div className="cpf-stepper-wrap" role="navigation" aria-label="Placement progress">
          <ol className="cpf-stepper">
            {/* Step 1: Outline */}
            <li className="cpf-step-wrapper">
              <button
                type="button"
                className={`cpf-step-item ${
                  stepIndex === 1
                    ? "is-current"
                    : stepIndex > 1
                    ? "is-finished is-clickable"
                    : "is-upcoming"
                }`}
                onClick={() => {
                  if (stepIndex > 1 && onStepChange) onStepChange("footprint");
                }}
                disabled={stepIndex === 1}
                title="Step 1: Outline"
              >
                <span className="cpf-step-num">
                  {stepIndex > 1 ? <FontAwesomeIcon icon={faCheck} /> : "1"}
                </span>
                <span className="cpf-step-label">Outline</span>
              </button>
            </li>

            <li className="cpf-step-divider" aria-hidden="true" />

            {/* Step 2: Entrances */}
            <li className="cpf-step-wrapper">
              <button
                type="button"
                className={`cpf-step-item ${
                  stepIndex === 2
                    ? "is-current"
                    : stepIndex > 2
                    ? "is-finished is-clickable"
                    : "is-upcoming"
                }`}
                onClick={() => {
                  if (stepIndex > 2 && onStepChange) onStepChange("entrance");
                }}
                disabled={stepIndex <= 2}
                title="Step 2: Entrances"
              >
                <span className="cpf-step-num">
                  {stepIndex > 2 ? <FontAwesomeIcon icon={faCheck} /> : "2"}
                </span>
                <span className="cpf-step-label">Entrances</span>
              </button>
            </li>

            <li className="cpf-step-divider" aria-hidden="true" />

            {/* Step 3: Confirm */}
            <li className="cpf-step-wrapper">
              <button
                type="button"
                className={`cpf-step-item ${
                  stepIndex === 3 ? "is-current" : "is-upcoming"
                }`}
                disabled={true}
                title="Step 3: Confirm"
              >
                <span className="cpf-step-num">3</span>
                <span className="cpf-step-label">Confirm</span>
              </button>
            </li>
          </ol>

          {/* Under 640px: show only "Step X of 3" */}
          <div className="cpf-stepper-compact" aria-label={`Step ${stepIndex} of 3`}>
            Step {stepIndex} of 3
          </div>
        </div>

        {/* Right: ONE Primary Button */}
        <div className="cpf-top-right">
          <button
            type="button"
            className="cpf-btn-primary"
            onClick={handlePrimaryClick}
            disabled={
              (step === "footprint" && !isStep1Valid) ||
              (step === "entrance" && !isStep2Valid) ||
              saving
            }
            title={
              step === "footprint" && !isStep1Valid
                ? "Add at least 3 points to create an outline"
                : step === "entrance" && !isStep2Valid
                ? "Add at least 1 entrance on the outline"
                : step === "confirm"
                ? "Save evacuation center outline and entrances"
                : "Proceed to next step (Enter)"
            }
          >
            {saving ? (
              <>
                <FontAwesomeIcon icon={faSpinner} spin />
                <span>Saving...</span>
              </>
            ) : step === "confirm" ? (
              <span>Save center</span>
            ) : (
              <span>Next</span>
            )}
          </button>
        </div>
      </header>

      {/* =========================================================
          MAP AREA (Fills everything below top bar)
          ========================================================= */}
      <div className="cpf-map-area">
        {/* The map canvas is passed as children or sits inside */}
        {children}

        {/* =========================================================
            ZOOM HINT PILL: ONE hint only, disappears at zoom >= 17
            ========================================================= */}
        {mapZoom < 17 && (
          <div className="cpf-zoom-hint-pill" role="status">
            <span className="cpf-zoom-hint-text">
              <FontAwesomeIcon icon={faMagnifyingGlassPlus} className="text-blue-500" />
              Zoom in to trace the building
            </span>
            <button
              type="button"
              className="cpf-zoom-hint-btn"
              onClick={onZoomIn}
              title="Fly to zoom level 18"
            >
              Zoom in
            </button>
          </div>
        )}

        {/* =========================================================
            INSTRUCTION CARD (Bottom Left, above toolbar, dismissible)
            ========================================================= */}
        {!instructionDismissed && (
          <div
            className="cpf-instruction-card"
            role="complementary"
            aria-label="Mapping instructions"
          >
            <div className="cpf-instruction-header">
              <span className="cpf-instruction-badge">
                {step === "footprint"
                  ? "Step 1: Outline"
                  : step === "entrance"
                  ? "Step 2: Entrances"
                  : "Step 3: Confirm"}
              </span>
              <button
                type="button"
                className="cpf-instruction-close"
                onClick={dismissInstructionCard}
                aria-label="Dismiss instructions for this session"
                title="Dismiss"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
            <p className="cpf-instruction-text">
              {step === "footprint" &&
                "Click each corner of the building. Click the first point to close the shape."}
              {step === "entrance" &&
                "Click on the outline where people enter. Add one or more entrances."}
              {step === "confirm" &&
                "Review the outline and entrances, then save the center."}
            </p>
          </div>
        )}

        {/* =========================================================
            BOTTOM TOOLBAR (Floating bottom center, 56px high)
            Pan | Draw, divider, Undo, Clear, divider, live text
            ========================================================= */}
        <div
          className="cpf-bottom-toolbar"
          role="toolbar"
          aria-label="Mapping Tools"
        >
          {/* Pan | Draw Segmented Control */}
          <div className="cpf-tool-segmented" role="group" aria-label="Tool mode">
            <button
              type="button"
              className={`cpf-tool-btn ${mappingTool === "pan" ? "is-active" : ""}`}
              onClick={() => onMappingToolChange && onMappingToolChange("pan")}
              title="Pan mode: Drag map without placing points"
              aria-label="Pan map"
            >
              <FontAwesomeIcon icon={faHand} />
              <span>Pan</span>
            </button>

            <button
              type="button"
              className={`cpf-tool-btn ${mappingTool === "draw" ? "is-active" : ""}`}
              onClick={() => onMappingToolChange && onMappingToolChange("draw")}
              title="Draw mode: Click map to place points"
              aria-label="Draw on map"
            >
              <FontAwesomeIcon icon={faPen} />
              <span>Draw</span>
            </button>
          </div>

          <div className="cpf-toolbar-divider" aria-hidden="true" />

          {/* Undo ghost button */}
          <button
            type="button"
            className="cpf-ghost-btn"
            onClick={handleUndo}
            disabled={!canUndo}
            title="Undo last point (Ctrl+Z or Backspace)"
            aria-label="Undo point"
          >
            <FontAwesomeIcon icon={faRotateLeft} />
            <span>Undo</span>
          </button>

          {/* Clear ghost button */}
          <button
            type="button"
            className="cpf-ghost-btn"
            onClick={handleClear}
            disabled={!canClear}
            title="Clear all points in this step"
            aria-label="Clear points"
          >
            <FontAwesomeIcon icon={faTrashCan} />
            <span>Clear</span>
          </button>

          <div className="cpf-toolbar-divider" aria-hidden="true" />

          {/* Live text */}
          <span className="cpf-live-text" aria-live="polite">
            {liveText}
          </span>
        </div>

        {/* Floating Toast Notification (e.g. Entrance must be on outline) */}
        {toastMessage && (
          <div className="cpf-toast" role="alert">
            <span>{toastMessage}</span>
          </div>
        )}
      </div>

      {/* =========================================================
          DISCARD CONFIRMATION MODAL (Escape / Cancel with points)
          ========================================================= */}
      {showDiscardModal && (
        <div
          className="cpf-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cpf-discard-title"
        >
          <div className="cpf-modal-card">
            <h3 id="cpf-discard-title" className="cpf-modal-title">
              Discard this placement?
            </h3>
            <p className="cpf-modal-desc">
              All outline and entrance points you placed will be lost.
            </p>
            <div className="cpf-modal-actions">
              <button
                type="button"
                className="cpf-modal-btn-cancel"
                onClick={() => setShowDiscardModal(false)}
              >
                Keep editing
              </button>
              <button
                type="button"
                className="cpf-modal-btn-discard"
                onClick={() => {
                  setShowDiscardModal(false);
                  if (onCancel) onCancel();
                }}
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}

import { useState, useMemo, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../services/api';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleNotch, faXmark, faTriangleExclamation, faTrash, faCheck, faCircleInfo, faSearch, faDoorOpen, faBuilding, faBuildingColumns } from '@fortawesome/free-solid-svg-icons';
import { stripDigits, centerNeedsMapping, isCenterMapped, resolveBuildingOperationalStatus, resolveCenterStructureMode } from './utils';
import { formatRoomLabel, formatFloorLabel } from '../../utils/formatRoomLabel';
import { displayEntityName } from '../../utils/displayEntityName';
import { sanitizePhoneInput, validateContactNumber } from '../../utils/formValidation';
import BarangaysServedPicker from '../BarangaysServedPicker/BarangaysServedPicker';
import './ModalShell.css';

function roomCapacityUsage(room) {
  const familySlots = Math.max(1, Number(room?.family_slots ?? 5));
  const peopleSpaces = Math.max(1, Number(room?.people_spaces ?? room?.capacity ?? 25));
  const usedSlots = Number(room?.used_slots ?? room?.assigned_households ?? room?.household_assigned ?? 0);
  const usedSpaces = Number(room?.used_spaces ?? room?.assigned ?? room?.occupied ?? 0);
  return {
    familySlots,
    peopleSpaces,
    usedSlots,
    usedSpaces,
    availableSlots: Math.max(0, Number(room?.available_slots ?? familySlots - usedSlots)),
    availableSpaces: Math.max(0, Number(room?.available_spaces ?? room?.unassigned ?? peopleSpaces - usedSpaces)),
  };
}

export function ModalShell({ open = false, title = '', subtitle, onClose, formId, onPrimary, loading = false, primaryLabel = 'Save', primaryDisabled = false, cancelLabel = 'Cancel', children, footer, dialogClassName = '', headerExtra }) {
  if (!open) return null;
  const defaultFooter = (
    <>
      <button type="button" className="btn btn-secondary" disabled={loading} onClick={onClose}>{cancelLabel}</button>
      {onPrimary ? (
        <button type="button" onClick={onPrimary} className="btn btn-primary" disabled={loading || primaryDisabled}>
          {loading ? (<><FontAwesomeIcon icon={faCircleNotch} spin size="xs" /> {primaryLabel}</>) : primaryLabel}
        </button>
      ) : (
        <button type="submit" form={formId || undefined} className="btn btn-primary" disabled={loading || primaryDisabled}>
          {loading ? (<><FontAwesomeIcon icon={faCircleNotch} spin size="xs" /> {primaryLabel}</>) : primaryLabel}
        </button>
      )}
    </>
  );
  return (
    <div className="modal-shell-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-shell-title" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className={`modal-shell-dialog ${dialogClassName}`.trim()} onClick={(e) => e.stopPropagation()}>
        <header className="modal-shell-header">
          <div className="modal-shell-header__text">
            {title && <h2 id="modal-shell-title" className="modal-shell-title">{title}</h2>}
            {subtitle && <p className="modal-shell-subtitle">{subtitle}</p>}
          </div>
          <button type="button" className="modal-shell-close-btn" onClick={onClose} aria-label="Close"><FontAwesomeIcon icon={faXmark} /></button>
        </header>
        {headerExtra}
        <div className="modal-shell-body">{children}</div>
        <footer className="modal-shell-footer">{footer ?? defaultFooter}</footer>
      </section>
    </div>
  );
}

export function ConfirmCenterDialog({ open = false, title = 'Confirm', message = '', confirmText = 'Confirm', danger = false, onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) { if (onCancel) onCancel(); } }}>
      <div className="modal-dialog">
        <div className="modal-header">
          <h3>{title}</h3>
          <button type="button" className="modal-close-btn" onClick={() => { if (onCancel) onCancel(); }}><FontAwesomeIcon icon={faXmark} /></button>
        </div>
        <div className="modal-body"><p style={{ margin: 0, fontSize: 'var(--text-sm)', lineHeight: 1.5, color: 'var(--text)' }}>{message}</p></div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={() => { if (onCancel) onCancel(); }}>Cancel</button>
          <button type="button" className={danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={async () => { if (onConfirm) await onConfirm(); }}>{confirmText || 'Confirm'}</button>
        </div>
      </div>
    </div>
  );
}

// Center type constants
const CENTER_TYPES = [
  { value: 'campus', label: 'Campus', description: 'Multi-building campus with rooms organized by building' },
  { value: 'private_property', label: 'Private Property', description: 'Single property with rooms (no buildings required)' },
  { value: 'single_venue', label: 'Single Venue', description: 'One large venue, no rooms, direct family assignment' },
];

// Building material options in required order
export const BUILDING_MATERIAL_OPTIONS = [
  'Reinforced Concrete',
  'Concrete & Steel Frame',
  'Structural Steel',
  'Semi-Permanent (Masonry & Timber)',
  'Lightweight Wood / Timber',
];

// 12 standard amenities
export const AMENITIES_LIST = [
  'Wheelchair Ramps',
  'Ground Floor Access',
  'PWD Restrooms',
  'Backup Generator / Solar',
  'Wide Doorways (90cm+)',
  'Potable Drinking Water',
  'Tactile Paving & Braille Signage',
  'First Aid / Medical Station',
  'Handrails & Grab Bars',
  'Child-Friendly Space / Lactation',
  'Emergency Power / Solar Backup',
  'Emergency Comm / Wi-Fi',
];

export const AMENITY_OPTIONS = AMENITIES_LIST;

// Wizard step definitions
const WIZARD_STEPS = [
  { id: 1, title: 'Basic info' },
  { id: 2, title: 'Location' },
  { id: 3, title: 'Details & contact' },
  { id: 4, title: 'Amenities' },
];

const STRUCTURE_PILL_LABELS = {
  open_area: 'Open area',
  rooms_only: 'Rooms only',
  buildings_and_rooms: 'Buildings and rooms',
};

export function CenterFormModal({
  mode = 'add',
  centerForm,
  onChange,
  barangays = [],
  saving = false,
  error = '',
  onClearError,
  onSubmit,
  onClose,
  onBeforeDeselect,
  allowedCenterTypes = null,
  initialStep = 1,
}) {
  const title = mode === 'add' ? 'Add Evacuation Center' : 'Edit Evacuation Center';
  const subtitle = mode === 'add' ? 'Create a new evacuation center' : 'Edit evacuation center details';
  const [currentStep, setCurrentStep] = useState(initialStep);
  const [fieldErrors, setFieldErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const [submitBlocked, setSubmitBlocked] = useState(false);
  const step4UnlockTimeRef = useRef(0);
  const stepHeadingRef = useRef(null);
  const isFirstMount = useRef(true);

  const [selectedMaterialOption, setSelectedMaterialOption] = useState(() => {
    const current = (centerForm.building_material || '').trim();
    if (!current) return '';
    const matched = BUILDING_MATERIAL_OPTIONS.find(
      (opt) => opt.toLowerCase() === current.toLowerCase()
    );
    return matched || 'Other';
  });

  const [customMaterialText, setCustomMaterialText] = useState(() => {
    const current = (centerForm.building_material || '').trim();
    if (!current) return '';
    const matched = BUILDING_MATERIAL_OPTIONS.find(
      (opt) => opt.toLowerCase() === current.toLowerCase()
    );
    return matched ? '' : current;
  });

  const [refMetadata, setRefMetadata] = useState({
    center_type: [],
    building_material: [],
    amenities: [],
  });

  useEffect(() => {
    let active = true;
    async function loadMeta() {
      try {
        const [cts, mats, ams] = await Promise.all([
          api.getCenterTypes({ active_only: true }),
          api.getBuildingMaterials({ active_only: true }),
          api.getAmenities({ active_only: true }),
        ]);
        if (active) {
          setRefMetadata({
            center_type: Array.isArray(cts) ? cts : [],
            building_material: Array.isArray(mats) ? mats : [],
            amenities: Array.isArray(ams) ? ams : [],
          });
        }
      } catch (err) {
        console.warn('Could not load dynamic shelter tables', err);
      }
    }
    loadMeta();
    return () => {
      active = false;
    };
  }, []);

  // Reset to initialStep each time modal opens / mode changes
  useEffect(() => {
    setCurrentStep(initialStep);
    setFieldErrors({});
    setIsSubmitting(false);
    isSubmittingRef.current = false;
    setSubmitBlocked(false);
    step4UnlockTimeRef.current = 0;

    const current = (centerForm.building_material || '').trim();
    if (!current) {
      setSelectedMaterialOption('');
      setCustomMaterialText('');
    } else {
      const matched = BUILDING_MATERIAL_OPTIONS.find(
        (opt) => opt.toLowerCase() === current.toLowerCase()
      );
      if (matched) {
        setSelectedMaterialOption(matched);
        setCustomMaterialText('');
      } else {
        setSelectedMaterialOption('Other');
        setCustomMaterialText(current);
      }
    }
  }, [mode, initialStep]);

  useEffect(() => {
    const current = (centerForm.building_material || '').trim();
    if (!current) {
      setSelectedMaterialOption((prev) => (prev === 'Other' ? 'Other' : ''));
    } else {
      const matched = BUILDING_MATERIAL_OPTIONS.find(
        (opt) => opt.toLowerCase() === current.toLowerCase()
      );
      if (matched) {
        setSelectedMaterialOption(matched);
      } else {
        setSelectedMaterialOption('Other');
        setCustomMaterialText(current);
      }
    }
  }, [centerForm.building_material]);

  const selectedAmenities = useMemo(() => {
    if (!centerForm.amenities) return [];
    if (Array.isArray(centerForm.amenities)) {
      return centerForm.amenities
        .map((a) => (typeof a === 'object' && a !== null ? a.name || a.code : a))
        .filter(Boolean);
    }
    return [];
  }, [centerForm.amenities]);

  function toggleAmenity(name) {
    const isIncluded = selectedAmenities.some(
      (a) => a.toLowerCase() === name.toLowerCase()
    );
    const next = isIncluded
      ? selectedAmenities.filter((a) => a.toLowerCase() !== name.toLowerCase())
      : [...selectedAmenities, name];
    onChange({
      ...centerForm,
      amenities: next,
    });
  }

  function handleSelectAllAmenities() {
    onChange({
      ...centerForm,
      amenities: [...AMENITIES_LIST],
    });
  }

  function handleClearAmenities() {
    onChange({
      ...centerForm,
      amenities: [],
    });
  }

  // Keep isSubmitting synchronized with saving prop
  useEffect(() => {
    if (!saving) {
      setIsSubmitting(false);
      isSubmittingRef.current = false;
    }
  }, [saving]);

  // 300ms safety delay upon entering step 4 to prevent accidental double-clicks or lingering events
  useEffect(() => {
    if (currentStep === 4) {
      step4UnlockTimeRef.current = Date.now() + 300;
      setSubmitBlocked(true);
      const timer = setTimeout(() => {
        setSubmitBlocked(false);
      }, 300);
      return () => clearTimeout(timer);
    } else {
      setSubmitBlocked(false);
      step4UnlockTimeRef.current = 0;
    }
  }, [currentStep]);

  // Focus step title on each step change (skip initial mount)
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }
    if (stepHeadingRef.current) {
      stepHeadingRef.current.focus();
    }
  }, [currentStep]);

  const dynamicCenterTypes = useMemo(() => {
    if (refMetadata.center_type && refMetadata.center_type.length > 0) {
      return refMetadata.center_type.map((t) => ({
        id: t.id,
        value: t.code,
        label: t.name,
        description: t.description || '',
        structure_mode: t.structure_mode || 'buildings_and_rooms',
      }));
    }
    return CENTER_TYPES.map((t) => ({
      ...t,
      structure_mode:
        t.value === 'single_venue'
          ? 'open_area'
          : t.value === 'private_property'
            ? 'rooms_only'
            : 'buildings_and_rooms',
    }));
  }, [refMetadata.center_type]);

  const selectedCenterTypeOption = dynamicCenterTypes.find(
    (t) => t.value === centerForm.center_type
  );
  const currentStructureMode =
    selectedCenterTypeOption?.structure_mode ||
    resolveCenterStructureMode(centerForm);
  const isSingleVenue = currentStructureMode === 'open_area';

  function clearFieldError(field) {
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function validateStep(step) {
    let valid = true;
    const newErrors = {};

    if (step === 1) {
      if (!centerForm.center_type) {
        newErrors.center_type = 'Center type is required.';
        valid = false;
      } else if (
        mode === 'edit' &&
        allowedCenterTypes &&
        allowedCenterTypes[centerForm.center_type]?.allowed === false
      ) {
        newErrors.center_type =
          allowedCenterTypes[centerForm.center_type]?.reason ||
          'This center type cannot be selected due to existing structure or assigned families.';
        valid = false;
      }
      if (isSingleVenue && (!centerForm.capacity || Number(centerForm.capacity) < 1)) {
        newErrors.capacity = 'Capacity is required for Open area centers (minimum 1).';
        valid = false;
      }
      if (!centerForm.name || !centerForm.name.trim()) {
        newErrors.name = 'Evacuation center name is required.';
        valid = false;
      }
    } else if (step === 2) {
      if (!centerForm.barangay_ids || centerForm.barangay_ids.length === 0) {
        newErrors.barangays = 'Select at least one barangay served by this center.';
        valid = false;
      }
    } else if (step === 3) {
      const phoneErr = validateContactNumber(centerForm.contact_number, {
        required: false,
        label: 'Contact number',
      });
      if (phoneErr) {
        newErrors.contact_number = phoneErr;
        valid = false;
      }
    }

    setFieldErrors((prev) => {
      const next = { ...prev };
      if (step === 1) {
        delete next.name;
        delete next.center_type;
        delete next.capacity;
      } else if (step === 2) {
        delete next.barangays;
      } else if (step === 3) {
        delete next.contact_number;
      }
      return { ...next, ...newErrors };
    });

    if (!valid) {
      setTimeout(() => {
        if (step === 1) {
          if (newErrors.center_type) {
            document.getElementById('center-type')?.focus();
          } else if (newErrors.capacity) {
            document.getElementById('center-capacity')?.focus();
          } else if (newErrors.name) {
            document.getElementById('center-name')?.focus();
          }
        } else if (step === 2) {
          const searchInput = document.querySelector('.cfm-dialog .bsp-search-input');
          if (searchInput) {
            searchInput.focus();
          }
        }
      }, 50);
    }

    return valid;
  }

  function handleNext() {
    if (validateStep(currentStep)) {
      if (currentStep === 3) {
        step4UnlockTimeRef.current = Date.now() + 300;
        setSubmitBlocked(true);
        setTimeout(() => {
          setSubmitBlocked(false);
        }, 300);
      }
      setCurrentStep((prev) => Math.min(prev + 1, 4));
    }
  }

  function handleBack() {
    setSubmitBlocked(false);
    step4UnlockTimeRef.current = 0;
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  }

  function handleGoToStep(targetStep) {
    if (targetStep < currentStep) {
      setSubmitBlocked(false);
      step4UnlockTimeRef.current = 0;
      setCurrentStep(targetStep);
    }
  }

  function handleSubmit(e) {
    if (e) {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      if (typeof e.stopPropagation === 'function') e.stopPropagation();
    }

    // Guard: If not on step 4, never submit; advance to next step through validated Next logic
    if (currentStep < 4) {
      handleNext();
      return;
    }

    // Guard: Safety delay after entering step 4 (300ms)
    if (Date.now() < step4UnlockTimeRef.current || submitBlocked) {
      return;
    }

    // Guard: Prevent double-submits
    if (isSubmittingRef.current || saving) {
      return;
    }

    // Validate all steps
    if (!validateStep(1)) {
      setCurrentStep(1);
      return;
    }
    if (!validateStep(2)) {
      setCurrentStep(2);
      return;
    }
    if (!validateStep(3)) {
      setCurrentStep(3);
      return;
    }
    if (!validateStep(4)) {
      setCurrentStep(4);
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    onSubmit(e);
  }

  function handleFormKeyDown(e) {
    if (e.key === 'Enter') {
      // On step 4, Enter inside the notes textarea must insert a new line and must not submit
      if (e.target.tagName === 'TEXTAREA') {
        return;
      }
      // If user pressed Enter on a button, allow normal button activation
      if (e.target.tagName === 'BUTTON') {
        return;
      }

      e.preventDefault();

      if (currentStep < 4) {
        handleNext();
      } else {
        handleSubmit(e);
      }
    }
  }

  const selectedTypeRule =
    mode === 'edit' && allowedCenterTypes && centerForm.center_type
      ? allowedCenterTypes[centerForm.center_type]
      : null;

  const currentTypeAllowed =
    mode !== 'edit' ||
    !allowedCenterTypes ||
    !centerForm.center_type ||
    selectedTypeRule?.allowed !== false;

  const blockedTypeMessages =
    mode === 'edit' && allowedCenterTypes
      ? dynamicCenterTypes
          .filter((t) => allowedCenterTypes[t.value] && allowedCenterTypes[t.value].allowed === false)
          .map((t) => ({
            code: t.value,
            label: t.label,
            reason: allowedCenterTypes[t.value].reason,
          }))
      : [];

  const typeUsage = selectedTypeRule?.usage || null;
  const hasExistingStructureOrFamilies = Boolean(
    mode === 'edit' &&
      typeUsage &&
      (typeUsage.buildings > 0 ||
        typeUsage.rooms > 0 ||
        typeUsage.room_assigned_families > 0 ||
        typeUsage.venue_assigned_families > 0)
  );

  const stepperElement = (
    <div className="cfm-stepper-container">
      {/* Live announcement region for accessibility */}
      <div className="cfm-sr-only" aria-live="polite" aria-atomic="true">
        {`Step ${currentStep} of 4 · ${WIZARD_STEPS[currentStep - 1].title}`}
      </div>

      {/* Desktop Stepper */}
      <div className="cfm-stepper-desktop" role="navigation" aria-label="Wizard Steps">
        <div className="cfm-stepper-track">
          {WIZARD_STEPS.map((s, idx) => {
            const isCompleted = s.id < currentStep;
            const isCurrent = s.id === currentStep;
            const isUpcoming = s.id > currentStep;

            return (
              <div key={s.id} className="cfm-stepper-item">
                {idx > 0 && (
                  <div
                    className={`cfm-stepper-line ${s.id <= currentStep ? 'is-active' : ''}`}
                    aria-hidden="true"
                  />
                )}
                <button
                  type="button"
                  className={`cfm-stepper-dot ${isCompleted ? 'is-completed' : ''} ${isCurrent ? 'is-current' : ''} ${isUpcoming ? 'is-upcoming' : ''}`}
                  onClick={() => isCompleted && handleGoToStep(s.id)}
                  disabled={isUpcoming}
                  aria-current={isCurrent ? 'step' : undefined}
                  aria-label={`Step ${s.id}: ${s.title}${isCompleted ? ' (completed, click to return)' : isCurrent ? ' (current)' : ''}`}
                  title={isCompleted ? `Go back to Step ${s.id}: ${s.title}` : undefined}
                >
                  {isCompleted ? (
                    <FontAwesomeIcon icon={faCheck} size="xs" />
                  ) : (
                    <span>{s.id}</span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
        <div className="cfm-stepper-label">
          Step {currentStep} of 4 · {WIZARD_STEPS[currentStep - 1].title}
        </div>
      </div>

      {/* Mobile Stepper (768px and below) */}
      <div className="cfm-stepper-mobile">
        <div className="cfm-stepper-mobile-label">
          Step {currentStep} of 4 · {WIZARD_STEPS[currentStep - 1].title}
        </div>
        <div className="cfm-mobile-progress-track" aria-hidden="true">
          <div
            className="cfm-mobile-progress-fill"
            style={{ width: `${(currentStep / 4) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );

  const customFooter = (
    <div className="cfm-footer-wrap">
      {currentStep === 1 ? (
        <button
          key="cancel-btn"
          type="button"
          className="cfm-btn-cancel"
          disabled={saving || isSubmitting}
          onClick={onClose}
        >
          Cancel
        </button>
      ) : (
        <button
          key="back-btn"
          type="button"
          className="cfm-btn-secondary"
          disabled={saving || isSubmitting}
          onClick={handleBack}
        >
          Back
        </button>
      )}

      {currentStep < 4 ? (
        <button
          key="next-btn"
          type="button"
          className="cfm-btn-primary"
          disabled={saving || isSubmitting}
          onClick={handleNext}
        >
          Next
        </button>
      ) : (
        <button
          key="submit-btn"
          type="submit"
          form="center-form"
          className="cfm-btn-primary"
          disabled={saving || isSubmitting || submitBlocked}
        >
          {saving || isSubmitting ? (
            <>
              <FontAwesomeIcon icon={faCircleNotch} spin size="xs" /> Saving...
            </>
          ) : mode === 'add' ? (
            'Create Center'
          ) : (
            'Save Changes'
          )}
        </button>
      )}
    </div>
  );

  return (
    <ModalShell
      open
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      formId="center-form"
      dialogClassName="cfm-dialog"
      headerExtra={stepperElement}
      footer={customFooter}
    >
      <form
        id="center-form"
        onSubmit={handleSubmit}
        onKeyDown={handleFormKeyDown}
        noValidate
        className="cfm-form"
      >
        {error && (
          <div className="cfm-error-banner" role="alert">
            <FontAwesomeIcon icon={faTriangleExclamation} />
            <span style={{ flex: 1 }}>{error}</span>
            {onClearError && (
              <button
                type="button"
                className="cfm-error-dismiss"
                onClick={onClearError}
                aria-label="Dismiss error"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            )}
          </div>
        )}
        {/* Step 1: Basic info */}
        {currentStep === 1 && (
          <div key={1} className="cfm-step-panel">
            <h3 ref={stepHeadingRef} tabIndex={-1} className="cfm-step-title">
              Basic info
            </h3>

            <div className="cfm-field">
              <div className="cfm-label-row">
                <label htmlFor="center-type" className="cfm-label">
                  Center Type <span className="cfm-required">*</span>
                </label>
                <span className="cfm-structure-pill">
                  {STRUCTURE_PILL_LABELS[currentStructureMode] || 'Buildings and rooms'}
                </span>
              </div>
              <select
                id="center-type"
                className={`cfm-select ${fieldErrors.center_type ? 'is-invalid' : ''}`}
                value={centerForm.center_type || 'campus'}
                onChange={(e) => {
                  clearFieldError('center_type');
                  clearFieldError('capacity');
                  const newType = e.target.value;
                  const matchedType = dynamicCenterTypes.find((t) => t.value === newType);
                  const nextStructure = matchedType?.structure_mode || 'buildings_and_rooms';

                  if (nextStructure === 'open_area') {
                    onChange({
                      ...centerForm,
                      center_type: newType,
                      center_type_id: matchedType?.id ?? centerForm.center_type_id ?? null,
                      structure_mode: nextStructure,
                      max_rooms: null,
                    });
                  } else {
                    onChange({
                      ...centerForm,
                      center_type: newType,
                      center_type_id: matchedType?.id ?? centerForm.center_type_id ?? null,
                      structure_mode: nextStructure,
                      capacity: null,
                      max_rooms: null,
                    });
                  }
                }}
              >
                {dynamicCenterTypes.map((type) => {
                  const rule = mode === 'edit' && allowedCenterTypes ? allowedCenterTypes[type.value] : null;
                  const isBlockedOption = Boolean(rule && rule.allowed === false && type.value !== centerForm.center_type);
                  return (
                    <option key={type.value} value={type.value} disabled={isBlockedOption}>
                      {type.label}{isBlockedOption ? ' (Blocked)' : ''}
                    </option>
                  );
                })}
              </select>
              {fieldErrors.center_type && <p className="cfm-field-error">{fieldErrors.center_type}</p>}
              {mode === 'edit' && !currentTypeAllowed && selectedTypeRule?.reason && (
                <div className="cfm-type-callout is-blocked" role="alert">
                  <FontAwesomeIcon icon={faTriangleExclamation} style={{ marginTop: '2px' }} />
                  <span>{selectedTypeRule.reason}</span>
                </div>
              )}
              {mode === 'edit' && (selectedTypeRule?.warning || hasExistingStructureOrFamilies) && (
                <div className="cfm-type-callout is-warning" role="status">
                  <FontAwesomeIcon icon={faTriangleExclamation} style={{ marginTop: '2px' }} />
                  <div>
                    <div>
                      {selectedTypeRule?.warning ||
                        'Changing center type affects how buildings, rooms, and families are organized.'}
                    </div>
                    {blockedTypeMessages.length > 0 && (
                      <ul className="cfm-type-callout-list">
                        {blockedTypeMessages.map((b) => (
                          <li key={b.code}>
                            <strong>{b.label}:</strong> {b.reason}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
              {!selectedTypeRule?.warning && !hasExistingStructureOrFamilies && (
                <p className="cfm-helper-text">
                  {selectedCenterTypeOption?.description || 'Select a center type to set its structure.'}
                </p>
              )}
            </div>

            {isSingleVenue && (
              <div className="cfm-field">
                <label htmlFor="center-capacity" className="cfm-label">
                  Capacity <span className="cfm-required">*</span>
                </label>
                <input
                  id="center-capacity"
                  type="number"
                  min="1"
                  className={`cfm-input ${fieldErrors.capacity ? 'is-invalid' : ''}`}
                  placeholder="e.g. 250"
                  value={centerForm.capacity ?? ''}
                  onChange={(e) => {
                    clearFieldError('capacity');
                    onChange({ ...centerForm, capacity: e.target.value || null });
                  }}
                  required
                />
                {fieldErrors.capacity && <p className="cfm-field-error">{fieldErrors.capacity}</p>}
              </div>
            )}

            <div className="cfm-field">
              <label htmlFor="center-name" className="cfm-label">
                Center Name <span className="cfm-required">*</span>
              </label>
              <input
                id="center-name"
                type="text"
                className={`cfm-input ${fieldErrors.name ? 'is-invalid' : ''}`}
                placeholder="e.g. Sogod Central Gymnasium"
                value={centerForm.name || ''}
                onChange={(e) => {
                  clearFieldError('name');
                  onChange({ ...centerForm, name: stripDigits(e.target.value) });
                }}
              />
              {fieldErrors.name && <p className="cfm-field-error">{fieldErrors.name}</p>}
            </div>
          </div>
        )}

        {/* Step 2: Location */}
        {currentStep === 2 && (
          <div key={2} className="cfm-step-panel">
            <h3 ref={stepHeadingRef} tabIndex={-1} className="cfm-step-title">
              Location
            </h3>

            <div className="cfm-field">
              <BarangaysServedPicker
                barangays={barangays}
                selectedIds={centerForm.barangay_ids}
                onChange={(selectedIds) => {
                  clearFieldError('barangays');
                  onChange((prev) => ({ ...prev, barangay_ids: selectedIds }));
                }}
                onBeforeDeselect={onBeforeDeselect}
                required
                disabled={saving}
              />
              {fieldErrors.barangays && <p className="cfm-field-error">{fieldErrors.barangays}</p>}
            </div>
          </div>
        )}

        {/* Step 3: Details & contact */}
        {currentStep === 3 && (
          <div key={3} className="cfm-step-panel">
            <h3 ref={stepHeadingRef} tabIndex={-1} className="cfm-step-title">
              Details &amp; contact
            </h3>

            <div className="cfm-field">
              <label htmlFor="center-building-material" className="cfm-label">
                Building Material
              </label>
              <select
                id="center-building-material"
                className={`cfm-select ${fieldErrors.building_material ? 'is-invalid' : ''}`}
                value={selectedMaterialOption}
                onChange={(e) => {
                  clearFieldError('building_material');
                  const val = e.target.value;
                  setSelectedMaterialOption(val);
                  if (val === 'Other') {
                    const nextVal = customMaterialText.trim();
                    onChange({
                      ...centerForm,
                      building_material: nextVal,
                      building_material_id: null,
                    });
                  } else if (val === '') {
                    setCustomMaterialText('');
                    onChange({
                      ...centerForm,
                      building_material: '',
                      building_material_id: null,
                    });
                  } else {
                    setCustomMaterialText('');
                    const matchedMeta = (refMetadata.building_material || []).find(
                      (m) => m.name.toLowerCase() === val.toLowerCase()
                    );
                    onChange({
                      ...centerForm,
                      building_material: val,
                      building_material_id: matchedMeta ? matchedMeta.id : null,
                    });
                  }
                }}
              >
                <option value="">Select building material</option>
                {BUILDING_MATERIAL_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
                <option value="Other">Other</option>
              </select>
              {fieldErrors.building_material && (
                <p className="cfm-field-error">{fieldErrors.building_material}</p>
              )}

              {selectedMaterialOption === 'Other' && (
                <div className="cfm-field" style={{ marginTop: '10px' }}>
                  <label htmlFor="center-building-material-custom" className="cfm-label">
                    Specify material
                  </label>
                  <input
                    id="center-building-material-custom"
                    type="text"
                    className="cfm-input"
                    placeholder="e.g. Reinforced Concrete, Structural Steel"
                    value={customMaterialText}
                    onChange={(e) => {
                      clearFieldError('building_material');
                      const val = e.target.value;
                      setCustomMaterialText(val);
                      onChange({
                        ...centerForm,
                        building_material: val,
                        building_material_id: null,
                      });
                    }}
                  />
                </div>
              )}
            </div>

            <div className="cfm-field">
              <label htmlFor="center-contact" className="cfm-label">
                Contact Number
              </label>
              <input
                id="center-contact"
                type="tel"
                maxLength={20}
                className={`cfm-input ${fieldErrors.contact_number ? 'is-invalid' : ''}`}
                placeholder="e.g. 0917 123 4567"
                value={centerForm.contact_number || ''}
                onChange={(e) => {
                  clearFieldError('contact_number');
                  onChange({ ...centerForm, contact_number: sanitizePhoneInput(e.target.value) });
                }}
              />
              {fieldErrors.contact_number && <p className="cfm-field-error">{fieldErrors.contact_number}</p>}
            </div>

            <div className="cfm-field">
              <label htmlFor="center-owner" className="cfm-label">
                Property Owner / Operator
              </label>
              <input
                id="center-owner"
                type="text"
                className={`cfm-input ${fieldErrors.owner_name ? 'is-invalid' : ''}`}
                placeholder="e.g. LGU Sogod, Private Owner Name"
                value={centerForm.owner_name || ''}
                onChange={(e) => {
                  clearFieldError('owner_name');
                  onChange({ ...centerForm, owner_name: e.target.value });
                }}
              />
              {fieldErrors.owner_name && <p className="cfm-field-error">{fieldErrors.owner_name}</p>}
            </div>
          </div>
        )}

        {/* Step 4: Amenities */}
        {currentStep === 4 && (
          <div key={4} className="cfm-step-panel">
            <h3 ref={stepHeadingRef} tabIndex={-1} className="cfm-step-title">
              Amenities
            </h3>

            <fieldset className="cfm-amenities-fieldset">
              <div className="cfm-amenities-header">
                <legend className="cfm-amenities-legend">
                  <span className="cfm-amenities-legend-title">Amenities &amp; Facilities</span>
                  <span className="cfm-amenities-legend-count">
                    · {selectedAmenities.length} selected
                  </span>
                </legend>
                <div className="cfm-amenities-actions">
                  <button
                    type="button"
                    className="cfm-link-btn"
                    onClick={handleSelectAllAmenities}
                  >
                    Select all
                  </button>
                  <span className="cfm-amenities-sep" aria-hidden="true">·</span>
                  <button
                    type="button"
                    className="cfm-link-btn"
                    onClick={handleClearAmenities}
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="cfm-amenities-grid">
                {AMENITIES_LIST.map((name, idx) => {
                  const isChecked = selectedAmenities.some(
                    (a) => a.toLowerCase() === name.toLowerCase()
                  );
                  const checkboxId = `amenity-check-${idx}`;

                  return (
                    <label
                      key={name}
                      htmlFor={checkboxId}
                      className={`cfm-amenity-card ${isChecked ? 'is-checked' : ''}`}
                    >
                      <input
                        id={checkboxId}
                        type="checkbox"
                        className="cfm-amenity-checkbox"
                        checked={isChecked}
                        onChange={() => toggleAmenity(name)}
                      />
                      <span className="cfm-amenity-label">{name}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </div>
        )}
      </form>
    </ModalShell>
  );
}

const PEOPLE_PER_FAMILY_SLOT = 5;
const MIN_ROOM_PEOPLE_SPACES = 1;

function computeFamilySlots(peopleSpaces) {
  if (peopleSpaces === '' || peopleSpaces == null) return null;
  const spaces = Number(peopleSpaces);
  if (!Number.isInteger(spaces) || spaces < MIN_ROOM_PEOPLE_SPACES) return null;
  return Math.max(1, Math.ceil(spaces / PEOPLE_PER_FAMILY_SLOT));
}

export function CenterRoomModal({
  mode = 'add',
  selectedCenter,
  selectedRoom,
  roomForm,
  onChange,
  saving = false,
  onSubmit,
  onClose,
  buildings = [],
  defaultBuildingId = '',
  onDeleteRoom,
  errorMessage = '',
}) {
  const isEdit = mode === 'edit';
  const roomLabel = formatRoomLabel(selectedRoom?.room_number);
  const selectedBuildingName = buildings.find(
    (building) => String(building.id) === String(roomForm.building_id)
  )?.name;
  const title = isEdit ? 'Edit room' : 'Add room';
  const subtitle = isEdit
    ? `${roomLabel} · ${selectedCenter?.name || 'Evacuation center'}`
    : selectedBuildingName
      ? `${selectedBuildingName} · ${selectedCenter?.name || 'Evacuation center'}`
      : `Add a room to ${selectedCenter?.name || 'this evacuation center'}`;
  const [fieldErrors, setFieldErrors] = useState({});
  const calculatedFamilySlots = computeFamilySlots(roomForm.people_spaces);

  function clearFieldError(field) {
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }
  function setFieldError(field, message) {
    setFieldErrors((prev) => ({ ...prev, [field]: message }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    let valid = true;
    if (!roomForm.room_number || !roomForm.room_number.trim()) {
      setFieldError('room_number', 'Room number is required.');
      valid = false;
    } else {
      clearFieldError('room_number');
    }
    if (!Number.isInteger(Number(roomForm.people_spaces)) || Number(roomForm.people_spaces) < MIN_ROOM_PEOPLE_SPACES) {
      setFieldError('people_spaces', `Enter a whole number of people spaces (minimum ${MIN_ROOM_PEOPLE_SPACES}).`);
      valid = false;
    } else {
      clearFieldError('people_spaces');
    }
    const selectedBuilding = buildingOptions.find((building) => String(building.id) === String(roomForm.building_id));
    const floorCount = Number(selectedBuilding?.floors || 1);
    const hasFloor = roomForm.floor !== '' && roomForm.floor != null;
    if (roomForm.building_id && floorCount >= 2 && (!hasFloor || !Number.isInteger(Number(roomForm.floor)) || Number(roomForm.floor) < 1 || Number(roomForm.floor) > floorCount)) {
      setFieldError('floor', `Choose a floor from 1 to ${floorCount}.`);
      valid = false;
    } else {
      clearFieldError('floor');
    }
    if (!valid) return;
    onSubmit(e);
  }

  const centerNotMapped = selectedCenter && centerNeedsMapping(selectedCenter);

  // Normalize buildings to {id, name} options (same logic as backup RoomModal)
  const buildingOptions = useMemo(() => {
    return buildings.map((item) => {
      const props = item?.properties || item || {};
      const id = props.id ?? item?.id;
      const name = props.name || props.display_label || `Building #${id}`;
      return { id, name, floors: props.floors ?? item?.floors ?? null };
    });
  }, [buildings]);

  const hasBuildings = resolveCenterStructureMode(selectedCenter) === 'buildings_and_rooms';
  const selectedBuilding = buildingOptions.find((building) => String(building.id) === String(roomForm.building_id));
  const selectedFloorCount = Number(selectedBuilding?.floors || 1);

  const modalFooter = (
    <div className="crm-footer">
      {isEdit && onDeleteRoom ? (
        <button
          type="button"
          className="crm-btn-delete"
          onClick={() => {
            onClose();
            onDeleteRoom(selectedRoom);
          }}
        >
          <FontAwesomeIcon icon={faTrash} />
          <span>Delete room</span>
        </button>
      ) : (
        <span className="crm-footer-spacer" />
      )}
      <div className="crm-footer-actions">
        <button
          type="button"
          className="crm-btn-cancel"
          disabled={saving}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="submit"
          form="room-form"
          className="crm-btn-primary"
          disabled={saving}
        >
          {saving ? (
            <>
              <FontAwesomeIcon icon={faCircleNotch} spin size="xs" /> Saving...
            </>
          ) : isEdit ? (
            'Save'
          ) : (
            'Add Room'
          )}
        </button>
      </div>
    </div>
  );

  return (
    <ModalShell
      open
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      formId="room-form"
      loading={saving}
      footer={modalFooter}
      dialogClassName="crm-dialog"
    >
      <form id="room-form" className="crm-room-form" onSubmit={handleSubmit} noValidate>
        {errorMessage && (
          <div className="crm-room-note crm-room-note-error" role="alert">
            {errorMessage}
          </div>
        )}
        {centerNotMapped && (
          <div className="crm-room-note" role="status">
            <FontAwesomeIcon icon={faCircleInfo} aria-hidden="true" />
            <span>
              This center isn’t on the map yet. You can still {isEdit ? 'edit this room' : 'add it'};
              mapping the center helps staff find it.
            </span>
          </div>
        )}
        <div className="form-group">
          <label htmlFor="room-number" className="crm-room-label">
            Room name <span className="crm-room-required">*</span>
          </label>
          <input
            id="room-number"
            type="text"
            className={fieldErrors.room_number ? 'form-input is-invalid' : 'form-input'}
            placeholder="e.g. Room 101, Ground Floor"
            value={roomForm.room_number}
            onChange={(e) => {
              clearFieldError('room_number');
              onChange({ ...roomForm, room_number: e.target.value });
            }}
          />
          {fieldErrors.room_number && <p className="field-error">{fieldErrors.room_number}</p>}
        </div>
        <div className="form-group">
          <label htmlFor="room-people-spaces" className="crm-room-label">
            People spaces <span className="crm-room-required">*</span>
          </label>
          <input
            id="room-people-spaces"
            type="number"
            min={MIN_ROOM_PEOPLE_SPACES}
            step="1"
            required
            inputMode="numeric"
            onKeyDown={(e) => ["e", "E", "+", "-", ".", ","].includes(e.key) && e.preventDefault()}
            className={fieldErrors.people_spaces ? 'form-input is-invalid' : 'form-input'}
            value={roomForm.people_spaces ?? ''}
            onChange={(e) => {
              clearFieldError('people_spaces');
              const nextSpaces = e.target.value;
              const nextSlots = computeFamilySlots(nextSpaces);
              onChange({
                ...roomForm,
                people_spaces: nextSpaces,
                family_slots: nextSlots != null ? String(nextSlots) : '',
              });
            }}
          />
          {fieldErrors.people_spaces ? (
            <p className="field-error">{fieldErrors.people_spaces}</p>
          ) : calculatedFamilySlots != null ? (
            <p className="cfm-helper-text">
              Automatically sets <strong>{calculatedFamilySlots}</strong>{' '}
              {calculatedFamilySlots === 1 ? 'family slot' : 'family slots'} (1 slot per{' '}
              {PEOPLE_PER_FAMILY_SLOT} people, rounded up).
            </p>
          ) : (
            <p className="cfm-helper-text">
              Enter the room capacity in people spaces (at least 1 person).
            </p>
          )}
        </div>
        {hasBuildings && (
          <div className="form-group">
            <label htmlFor="room-building">Building</label>
            <select
              id="room-building"
              className={`form-input crm-room-select ${fieldErrors.building_id ? 'is-invalid' : ''}`}
              value={roomForm.building_id ?? ''}
              onChange={(e) => {
                clearFieldError('building_id');
                clearFieldError('floor');
                const nextBuilding = buildingOptions.find((building) => String(building.id) === String(e.target.value));
                const nextFloors = Number(nextBuilding?.floors || 1);
                const currentFloor = Number(roomForm.floor);
                onChange({ ...roomForm, building_id: e.target.value, floor: e.target.value ? String(Number.isInteger(currentFloor) && currentFloor >= 1 && currentFloor <= nextFloors ? currentFloor : 1) : '' });
              }}
            >
              <option value="">No building (unassigned)</option>
              {buildingOptions.map((b) => (
                <option key={b.id} value={String(b.id)}>
                  {b.name}
                </option>
              ))}
            </select>
            {fieldErrors.building_id && <p className="field-error">{fieldErrors.building_id}</p>}
          </div>
        )}
        {selectedBuilding && selectedFloorCount >= 2 && (
        <div className="form-group">
          <label htmlFor="room-floor" className="crm-room-label">Floor <span className="crm-room-required">*</span></label>
            <select
              id="room-floor"
              required
              className={`form-input crm-room-select ${fieldErrors.floor ? 'is-invalid' : ''}`}
              value={roomForm.floor ?? ''}
              onChange={(e) => { clearFieldError('floor'); onChange({ ...roomForm, floor: e.target.value }); }}
            >
              <option value="">Select floor</option>
              {Array.from({ length: selectedFloorCount }, (_, index) => index + 1).map((floor) => (
                <option key={floor} value={String(floor)}>{formatFloorLabel(floor)}</option>
              ))}
            </select>
          {fieldErrors.floor && <p className="field-error">{fieldErrors.floor}</p>}
        </div>
        )}
      </form>
    </ModalShell>
  );
}

export function BuildingFormModal({
  open = false,
  mode = 'add',
  buildingForm,
  onChange,
  activeRoomCount = 0,
  assignedHouseholdCount = 0,
  saving = false,
  onSubmit,
  onClose,
}) {
  const [fieldErrors, setFieldErrors] = useState({});
  function clearFieldError(field) {
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }
  function setFieldError(field, message) {
    setFieldErrors((prev) => ({ ...prev, [field]: message }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    let valid = true;
    if (!buildingForm.name || !buildingForm.name.trim()) {
      setFieldError('name', 'Building name is required.');
      valid = false;
    } else {
      clearFieldError('name');
    }

    if (
      buildingForm.max_rooms !== null &&
      buildingForm.max_rooms !== '' &&
      Number(buildingForm.max_rooms) < 1
    ) {
      setFieldError('max_rooms', 'Max rooms must be at least 1.');
      valid = false;
    } else if (
      mode === 'edit' &&
      buildingForm.max_rooms !== null &&
      buildingForm.max_rooms !== '' &&
      Number(buildingForm.max_rooms) < activeRoomCount
    ) {
      setFieldError(
        'max_rooms',
        `Max rooms cannot be less than currently linked rooms (${activeRoomCount}). Remove or unlink rooms first.`
      );
      valid = false;
    } else {
      clearFieldError('max_rooms');
    }

    if (
      buildingForm.floors == null ||
      buildingForm.floors === '' ||
      !Number.isInteger(Number(buildingForm.floors)) ||
      Number(buildingForm.floors) < 1 ||
      Number(buildingForm.floors) > 20
    ) {
      setFieldError('floors', 'Number of floors must be from 1 to 20.');
      valid = false;
    } else {
      clearFieldError('floors');
    }

    if (!valid) return;
    onSubmit(e);
  }

  const isEdit = mode === 'edit';
  const title = isEdit ? 'Edit Building' : 'Add Building';
  const subtitle = isEdit
    ? `Update ${buildingForm.name || 'building'} details and room capacity`
    : 'Create a building for this evacuation center';

  const customFooter = (
    <>
      <button type="button" className="bfm-btn-cancel" disabled={saving} onClick={onClose}>
        Cancel
      </button>
      <button type="submit" form="building-form" className="bfm-btn-primary" disabled={saving}>
        {saving ? (
          <>
            <FontAwesomeIcon icon={faCircleNotch} spin size="xs" /> Saving...
          </>
        ) : isEdit ? (
          'Save Changes'
        ) : (
          'Add Building'
        )}
      </button>
    </>
  );

  return (
    <ModalShell
      open={open}
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      formId="building-form"
      dialogClassName={`bfm-dialog ${isEdit ? 'bfm-dialog--edit' : 'bfm-dialog--add'}`}
      footer={customFooter}
    >
      <form id="building-form" onSubmit={handleSubmit} noValidate className={`bfm-form ${isEdit ? 'is-edit' : 'is-add'}`}>
        {!isEdit && (
          <div className="bfm-add-intro">
            <span className="bfm-add-intro-icon" aria-hidden="true">
              <FontAwesomeIcon icon={faBuilding} />
            </span>
            <span className="bfm-add-intro-copy">
              <strong>Set up a building</strong>
              <span>Name it clearly so staff can find and manage its rooms.</span>
            </span>
          </div>
        )}

        <div className="bfm-field">
          <label htmlFor="building-name" className="bfm-label">
            Building name <span className="bfm-required">*</span>
          </label>
          <input
            id="building-name"
            type="text"
            className={`bfm-input ${fieldErrors.name ? 'is-invalid' : ''}`}
            placeholder="e.g. Main Building, Science Wing"
            value={buildingForm.name || ''}
            onChange={(e) => {
              clearFieldError('name');
              onChange({ ...buildingForm, name: e.target.value });
            }}
          />
          {fieldErrors.name && <p className="bfm-field-error">{fieldErrors.name}</p>}
        </div>

        <div className="bfm-section-heading">
          <span>Optional limits</span>
          {!isEdit && <span>These can be updated later.</span>}
        </div>

        <div className="bfm-grid-2 bfm-optional-grid">
          <div className="bfm-field">
            <label htmlFor="building-max-rooms" className="bfm-label">
              Maximum rooms
            </label>
            <input
              id="building-max-rooms"
              type="number"
              min="1"
              className={`bfm-input ${fieldErrors.max_rooms ? 'is-invalid' : ''}`}
              placeholder="e.g. 10 (leave empty for unlimited)"
              value={buildingForm.max_rooms ?? ''}
              onChange={(e) => {
                clearFieldError('max_rooms');
                onChange({
                  ...buildingForm,
                  max_rooms: e.target.value !== '' ? Number(e.target.value) : null,
                });
              }}
            />
            {fieldErrors.max_rooms && <p className="bfm-field-error">{fieldErrors.max_rooms}</p>}
            <p className="bfm-helper-text">
              {isEdit && activeRoomCount > 0
                ? `Currently linked rooms: ${activeRoomCount}. Limits total rooms this building can have.`
                : 'Limit the number of rooms in this building.'}
            </p>
          </div>

          <div className="bfm-field">
            <label htmlFor="building-floors" className="bfm-label">
              Number of floors
            </label>
            <input
              id="building-floors"
              type="number"
              min="1"
              max="20"
              step="1"
              className={`bfm-input ${fieldErrors.floors ? 'is-invalid' : ''}`}
              value={buildingForm.floors ?? 1}
              onKeyDown={(e) => {
                if (['e', 'E', '+', '-', '.'].includes(e.key)) e.preventDefault();
              }}
              onPaste={(e) => {
                const pasted = e.clipboardData.getData('text');
                if (!/^\d+$/.test(pasted)) e.preventDefault();
              }}
              onChange={(e) => {
                const value = e.target.value;
                if (value !== '' && !/^\d+$/.test(value)) return;
                clearFieldError('floors');
                onChange({
                  ...buildingForm,
                  floors: value !== '' ? Number(value) : '',
                });
              }}
            />
            {fieldErrors.floors && <p className="bfm-field-error">{fieldErrors.floors}</p>}
            <p className="bfm-helper-text">Rooms can then be placed on these floors.</p>
          </div>
        </div>

        {isEdit && (
          <div className="bfm-field">
            <label htmlFor="building-status" className="bfm-label">Building status</label>
            <select
              id="building-status"
              className="bfm-select"
              value={buildingForm.status || 'open'}
              onChange={(e) => onChange({ ...buildingForm, status: e.target.value })}
            >
              <option value="open">Open (Operational)</option>
              <option value="closed">Closed</option>
              <option value="under_repair">Under Repair</option>
            </select>
            <p className="bfm-helper-text">
              Closed or under-repair buildings cannot receive new rooms or family assignments.
            </p>
            {buildingForm.status !== 'open' && assignedHouseholdCount > 0 && (
              <div className="bfm-status-warning" role="status">
                <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />
                <span>
                  <strong>{assignedHouseholdCount} {assignedHouseholdCount === 1 ? 'family is' : 'families are'} still assigned here.</strong>{' '}
                  Reassign or unassign them before closing or repairing this building. Changing status will not move them automatically.
                </span>
              </div>
            )}
          </div>
        )}

        <div className="bfm-field">
          <label htmlFor="building-notes" className="bfm-label">
            Notes
          </label>
          <textarea
            id="building-notes"
            className={`bfm-textarea ${fieldErrors.notes ? 'is-invalid' : ''}`}
            placeholder="Optional notes or instructions for this building..."
            value={buildingForm.notes || ''}
            onChange={(e) => {
              clearFieldError('notes');
              onChange({ ...buildingForm, notes: e.target.value });
            }}
          />
          {fieldErrors.notes && <p className="bfm-field-error">{fieldErrors.notes}</p>}
        </div>
      </form>
    </ModalShell>
  );
}

export function AddBuildingModal(props) {
  return <BuildingFormModal {...props} mode="add" />;
}

export function EditBuildingModal(props) {
  return <BuildingFormModal {...props} mode="edit" />;
}

export function AssignFamilyModal({ open = false, selectedCenter, selectedRoom, rooms = [], buildings = [], allowRoomSelection = false, availableFamilies = [], loadingAvailableFamilies = false, selectedFamilyIdToAssign = '', assigningFamily = false, errorMessage = '', onClose, onFamilyChange, onRoomChange, onConfirm }) {
  const isSingleVenue = resolveCenterStructureMode(selectedCenter) === 'open_area';
  const [householdSearch, setHouseholdSearch] = useState('');
  const [roomSearch, setRoomSearch] = useState('');
  const [householdPickerOpen, setHouseholdPickerOpen] = useState(false);
  const [roomPickerOpen, setRoomPickerOpen] = useState(false);
  const [householdPopoverStyle, setHouseholdPopoverStyle] = useState(null);
  const [roomPopoverStyle, setRoomPopoverStyle] = useState(null);
  const householdPickerRef = useRef(null);
  const householdControlRef = useRef(null);
  const householdPopoverRef = useRef(null);
  const roomPickerRef = useRef(null);
  const roomControlRef = useRef(null);
  const roomPopoverRef = useRef(null);

  const computePopoverStyle = useCallback((controlEl) => {
    if (!controlEl || typeof window === 'undefined') return null;
    const rect = controlEl.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 16;
    const spaceAbove = rect.top - 16;
    const placeAbove = spaceBelow < 180 && spaceAbove > spaceBelow;
    if (placeAbove) {
      return {
        bottom: Math.max(12, window.innerHeight - rect.top + 6),
        left: rect.left,
        width: rect.width,
        maxHeight: Math.min(220, Math.max(120, spaceAbove)),
      };
    }
    return {
      top: rect.bottom + 6,
      left: rect.left,
      width: rect.width,
      maxHeight: Math.min(220, Math.max(120, spaceBelow)),
    };
  }, []);

  useEffect(() => {
    if (open) return;
    setHouseholdSearch('');
    setRoomSearch('');
    setHouseholdPickerOpen(false);
    setRoomPickerOpen(false);
    setHouseholdPopoverStyle(null);
    setRoomPopoverStyle(null);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || (!householdPickerOpen && !roomPickerOpen)) return undefined;
    const updatePositions = () => {
      if (householdPickerOpen) {
        setHouseholdPopoverStyle(computePopoverStyle(householdControlRef.current));
      }
      if (roomPickerOpen) {
        setRoomPopoverStyle(computePopoverStyle(roomControlRef.current));
      }
    };
    updatePositions();
    window.addEventListener('resize', updatePositions);
    window.addEventListener('scroll', updatePositions, true);
    return () => {
      window.removeEventListener('resize', updatePositions);
      window.removeEventListener('scroll', updatePositions, true);
    };
  }, [open, householdPickerOpen, roomPickerOpen, computePopoverStyle]);

  useEffect(() => {
    if (!open) return undefined;
    const handleOutsideClick = (event) => {
      if (
        !householdPickerRef.current?.contains(event.target) &&
        !householdPopoverRef.current?.contains(event.target)
      ) {
        setHouseholdPickerOpen(false);
      }
      if (
        !roomPickerRef.current?.contains(event.target) &&
        !roomPopoverRef.current?.contains(event.target)
      ) {
        setRoomPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open]);

  const householdOptions = useMemo(() => {
    const query = householdSearch.trim().toLowerCase();
    if (!query) return availableFamilies;
    return availableFamilies.filter((family) => {
      const searchable = [
        family.household_head_name,
        family.head_name,
        family.family_code,
        family.barangay,
      ].filter(Boolean).join(' ').toLowerCase();
      return searchable.includes(query);
    });
  }, [availableFamilies, householdSearch]);

  // Open area assigns directly to the center; room-based centers can choose an available room.
  if (!open || (!selectedRoom && !isSingleVenue && !allowRoomSelection)) return null;

  const selectedFamily = availableFamilies.find((f) => String(f.id) === String(selectedFamilyIdToAssign)) || null;
  const memCount = selectedFamily ? selectedFamily.member_count || selectedFamily.family_members || 1 : 0;
  const selectedFamilyName = selectedFamily
    ? displayEntityName(selectedFamily.household_head_name || selectedFamily.head_name)
    : '';
  const centerStructureMode = resolveCenterStructureMode(selectedCenter);
  const isCenterMappedReady =
    selectedCenter == null
      ? true
      : Boolean(
          isCenterMapped(selectedCenter) ||
          selectedCenter?.has_map ||
          selectedCenter?.is_mapped ||
          (selectedCenter?.latitude != null && selectedCenter?.longitude != null) ||
          (selectedCenter?.lat != null && selectedCenter?.lng != null) ||
          selectedCenter?.capacity != null
        ) && selectedCenter?.has_map !== false && selectedCenter?.is_mapped !== false;
  const isRoomBuildingMapped = (room) => {
    if (!room) return false;
    if (centerStructureMode !== 'buildings_and_rooms') return true;
    const bldg =
      room.building_id != null
        ? buildings.find((item) => String(item.id ?? item.properties?.id) === String(room.building_id))
        : null;
    const bldgStatus = resolveBuildingOperationalStatus(bldg, room);
    if (bldgStatus !== 'open') return false;
    if (room.building_is_mapped != null) return Boolean(room.building_is_mapped);
    if (bldg && (bldg.is_mapped != null || bldg.properties?.is_mapped != null)) {
      return Boolean(bldg.is_mapped ?? bldg.properties?.is_mapped);
    }
    if (buildings.length > 0 && room.building_id == null) return false;
    return true;
  };
  const roomOptions = allowRoomSelection
    ? rooms.filter((room) => {
        if (!room || room.is_active === false) return false;
        if (!isRoomBuildingMapped(room)) return false;
        const usage = roomCapacityUsage(room);
        return usage.availableSlots > 0 && usage.availableSpaces > 0 && (!selectedFamily || memCount <= usage.availableSpaces);
      })
    : [];
  const filteredRoomOptions = roomOptions.filter((room) => {
    const query = roomSearch.trim().toLowerCase();
    const building = room.building_name || room.building?.name || buildings.find((item) => String(item.id) === String(room.building_id))?.name || '';
    const floor = formatFloorLabel(room.floor);
    return !query || [room.room_number, building, floor].filter(Boolean).join(' ').toLowerCase().includes(query);
  });
  const getRoomOptionLabel = (room) => {
    if (!room) return '';
    const building = room.building_name || room.building?.name || buildings.find((item) => String(item.id) === String(room.building_id))?.name;
    const floor = Number(room.building_floors || buildings.find((item) => String(item.id) === String(room.building_id))?.floors || 1) > 1 ? formatFloorLabel(room.floor) : '';
    const usage = roomCapacityUsage(room);
    return [formatRoomLabel(room.room_number), building, floor, `${usage.availableSlots} slots · ${usage.availableSpaces} spaces left`].filter(Boolean).join(' · ');
  };

  const centerCapacity = Number(selectedCenter?.capacity || 0);
  const centerAssigned = Number(selectedCenter?.assigned ?? selectedCenter?.total_assigned ?? selectedCenter?.occupied ?? selectedCenter?.current_occupancy ?? 0);
  const roomUsage = roomCapacityUsage(selectedRoom);
  const roomCapacity = roomUsage.peopleSpaces;
  const roomAssigned = roomUsage.usedSpaces;

  const remaining = isSingleVenue
    ? Math.max(centerCapacity - centerAssigned, 0)
    : selectedRoom
      ? roomUsage.availableSpaces
      : 0;

  const targetCapacity = isSingleVenue ? centerCapacity : selectedRoom ? roomCapacity : 0;
  const isChoosingRoom = allowRoomSelection && !selectedRoom;
  const isTargetUnmapped =
    !isCenterMappedReady || (!isSingleVenue && selectedRoom && !isRoomBuildingMapped(selectedRoom));
  const isTargetFull = isSingleVenue
    ? targetCapacity <= 0 || remaining <= 0
    : Boolean(selectedRoom && (roomUsage.availableSlots <= 0 || remaining <= 0));
  const isOverCapacity = isSingleVenue
    ? Boolean(selectedFamily && memCount > remaining)
    : Boolean(selectedFamily && selectedRoom && (roomUsage.availableSlots < 1 || memCount > remaining));

  const title = isSingleVenue
    ? 'Assign Family to ' + (selectedCenter?.name || 'the center')
    : selectedRoom
      ? 'Assign Family to ' + formatRoomLabel(selectedRoom.room_number)
      : 'Assign Family';
  const subtitle = selectedCenter?.name || '';
  const targetName = isSingleVenue
    ? selectedCenter?.name || 'Evacuation center'
    : selectedRoom
      ? formatRoomLabel(selectedRoom.room_number)
      : 'Choose a room';
  const targetBuildingName = selectedRoom
    ? selectedRoom.building_name || selectedRoom.building?.name || buildings.find((building) => String(building.id) === String(selectedRoom.building_id))?.name
    : null;
  const targetIcon = isSingleVenue ? faBuildingColumns : faDoorOpen;
  const capacityPercent = isSingleVenue
    ? targetCapacity > 0 ? Math.min(100, Math.round(((targetCapacity - remaining) / targetCapacity) * 100)) : 0
    : Math.min(100, Math.round(Math.max(roomUsage.usedSlots / roomUsage.familySlots, roomUsage.usedSpaces / roomUsage.peopleSpaces) * 100));
  const capacityUsedPercent = isSingleVenue
    ? targetCapacity > 0 ? Math.round(((targetCapacity - remaining) / targetCapacity) * 100) : 0
    : capacityPercent;

  return (
    <ModalShell
      open={open}
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      onPrimary={onConfirm}
      loading={assigningFamily}
      primaryLabel={assigningFamily ? 'Assigning...' : 'Confirm Assignment'}
      primaryDisabled={!selectedFamilyIdToAssign || assigningFamily || isOverCapacity || isTargetFull || isTargetUnmapped || (allowRoomSelection && !selectedRoom)}
      dialogClassName="afm-dialog"
    >
      <div className="afm-content">
        <p className="afm-intro">Choose an unassigned family. Capacity is checked against its number of members.</p>
        {errorMessage && (
          <p className="afm-capacity-warning" role="alert">
            <FontAwesomeIcon icon={faTriangleExclamation} />
            <span>{errorMessage}</span>
          </p>
        )}
        {isTargetUnmapped && (
          <p className="afm-capacity-warning" role="status">
            <FontAwesomeIcon icon={faTriangleExclamation} />
            <span>
              {!isCenterMappedReady
                ? 'This evacuation center is not mapped yet. Place it on the map before assigning families.'
                : 'This room belongs to a building that is not mapped or not open for assignments.'}
            </span>
          </p>
        )}

        <div className="afm-picker" ref={householdPickerRef}>
          <label className="afm-label" htmlFor="assign-household-search">Unassigned family</label>
          <div ref={householdControlRef} className={`afm-picker-control ${householdPickerOpen ? 'is-open' : ''}`}>
            <FontAwesomeIcon icon={faSearch} aria-hidden="true" />
            <input
              id="assign-household-search"
              type="text"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={householdPickerOpen}
              aria-controls="assign-household-options"
              autoComplete="off"
              value={householdPickerOpen ? householdSearch : selectedFamilyName}
              placeholder={loadingAvailableFamilies ? 'Loading families…' : availableFamilies.length ? 'Search by name, code, or barangay' : 'No unassigned families available'}
              disabled={loadingAvailableFamilies || availableFamilies.length === 0 || isTargetFull}
              onFocus={() => {
                setRoomPickerOpen(false);
                setHouseholdPickerOpen(true);
              }}
              onClick={() => {
                setRoomPickerOpen(false);
                setHouseholdPickerOpen(true);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setHouseholdPickerOpen(false);
                if (event.key === 'ArrowDown') setHouseholdPickerOpen(true);
              }}
              onChange={(event) => {
                setHouseholdSearch(event.target.value);
                if (selectedFamilyIdToAssign) onFamilyChange('');
                setHouseholdPickerOpen(true);
              }}
            />
            {selectedFamilyIdToAssign && !householdPickerOpen && (
              <button
                type="button"
                className="afm-picker-clear"
                aria-label="Clear selected family"
                onClick={() => {
                  onFamilyChange('');
                  setHouseholdSearch('');
                  setHouseholdPickerOpen(true);
                }}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            )}
          </div>

          {householdPickerOpen && householdPopoverStyle && typeof document !== 'undefined' && createPortal(
            <div
              ref={householdPopoverRef}
              className="afm-picker-list afm-picker-popover"
              style={householdPopoverStyle}
              id="assign-household-options"
              role="listbox"
              aria-label="Unassigned families"
            >
              {loadingAvailableFamilies ? (
                <div className="afm-picker-empty">Loading unassigned families…</div>
              ) : householdOptions.length === 0 ? (
                <div className="afm-picker-empty">No matching families. Try another name or code.</div>
              ) : householdOptions.map((family) => {
                const name = displayEntityName(family.household_head_name || family.head_name);
                const memberCount = family.member_count || family.family_members || 1;
                const isSelected = String(family.id) === String(selectedFamilyIdToAssign);
                return (
                  <button
                    key={family.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`afm-family-option ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => {
                      onFamilyChange(String(family.id));
                      const memberCount = Number(family.member_count || family.family_members || 1);
                      if (allowRoomSelection && selectedRoom) {
                        const usage = roomCapacityUsage(selectedRoom);
                        if (usage.availableSlots < 1 || memberCount > usage.availableSpaces) onRoomChange(null);
                      }
                      setHouseholdSearch('');
                      setHouseholdPickerOpen(false);
                    }}
                  >
                    <span className="afm-household-avatar" aria-hidden="true">
                      {name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'H'}
                    </span>
                    <span className="afm-household-option-copy">
                      <strong>{name}</strong>
                      <span>{family.family_code || 'No family code'} · {family.barangay || 'No barangay'}</span>
                    </span>
                    <span className="afm-household-size">{memberCount} {memberCount === 1 ? 'member' : 'members'}</span>
                  </button>
                );
              })}
            </div>,
            document.body
          )}
        </div>

        {allowRoomSelection && (
          <div className="afm-room-picker afm-picker" ref={roomPickerRef}>
            <label className="afm-label" htmlFor="assign-household-room">Available room</label>
            <div ref={roomControlRef} className={`afm-picker-control ${roomPickerOpen ? 'is-open' : ''}`}>
              <FontAwesomeIcon icon={faSearch} aria-hidden="true" />
              <input
              id="assign-household-room"
                type="text"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={roomPickerOpen}
                aria-controls="assign-room-options"
                autoComplete="off"
                value={roomPickerOpen ? roomSearch : selectedRoom ? getRoomOptionLabel(selectedRoom) : roomSearch}
                placeholder={roomOptions.length ? 'Search rooms by name, building, or floor' : selectedFamily ? 'No room has enough remaining capacity' : 'No available rooms'}
                disabled={roomOptions.length === 0}
                onFocus={() => {
                  setHouseholdPickerOpen(false);
                  setRoomSearch('');
                  setRoomPickerOpen(true);
                }}
                onClick={() => {
                  setHouseholdPickerOpen(false);
                  setRoomPickerOpen(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setRoomPickerOpen(false);
                  if (event.key === 'ArrowDown') setRoomPickerOpen(true);
                }}
                onChange={(event) => {
                  setRoomSearch(event.target.value);
                  if (selectedRoom) onRoomChange(null);
                  setRoomPickerOpen(true);
                }}
              />
              {selectedRoom && !roomPickerOpen && (
                <button
                  type="button"
                  className="afm-picker-clear"
                  aria-label="Clear selected room"
                  onClick={() => {
                    onRoomChange(null);
                    setRoomSearch('');
                    setRoomPickerOpen(true);
                  }}
                >
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              )}
            </div>
            {roomPickerOpen && roomPopoverStyle && typeof document !== 'undefined' && createPortal(
              <div
                ref={roomPopoverRef}
                className="afm-picker-list afm-picker-popover"
                style={roomPopoverStyle}
                id="assign-room-options"
                role="listbox"
                aria-label="Available rooms"
              >
                {filteredRoomOptions.length === 0 ? (
                  <div className="afm-picker-empty">{roomOptions.length ? 'No matching available rooms.' : 'No available rooms.'}</div>
                ) : filteredRoomOptions.map((room) => {
                  const building = room.building_name || room.building?.name || buildings.find((item) => String(item.id) === String(room.building_id))?.name;
                  const floor = Number(room.building_floors || buildings.find((item) => String(item.id) === String(room.building_id))?.floors || 1) > 1 ? formatFloorLabel(room.floor) : '';
                  const usage = roomCapacityUsage(room);
                  const selected = String(room.id) === String(selectedRoom?.id);
                  return (
                    <button
                      key={room.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`afm-room-option ${selected ? 'is-selected' : ''}`}
                      onClick={() => {
                        onRoomChange(room);
                        setRoomSearch('');
                        setRoomPickerOpen(false);
                      }}
                    >
                      <span className="afm-room-option-copy">
                        <strong>{formatRoomLabel(room.room_number)}</strong>
                        <span>{[building, floor].filter(Boolean).join(' · ') || 'Unassigned building'}</span>
                      </span>
                      <span className="afm-room-option-capacity">{usage.availableSlots} slots · {usage.availableSpaces} spaces left</span>
                    </button>
                  );
                })}
              </div>,
              document.body
            )}
            {selectedFamily && roomOptions.length === 0 && (
              <p className="afm-room-hint">No active room has enough space for this family.</p>
            )}
          </div>
        )}

        <div className="afm-target-card">
          <span className="afm-target-icon"><FontAwesomeIcon icon={targetIcon} /></span>
          <span className="afm-target-copy">
            <span>Assigning to</span>
            <strong>{targetName}</strong>
            <small>{isSingleVenue ? 'Evacuation center' : targetBuildingName || (isChoosingRoom ? 'Select an available room below' : 'Room')}</small>
          </span>
        </div>

        {isChoosingRoom ? (
          <p className="afm-room-hint">Choose a family and an available room. Rooms without enough remaining capacity are hidden.</p>
        ) : <div className="afm-capacity-card">
          <div className="afm-capacity-heading">
            <strong>{isSingleVenue ? 'People capacity' : 'Room capacity'}</strong>
            <span>{targetCapacity > 0 ? `${capacityUsedPercent}% used` : 'Full'}</span>
          </div>
          <div className="afm-capacity-track" aria-hidden="true">
            <span style={{ width: `${capacityPercent}%` }} />
          </div>
          <div className="afm-capacity-rows">
        {isSingleVenue || !selectedRoom ? (
          <>
            <div className="afm-capacity-row"><span>Center limit</span><strong>{centerCapacity} people</strong></div>
            <div className="afm-capacity-row"><span>Currently assigned</span><strong>{centerAssigned} people</strong></div>
          </>
        ) : (
          <>
            <div className="afm-capacity-row"><span>Family slots</span><strong>{roomUsage.usedSlots}/{roomUsage.familySlots} used</strong></div>
            <div className="afm-capacity-row"><span>People spaces</span><strong>{roomAssigned}/{roomUsage.peopleSpaces} used</strong></div>
          </>
        )}
            <div className={`afm-capacity-row is-remaining ${isTargetFull || isOverCapacity ? 'is-warning' : ''}`}>
              <span>Available</span><strong>{isSingleVenue ? `${remaining} people` : `${roomUsage.availableSlots} slots · ${remaining} spaces`}</strong>
            </div>
            {selectedFamily && (
              <div className="afm-selected-household-row">
                <span>{selectedFamilyName} · {memCount} {memCount === 1 ? 'member' : 'members'}</span>
                <strong>{isOverCapacity ? 'Over limit' : 'Fits'}</strong>
              </div>
            )}
            {isTargetFull && (
              <p className="afm-capacity-warning">
                <FontAwesomeIcon icon={faTriangleExclamation} />
                {isSingleVenue ? 'This center is full and cannot accept more families.' : 'This room is full and cannot accept more families.'}
              </p>
            )}
            {!isTargetFull && isOverCapacity && selectedFamily && (
              <p className="afm-capacity-warning">
                <FontAwesomeIcon icon={faTriangleExclamation} />
                {!isSingleVenue && roomUsage.availableSlots < 1
                  ? 'This room has no family slots remaining.'
                  : `This family has ${memCount} members, but only ${remaining} people spaces remain.`}
              </p>
            )}
          </div>
        </div>}
      </div>
    </ModalShell>
  );
}

export function MoveFamilyModal({ open = false, movingFamily, selectedRoom, centers = [], targetCenterRooms = [], targetCenterBuildings = [], targetCenterId = '', targetRoomId = '', loadingTargetRooms = false, moving = false, onClose, onTargetCenterChange, onTargetRoomChange, onConfirmMove }) {
  const [selectedBuildingId, setSelectedBuildingId] = useState('');
  const [roomSearch, setRoomSearch] = useState('');

  if (!open || !movingFamily) return null;
  const needed = movingFamily.assigned_members || movingFamily.family_members || movingFamily.member_count || 1;

  const targetFeature = (centers?.features || []).find((feature) => String((feature.properties || feature).id) === String(targetCenterId));
  const targetCenter = targetFeature ? (targetFeature.properties || targetFeature) : null;
  const targetStructure = targetCenter ? resolveCenterStructureMode(targetCenter) : 'buildings_and_rooms';
  const isTargetOpenArea = Boolean(targetCenter && targetStructure === 'open_area');
  const isTargetBuildings = Boolean(targetCenter && targetStructure === 'buildings_and_rooms');

  const buildingList = isTargetBuildings
    ? (Array.isArray(targetCenterBuildings) ? targetCenterBuildings : []).filter((b) => {
        const status = resolveBuildingOperationalStatus(b);
        if (status !== 'open') return false;
        const mapped = b.is_mapped ?? b.properties?.is_mapped;
        return mapped !== false;
      })
    : [];
  const hasBuildings = isTargetBuildings && (buildingList.length > 0 || targetCenterRooms.some((r) => r.building_id != null));

  const mappedTargetRooms = isTargetBuildings
    ? targetCenterRooms.filter((r) => {
        if (r.building_is_mapped === false) return false;
        if (r.building_status && r.building_status !== 'open') return false;
        if ((Array.isArray(targetCenterBuildings) && targetCenterBuildings.length > 0) || r.building_is_mapped != null) {
          if (r.building_id == null) return false;
          if (Array.isArray(targetCenterBuildings) && targetCenterBuildings.length > 0) {
            return buildingList.some((b) => String(b.id ?? b.properties?.id) === String(r.building_id));
          }
        }
        return true;
      })
    : targetCenterRooms;

  const roomsForDropdown = hasBuildings && selectedBuildingId
    ? mappedTargetRooms.filter((r) => String(r.building_id) === String(selectedBuildingId))
    : mappedTargetRooms;

  const dest = !isTargetOpenArea && targetRoomId ? targetCenterRooms.find((r) => String(r.id) === String(targetRoomId)) : null;
  const destUsage = roomCapacityUsage(dest);
  const destRemaining = dest ? destUsage.availableSpaces : null;

  const targetCenterCap = Number(targetCenter?.capacity || 0);
  const targetCenterAssigned = Number(targetCenter?.assigned ?? targetCenter?.total_assigned ?? targetCenter?.occupied ?? 0);
  const targetCenterRemaining = Math.max(targetCenterCap - targetCenterAssigned, 0);

  const isTargetFull = isTargetOpenArea
    ? (targetCenterCap <= 0 || targetCenterRemaining <= 0)
    : Boolean(dest && (destUsage.availableSlots <= 0 || destRemaining <= 0));
  const isOver = isTargetOpenArea
    ? needed > targetCenterRemaining
    : Boolean(dest != null && destRemaining != null && (destUsage.availableSlots < 1 || needed > destRemaining));

  const canSubmit = Boolean(targetCenterId) && !moving && !isOver && !isTargetFull && (isTargetOpenArea || Boolean(targetRoomId));
  const title = isTargetOpenArea ? 'Move Family to Another Center' : 'Move Family to Another Room / Center';
  const subtitle = selectedRoom ? formatRoomLabel(selectedRoom.room_number) : 'Current center';

  return (
    <ModalShell open={open} title={title} subtitle={subtitle} onClose={onClose} onPrimary={onConfirmMove} loading={moving} primaryLabel={moving ? 'Moving...' : 'Confirm Move'} primaryDisabled={!canSubmit}>
      <div className="form-group"><label>Family</label><p className="room-value">{movingFamily.household_head_name || movingFamily.head_name || 'Unnamed'}</p></div>
      <div className="form-group"><label>Members to move</label><p className="room-value">{needed} people</p></div>
      <div className="form-group"><label>Current location</label><p className="room-value">{selectedRoom ? formatRoomLabel(selectedRoom.room_number) : (movingFamily.center_name || 'Assigned directly')}</p></div>
      <div className="form-group">
        <label htmlFor="move-target-center">Target Evacuation Center</label>
        <select
          id="move-target-center"
          className="form-select"
          value={targetCenterId}
          onChange={(e) => {
            setSelectedBuildingId('');
            onTargetCenterChange(e.target.value);
          }}
          disabled={loadingTargetRooms || moving}
        >
          <option value="">Select destination center...</option>
          {(centers?.features || [])
            .filter((feature) => {
              const c = feature.properties || feature;
              if (!c.is_active) return false;
              if (c.has_map === false || c.is_mapped === false) return false;
              if (feature.geometry === null && !c.has_map && !c.is_mapped) return false;
              const mode = resolveCenterStructureMode(c);
              if (mode === 'buildings_and_rooms' && Array.isArray(c.buildings)) {
                return c.buildings.some((b) => b.is_mapped !== false && resolveBuildingOperationalStatus(b) === 'open');
              }
              return true;
            })
            .map((feature) => {
            const c = feature.properties || feature;
            const cCap = Number(c.capacity || 0);
            const cAss = Number(c.assigned ?? c.total_assigned ?? c.occupied ?? 0);
            const cRem = Math.max(cCap - cAss, 0);
            const barangayNames = (c.barangays || []).map((barangay) => barangay.name).join(', ');
            return (
              <option key={c.id} value={c.id} disabled={cRem <= 0}>
                {c.name} ({barangayNames || 'No barangay'}) — {cRem <= 0 ? 'Full' : `${cRem} spaces left`}
              </option>
            );
          })}
        </select>
      </div>

      {hasBuildings && !isTargetOpenArea && (
        <div className="form-group">
          <label htmlFor="move-target-building">Target Building</label>
          <select
            id="move-target-building"
            className="form-select"
            value={selectedBuildingId}
            onChange={(e) => {
              setSelectedBuildingId(e.target.value);
              onTargetRoomChange('');
            }}
            disabled={!targetCenterId || loadingTargetRooms || moving}
          >
            <option value="">All buildings...</option>
            {buildingList.map((b) => (
              <option key={b.id ?? b.properties?.id} value={b.id ?? b.properties?.id}>{b.name || b.properties?.name}</option>
            ))}
          </select>
        </div>
      )}

      {!isTargetOpenArea && (
        <div className="form-group">
          <label htmlFor="move-target-room">Target Room</label>
          <input className="form-input" aria-label="Search target rooms by name or floor" placeholder="Search by room, building, or floor..." value={roomSearch} onChange={(event) => setRoomSearch(event.target.value)} />
          <select id="move-target-room" className="form-select" value={targetRoomId} onChange={(e) => onTargetRoomChange(e.target.value)} disabled={!targetCenterId || loadingTargetRooms || moving}>
            <option value="">Select target room...</option>
            {roomsForDropdown.filter((r) => {
              const query = roomSearch.trim().toLowerCase();
              const building = r.building_name || targetCenterBuildings.find((item) => String(item.id ?? item.properties?.id) === String(r.building_id))?.name || '';
              return !query || [r.room_number, building, formatFloorLabel(r.floor)].filter(Boolean).join(' ').toLowerCase().includes(query);
            }).map((r) => {
              const isCurrent = selectedRoom && String(r.id) === String(selectedRoom.id);
              const usage = roomCapacityUsage(r);
              const rRem = usage.availableSpaces;
              const isRoomFull = usage.availableSlots <= 0 || rRem <= 0;
              return (
                <option key={r.id} value={r.id} disabled={isRoomFull || isCurrent}>
                  {[formatRoomLabel(r.room_number), r.building_name || targetCenterBuildings.find((item) => String(item.id ?? item.properties?.id) === String(r.building_id))?.name, Number(r.building_floors || targetCenterBuildings.find((item) => String(item.id ?? item.properties?.id) === String(r.building_id))?.floors || 1) > 1 ? formatFloorLabel(r.floor) : '', `Slots ${usage.usedSlots}/${usage.familySlots}`, `Spaces ${usage.usedSpaces}/${usage.peopleSpaces}`, isRoomFull ? 'Full' : `${usage.availableSlots} slots · ${rRem} spaces left`].filter(Boolean).join(' · ')}{isCurrent ? ' (Current)' : ''}
                </option>
              );
            })}
          </select>
        </div>
      )}

      {isTargetOpenArea && targetCenter && (
        <div className="capacity-summary">
          <div className="capacity-row"><span className="capacity-label">Target center capacity</span><span className="capacity-value">{targetCenterCap} people</span></div>
          <div className="capacity-row"><span className="capacity-label">Space left</span><span className="capacity-value" style={{ color: isOver || isTargetFull ? 'var(--ew-danger-text)' : 'var(--ew-safe-text)' }}>{targetCenterRemaining} spaces</span></div>
          <div className="capacity-row"><span className="capacity-label">Remaining after transfer</span><span className="capacity-value" style={{ color: isOver || isTargetFull ? 'var(--ew-danger-text)' : 'var(--ew-safe-text)' }}>{targetCenterRemaining - needed} {isOver ? '(exceeds capacity)' : 'spaces'}</span></div>
        </div>
      )}
      {!isTargetOpenArea && dest && (
        <div className="capacity-summary">
          <div className="capacity-row"><span className="capacity-label">Family slots</span><span className="capacity-value">{destUsage.usedSlots}/{destUsage.familySlots} used</span></div>
          <div className="capacity-row"><span className="capacity-label">People spaces</span><span className="capacity-value">{destUsage.usedSpaces}/{destUsage.peopleSpaces} used</span></div>
          <div className="capacity-row"><span className="capacity-label">Space left</span><span className="capacity-value" style={{ color: isOver || isTargetFull ? 'var(--ew-danger-text)' : 'var(--ew-safe-text)' }}>{destUsage.availableSlots} slots · {destRemaining} spaces</span></div>
          <div className="capacity-row"><span className="capacity-label">Remaining after transfer</span><span className="capacity-value" style={{ color: isOver || isTargetFull ? 'var(--ew-danger-text)' : 'var(--ew-safe-text)' }}>{destUsage.availableSlots - 1} slots · {destRemaining - needed} {isOver ? '(exceeds capacity)' : 'spaces'}</span></div>
        </div>
      )}
      {(isOver || isTargetFull) && (isTargetOpenArea ? targetCenter : dest) && (
        <p className="capacity-warning"><FontAwesomeIcon icon={faXmark} /> Cannot move: this family needs {needed} spaces, but only {isTargetOpenArea ? targetCenterRemaining : destRemaining} spaces are available.</p>
      )}
    </ModalShell>
  );
}

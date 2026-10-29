import { useState, useMemo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleNotch, faXmark, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { stripDigits } from './utils';
import { centerNeedsMapping } from './utils';
import { formatRoomLabel } from '../../utils/formatRoomLabel';
import { displayEntityName } from '../../utils/displayEntityName';
import BarangaysServedPicker from '../BarangaysServedPicker/BarangaysServedPicker';
import './ModalShell.css';

export function ModalShell({ open = false, title = '', subtitle, onClose, formId, onPrimary, loading = false, primaryLabel = 'Save', primaryDisabled = false, cancelLabel = 'Cancel', children, footer }) {
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
      <section className="modal-shell-dialog" onClick={(e) => e.stopPropagation()}>
        <header className="modal-shell-header">
          <div className="modal-shell-header__text">
            {title && <h2 id="modal-shell-title" className="modal-shell-title">{title}</h2>}
            {subtitle && <p className="modal-shell-subtitle">{subtitle}</p>}
          </div>
          <button type="button" className="modal-shell-close-btn" onClick={onClose} aria-label="Close"><FontAwesomeIcon icon={faXmark} /></button>
        </header>
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

export function CenterFormModal({ mode = 'add', centerForm, onChange, barangays = [], saving = false, onSubmit, onClose, onBeforeDeselect, allowedCenterTypes = null }) {
  const title = mode === 'add' ? 'Add Evacuation Center' : 'Edit Evacuation Center';
  const subtitle = mode === 'add' ? 'Create a new evacuation center' : 'Edit evacuation center details';
  const [fieldErrors, setFieldErrors] = useState({});

  const isPrivateProperty = centerForm.center_type === 'private_property';
  const isSingleVenue = centerForm.center_type === 'single_venue';
  const isCampus = centerForm.center_type === 'campus' || !centerForm.center_type;

  function clearFieldError(field) { setFieldErrors((prev) => { const next = { ...prev }; delete next[field]; return next; }); }
  function setFieldError(field, message) { setFieldErrors((prev) => ({ ...prev, [field]: message })); }
  function handleSubmit(e) { e.preventDefault(); let valid = true; if (!centerForm.name || !centerForm.name.trim()) { setFieldError('name', 'Evacuation center name is required.'); valid = false; } else { clearFieldError('name'); } if (!centerForm.barangay_ids || centerForm.barangay_ids.length === 0) { setFieldError('barangays', 'Select at least one barangay served by this center.'); valid = false; } else { clearFieldError('barangays'); } if (isPrivateProperty && (!centerForm.max_rooms || Number(centerForm.max_rooms) < 1)) { setFieldError('max_rooms', 'Max rooms is required for Private Property centers (minimum 1).'); valid = false; } else { clearFieldError('max_rooms'); } if (isSingleVenue && (!centerForm.capacity || Number(centerForm.capacity) < 1)) { setFieldError('capacity', 'Capacity is required for Single Venue centers (minimum 1).'); valid = false; } else { clearFieldError('capacity'); } if (!valid) return; onSubmit(e); }

  // Determine which center types are available for selection
  const availableCenterTypes = allowedCenterTypes
    ? CENTER_TYPES.filter(t => allowedCenterTypes[t.value]?.allowed)
    : CENTER_TYPES;

  const currentTypeAllowed = centerForm.center_type && allowedCenterTypes && allowedCenterTypes[centerForm.center_type]?.allowed;

  return (
    <ModalShell open title={title} subtitle={subtitle} onClose={onClose} formId="center-form" loading={saving} primaryLabel={saving ? 'Saving...' : mode === 'add' ? 'Create Center' : 'Save Changes'}>
      <form id="center-form" onSubmit={handleSubmit} noValidate>
        <div className="form-group"><label htmlFor="center-name">Center Name <span>*</span></label><input id="center-name" type="text" className={fieldErrors.name ? 'form-input is-invalid' : 'form-input'} placeholder="e.g. Sogod Central Gymnasium" value={centerForm.name} onChange={(e) => { clearFieldError('name'); onChange({ ...centerForm, name: stripDigits(e.target.value) }); }} />{fieldErrors.name && <p className="field-error">{fieldErrors.name}</p>}</div>

        {/* Center Type Selector */}
        <div className="form-group">
          <label htmlFor="center-type">Center Type <span>*</span></label>
          <select
            id="center-type"
            className={fieldErrors.center_type ? 'form-input is-invalid' : 'form-input'}
            value={centerForm.center_type || 'campus'}
            onChange={(e) => {
              clearFieldError('center_type');
              const newType = e.target.value;
              onChange({ ...centerForm, center_type: newType });

              // Reset type-specific fields when type changes
              if (newType === 'private_property') {
                onChange({ ...centerForm, center_type: newType, capacity: null });
              } else if (newType === 'single_venue') {
                onChange({ ...centerForm, center_type: newType, max_rooms: null });
              } else {
                onChange({ ...centerForm, center_type: newType, max_rooms: null });
              }
            }}
            disabled={mode === 'edit' && allowedCenterTypes && !currentTypeAllowed}
          >
            {availableCenterTypes.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
          {allowedCenterTypes && mode === 'edit' && !currentTypeAllowed && (
            <p className="field-error">
              Current center type cannot be changed. {allowedCenterTypes[centerForm.center_type]?.reason}
            </p>
          )}
          {fieldErrors.center_type && <p className="field-error">{fieldErrors.center_type}</p>}
          <p className="field-hint">
            {CENTER_TYPES.find(t => t.value === centerForm.center_type)?.description || 'Select a center type to see description.'}
          </p>
        </div>

        <div className="form-group"><BarangaysServedPicker barangays={barangays} selectedIds={centerForm.barangay_ids} onChange={(selectedIds) => onChange((prev) => ({ ...prev, barangay_ids: selectedIds }))} onBeforeDeselect={onBeforeDeselect} required disabled={saving} />{fieldErrors.barangays && <p className="field-error">{fieldErrors.barangays}</p>}</div>

        {/* Capacity field - required for single_venue, optional for others */}
        <div className="form-group">
          <label htmlFor="center-capacity">
            Total Capacity <span>(Max evacuees)</span>
            {isSingleVenue && <span className="required-indicator">*</span>}
          </label>
          <input
            id="center-capacity"
            type="number"
            min="0"
            className={fieldErrors.capacity ? 'form-input is-invalid' : 'form-input'}
            placeholder={isSingleVenue ? "e.g. 250 (required for Single Venue)" : "e.g. 250"}
            value={centerForm.capacity}
            onChange={(e) => { clearFieldError('capacity'); onChange({ ...centerForm, capacity: e.target.value || null }); }}
            required={isSingleVenue}
          />
          {isSingleVenue && <p className="field-hint">Required for Single Venue centers. This is the total capacity of the venue.</p>}
          {isPrivateProperty && <p className="field-hint">Optional for Private Property. Total capacity is derived from rooms.</p>}
          {isCampus && <p className="field-hint">Optional for Campus. Total capacity is derived from rooms.</p>}
          {fieldErrors.capacity && <p className="field-error">{fieldErrors.capacity}</p>}
        </div>

        {/* Max Rooms field - required for private_property */}
        {isPrivateProperty && (
          <div className="form-group">
            <label htmlFor="center-max-rooms">Max Rooms <span>*</span></label>
            <input
              id="center-max-rooms"
              type="number"
              min="1"
              className={fieldErrors.max_rooms ? 'form-input is-invalid' : 'form-input'}
              placeholder="e.g. 20"
              value={centerForm.max_rooms}
              onChange={(e) => { clearFieldError('max_rooms'); onChange({ ...centerForm, max_rooms: e.target.value || null }); }}
              required
            />
            <p className="field-hint">Maximum number of rooms this private property can have. Rooms don't need buildings.</p>
            {fieldErrors.max_rooms && <p className="field-error">{fieldErrors.max_rooms}</p>}
          </div>
        )}

        <div className="form-group"><label htmlFor="center-building-material">Building Material</label><input id="center-building-material" type="text" className={fieldErrors.building_material ? 'form-input is-invalid' : 'form-input'} placeholder="e.g. Reinforced Concrete" value={centerForm.building_material} onChange={(e) => { clearFieldError('building_material'); onChange({ ...centerForm, building_material: e.target.value }); }} />{fieldErrors.building_material && <p className="field-error">{fieldErrors.building_material}</p>}</div>
        <div className="form-group"><label htmlFor="center-contact">Contact Number</label><input id="center-contact" type="text" maxLength={20} className={fieldErrors.contact_number ? 'form-input is-invalid' : 'form-input'} placeholder="e.g. 0917-123-4567" value={centerForm.contact_number} onChange={(e) => { clearFieldError('contact_number'); onChange({ ...centerForm, contact_number: e.target.value }); }} />{fieldErrors.contact_number && <p className="field-error">{fieldErrors.contact_number}</p>}</div>
        <div className="form-group"><label htmlFor="center-accessibility">Accessibility Notes</label><textarea id="center-accessibility" className={fieldErrors.accessibility_notes ? 'form-textarea is-invalid' : 'form-textarea'} placeholder="Ramps available, emergency generator installed..." value={centerForm.accessibility_notes} onChange={(e) => { clearFieldError('accessibility_notes'); onChange({ ...centerForm, accessibility_notes: e.target.value }); }} />{fieldErrors.accessibility_notes && <p className="field-error">{fieldErrors.accessibility_notes}</p>}</div>

        {/* Owner name field - useful for private_property */}
        <div className="form-group">
          <label htmlFor="center-owner">Property Owner / Operator</label>
          <input
            id="center-owner"
            type="text"
            className={fieldErrors.owner_name ? 'form-input is-invalid' : 'form-input'}
            placeholder="e.g. LGU Sogod, Private Owner Name"
            value={centerForm.owner_name}
            onChange={(e) => { clearFieldError('owner_name'); onChange({ ...centerForm, owner_name: e.target.value }); }}
          />
          {fieldErrors.owner_name && <p className="field-error">{fieldErrors.owner_name}</p>}
        </div>
      </form>
    </ModalShell>
  );
}

export function CenterRoomModal({ mode = 'add', selectedCenter, selectedRoom, roomForm, onChange, saving = false, onSubmit, onClose, buildings = [], defaultBuildingId = '' }) {
  const title = mode === 'add' ? 'Add Room to ' + (selectedCenter?.name || 'the center') : 'Edit ' + formatRoomLabel(selectedRoom?.room_number);
  const subtitle = mode === 'add' ? 'Add a new room to this evacuation center' : 'Edit room details';
  const [fieldErrors, setFieldErrors] = useState({});
  function clearFieldError(field) { setFieldErrors((prev) => { const next = { ...prev }; delete next[field]; return next; }); }
  function setFieldError(field, message) { setFieldErrors((prev) => ({ ...prev, [field]: message })); }
  function handleSubmit(e) { e.preventDefault(); let valid = true; if (!roomForm.room_number || !roomForm.room_number.trim()) { setFieldError('room_number', 'Room number is required.'); valid = false; } else { clearFieldError('room_number'); } if (!roomForm.capacity || Number(roomForm.capacity) <= 0) { setFieldError('capacity', 'Valid room capacity greater than 0 is required.'); valid = false; } else { clearFieldError('capacity'); } if (!valid) return; onSubmit(e); }
  const centerNotMapped = selectedCenter && centerNeedsMapping(selectedCenter);

  // Normalize buildings to {id, name} options (same logic as backup RoomModal)
  const buildingOptions = useMemo(() => {
    return buildings.map((item) => {
      const props = item?.properties || item || {};
      const id = props.id ?? item?.id;
      const name = props.name || props.display_label || `Building #${id}`;
      return { id, name };
    });
  }, [buildings]);
  return (
    <ModalShell open title={title} subtitle={subtitle} onClose={onClose} formId="room-form" loading={saving} primaryLabel={saving ? 'Saving...' : mode === 'add' ? 'Add Room' : 'Save Changes'}>
      <form id="room-form" onSubmit={handleSubmit} noValidate>
        {centerNotMapped && (<p className="info-note"><span role="img" aria-label="info">\\u2139</span>{' '}This center isn\\u2019t on the map yet. You can still add a room; place the center on the map so staff can route families here.</p>)}
        <div className="form-group"><label htmlFor="room-number">Room Number / Name <span>*</span></label><input id="room-number" type="text" className={fieldErrors.room_number ? 'form-input is-invalid' : 'form-input'} placeholder="e.g. Room 101, Ground Floor" value={roomForm.room_number} onChange={(e) => { clearFieldError('room_number'); onChange({ ...roomForm, room_number: e.target.value }); }} />{fieldErrors.room_number && <p className="field-error">{fieldErrors.room_number}</p>}</div>
        <div className="form-group"><label htmlFor="room-capacity">Room Capacity <span>*</span> <span className="hint">(Max people)</span></label><input id="room-capacity" type="number" min="1" className={fieldErrors.capacity ? 'form-input is-invalid' : 'form-input'} placeholder="e.g. 30" value={roomForm.capacity} onChange={(e) => { clearFieldError('capacity'); onChange({ ...roomForm, capacity: e.target.value }); }} />{mode === 'edit' && selectedRoom?.occupied > 0 && (<p className="field-error">Currently assigned: {selectedRoom.occupied}. Capacity cannot be less than this.</p>)} {fieldErrors.capacity && <p className="field-error">{fieldErrors.capacity}</p>}</div>
        <div className="form-group"><label htmlFor="room-building">Building <span className="hint">(Optional)</span></label><select id="room-building" className={fieldErrors.building_id ? 'form-input is-invalid' : 'form-input'} value={roomForm.building_id} onChange={(e) => { clearFieldError('building_id'); onChange({ ...roomForm, building_id: e.target.value }); }}><option value="">No building / Unassigned</option>{buildingOptions.map((b) => (<option key={b.id} value={String(b.id)}>{b.name}</option>))}</select>{fieldErrors.building_id && <p className="field-error">{fieldErrors.building_id}</p>}</div>
        <div className="form-group"><label htmlFor="room-latitude">Latitude</label><input id="room-latitude" type="number" step="any" className={fieldErrors.latitude ? 'form-input is-invalid' : 'form-input'} placeholder="e.g. 10.3860" value={roomForm.latitude} onChange={(e) => { clearFieldError('latitude'); onChange({ ...roomForm, latitude: e.target.value }); }} />{fieldErrors.latitude && <p className="field-error">{fieldErrors.latitude}</p>}</div>
        <div className="form-group"><label htmlFor="room-longitude">Longitude</label><input id="room-longitude" type="number" step="any" className={fieldErrors.longitude ? 'form-input is-invalid' : 'form-input'} placeholder="e.g. 124.9818" value={roomForm.longitude} onChange={(e) => { clearFieldError('longitude'); onChange({ ...roomForm, longitude: e.target.value }); }} />{fieldErrors.longitude && <p className="field-error">{fieldErrors.longitude}</p>}</div>
      </form>
    </ModalShell>
  );
}

export function AddBuildingModal({ open = false, buildingForm, onChange, saving = false, onSubmit, onClose }) {
  const [fieldErrors, setFieldErrors] = useState({});
  function clearFieldError(field) { setFieldErrors((prev) => { const next = { ...prev }; delete next[field]; return next; }); }
  function setFieldError(field, message) { setFieldErrors((prev) => ({ ...prev, [field]: message })); }
  function handleSubmit(e) { e.preventDefault(); let valid = true; if (!buildingForm.name || !buildingForm.name.trim()) { setFieldError('name', 'Building name is required.'); valid = false; } else { clearFieldError('name'); } if (buildingForm.max_rooms !== null && buildingForm.max_rooms !== '' && Number(buildingForm.max_rooms) < 1) { setFieldError('max_rooms', 'Max rooms must be at least 1.'); valid = false; } else { clearFieldError('max_rooms'); } if (buildingForm.floors !== null && buildingForm.floors !== '' && Number(buildingForm.floors) < 1) { setFieldError('floors', 'Floors must be at least 1.'); valid = false; } else { clearFieldError('floors'); } if (!valid) return; onSubmit(e); }
  return (
    <ModalShell open={open} title="Add Building" subtitle="Add a new building to this evacuation center" onClose={onClose} formId="building-form" loading={saving} primaryLabel={saving ? 'Saving...' : 'Add Building'}>
      <form id="building-form" onSubmit={handleSubmit} noValidate>
        <div className="form-group"><label htmlFor="building-name">Building Name <span>*</span></label><input id="building-name" type="text" className={fieldErrors.name ? 'form-input is-invalid' : 'form-input'} placeholder="e.g. Main Building" value={buildingForm.name} onChange={(e) => { clearFieldError('name'); onChange({ ...buildingForm, name: e.target.value }); }} />{fieldErrors.name && <p className="field-error">{fieldErrors.name}</p>}</div>
        <div className="form-group"><label htmlFor="building-max-rooms">Max Rooms</label><input id="building-max-rooms" type="number" min="1" className={fieldErrors.max_rooms ? 'form-input is-invalid' : 'form-input'} placeholder="e.g. 10 (optional)" value={buildingForm.max_rooms} onChange={(e) => { clearFieldError('max_rooms'); onChange({ ...buildingForm, max_rooms: e.target.value ? Number(e.target.value) : null }); }} />{fieldErrors.max_rooms && <p className="field-error">{fieldErrors.max_rooms}</p>}<p className="field-hint">Maximum number of rooms this building can have (optional)</p></div>
        <div className="form-group"><label htmlFor="building-floors">Floors</label><input id="building-floors" type="number" min="1" className={fieldErrors.floors ? 'form-input is-invalid' : 'form-input'} placeholder="e.g. 3 (optional)" value={buildingForm.floors} onChange={(e) => { clearFieldError('floors'); onChange({ ...buildingForm, floors: e.target.value ? Number(e.target.value) : null }); }} />{fieldErrors.floors && <p className="field-error">{fieldErrors.floors}</p>}<p className="field-hint">Number of floors in this building (optional)</p></div>
        <div className="form-group"><label htmlFor="building-status">Status</label><select id="building-status" className={fieldErrors.status ? 'form-input is-invalid' : 'form-input'} value={buildingForm.status || 'active'} onChange={(e) => { clearFieldError('status'); onChange({ ...buildingForm, status: e.target.value }); }}><option value="active">Active</option><option value="inactive">Inactive</option><option value="under_construction">Under Construction</option><option value="maintenance">Maintenance</option></select>{fieldErrors.status && <p className="field-error">{fieldErrors.status}</p>}<p className="field-hint">Current status of the building</p></div>
        <div className="form-group"><label htmlFor="building-notes">Notes</label><textarea id="building-notes" className={fieldErrors.notes ? 'form-textarea is-invalid' : 'form-textarea'} placeholder="Optional notes about this building..." value={buildingForm.notes} onChange={(e) => { clearFieldError('notes'); onChange({ ...buildingForm, notes: e.target.value }); }} />{fieldErrors.notes && <p className="field-error">{fieldErrors.notes}</p>}</div>
      </form>
    </ModalShell>
  );
}

export function AssignFamilyModal({ open = false, selectedCenter, selectedRoom, availableFamilies = [], loadingAvailableFamilies = false, selectedFamilyIdToAssign = '', assigningFamily = false, onClose, onFamilyChange, onConfirm }) {
  const isSingleVenue = selectedCenter?.center_type === 'single_venue'

  // For single_venue, we don't need a room - just the center
  if (!open || (!selectedRoom && !isSingleVenue)) return null;

  const selectedFamily = availableFamilies.find((f) => String(f.id) === String(selectedFamilyIdToAssign)) || null;
  const memCount = selectedFamily ? selectedFamily.member_count || selectedFamily.family_members || 1 : 0;

  // For single_venue, use center capacity
  const isOverCapacity = selectedFamily && memCount > (isSingleVenue
    ? Math.max((selectedCenter.capacity || 0) - (selectedCenter.occupied || selectedCenter.current_occupancy || 0), 0)
    : (selectedRoom?.available ?? (selectedRoom?.capacity - (selectedRoom?.occupied || 0)))
  );

  const title = isSingleVenue
    ? 'Assign Household to ' + (selectedCenter?.name || 'the venue')
    : 'Assign Household to ' + formatRoomLabel(selectedRoom?.room_number);
  const subtitle = selectedCenter?.name || '';

  // Calculate remaining capacity
  const remaining = isSingleVenue
    ? Math.max((selectedCenter.capacity || 0) - (selectedCenter.occupied || selectedCenter.current_occupancy || 0), 0)
    : (selectedRoom?.available ?? (selectedRoom?.capacity - (selectedRoom?.occupied || 0)));

  return (
    <ModalShell open={open} title={title} subtitle={subtitle} onClose={onClose} onPrimary={onConfirm} loading={assigningFamily} primaryLabel={assigningFamily ? 'Assigning...' : 'Confirm Assignment'} primaryDisabled={!selectedFamilyIdToAssign || assigningFamily}>
      <p className="intro">Select an unassigned registered household. EvacWay verifies capacity before allocating.</p>
      <div className="form-group"><label htmlFor="assign-household">Select Unassigned Household</label><select id="assign-household" className="form-select" value={selectedFamilyIdToAssign} onChange={(e) => onFamilyChange(e.target.value)} disabled={loadingAvailableFamilies}><option value="">{loadingAvailableFamilies ? 'Loading unassigned households...' : availableFamilies.length === 0 ? 'No unassigned households available' : 'Choose household...'}</option>{availableFamilies.map((f) => (<option key={f.id} value={f.id}>{displayEntityName(f.household_head_name || f.head_name)} ({f.family_code}) · {f.member_count || f.family_members || 1} members · {f.barangay || 'No barangay'}</option>))}</select></div>
      {isSingleVenue ? (
        <div className="form-group"><label>Venue</label><p className="room-value">{selectedCenter?.name}</p></div>
      ) : (
        <div className="form-group"><label>Room</label><p className="room-value">{formatRoomLabel(selectedRoom?.room_number)}</p></div>
      )}
      <div className="capacity-summary">
        {isSingleVenue ? (
          <>
            <div className="capacity-row"><span className="capacity-label">Venue capacity</span><span className="capacity-value">{selectedCenter?.capacity || 0} people</span></div>
            <div className="capacity-row"><span className="capacity-label">Currently assigned</span><span className="capacity-value">{selectedCenter?.occupied || selectedCenter?.current_occupancy || 0} people</span></div>
            <div className="capacity-row"><span className="capacity-label">Remaining capacity</span><span className="capacity-value" style={{ color: isOverCapacity ? 'var(--ew-danger-text)' : 'var(--ew-safe-text)' }}>{remaining} spaces left</span></div>
          </>
        ) : (
          <>
            <div className="capacity-row"><span className="capacity-label">Room capacity</span><span className="capacity-value">{selectedRoom?.capacity} people</span></div>
            <div className="capacity-row"><span className="capacity-label">Currently assigned</span><span className="capacity-value">{selectedRoom?.occupied || 0} people</span></div>
            <div className="capacity-row"><span className="capacity-label">Remaining capacity</span><span className="capacity-value" style={{ color: isOverCapacity ? 'var(--ew-danger-text)' : 'var(--ew-safe-text)' }}>{remaining} spaces left</span></div>
          </>
        )}
        {selectedFamily && (<div className="capacity-row"><span className="capacity-label">Household to assign</span><span className="capacity-value">{memCount} members</span></div>)}
        {isOverCapacity && selectedFamily && (<p className="capacity-warning"><FontAwesomeIcon icon={faTriangleExclamation} /> Warning: this household has {memCount} members but only {remaining} space left. Assigning would exceed capacity.</p>)}
      </div>
    </ModalShell>
  );
}

export function MoveFamilyModal({ open = false, movingFamily, selectedRoom, centers = [], targetCenterRooms = [], targetCenterId = '', targetRoomId = '', loadingTargetRooms = false, moving = false, onClose, onTargetCenterChange, onTargetRoomChange, onConfirmMove }) {
  if (!open || !movingFamily) return null;
  const needed = movingFamily.assigned_members || movingFamily.family_members || movingFamily.member_count || 1;
  const dest = targetRoomId ? targetCenterRooms.find((r) => String(r.id) === String(targetRoomId)) : null;
  const destRemaining = dest ? (dest.available ?? (dest.capacity - (dest.occupied || 0))) : null;
  const isOver = dest != null && destRemaining != null && needed > destRemaining;
  const title = 'Move Household to Another Room / Center';
  const subtitle = selectedRoom ? formatRoomLabel(selectedRoom.room_number) : 'Current room';
  return (
    <ModalShell open={open} title={title} subtitle={subtitle} onClose={onClose} onPrimary={onConfirmMove} loading={moving} primaryLabel={moving ? 'Moving...' : 'Confirm Move'} primaryDisabled={!targetRoomId || moving || isOver}>
      <div className="form-group"><label>Household</label><p className="room-value">{movingFamily.household_head_name || movingFamily.head_name || 'Unnamed'}</p></div>
      <div className="form-group"><label>Members to move</label><p className="room-value">{needed} people</p></div>
      <div className="form-group"><label>Current room</label><p className="room-value">{selectedRoom ? formatRoomLabel(selectedRoom.room_number) : 'Assigned'}</p></div>
      <div className="form-group"><label htmlFor="move-target-center">Target Evacuation Center</label><select id="move-target-center" className="form-select" value={targetCenterId} onChange={(e) => onTargetCenterChange(e.target.value)} disabled={loadingTargetRooms || moving}><option value="">Select destination center...</option>{(centers?.features || []).filter((c) => (c.properties || c).is_active).map((feature) => { const c = feature.properties || feature; const barangayNames = (c.barangays || []).map((barangay) => barangay.name).join(', '); return (<option key={c.id} value={c.id}>{c.name} (' + barangayNames + 'No barangay')</option>); }) }</select></div>
      <div className="form-group"><label htmlFor="move-target-room">Target Room</label><select id="move-target-room" className="form-select" value={targetRoomId} onChange={(e) => onTargetRoomChange(e.target.value)} disabled={!targetCenterId || loadingTargetRooms || moving}><option value="">Select target room...</option>{targetCenterRooms.map((r) => { const isCurrent = selectedRoom && String(r.id) === String(selectedRoom.id); return (<option key={r.id} value={r.id}>{formatRoomLabel(r.room_number)} &middot; Capacity: {r.capacity} &middot; Assigned: {r.occupied || 0} &middot; Remaining: {r.available ?? (r.capacity - (r.occupied || 0))}{isCurrent ? ' (Current)' : ''}</option>); }) }</select></div>
      {dest && (<div className="capacity-summary"><div className="capacity-row"><span className="capacity-label">Target room capacity</span><span className="capacity-value">{dest.capacity} people</span></div><div className="capacity-row"><span className="capacity-label">Target available spaces</span><span className="capacity-value" style={{ color: isOver ? 'var(--ew-danger-text)' : 'var(--ew-safe-text)' }}>{destRemaining} spaces</span></div><div className="capacity-row"><span className="capacity-label">Remaining after transfer</span><span className="capacity-value" style={{ color: isOver ? 'var(--ew-danger-text)' : 'var(--ew-safe-text)' }}>{destRemaining - needed} {isOver ? '(exceeds capacity)' : 'spaces'}</span></div></div>)}
      {isOver && dest && (<p className="capacity-warning"><FontAwesomeIcon icon={faXmark} /> Warning: this household needs {needed} spaces but the target room only has {destRemaining} available. The move would exceed capacity.</p>)}
    </ModalShell>
  );
}
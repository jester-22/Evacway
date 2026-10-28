import { useState, useMemo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleNotch, faXmark } from '@fortawesome/free-solid-svg-icons';
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
      <div className="modal-dialog" style={{ maxWidth: 440 }}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button type="button" className="modal-close-btn" onClick={() => { if (onCancel) onCancel(); }}><FontAwesomeIcon icon={faXmark} /></button>
        </div>
        <div className="modal-body"><p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: '#374151' }}>{message}</p></div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={() => { if (onCancel) onCancel(); }}>Cancel</button>
          <button type="button" className={danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={async () => { if (onConfirm) await onConfirm(); }}>{confirmText || 'Confirm'}</button>
        </div>
      </div>
    </div>
  );
}

export function CenterFormModal({ mode = 'add', centerForm, onChange, barangays = [], saving = false, onSubmit, onClose, onBeforeDeselect }) {
  const title = mode === 'add' ? 'Add Evacuation Center' : 'Edit Evacuation Center';
  const subtitle = mode === 'add' ? 'Create a new evacuation center' : 'Edit evacuation center details';
  const [fieldErrors, setFieldErrors] = useState({});
  function clearFieldError(field) { setFieldErrors((prev) => { const next = { ...prev }; delete next[field]; return next; }); }
  function setFieldError(field, message) { setFieldErrors((prev) => ({ ...prev, [field]: message })); }
  function handleSubmit(e) { e.preventDefault(); let valid = true; if (!centerForm.name || !centerForm.name.trim()) { setFieldError('name', 'Evacuation center name is required.'); valid = false; } else { clearFieldError('name'); } if (!centerForm.barangay_ids || centerForm.barangay_ids.length === 0) { setFieldError('barangays', 'Select at least one barangay served by this center.'); valid = false; } else { clearFieldError('barangays'); } if (!valid) return; onSubmit(e); }
  return (
    <ModalShell open title={title} subtitle={subtitle} onClose={onClose} formId="center-form" loading={saving} primaryLabel={saving ? 'Saving...' : mode === 'add' ? 'Create Center' : 'Save Changes'}>
      <form id="center-form" onSubmit={handleSubmit} noValidate>
        <div className="form-group"><label htmlFor="center-name">Center Name <span>*</span></label><input id="center-name" type="text" className={fieldErrors.name ? 'form-input is-invalid' : 'form-input'} placeholder="e.g. Sogod Central Gymnasium" value={centerForm.name} onChange={(e) => { clearFieldError('name'); onChange({ ...centerForm, name: stripDigits(e.target.value) }); }} />{fieldErrors.name && <p className="field-error">{fieldErrors.name}</p>}</div>
        <div className="form-group"><BarangaysServedPicker barangays={barangays} selectedIds={centerForm.barangay_ids} onChange={(selectedIds) => onChange((prev) => ({ ...prev, barangay_ids: selectedIds }))} onBeforeDeselect={onBeforeDeselect} required disabled={saving} />{fieldErrors.barangays && <p className="field-error">{fieldErrors.barangays}</p>}</div>
        <div className="form-group"><label htmlFor="center-capacity">Total Capacity <span>(Max evacuees)</span></label><input id="center-capacity" type="number" min="0" className={fieldErrors.capacity ? 'form-input is-invalid' : 'form-input'} placeholder="e.g. 250" value={centerForm.capacity} onChange={(e) => { clearFieldError('capacity'); onChange({ ...centerForm, capacity: e.target.value }); }} />{fieldErrors.capacity && <p className="field-error">{fieldErrors.capacity}</p>}</div>
        <div className="form-group"><label htmlFor="center-building-material">Building Material</label><input id="center-building-material" type="text" className={fieldErrors.building_material ? 'form-input is-invalid' : 'form-input'} placeholder="e.g. Reinforced Concrete" value={centerForm.building_material} onChange={(e) => { clearFieldError('building_material'); onChange({ ...centerForm, building_material: e.target.value }); }} />{fieldErrors.building_material && <p className="field-error">{fieldErrors.building_material}</p>}</div>
        <div className="form-group"><label htmlFor="center-contact">Contact Number</label><input id="center-contact" type="text" maxLength={20} className={fieldErrors.contact_number ? 'form-input is-invalid' : 'form-input'} placeholder="e.g. 0917-123-4567" value={centerForm.contact_number} onChange={(e) => { clearFieldError('contact_number'); onChange({ ...centerForm, contact_number: e.target.value }); }} />{fieldErrors.contact_number && <p className="field-error">{fieldErrors.contact_number}</p>}</div>
        <div className="form-group"><label htmlFor="center-accessibility">Accessibility Notes</label><textarea id="center-accessibility" className={fieldErrors.accessibility_notes ? 'form-textarea is-invalid' : 'form-textarea'} placeholder="Ramps available, emergency generator installed..." value={centerForm.accessibility_notes} onChange={(e) => { clearFieldError('accessibility_notes'); onChange({ ...centerForm, accessibility_notes: e.target.value }); }} />{fieldErrors.accessibility_notes && <p className="field-error">{fieldErrors.accessibility_notes}</p>}</div>
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
  function handleSubmit(e) { e.preventDefault(); let valid = true; if (!buildingForm.name || !buildingForm.name.trim()) { setFieldError('name', 'Building name is required.'); valid = false; } else { clearFieldError('name'); } if (!valid) return; onSubmit(e); }
  return (
    <ModalShell open={open} title="Add Building" subtitle="Add a new building to this evacuation center" onClose={onClose} formId="building-form" loading={saving} primaryLabel={saving ? 'Saving...' : 'Add Building'}>
      <form id="building-form" onSubmit={handleSubmit} noValidate>
        <div className="form-group"><label htmlFor="building-name">Building Name <span>*</span></label><input id="building-name" type="text" className={fieldErrors.name ? 'form-input is-invalid' : 'form-input'} placeholder="e.g. Main Building" value={buildingForm.name} onChange={(e) => { clearFieldError('name'); onChange({ ...buildingForm, name: e.target.value }); }} />{fieldErrors.name && <p className="field-error">{fieldErrors.name}</p>}</div>
        <div className="form-group"><label htmlFor="building-notes">Notes</label><textarea id="building-notes" className={fieldErrors.notes ? 'form-textarea is-invalid' : 'form-textarea'} placeholder="Optional notes about this building..." value={buildingForm.notes} onChange={(e) => { clearFieldError('notes'); onChange({ ...buildingForm, notes: e.target.value }); }} />{fieldErrors.notes && <p className="field-error">{fieldErrors.notes}</p>}</div>
      </form>
    </ModalShell>
  );
}

export function AssignFamilyModal({ open = false, selectedCenter, selectedRoom, availableFamilies = [], loadingAvailableFamilies = false, selectedFamilyIdToAssign = '', assigningFamily = false, onClose, onFamilyChange, onConfirm }) {
  if (!open || !selectedRoom) return null;
  const selectedFamily = availableFamilies.find((f) => String(f.id) === String(selectedFamilyIdToAssign)) || null;
  const memCount = selectedFamily ? selectedFamily.member_count || selectedFamily.family_members || 1 : 0;
  const remaining = selectedRoom.available ?? (selectedRoom.capacity - (selectedRoom.occupied || 0));
  const isOverCapacity = selectedFamily && memCount > remaining;
  const title = 'Assign Household to ' + formatRoomLabel(selectedRoom.room_number);
  const subtitle = selectedCenter?.name || '';
  return (
    <ModalShell open={open} title={title} subtitle={subtitle} onClose={onClose} onPrimary={onConfirm} loading={assigningFamily} primaryLabel={assigningFamily ? 'Assigning...' : 'Confirm Assignment'} primaryDisabled={!selectedFamilyIdToAssign || assigningFamily}>
      <p className="intro">Select an unassigned registered household. EvacWay verifies capacity before allocating.</p>
      <div className="form-group"><label htmlFor="assign-household">Select Unassigned Household</label><select id="assign-household" className="form-select" value={selectedFamilyIdToAssign} onChange={(e) => onFamilyChange(e.target.value)} disabled={loadingAvailableFamilies}><option value="">{loadingAvailableFamilies ? 'Loading unassigned households...' : availableFamilies.length === 0 ? 'No unassigned households available' : 'Choose household...'}</option>{availableFamilies.map((f) => (<option key={f.id} value={f.id}>{displayEntityName(f.household_head_name || f.head_name)} ({f.family_code}) · {f.member_count || f.family_members || 1} members · {f.barangay || 'No barangay'}</option>))}</select></div>
      <div className="form-group"><label>Room</label><p className="room-value">{formatRoomLabel(selectedRoom.room_number)}</p></div>
      <div className="capacity-summary">
        <div className="capacity-row"><span className="capacity-label">Room capacity</span><span className="capacity-value">{selectedRoom.capacity} people</span></div>
        <div className="capacity-row"><span className="capacity-label">Currently assigned</span><span className="capacity-value">{selectedRoom.occupied || 0} people</span></div>
        <div className="capacity-row"><span className="capacity-label">Remaining capacity</span><span className="capacity-value" style={{ color: isOverCapacity ? 'var(--ew-danger-text)' : 'var(--ew-safe-text)' }}>{remaining} spaces left</span></div>
        {selectedFamily && (<div className="capacity-row"><span className="capacity-label">Household to assign</span><span className="capacity-value">{memCount} members</span></div>)}
        {isOverCapacity && selectedFamily && (<p className="capacity-warning"><FontAwesomeIcon icon={faXmark} /> Warning: this household has {memCount} members but only {remaining} space left. Assigning would exceed room capacity.</p>)}
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
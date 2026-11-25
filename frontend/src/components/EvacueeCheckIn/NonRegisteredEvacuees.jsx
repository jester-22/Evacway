import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faXmark, faSpinner } from '@fortawesome/free-solid-svg-icons';
import { api } from '../../services/api';
import { formatFloorLabel, formatRoomLabel } from '../../utils/formatRoomLabel';
import { formatManilaDateTime } from '../../utils/dateTime';
import { appConfirm } from '../../utils/appDialog';
import {
  getLocalMinDobIso,
  getLocalYesterdayIso,
  sanitizeNameInput,
  sanitizePhoneInput,
  validateContactNumber,
  validatePastBirthdate,
  validatePersonName,
} from '../../utils/formValidation';
import './NonRegisteredEvacuees.css';

const emptyPerson = () => ({ first_name: '', middle_name: '', last_name: '', sex: '', age_years: '',
  birthdate: '', contact_number: '', address: '', is_pwd: false, is_pregnant: false, is_lactating: false,
  is_solo_parent: false, needs_assistance: false, needs_medical: false, notes: '' });
const formatTime = (value) => (value ? formatManilaDateTime(value, {}, '—') : '—');
const ageFromBirthdate = (value) => {
  if (!value) return '';
  const [year, month, day] = value.split('-').map(Number);
  const today = new Date();
  let age = today.getFullYear() - year;
  if (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day)) age -= 1;
  return age >= 0 ? age : '';
};

export function AddNonRegisteredButton({ disabled, onClick, className = '' }) {
  return (
    <button
      type="button"
      className={`ui-btn ui-btn--primary ea-add-nre-btn nre-add-button ${className}`.trim()}
      onClick={onClick}
      disabled={disabled}
      title={disabled ? 'Select an operation first' : 'Record people arriving without an assignment'}
    >
      <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
      <span>Add non-registered</span>
    </button>
  );
}

function PersonFields({ person, index, update, remove, operationId, fields, prefix, compact, legendText }) {
  const [matches, setMatches] = useState([]);
  const [duplicateError, setDuplicateError] = useState('');
  const query = [person.first_name, person.last_name].filter(Boolean).join(' ').trim();
  useEffect(() => {
    if (query.length < 2 || !operationId) return undefined;
    let active = true;
    const timer = setTimeout(() => {
      api.findNonRegisteredDuplicates(query, operationId).then((result) => {
        if (active) { setMatches(result.matches || []); setDuplicateError(''); }
      }).catch(() => { if (active) { setMatches([]); setDuplicateError('Duplicate suggestions unavailable. You can still save.'); } });
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [query, operationId]);
  const field = (name, label, type = 'text', required = false) => {
    const error = fields[`${prefix}${name}`];
    const id = `nre-person-${index}-${name}`;
    const isNameField = name === 'first_name' || name === 'middle_name' || name === 'last_name';
    const isPhoneField = name === 'contact_number';
    return <label className="nre-field" htmlFor={id} key={name}>
      <span>{label}{required ? ' *' : ''}</span>
      <input id={id} type={type} value={person[name] ?? ''} required={required}
        min={type === 'number' ? 0 : type === 'date' ? getLocalMinDobIso() : undefined}
        max={type === 'number' ? 120 : type === 'date' ? getLocalYesterdayIso() : undefined}
        step={type === 'number' ? 1 : undefined} maxLength={isNameField ? 50 : type === 'text' ? 200 : undefined}
        autoComplete="off" aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => {
          const val = isNameField
            ? sanitizeNameInput(event.target.value)
            : isPhoneField
              ? sanitizePhoneInput(event.target.value)
              : event.target.value;
          update(name, val);
        }} />
      {error && <span className="nre-field-error" id={`${id}-error`}>{error}</span>}
    </label>;
  };
  return <fieldset className={`nre-person ${compact ? 'is-compact' : ''}`}>
     <legend>{legendText || (compact ? `Family member ${index + 1}` : index === 0 ? 'Head of group' : 'Person details')}</legend>
    {remove && <button type="button" className="nre-remove" onClick={remove} aria-label={`Remove family member ${index + 1}`}><FontAwesomeIcon icon={faXmark} /></button>}
    <div className="nre-name-grid">
      {field('first_name', 'First name', 'text', true)}
      {field('middle_name', 'Middle name')}
      {field('last_name', 'Last name', 'text', true)}
    </div>
    {query.length >= 2 && (matches.length > 0 || duplicateError) && <div className="nre-duplicates" role="status">
      {duplicateError || 'Possible existing records — review before saving. This does not prevent an arrival.'}
      {matches.map((match) => <div key={`${match.source}-${match.id}`}>
        <span>{match.name} · {match.source === 'resident' ? 'Registered resident' : 'Non-registered arrival'}</span>
        {match.source === 'resident' && <button type="button" onClick={() => {
          for (const key of ['first_name', 'middle_name', 'last_name', 'sex', 'age_years', 'birthdate']) {
            if (match[key] !== null && match[key] !== undefined) update(key, match[key]);
          }
        }}>Use this record</button>}
      </div>)}
    </div>}
    <div className="nre-demographic-grid">
      <label className="nre-field" htmlFor={`nre-sex-${index}`}><span>Sex *</span>
        <select id={`nre-sex-${index}`} required value={person.sex} aria-invalid={Boolean(fields[`${prefix}sex`])}
        onChange={(event) => { update('sex', event.target.value); if (event.target.value !== 'female') { update('is_pregnant', false); update('is_lactating', false); } }}>
          <option value="">Select sex</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option>
        </select>{fields[`${prefix}sex`] && <span className="nre-field-error">{fields[`${prefix}sex`]}</span>}
      </label>
      <>
        <label className="nre-field" htmlFor={`nre-birthdate-${index}`}><span>Birthdate *</span>
          <input id={`nre-birthdate-${index}`} type="date" value={person.birthdate || ''} min={getLocalMinDobIso()} max={getLocalYesterdayIso()}
            required aria-invalid={Boolean(fields[`${prefix}birthdate`])}
            onChange={(event) => { update('birthdate', event.target.value); update('age_years', ageFromBirthdate(event.target.value)); }} />
          {fields[`${prefix}birthdate`] && <span className="nre-field-error">{fields[`${prefix}birthdate`]}</span>}
        </label>
        <label className="nre-field"><span>Age</span><input value={person.birthdate ? ageFromBirthdate(person.birthdate) : person.age_years ? `${person.age_years} (recorded)` : 'Enter birthdate to calculate'} disabled aria-label="Calculated age" /></label>
      </>
    </div>
    <div className="nre-needs">
      {[
        ['is_pwd', 'PWD'], ['is_pregnant', 'Pregnant'], ['is_lactating', 'Lactating'],
        ['is_solo_parent', 'Solo parent'], ['needs_assistance', 'Needs assistance'], ['needs_medical', 'Needs medical attention'],
      ].map(([key, label]) => <label key={key}>
        <input type="checkbox" checked={Boolean(person[key])} disabled={['is_pregnant', 'is_lactating'].includes(key) && person.sex !== 'female'} onChange={(event) => update(key, event.target.checked)} />{label}
        {fields[`${prefix}${key}`] && <span className="nre-field-error">{fields[`${prefix}${key}`]}</span>}
      </label>)}
    </div>
    {compact ? <details className="nre-optional-details"><summary>Optional contact and address details</summary><div className="nre-detail-grid">{field('contact_number', 'Contact number (optional)', 'tel')}{field('address', 'Address / place of origin')}{field('notes', 'Notes (optional)')}</div></details>
      : <div className="nre-detail-grid">{field('contact_number', 'Contact number (optional)', 'tel')}{field('address', 'Address / place of origin')}{field('notes', 'Notes (optional)')}</div>}
  </fieldset>;
}

export function NonRegisteredModal({ mode, centers, operation, centerId, onClose, onSaved }) {
  const [people, setPeople] = useState(() => [{ ...emptyPerson(), ...(mode.person || {}) }]);
  const [shelter, setShelter] = useState(() => String(mode.group?.center_id || (centerId !== 'all' ? centerId : '')));
  const [step, setStep] = useState(1);
  const [rooms, setRooms] = useState([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [roomsError, setRoomsError] = useState('');
  const [roomsRetry, setRoomsRetry] = useState(0);
  const [roomSearch, setRoomSearch] = useState('');
  const [roomId, setRoomId] = useState('');
  const [fields, setFields] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const modal = useRef(null);
  const onCloseRef = useRef(onClose);
  const isCreationFlow = mode.kind === 'create' || mode.kind === 'choose';
  const workflowActive = isCreationFlow;
  const isIndividualArrival = true;
  const stepCount = 2;
  const roomStep = 2;
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!workflowActive || !shelter) {
      setRooms([]);
      setRoomId('');
      return undefined;
    }
    let active = true;
    setRoomsLoading(true);
    setRoomsError('');
    setRoomId('');
    api.getRooms(shelter).then((result) => {
      if (active) setRooms(Array.isArray(result) ? result : result.rooms || []);
    }).catch((requestError) => {
      if (active) setRoomsError(requestError.message || 'Could not load rooms for this shelter.');
    }).finally(() => { if (active) setRoomsLoading(false); });
    return () => { active = false; };
  }, [workflowActive, shelter, roomsRetry]);
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    modal.current?.querySelector('select:not(:disabled), input:not(:disabled), button')?.focus();
    const keydown = (event) => {
      if (event.key === 'Escape' && !lock.current) onCloseRef.current();
      if (event.key === 'Tab') {
        const nodes = [...modal.current.querySelectorAll('input:not(:disabled),select:not(:disabled),button:not(:disabled)')]
          .filter((node) => !node.closest('[hidden]'));
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  const assignableCenters = (centers || []).filter(
    (c) => c.is_mapped !== false && c.has_map !== false && c.has_mapped_building !== false
  );
  const selectedCenterObj = assignableCenters.find((c) => String(c.id) === String(shelter));
  const isCampusShelter =
    selectedCenterObj &&
    (selectedCenterObj.structure_mode || 'buildings_and_rooms') === 'buildings_and_rooms';
  const update = (index, key, value) => setPeople((current) => current.map((person, i) => i === index ? { ...person, [key]: value } : person));
  const fittingRooms = rooms.filter((room) => Number(room.available_spaces ?? 0) >= 1
    && room.is_active !== false
    && (!room.building_status || room.building_status === 'open')
    && room.center_is_mapped !== false
    && (!isCampusShelter || (room.building_id != null && room.building_is_mapped !== false)));
  const visibleRooms = fittingRooms.filter((room) => !roomSearch.trim() || [
    room.room_number, room.building_name, formatFloorLabel(room.floor),
  ].filter(Boolean).join(' ').toLowerCase().includes(roomSearch.trim().toLowerCase()));
  const selectedRoom = fittingRooms.find((room) => String(room.id) === String(roomId));
  const selectedRoomInvalid = roomId !== '' && roomId !== 'none' && !selectedRoom;
  const validatePeopleAtIndices = (indices) => {
    const nextFields = {};
    for (const idx of indices) {
      const p = people[idx] || {};
      const prefix = workflowActive ? `people.${idx}.` : '';
      const fnErr = validatePersonName(p.first_name, { label: 'First name', required: true, min: 2, max: 50 });
      if (fnErr) nextFields[`${prefix}first_name`] = fnErr;
      const mnErr = validatePersonName(p.middle_name, { label: 'Middle name', required: false, min: 2, max: 50 });
      if (mnErr) nextFields[`${prefix}middle_name`] = mnErr;
      const lnErr = validatePersonName(p.last_name, { label: 'Last name', required: true, min: 2, max: 50 });
      if (lnErr) nextFields[`${prefix}last_name`] = lnErr;
      const dobErr = validatePastBirthdate(p.birthdate, { label: 'Birthdate', required: true });
      if (dobErr) nextFields[`${prefix}birthdate`] = dobErr;
      const phoneErr = validateContactNumber(p.contact_number, { required: false, label: 'Contact number' });
      if (phoneErr) nextFields[`${prefix}contact_number`] = phoneErr;
    }
    return nextFields;
  };
  const goToNextStep = () => {
    const panel = modal.current?.querySelector(`[data-arrival-step="${step}"]`);
    const invalid = [...(panel?.querySelectorAll('input, select') || [])].find((field) => !field.checkValidity());
    if (invalid) {
      invalid.reportValidity();
      return;
    }
    const customErrors = validatePeopleAtIndices([0]);
    if (Object.keys(customErrors).length > 0) {
      setFields(customErrors);
      setError('Please correct the highlighted fields.');
      return;
    }
    setFields({});
    setError('');
    setStep((current) => Math.min(stepCount, current + 1));
  };
  const submit = async (event) => {
    event.preventDefault();
    if (workflowActive && step < stepCount) {
      goToNextStep();
      return;
    }
    if (!workflowActive && !event.currentTarget.reportValidity()) return;
    const allCustomErrors = validatePeopleAtIndices([0]);
    if (Object.keys(allCustomErrors).length > 0) {
      setFields(allCustomErrors);
      setError('Please correct the highlighted fields.');
      return;
    }
    if (workflowActive && roomId === '') {
      setError('Choose a room that fits this evacuee, or select “Record without a room.”');
      return;
    }
    if (lock.current) return;
    lock.current = true; setSaving(true); setError(''); setFields({});
    const normalized = people.slice(0, 1).map((person) => Object.fromEntries(Object.keys(emptyPerson()).map((key) => [key, key === 'age_years' ? Number(person[key]) : person[key]])));
    try {
      if (mode.kind === 'edit') await api.updateNonRegisteredPerson(mode.person.id, normalized[0]);
      else await api.createNonRegisteredGroup({ center_id: Number(shelter), operation_id: operation.id,
        room_id: roomId === 'none' ? null : Number(roomId), people: normalized });
      await onSaved();
      onClose();
    } catch (requestError) {
      const fieldErrors = requestError.data?.fields || {};
      setError(requestError.message || 'Could not save arrival.');
      setFields(fieldErrors);
      if (fieldErrors.room_id) {
        setRoomId('');
        setRoomsRetry((attempt) => attempt + 1);
      }
    }
    finally { lock.current = false; setSaving(false); }
  };
  return <div className="nre-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section className={`nre-modal ${isIndividualArrival ? 'nre-individual-modal' : ''}`} ref={modal} role="dialog" aria-modal="true" aria-labelledby="nre-modal-title">
      <header><div><h2 id="nre-modal-title">{mode.kind === 'edit' ? 'Edit arrival details' : 'Add non-registered arrival'}</h2>
        <p>{workflowActive ? `Individual arrival · Step ${step} of ${stepCount}` : (mode.person?.name || mode.group?.head_name)}</p></div>
        <button type="button" onClick={onClose} disabled={saving} aria-label="Close arrival form"><FontAwesomeIcon icon={faXmark} /></button>
      </header>
      {workflowActive && <nav className="nre-wizard-progress" aria-label="Arrival steps">
        <span className={step === 1 ? 'is-current' : 'is-complete'}><b>1</b> Evacuee details</span><i aria-hidden="true" />
        <span className={step === roomStep ? 'is-current' : ''}><b>2</b> Assign room</span>
      </nav>}
      <form onSubmit={submit} noValidate>
        <div className="nre-modal-body" data-arrival-step="1" hidden={workflowActive && step !== 1}>
          <div className="nre-detail-grid">
            <label className="nre-field" htmlFor="nre-shelter"><span>Shelter *</span><select id="nre-shelter" required value={shelter} disabled={!workflowActive} onChange={(event) => setShelter(event.target.value)}>
              <option value="">Select shelter</option>{assignableCenters.map((center) => <option key={center.id} value={center.id}>{center.name}</option>)}
            </select>{fields.center_id && <span className="nre-field-error">{fields.center_id}</span>}</label>
            <label className="nre-field"><span>Operation</span><input value={operation?.event_name || ''} readOnly aria-label="Active operation" />
              {fields.operation_id && <span className="nre-field-error">{fields.operation_id}</span>}</label>
          </div>
          {people.slice(0, 1).map((person, index) => <PersonFields key={index} person={person} index={index} operationId={operation?.id}
            update={(key, value) => update(index, key, value)} compact={false} legendText="Evacuee details" fields={fields} prefix={workflowActive ? `people.${index}.` : ''} />)}
          <p className="nre-privacy">Information is used only for evacuation management (Data Privacy Act, RA 10173).</p>
          {error && <p className="nre-field-error" role="alert">{error}</p>}
        </div>
        {workflowActive && <div className="nre-modal-body nre-room-step" data-arrival-step={roomStep} hidden={step !== roomStep}>
          <div className="nre-step-intro"><span className="nre-step-number">{roomStep}</span><div><h3>Assign a room</h3><p>Rooms are shown when they have at least 1 available people space for this evacuee.</p></div></div>
          <label className="nre-field" htmlFor="nre-room-search"><span>Search rooms</span><input id="nre-room-search" value={roomSearch} onChange={(event) => setRoomSearch(event.target.value)} placeholder="Search by room, building, or floor" /></label>
          {roomsLoading ? <p className="nre-room-state" role="status">Loading available rooms…</p>
              : roomsError ? <div className="nre-room-state" role="alert"><p>{roomsError}</p><button type="button" className="nre-secondary" onClick={() => setRoomsRetry((attempt) => attempt + 1)}>Retry</button></div>
              : visibleRooms.length ? <div className="nre-room-options" role="radiogroup" aria-label="Available rooms">
                {visibleRooms.map((room) => {
                  const location = [room.building_name, Number(room.building_floors || 1) > 1 ? formatFloorLabel(room.floor) : ''].filter(Boolean).join(' · ');
                  const label = formatRoomLabel(room.room_number);
                  return <button key={room.id} type="button" role="radio" aria-checked={String(roomId) === String(room.id)}
                    className={`nre-room-option ${String(roomId) === String(room.id) ? 'is-selected' : ''}`} onClick={() => { setRoomId(String(room.id)); setError(''); setFields((current) => { const next = { ...current }; delete next.room_id; return next; }); }}>
                    <span className="nre-room-option-copy"><strong>{label}</strong><small>{location || 'Shelter room'}</small></span>
                    <span className="nre-room-option-capacity">{room.available_slots} family slot{room.available_slots === 1 ? '' : 's'} · {room.available_spaces} people space{room.available_spaces === 1 ? '' : 's'} left</span>
                  </button>;
                })}
              </div> : <div className="nre-room-empty"><strong>{rooms.length ? 'No room has available people spaces' : 'No rooms are defined for this shelter'}</strong><p>{rooms.length ? 'Every available room needs at least 1 people space left.' : 'You can record the arrival now and leave its room unassigned.'}</p></div>}
          {fittingRooms.length === 0 && <button type="button" className={`nre-room-unassigned ${roomId === 'none' ? 'is-selected' : ''}`} aria-pressed={roomId === 'none'} onClick={() => { setRoomId('none'); setError(''); setFields((current) => { const next = { ...current }; delete next.room_id; return next; }); }}>
            <strong>Record without a room</strong><span>Keep the arrival on the shelter roster without exceeding room capacity. Assign a room later.</span>
          </button>}
          {selectedRoomInvalid && <p className="nre-field-error" role="alert">This room no longer has enough capacity. Choose another room.</p>}
          {selectedRoom && <div className="nre-room-selection"><strong>Assigned to {formatRoomLabel(selectedRoom.room_number)}</strong><span>{[selectedRoom.building_name, Number(selectedRoom.building_floors || 1) > 1 ? formatFloorLabel(selectedRoom.floor) : ''].filter(Boolean).join(' · ') || 'Shelter room'}</span></div>}
          {fields.room_id && <p className="nre-field-error" role="alert">{fields.room_id}</p>}
          {error && <p className="nre-field-error" role="alert">{error}</p>}
        </div>}
        <footer>
          {workflowActive
            ? <>{step === 1
                ? <button type="button" className="nre-secondary" onClick={onClose} disabled={saving}>Cancel</button>
                : <button type="button" className="nre-secondary" onClick={() => { setStep((current) => current - 1); setError(''); }} disabled={saving}>Back</button>}
              {step < stepCount
                ? <button type="button" className="nre-add-button" onClick={goToNextStep} disabled={saving}>Next: assign room</button>
                : <button className="nre-add-button" disabled={saving || roomsLoading || Boolean(roomsError) || roomId === '' || selectedRoomInvalid}>{saving && <FontAwesomeIcon icon={faSpinner} spin />}{saving ? 'Saving arrival…' : 'Save arrival'}</button>}</>
            : <><button type="button" className="nre-secondary" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="nre-add-button" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button></>}
        </footer>
      </form>
    </section>
  </div>;
}

export function NonRegisteredGroups({ result, loading, error, retry, status, setStatus, page, setPage, canEdit, isAdmin, onEdit, onChanged, onAdd, addDisabled }) {
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [details, setDetails] = useState({});
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState('');
  const groups = result?.groups || [];
  const entries = groups.flatMap((group) => {
    const members = Array.isArray(group.members) && group.members.length > 0
      ? group.members
      : [{
          id: group.group_code,
          name: group.head_name,
          arrived_at: group.arrived_at,
          departed_at: group.present_count ? null : group.arrived_at,
        }];
    return members.map((person) => ({ person, group }));
  });
  const activeEntry = selectedEntry
    ? entries.find(
        (item) =>
          String(item.person.id) === String(selectedEntry.personId) &&
          item.group.group_code === selectedEntry.groupCode
      ) || null
    : null;
  const act = async (key, task) => {
    if (busy) return;
    setBusy(key); setActionError('');
    try { await task(); setDetails({}); await onChanged(); }
    catch (requestError) { setActionError(requestError.message || 'The arrival could not be updated.'); }
    finally { setBusy(null); }
  };
  const reveal = async (group, editPerson = null) => {
    if (busy) return;
    setBusy(group.group_code); setActionError('');
    try {
      const response = await api.getNonRegisteredGroup(group.group_code, true);
      setDetails((current) => ({ ...current, [group.group_code]: response.group }));
      if (editPerson) {
        setSelectedEntry(null);
        onEdit(response.group.members.find((person) => person.id === editPerson.id) || editPerson, group);
      }
    } catch (requestError) { setActionError(requestError.message || 'Could not load protected details.'); }
    finally { setBusy(null); }
  };
  const totalIndividuals = Number(result?.summary?.people ?? entries.length ?? result?.total ?? 0);
  return <section className="nre-groups" aria-labelledby="nre-groups-title">
    <div className="nre-section-heading"><h2 id="nre-groups-title">Non-registered arrivals</h2><label>Status <select aria-label="Non-registered status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="all">All</option><option value="present">On-site</option><option value="departed">Departed</option></select></label></div>
    {actionError && <p className="nre-field-error" role="alert">{actionError}</p>}
    {loading ? <p role="status">Loading non-registered arrivals...</p> : error ? <div role="alert"><p>{error.message}</p><button type="button" className="nre-secondary" onClick={retry}>Retry</button></div>
      : entries.length === 0 ? <div className="nre-empty"><h3>No non-registered arrivals</h3><p>Record individuals who arrive without a pre-assignment.</p><AddNonRegisteredButton disabled={addDisabled} onClick={onAdd} /></div>
         : <><div className="nre-table-wrap"><table className="nre-table"><thead><tr><th>Evacuee name</th><th>Details</th><th>Shelter / room</th><th>Arrival</th><th>Status</th><th>Staff action</th></tr></thead>
          <tbody>{entries.map(({ person, group }) => {
            return <GroupRows key={`${group.group_code}-${person.id}`} {...{ person, group, busy, canEdit }}
              openDetails={() => setSelectedEntry({ groupCode: group.group_code, personId: person.id })}
              depart={(targetPerson, departed) => act(`departure-${targetPerson.id}`, () => api.departNonRegistered(targetPerson.id, departed, false))}
              />;
          })}</tbody></table></div>
          <nav className="nre-pagination" aria-label="Non-registered arrivals pagination"><span>{totalIndividuals} {totalIndividuals === 1 ? 'person' : 'people'}</span><button type="button" className="nre-secondary" disabled={page <= 1 || busy} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page}</span><button type="button" className="nre-secondary" disabled={page * 10 >= (result?.total || 0) || busy} onClick={() => setPage(page + 1)}>Next</button></nav></>}
    {activeEntry && <GroupDetailsModal person={activeEntry.person} group={activeEntry.group} details={details[activeEntry.group.group_code]}
      busy={busy} canEdit={canEdit} isAdmin={isAdmin}
      onClose={() => setSelectedEntry(null)} onReveal={() => reveal(activeEntry.group)}
      onEdit={(targetPerson) => reveal(activeEntry.group, targetPerson)}
      onDepart={(targetPerson, departed) => act(`departure-${targetPerson.id}`, () => api.departNonRegistered(targetPerson.id, departed, false))}
      onRemove={async (targetPerson) => {
        const ok = await appConfirm('Delete this non-registered arrival record?', {
          title: 'Delete Arrival Record?',
          confirmText: 'Delete',
          danger: true,
        });
        if (ok) act(`delete-${targetPerson.id}`, () => api.deleteNonRegisteredPerson(targetPerson.id));
      }} />}
  </section>;
}

function GroupRows({ person, group, busy, canEdit, openDetails, depart }) {
  const isPresent = !person.departed_at;
  const sexLabel = person.sex ? person.sex.charAt(0).toUpperCase() + person.sex.slice(1) : null;
  const ageLabel = person.age_years != null ? `${person.age_years} yrs` : null;
  const demographicSummary = [sexLabel, ageLabel].filter(Boolean).join(' · ') || 'Individual';
  return <tr className="nre-group-row" tabIndex={0} onClick={(event) => {
    if (!event.target.closest('button, a, select, input')) openDetails();
  }} onKeyDown={(event) => {
    if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openDetails();
    }
  }}><td><button className="nre-group-toggle" type="button" onClick={openDetails}>{person.name || group.head_name}</button></td>
    <td>{demographicSummary}<br /><small>{isPresent ? 'On-site' : 'Departed'}</small></td><td>{group.center_name}<br /><small>{group.room_name ? `${formatRoomLabel(group.room_name)}${group.building_name ? ` · ${group.building_name}` : ''}${group.floor ? ` · ${formatFloorLabel(group.floor)}` : ''}` : 'No room assigned'}</small></td><td>{formatTime(person.arrived_at || group.arrived_at)}</td>
    <td><span className="nre-pill">Non-registered</span><span className={`nre-pill ${isPresent ? 'is-arrived' : ''}`}>{isPresent ? 'Arrived' : 'Departed'}</span></td>
    <td>{canEdit && <div className="nre-actions"><button type="button" disabled={Boolean(busy)} onClick={() => depart(person, isPresent)}>{isPresent ? 'Depart' : 'Undo departure'}</button></div>}</td></tr>;
}

function GroupDetailsModal({ person, group, details, busy, canEdit, isAdmin, onClose, onReveal, onEdit, onDepart, onRemove }) {
  const revealedMembers = details?.members || group.members || [];
  const activePerson = revealedMembers.find((m) => String(m.id) === String(person?.id)) || person || revealedMembers[0];
  const isPresent = !activePerson?.departed_at;
  const sexLabel = activePerson?.sex ? activePerson.sex.charAt(0).toUpperCase() + activePerson.sex.slice(1) : '—';
  return <div className="nre-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="nre-modal nre-group-modal" role="dialog" aria-modal="true" aria-labelledby="nre-group-modal-title">
      <header><div><h2 id="nre-group-modal-title">{activePerson?.name || group.head_name}</h2><p>{group.center_name} · Non-registered individual · {isPresent ? 'On-site' : 'Departed'}</p></div>
        <button type="button" onClick={onClose} aria-label="Close arrival details"><FontAwesomeIcon icon={faXmark} /></button></header>
      <div className="nre-modal-body">
        <div className="nre-group-summary"><span><strong>Arrival</strong>{formatTime(activePerson?.arrived_at || group.arrived_at)}</span><span><strong>Status</strong>{isPresent ? 'Arrived' : 'Departed'}</span><span><strong>Room</strong>{group.room_name ? `${formatRoomLabel(group.room_name)}${group.building_name ? ` · ${group.building_name}` : ''}${group.floor ? ` · ${formatFloorLabel(group.floor)}` : ''}` : 'No room assigned'}</span></div>
        <div className="nre-group-detail-heading"><h3>Evacuee details</h3><button type="button" className="nre-secondary" disabled={Boolean(busy)} onClick={onReveal}>{busy ? 'Loading…' : details ? 'Contact and medical details shown' : 'View contact numbers and medical needs'}</button></div>
        {!activePerson ? <p className="nre-group-no-members">Details are unavailable.</p> : <div className="nre-member-list"><article key={activePerson.id}>
          <div><strong>{activePerson.name}</strong><p>{sexLabel} · {activePerson.age_years} years · {activePerson.departed_at ? `Departed ${formatTime(activePerson.departed_at)}` : 'On-site'}</p>
            {activePerson.address && <p>{activePerson.address}</p>}{Object.hasOwn(activePerson, 'contact_number') && <p>Contact: {activePerson.contact_number || 'Not provided'} · Needs: {[activePerson.is_pwd && 'PWD', activePerson.is_pregnant && 'Pregnant', activePerson.is_lactating && 'Lactating', activePerson.is_solo_parent && 'Solo parent', activePerson.needs_assistance && 'Needs assistance', activePerson.needs_medical && 'Medical attention'].filter(Boolean).join(', ') || 'None recorded'}{activePerson.notes ? ` · ${activePerson.notes}` : ''}</p>}</div>
          <div className="nre-actions">{canEdit && <><button type="button" disabled={Boolean(busy)} onClick={() => onEdit(activePerson)}>Edit</button><button type="button" disabled={Boolean(busy)} onClick={() => onDepart(activePerson, !activePerson.departed_at)}>{activePerson.departed_at ? 'Undo departure' : 'Departed'}</button></>}{isAdmin && <button type="button" disabled={Boolean(busy)} onClick={() => onRemove(activePerson)}>Delete</button>}</div>
        </article></div>}
      </div>
      <footer><button type="button" className="nre-secondary" onClick={onClose}>Close</button></footer>
    </section>
  </div>;
}

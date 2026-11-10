import { useState, useCallback, useEffect, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faBuilding, faMap, faPen, faPlus, faPhone, faTrash,
  faPersonPregnant, faPersonBooth, faPersonWalking, faCircleExclamation,
  faCheck, faTriangleExclamation, faEdit,
  faChartPie, faPeopleGroup, faClockRotateLeft, faEllipsisVertical,
  faMapPin, faXmark, faLink, faLinkSlash,
  faBuildingColumns, faUserPlus, faRotateLeft, faDoorOpen, faBed, faUsers, faCircleCheck,
  faLocationDot, faCube, faWheelchair, faArrowRight, faListCheck, faMinus, faDrawPolygon, faArrowsRotate,
} from '@fortawesome/free-solid-svg-icons'
import { api } from '../../services/api'

import { useAuth } from '../../context/AuthContext'
import { useCenterDetails } from '../../hooks/useEvacuationQueries'
import {
  centerStatus,
  CENTER_TABS,
  formatBarangays,
  plusN,
  countVulnerable,
  vulnerableBreakdown,
} from './utils'
import { StatusBadge, EmptyState } from './CenterList'
import { FloatingMenuTrigger } from './FloatingMenu'
import MappingBanner from './MappingBanner'
import ReadinessChecklist from './ReadinessChecklist'
import './CenterDetail.css'

function ConfirmDialog({
  open = false,
  title = 'Confirm',
  message = '',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}) {
  useEffect(function () {
    if (!open) return undefined
    function onKeyDown(ev) {
      if (ev.key === 'Escape') onCancel?.()
    }
    document.addEventListener('keydown', onKeyDown)
    return function () { document.removeEventListener('keydown', onKeyDown) }
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      className="ds-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-desc"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel?.()
      }}
    >
      <section className="ds-modal ds-modal--confirm" onClick={(e) => e.stopPropagation()}>
        <header className="ds-modal__header">
          <h2 id="confirm-dialog-title" className="ds-modal__title">
            {title}
          </h2>
          <button
            type="button"
            className="ds-btn ds-btn--icon ds-btn--ghost"
            onClick={onCancel}
            aria-label="Close"
          >
            <FontAwesomeIcon icon={faXmark} size="xs" />
          </button>
        </header>
        <div className="ds-modal__body">
          <p id="confirm-dialog-desc">{message}</p>
        </div>
        <footer className="ds-modal__footer">
          <button
            type="button"
            className="ds-btn ds-btn--ghost"
            disabled={loading}
            onClick={onCancel}
          >
            {cancelText}
          </button>
          <button
            type="button"
            className={`ds-btn ds-btn--${danger ? 'danger' : 'primary'} ${loading ? 'is-loading' : ''}`}
            disabled={loading}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </footer>
      </section>
    </div>
  )
}

export default function CenterDetail({
  center,
  section,
  counts,
  rooms = [],
  buildings = [],
  centerCapacity,
  centerOccupied,
  centerAssigned,
  onBack,
  onSectionChange,
  onAssignHousehold,
  onViewMap,
  onEditCenter,
  onAddRooms,
  onAddBuilding,
  onEditBuilding,
  onDeleteBuilding,
  onAddRoomToBuilding,
  onAddRoom,
  onEditRoom,
  onViewBuildingMap,
  onPlaceBuilding,
  onLinkRoom,
  onUnlinkRoom,
  onDeleteRoom,
  onMove,
  onUnassign,
  onDeactivate,
  canDeactivate,
  onPlaceOnMap,
}) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const centerId = center?.id
  const detailsQuery = useCenterDetails(centerId)
  const centerFamilies = Array.isArray(detailsQuery.data?.assigned_families)
    ? detailsQuery.data.assigned_families
    : []

  const capacity = Number(centerCapacity || 0)
  const assigned = Number(centerAssigned || 0)
  const checkedIn = Number(centerOccupied || 0)
  const spaceLeft = Math.max(0, capacity - assigned)
  const status = centerStatus(center, checkedIn, assigned, capacity)
  const pctAssigned = capacity > 0 ? Math.round((assigned / capacity) * 100) : 0
  const pctCheckedIn = capacity > 0 ? Math.round((checkedIn / capacity) * 100) : 0

  return (
    <div className="ec-detail">
      <CenterHeader
        center={center}
        status={status}
        onBack={onBack}
        onAssignHousehold={onAssignHousehold}
        onViewMap={onViewMap}
        onEditCenter={isAdmin ? onEditCenter : undefined}
        onAddRooms={onAddRooms}
        onAddBuilding={isAdmin ? onAddBuilding : undefined}
        onDeactivate={isAdmin ? () => onDeactivate?.(center) : undefined}
        canDeactivate={canDeactivate}
        onPlaceOnMap={onPlaceOnMap}
      />
      <MappingBanner center={center} onPlaceOnMap={onPlaceOnMap} />
      <KpiStrip
        capacity={capacity}
        assigned={assigned}
        checkedIn={checkedIn}
        spaceLeft={spaceLeft}
        pctAssigned={pctAssigned}
        pctCheckedIn={pctCheckedIn}
      />
      <SectionTabs
        activeKey={section}
        counts={counts}
        onSelect={onSectionChange}
      />
      <div className="ec-detail-content">
        <section
          id="ec-tabpanel-overview"
          role="tabpanel"
          aria-labelledby="ec-tab-overview"
          className={`ec-tab-panel ${section === 'overview' ? 'is-active' : ''}`}
          aria-hidden={section !== 'overview'}
        >
          <OverviewTab
            center={center}
            rooms={rooms}
            buildings={buildings}
            centerFamilies={centerFamilies}
            onEdit={isAdmin ? onEditCenter : undefined}
            onPlaceOnMap={onPlaceOnMap}
            onAddRooms={onAddRooms}
            onAddBuilding={isAdmin ? onAddBuilding : undefined}
          />
        </section>
        <section
          id="ec-tabpanel-structure"
          role="tabpanel"
          aria-labelledby="ec-tab-structure"
          className={`ec-tab-panel ${section === 'structure' ? 'is-active' : ''}`}
          aria-hidden={section !== 'structure'}
        >
          <StructureTab
            center={center}
            rooms={rooms}
            buildings={buildings}
            onAddBuilding={isAdmin ? onAddBuilding : undefined}
            onEditBuilding={isAdmin ? onEditBuilding : undefined}
            onDeleteBuilding={isAdmin ? onDeleteBuilding : undefined}
            onAddRoomToBuilding={isAdmin ? onAddRoomToBuilding : undefined}
            onAddRoom={onAddRoom}
            onAssignHousehold={onAssignHousehold}
            onEditCenter={onEditCenter}
            onEditRoom={onEditRoom}
            onViewBuildingMap={onViewBuildingMap}
            onPlaceBuilding={onPlaceBuilding}
            onLinkRoom={onLinkRoom}
            onUnlinkRoom={isAdmin ? onUnlinkRoom : undefined}
            onDeleteRoom={onDeleteRoom}
          />
        </section>
        <section
          id="ec-tabpanel-households"
          role="tabpanel"
          aria-labelledby="ec-tab-households"
          className={`ec-tab-panel ${section === 'households' ? 'is-active' : ''}`}
          aria-hidden={section !== 'households'}
        >
          <HouseholdsTab
            center={center}
            centerFamilies={centerFamilies}
            rooms={rooms}
            onAssignHousehold={onAssignHousehold}
            onMove={onMove}
            onUnassign={onUnassign}
          />
        </section>
        <section
          id="ec-tabpanel-activity"
          role="tabpanel"
          aria-labelledby="ec-tab-activity"
          className={`ec-tab-panel ${section === 'activity' ? 'is-active' : ''}`}
          aria-hidden={section !== 'activity'}
        >
          <ActivityTab center={center} />
        </section>
      </div>
    </div>
  )
}
export function CenterInfoCard({ center, onEdit }) {
  const centerTypeLabel = {
    campus: 'Campus / Multi-building',
    single_venue: 'Single venue',
    private_property: 'Private property',
  }
  const type = centerTypeLabel[center.center_type || 'campus'] || 'Center'
  const barangays = Array.isArray(center.barangays) ? center.barangays : []
  const address = []
  if (center.address) address.push(center.address)
  if (barangays.length) address.push(barangays.map((b) => (typeof b === 'string' ? b : b.name || b)).join(', '))

  const rows = [
    { label: 'Type of place', value: type, icon: faBuilding },
    { label: 'Building material', value: center.building_material || 'Not specified', icon: faBuilding },
    { label: 'Amenities', value: center.accessibility_notes || 'Not specified', icon: null },
    { label: 'Contact', value: center.contact_number || 'Not provided', icon: faPhone },
    { label: 'Address / barangays served', value: address.length ? address.join(' · ') : 'Not set', icon: faMapPin },
  ]

  return (
    <div className="ds-card ec-info-card">
      <div className="ec-card-header">
        <h3 className="ec-card-title">Center Information</h3>
        <button type="button" className="ec-edit-link" onClick={onEdit}>
          <FontAwesomeIcon icon={faEdit} size="xs" style={{ marginRight: 'var(--space-1)' }} />
          Edit
        </button>
      </div>
      <dl className="ec-def-list">
        {rows.map((row) => (
          <div key={row.label} className="ec-def-row">
            <dt className="ec-def-term">{row.label}</dt>
            <dd className="ec-def-value" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', flexWrap: 'wrap' }}>
              {row.icon && <FontAwesomeIcon icon={row.icon} size="xs" style={{ color: 'var(--muted)' }} />}
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
export function CenterHeader({
  center,
  status,
  onBack,
  onAssignHousehold,
  onViewMap,
  onEditCenter,
  onAddRooms,
  onAddBuilding,
  onDeactivate,
  canDeactivate,
  onPlaceOnMap,
}) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [confirmOpen, setConfirmOpen] = useState(false)

  const name = center.name || 'Unnamed Center'
  const rawBarangays = Array.isArray(center.barangays) ? center.barangays : []
  const allBarangays = rawBarangays
    .map((b) => (typeof b === 'string' ? b : b?.name || ''))
    .filter(Boolean)
  const contact = center.contact_number || null
  const isActive = Boolean(center.is_active)

  const kebabItems = []
  if (onAddRooms) {
    kebabItems.push({ label: 'Add rooms', icon: faPlus, onClick: onAddRooms })
  }
  if (isAdmin && onAddBuilding) {
    kebabItems.push({ label: 'Add building', icon: faBuilding, onClick: onAddBuilding })
  }
  kebabItems.push({ divider: true })
  if (isAdmin && canDeactivate && onDeactivate) {
    kebabItems.push({
      label: isActive ? 'Deactivate' : 'Activate',
      icon: faTrash,
      danger: isActive,
      onClick: () => setConfirmOpen(true),
    })
  }

  const handleDeactivateConfirm = () => {
    setConfirmOpen(false)
    onDeactivate?.()
  }

  const confirmMessage = isActive
    ? `Deactivating “${name}” will hide it from the active centers list. Assigned households keep their records.`
    : `Activating “${name}” will return it to the active centers list.`

  return (
    <>
      <header className="ec-detail-header">
        <nav className="ec-breadcrumb" aria-label="Breadcrumb">
          <button type="button" className="ec-breadcrumb-link" onClick={onBack}>
            <FontAwesomeIcon icon={faBuildingColumns} className="ec-breadcrumb-icon" />
            <span>Evacuation Centers</span>
          </button>
          <span className="ec-breadcrumb-separator">›</span>
          <span className="ec-breadcrumb-current">{name}</span>
        </nav>

        <div className="ec-title-row">
          <div className="ec-title-info">
            <div className="ec-title-line">
              <h1 className="ec-detail-title">{name}</h1>
              <StatusBadge status={status} />
            </div>
            <div className="ec-title-meta">
              <div className="ec-barangay-chips">
                {allBarangays.map((b) => (
                  <span key={b} className="ec-meta-chip">
                    <FontAwesomeIcon icon={faMapPin} className="ec-meta-chip-icon" />
                    <span>{b}</span>
                  </span>
                ))}
              </div>
              {contact && (
                <a href={'tel:' + contact} className="ec-contact-pill" title={'Call ' + contact}>
                  <FontAwesomeIcon icon={faPhone} />
                  <span>{contact}</span>
                </a>
              )}
            </div>
          </div>

          <div className="ec-title-actions">
            <button type="button" className="ec-btn-primary-action" onClick={onAssignHousehold}>
              <FontAwesomeIcon icon={faPlus} />
              <span>Assign Household</span>
            </button>
            <div className="ec-secondary-actions">
              <button type="button" className="ec-btn-secondary-action" onClick={onViewMap}>
                <FontAwesomeIcon icon={faMap} />
                <span>View on map</span>
              </button>
              {isAdmin && (
                <button type="button" className="ec-btn-secondary-action" onClick={onEditCenter}>
                  <FontAwesomeIcon icon={faPen} />
                  <span>Edit center</span>
                </button>
              )}
            </div>
            <FloatingMenuTrigger
              items={kebabItems}
              label="More actions"
              align="right"
            />
          </div>
        </div>
      </header>

      <ConfirmDialog
        open={confirmOpen}
        title={isActive ? 'Deactivate center' : 'Activate center'}
        message={confirmMessage}
        confirmText={isActive ? 'Deactivate' : 'Activate'}
        cancelText="Cancel"
        danger={isActive}
        onConfirm={handleDeactivateConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  )
}
export function KpiStrip({ capacity = 0, assigned = 0, checkedIn = 0, spaceLeft = 0 }) {
  const cap = Number(capacity || 0)
  const asg = Number(assigned || 0)
  const cin = Number(checkedIn || 0)
  const left = Math.max(0, Number(spaceLeft || 0))

  const pctAssigned = cap > 0 ? Math.round((asg / cap) * 100) : 0
  const pctCheckedIn = asg > 0 ? Math.round((cin / asg) * 100) : 0

  return (
    <div className="ec-kpi-strip">
      <KpiCardShared
        label="Capacity"
        value={cap > 0 ? cap : '—'}
        helper="Total people it can shelter"
        icon={faBuildingColumns}
        theme="blue"
      />
      <KpiCardShared
        label="Assigned"
        value={asg}
        helper={cap > 0 ? `${asg} of ${cap} assigned` : 'Total assigned'}
        percent={cap > 0 ? pctAssigned : null}
        icon={faUserPlus}
        theme="indigo"
      />
      <KpiCardShared
        label="Space Left"
        value={left}
        helper="People it can still take"
        icon={faDoorOpen}
        theme="emerald"
      />
      <KpiCardShared
        label="Checked In"
        value={cin}
        helper={asg > 0 ? `${cin} of ${asg} arrived` : 'No one assigned yet'}
        percent={asg > 0 ? pctCheckedIn : null}
        icon={faCircleCheck}
        theme="amber"
      />
    </div>
  )
}

function KpiCardShared({ label, value, helper, percent, icon, theme = 'blue', className = '' }) {
  return (
    <div className={`ec-kpi-card ec-kpi-card--${theme} ${className}`.trim()}>
      <div className="ec-kpi-card-header">
        <span className="ec-kpi-label">{label}</span>
        {icon && (
          <div className={`ec-kpi-icon-bubble ec-kpi-icon-bubble--${theme}`}>
            <FontAwesomeIcon icon={icon} />
          </div>
        )}
      </div>
      <div className="ec-kpi-val-row">
        <span className="ec-kpi-val">{value}</span>
        {percent != null && (
          <span className={`ec-kpi-badge ec-kpi-badge--${theme}`}>{percent}%</span>
        )}
      </div>
      {percent != null && (
        <div className="ec-kpi-progress-track" role="progressbar" aria-valuenow={percent}>
          <div
            className={`ec-kpi-progress-fill ec-kpi-progress-fill--${theme}`}
            style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
          />
        </div>
      )}
      {helper && <span className="ec-kpi-helper">{helper}</span>}
    </div>
  )
}
export function SectionTabs({ activeKey, counts = {}, onSelect, className = '' }) {
  const keys = CENTER_TABS.map((t) => t.key)

  const handleKeyDown = useCallback(
    (e) => {
      const index = keys.indexOf(activeKey)
      if (index < 0) return
      let next
      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault()
          next = keys[(index + 1) % keys.length]
          break
        case 'ArrowLeft':
          e.preventDefault()
          next = keys[(index - 1 + keys.length) % keys.length]
          break
        case 'Home':
          e.preventDefault()
          next = keys[0]
          break
        case 'End':
          e.preventDefault()
          next = keys[keys.length - 1]
          break
        default:
          return
      }
      onSelect(next)
      const el = document.getElementById(`ec-tab-${next}`)
      el?.focus({ preventScroll: true })
    },
    [activeKey, keys, onSelect]
  )

  return (
    <nav
      role="tablist"
      aria-label="Center detail sections"
      className={`ec-modern-tabs ${className}`.trim()}
      onKeyDown={handleKeyDown}
    >
      {CENTER_TABS.map((tab) => {
        const isActive = activeKey === tab.key
        const count = counts[tab.key]
        const tabId = `ec-tab-${tab.key}`
        return (
          <button
            key={tab.key}
            id={tabId}
            role="tab"
            aria-controls={`ec-tabpanel-${tab.key}`}
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            className={`ec-modern-tab ${isActive ? 'is-active' : ''}`}
            onClick={() => onSelect(tab.key)}
          >
            <FontAwesomeIcon icon={ICONS_MAP[tab.key]} className="ec-modern-tab-icon" />
            <span className="ec-modern-tab-label">{tab.label}</span>
            {count != null && (
              <span className={`ec-modern-tab-badge ${isActive ? 'is-active' : ''}`}>
                {count}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}


const ICONS_MAP = {
  overview: faChartPie,
  structure: faBuilding,
  households: faPeopleGroup,
  activity: faClockRotateLeft,
}

const TYPE_LABELS = {
  campus: 'Campus / Multi-building',
  single_venue: 'Single venue',
  private_property: 'Private property',
}

const VULN_LABELS = {
  pregnant: 'Pregnant',
  pwd: 'PWD',
  disability: 'Disability',
  elderly: 'Elderly',
  'needs assistance': 'Needs assistance',
  senior: 'Senior',
}

export function OverviewTab({ center, rooms = [], buildings = [], centerFamilies = [], onEdit, onPlaceOnMap, onAddRooms, onAddBuilding }) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const capacity = Number(center.capacity || 0) || (rooms.reduce((sum, r) => sum + (Number(r.capacity) || 0), 0))

  const barangays = Array.isArray(center.barangays) ? center.barangays : []
  const addressParts = []
  if (center.address) addressParts.push(center.address)
  if (barangays.length) {
    addressParts.push(barangays.map((b) => (typeof b === 'string' ? b : b.name || b)).join(', '))
  }

  const infoRows = [
    { label: 'Type of place', value: TYPE_LABELS[center.center_type || 'campus'] || 'Center', icon: faBuilding },
    { label: 'Building material', value: center.building_material || 'Concrete / Standard', icon: faCube },
    { label: 'Amenities', value: center.accessibility_notes || 'Standard amenities', icon: faWheelchair },
    { label: 'Contact', value: center.contact_number || 'Not provided', icon: faPhone },
    { label: 'Barangays served', value: barangays.length ? barangays.map((b) => (typeof b === 'string' ? b : b.name || b)).join(', ') : 'Not set', icon: faLocationDot },
    { label: 'Address', value: addressParts.length ? addressParts.join(' · ') : 'Not set', icon: faMapPin },
  ]

  const breakdown = Array.isArray(center.barangay_breakdown) ? center.barangay_breakdown : []

  const hasVulnData = Array.isArray(centerFamilies) && centerFamilies.length > 0
  const vulnTotal = hasVulnData ? countVulnerable(centerFamilies) : 0
  const vulnBreakdown = hasVulnData ? vulnerableBreakdown(centerFamilies) : {}

  return (
    <div className="ec-overview ec-two-col">
      <div className="ec-col-left">
        <div className="ec-info-card">
          <div className="ec-info-card-header">
            <div className="ec-info-header-left">
              <div className="ec-info-icon-bubble">
                <FontAwesomeIcon icon={faBuildingColumns} />
              </div>
              <div>
                <h3 className="ec-info-card-title">Center Information</h3>
                <p className="ec-info-card-sub">Core venue details and operational specifications</p>
              </div>
            </div>
            {isAdmin && onEdit && (
              <button type="button" className="ec-info-edit-btn" onClick={onEdit}>
                <FontAwesomeIcon icon={faPen} size="xs" />
                <span>Edit</span>
              </button>
            )}
          </div>

          <div className="ec-info-grid">
            {infoRows.map((row) => (
              <div key={row.label} className="ec-info-tile">
                <div className="ec-info-tile-icon" aria-hidden="true">
                  <FontAwesomeIcon icon={row.icon} />
                </div>
                <div className="ec-info-tile-content">
                  <span className="ec-info-tile-label">{row.label}</span>
                  <span className="ec-info-tile-value">{row.value}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="ec-col-right">
        <ReadinessChecklist
          center={{
            ...center,
            room_count: center.room_count ?? center.total_rooms ?? rooms.length,
            building_count: center.building_count ?? buildings.length,
          }}
          onPlaceOnMap={onPlaceOnMap}
          onAddRooms={onAddRooms}
          onAddBuilding={onAddBuilding}
          onSetEntrance={onEdit}
          onEditContact={onEdit}
          onEditAccessibility={onEdit}
        />
      </div>
    </div>
  )
}
export function StructureTab({
  center,
  rooms = [],
  buildings = [],
  onAddBuilding,
  onEditBuilding,
  onDeleteBuilding,
  onAddRoomToBuilding,
  onAddRoom,
  onEditRoom,
  onViewBuildingMap,
  onPlaceBuilding,
  onLinkRoom,
  onUnlinkRoom,
  onDeleteRoom,
  onAssignHousehold,
  onEditCenter,
}) {
  const isSingleVenue = center?.center_type === 'single_venue'
  const isPrivateProperty = center?.center_type === 'private_property'

  const centerAssigned = Number(center?.assigned ?? center?.total_assigned ?? center?.occupied ?? 0)
  const centerCapacity = Number(center?.capacity || 0)
  const centerAvailable = Math.max(centerCapacity - centerAssigned, 0)

  const groups = useMemo(() => {
    if (isSingleVenue) {
      return [];
    }

    if (isPrivateProperty) {
      return [{ building: null, rooms: rooms }];
    }

    const buildingMap = new Map();
    buildings.forEach((b) => buildingMap.set(String(b.id), { building: b, rooms: [] }));
    buildingMap.set('unassigned', { building: null, rooms: [] });

    rooms.forEach((room) => {
      const bid = room.building_id != null ? String(room.building_id) : 'unassigned';
      const group = buildingMap.get(bid) || buildingMap.get('unassigned');
      group.rooms.push(room);
    });

    return Array.from(buildingMap.entries())
      .filter(([, v]) => v.building || v.rooms.length > 0)
      .sort((a, b) => {
        if (a[0] === 'unassigned') return 1;
        if (b[0] === 'unassigned') return -1;
        const nameA = a[1].building?.name || '';
        const nameB = b[1].building?.name || '';
        return nameA.localeCompare(nameB);
      })
      .map(([, v]) => v);
  }, [isSingleVenue, isPrivateProperty, rooms, buildings]);

  return (
    <div className="ec-structure-card">
      <div className="ec-structure-header">
        <div className="ec-structure-title-wrap">
          <div className="ec-structure-icon-bubble">
            <FontAwesomeIcon icon={faBuildingColumns} />
          </div>
          <div>
            <h3 className="ec-structure-title">Center Structure</h3>
            <p className="ec-structure-sub">
              {isSingleVenue
                ? 'Direct open-venue assignment architecture'
                : isPrivateProperty
                  ? 'Individual rooms allocation'
                  : 'Campus building and room breakdown'}
            </p>
          </div>
        </div>

        <div className="ec-structure-actions">
          {!isSingleVenue && !isPrivateProperty && onAddBuilding && (
            <button type="button" className="ec-btn-secondary" onClick={onAddBuilding}>
              <FontAwesomeIcon icon={faBuilding} size="xs" />
              <span>Add building</span>
            </button>
          )}
          {!isSingleVenue && onAddRoom && (
            <button type="button" className="ec-btn-primary" onClick={onAddRoom}>
              <FontAwesomeIcon icon={faPlus} size="xs" />
              <span>Add room</span>
            </button>
          )}
        </div>
      </div>

      {isSingleVenue ? (
        <div className="ec-single-venue-content">
          <div className="ec-single-venue-hero">
            <div className="ec-single-venue-icon-circle">
              <FontAwesomeIcon icon={faBuildingColumns} />
            </div>
            <div className="ec-single-venue-hero-text">
              <div className="ec-single-venue-badge-row">
                <span className="ec-single-venue-badge">Single Venue Architecture</span>
                <span className="ec-single-venue-subbadge">Direct Center Model</span>
              </div>
              <h4 className="ec-single-venue-name">{center?.name || 'Open Unified Facility'}</h4>
              <p className="ec-single-venue-desc">
                This center is configured as a single open venue (such as a chapel, multipurpose gym, or covered court). No individual rooms or separate buildings are required. Households are assigned and managed directly to the center.
              </p>
            </div>
          </div>

          <div className="ec-single-venue-metrics">
            <div className="ec-svm-card">
              <span className="ec-svm-label">Venue Capacity</span>
              <span className="ec-svm-value">{centerCapacity}</span>
              <span className="ec-svm-desc">Total sheltering threshold</span>
            </div>
            <div className="ec-svm-card">
              <span className="ec-svm-label">Assigned Evacuees</span>
              <span className="ec-svm-value">{centerAssigned}</span>
              <span className="ec-svm-desc">People currently allocated</span>
            </div>
            <div className="ec-svm-card">
              <span className="ec-svm-label">Available Capacity</span>
              <span className="ec-svm-value is-available">{centerAvailable}</span>
              <span className="ec-svm-desc">Spaces ready for placement</span>
            </div>
          </div>

          <div className="ec-single-venue-actions">
            {onAssignHousehold && (
              <button type="button" className="ec-btn-primary" onClick={onAssignHousehold}>
                <FontAwesomeIcon icon={faPlus} size="xs" />
                <span>Assign Household</span>
              </button>
            )}
            {onEditCenter && (
              <button type="button" className="ec-btn-secondary" onClick={onEditCenter}>
                <FontAwesomeIcon icon={faPen} size="xs" />
                <span>Edit Center Details</span>
              </button>
            )}
          </div>
        </div>
      ) : isPrivateProperty ? (
        <div className="ec-structure-groups">
          {groups.map(({ rooms: groupRooms }) => (
            <div key="private-property-rooms" className="ec-structure-group">
              <div className="ec-structure-building">
                <h3>Rooms</h3>
                <p className="ec-building-notes">Private property center — rooms are not organized by building.</p>
              </div>
              {groupRooms.length === 0 ? (
                <div className="ec-empty-state">
                  <p className="ec-empty-note">No rooms yet.</p>
                  {onAddRoom && (
                    <button type="button" className="ds-btn ds-btn--primary" style={{ marginTop: 'var(--space-3)' }} onClick={onAddRoom}>
                      <FontAwesomeIcon icon={faPlus} size="xs" style={{ marginRight: 'var(--space-1)' }} />
                      Add first room
                    </button>
                  )}
                </div>
              ) : (
                <table className="ds-table ec-structure-table ds-table--stack">
                  <thead>
                    <tr>
                      <th scope="col" style={{ width: '34%', textAlign: 'left' }}>Room</th>
                      <th scope="col" style={{ width: '14%', textAlign: 'right' }}>Capacity</th>
                      <th scope="col" style={{ width: '14%', textAlign: 'right' }}>Assigned</th>
                      <th scope="col" style={{ width: '16%', textAlign: 'right' }}>Checked in</th>
                      <th scope="col" style={{ width: '22%', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupRooms.map((room) => (
                      <tr key={room.id} className="ec-room-row">
                        <td data-label="Room">{room.room_number || 'Room #' + (room.id || '')}</td>
                        <td className="ec-num" data-label="Capacity">{room.capacity}</td>
                        <td className="ec-num" data-label="Assigned">{room.assigned}</td>
                        <td className="ec-num" data-label="Checked in">{room.occupied}</td>
                        <td data-label="Actions">
                          <div className="ec-room-actions">
                            {onEditRoom && (
                              <button
                                type="button"
                                className="ds-btn ds-btn--ghost ds-btn--icon"
                                onClick={() => onEditRoom(room)}
                                title="Edit room"
                              >
                                <FontAwesomeIcon icon={faPen} size="xs" />
                              </button>
                            )}

                            {/* No Link to building for private_property */}
                            {onDeleteRoom && (
                              <button
                                type="button"
                                className="ds-btn ds-btn--ghost ds-btn--icon ds-btn--danger"
                                onClick={() => onDeleteRoom(room)}
                                title="Delete room"
                              >
                                <FontAwesomeIcon icon={faTrash} size="xs" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      ) : rooms.length === 0 && buildings.length === 0 ? (
        <EmptyState icon={faBuilding} title="No rooms yet" text="Add a building, then add rooms to it." />
      ) : (
        <div className="ec-structure-groups">
          {groups.map(({ building, rooms: groupRooms }) => {
            const isUnassigned = !building || !building.id;
            const isMapped = !isUnassigned && Boolean(
              building.is_mapped ||
              building.properties?.is_mapped ||
              (building.geometry && building.geometry.coordinates && building.geometry.coordinates.length > 0)
            );

            return (
              <div key={building?.id || 'unassigned'} className="ec-structure-group">
                <div className="ec-structure-building">
                  <div className="ec-structure-building-info">
                    <div className="ec-structure-building-title-row">
                      <FontAwesomeIcon icon={faBuilding} className="ec-building-header-icon" />
                      <h3 className="ec-building-title">{building?.name || 'Unassigned rooms'}</h3>
                      {!isUnassigned && (
                        <span className={`ec-building-map-pill ${isMapped ? 'is-mapped' : 'is-unmapped'}`}>
                          <span className="ec-building-map-dot" />
                          {isMapped ? 'Mapped' : 'Not placed'}
                        </span>
                      )}
                      {!isUnassigned && (
                        <span
                          style={{
                            fontSize: '11px',
                            padding: '2px 8px',
                            borderRadius: '999px',
                            backgroundColor: '#f1f5f9',
                            color: '#475569',
                            fontWeight: 600,
                            border: '1px solid #e2e8f0',
                          }}
                        >
                          {groupRooms.length} {groupRooms.length === 1 ? 'room' : 'rooms'}
                          {building?.max_rooms ? ` / max ${building.max_rooms}` : ''}
                        </span>
                      )}
                      {!isUnassigned && building?.status && (
                        <span
                          style={{
                            fontSize: '11px',
                            padding: '2px 8px',
                            borderRadius: '999px',
                            fontWeight: 600,
                            backgroundColor:
                              building.status === 'open'
                                ? '#dcfce7'
                                : building.status === 'under_repair'
                                ? '#fef3c7'
                                : '#fee2e2',
                            color:
                              building.status === 'open'
                                ? '#166534'
                                : building.status === 'under_repair'
                                ? '#b45309'
                                : '#991b1b',
                          }}
                        >
                          {building.status === 'under_repair'
                            ? 'Under Repair'
                            : building.status.charAt(0).toUpperCase() + building.status.slice(1)}
                        </span>
                      )}
                    </div>
                    {building?.notes && <p className="ec-building-notes">{building.notes}</p>}
                  </div>

                  {!isUnassigned && (
                    <div className="ec-structure-building-actions">
                      {onAddRoomToBuilding && (
                        <button
                          type="button"
                          className="ec-btn-building-action is-view"
                          onClick={() => onAddRoomToBuilding(building)}
                          title={`Add room to ${building.name}`}
                        >
                          <FontAwesomeIcon icon={faPlus} size="xs" />
                          <span>Add room</span>
                        </button>
                      )}
                      {onEditBuilding && (
                        <button
                          type="button"
                          className="ec-btn-building-action is-view"
                          onClick={() => onEditBuilding(building)}
                          title={`Edit ${building.name} (name, max rooms, floors)`}
                        >
                          <FontAwesomeIcon icon={faPen} size="xs" />
                          <span>Edit</span>
                        </button>
                      )}
                      {isMapped ? (
                        <>
                          {onViewBuildingMap && (
                            <button
                              type="button"
                              className="ec-btn-building-action is-view"
                              onClick={() => onViewBuildingMap(building)}
                              title={`View ${building.name} on the map`}
                            >
                              <FontAwesomeIcon icon={faLocationDot} size="xs" />
                              <span>View on map</span>
                            </button>
                          )}
                          {onPlaceBuilding && (
                            <button
                              type="button"
                              className="ec-btn-building-action is-remap"
                              onClick={() => onPlaceBuilding(building, 'remap')}
                              title={`Remap polygon for ${building.name}`}
                            >
                              <FontAwesomeIcon icon={faArrowsRotate} size="xs" />
                              <span>Remap</span>
                            </button>
                          )}
                        </>
                      ) : (
                        onPlaceBuilding && (
                          <button
                            type="button"
                            className="ec-btn-building-action is-place"
                            onClick={() => onPlaceBuilding(building, 'place_building')}
                            title={`Place ${building.name} footprint on map`}
                          >
                            <FontAwesomeIcon icon={faDrawPolygon} size="xs" />
                            <span>Place building</span>
                          </button>
                        )
                      )}
                      {onDeleteBuilding && (
                        <button
                          type="button"
                          className="ec-btn-building-action is-delete"
                          onClick={() => onDeleteBuilding(building)}
                          title={`Delete ${building.name} (rooms remain safe as unassigned)`}
                          style={{ color: '#dc2626' }}
                        >
                          <FontAwesomeIcon icon={faTrash} size="xs" />
                          <span>Delete</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              {groupRooms.length === 0 ? (
                <p className="ec-empty-note">No rooms in this building yet.</p>
              ) : (
                <table className="ds-table ec-structure-table ds-table--stack">
                  <thead>
                    <tr>
                      <th scope="col" style={{ width: '34%', textAlign: 'left' }}>Room</th>
                      <th scope="col" style={{ width: '14%', textAlign: 'right' }}>Capacity</th>
                      <th scope="col" style={{ width: '14%', textAlign: 'right' }}>Assigned</th>
                      <th scope="col" style={{ width: '16%', textAlign: 'right' }}>Checked in</th>
                      <th scope="col" style={{ width: '22%', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupRooms.map((room) => (
                      <tr key={room.id} className="ec-room-row">
                        <td data-label="Room">{room.room_number || 'Room #' + (room.id || '')}</td>
                        <td className="ec-num" data-label="Capacity">{room.capacity}</td>
                        <td className="ec-num" data-label="Assigned">{room.assigned}</td>
                        <td className="ec-num" data-label="Checked in">{room.occupied}</td>
                        <td data-label="Actions">
                          <div className="ec-room-actions">
                            {onEditRoom && (
                              <button
                                type="button"
                                className="ds-btn ds-btn--ghost ds-btn--icon"
                                onClick={() => onEditRoom(room)}
                                title="Edit room"
                              >
                                <FontAwesomeIcon icon={faPen} size="xs" />
                              </button>
                            )}

                            {!isUnassigned && onUnlinkRoom && (
                              <button
                                type="button"
                                className="ds-btn ds-btn--ghost ds-btn--icon"
                                onClick={() => onUnlinkRoom(room, building)}
                                title={`Remove room ${room.room_number || ''} from ${building.name} (unlink)`}
                                style={{ color: '#d97706' }}
                              >
                                <FontAwesomeIcon icon={faLinkSlash} size="xs" />
                              </button>
                            )}

                            {isUnassigned && onLinkRoom && (
                              <button
                                type="button"
                                className="ds-btn ds-btn--ghost ds-btn--icon"
                                onClick={() => onLinkRoom(room)}
                                title="Link room to building"
                              >
                                <FontAwesomeIcon icon={faLink} size="xs" />
                              </button>
                            )}
                            {onDeleteRoom && (
                              <button
                                type="button"
                                className="ds-btn ds-btn--ghost ds-btn--icon ds-btn--danger"
                                onClick={() => onDeleteRoom(room)}
                                title="Delete room"
                              >
                                <FontAwesomeIcon icon={faTrash} size="xs" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )
        })}
      </div>
    )}
  </div>
  );
}

export function HouseholdsTab({ center, centerFamilies = [], rooms = [], onAssignHousehold, onMove, loading = false }) {
  const queryClient = useQueryClient()
  const [loadingFamId, setLoadingFamId] = useState(null)
  const totalMembers = centerFamilies.reduce((sum, f) => sum + Number(f.member_count || f.family_members || 1), 0)
  const checkedInCount = centerFamilies.filter((f) => f.is_checked_in).length

  const handleCheckInToggle = async (fam) => {
    const centerId = center?.id ?? center?.properties?.id
    const familyId = fam.id ?? fam.family_id
    if (!centerId || !familyId) return

    const action = fam.is_checked_in ? 'check_out' : 'check_in'
    setLoadingFamId(familyId)
    try {
      await api.updateEvacueeCheckIn(centerId, { family_id: familyId, action, method: 'manual' })
      await queryClient.invalidateQueries({ queryKey: ['evacuation-center-details'] })
      await queryClient.invalidateQueries({ queryKey: ['evacuation-centers'] })
      await queryClient.invalidateQueries({ queryKey: ['evacuee-check-in-list'] })
    } catch (err) {
      alert(err.message || 'Failed to update check-in status.')
    } finally {
      setLoadingFamId(null)
    }
  }

  return (
    <div className="ec-households-card">
      <div className="ec-households-card-header">
        <div className="ec-households-header-left">
          <div className="ec-households-title-wrap">
            <h2 className="ec-households-card-title">Households</h2>
            <span className="ec-badge-count">{centerFamilies.length}</span>
          </div>
          <p className="ec-households-card-sub">
            {totalMembers} total individuals across {centerFamilies.length} {centerFamilies.length === 1 ? 'household' : 'households'} · {checkedInCount} checked in
          </p>
        </div>
      </div>

      {centerFamilies.length === 0 ? (
        <EmptyState icon={faPeopleGroup} title="No households assigned" text="Households assigned to this evacuation center will appear here." />
      ) : (
        <div className="ec-table-container">
          <table className="ec-modern-table">
            <thead>
              <tr>
                <th scope="col" style={{ width: '32%' }}>HOUSEHOLD</th>
                <th scope="col" style={{ width: '18%' }}>ROOM</th>
                <th scope="col" style={{ width: '14%' }}>MEMBERS</th>
                <th scope="col" style={{ width: '18%' }}>STATUS</th>
                <th scope="col" style={{ width: '18%', textAlign: 'right' }}>STAFF ACTION</th>
              </tr>
            </thead>
            <tbody>
              {centerFamilies.map((fam, idx) => {
                const famKey = fam.id ?? fam.family_id ?? fam.family_code ?? fam.resident_id ?? `fam-${idx}`
                const headName = fam.household_head_name || fam.head_name || 'Unnamed'
                const initials = headName
                  .split(' ')
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((n) => n[0].toUpperCase())
                  .join('') || 'HH'
                const memberCount = fam.member_count || fam.family_members || 1
                const isCheckedIn = Boolean(fam.is_checked_in)
                const room = fam.room_number
                const isRowLoading = loadingFamId === (fam.id ?? fam.family_id)

                return (
                  <tr key={famKey} className="ec-table-row">
                    <td>
                      <div className="ec-household-user-cell">
                        <div className="ec-avatar-circle" aria-hidden="true">
                          {initials}
                        </div>
                        <div className="ec-household-text">
                          <span className="ec-household-name">{headName}</span>
                          <span className="ec-household-role">Household Head</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      {room && room !== 'Not assigned' ? (
                        <span className="ec-room-pill is-assigned">
                          <FontAwesomeIcon icon={faDoorOpen} />
                          <span>{room}</span>
                        </span>
                      ) : (
                        <span className="ec-room-pill is-unassigned">
                          <span>Not assigned</span>
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="ec-members-chip">
                        <FontAwesomeIcon icon={faUsers} />
                        <span>{memberCount}</span>
                      </span>
                    </td>
                    <td>
                      {isCheckedIn ? (
                        <span className="ec-status-chip is-checked-in">
                          <span className="ec-dot green" />
                          <span>Checked in</span>
                        </span>
                      ) : (
                        <span className="ec-status-chip is-not-arrived">
                          <span className="ec-dot amber" />
                          <span>Not arrived</span>
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {isCheckedIn ? (
                        <button
                          type="button"
                          className="ds-btn ds-btn--outline"
                          style={{ height: '32px', fontSize: '12px', padding: '0 10px', gap: '5px' }}
                          onClick={() => handleCheckInToggle(fam)}
                          disabled={isRowLoading}
                          title="Undo check-in"
                        >
                          <FontAwesomeIcon icon={faRotateLeft} />
                          <span>Undo</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="ds-btn ds-btn--primary"
                          style={{ height: '32px', fontSize: '12px', padding: '0 12px', background: '#16a34a', borderColor: '#16a34a', gap: '5px' }}
                          onClick={() => handleCheckInToggle(fam)}
                          disabled={isRowLoading}
                          title="Mark arrived and checked in"
                        >
                          <FontAwesomeIcon icon={faCheck} />
                          <span>Check In</span>
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
export function ActivityTab({ center }) {
  const [typeFilter, setTypeFilter] = useState('all')
  const [centerLogs, setCenterLogs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    async function fetchLogs() {
      try {
        setLoading(true)
        const allLogs = await api.getLogs()
        if (!mounted) return
        if (Array.isArray(allLogs)) {
          const cName = (center?.name || '').toLowerCase()
          const matched = allLogs.filter((l) => {
            if (!l.action) return false
            const act = l.action.toLowerCase()
            return act.includes(cName) || act.includes('evacuation center') || act.includes('assigned family') || act.includes('unassigned')
          })
          setCenterLogs(matched.length > 0 ? matched : allLogs.slice(0, 15))
        }
      } catch (err) {
        console.error('Failed to load center activity logs:', err)
      } finally {
        if (mounted) setLoading(false)
      }
    }
    fetchLogs()
    return () => {
      mounted = false
    }
  }, [center?.id, center?.name])

  const filteredLogs = useMemo(() => {
    if (typeFilter === 'all') return centerLogs
    if (typeFilter === 'assignments') {
      return centerLogs.filter((l) => (l.action || '').toLowerCase().includes('assign'))
    }
    if (typeFilter === 'updates') {
      return centerLogs.filter((l) => !(l.action || '').toLowerCase().includes('assign'))
    }
    return centerLogs
  }, [centerLogs, typeFilter])

  return (
    <div className="ec-activity-card">
      <div className="ec-activity-card-header">
        <div className="ec-activity-header-left">
          <div className="ec-activity-icon-bubble">
            <FontAwesomeIcon icon={faClockRotateLeft} />
          </div>
          <div>
            <h3 className="ec-activity-card-title">Activity & Audit Log</h3>
            <p className="ec-activity-card-sub">Chronological history of allocations, updates, and events</p>
          </div>
        </div>

        <div className="ec-activity-chips">
          <button
            type="button"
            className={`ec-activity-chip ${typeFilter === 'all' ? 'is-active' : ''}`}
            onClick={() => setTypeFilter('all')}
          >
            All <span className="ec-activity-chip-count">{centerLogs.length}</span>
          </button>
          <button
            type="button"
            className={`ec-activity-chip ${typeFilter === 'assignments' ? 'is-active' : ''}`}
            onClick={() => setTypeFilter('assignments')}
          >
            Assignments
          </button>
          <button
            type="button"
            className={`ec-activity-chip ${typeFilter === 'updates' ? 'is-active' : ''}`}
            onClick={() => setTypeFilter('updates')}
          >
            Updates
          </button>
        </div>
      </div>

      <div className="ec-activity-content">
        {loading ? (
          <div className="ec-activity-loading">
            <div className="ec-activity-spinner" />
            <p>Loading activity history...</p>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="ec-activity-empty">
            <div className="ec-activity-empty-bubble">
              <FontAwesomeIcon icon={faClockRotateLeft} />
            </div>
            <h4 className="ec-activity-empty-title">No Activity Recorded Yet</h4>
            <p className="ec-activity-empty-text">
              Household allocations, transfers, evacuee check-ins, and detail updates for <strong>{center?.name || 'this center'}</strong> will automatically appear here.
            </p>
          </div>
        ) : (
          <div className="ec-activity-timeline" role="list">
            {filteredLogs.map((log) => {
              const sentence = String(log.action || '')
              const when = log.timestamp
                ? new Date(log.timestamp).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : 'Recent'

              const isAssign = sentence.toLowerCase().includes('assign')
              const isDanger = sentence.toLowerCase().includes('delete') || sentence.toLowerCase().includes('remov')

              return (
                <div key={log.id} className="ec-activity-item" role="listitem">
                  <div className={`ec-activity-bullet ${isAssign ? 'is-assign' : isDanger ? 'is-danger' : 'is-info'}`} aria-hidden="true">
                    <FontAwesomeIcon icon={isAssign ? faUsers : faClockRotateLeft} />
                  </div>
                  <div className="ec-activity-item-card">
                    <p className="ec-activity-sentence">{sentence}</p>
                    <div className="ec-activity-meta">
                      <span className="ec-activity-badge">System Log</span>
                      <span className="ec-activity-time">{when}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
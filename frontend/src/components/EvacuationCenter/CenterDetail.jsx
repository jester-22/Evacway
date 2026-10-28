import { useState, useCallback, useEffect, useMemo } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faBuilding, faMap, faPen, faPlus, faPhone, faTrash,
  faPersonPregnant, faPersonBooth, faPersonWalking, faCircleExclamation,
  faCheck, faTriangleExclamation, faEdit,
  faChartPie, faPeopleGroup, faClockRotateLeft, faEllipsisVertical,
  faMapPin, faXmark, faLink,
} from '@fortawesome/free-solid-svg-icons'

import { useAuth } from '../../context/AuthContext'
import { useCenterDetails } from '../../hooks/useEvacuationQueries'
import {
  centerStatus,
  centerNeedsMapping,
  useEscapeKey,
  CENTER_TABS,
  MAPPING_BANNER_STORAGE_KEY,
  formatBarangays,
  plusN,
  countVulnerable,
  vulnerableBreakdown,
  statusVariant,
} from './utils'
import { StatusBadge, EmptyState } from './CenterList'
import { FloatingMenuTrigger } from './FloatingMenu'
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
  onAddRoom,
  onEditRoom,
  onViewRoomMap,
  onLinkRoom,
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
            centerFamilies={centerFamilies}
            onEdit={isAdmin ? onEditCenter : undefined}
            onPlaceOnMap={onPlaceOnMap}
            onAddRooms={onAddRooms}
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
            onAddRoom={onAddRoom}
            onEditRoom={onEditRoom}
            onViewRoomMap={onViewRoomMap}
            onLinkRoom={onLinkRoom}
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
    { label: 'Accessibility', value: center.accessibility_notes || 'Not specified', icon: null },
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
  const barangays = Array.isArray(center.barangays) ? center.barangays : []
  const shown = formatBarangays(barangays, 2)
  const remaining = plusN(barangays, 2)
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
            Evacuation Centers
          </button>
          <span className="ec-breadcrumb-separator">/</span>
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
                {shown.map((b) => (
                  <span key={b} className="ds-chip ds-chip--neutral" style={{ fontSize: 'var(--text-xs)', padding: '2px 8px' }}>
                    {b}
                  </span>
                ))}
                {remaining > 0 && (
                  <span className="ds-chip ds-chip--neutral" style={{ fontSize: 'var(--text-xs)', padding: '2px 8px' }}>
                    +{remaining}
                  </span>
                )}
              </div>
              {contact && (
                <a href={'tel:' + contact} className="ec-contact-link" title={'Call ' + contact}>
                  <FontAwesomeIcon icon={faPhone} size="xs" style={{ marginRight: 'var(--space-1)' }} />
                  {contact}
                </a>
              )}
            </div>
          </div>

          <div className="ec-title-actions">
            <button type="button" className="ds-btn ds-btn--primary" onClick={onAssignHousehold}>
              <FontAwesomeIcon icon={faPlus} size="xs" style={{ marginRight: 'var(--space-1)' }} />
              Assign Household
            </button>
            <div className="ec-secondary">
              <button type="button" className="ds-btn ds-btn--secondary" onClick={onViewMap}>
                <FontAwesomeIcon icon={faMap} size="xs" style={{ marginRight: 'var(--space-1)' }} />
                View on map
              </button>
              {isAdmin && (
                <button type="button" className="ds-btn ds-btn--secondary" onClick={onEditCenter}>
                  <FontAwesomeIcon icon={faPen} size="xs" style={{ marginRight: 'var(--space-1)' }} />
                  Edit center
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
      <KpiCardShared label="Capacity" value={cap > 0 ? cap : '—'} helper="Total people it can shelter" />
      <KpiCardShared label="Assigned" value={asg} helper={cap > 0 ? asg + ' of ' + cap + ' assigned' : 'Total assigned'} percent={cap > 0 ? pctAssigned : null} barVariant="brand" />
      <KpiCardShared label="Space left" value={left} helper="People it can still take" />
      <KpiCardShared label="Checked in" value={cin} helper={asg > 0 ? cin + ' of ' + asg + ' assigned have arrived' : 'No one assigned yet'} percent={asg > 0 ? pctCheckedIn : null} barVariant="success" />
    </div>
  )
}

function KpiCardShared({ label, value, helper, percent, barVariant = 'brand', className = '' }) {
  return (
    <div className={`ds-card ${className}`.trim()}>
      <div className="ds-kpi">
        <span className="ds-kpi__label">{label}</span>
        <span className="ds-kpi__value" style={{ fontFamily: 'var(--font-mono)' }}>{value}</span>
        {percent != null && (
          <div className="ds-progress ec-kpi-progress" role="progressbar" aria-valuenow={percent}>
            <div className={`ds-progress__bar ec-kpi-progress__bar ec-kpi-progress--${barVariant}`} style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
          </div>
        )}
        {helper && <span className="ds-kpi__helper">{helper}</span>}
      </div>
    </div>
  )
}
export function MappingBanner({ center, onPlaceOnMap, onDismiss, storageKey }) {
  const key = storageKey || (center?.id ? `evacway:dismissed-mapping-banner-${center.id}` : 'evacway:dismissed-mapping-banner')

  const [dismissed, setDismissed] = useState(() => {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem(key) === '1'
    } catch {
      return false
    }
  })

  if (!center || !centerNeedsMapping(center) || dismissed) return null

  const handleDismiss = () => {
    setDismissed(true)
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, '1')
      }
    } catch {
      // localStorage unavailable or quota exceeded — dismissal won't persist, banner stays dismissible in-session
    }
    onDismiss?.()
  }

  return (
    <div className="ds-banner ds-banner--info" role="status" aria-label="Mapping notice">
      <FontAwesomeIcon icon={faMapPin} size="xs" className="ds-banner__icon" />
      <div className="ds-banner__content">
        <p className="ds-banner__title" style={{ margin: 0, fontWeight: '600' }}>
          This center isn't on the map yet
        </p>
        <p className="ds-banner__text" style={{ margin: 0, fontSize: 'var(--text-xs)' }}>
          Place it on the map so staff can route families here.
        </p>
      </div>
      <div className="ec-banner-actions">
        <button type="button" className="ds-btn ds-btn--primary ds-btn--sm" onClick={() => { onPlaceOnMap?.() }}>
          <FontAwesomeIcon icon={faMapPin} size="xs" /> Place on map
        </button>
        <button type="button" className="ds-btn ds-btn--ghost ds-btn--sm" onClick={handleDismiss}>
          <FontAwesomeIcon icon={faXmark} size="xs" />
        </button>
      </div>
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
      className={`ds-tabs ${className}`.trim()}
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
            className={`ds-tab ${isActive ? 'is-active' : ''}`}
            onClick={() => onSelect(tab.key)}
          >
            <FontAwesomeIcon icon={ICONS_MAP[tab.key]} size="xs" /> {tab.label}
            {count != null && (
              <span className="ec-tab-count">{count}</span>
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

export function OverviewTab({ center, rooms = [], centerFamilies = [], onEdit, onPlaceOnMap, onAddRooms }) {
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
    { label: 'Type of place', value: TYPE_LABELS[center.center_type || 'campus'] || 'Center' },
    { label: 'Building material', value: center.building_material || 'Not specified' },
    { label: 'Accessibility', value: center.accessibility_notes || 'Not specified' },
    { label: 'Contact', value: center.contact_number || 'Not provided' },
    { label: 'Barangays served', value: barangays.length ? barangays.map((b) => (typeof b === 'string' ? b : b.name || b)).join(', ') : 'Not set' },
    { label: 'Address', value: addressParts.length ? addressParts.join(' · ') : 'Not set' },
  ]

  const breakdown = Array.isArray(center.barangay_breakdown) ? center.barangay_breakdown : []

  const readinessItems = [
    { key: 'mapped', label: 'Placed on the map', ok: Boolean(center.has_map), action: onPlaceOnMap, actionLabel: 'Place on map' },
    { key: 'rooms', label: 'Rooms added', ok: Boolean(center.building_count || rooms.length > 0), action: onAddRooms, actionLabel: 'Add room' },
    { key: 'entrance', label: 'Entrance point set', ok: Boolean(center.entrancePoint || center.has_map), action: onEdit, actionLabel: 'Set entrance' },
    { key: 'contact', label: 'Contact number', ok: Boolean(center.contact_number), action: onEdit, actionLabel: 'Edit' },
    { key: 'accessibility', label: 'Accessibility info', ok: Boolean(center.accessibility_notes), action: onEdit, actionLabel: 'Edit' },
  ]

  const readyCount = readinessItems.filter((item) => item.ok).length

  const hasVulnData = Array.isArray(centerFamilies) && centerFamilies.length > 0
  const vulnTotal = hasVulnData ? countVulnerable(centerFamilies) : 0
  const vulnBreakdown = hasVulnData ? vulnerableBreakdown(centerFamilies) : {}

  return (
    <div className="ec-overview ec-two-col">
      <div className="ec-col-left">
        <div className="ds-card ec-info-card">
          <div className="ec-overview-title-row">
            <h2>Center Information</h2>
            {isAdmin && onEdit && (
              <button type="button" className="ds-btn ds-btn--ghost ds-btn--sm" onClick={onEdit}>
                <FontAwesomeIcon icon={faEdit} size="xs" style={{ marginLeft: 'var(--space-1)' }} />
                Edit
              </button>
            )}
          </div>
          <dl className="ec-def-list">
            {infoRows.map((row) => (
              <div key={row.label} className="ec-def-row">
                <dt className="ec-def-term">{row.label}</dt>
                <dd className="ec-def-value">{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      <div className="ec-col-right">
        <div className="ds-card ec-readiness-card">
          <div className="ec-overview-title-row">
            <h2>Readiness checklist</h2>
          </div>
          <p className="ec-readiness-count">{readyCount} of 5 ready</p>
          {readinessItems.map((item) => (
            <div key={item.key} className="ec-readiness-item" role="listitem">
              <span className={`ec-readiness-icon ds-badge ds-badge--${item.ok ? 'success' : 'warning'}`}>
                {item.ok ? <FontAwesomeIcon icon={faCheck} size="xs" /> : <FontAwesomeIcon icon={faTriangleExclamation} size="xs" />}
              </span>
              <span className="ec-readiness-label">{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
export function StructureTab({ center, rooms = [], buildings = [], onAddBuilding, onAddRoom, onEditRoom, onViewRoomMap, onLinkRoom, onDeleteRoom }) {
  // Group rooms by building_id (compare as strings), rooms without building_id go to "Unassigned"
  const groups = useMemo(() => {
    const buildingMap = new Map();
    buildings.forEach((b) => buildingMap.set(String(b.id), { building: b, rooms: [] }));
    buildingMap.set('unassigned', { building: null, rooms: [] });

    rooms.forEach((room) => {
      const bid = room.building_id != null ? String(room.building_id) : 'unassigned';
      const group = buildingMap.get(bid) || buildingMap.get('unassigned');
      group.rooms.push(room);
    });

    // Convert to array, sort: named buildings first (by name), then Unassigned last
    return Array.from(buildingMap.entries())
      .filter(([, v]) => v.building || v.rooms.length > 0) // show building even if empty, but skip unassigned if empty
      .sort((a, b) => {
        if (a[0] === 'unassigned') return 1;
        if (b[0] === 'unassigned') return -1;
        const nameA = a[1].building?.name || '';
        const nameB = b[1].building?.name || '';
        return nameA.localeCompare(nameB);
      });
  }, [buildings, rooms]);

  return (
    <div className="ec-structure">
      <div className="ec-structure-header">
        <h2>Center Structure</h2>
        <div className="ec-structure-actions">
          {onAddBuilding && (
            <button type="button" className="ds-btn ds-btn--secondary" onClick={onAddBuilding}>
              <FontAwesomeIcon icon={faBuilding} size="xs" style={{ marginRight: 'var(--space-1)' }} />
              Add building
            </button>
          )}
          <button type="button" className="ds-btn ds-btn--primary" onClick={onAddRoom}>
            <FontAwesomeIcon icon={faPlus} size="xs" style={{ marginRight: 'var(--space-1)' }} />
            Add room
          </button>
        </div>
      </div>
      {rooms.length === 0 && buildings.length === 0 ? (
        <EmptyState icon={faBuilding} title="No rooms yet" text="Add a building, then add rooms to it." />
      ) : (
        <div className="ec-structure-groups">
          {groups.map(({ building, rooms: groupRooms }) => (
            <div key={building?.id || 'unassigned'} className="ec-structure-group">
              <div className="ec-structure-building">
                <h3>{building?.name || 'Unassigned rooms'}</h3>
                {building?.notes && <p className="ec-building-notes">{building.notes}</p>}
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
                            {onViewRoomMap && room.latitude != null && room.longitude != null && (
                              <button
                                type="button"
                                className="ds-btn ds-btn--ghost ds-btn--icon"
                                onClick={() => onViewRoomMap(room)}
                                title="View on map"
                              >
                                <FontAwesomeIcon icon={faMapPin} size="xs" />
                              </button>
                            )}
                            {onLinkRoom && (
                              <button
                                type="button"
                                className="ds-btn ds-btn--ghost ds-btn--icon"
                                onClick={() => onLinkRoom(room)}
                                title="Link to building"
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
          ))}
        </div>
      )}
    </div>
  );
}

export function HouseholdsTab({ center, centerFamilies = [], rooms = [], onAssignHousehold, onMove, loading = false }) {
  return (
    <div className="ec-households">
      <div className="ec-households-header">
        <h2>Households</h2>
      </div>
      {centerFamilies.length === 0 ? (
        <EmptyState icon={faEdit} title="No households assigned" text="Households assigned to this center will appear here." />
      ) : (
        <table className="ds-table ec-households-table ds-table--stack">
          <thead>
            <tr>
              <th scope="col">Household</th>
              <th scope="col">Room</th>
              <th scope="col">Members</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {centerFamilies.map((fam) => (
              <tr key={fam.id}>
                <td>{fam.household_head_name || fam.head_name || 'Unnamed'}</td>
                <td>{fam.room_number || 'Not assigned'}</td>
                <td>{fam.member_count || fam.family_members || 1}</td>
                <td>{fam.is_checked_in ? 'Checked in' : 'Not arrived'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
export function ActivityTab({ center }) {
  const [typeFilter, setTypeFilter] = useState('all')
  const [centerLogs, setCenterLogs] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(false)

  const centerName = center?.name || ''

  return (
    <div className="ec-activity">
      <div className="ec-activity-header">
        <div className="ec-activity-title-row">
          <FontAwesomeIcon icon={faEdit} size="xs" className="ec-activity-title-icon" />
          <h2 className="ec-activity-title">Activity</h2>
        </div>
        <div className="ec-activity-chips">
          <button type="button" className={`ec-activity-chip ${typeFilter === 'all' ? 'ec-activity-chip--active' : ''}`} onClick={() => setTypeFilter('all')} aria-pressed={typeFilter === 'all'}>
            All <span className="ec-activity-chip-count">{centerLogs.length}</span>
          </button>
        </div>
      </div>
      <div className="ec-activity-list" role="list">
        {loading ? (
          <div className="ec-activity-skeleton">
            <div className="ds-skeleton ds-skeleton--line" style={{ height: 'var(--text-xs)', width: '60%' }} />
            <div className="ds-skeleton ds-skeleton--line" style={{ height: 'var(--text-xs)', width: '80%' }} />
          </div>
        ) : centerLogs.length === 0 ? (
          <EmptyState icon={faEdit} title="No activity yet" text="Assignments, moves, check-ins and center edits for this center will appear here." />
        ) : (
          <div>
            {centerLogs.map((log) => {
              const name = 'Admin'
              const sentence = String(log.action || '')
              const when = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              return (
                <div key={log.id} className="ec-activity-item" role="listitem">
                  <div className="ec-activity-icon" aria-hidden="true">
                    <FontAwesomeIcon icon={faEdit} />
                  </div>
                  <div className="ec-activity-body">
                    <div className="ec-activity-sentence" title={sentence}>
                      {sentence}
                    </div>
                    <div className="ec-activity-meta">
                      <span className="ec-activity-who">by {name}</span>
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
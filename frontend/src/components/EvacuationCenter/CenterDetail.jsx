import { useState, useCallback, useEffect, useMemo, Fragment } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  formatManilaDateTime,
  formatManilaRelativeDay,
  formatManilaTime,
} from '../../utils/dateTime'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faBuilding,
  faMap,
  faPen,
  faPlus,
  faPhone,
  faTrash,
  faBuildingColumns,
  faUserPlus,
  faUserCheck,
  faDoorOpen,
  faUsers,
  faPeopleGroup,
  faClockRotateLeft,
  faCircleCheck,
  faTriangleExclamation,
  faLocationDot,
  faArrowsRotate,
  faDrawPolygon,
  faChevronLeft,
  faChevronRight,
  faSearch,
  faDownload,
  faXmark,
  faRightLeft,
  faUserMinus,
  faEllipsisVertical,
} from '@fortawesome/free-solid-svg-icons'
import { api } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import { useCenterDetails, useFamily } from '../../hooks/useEvacuationQueries'
import { formatRoomLabel, formatFloorLabel } from '../../utils/formatRoomLabel'
import {
  centerStatus,
  CENTER_TABS,
  isCenterMapped,
  resolveBuildingOperationalStatus,
  resolveCenterStructureMode,
} from './utils'
import { EmptyState } from './CenterList'
import { FloatingMenuTrigger } from './FloatingMenu'
import { familyTerm } from './utils'
import { Breadcrumb, Button, ProgressBar, StatCard, StatusPill } from '../ui'
import MappingBanner from './MappingBanner'
import ReadinessChecklist from './ReadinessChecklist'
import './CenterDetail.css'

const VALID_TABS = ['overview', 'structure', 'households', 'activity']

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
    return function () {
      document.removeEventListener('keydown', onKeyDown)
    }
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
  counts,
  rooms = [],
  buildings = [],
  centerCapacity,
  centerOccupied,
  centerAssigned,
  householdCapacity,
  householdAssigned,
  householdArrived,
  householdSpaceLeft,
  onBack,
  onAssignHousehold,
  onViewMap,
  onEditCenter,
  onAddRooms,
  onAddBuilding,
  onOpenRoom,
  onOpenBuilding,
  onAddRoom,
  onEditRoom,
  onMove,
  onUnassign,
  onDeactivate,
  canDeactivate,
  onPlaceOnMap,
}) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const canManageCenter = isAdmin || user?.role === 'lgu_personnel'
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
  const structureMode = resolveCenterStructureMode(center)
  const isOpenArea = structureMode === 'open_area'
  const visibleTabs = useMemo(
    () => (isOpenArea ? CENTER_TABS.filter((t) => t.key !== 'structure') : CENTER_TABS),
    [isOpenArea]
  )
  const visibleTabKeys = useMemo(() => visibleTabs.map((t) => t.key), [visibleTabs])

  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') || 'overview'
  const effectiveActiveTab = VALID_TABS.includes(activeTab) && visibleTabKeys.includes(activeTab)
    ? activeTab
    : 'overview'

  const handleSelectTab = useCallback(
    (tabKey) => {
      if (!visibleTabKeys.includes(tabKey)) return
      setSearchParams({ tab: tabKey }, { replace: true })
    },
    [setSearchParams, visibleTabKeys]
  )

  return (
    <div className="ec-detail">
      {/* 1. Breadcrumb & Header */}
      <CenterHeader
        center={center}
        status={status}
        buildings={buildings}
        onBack={onBack}
        onAssignHousehold={onAssignHousehold}
        onViewMap={onViewMap}
        onEditCenter={canManageCenter ? onEditCenter : undefined}
        onAddRooms={structureMode === 'rooms_only' ? onAddRooms : undefined}
        onAddBuilding={canManageCenter ? onAddBuilding : undefined}
        onDeactivate={isAdmin ? () => onDeactivate?.(center) : undefined}
        canDeactivate={canDeactivate}
        onPlaceOnMap={onPlaceOnMap}
      />

      {/* 2. Tab Bar: placed directly under header with 20px space, sticky on scroll */}
      <SectionTabs
        activeKey={effectiveActiveTab}
        tabs={visibleTabs}
        counts={counts}
        onSelect={handleSelectTab}
      />

      {/* 3. Tab Content below tab bar */}
      <div className="ec-detail-content">
        <section
          id="ec-tabpanel-overview"
          role="tabpanel"
          aria-labelledby="ec-tab-overview"
          className={`ec-tab-panel ${effectiveActiveTab === 'overview' ? 'is-active' : ''}`}
          aria-hidden={effectiveActiveTab !== 'overview'}
        >
          {/* Overview tab only: stat cards at the top in one row of 4, Center Info & Checklist side by side below */}
          <OverviewTab
            center={center}
            rooms={rooms}
            buildings={buildings}
            centerFamilies={centerFamilies}
            capacity={capacity}
            assigned={assigned}
            checkedIn={checkedIn}
            spaceLeft={spaceLeft}
            householdCapacity={householdCapacity}
            householdAssigned={householdAssigned}
            householdArrived={householdArrived}
            householdSpaceLeft={householdSpaceLeft}
            onEdit={canManageCenter ? onEditCenter : undefined}
            onPlaceOnMap={onPlaceOnMap}
            onAddRooms={structureMode === 'rooms_only' ? onAddRooms : undefined}
            onAddBuilding={canManageCenter ? onAddBuilding : undefined}
          />
        </section>

        {/* Structure tab only shown when center is not an open area */}
        {!isOpenArea && (
          <section
            id="ec-tabpanel-structure"
            role="tabpanel"
            aria-labelledby="ec-tab-structure"
            className={`ec-tab-panel ${effectiveActiveTab === 'structure' ? 'is-active' : ''}`}
            aria-hidden={effectiveActiveTab !== 'structure'}
          >
            <StructureTab
              center={center}
              rooms={rooms}
              buildings={buildings}
              centerFamilies={centerFamilies}
              onAddBuilding={canManageCenter ? onAddBuilding : undefined}
              onOpenRoom={onOpenRoom}
              onAddRoom={structureMode === 'rooms_only' ? onAddRoom : undefined}
              onEditRoom={onEditRoom}
              onOpenBuilding={onOpenBuilding}
              onAssignHousehold={onAssignHousehold}
              onEditCenter={canManageCenter ? onEditCenter : undefined}
            />
          </section>
        )}

        <section
          id="ec-tabpanel-households"
          role="tabpanel"
          aria-labelledby="ec-tab-households"
          className={`ec-tab-panel ${effectiveActiveTab === 'households' ? 'is-active' : ''}`}
          aria-hidden={effectiveActiveTab !== 'households'}
        >
          <HouseholdsTab
            center={center}
            centerFamilies={centerFamilies}
            loading={detailsQuery.isLoading}
            error={detailsQuery.error}
            onRetry={() => detailsQuery.refetch()}
            rooms={rooms}
            buildings={buildings}
            onAssignHousehold={onAssignHousehold}
            onMove={onMove}
            onUnassign={onUnassign}
          />
        </section>

        <section
          id="ec-tabpanel-activity"
          role="tabpanel"
          aria-labelledby="ec-tab-activity"
          className={`ec-tab-panel ${effectiveActiveTab === 'activity' ? 'is-active' : ''}`}
          aria-hidden={effectiveActiveTab !== 'activity'}
        >
          <ActivityTab center={center} />
        </section>
      </div>
    </div>
  )
}

function HeaderStatusPill({ status }) {
  const s = status || 'Available'
  let tone = 'available'
  if (s === 'Full') tone = 'full'
  else if (s === 'Over capacity') tone = 'full'
  else if (s === 'Near Full') tone = 'near-full'
  else if (s === 'Inactive' || s === 'Closed') tone = 'inactive'

  return (
    <span className={`ec-header-status-pill is-${tone}`}>
      <span className={`ec-header-status-dot is-${tone}`} />
      <span>{s}</span>
    </span>
  )
}

export function CenterHeader({
  center,
  status,
  buildings = [],
  onBack,
  onAssignHousehold,
  onViewMap,
  onEditCenter,
  onAddRooms,
  onAddBuilding,
  onDeactivate,
  canDeactivate,
}) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const canManageCenter = isAdmin || user?.role === 'lgu_personnel'
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [showAllBarangays, setShowAllBarangays] = useState(false)

  const name = center?.name || 'Unnamed Center'
  const rawBarangays = Array.isArray(center?.barangays) ? center.barangays : []
  const allBarangays = rawBarangays
    .map((b) => (typeof b === 'string' ? b : b?.name || ''))
    .filter(Boolean)
  const contact = center?.contact_number || null
  const isActive = Boolean(center?.is_active)

  // Conditional buttons logic
  const isMapped = Boolean(
    isCenterMapped(center) ||
    center?.has_map ||
    (center?.latitude != null && center?.longitude != null) ||
    (center?.lat != null && center?.lng != null)
  )

  const structureMode = resolveCenterStructureMode(center)
  const isSingleVenue = structureMode === 'open_area'
  const canAddRoom = !isSingleVenue
  const buildingRecords =
    Array.isArray(buildings) && buildings.length > 0
      ? buildings
      : Array.isArray(center?.buildings)
        ? center.buildings
        : []
  const unmappedBuildingsCount =
    structureMode === 'buildings_and_rooms'
      ? buildingRecords.length > 0
        ? buildingRecords.filter(
            (b) => !(b?.is_mapped || b?.properties?.is_mapped)
          ).length
        : Number(center?.unmapped_building_count || 0)
      : 0
  const hasMappedBuilding =
    structureMode !== 'buildings_and_rooms' ||
    (buildingRecords.length > 0
      ? buildingRecords.some(
          (b) =>
            Boolean(b?.is_mapped || b?.properties?.is_mapped) &&
            resolveBuildingOperationalStatus(b) === 'open'
        )
      : Number(center?.building_count || 0) > Number(center?.unmapped_building_count || 0))
  const canAssignHousehold = isMapped && hasMappedBuilding
  const assignDisabledReason = !isMapped
    ? 'Place this evacuation center on the map before assigning families.'
    : !hasMappedBuilding
      ? 'Place at least one open building on the map before assigning families.'
      : undefined

  const kebabItems = []
  if (canAddRoom && onAddRooms) {
    kebabItems.push({ label: 'Add rooms', icon: faPlus, onClick: onAddRooms })
  }
  if (canManageCenter && onEditCenter) {
    kebabItems.push({ label: 'Edit center', icon: faPen, onClick: onEditCenter })
  }
  if (kebabItems.length > 0 && isAdmin && canDeactivate && onDeactivate) {
    kebabItems.push({ divider: true })
  }
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
    ? `Deactivating “${name}” will hide it from the active centers list. Assigned families keep their records.`
    : `Activating “${name}” will return it to the active centers list.`

  const maxBarangays = 3
  const visibleBarangays = showAllBarangays
    ? allBarangays
    : allBarangays.slice(0, maxBarangays)
  const remainingCount = Math.max(0, allBarangays.length - maxBarangays)
  const remainingTooltip = allBarangays.slice(maxBarangays).join(', ')

  return (
    <>
      <Breadcrumb
        items={[
          { label: 'Evacuation Centers', onClick: onBack },
          { label: name },
        ]}
      />

      <header className="ec-detail-header">
        <div className="ec-title-row">
          <div className="ec-title-info">
            <div className="ec-title-line">
              <h1 className="ec-detail-title">{name}</h1>
              <HeaderStatusPill status={status} />
              {isMapped && unmappedBuildingsCount > 0 && (
                <StatusPill
                  variant="unmapped"
                  label={`${unmappedBuildingsCount} bldg${unmappedBuildingsCount > 1 ? 's' : ''} unmapped`}
                />
              )}
            </div>

            <div className="ec-title-meta-line">
              <div className="ec-barangay-pills">
                {visibleBarangays.map((b) => (
                  <span key={b} className="ec-barangay-pill">
                    {b}
                  </span>
                ))}
                {!showAllBarangays && remainingCount > 0 && (
                  <button
                    type="button"
                    className="ec-barangay-pill ec-barangay-pill--more"
                    onClick={() => setShowAllBarangays(true)}
                    title={`Click to show: ${remainingTooltip}`}
                    aria-label={`${remainingCount} more barangays: ${remainingTooltip}`}
                  >
                    +{remainingCount}
                  </button>
                )}
                {showAllBarangays && remainingCount > 0 && (
                  <button
                    type="button"
                    className="ec-barangay-pill ec-barangay-pill--more"
                    onClick={() => setShowAllBarangays(false)}
                    title="Click to collapse"
                  >
                    Show less
                  </button>
                )}
              </div>
              {contact && (
                <>
                  <span className="ec-meta-bullet" aria-hidden="true">·</span>
                  <a href={'tel:' + contact} className="ec-contact-line" title={'Call ' + contact}>
                    <FontAwesomeIcon icon={faPhone} className="ec-contact-icon" />
                    <span>{contact}</span>
                  </a>
                </>
              )}
            </div>
          </div>

          <div className="ec-title-actions">
            <button
              type="button"
              className={`ec-btn-primary-action ${!canAssignHousehold ? 'is-unavailable' : ''}`}
              onClick={onAssignHousehold}
              aria-disabled={!canAssignHousehold}
              title={assignDisabledReason}
            >
              <FontAwesomeIcon icon={faPlus} />
              <span>Assign Family</span>
            </button>
            {isMapped && onViewMap && (
              <button
                type="button"
                className="ec-btn-secondary-action"
                onClick={onViewMap}
              >
                <FontAwesomeIcon icon={faMap} />
                <span>View on map</span>
              </button>
            )}
            {kebabItems.length > 0 && (
              <FloatingMenuTrigger
                items={kebabItems}
                label="More actions"
                align="right"
              />
            )}
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

export function KpiStrip({
  householdCapacity,
  householdAssigned,
  householdArrived,
  householdSpaceLeft,
  isOpenArea = false,
  onEditCapacity,
}) {
  const householdCap = Number(householdCapacity ?? householdAssigned ?? 0)
  const householdAsg = Number(householdAssigned ?? 0)
  const householdCheckIn = Number(householdArrived ?? 0)
  const householdLeft = Math.max(0, Number(householdSpaceLeft || 0))

  const pctAssigned = householdCap > 0 ? Math.min(100, Math.round((householdAsg / householdCap) * 100)) : 0
  const pctArrived = householdAsg > 0 ? Math.min(100, Math.round((householdCheckIn / householdAsg) * 100)) : 0

  return (
    <div className="ec-kpi-strip">
      <div className="ec-kpi-card">
        <div className="ec-kpi-card-header">
          <span className="ec-kpi-label">Family capacity</span>
          {isOpenArea && onEditCapacity ? (
            <button
              type="button"
              className="ec-info-edit-btn"
              onClick={onEditCapacity}
              title="Edit the individual people limit used to estimate family capacity"
            >
              <FontAwesomeIcon icon={faPen} size="xs" />
              <span>Edit</span>
            </button>
          ) : (
            <FontAwesomeIcon icon={faBuildingColumns} className="ec-kpi-icon-muted" />
          )}
        </div>
        <div className="ec-kpi-val">{householdCap > 0 ? householdCap : '—'}</div>
        <div className="ec-kpi-helper">
          Estimated from average family size in the served barangays
        </div>
      </div>

      <div className="ec-kpi-card">
        <div className="ec-kpi-card-header">
          <span className="ec-kpi-label">Assigned</span>
          <FontAwesomeIcon icon={faUserPlus} className="ec-kpi-icon-muted" />
        </div>
        <div className="ec-kpi-val">{householdAsg}</div>
        <div className="ec-kpi-progress-track">
          <div className="ec-kpi-progress-fill" style={{ width: `${pctAssigned}%` }} />
        </div>
        <div className="ec-kpi-helper">{householdCap > 0 ? `${householdAsg} of ${householdCap} families assigned` : 'Total families assigned'}</div>
      </div>

      <div className="ec-kpi-card">
        <div className="ec-kpi-card-header">
          <span className="ec-kpi-label">Space Left</span>
          <FontAwesomeIcon icon={faDoorOpen} className="ec-kpi-icon-muted" />
        </div>
        <div className="ec-kpi-val">{householdLeft}</div>
        <div className="ec-kpi-helper">Families it can still take</div>
      </div>

      <div className="ec-kpi-card">
        <div className="ec-kpi-card-header">
          <span className="ec-kpi-label">Arrived</span>
          <FontAwesomeIcon icon={faCircleCheck} className="ec-kpi-icon-muted" />
        </div>
        <div className="ec-kpi-val">{householdCheckIn}</div>
        <div className="ec-kpi-progress-track">
          <div className="ec-kpi-progress-fill" style={{ width: `${pctArrived}%` }} />
        </div>
        <div className="ec-kpi-helper">{householdAsg > 0 ? `${householdCheckIn} of ${householdAsg} families arrived` : 'No families assigned yet'}</div>
      </div>
    </div>
  )
}

export function SectionTabs({ activeKey, tabs = CENTER_TABS, counts = {}, onSelect, className = '' }) {
  const keys = tabs.map((t) => t.key)

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
      className={`ec-underline-tabs ${className}`.trim()}
      onKeyDown={handleKeyDown}
    >
      {tabs.map((tab) => {
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
            className={`ec-underline-tab ${isActive ? 'is-active' : ''}`}
            onClick={() => onSelect(tab.key)}
          >
            <span className="ec-underline-tab-label">{tab.label}</span>
            {count != null && (
              <span className="ec-underline-tab-count">{count}</span>
            )}
          </button>
        )
      })}
    </nav>
  )
}

const TYPE_LABELS = {
  campus: 'Campus / Multi-building',
  single_venue: 'Single venue',
  private_property: 'Private property',
}

export function OverviewTab({
  center,
  rooms = [],
  buildings = [],
  centerFamilies = [],
  capacity = 0,
  assigned = 0,
  checkedIn = 0,
  spaceLeft = 0,
  householdCapacity,
  householdAssigned,
  householdArrived,
  householdSpaceLeft,
  onEdit,
  onPlaceOnMap,
  onAddRooms,
  onAddBuilding,
}) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const canManageCenter = isAdmin || user?.role === 'lgu_personnel'

  const barangays = Array.isArray(center?.barangays) ? center.barangays : []
  const addressParts = []
  if (center?.address) addressParts.push(center.address)
  if (barangays.length) {
    addressParts.push(
      barangays.map((b) => (typeof b === 'string' ? b : b.name || b)).join(', ')
    )
  }

  const infoRows = [
    {
      label: 'Type of place',
      value: center?.center_type_name || TYPE_LABELS[center?.center_type || 'campus'] || 'Center',
    },
    { label: 'Building material', value: center?.building_material || 'Concrete / Standard' },
    {
      label: 'Amenities',
      value:
        Array.isArray(center?.amenities) && center.amenities.length > 0
          ? center.amenities
            .map((a) => (typeof a === 'string' ? a : a.name || a.code))
            .filter(Boolean)
            .join(', ')
          : 'None added',
    },
    { label: 'Contact', value: center?.contact_number || 'Not provided' },
    {
      label: 'Barangays served',
      value: barangays.length
        ? barangays.map((b) => (typeof b === 'string' ? b : b.name || b)).join(', ')
        : 'Not set',
    },
    { label: 'Address', value: addressParts.length ? addressParts.join(' · ') : 'Not set' },
  ]

  const structureMode = resolveCenterStructureMode(center)
  const isOpenArea = structureMode === 'open_area'

  return (
    <div className="ec-overview-tab-content">
      {/* Mapping notice if center is unmapped */}
      <MappingBanner center={center} onPlaceOnMap={onPlaceOnMap} />

      {/* Four stat cards at the top of the Overview content */}
      <KpiStrip
        capacity={capacity}
        assigned={assigned}
        checkedIn={checkedIn}
        spaceLeft={spaceLeft}
        householdCapacity={householdCapacity}
        householdAssigned={householdAssigned}
        householdArrived={householdArrived}
        householdSpaceLeft={householdSpaceLeft}
        isOpenArea={isOpenArea}
        onEditCapacity={canManageCenter && onEdit && isOpenArea ? () => onEdit(1) : undefined}
      />

      {/* Center Information and Readiness Checklist side by side below */}
      <div className="ec-overview ec-two-col">
        <div className="ec-info-card">
          <div className="ec-info-card-header">
            <h3 className="ec-info-card-title">Center Information</h3>
            {canManageCenter && onEdit && (
              <button type="button" className="ec-info-edit-btn" onClick={onEdit}>
                <FontAwesomeIcon icon={faPen} size="xs" />
                <span>Edit</span>
              </button>
            )}
          </div>

          <dl className="ec-info-list">
            {infoRows.map((row) => (
              <div key={row.label} className="ec-info-row">
                <dt className="ec-info-label">{row.label}</dt>
                <dd className="ec-info-value">{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <ReadinessChecklist
          center={{
            ...center,
            room_count: center?.room_count ?? center?.total_rooms ?? rooms.length,
            building_count: center?.building_count ?? buildings.length,
            buildings: buildings.length > 0 ? buildings : center?.buildings,
            unmapped_building_count:
              buildings.length > 0
                ? buildings.filter((b) => !b?.is_mapped).length
                : center?.unmapped_building_count,
          }}
          onPlaceOnMap={onPlaceOnMap}
          onAddRooms={onAddRooms}
          onAddBuilding={onAddBuilding}
          onSetEntrance={onEdit}
          onEditContact={onEdit}
          onEditAccessibility={() => onEdit?.(4)}
        />
      </div>
    </div>
  )
}

function getRoomHouseholdCount(room, averageHouseholdSize = null) {
  const families = room?.families || room?.assigned_families
  if (Array.isArray(families)) {
    const householdKeys = families.map((family, index) =>
      family?.family_id ?? family?.id ?? family?.family_code ?? `household-${index}`
    )
    return new Set(householdKeys.map(String)).size
  }
  return averageHouseholdSize != null && averageHouseholdSize > 0
    ? Math.round(Number(room?.assigned || 0) / averageHouseholdSize)
    : 0
}

function getRoomArrivedHouseholdCount(room) {
  const families = room?.families || room?.assigned_families
  if (!Array.isArray(families)) return 0
  return families.filter((family) => family?.is_checked_in || family?.checked_in_at).length
}

function RoomCard({
  room,
  averageHouseholdSize = null,
  householdAssigned,
  householdArrived,
  index = 0,
  onOpenRoom,
  onEditRoom,
}) {
  const asg = Number(householdAssigned ?? getRoomHouseholdCount(room, averageHouseholdSize))
  const occupied = Number(householdArrived ?? getRoomArrivedHouseholdCount(room))
  const slots = Math.max(1, Number(room?.family_slots ?? 5))
  const spaces = Math.max(1, Number(room?.people_spaces ?? room?.capacity ?? 25))
  const usedSlots = Number(room?.used_slots ?? asg)
  const usedSpaces = Number(room?.used_spaces ?? room?.assigned ?? room?.occupied ?? 0)
  const isOverCapacity = Boolean(room?.is_over_capacity) || usedSlots > slots || usedSpaces > spaces
  const isFull = Boolean(room?.is_full) || usedSlots >= slots || usedSpaces >= spaces
  const status = isFull ? 'full' : usedSlots === 0 && usedSpaces === 0 ? 'empty' : 'available'
  const pct = Math.min(100, Math.round(Math.max(usedSlots / slots, usedSpaces / spaces) * 100))
  const roomName = room?.room_number || `Room #${room?.id || ''}`

  return (
    <div
      className={`ec-room-card is-${status}`}
      role="listitem"
      tabIndex={0}
      style={{ animationDelay: `${Math.min(index, 9) * 20}ms` }}
      onClick={() => (onOpenRoom || onEditRoom)?.(room)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          if (onOpenRoom) onOpenRoom(room)
          else onEditRoom?.(room)
        }
      }}
      title={`Open ${roomName} details - ${status} (Slots ${usedSlots}/${slots} · Spaces ${usedSpaces}/${spaces})`}
    >
      <div className="ec-room-card-top">
        <div className={`ec-room-card-icon is-${status}`} aria-hidden="true">
          <FontAwesomeIcon icon={faDoorOpen} />
        </div>
        <span className={`ec-room-status-pill is-${status}`}>
          {isOverCapacity ? 'Over capacity' : status === 'available' ? 'Available' : status === 'full' ? 'Full' : 'Empty'}
        </span>
      </div>

      <h4 className="ec-room-card-name" title={roomName}>
        {roomName}
      </h4>
      {formatFloorLabel(room?.floor) && <span className="ec-room-floor-label">{formatFloorLabel(room.floor)}</span>}

      <div className={`ec-room-bar-track ${isFull ? 'is-full-track' : ''}`}>
        <div
          className="ec-room-bar-fill"
          style={{ width: `${pct}%` }}
        />
      </div>

      <span className="ec-room-card-assigned">
        Slots {usedSlots}/{slots} · Spaces {usedSpaces}/{spaces}
      </span>

      <div className="ec-room-card-footer">
        <span className="ec-room-card-arrived">Families arrived: {occupied}</span>

        <div className="ec-room-card-actions" onClick={(e) => e.stopPropagation()}>
          {onEditRoom && (
            <button
              type="button"
              className="ec-room-btn-action"
              onClick={(e) => {
                e.stopPropagation()
                onEditRoom(room)
              }}
              title="Edit room"
              aria-label={`Edit ${roomName}`}
            >
              <FontAwesomeIcon icon={faPen} />
            </button>
          )}

        </div>
      </div>
    </div>
  )
}

export function RoomDetailPage({
  center,
  room,
  building,
  buildingName,
  families = [],
  loading = false,
  error = null,
  notFound = false,
  onBack,
  onBackToList,
  listHref,
  centerHref,
  buildingHref,
  onOpenBuilding,
  onAddHousehold,
  onUnassignHousehold,
  onEditRoom,
  onRetry,
}) {
  const [familyToView, setFamilyToView] = useState(null)

  const registeredFamilies = families.filter((family) => !family?.is_non_registered)
  const walkInOccupants = families.filter((family) => Boolean(family?.is_non_registered))
  const walkInFamilies = walkInOccupants.filter(
    (family) => !family?.is_individual && Number(family?.member_count || family?.family_members || 1) > 1
  )
  const walkInIndividuals = walkInOccupants.filter(
    (family) => family?.is_individual || Number(family?.member_count || family?.family_members || 1) === 1
  )
  const familiesAssigned = registeredFamilies.length + walkInFamilies.length
  const familiesArrived =
    registeredFamilies.filter((family) => Boolean(family?.is_checked_in)).length + walkInFamilies.length
  const memberCounts = families.map((family) =>
    Number(family?.member_count || family?.family_members || family?.assigned_members || 1)
  )
  const totalMembers = memberCounts.reduce((sum, count) => sum + count, 0)
  const registeredMemberCount = registeredFamilies.reduce(
    (sum, family) => sum + Number(family?.member_count || family?.family_members || family?.assigned_members || 1),
    0
  )
  const walkInMemberCount = totalMembers - registeredMemberCount

  const familySlots = Math.max(1, Number(room?.family_slots ?? 5))
  const peopleSpaces = Math.max(1, Number(room?.people_spaces ?? room?.capacity ?? 25))
  const usedSlots = Number(room?.used_slots ?? familiesAssigned)
  const usedSpaces = Number(room?.used_spaces ?? (totalMembers || room?.assigned || 0))
  const slotsLeft = Math.max(0, familySlots - usedSlots)
  const spacesLeft = Math.max(0, peopleSpaces - usedSpaces)
  const isOverCapacity =
    Boolean(room?.is_over_capacity) || usedSlots > familySlots || usedSpaces > peopleSpaces
  const isFull = Boolean(room?.is_full) || usedSlots >= familySlots || usedSpaces >= peopleSpaces
  const isSpacesFull = usedSpaces >= peopleSpaces
  const roomTitle = formatRoomLabel(room?.room_number)
  const isInactive = room?.is_active === false

  const statusPillVariant = isInactive
    ? 'unmapped'
    : isOverCapacity || isFull
      ? 'full'
      : 'available'
  const statusPillLabel = isInactive
    ? 'Inactive'
    : isOverCapacity
      ? 'Over capacity'
      : isFull
        ? 'Full'
        : 'Available'

  const hasBuilding = Boolean(building || room?.building_id != null)
  const resolvedBuildingName = buildingName || building?.name || ''
  const resolvedFloorLabel = formatFloorLabel(room?.floor ?? (hasBuilding ? 1 : null))
  const subtitleParts = [resolvedBuildingName || 'Unassigned building', resolvedFloorLabel].filter(Boolean)

  const centerStructureMode = resolveCenterStructureMode(center)
  const isCenterMappedFlag =
    room?.center_is_mapped != null
      ? Boolean(room.center_is_mapped)
      : center
        ? Boolean(
            isCenterMapped(center) ||
              center?.has_map ||
              center?.is_mapped ||
              (center?.latitude != null && center?.longitude != null) ||
              (center?.lat != null && center?.lng != null)
          )
        : true
  const isBuildingMappedFlag =
    centerStructureMode !== 'buildings_and_rooms'
      ? true
      : building?.is_mapped != null
        ? Boolean(building.is_mapped)
        : room?.building_is_mapped != null
          ? Boolean(room.building_is_mapped)
          : true
  const isBuildingOpenFlag =
    centerStructureMode !== 'buildings_and_rooms'
      ? true
      : resolveBuildingOperationalStatus(building, room) === 'open'
  const isRoomAssignable = !isInactive && isCenterMappedFlag && isBuildingMappedFlag && isBuildingOpenFlag
  const unmappedAssignReason = !isCenterMappedFlag
    ? 'This evacuation center is not mapped yet. Place the center on the map before assigning families.'
    : !isBuildingMappedFlag
      ? `${resolvedBuildingName || 'This building'} is not mapped yet. Place the building on the map before assigning families to its rooms.`
      : !isBuildingOpenFlag
        ? `${resolvedBuildingName || 'This building'} is currently not open for assignments.`
        : null

  const breadcrumbItems = [
    {
      label: 'Evacuation Centers',
      to: listHref || undefined,
      onClick: listHref ? undefined : onBackToList,
    },
    {
      label: center?.name || 'Evacuation Center',
      to: centerHref || undefined,
      onClick: centerHref ? undefined : onBack,
    },
    ...(hasBuilding
      ? [
          {
            label: resolvedBuildingName || 'Building',
            to: buildingHref || undefined,
            onClick: buildingHref ? undefined : () => onOpenBuilding?.(building),
          },
        ]
      : []),
    { label: roomTitle },
  ]

  const familySlotsFooter =
    usedSlots > familySlots
      ? `Over limit by ${usedSlots - familySlots}`
      : slotsLeft === 0
        ? 'No slots left'
        : `${slotsLeft} ${slotsLeft === 1 ? 'slot' : 'slots'} still free`

  const peopleSpacesFooter =
    usedSpaces > peopleSpaces
      ? `Over capacity by ${usedSpaces - peopleSpaces}`
      : spacesLeft === 0
        ? 'No spaces left'
        : `${spacesLeft} ${spacesLeft === 1 ? 'space' : 'spaces'} still free`

  const walkInIndivNote =
    walkInIndividuals.length > 0
      ? ` · ${walkInIndividuals.length} walk-in ${walkInIndividuals.length === 1 ? 'individual' : 'individuals'} on-site`
      : ''

  const arrivedFooter =
    familiesAssigned === 0
      ? walkInIndividuals.length > 0
        ? `${walkInIndividuals.length} walk-in ${walkInIndividuals.length === 1 ? 'individual' : 'individuals'} arrived`
        : 'No families assigned yet'
      : familiesArrived === 0
        ? walkInIndividuals.length > 0
          ? `0 families · ${walkInIndividuals.length} walk-in ${walkInIndividuals.length === 1 ? 'individual' : 'individuals'} arrived`
          : 'Nobody checked in yet'
        : familiesArrived >= familiesAssigned
          ? `All families checked in${walkInIndivNote}`
          : `${familiesAssigned - familiesArrived} not yet arrived${walkInIndivNote}`

  const assignedMembersFooter =
    totalMembers === 0
      ? 'No families assigned yet'
      : walkInMemberCount > 0 && registeredFamilies.length > 0
        ? `${registeredMemberCount} assigned (${registeredFamilies.length} ${registeredFamilies.length === 1 ? 'family' : 'families'}) + ${walkInMemberCount} non-registered`
        : walkInMemberCount > 0
          ? `${walkInMemberCount} non-registered ${walkInMemberCount === 1 ? 'occupant' : 'occupants'}`
          : familiesAssigned === 1
            ? 'Across 1 family'
            : familiesAssigned === 2
              ? `${memberCounts[0]} + ${memberCounts[1]} across both families`
              : familiesAssigned <= 4
                ? `${memberCounts.join(' + ')} across ${familiesAssigned} families`
                : `Across ${familiesAssigned} families`

  let fullCapacityNote = null
  if (isFull && !isInactive) {
    if (spacesLeft === 0 && slotsLeft === 0) {
      fullCapacityNote =
        'No people spaces or family slots left. No new family fits until someone is unassigned or capacity is increased.'
    } else if (spacesLeft === 0) {
      fullCapacityNote = `No people spaces left. ${slotsLeft} ${
        slotsLeft === 1 ? 'family slot is' : 'family slots are'
      } free, but no new family fits until the room gets more spaces.`
    } else {
      fullCapacityNote = `No family slots left. ${spacesLeft} ${
        spacesLeft === 1 ? 'people space is' : 'people spaces are'
      } free, but no new family fits until the room gets more family slots.`
    }
  }

  if (notFound) {
    return (
      <main className="ec-room-detail-page">
        <div className="ec-room-card ec-room-households-state">
          <h1>Room not found</h1>
          <p>This room may have been deleted or is unavailable.</p>
        </div>
      </main>
    )
  }

  if (!room && loading) {
    return (
      <main className="ec-room-detail-page" aria-busy="true">
        <div className="ec-room-card ec-room-households-state" role="status">
          Loading room details…
        </div>
      </main>
    )
  }

  return (
    <main className="ec-room-detail-page">
      {/* 1. Breadcrumb */}
      <Breadcrumb items={breadcrumbItems} />

      {/* 2. Header */}
      <header className="ec-room-header">
        <div className="ec-room-heading">
          <div className="ec-room-title-row">
            <h1 id="ec-room-detail-title" className="ec-room-title">
              {roomTitle}
            </h1>
            <StatusPill variant={statusPillVariant} label={statusPillLabel} />
          </div>
          <p className="ec-room-subtitle">{subtitleParts.join(' · ')}</p>
        </div>

        <div className="ec-room-header-actions">
          {onEditRoom && (
            <Button variant="secondary" onClick={() => onEditRoom(room)}>
              <FontAwesomeIcon icon={faPen} size="xs" aria-hidden="true" />
              <span>Edit room</span>
            </Button>
          )}
          {onAddHousehold && (
            <Button
              variant="primary"
              onClick={onAddHousehold}
              disabled={!isRoomAssignable}
              title={unmappedAssignReason || undefined}
            >
              <FontAwesomeIcon icon={faPlus} size="xs" aria-hidden="true" />
              <span>Add family</span>
            </Button>
          )}
        </div>
      </header>

      {/* 3. Four StatCards */}
      <section className="ec-room-stats-grid" aria-label="Room summary">
        <StatCard
          icon={faDoorOpen}
          label="Family slots"
          value={usedSlots}
          max={familySlots}
          showProgress
          progressValue={usedSlots}
          progressMax={familySlots}
          footer={familySlotsFooter}
        />
        <StatCard
          icon={faUsers}
          className={isSpacesFull ? 'ec-room-stat--danger' : ''}
          label="People spaces"
          value={usedSpaces}
          max={peopleSpaces}
          showProgress
          progressValue={usedSpaces}
          progressMax={peopleSpaces}
          footer={peopleSpacesFooter}
        />
        <StatCard
          icon={faUserCheck}
          label="Families arrived"
          value={familiesArrived}
          max={familiesAssigned}
          showProgress
          progressValue={familiesArrived}
          progressMax={Math.max(familiesAssigned, 1)}
          footer={arrivedFooter}
        />
        <StatCard
          icon={faPeopleGroup}
          label="Assigned members"
          value={totalMembers}
          showProgress={false}
          footer={assignedMembersFooter}
        />
      </section>

      {(unmappedAssignReason || fullCapacityNote) && (
        <div className="ec-room-cap-note" role="status">
          <FontAwesomeIcon
            icon={faTriangleExclamation}
            className="ec-room-cap-note-icon"
            aria-hidden="true"
          />
          <span>{unmappedAssignReason || fullCapacityNote}</span>
        </div>
      )}

      {/* 4. Families in this room (full width) */}
      <div className="ec-room-body-row">
        <section
          className="ec-room-card ec-room-families-panel"
          aria-labelledby="ec-room-families-title"
        >
          <div className="ec-room-panel-header">
            <div className="ec-room-panel-title-line">
              <h2 id="ec-room-families-title" className="ec-room-panel-title">
                Families in this room
              </h2>
              <span className="ec-room-count-badge">{families.length}</span>
            </div>
            <p className="ec-room-panel-subtitle">Manage who is assigned to {roomTitle}</p>
          </div>

          {loading ? (
            <div className="ec-room-households-state" role="status">
              Loading assigned families…
            </div>
          ) : error ? (
            <div className="ec-room-households-state" role="alert">
              <span>Could not load this room’s families.</span>
              {onRetry && (
                <Button variant="secondary" onClick={onRetry}>
                  Try again
                </Button>
              )}
            </div>
          ) : families.length === 0 ? (
            <div className="ec-room-households-empty">
              <span className="ec-room-empty-icon" aria-hidden="true">
                <FontAwesomeIcon icon={faPeopleGroup} />
              </span>
              <h3>No families assigned yet</h3>
              <p>
                {unmappedAssignReason || `Add a family to begin managing who is assigned to ${roomTitle}.`}
              </p>
              {onAddHousehold && (
                <Button
                  variant="primary"
                  onClick={onAddHousehold}
                  disabled={!isRoomAssignable}
                  title={unmappedAssignReason || undefined}
                >
                  <FontAwesomeIcon icon={faPlus} size="xs" aria-hidden="true" />
                  <span>Add family</span>
                </Button>
              )}
            </div>
          ) : (
            <div className="ec-room-family-list" role="list">
              {families.map((family, index) => {
                const id = family.family_id ?? family.id ?? `family-${index}`
                const name = family.head_name || family.household_head_name || 'Unnamed family'
                const initials =
                  name
                    .split(/\s+/)
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((part) => part[0].toUpperCase())
                    .join('') || 'FM'
                const members = Number(
                  family.member_count || family.family_members || family.assigned_members || 1
                )
                const arrived = Boolean(family.is_checked_in)
                const isNonReg = Boolean(family.is_non_registered)
                const isIndivWalkIn = isNonReg && (family.is_individual || members === 1)

                return (
                  <div key={id} className="ec-room-family-row" role="listitem">
                    <button
                      type="button"
                      className="ec-room-family-main"
                      onClick={() => setFamilyToView(family)}
                      aria-label={`View members of ${name}`}
                    >
                      <span className="ec-room-family-avatar" aria-hidden="true">
                        {initials}
                      </span>
                      <span className="ec-room-family-copy">
                        <span className="ec-room-family-name">{name}</span>
                        <span className="ec-room-family-meta">
                          <span>
                            {members} {members === 1 ? 'member' : 'members'}
                          </span>
                          {isNonReg && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="ec-room-arrival-pill">
                                Non-registered
                              </span>
                            </>
                          )}
                          <span aria-hidden="true">·</span>
                          <span
                            className={`ec-room-arrival-pill ${arrived ? 'is-arrived' : 'is-not-arrived'}`}
                          >
                            {arrived ? 'Arrived' : 'Not arrived'}
                          </span>
                        </span>
                      </span>
                    </button>

                    {onUnassignHousehold && !isNonReg && (
                      <Button
                        variant="danger-outline"
                        onClick={() => onUnassignHousehold(family)}
                        aria-label={`Unassign ${name} from ${roomTitle}`}
                      >
                        Unassign
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>

      {familyToView && (
        <HouseholdMembersModal
          family={familyToView}
          onClose={() => setFamilyToView(null)}
          onUnassign={
            onUnassignHousehold && !familyToView?.is_non_registered
              ? () => {
                  setFamilyToView(null)
                  onUnassignHousehold(familyToView)
                }
              : undefined
          }
        />
      )}
    </main>
  )
}

function HouseholdMembersModal({ family, onClose, onReassign, onUnassign }) {
  const familyId = family?.family_id ?? family?.id
  const hasNumericId = familyId != null && Number.isFinite(Number(familyId))
  const familyQuery = useFamily(hasNumericId ? familyId : null, { enabled: hasNumericId })
  const details = familyQuery.data?.family || familyQuery.data || family
  const members = Array.isArray(details?.members) ? details.members : []
  const householdName = family.household_head_name || family.head_name || 'Family'

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  return (
    <div
      className="ec-household-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="ec-household-members-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ec-household-members-title"
      >
        <header className="ec-household-members-header">
          <div>
            <h2 id="ec-household-members-title">{householdName}</h2>
            <p>
              {family?.is_non_registered
                ? 'Non-registered evacuee (on-site)'
                : 'Family members'}
            </p>
          </div>
          <button type="button" className="ec-household-modal-close" onClick={onClose} aria-label="Close members dialog">
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </header>
        <div className="ec-household-members-content">
          {familyQuery.isLoading ? (
            <p className="ec-household-members-state" role="status">Loading members…</p>
          ) : familyQuery.isError ? (
            <p className="ec-household-members-state" role="alert">Could not load this family’s members. Close and try again.</p>
          ) : members.length === 0 ? (
            <p className="ec-household-members-state">No member details are available for this family.</p>
          ) : (
            <ul className="ec-household-members-list">
              {members.map((member, index) => {
                const memberName = [member.first_name, member.middle_name, member.last_name, member.suffix]
                  .filter(Boolean)
                  .join(' ') || member.name || `Member ${index + 1}`
                const relationship = member.is_head_of_family
                  ? 'Family head'
                  : familyTerm(member.relationship_to_head || 'Family member')
                return (
                  <li className="ec-household-member-item" key={member.id ?? `${memberName}-${index}`}>
                    <span className="ec-household-member-avatar" aria-hidden="true">
                      {memberName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('') || 'M'}
                    </span>
                    <span className="ec-household-member-copy">
                      <strong>{memberName}</strong>
                      <span>{relationship}{member.gender ? ` · ${member.gender}` : ''}</span>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <footer className="ec-household-members-footer">
          <span>{members.length} {members.length === 1 ? 'member' : 'members'}</span>
          <div className="ec-household-members-footer-actions">
            {onReassign && (
              <button type="button" className="ec-household-reassign-btn" onClick={onReassign}>
                <FontAwesomeIcon icon={faRightLeft} />
                Reassign
              </button>
            )}
            {onUnassign && (
              <button type="button" className="ec-household-unassign-btn" onClick={onUnassign}>
                Unassign family
              </button>
            )}
            <button type="button" className="ec-btn-secondary-action" onClick={onClose}>Close</button>
          </div>
        </footer>
      </section>
    </div>
  )
}

export function StructureTab({
  center,
  rooms = [],
  buildings = [],
  centerFamilies = [],
  onAddBuilding,
  onAddRoom,
  onOpenRoom,
  onEditRoom,
  onOpenBuilding,
  onAssignHousehold,
  onEditCenter,
}) {
  const structureMode = resolveCenterStructureMode(center)
  const isSingleVenue = structureMode === 'open_area'
  const isPrivateProperty = structureMode === 'rooms_only'
  const canAddBuilding = structureMode === 'buildings_and_rooms'
  const canAddRoom = !isSingleVenue

  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all') // 'all' | 'available' | 'full'
  const [buildingFilter, setBuildingFilter] = useState('all')
  const [floorFilter, setFloorFilter] = useState('all')

  const centerAssigned = Number(
    center?.assigned ?? center?.total_assigned ?? center?.occupied ?? 0
  )
  const centerCapacity = Number(center?.capacity || 0)
  const centerAvailable = Math.max(centerCapacity - centerAssigned, 0)
  const roomFamilyCount = centerFamilies.length || rooms.reduce((count, room) => {
    const families = room?.families || room?.assigned_families
    return count + (Array.isArray(families) ? families.length : 0)
  }, 0)
  const assignedHouseholds = Number(center?.household_assigned ?? roomFamilyCount)
  const averageHouseholdSize = assignedHouseholds > 0
    ? Math.max(1, centerAssigned / assignedHouseholds)
    : null
  const roomCapacityUsage = (room) => {
    const slots = Math.max(1, Number(room?.family_slots ?? 5))
    const spaces = Math.max(1, Number(room?.people_spaces ?? room?.capacity ?? 25))
    const usedSlots = Number(room?.used_slots ?? roomHouseholdAssigned(room))
    const usedSpaces = Number(room?.used_spaces ?? room?.assigned ?? room?.occupied ?? 0)
    return {
      slots,
      spaces,
      usedSlots,
      usedSpaces,
      full: Boolean(room?.is_full) || usedSlots >= slots || usedSpaces >= spaces,
      over: Boolean(room?.is_over_capacity) || usedSlots > slots || usedSpaces > spaces,
      percent: Math.min(100, Math.round(Math.max(usedSlots / slots, usedSpaces / spaces) * 100)),
    }
  }
  const familiesByRoom = useMemo(() => {
    const map = new Map()
    centerFamilies.forEach((family) => {
      if (family?.room_id == null) return
      const roomId = String(family.room_id)
      const key = String(family.family_id ?? family.id ?? family.family_code ?? family.head_name)
      if (!map.has(roomId)) map.set(roomId, new Map())
      map.get(roomId).set(key, family)
    })
    return map
  }, [centerFamilies])
  const roomFamilyRecords = (room) => familiesByRoom.get(String(room?.id))
  const roomHouseholdAssigned = (room) => {
    const familyRecords = roomFamilyRecords(room)
    return familyRecords
      ? familyRecords.size
      : getRoomHouseholdCount(room, averageHouseholdSize)
  }
  const roomHouseholdArrived = (room) => {
    const familyRecords = roomFamilyRecords(room)
    return familyRecords
      ? Array.from(familyRecords.values()).filter((family) => family?.is_checked_in).length
      : getRoomArrivedHouseholdCount(room)
  }

  // Filter helper
  const isRoomMatching = useCallback(
    (room) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const name = String(room?.room_number || `Room #${room?.id || ''}`).toLowerCase()
        const floorName = formatFloorLabel(room?.floor).toLowerCase()
        if (!name.includes(q) && !floorName.includes(q)) return false
      }
      if (floorFilter === 'unset' && room?.floor != null) return false
      if (floorFilter !== 'all' && floorFilter !== 'unset' && String(room?.floor ?? '') !== floorFilter) return false
      if (statusFilter !== 'all') {
        const usage = roomCapacityUsage(room)
        const st = usage.full ? 'full' : usage.usedSlots === 0 && usage.usedSpaces === 0 ? 'empty' : 'available'
        if (statusFilter === 'available' && st === 'full') return false
        if (statusFilter === 'full' && st !== 'full') return false
      }
      return true
    },
    [searchQuery, statusFilter, floorFilter, averageHouseholdSize, familiesByRoom]
  )

  const groups = useMemo(() => {
    if (isSingleVenue) return []

    if (isPrivateProperty || buildings.length === 0) {
      return [{ building: null, rooms }]
    }

    const buildingMap = new Map()
    buildings.forEach((b) =>
      buildingMap.set(String(b.id), { building: b, rooms: [] })
    )
    buildingMap.set('unassigned', { building: null, rooms: [] })

    rooms.forEach((room) => {
      const bid = room.building_id != null ? String(room.building_id) : 'unassigned'
      const group = buildingMap.get(bid) || buildingMap.get('unassigned')
      group.rooms.push(room)
    })

    return Array.from(buildingMap.entries())
      .filter(([, v]) => v.building || v.rooms.length > 0)
      .sort((a, b) => {
        if (a[0] === 'unassigned') return 1
        if (b[0] === 'unassigned') return -1
        const nameA = a[1].building?.name || ''
        const nameB = b[1].building?.name || ''
        return nameA.localeCompare(nameB)
      })
      .map(([, v]) => v)
  }, [isSingleVenue, isPrivateProperty, rooms, buildings])

  const filteredGroups = useMemo(() => {
    if (buildingFilter === 'all') return groups
    return groups.filter(({ building }) =>
      String(building?.id ?? 'unassigned') === buildingFilter
    )
  }, [groups, buildingFilter])
  const selectedRooms = (buildingFilter === 'all'
    ? rooms
    : filteredGroups.flatMap((group) => group.rooms)).filter((room) => floorFilter === 'all' || String(room.floor ?? '') === floorFilter)
  const displayedCapacity = selectedRooms.reduce((sum, room) => sum + roomCapacityUsage(room).slots, 0)
  const displayedAssigned = selectedRooms.reduce((sum, room) => sum + roomCapacityUsage(room).usedSlots, 0)
  const householdCapacityForView = displayedCapacity || (buildingFilter === 'all' ? Number(center?.family_slots || 0) : 0)
  const householdAssignedForView = displayedAssigned || (buildingFilter === 'all' ? Number(center?.used_slots || 0) : 0)
  const householdsAvailableForView = Math.max(0, householdCapacityForView - householdAssignedForView)
  const roomStatus = (room) => {
    const usage = roomCapacityUsage(room)
    if (usage.full) return 'full'
    return usage.usedSlots === 0 && usage.usedSpaces === 0 ? 'empty' : 'available'
  }
  const availableCount = selectedRooms.filter((room) => roomStatus(room) !== 'full').length
  const fullCount = selectedRooms.filter((room) => roomStatus(room) === 'full').length
  const totalMatchingRooms = selectedRooms.filter(isRoomMatching).length

  if (isSingleVenue) {
    return (
      <div className="ec-structure-card">
        <div className="ec-structure-header">
          <h3 className="ec-structure-title">Center Structure</h3>
        </div>

        <div className="ec-single-venue-content">
          <div className="ec-single-venue-hero">
            <div className="ec-single-venue-icon-circle">
              <FontAwesomeIcon icon={faBuildingColumns} />
            </div>
            <div className="ec-single-venue-hero-text">
              <h4 className="ec-single-venue-name">{center?.name || 'Open Unified Facility'}</h4>
              <p className="ec-single-venue-desc">
                This center is configured as a single open venue. No individual rooms or separate buildings are required. Families are assigned and managed directly to the center.
              </p>
            </div>
          </div>

          <div className="ec-single-venue-metrics">
            <div className="ec-svm-card">
              <span className="ec-svm-label">Venue Capacity</span>
              <span className="ec-svm-value">{centerCapacity}</span>
            </div>
            <div className="ec-svm-card">
              <span className="ec-svm-label">Assigned Evacuees</span>
              <span className="ec-svm-value">{centerAssigned}</span>
            </div>
            <div className="ec-svm-card">
              <span className="ec-svm-label">Available Capacity</span>
              <span className="ec-svm-value is-available">{centerAvailable}</span>
            </div>
          </div>

          <div className="ec-single-venue-actions">
            {onAssignHousehold && (
              <button type="button" className="ec-btn-primary" onClick={onAssignHousehold}>
                <FontAwesomeIcon icon={faPlus} size="xs" />
                <span>Assign Family</span>
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
      </div>
    )
  }

  return (
    <div className="ec-structure-card">
      <div className="ec-structure-header"><h3 className="ec-structure-title">Center Structure</h3>
        <div className="ec-structure-actions">
          {canAddBuilding && onAddBuilding && (
            <button className="ec-btn-primary" type="button" onClick={onAddBuilding}>
              <FontAwesomeIcon icon={faPlus} /> Add building
            </button>
          )}
          {isPrivateProperty && onAddRoom && (
            <button className="ec-btn-primary" type="button" onClick={onAddRoom}>
              <FontAwesomeIcon icon={faPlus} /> Add room
            </button>
          )}
        </div>
      </div>
      <div className="ec-structure-summary-strip"><div className="ec-ss-tile"><span className="ec-ss-label">Total rooms</span><span className="ec-ss-value">{selectedRooms.length}</span></div><div className="ec-ss-tile"><span className="ec-ss-label">Assigned families</span><span className="ec-ss-value">{householdAssignedForView}</span></div><div className="ec-ss-tile"><span className="ec-ss-label">Available families</span><span className="ec-ss-value is-available">{householdsAvailableForView ?? '—'}</span></div></div>
      <div className="ec-structure-toolbar ec-structure-toolbar-sticky">
        <div className="ec-toolbar-left"><div className="ec-search-box"><FontAwesomeIcon icon={faSearch} className="ec-search-icon" /><input className="ec-search-input" placeholder="Search rooms..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} aria-label="Search rooms" /></div>
          {buildings.length > 0 && <label className="ec-building-filter"><span>Building</span><select value={buildingFilter} onChange={(e) => { setBuildingFilter(e.target.value); setFloorFilter('all') }}><option value="all">All buildings</option>{buildings.map(b => <option key={b.id} value={String(b.id)}>{b.name}</option>)}{rooms.some(r=>r.building_id==null)&&<option value="unassigned">Unassigned rooms</option>}</select></label>}
          {buildings.some(b=>Number(b.floors||1)>1)&&<label className="ec-building-filter"><span>Floor</span><select value={floorFilter} onChange={e=>setFloorFilter(e.target.value)}><option value="all">All floors</option>{Array.from(new Set([...buildings.flatMap(b=>Array.from({length:Number(b.floors||1)},(_,i)=>i+1)),...rooms.map(r=>r.floor).filter(f=>f!=null)])).sort((a,b)=>a-b).map(f=><option key={f} value={String(f)}>{formatFloorLabel(f)}</option>)}</select></label>}
          <div className="ec-status-filter-group">{[['all','All',selectedRooms.length],['available','Available',availableCount],['full','Full',fullCount]].map(([v,l,n])=><button key={v} type="button" className={'ec-filter-pill '+(statusFilter===v?'is-active':'')} onClick={()=>setStatusFilter(v)}>{l}<span className="ec-filter-count">{n}</span></button>)}</div>
        </div>
      </div>
      {canAddBuilding ? (
        <div className="ec-structure-building-overview">
          {buildings.some((b) => !b?.is_mapped) && (
            <div className="ec-room-cap-note" role="status" style={{ marginBottom: '12px' }}>
              <FontAwesomeIcon
                icon={faTriangleExclamation}
                className="ec-room-cap-note-icon"
                aria-hidden="true"
              />
              <span>
                {buildings.filter((b) => !b?.is_mapped).length} of {buildings.length}{' '}
                {buildings.length === 1 ? 'building is' : 'buildings are'} not mapped on the map yet.
                Families cannot be assigned to rooms in unmapped buildings until they are placed on the map.
              </span>
            </div>
          )}
          <div className="ec-building-cards">
            {filteredGroups.filter(({ building }) => Boolean(building)).map(({ building, rooms: groupRooms }) => {
              const matching = groupRooms.filter(isRoomMatching)
              if (!matching.length && (searchQuery.trim() || statusFilter !== 'all' || floorFilter !== 'all')) return null
              const slots = matching.reduce((sum, room) => sum + roomCapacityUsage(room).slots, 0)
              const spaces = matching.reduce((sum, room) => sum + roomCapacityUsage(room).spaces, 0)
              const usedSlots = matching.reduce((sum, room) => sum + roomCapacityUsage(room).usedSlots, 0)
              const usedSpaces = matching.reduce((sum, room) => sum + roomCapacityUsage(room).usedSpaces, 0)
              const availableRooms = matching.filter((room) => roomStatus(room) !== 'full').length
              const progress = Math.min(100, Math.round(Math.max(usedSlots / Math.max(slots, 1), usedSpaces / Math.max(spaces, 1)) * 100))
              const status = building.status || 'open'
              const statusLabel = status === 'under_repair' ? 'Under repair' : status === 'closed' ? 'Closed' : 'Open'
              const isBuildingMapped = Boolean(building.is_mapped)
              return (
                <article className="ec-building-card" key={building.id}>
                  <button type="button" className="ec-building-card-main" onClick={() => onOpenBuilding?.(building)}>
                    <span className="ec-building-card-top">
                      <strong className="ec-building-card-title">{building.name}</strong>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        {!isBuildingMapped && (
                          <StatusPill variant="unmapped" label="Not mapped" />
                        )}
                        <span className={'ec-sb-status-pill is-' + status}><span className="ec-sb-status-dot" />{statusLabel}</span>
                      </span>
                    </span>
                    <span className="ec-building-card-meta">{Number(building.floors || 1)} {Number(building.floors || 1) === 1 ? 'floor' : 'floors'} · {matching.length} {matching.length === 1 ? 'room' : 'rooms'} · Slots {usedSlots}/{slots} · Spaces {usedSpaces}/{spaces}</span>
                    <span className="ec-building-card-progress"><span style={{ width: progress + '%' }} /></span>
                    <span className="ec-building-card-footer"><span>{availableRooms} {availableRooms === 1 ? 'room' : 'rooms'} available</span><span>{matching.filter((room) => roomCapacityUsage(room).over).length} over capacity</span></span>
                  </button>
                </article>
              )
            })}
          </div>
          {filteredGroups.filter(({ building }) => !building).map(({ rooms: unassignedRooms }) => {
            const visibleRooms = unassignedRooms.filter(isRoomMatching)
            if (!visibleRooms.length) return null
            return <section className="ec-unassigned-rooms-section" key="unassigned"><h3>Unassigned rooms · {visibleRooms.length}</h3><div className="ec-room-tile-grid">{visibleRooms.map((room, index) => <RoomCard key={room.id} room={room} averageHouseholdSize={averageHouseholdSize} householdAssigned={roomHouseholdAssigned(room)} householdArrived={roomHouseholdArrived(room)} index={index} onEditRoom={onEditRoom} onOpenRoom={onOpenRoom} />)}</div></section>
          })}
          {filteredGroups.filter(({ building }) => Boolean(building)).length === 0 && <EmptyState icon={faBuilding} title="No buildings yet" text="Add a building first, then add rooms inside it." />}
        </div>
      ) : !selectedRooms.length ? <EmptyState icon={faDoorOpen} title="No rooms yet" text="Use Add to create the first room." /> : !totalMatchingRooms ? <EmptyState icon={faSearch} title="No rooms found" text="No rooms match your filters." /> : (
        <div className="ec-room-tile-grid">{selectedRooms.filter(isRoomMatching).sort((a, b) => Number(roomStatus(a) === 'full') - Number(roomStatus(b) === 'full')).map((room, index) => <RoomCard key={room.id} room={room} averageHouseholdSize={averageHouseholdSize} householdAssigned={roomHouseholdAssigned(room)} householdArrived={roomHouseholdArrived(room)} index={index} onEditRoom={onEditRoom} onOpenRoom={onOpenRoom} />)}</div>
      )}
    </div>
  )
}

export function HouseholdsTab({
  center,
  centerFamilies = [],
  loading = false,
  error = null,
  onRetry,
  rooms = [],
  buildings = [],
  onMove,
  onUnassign,
}) {
  const structureMode = resolveCenterStructureMode(center)
  const isOpenArea = structureMode === 'open_area'
  const showBuildingSub = structureMode === 'buildings_and_rooms'
  const [searchTerm, setSearchTerm] = useState('')
  const [familyToView, setFamilyToView] = useState(null)
  const centerIdKey = center?.id ?? null
  const [paginationState, setPaginationState] = useState({ centerId: centerIdKey, page: 1 })
  const [pageSize, setPageSize] = useState(10)

  const setCurrentPage = useCallback(
    (nextPageOrUpdater) => {
      setPaginationState((prev) => {
        const basePage = prev.centerId === centerIdKey ? prev.page : 1
        const nextPage =
          typeof nextPageOrUpdater === 'function'
            ? nextPageOrUpdater(basePage)
            : nextPageOrUpdater
        return { centerId: centerIdKey, page: nextPage }
      })
    },
    [centerIdKey]
  )

  const buildingById = useMemo(() => {
    const map = new Map()
    buildings.forEach((b) => map.set(String(b.id), b.name))
    return map
  }, [buildings])

  const roomBuildingMap = useMemo(() => {
    const map = new Map()
    rooms.forEach((r) => {
      const building = buildings.find((item) => String(item.id) === String(r.building_id))
      const bName = r.building?.name || building?.name || (r.building_id != null ? buildingById.get(String(r.building_id)) : null)
      const floorLabel = Number(building?.floors || r.building?.floors || 1) > 1 ? formatFloorLabel(r.floor) : ''
      const locationLabel = [bName, floorLabel].filter(Boolean).join(' · ')
      if (locationLabel) {
        if (r.id != null) map.set(String(r.id), locationLabel)
        if (r.room_number) map.set(String(r.room_number).toLowerCase(), locationLabel)
      }
    })
    return map
  }, [rooms, buildings, buildingById])

  const totalMembers = centerFamilies.reduce(
    (sum, f) => sum + Number(f.member_count || f.family_members || 1),
    0
  )
  const arrivedCount = centerFamilies.filter((f) => f.is_checked_in).length

  const filteredFamilies = useMemo(() => {
    if (!searchTerm.trim()) return centerFamilies
    const q = searchTerm.toLowerCase().trim()
    return centerFamilies.filter((fam) => {
      const headName = fam.household_head_name || fam.head_name || ''
      return headName.toLowerCase().includes(q)
    })
  }, [centerFamilies, searchTerm])

  const totalPages = Math.max(1, Math.ceil(filteredFamilies.length / pageSize))
  const currentPage = paginationState.centerId === centerIdKey ? paginationState.page : 1
  const safePage = Math.min(currentPage, totalPages)
  const pageStart = filteredFamilies.length === 0 ? 0 : (safePage - 1) * pageSize + 1
  const pageEnd = Math.min(safePage * pageSize, filteredFamilies.length)

  const paginatedFamilies = useMemo(() => {
    const start = (safePage - 1) * pageSize
    return filteredFamilies.slice(start, start + pageSize)
  }, [filteredFamilies, safePage, pageSize])

  const paginationItems = useMemo(() => {
    if (totalPages <= 5) {
      return Array.from({ length: totalPages }, (_, i) => i + 1)
    }
    const pages = Array.from(
      new Set(
        [1, totalPages, safePage - 1, safePage, safePage + 1].filter(
          (p) => p >= 1 && p <= totalPages
        )
      )
    ).sort((a, b) => a - b)

    const items = []
    for (let i = 0; i < pages.length; i += 1) {
      const p = pages[i]
      const prev = pages[i - 1]
      if (i > 0) {
        if (p - prev === 2) {
          items.push(prev + 1)
        } else if (p - prev > 2) {
          items.push(`ellipsis-${prev}`)
        }
      }
      items.push(p)
    }
    return items
  }, [totalPages, safePage])

  return (
    <div className="ec-households-card">
      <div className="ec-households-card-header">
        <div className="ec-households-title-line">
          <h2 className="ec-households-card-title">Families</h2>
          <span className="ec-households-meta-line">
            {totalMembers} individuals · {centerFamilies.length} {centerFamilies.length === 1 ? 'family' : 'families'} · {arrivedCount} arrived
          </span>
        </div>

        <div className="ec-search-box">
          <FontAwesomeIcon icon={faSearch} className="ec-search-icon" />
          <input
            type="text"
            className="ec-search-input"
            placeholder="Search family..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value)
              setCurrentPage(1)
            }}
          />
        </div>
      </div>

      {loading ? (
        <EmptyState
          icon={faPeopleGroup}
          title="Loading families..."
          text="Fetching families assigned to this evacuation center."
        />
      ) : error ? (
        <EmptyState
          icon={faTriangleExclamation}
          title="Could not load families"
          text={error.message || 'The server took too long to respond. Please try again.'}
          action={
            onRetry ? (
              <Button variant="secondary" size="sm" onClick={onRetry}>
                Retry
              </Button>
            ) : null
          }
        />
      ) : filteredFamilies.length === 0 ? (
        <EmptyState
          icon={faPeopleGroup}
          title={centerFamilies.length === 0 ? 'No families assigned' : 'No matching families'}
          text={
            centerFamilies.length === 0
              ? 'Families assigned to this evacuation center will appear here.'
              : 'Try searching with a different family head name.'
          }
        />
      ) : (
        <>
          <table className="ec-modern-table">
            <thead>
              <tr>
                <th scope="col" className="ec-col-family">FAMILY</th>
                <th scope="col" className="ec-col-location">{isOpenArea ? 'CENTER' : 'ROOM'}</th>
                <th scope="col" className="ec-col-members">MEMBERS</th>
                <th scope="col" className="ec-col-status">STATUS</th>
                <th scope="col" className="ec-col-actions">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {paginatedFamilies.map((fam, idx) => {
                const famKey =
                  fam.id ?? fam.family_id ?? fam.family_code ?? fam.resident_id ?? `fam-${idx}`
                const headName = fam.household_head_name || fam.head_name || 'Unnamed'
                const initials =
                  headName
                    .split(' ')
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((n) => n[0].toUpperCase())
                    .join('') || 'HH'
                const memberCount = fam.member_count || fam.family_members || 1
                const isCheckedIn = Boolean(fam.is_checked_in)
                const roomRaw = !isOpenArea ? (fam.room_number || (fam.room_id ? `Room ${fam.room_id}` : null)) : null
                const hasRoom = Boolean(roomRaw && roomRaw !== 'Not assigned')

                let buildingName = null
                if (hasRoom && showBuildingSub) {
                  if (fam.room_id != null && roomBuildingMap.has(String(fam.room_id))) {
                    buildingName = roomBuildingMap.get(String(fam.room_id))
                  } else if (roomBuildingMap.has(String(roomRaw).toLowerCase())) {
                    buildingName = roomBuildingMap.get(String(roomRaw).toLowerCase())
                  }
                }

                return (
                  <tr
                    key={famKey}
                    className="ec-table-row ec-family-click-row"
                    tabIndex={0}
                    aria-label={`View members of ${headName}`}
                    onClick={() => setFamilyToView(fam)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setFamilyToView(fam)
                      }
                    }}
                  >
                    <td data-label="FAMILY" className="ec-col-family">
                      <button
                        type="button"
                        className="ec-household-view-btn"
                        onClick={(event) => {
                          event.stopPropagation()
                          setFamilyToView(fam)
                        }}
                        aria-label={`View members of ${headName}`}
                      >
                        <div className="ec-household-user-cell">
                          <div className="ec-avatar-circle" aria-hidden="true">
                            {initials}
                          </div>
                          <div className="ec-household-text">
                            <span className="ec-household-name" title={headName}>{headName}</span>
                            <span className="ec-household-role">
                              {fam.is_non_registered
                                ? fam.is_individual
                                  ? 'Non-registered · Individual'
                                  : 'Non-registered · Family'
                                : 'Family Head'}
                            </span>
                          </div>
                        </div>
                      </button>
                    </td>
                    <td data-label={isOpenArea ? 'CENTER' : 'ROOM'} className="ec-col-location">
                      {isOpenArea ? (
                        <span className="ec-hh-room-name">{center?.name || 'Evacuation Center'}</span>
                      ) : hasRoom ? (
                        <div className="ec-hh-room-cell">
                          <span className="ec-hh-room-name">{roomRaw}</span>
                          {buildingName && (
                            <span className="ec-hh-building-sub">{buildingName}</span>
                          )}
                        </div>
                      ) : (
                        <span className="ec-room-pill is-unassigned">Not assigned</span>
                      )}
                    </td>
                    <td data-label="MEMBERS" className="ec-col-members">
                      <span className="ec-members-chip">
                        <FontAwesomeIcon icon={faUsers} />
                        <span>{memberCount}</span>
                      </span>
                    </td>
                    <td data-label="STATUS" className="ec-col-status">
                      {isCheckedIn ? (
                        <span className="ec-status-pill is-arrived">
                          <span className="ec-status-dot is-arrived" />
                          <span>Arrived</span>
                        </span>
                      ) : (
                        <span className="ec-status-pill is-not-arrived">
                          <span className="ec-status-dot is-not-arrived" />
                          <span>Not arrived</span>
                        </span>
                      )}
                    </td>
                    <td data-label="ACTIONS" className="ec-col-actions">
                      {fam.family_id != null && (
                        <div className="ec-household-actions">
                          {onMove && (
                            <button
                              type="button"
                              className="ec-household-action-btn"
                              onClick={(event) => {
                                event.stopPropagation()
                                onMove(fam)
                              }}
                              title="Reassign family"
                              aria-label={`Reassign ${headName}`}
                            >
                              <FontAwesomeIcon icon={faRightLeft} aria-hidden="true" />
                            </button>
                          )}
                          {onUnassign && (
                            <button
                              type="button"
                              className="ec-household-action-btn is-danger"
                              onClick={(event) => {
                                event.stopPropagation()
                                onUnassign(fam)
                              }}
                              title="Unassign family"
                              aria-label={`Unassign ${headName}`}
                            >
                              <FontAwesomeIcon icon={faUserMinus} aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <nav className="ec-pagination" aria-label="Families pagination">
            <span className="ec-pagination-info">
              Showing {pageStart}–{pageEnd} of {filteredFamilies.length}{' '}
              {filteredFamilies.length === 1 ? 'family' : 'families'}
            </span>

            <div className="ec-pagination-controls">
              <label className="ec-pagination-size">
                <span className="ec-pagination-size-label">Rows per page</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value))
                    setCurrentPage(1)
                  }}
                  aria-label="Rows per page"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                </select>
              </label>

              <button
                type="button"
                className="ec-page-nav-btn"
                disabled={safePage <= 1}
                onClick={() => setCurrentPage(Math.max(1, safePage - 1))}
                aria-label="Previous page"
              >
                <FontAwesomeIcon icon={faChevronLeft} aria-hidden="true" />
                <span>Previous</span>
              </button>

              {totalPages > 1 && (
                <div className="ec-pagination-pages">
                  {paginationItems.map((item) =>
                    typeof item === 'string' ? (
                      <span key={item} className="ec-pagination-ellipsis" aria-hidden="true">
                        …
                      </span>
                    ) : (
                      <button
                        key={item}
                        type="button"
                        className={`ec-page-num-btn ${item === safePage ? 'is-active' : ''}`}
                        aria-label={`Page ${item}`}
                        aria-current={item === safePage ? 'page' : undefined}
                        onClick={() => setCurrentPage(item)}
                      >
                        {item}
                      </button>
                    )
                  )}
                </div>
              )}

              <span className="ec-pagination-page-compact">
                Page {safePage} of {totalPages}
              </span>

              <button
                type="button"
                className="ec-page-nav-btn"
                disabled={safePage >= totalPages}
                onClick={() => setCurrentPage(Math.min(totalPages, safePage + 1))}
                aria-label="Next page"
              >
                <span>Next</span>
                <FontAwesomeIcon icon={faChevronRight} aria-hidden="true" />
              </button>
            </div>
          </nav>
        </>
      )}
      {familyToView && (
        <HouseholdMembersModal
          family={familyToView}
          onClose={() => setFamilyToView(null)}
          onReassign={onMove ? () => {
            setFamilyToView(null)
            onMove(familyToView)
          } : undefined}
          onUnassign={onUnassign ? () => {
            setFamilyToView(null)
            onUnassign(familyToView)
          } : undefined}
        />
      )}
    </div>
  )
}

function cleanActivityDescription(action = '') {
  let cleaned = String(action)
    .replace(/\s*\([A-Z0-9_-]{5,}\)/gi, '')
    .replace(/\bChecked in\b/g, 'Arrived')
    .replace(/\bchecked in\b/g, 'arrived')
    .replace(/\bCheck in\b/g, 'Arrive')
    .replace(/\bcheck in\b/g, 'arrive')
  return cleaned.trim()
}

function formatDayHeading(dateString) {
  return formatManilaRelativeDay(dateString, { month: 'short', day: 'numeric' }, 'Recent')
}

function getWhoDidIt(log) {
  if (log.user_name) {
    const role = log.user_role
      ? log.user_role === 'lgu_personnel'
        ? 'Staff'
        : log.user_role.charAt(0).toUpperCase() + log.user_role.slice(1)
      : 'Staff'
    return `by ${log.user_name} · ${role}`
  }
  return 'by System'
}

export function ActivityTab({ center }) {
  const [typeFilter, setTypeFilter] = useState('all')
  const [centerLogs, setCenterLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [visibleCount, setVisibleCount] = useState(20)

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
            return (
              act.includes(cName) ||
              act.includes('evacuation center') ||
              act.includes('assigned family') ||
              act.includes('unassigned')
            )
          })
          setCenterLogs(matched.length > 0 ? matched : allLogs.slice(0, 30))
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

  const assignmentsCount = useMemo(() => {
    return centerLogs.filter((l) => (l.action || '').toLowerCase().includes('assign')).length
  }, [centerLogs])

  const updatesCount = useMemo(() => {
    return centerLogs.filter((l) => !(l.action || '').toLowerCase().includes('assign')).length
  }, [centerLogs])

  const filteredLogs = useMemo(() => {
    if (typeFilter === 'assignments') {
      return centerLogs.filter((l) => (l.action || '').toLowerCase().includes('assign'))
    }
    if (typeFilter === 'updates') {
      return centerLogs.filter((l) => !(l.action || '').toLowerCase().includes('assign'))
    }
    return centerLogs
  }, [centerLogs, typeFilter])

  const visibleLogs = useMemo(() => {
    return filteredLogs.slice(0, visibleCount)
  }, [filteredLogs, visibleCount])

  const groupedLogs = useMemo(() => {
    const groups = []
    let currentGroup = null

    visibleLogs.forEach((log) => {
      const heading = formatDayHeading(log.timestamp)
      if (!currentGroup || currentGroup.heading !== heading) {
        currentGroup = { heading, logs: [log] }
        groups.push(currentGroup)
      } else {
        currentGroup.logs.push(log)
      }
    })

    return groups
  }, [visibleLogs])

  const handleExportCsv = () => {
    if (!filteredLogs || filteredLogs.length === 0) return

    const headers = ['Date & time', 'Type', 'Description', 'Done by', 'Role']

    const escapeCsv = (val) => {
      if (val == null) return '""'
      const str = String(val).replace(/"/g, '""')
      return `"${str}"`
    }

    const rows = filteredLogs.map((log) => {
      const dt = log.timestamp
        ? formatManilaDateTime(
          log.timestamp,
          {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          },
          'Recent',
        )
        : 'Recent'
      const isAssign = (log.action || '').toLowerCase().includes('assign')
      const type = isAssign ? 'Assignment' : 'Update'
      const desc = cleanActivityDescription(log.action || '')
      const staffName = log.user_name || (log.user_id ? 'Staff' : 'System')
      const role = log.user_role
        ? log.user_role === 'lgu_personnel'
          ? 'Staff'
          : log.user_role.charAt(0).toUpperCase() + log.user_role.slice(1)
        : log.user_name
          ? 'Staff'
          : 'System'

      return [
        escapeCsv(dt),
        escapeCsv(type),
        escapeCsv(desc),
        escapeCsv(staffName),
        escapeCsv(role),
      ].join(',')
    })

    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const centerSlug = (center?.name || 'center')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
    const dateSlug = new Date().toISOString().split('T')[0]
    a.href = url
    a.download = `activity-log-${centerSlug}-${dateSlug}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="ec-activity-card">
      <div className="ec-activity-card-header">
        <h3 className="ec-activity-card-title">Activity & Audit Log</h3>

        <div className="ec-activity-controls">
          <div className="ec-segmented-control" role="radiogroup">
            <button
              type="button"
              role="radio"
              aria-checked={typeFilter === 'all'}
              className={`ec-segment-btn ${typeFilter === 'all' ? 'is-active' : ''}`}
              onClick={() => {
                setTypeFilter('all')
                setVisibleCount(20)
              }}
            >
              <span>All</span>
              <span className="ec-segment-count">{centerLogs.length}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={typeFilter === 'assignments'}
              className={`ec-segment-btn ${typeFilter === 'assignments' ? 'is-active' : ''}`}
              onClick={() => {
                setTypeFilter('assignments')
                setVisibleCount(20)
              }}
            >
              <span>Assignments</span>
              <span className="ec-segment-count">{assignmentsCount}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={typeFilter === 'updates'}
              className={`ec-segment-btn ${typeFilter === 'updates' ? 'is-active' : ''}`}
              onClick={() => {
                setTypeFilter('updates')
                setVisibleCount(20)
              }}
            >
              <span>Updates</span>
              <span className="ec-segment-count">{updatesCount}</span>
            </button>
          </div>

          <button
            type="button"
            className="ec-btn-export-csv"
            onClick={handleExportCsv}
            disabled={filteredLogs.length === 0}
            title={filteredLogs.length === 0 ? 'No activity to export' : 'Export shown logs to CSV'}
          >
            <FontAwesomeIcon icon={faDownload} size="xs" />
            <span>Export CSV</span>
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
            <h4 className="ec-activity-empty-title">No Activity Recorded Yet</h4>
            <p className="ec-activity-empty-text">
              Family allocations, transfers, and detail updates for <strong>{center?.name || 'this center'}</strong> will appear here.
            </p>
          </div>
        ) : (
          <div className="ec-activity-timeline-wrap">
            {groupedLogs.map((group) => (
              <div key={group.heading} className="ec-activity-day-group">
                <div className="ec-activity-day-heading">{group.heading}</div>
                <div className="ec-activity-list" role="list">
                  {group.logs.map((log) => {
                    const desc = cleanActivityDescription(log.action || '')
                    const when = log.timestamp
                      ? formatManilaTime(
                        log.timestamp,
                        {
                          hour: '2-digit',
                          minute: '2-digit',
                        },
                        'Recent',
                      )
                      : 'Recent'
                    const isAssign = (log.action || '').toLowerCase().includes('assign')
                    const isDanger =
                      (log.action || '').toLowerCase().includes('delete') ||
                      (log.action || '').toLowerCase().includes('remov')

                    return (
                      <div key={log.id} className="ec-activity-item" role="listitem">
                        <div
                          className={`ec-activity-bullet ${isAssign ? 'is-assign' : isDanger ? 'is-danger' : 'is-info'}`}
                          aria-hidden="true"
                        >
                          <FontAwesomeIcon icon={isAssign ? faUsers : faClockRotateLeft} />
                        </div>
                        <div className="ec-activity-item-content">
                          <div className="ec-activity-item-top">
                            <span className="ec-activity-desc">{desc}</span>
                            <span className="ec-activity-time">{when}</span>
                          </div>
                          <span className="ec-activity-by">{getWhoDidIt(log)}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}

            {filteredLogs.length > visibleCount && (
              <div className="ec-activity-load-more-wrap">
                <button
                  type="button"
                  className="ec-btn-load-more"
                  onClick={() => setVisibleCount((prev) => prev + 20)}
                >
                  Load more
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faPlus,
  faBuilding,
  faHouse,
  faLock,
  faCircleCheck,
  faTriangleExclamation,
  faCircleStop,
  faCircleXmark,
  faXmark,
  faSearch,
  faChevronRight,
  faList,
  faTableCellsLarge,
} from '@fortawesome/free-solid-svg-icons'

import { Building2, MapPin, MapPinOff } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { centerStatus, isCenterMapped, resolveCenterStructureMode } from './utils'
import { statusVariant } from './evacuationStatus'
import { StatCard, StatusPill, ProgressBar, Button, MobileFilterButton } from '../ui'
import './CenterList.css'

export function AnimatedCount({ value, duration = 400 }) {
  const [displayValue, setDisplayValue] = useState(0)
  const prevValueRef = useRef(0)

  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const target = Number(value || 0)

    if (prefersReduced) {
      prevValueRef.current = target
      return
    }

    const start = prevValueRef.current
    if (start === target) {
      return
    }

    const startTime = performance.now()
    let frameId

    const update = (now) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const easeProgress = progress * (2 - progress)
      const current = Math.round(start + (target - start) * easeProgress)
      setDisplayValue(current)

      if (progress < 1) {
        frameId = requestAnimationFrame(update)
      } else {
        setDisplayValue(target)
        prevValueRef.current = target
      }
    }

    frameId = requestAnimationFrame(update)
    return () => {
      cancelAnimationFrame(frameId)
      prevValueRef.current = target
    }
  }, [value, duration])

  const prefersReduced =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  return <span>{prefersReduced ? Number(value || 0) : displayValue}</span>
}

function getCenterTypeIcon(props) {
  const mode = resolveCenterStructureMode(props)
  if (mode === 'open_area') return faHouse
  if (mode === 'rooms_only') return faLock
  return faBuilding
}

function getCenterTypeText(cen) {
  const savedTypeName = String(cen.center_type_name || '').trim()
  if (savedTypeName) return savedTypeName

  const typeCode = String(cen.center_type || '').trim().toLowerCase()
  const knownTypes = {
    campus: 'Campus / Multi-Building',
    single_venue: 'Single Venue',
    private_property: 'Private Property',
  }
  if (knownTypes[typeCode]) return knownTypes[typeCode]
  return (
    typeCode
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'Center'
  )
}

function getCenterStatusMeta(feature, props, arrived, assigned, cap) {
  const mapped = isCenterMapped(feature) || isCenterMapped(props) || Boolean(props.has_map)
  if (!mapped) {
    return { mapped: false, key: 'unmapped', variant: 'unmapped', label: 'Unmapped' }
  }
  const st = centerStatus(props, arrived, assigned, cap)
  const isFull = st === 'Full' || (cap > 0 && assigned >= cap)
  if (isFull) {
    return { mapped: true, key: 'full', variant: 'full', label: 'Full' }
  }
  return { mapped: true, key: 'available', variant: 'available', label: 'Available' }
}

function getOccupancyToneClass(assigned, cap) {
  if (cap <= 0) return ''
  const pct = (assigned / cap) * 100
  if (pct >= 100) return 'is-danger'
  if (pct >= 80) return 'is-warn'
  return 'is-primary'
}

export default function CenterList({
  centers,
  barangays = [],
  onRefresh,
  onAddCenter,
  onRowOpen,
  onBarangayChange,
  loading = false,
  error = '',
  className = '',
}) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [searchQuery, setSearchQuery] = useState('')
  const [barangayFilter, setBarangayFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [quickFilter, setQuickFilter] = useState('all')
  const [viewMode, setViewMode] = useState('table')
  const [isNarrowViewport, setIsNarrowViewport] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 720px)').matches
      : false
  )

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const mql = window.matchMedia('(max-width: 720px)')
    const syncViewport = (e) => setIsNarrowViewport(e.matches)
    mql.addEventListener('change', syncViewport)
    return () => mql.removeEventListener('change', syncViewport)
  }, [])

  const effectiveViewMode = isNarrowViewport ? 'cards' : viewMode

  const barangayOptions = useMemo(() => {
    return barangays.map((b) => ({
      id: String(typeof b === 'object' && b !== null ? b.id : b),
      name:
        typeof b === 'object' && b !== null
          ? b.name || b.title || String(b.id)
          : String(b),
    }))
  }, [barangays])

  const selectedBarangayName = useMemo(() => {
    if (!barangayFilter) return ''
    const match = barangayOptions.find((opt) => opt.id === String(barangayFilter))
    return match ? match.name : ''
  }, [barangayFilter, barangayOptions])

  const handleBarangaySelect = useCallback(
    (e) => {
      const val = e.target.value ? String(e.target.value) : ''
      setBarangayFilter(val)
      onBarangayChange?.(val)
    },
    [onBarangayChange]
  )

  const allFeatures = useMemo(() => {
    if (Array.isArray(centers?.features)) return centers.features
    if (Array.isArray(centers)) return centers
    return []
  }, [centers])

  const counts = useMemo(() => {
    let mapped = 0
    let unmapped = 0
    allFeatures.forEach((feature) => {
      const props = feature?.properties || feature || {}
      const isMapped = isCenterMapped(feature) || isCenterMapped(props) || Boolean(props.has_map)
      if (isMapped) mapped += 1
      else unmapped += 1
    })
    return {
      all: allFeatures.length,
      mapped,
      unmapped,
    }
  }, [allFeatures])

  const isLoading = loading || centers == null

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return allFeatures.filter((feature) => {
      const props = feature?.properties || feature || {}
      const name = String(props.name || '').toLowerCase()
      const brgyList = Array.isArray(props.barangays) ? props.barangays : []
      const brgyNames = brgyList
        .map((b) => (typeof b === 'string' ? b : b?.name || b))
        .join(' ')
        .toLowerCase()

      if (q && !name.includes(q) && !brgyNames.includes(q)) return false

      if (barangayFilter) {
        const matched = brgyList.some((b) => {
          if (typeof b === 'object' && b !== null) {
            return (
              String(b.id) === String(barangayFilter) ||
              (selectedBarangayName &&
                String(b.name || '').toLowerCase() === selectedBarangayName.toLowerCase())
            )
          }
          return (
            String(b) === String(barangayFilter) ||
            (selectedBarangayName &&
              String(b).toLowerCase() === selectedBarangayName.toLowerCase())
          )
        })
        if (!matched && String(props.barangay_id) !== String(barangayFilter)) return false
      }

      const cap = Number(props.capacity || 0)
      const assigned = Number(props.assigned || 0)
      const arrived = Number(props.occupied || 0)
      const statusMeta = getCenterStatusMeta(feature, props, arrived, assigned, cap)

      if (quickFilter === 'mapped' && !statusMeta.mapped) return false
      if (quickFilter === 'unmapped' && statusMeta.mapped) return false

      if (statusFilter !== 'all' && statusMeta.key !== statusFilter) return false

      return true
    })
  }, [allFeatures, searchQuery, barangayFilter, selectedBarangayName, quickFilter, statusFilter])

  const hasActiveFilters =
    Boolean(searchQuery.trim()) ||
    Boolean(barangayFilter) ||
    statusFilter !== 'all' ||
    quickFilter !== 'all'

  const handleClearFilters = useCallback(() => {
    setSearchQuery('')
    setBarangayFilter('')
    onBarangayChange?.('')
    setStatusFilter('all')
    setQuickFilter('all')
  }, [onBarangayChange])

  const handleRetry = useCallback(() => {
    onRefresh?.()
  }, [onRefresh])

  const handleOpenCenter = useCallback(
    (e, feature) => {
      e.preventDefault()
      onRowOpen?.(feature)
    },
    [onRowOpen]
  )

  const renderOccupancy = (assigned, arrived, cap) => {
    const hasCapacity = cap > 0
    const assignedPct = hasCapacity ? Math.round((assigned / cap) * 100) : 0
    const toneClass = getOccupancyToneClass(assigned, cap)

    if (!hasCapacity) {
      return (
        <div className="ec-occ-stack">
          <div className="ec-occ-top">
            <span className="ec-occ-primary">
              <strong>{assigned}</strong> assigned
            </span>
            <span className="ec-occ-nocap">No capacity set</span>
          </div>
          <div className="ec-occ-dashed-bar" aria-label="No capacity set" />
          <span className="ec-occ-sub">{arrived} on-site now</span>
        </div>
      )
    }

    return (
      <div className="ec-occ-stack">
        <div className="ec-occ-top">
          <span className="ec-occ-primary">
            <strong>{assigned}</strong> of {cap} assigned
          </span>
          <span className={`ec-occ-pct ${toneClass}`}>{assignedPct}%</span>
        </div>
        <ProgressBar value={assigned} max={cap} ariaLabel={`${assigned} of ${cap} assigned`} />
        <span className="ec-occ-sub">{arrived} on-site now</span>
      </div>
    )
  }

  return (
    <section className={`ec-list-page ${className}`.trim()}>
      {/* 1. Header */}
      <header className="ec-list-header">
        <div className="ec-list-title-group">
          <h1 className="ec-list-title">Evacuation Centers</h1>
          <p className="ec-list-subtitle">
            Check shelter capacity, building readiness, and live arrivals across the municipality.
          </p>
        </div>
        {isAdmin && onAddCenter && (
          <div className="ec-list-controls">
            <Button variant="primary" onClick={onAddCenter} aria-label="Add Center">
              <FontAwesomeIcon icon={faPlus} aria-hidden="true" />
              <span>Add Center</span>
            </Button>
          </div>
        )}
      </header>

      {/* 2. Clickable StatCards (All, Mapped, Unmapped) */}
      {isLoading ? (
        <div className="ec-stats-grid" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, idx) => (
            <div key={idx} className="ec-skel-stat-card">
              <div className="ec-skel-stat-top">
                <span className="ds-skeleton ec-skel-stat-tile" />
                <span className="ds-skeleton ec-skel-stat-label" />
              </div>
              <span className="ds-skeleton ec-skel-stat-value" />
              <span className="ds-skeleton ec-skel-stat-helper" />
            </div>
          ))}
        </div>
      ) : (
        <section className="ec-stats-grid" aria-label="Filter evacuation centers by mapping status">
          <StatCard
            icon={Building2}
            iconTone="primary"
            label="All"
            value={counts.all}
            showProgress={false}
            helper="Total centers"
            active={quickFilter === 'all'}
            onClick={() => setQuickFilter('all')}
          />
          <StatCard
            icon={MapPin}
            tint="success"
            label="Mapped"
            value={counts.mapped}
            showProgress={false}
            helper="On the map"
            active={quickFilter === 'mapped'}
            onClick={() => setQuickFilter('mapped')}
          />
          <StatCard
            icon={MapPinOff}
            iconTone="neutral"
            label="Unmapped"
            value={counts.unmapped}
            showProgress={false}
            helper="Needs a location"
            active={quickFilter === 'unmapped'}
            onClick={() => setQuickFilter('unmapped')}
          />
        </section>
      )}

      {/* 3. Main white card */}
      <div className="ec-list-card">
        {/* 3a. Toolbar row */}
        <div className="ec-list-toolbar" role="toolbar" aria-label="Evacuation centers filters and view">
          <div className="ec-list-search">
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search center or barangay..."
              ariaLabel="Search centers"
            />
          </div>

          <MobileFilterButton
            activeCount={(barangayFilter ? 1 : 0) + (statusFilter !== 'all' ? 1 : 0)}
            title="Filter centers"
            onReset={() => {
              setBarangayFilter('')
              onBarangayChange?.('')
              setStatusFilter('all')
            }}
          >
            <label className="ui-mobile-filter-field">
              <span className="ui-mobile-filter-field__label">Barangay</span>
              <select
                value={barangayFilter}
                onChange={handleBarangaySelect}
                aria-label="Filter by barangay"
              >
                <option value="">All Barangays</option>
                {barangayOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="ui-mobile-filter-field">
              <span className="ui-mobile-filter-field__label">Status</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter by status"
              >
                <option value="all">All Statuses</option>
                <option value="available">Available</option>
                <option value="full">Full</option>
                <option value="unmapped">Unmapped</option>
              </select>
            </label>
          </MobileFilterButton>

          <select
            className="ec-toolbar-select-native"
            value={barangayFilter}
            onChange={handleBarangaySelect}
            aria-label="Filter by barangay"
          >
            <option value="">All Barangays</option>
            {barangayOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.name}
              </option>
            ))}
          </select>

          <select
            className="ec-toolbar-select-native"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
          >
            <option value="all">All Statuses</option>
            <option value="available">Available</option>
            <option value="full">Full</option>
            <option value="unmapped">Unmapped</option>
          </select>

          <div className="ec-toolbar-spacer" aria-hidden="true" />

          {!isNarrowViewport && (
            <div className="ec-view-segmented" role="group" aria-label="Display mode">
              <button
                type="button"
                className={`ec-view-seg-btn ${effectiveViewMode === 'table' ? 'is-active' : ''}`}
                aria-pressed={effectiveViewMode === 'table'}
                onClick={() => setViewMode('table')}
              >
                <FontAwesomeIcon icon={faList} aria-hidden="true" />
                <span>Table</span>
              </button>
              <button
                type="button"
                className={`ec-view-seg-btn ${effectiveViewMode === 'cards' ? 'is-active' : ''}`}
                aria-pressed={effectiveViewMode === 'cards'}
                onClick={() => setViewMode('cards')}
              >
                <FontAwesomeIcon icon={faTableCellsLarge} aria-hidden="true" />
                <span>Cards</span>
              </button>
            </div>
          )}
        </div>

        {/* Body: Loading / Error / Empty / Table or Cards */}
        {isLoading ? (
          <SkeletonRows count={5} />
        ) : error ? (
          <div className="ec-list-state" role="alert" aria-live="polite">
            <div className="ec-empty-icon-tile" aria-hidden="true">
              <FontAwesomeIcon icon={faBuilding} />
            </div>
            <h2 className="ec-empty-heading">Couldn't load centers</h2>
            <p className="ec-empty-copy">Check your connection and try again.</p>
            <Button variant="primary" onClick={handleRetry}>
              Retry
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="ec-list-state">
            <div className="ec-empty-icon-tile" aria-hidden="true">
              <FontAwesomeIcon icon={faBuilding} />
            </div>
            <h2 className="ec-empty-heading">No centers found</h2>
            <p className="ec-empty-copy">
              {hasActiveFilters
                ? 'No evacuation centers match your current search or filters.'
                : 'Add an evacuation center to start tracking shelter capacity.'}
            </p>
            {hasActiveFilters && (
              <Button variant="secondary" onClick={handleClearFilters}>
                Clear filters
              </Button>
            )}
          </div>
        ) : effectiveViewMode === 'table' ? (
          <div className="ec-grid-table-scroll">
            <div className="ec-grid-table" role="table" aria-label="Evacuation centers">
              {/* 3b. Table header */}
              <div className="ec-grid-header" role="rowgroup">
                <div className="ec-grid-header-row" role="row">
                  <div className="ec-grid-th" role="columnheader">CENTER</div>
                  <div className="ec-grid-th" role="columnheader">BARANGAY</div>
                  <div className="ec-grid-th" role="columnheader">OCCUPANCY</div>
                  <div className="ec-grid-th" role="columnheader">STATUS</div>
                  <div className="ec-grid-th" role="columnheader" aria-hidden="true" />
                </div>
              </div>

              {/* 3c. Rows */}
              <div className="ec-grid-body" role="rowgroup">
                {filtered.map((feature) => {
                  const props = feature?.properties || feature || {}
                  const id = props.id
                  const name = props.name || 'Unnamed Center'
                  const typeText = getCenterTypeText(props)
                  const typeIcon = getCenterTypeIcon(props)
                  const brgyList = Array.isArray(props.barangays) ? props.barangays : []
                  const brgyShown = brgyList.slice(0, 2).map((b, i) => ({
                    id: typeof b === 'string' ? `${b}-${i}` : b?.id ?? i,
                    name: typeof b === 'string' ? b : b?.name || String(b),
                  }))
                  const extraBrgy = Math.max(0, brgyList.length - 2)
                  const allBrgyNames = brgyList
                    .map((b) => (typeof b === 'string' ? b : b?.name || b))
                    .filter(Boolean)
                    .join(', ')

                  const cap = Number(props.capacity || 0)
                  const assigned = Number(props.assigned || 0)
                  const arrived = Number(props.occupied || 0)
                  const statusMeta = getCenterStatusMeta(feature, props, arrived, assigned, cap)

                  return (
                    <a
                      key={id}
                      href={`#center-${encodeURIComponent(id ?? '')}`}
                      className="ec-grid-row"
                      role="row"
                      aria-label={`Open ${name}`}
                      onClick={(e) => handleOpenCenter(e, feature)}
                    >
                      {/* CENTER */}
                      <div className="ec-cell-center" role="cell">
                        <span
                          className={`ec-center-icon-tile ${statusMeta.mapped ? 'is-mapped' : 'is-unmapped'}`}
                          aria-hidden="true"
                        >
                          <FontAwesomeIcon icon={typeIcon} />
                        </span>
                        <div className="ec-center-copy">
                          <span className="ec-center-name" title={name}>
                            {name}
                          </span>
                          <span className="ec-center-type">{typeText}</span>
                        </div>
                      </div>

                      {/* BARANGAY */}
                      <div className="ec-cell-barangay" role="cell" title={allBrgyNames || undefined}>
                        <div className="ec-brgy-row">
                          {brgyShown.map((b) => (
                            <span key={b.id} className="ec-brgy-pill" title={b.name}>
                              {b.name}
                            </span>
                          ))}
                          {extraBrgy > 0 && (
                            <span className="ec-brgy-pill ec-brgy-pill--more" title={allBrgyNames}>
                              +{extraBrgy}
                            </span>
                          )}
                          {brgyShown.length === 0 && <span className="ec-brgy-empty">—</span>}
                        </div>
                      </div>

                      {/* OCCUPANCY */}
                      <div className="ec-cell-occupancy" role="cell">
                        {renderOccupancy(assigned, arrived, cap)}
                      </div>

                      {/* STATUS */}
                      <div className="ec-cell-status" role="cell">
                        <StatusPill variant={statusMeta.variant} label={statusMeta.label} />
                      </div>

                      {/* CHEVRON */}
                      <div className="ec-cell-chevron" role="cell" aria-hidden="true">
                        <FontAwesomeIcon icon={faChevronRight} className="ec-row-chevron" />
                      </div>
                    </a>
                  )
                })}
              </div>
            </div>
          </div>
        ) : (
          /* 4. Cards View */
          <div className="ec-cards-grid" role="list" aria-label="Evacuation centers">
            {filtered.map((feature) => {
              const props = feature?.properties || feature || {}
              const id = props.id
              const name = props.name || 'Unnamed Center'
              const typeText = getCenterTypeText(props)
              const typeIcon = getCenterTypeIcon(props)
              const brgyList = Array.isArray(props.barangays) ? props.barangays : []
              const brgyShown = brgyList.slice(0, 2).map((b, i) => ({
                id: typeof b === 'string' ? `${b}-${i}` : b?.id ?? i,
                name: typeof b === 'string' ? b : b?.name || String(b),
              }))
              const extraBrgy = Math.max(0, brgyList.length - 2)
              const allBrgyNames = brgyList
                .map((b) => (typeof b === 'string' ? b : b?.name || b))
                .filter(Boolean)
                .join(', ')

              const cap = Number(props.capacity || 0)
              const assigned = Number(props.assigned || 0)
              const arrived = Number(props.occupied || 0)
              const statusMeta = getCenterStatusMeta(feature, props, arrived, assigned, cap)

              return (
                <a
                  key={id}
                  href={`#center-${encodeURIComponent(id ?? '')}`}
                  className="ec-center-card"
                  role="listitem"
                  aria-label={`Open ${name}`}
                  onClick={(e) => handleOpenCenter(e, feature)}
                >
                  <div className="ec-center-card__top">
                    <div className="ec-cell-center">
                      <span
                        className={`ec-center-icon-tile ${statusMeta.mapped ? 'is-mapped' : 'is-unmapped'}`}
                        aria-hidden="true"
                      >
                        <FontAwesomeIcon icon={typeIcon} />
                      </span>
                      <div className="ec-center-copy">
                        <span className="ec-center-name" title={name}>
                          {name}
                        </span>
                        <span className="ec-center-type">{typeText}</span>
                      </div>
                    </div>
                    <FontAwesomeIcon icon={faChevronRight} className="ec-row-chevron" aria-hidden="true" />
                  </div>

                  <div className="ec-center-card__meta">
                    <div className="ec-brgy-row" title={allBrgyNames || undefined}>
                      {brgyShown.map((b) => (
                        <span key={b.id} className="ec-brgy-pill" title={b.name}>
                          {b.name}
                        </span>
                      ))}
                      {extraBrgy > 0 && (
                        <span className="ec-brgy-pill ec-brgy-pill--more" title={allBrgyNames}>
                          +{extraBrgy}
                        </span>
                      )}
                      {brgyShown.length === 0 && <span className="ec-brgy-empty">—</span>}
                    </div>
                    <StatusPill variant={statusMeta.variant} label={statusMeta.label} />
                  </div>

                  <div className="ec-center-card__occ">
                    {renderOccupancy(assigned, arrived, cap)}
                  </div>
                </a>
              )
            })}
          </div>
        )}

        {/* 3d. Footer */}
        <footer className="ec-list-footer">
          Showing {filtered.length} of {allCentersCount(allFeatures)} centers
        </footer>
      </div>
    </section>
  )
}

function allCentersCount(list) {
  return Array.isArray(list) ? list.length : 0
}

export function SearchInput({ value, onChange, placeholder, ariaLabel }) {
  const handleChange = (e) => onChange(e.target.value)
  const handleClear = () => onChange('')
  return (
    <div className="si-wrap" role="search" aria-label={ariaLabel}>
      <span className="si-icon" aria-hidden="true">
        <FontAwesomeIcon icon={faSearch} size="xs" />
      </span>
      <input
        className="si-input"
        type="search"
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        aria-label={ariaLabel}
        spellCheck={false}
        autoComplete="off"
      />
      {value && (
        <button
          type="button"
          className="si-clear"
          onClick={handleClear}
          aria-label="Clear search"
          title="Clear search"
        >
          <FontAwesomeIcon icon={faXmark} size="xs" />
        </button>
      )}
    </div>
  )
}

export function EmptyState({ icon, title = 'No data available', text, action, actionLabel, className = '' }) {
  return (
    <div
      className={`es-empty ${className}`.trim()}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '48px 24px',
        gap: '12px',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      {icon && (
        <div
          className="es-icon-box"
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            backgroundColor: 'var(--primary-50, #EFF4FF)',
            color: 'var(--primary, #2563EB)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '20px',
            marginBottom: '4px',
          }}
        >
          <FontAwesomeIcon icon={icon} className="es-icon" aria-hidden="true" />
        </div>
      )}
      <h2
        className="es-title"
        style={{
          margin: 0,
          fontFamily: 'var(--font-display, inherit)',
          fontSize: '16px',
          fontWeight: 600,
          color: 'var(--text, #0F172A)',
        }}
      >
        {title}
      </h2>
      {text && (
        <p
          className="es-text"
          style={{
            margin: 0,
            fontSize: '14px',
            color: 'var(--muted, #5B6B82)',
            maxWidth: '420px',
            lineHeight: 1.5,
          }}
        >
          {text}
        </p>
      )}
      {action && actionLabel && (
        <Button variant="primary" onClick={action} style={{ marginTop: '8px' }}>
          {actionLabel}
        </Button>
      )}
    </div>
  )
}

export function OccupancyBar({ assigned = 0, capacity = 0, showLabel = true, className = '' }) {
  const cap = Math.max(0, capacity || 0)
  const as = Math.max(0, Math.min(assigned || 0, cap))
  const occupancy = cap > 0 ? as / cap : 0
  const pctAssigned = cap > 0 ? Math.round(occupancy * 100) : 0
  const hasData = cap > 0
  if (!hasData) {
    return (
      <div className={`ob-empty ${className}`.trim()} role="text" aria-label="Occupancy: no capacity set">
        —
      </div>
    )
  }
  const label = showLabel ? `${as} of ${cap} assigned, ${pctAssigned}%` : `${as} of ${cap} assigned`
  return (
    <div className={`ob-wrap ${className}`.trim()} role="group" aria-label={label}>
      {showLabel && <span className="ob-label">{label}</span>}
      <ProgressBar value={as} max={cap} />
    </div>
  )
}

export function Skeleton({ variant = 'line', count = 3, width, className = '' }) {
  if (variant === 'card') {
    return (
      <div className={`sk-card ${className}`.trim()} aria-hidden="true">
        <div className="ds-skeleton ds-skeleton--card" />
      </div>
    )
  }
  if (variant === 'table-row') {
    return (
      <div className={`sk-table ${className}`.trim()} role="table" aria-label="Loading rows" aria-busy="true">
        <div className="sk-row" role="rowgroup">
          {Array.from({ length: count }).map((_, i) => (
            <div key={i} className="sk-row-line" role="row">
              {[0, 1, 2].map((j) => (
                <div key={j} className="sk-cell" role="cell">
                  <div className="ds-skeleton ds-skeleton--text" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    )
  }
  return (
    <div className={`sk-line ${className}`.trim()} aria-hidden="true">
      <div className="ds-skeleton" style={{ height: '12px', width: width ?? '100%' }} />
    </div>
  )
}

export function SkeletonRows({ count = 5 }) {
  return (
    <div className="ec-grid-table-scroll" aria-busy="true" aria-label="Loading evacuation centers">
      <div className="ec-grid-table">
        <div className="ec-grid-header">
          <div className="ec-grid-header-row">
            <div className="ec-grid-th">CENTER</div>
            <div className="ec-grid-th">BARANGAY</div>
            <div className="ec-grid-th">OCCUPANCY</div>
            <div className="ec-grid-th">STATUS</div>
            <div className="ec-grid-th" aria-hidden="true" />
          </div>
        </div>
        <div className="ec-grid-body">
          {Array.from({ length: count }).map((_, i) => (
            <div key={i} className="ec-grid-row ec-grid-row--skeleton" aria-hidden="true">
              <div className="ec-cell-center">
                <span className="ds-skeleton ec-sk-icon" />
                <div className="ec-center-copy">
                  <span className="ds-skeleton ec-sk-name" />
                  <span className="ds-skeleton ec-sk-sub" />
                </div>
              </div>
              <div className="ec-cell-barangay">
                <div className="ec-brgy-row">
                  <span className="ds-skeleton ec-sk-pill" />
                  <span className="ds-skeleton ec-sk-pill ec-sk-pill--sm" />
                </div>
              </div>
              <div className="ec-cell-occupancy">
                <div className="ec-occ-stack">
                  <span className="ds-skeleton ec-sk-occ-label" />
                  <span className="ds-skeleton ec-sk-bar" />
                  <span className="ds-skeleton ec-sk-occ-sub" />
                </div>
              </div>
              <div className="ec-cell-status">
                <span className="ds-skeleton ec-sk-status" />
              </div>
              <div className="ec-cell-chevron" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const ICONS = {
  Available: faCircleCheck,
  'Near full': faTriangleExclamation,
  Full: faCircleStop,
  Closed: faCircleXmark,
}

export function StatusBadge({ status = 'Available', className = '' }) {
  const variant = statusVariant(status)
  const Icon = ICONS[status] || faCircleCheck
  return (
    <span
      className={`sb-badge ds-badge ds-badge--${variant} ${className}`.trim()}
      title={status}
      aria-label={status}
    >
      <FontAwesomeIcon icon={Icon} size="xs" className="sb-icon" />
      {status}
    </span>
  )
}

function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter((p) => p.length > 0)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase()
}

const SIZE = { small: 28, medium: 'var(--control-height)', large: 48 }
export function Avatar({ name, size = 'medium', className = '' }) {
  const dim = SIZE[size] ?? SIZE.medium
  const label = initials(name)
  return (
    <span
      className={`av-avatar av-avatar--${size} ${className}`.trim()}
      style={{ width: dim, height: dim }}
      aria-label={name ? `Avatar for ${name}` : undefined}
      title={name || undefined}
    >
      {label}
    </span>
  )
}

export function SegmentedControl({ options = [], value, onChange, ariaLabel }) {
  const handleSelect = (optionValue) => {
    if (optionValue !== value) onChange(optionValue)
  }
  return (
    <div className="sc-root" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const active = value === option.value
        return (
          <button
            type="button"
            key={option.value}
            role="radio"
            aria-checked={active}
            className={`sc-button ${active ? 'sc-button--active' : ''}`}
            onClick={() => handleSelect(option.value)}
          >
            {option.icon && <FontAwesomeIcon icon={option.icon} size="xs" className="sc-icon" />}
            <span className="sc-label">{option.label}</span>
            {option.count != null && <span className="sc-count">{option.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

const TONE_BG = {
  neutral: 'var(--neutral-soft)',
  safe: 'var(--success-bg)',
  warning: 'var(--warn-bg)',
  danger: 'var(--danger-bg)',
}
const TONE_TEXT = {
  neutral: 'var(--muted)',
  safe: 'var(--success-fg)',
  warning: 'var(--warn-fg)',
  danger: 'var(--danger-fg)',
}

export function Tag({ label, tone = 'neutral', className = '' }) {
  return (
    <span
      className={`ds-chip tag tag--${tone} ${className}`.trim()}
      style={{
        backgroundColor: TONE_BG[tone] ?? TONE_BG.neutral,
        color: TONE_TEXT[tone] ?? TONE_TEXT.neutral,
      }}
    >
      {label}
    </span>
  )
}

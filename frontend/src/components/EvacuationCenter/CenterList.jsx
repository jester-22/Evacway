import { useState, useMemo, useCallback } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faPlus, faRotate, faBuilding, faCircleCheck, faTriangleExclamation,
  faCircleStop, faMapPin, faBan, faPen, faLocationDot,
  faFilter, faXmark, faSearch, faHome, faWarehouse,
  faCircleXmark, faDrawPolygon,
} from '@fortawesome/free-solid-svg-icons'

import { useAuth } from '../../context/AuthContext'
import { centerStatus, centerNeedsMapping, isCenterMapped } from './utils'
import { statusVariant } from './evacuationStatus'
import { FloatingMenuTrigger } from './FloatingMenu'
import './CenterList.css'


const FILTER_CARDS = [
  { key: 'all', label: 'All Centers', icon: faBuilding, colorToken: 'brand', countKey: 'all' },
  { key: 'available', label: 'Available', icon: faCircleCheck, colorToken: 'success', countKey: 'available' },
  { key: 'near-full', label: 'Near Full', icon: faTriangleExclamation, colorToken: 'warning', countKey: 'near-full' },
  { key: 'full', label: 'Full', icon: faCircleStop, colorToken: 'danger', countKey: 'full' },
  { key: 'needs-mapping', label: 'Needs Mapping', icon: faMapPin, colorToken: 'neutral', countKey: 'needs-mapping' },
]

const STATUS_BY_KEY = {
  available: 'Available',
  'near-full': 'Near full',
  full: 'Full',
}

const COLOR_TOKEN_MAP = {
  brand: { bg: 'brand-soft', border: 'brand', text: 'brand', dot: 'brand' },
  success: { bg: 'success-soft', border: 'success', text: 'success', dot: 'success' },
  warning: { bg: 'warning-soft', border: 'warning', text: 'warning', dot: 'warning' },
  danger: { bg: 'danger-soft', border: 'danger', text: 'danger', dot: 'danger' },
  neutral: { bg: 'neutral-soft', border: 'neutral', text: 'neutral', dot: 'neutral' },
}

export default function CenterList({
  centers,
  barangays = [],
  onRefresh,
  onAddCenter,
  onEdit,
  onViewMap,
  onAddRooms,
  onDeactivate,
  canDeactivate,
  onRowOpen,
  onBarangayChange,
  onPlaceOnMap,
  loading = false,
  error = '',
  className = '',
}) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [searchQuery, setSearchQuery] = useState('')
  const [barangayFilter, setBarangayFilter] = useState('')
  const [quickFilter, setQuickFilter] = useState('all')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [barangayLocal, setBarangayLocal] = useState('')

  const allCenters = useMemo(() => {
    const features = Array.isArray(centers?.features) ? centers.features : Array.isArray(centers) ? centers : []
    return features.map((f) => f.properties || f)
  }, [centers])

  const counts = useMemo(() => {
    const c = { all: allCenters.length, available: 0, 'near-full': 0, full: 0, 'needs-mapping': 0 }
    allCenters.forEach((cen) => {
      const props = cen.properties || cen
      const mapped = Boolean(props.has_map)
      if (!mapped) c['needs-mapping'] += 1
      const st = centerStatus(
        cen,
        Number(cen.occupied || 0),
        Number(cen.assigned || 0),
        Number(cen.capacity || 0)
      )
      if (st === 'Available') c.available += 1
      else if (st === 'Near full') c['near-full'] += 1
      else if (st === 'Full') c.full += 1
    })
    return c
  }, [allCenters])

  const activeFilterCount =
    (searchQuery.trim() ? 1 : 0) +
    (barangayFilter ? 1 : 0) +
    (quickFilter !== 'all' ? 1 : 0)

  const isLoading = loading || centers == null

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return allCenters.filter((cen) => {
      const props = cen.properties || cen
      const name = String(props.name || '').toLowerCase()
      const brgyNames = (Array.isArray(props.barangays) ? props.barangays : [])
        .map((b) => (typeof b === 'string' ? b : b.name || b))
        .join(' ')
        .toLowerCase()
      if (q && !name.includes(q) && !brgyNames.includes(q)) return false
      if (barangayFilter) {
        const ids = (Array.isArray(props.barangays) ? props.barangays : []).map(
          (b) => (typeof b === 'string' ? b : b.id)
        )
        if (!ids.includes(barangayFilter)) return false
      }
      if (quickFilter === 'needs-mapping') {
        if (!centerNeedsMapping(props)) return false
      } else if (quickFilter !== 'all') {
        const st = centerStatus(
          props,
          Number(props.occupied || 0),
          Number(props.assigned || 0),
          Number(props.capacity || 0)
        )
        if (st !== STATUS_BY_KEY[quickFilter]) return false
      }
      return true
    })
  }, [allCenters, searchQuery, barangayFilter, quickFilter])

  const handleRefresh = useCallback(() => {
    onRefresh?.()
  }, [onRefresh])

  const handleClearFilters = useCallback(() => {
    setSearchQuery('')
    setBarangayFilter('')
    setQuickFilter('all')
  }, [])

  const handleRetry = useCallback(() => {
    onRefresh?.()
  }, [onRefresh])

  const handleRowOpen = useCallback(
    (feature) => {
      onRowOpen?.(feature)
    },
    [onRowOpen]
  )

  const handleRowKeyDown = useCallback(
    (e, feature) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        handleRowOpen(feature)
      }
    },
    [handleRowOpen]
  )

  const structureText = useCallback((cen) => {
    const buildingCount = Number(cen.building_count || 0)
    const roomCount = Number(cen.room_count || cen.total_rooms || 0)
    if (buildingCount <= 1) {
      return roomCount > 0 ? `${roomCount} room${roomCount !== 1 ? 's' : ''}` : 'Single venue'
    }
    return `${buildingCount} building${buildingCount !== 1 ? 's' : ''} · ${roomCount} room${roomCount !== 1 ? 's' : ''}`
  }, [])

  const structureIcon = useCallback((cen) => {
    const buildingCount = Number(cen.building_count || 0)
    const roomCount = Number(cen.room_count || cen.total_rooms || 0)
    if (buildingCount <= 1) {
      return roomCount > 0 ? faHome : faWarehouse
    }
    return faBuilding
  }, [])

  const kebabItems = useCallback(
    (feature) => {
      const props = feature.properties || feature
      const mapped = isCenterMapped(props)
      const items = [
        { label: 'View on map', icon: faLocationDot, onClick: () => onViewMap?.(props) },
      ]
      if (!mapped) {
        items.push({ label: 'Place on map', icon: faDrawPolygon, onClick: () => onPlaceOnMap?.(props) })
      }
      if (isAdmin) {
        items.unshift({ label: 'Edit', icon: faPen, onClick: () => onEdit?.(props) })
        items.splice(1, 0, { label: 'Add rooms', onClick: () => onAddRooms?.(props) })
        if (canDeactivate) {
          items.push({
            label: 'Deactivate center',
            danger: true,
            onClick: () => onDeactivate?.(props),
          })
        }
      }
      return items
    },
    [isAdmin, canDeactivate, onEdit, onViewMap, onAddRooms, onDeactivate, onPlaceOnMap]
  )

  return (
    <section className={`ec-list-page ${className}`.trim()}>
      <header className="ec-list-header">
        <div className="ec-list-title-group">
          <h2 className="ec-list-title">Evacuation Centers</h2>
          <p className="ec-list-subtitle">
            Check shelter capacity, building readiness, and live check-ins across the municipality.
          </p>
        </div>
        <div className="ec-list-controls">
          
          {isAdmin && onAddCenter && (
            <button type="button" className="ds-btn ds-btn--primary" onClick={onAddCenter}>
              <FontAwesomeIcon icon={faPlus} /> Add Center
            </button>
          )}
        </div>
      </header>

      <div className="ec-filter-cards" role="group" aria-label="Center status filters">
        {FILTER_CARDS.map((card) => {
          const count = counts[card.countKey]
          const active = quickFilter === card.key
          const tokens = COLOR_TOKEN_MAP[card.colorToken]
          return (
            <button
              key={card.key}
              type="button"
              role="radio"
              aria-pressed={active}
              className={`ec-filter-card ${active ? 'is-active' : ''}`}
              style={{
                '--card-bg': `var(--${tokens.bg})`,
                '--card-border': `var(--${tokens.border})`,
                '--card-text': `var(--${tokens.text})`,
                '--card-dot': `var(--${tokens.dot})`,
              }}
              onClick={() => setQuickFilter(card.key)}
            >
              <div className="ec-filter-card-top">
                <span className="ec-filter-card-icon" aria-hidden="true">
                  <FontAwesomeIcon icon={card.icon} size="sm" />
                </span>
                <span className="ec-filter-card-count">{count}</span>
              </div>
              <span className="ec-filter-card-label">{card.label}</span>
            </button>
          )
        })}
      </div>

      <div className="ec-table-card">
        <div className="ec-table-toolbar" role="toolbar" aria-label="Center list toolbar">
          <div className="ec-toolbar-search" style={{ position: 'relative', flex: '1 1 260px', minWidth: '220px' }}>
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search center or barangay…"
              ariaLabel="Search centers"
            />
            {searchQuery && (
              <button
                type="button"
                className="ds-btn ds-btn--icon ds-btn--ghost"
                style={{ padding: 0, width: 'var(--control-height-sm)', height: 'var(--control-height-sm)', minWidth: 'var(--control-height-sm)' }}
                onClick={() => {
                  setSearchQuery('')
                }}
                aria-label="Clear search"
              >
                <FontAwesomeIcon icon={faXmark} size="xs" />
              </button>
            )}
          </div>

          <div className="ec-toolbar-select" style={{ minWidth: '200px', position: 'relative' }}>
            <button
              type="button"
              className="ds-select ec-barangay-select"
              onClick={() => setDropdownOpen(!dropdownOpen)}
              aria-expanded={dropdownOpen}
              aria-label="Barangay filter"
            >
              {barangayLocal ? barangayLocal : 'All Barangays'}
              <FontAwesomeIcon icon={faXmark} size="xs" style={{ marginLeft: 'auto', color: barangayLocal ? 'var(--muted)' : 'transparent' }} />
              <FontAwesomeIcon icon={faFilter} size="xs" style={{ marginLeft: 'var(--space-2)', color: 'var(--muted)' }} />
            </button>
            {dropdownOpen && (
              <div className="ec-dropdown ec-dropdown--open">
                <input
                  type="text"
                  className="ds-input"
                  placeholder="Search barangays…"
                  autoFocus
                  onChange={(e) => setBarangayLocal(e.target.value || '')}
                  aria-label="Filter barangay options"
                />
                <ul role="listbox">
                  <li
                    role="option"
                    aria-selected={!barangayLocal}
                    onClick={() => {
                      setBarangayLocal('')
                      onBarangayChange('')
                      setDropdownOpen(false)
                    }}
                  >
                    All Barangays
                  </li>
                  {barangays
                    .filter((b) => {
                      const q = barangayLocal.toLowerCase()
                      return !q || String(b.name || b).toLowerCase().includes(q)
                    })
                    .slice(0, 20)
                    .map((b) => {
                      const name = typeof b === 'string' ? b : b.name || b
                      const id = typeof b === 'string' ? b : b.id || b
                      return (
                        <li
                          key={id}
                          role="option"
                          aria-selected={barangayLocal === String(id)}
                          onClick={() => {
                            setBarangayLocal(name)
                            onBarangayChange(String(id))
                            setDropdownOpen(false)
                          }}
                        >
                          {name}
                        </li>
                      )
                    })
                  }
                </ul>
              </div>
            )}
          </div>

          {activeFilterCount > 0 && (
            <button
              type="button"
              className="ds-btn ds-btn--ghost ds-btn--sm"
              onClick={handleClearFilters}
              aria-label="Clear all filters"
            >
              <FontAwesomeIcon icon={faXmark} size="xs" /> Clear filters
            </button>
          )}
        </div>

        {isLoading ? (
          <SkeletonRows count={4} />
        ) : error ? (
          <div className="ec-table-wrapper">
            <div className="ds-empty" role="alert" aria-live="polite">
              <FontAwesomeIcon icon={faBuilding} className="ds-empty__icon" aria-hidden="true" />
              <h2 className="ds-empty__title">Couldn't load centers</h2>
              <p className="ds-empty__text">Check your connection and try again.</p>
              <button type="button" className="ds-btn ds-btn--primary" onClick={handleRetry}>
                Retry
              </button>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="ec-table-wrapper">
            <EmptyState
              icon={faBuilding}
              title="No centers match your filters"
              text="Try clearing your filters or adjust your search."
              action={handleClearFilters}
              actionLabel="Clear filters"
            />
          </div>
        ) : (
          <div className="ec-table-wrapper">
            <table className="ds-table ec-center-table ds-table--stack">
              <thead>
                <tr>
                  <th style={{ width: '22%' }} scope="col">Center</th>
                  <th style={{ width: '22%' }} scope="col">Barangay</th>
                  <th style={{ width: '15%' }} scope="col">Structure</th>
                  <th style={{ width: '24%' }} scope="col">Occupancy</th>
                  <th style={{ width: '13%' }} scope="col">Status</th>
                  <th style={{ width: '4%' }} scope="col" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((feature) => {
                  const props = feature.properties || feature
                  const id = props.id
                  const name = props.name || 'Unnamed Center'
                  const mapped = !centerNeedsMapping(props)
                  const brgyList = Array.isArray(props.barangays) ? props.barangays : []
                  const brgyShown = brgyList.slice(0, 2).map((b) => ({
                    id: typeof b === 'string' ? b : b.id || b,
                    name: typeof b === 'string' ? b : b.name || b,
                    color: typeof b === 'string' ? undefined : b.color,
                  }))
                  const extraBrgy = Math.max(0, brgyList.length - 2)
                  const allBrgyNames = brgyList.map((b) => (typeof b === 'string' ? b : b.name || b)).join(', ')
                  const cap = Number(props.capacity || 0)
                  const assigned = Number(props.assigned || 0)
                  const checkedIn = Number(props.occupied || 0)
                  const status = centerStatus(props, checkedIn, assigned, cap)
                  const occupancyPct = cap > 0 ? Math.min(100, Math.round((assigned / cap) * 100)) : 0
                  const statusVariantClass = statusVariant(status)
                  const statusTokens = {
                    Available: { bg: 'success-soft', border: 'success', text: 'success', dot: 'success' },
                    'Near full': { bg: 'warning-soft', border: 'warning', text: 'warning', dot: 'warning' },
                    Full: { bg: 'danger-soft', border: 'danger', text: 'danger', dot: 'danger' },
                  }[status] || { bg: 'neutral-soft', border: 'neutral', text: 'neutral', dot: 'neutral' }

                  return (
                    <tr
                      key={id}
                      className="ec-center-row"
                      role="button"
                      tabIndex={0}
                      aria-label={`Open ${name}`}
                      onClick={() => handleRowOpen(feature)}
                      onKeyDown={(e) => handleRowKeyDown(e, feature)}
                    >
                      <td className="ec-cell-center" data-label="Center">
                        <div className="ec-center-name" title={name}>
                          {name}
                        </div>
                        {!mapped && (
                          <div className="ec-center-needs-mapping" aria-label="Not mapped">
                            <FontAwesomeIcon icon={faBan} size="xs" /> Needs mapping
                          </div>
                        )}
                      </td>
                      <td className="ec-cell-barangay" data-label="Barangay">
                        <div className="ec-barangay-badges">
                          {brgyShown.map((b) => (
                            <span
                              key={b.id}
                              className="ec-barangay-badge"
                              title={b.name}
                              style={{
                                '--barangay-color': b.color || 'var(--neutral)',
                              }}
                            >
                              {b.name}
                            </span>
                          ))}
                          {extraBrgy > 0 && (
                            <span className="ec-barangay-badge ec-barangay-badge--more" title={allBrgyNames}>
                              +{extraBrgy}
                            </span>
                          )}
                          {brgyShown.length === 0 && (
                            <span className="ec-barangay-badge ec-barangay-badge--none">—</span>
                          )}
                        </div>
                      </td>
                      <td className="ec-cell-structure" data-label="Structure">
                        <div className="ec-structure-cell">
                          <span className="ec-structure-icon" aria-hidden="true">
                            <FontAwesomeIcon icon={structureIcon(props)} size="xs" />
                          </span>
                          <span>{structureText(props)}</span>
                        </div>
                      </td>
                      <td className="ec-cell-occupancy" data-label="Occupancy">
                        <div className="ec-occupancy-cell">
                          <div className="ec-occupancy-bar-wrap">
                            <div className="ec-occupancy-bar-track">
                              <div
                                className="ec-occupancy-bar-fill"
                                style={{
                                  width: `${occupancyPct}%`,
                                  backgroundColor: `var(--${statusTokens.dot})`,
                                }}
                              />
                            </div>
                          </div>
                          <div className="ec-occupancy-text">
                            <span className="ec-occupancy-assigned">
                              <strong>{assigned}</strong> of {cap} assigned
                            </span>
                            <span className="ec-occupancy-checkedin">
                              {checkedIn} CHECKED IN
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="ec-cell-status" data-label="Status">
                        <span
                          className={`ec-status-pill ${statusVariantClass}`}
                          style={{
                            '--pill-bg': `var(--${statusTokens.bg})`,
                            '--pill-border': `var(--${statusTokens.border})`,
                            '--pill-text': `var(--${statusTokens.text})`,
                            '--pill-dot': `var(--${statusTokens.dot})`,
                          }}
                        >
                          <span className="ec-status-dot" aria-hidden="true" />
                          {status}
                        </span>
                      </td>
                      <td className="ec-cell-actions" data-label="Actions" onClick={(e) => e.stopPropagation()}>
                        <FloatingMenuTrigger
                          items={kebabItems(feature)}
                          label={`Actions for ${name}`}
                          align="right"
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <footer className="ec-list-footer">
        Showing <strong>{filtered.length}</strong> of <strong>{allCenters.length}</strong> evacuation centers
      </footer>
    </section>
  )
}

export function SearchInput({ value, onChange, placeholder, ariaLabel }) {
  const handleChange = (e) => onChange(e.target.value)
  const handleClear = () => onChange('')
  return (
    <div className="si-wrap" role="search" aria-label={ariaLabel}>
      <span className="si-icon" aria-hidden="true"><FontAwesomeIcon icon={faSearch} size="xs" /></span>
      <input className="si-input" type="search" value={value} onChange={handleChange} placeholder={placeholder} aria-label={ariaLabel} spellCheck={false} autoComplete="off" />
      {value && (
        <button type="button" className="si-clear" onClick={handleClear} aria-label="Clear search" title="Clear search">
          <FontAwesomeIcon icon={faXmark} size="xs" />
        </button>
      )}
    </div>
  )
}

export function EmptyState({ icon, title = 'No data available', text, action, actionLabel, className = '' }) {
  return (
    <div className={`es-empty ${className}`.trim()}>
      {icon && <FontAwesomeIcon icon={icon} className="es-icon" aria-hidden="true" />}
      <h2 className="es-title">{title}</h2>
      {text && <p className="es-text">{text}</p>}
      {action && actionLabel && (
        <button type="button" className="ds-btn ds-btn--primary es-action" onClick={action}>
          {actionLabel}
        </button>
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
    return (<div className={`ob-empty ${className}`.trim()} role="text" aria-label="Occupancy: no capacity set">—</div>)
  }
  const label = showLabel ? `${as} of ${cap} assigned, ${pctAssigned}%` : `${as} of ${cap} assigned`
  return (
    <div className={`ob-wrap ${className}`.trim()} role="group" aria-label={label}>
      {showLabel && <span className="ob-label">{label}</span>}
      <div className="ob-bar"><div className="ob-fill" style={{ width: `${pctAssigned}%` }} /></div>
    </div>
  )
}

export function Skeleton({ variant = 'line', count = 3, width, className = '' }) {
  if (variant === 'card') {
    return (<div className={`sk-card ${className}`.trim()} aria-hidden="true"><div className="ds-skeleton ds-skeleton--card" /></div>)
  }
  if (variant === 'table-row') {
    return (
      <div className={`sk-table ${className}`.trim()} role="table" aria-label="Loading rows" aria-busy="true">
        <div className="sk-row" role="rowgroup">
          {Array.from({ length: count }).map((_, i) => (
            <div key={i} className="sk-row-line" role="row">
              {[0, 1, 2].map((j) => (<div key={j} className="sk-cell" role="cell"><div className="ds-skeleton ds-skeleton--text" /></div>))}
            </div>
          ))}
        </div>
      </div>
    )
  }
  return (<div className={`sk-line ${className}`.trim()} aria-hidden="true"><div className="ds-skeleton" style={{ height: 'var(--text-xs)', width: width ?? '100%' }} /></div>)
}

export function SkeletonRows({ count = 4 }) {
  return (
    <div className="ec-table-wrapper">
      <table className="ds-table">
        <thead>
          <tr>
            <th style={{ width: '22%' }}>Center</th>
            <th style={{ width: '22%' }}>Barangay</th>
            <th style={{ width: '15%' }}>Structure</th>
            <th style={{ width: '24%' }}>Occupancy</th>
            <th style={{ width: '13%' }}>Status</th>
            <th style={{ width: '4%' }}></th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: count }).map((_, i) => (
            <tr key={i}>
              <td><div className="ds-skeleton ds-skeleton--title" style={{ width: '55%' }} /><div className="ds-skeleton" style={{ width: '40%', height: 'var(--text-xs)' }} /></td>
              <td><div className="ds-skeleton ds-skeleton--text" style={{ width: '60%' }} /></td>
              <td><div className="ds-skeleton ds-skeleton--text" style={{ width: '45%' }} /></td>
              <td><div className="ds-skeleton ds-skeleton--text" style={{ width: '45%' }} /></td>
              <td><div className="ds-skeleton ds-skeleton--text" style={{ width: '55%' }} /></td>
              <td><div className="ds-skeleton ds-skeleton--btn" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const ICONS = { Available: faCircleCheck, 'Near full': faTriangleExclamation, Full: faCircleStop, Closed: faCircleXmark }
export function StatusBadge({ status = 'Available', className = '' }) {
  const variant = statusVariant(status)
  const Icon = ICONS[status] || faCircleCheck
  return (
    <span className={`sb-badge ds-badge ds-badge--${variant} ${className}`.trim()} title={status} aria-label={status}>
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
  const { size: dim } = SIZE[size] ?? SIZE.medium
  const label = initials(name)
  return (
    <span className={`av-avatar av-avatar--${size} ${className}`.trim()} style={{ width: dim, height: dim }} aria-label={name ? `Avatar for ${name}` : undefined} title={name || undefined}>
      {label}
    </span>
  )
}

export function SegmentedControl({ options = [], value, onChange, ariaLabel }) {
  const handleSelect = (optionValue) => { if (optionValue !== value) onChange(optionValue) }
  return (
    <div className="sc-root" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const active = value === option.value
        return (
          <button type="button" key={option.value} role="radio" aria-checked={active} className={`sc-button ${active ? 'sc-button--active' : ''}`} onClick={() => handleSelect(option.value)}>
            {option.icon && <FontAwesomeIcon icon={option.icon} size="xs" className="sc-icon" />}
            <span className="sc-label">{option.label}</span>
            {option.count != null && <span className="sc-count">{option.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

const TONE_BG = { neutral: 'var(--neutral-soft)', safe: 'var(--ew-safe-bg)', warning: 'var(--ew-warning-bg)', danger: 'var(--ew-danger-bg)' }
const TONE_TEXT = { neutral: 'var(--ew-text-muted)', safe: 'var(--ew-safe-text)', warning: 'var(--ew-warning-text)', danger: 'var(--ew-danger-text)' }
export function Tag({ label, tone = 'neutral', className = '' }) {
  return (
    <span className={`ds-chip tag tag--${tone} ${className}`.trim()} style={{ backgroundColor: TONE_BG[tone] ?? TONE_BG.neutral, color: TONE_TEXT[tone] ?? TONE_TEXT.neutral }}>
      {label}
    </span>
  )
}
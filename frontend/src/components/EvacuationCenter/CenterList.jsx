import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faPlus, faRotate, faHouseFlag, faBan, faMapPin, faPen, faBuilding,
  faCircleCheck, faTriangleExclamation, faCircleStop, faLocationDot,
  faFilter, faXmark, faThLarge, faTable,
  faSearch, faEllipsisVertical, faCircleXmark,
} from '@fortawesome/free-solid-svg-icons'

import { useAuth } from '../../context/AuthContext'
import { centerStatus, centerNeedsMapping, useEscapeKey } from './utils'
import { statusVariant } from './evacuationStatus'
import './CenterList.css'


const QUICK_FILTERS = [
  { key: 'all', label: 'All', icon: faBuilding, status: null },
  { key: 'available', label: 'Available', icon: faCircleCheck, status: 'Available' },
  { key: 'near-full', label: 'Near full', icon: faTriangleExclamation, status: 'Near full' },
  { key: 'full', label: 'Full', icon: faCircleStop, status: 'Full' },
  { key: 'needs-mapping', label: 'Needs mapping', icon: faMapPin, status: 'needs-mapping' },
]

const STATUS_BY_KEY = {
  available: 'Available',
  'near-full': 'Near full',
  full: 'Full',
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
  loading = false,
  error = '',
  className = '',
}) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const navigate = useNavigate()

  const [searchQuery, setSearchQuery] = useState('')
  const [barangayFilter, setBarangayFilter] = useState('')
  const [quickFilter, setQuickFilter] = useState('all')
  const [viewMode, setViewMode] = useState('table')
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

  const chipOptions = useMemo(
    () =>
      QUICK_FILTERS.map((chip) => ({
        ...chip,
        value: chip.key,
        count: counts[chip.key],
      })),
    [counts]
  )

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

  const kebabItems = useCallback(
    (feature) => {
      const props = feature.properties || feature
      const items = [
        { label: 'View on map', icon: faLocationDot, onClick: () => onViewMap?.(props) },
      ]
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
    [isAdmin, canDeactivate, onEdit, onViewMap, onAddRooms, onDeactivate]
  )
  return (
    <section className={`ec-list-page ${className}`.trim()}>
      <header className="ec-list-header">
        <div className="ec-list-title-row">
          <span className="ec-list-title-icon" aria-hidden="true">
            <FontAwesomeIcon icon={faHouseFlag} size="sm" />
          </span>
          <div className="ec-list-title-group">
            <h2 className="ec-list-title">Evacuation Centers</h2>
            <p className="ec-list-subtitle">
              Check shelter capacity, building readiness, and live check-ins across the municipality.
            </p>
          </div>
        </div>
        <div className="ec-list-controls">
          <button
            type="button"
            className="ds-btn ds-btn--icon ds-btn--ghost"
            aria-label="Refresh centers"
            title="Refresh centers"
            onClick={handleRefresh}
          >
            <FontAwesomeIcon icon={faRotate} />
          </button>
          {isAdmin && onAddCenter && (
            <button type="button" className="ds-btn ds-btn--primary" onClick={onAddCenter}>
              <FontAwesomeIcon icon={faPlus} /> Add Center
            </button>
          )}
        </div>
      </header>

      <div className="ec-quick-chips" role="navigation" aria-label="Quick center filters">
        <FilterChip
          options={chipOptions}
          value={quickFilter}
          onChange={setQuickFilter}
          ariaLabel="Quick center status filter"
        />
      </div>

      <div className="ec-toolbar-row" role="toolbar" aria-label="Center list toolbar">
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

        <div className="ec-toolbar-count">
          <strong>{filtered.length}</strong> of {allCenters.length} center{allCenters.length !== 1 ? 's' : ''}
        </div>

        <div className="ec-toolbar-view" role="group" aria-label="View mode">
          <button
            type="button"
            aria-pressed={viewMode === 'table'}
            className={`ds-btn ds-btn--icon ds-btn--${viewMode === 'table' ? 'secondary' : 'ghost'}`}
            onClick={() => setViewMode('table')}
            title="Table view"
          >
            <FontAwesomeIcon icon={faTable} size="xs" />
          </button>
          <button
            type="button"
            aria-pressed={viewMode === 'cards'}
            className={`ds-btn ds-btn--icon ds-btn--${viewMode === 'cards' ? 'secondary' : 'ghost'}`}
            onClick={() => setViewMode('cards')}
            title="Cards view"
          >
            <FontAwesomeIcon icon={faThLarge} size="xs" />
          </button>
          </div>
        </div>
      {isLoading ? (
        <SkeletonRows count={4} />
      ) : error ? (
        <div className="ec-table-container">
          <div className="ds-empty" role="alert" aria-live="polite">
            <FontAwesomeIcon icon={faHouseFlag} className="ds-empty__icon" aria-hidden="true" />
            <h2 className="ds-empty__title">Couldn't load centers</h2>
            <p className="ds-empty__text">Check your connection and try again.</p>
            <button type="button" className="ds-btn ds-btn--primary" onClick={handleRetry}>
              Retry
            </button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={faHouseFlag}
          title="No centers match your filters"
          text="Try clearing your filters or adjust your search."
          action={handleClearFilters}
          actionLabel="Clear filters"
        />
      ) : (
        <div className="ec-table-container">
          <table className="ds-table ec-center-table ds-table--stack">
            <thead>
              <tr>
                <th style={{ width: '26%' }} scope="col">Center</th>
                <th style={{ width: '20%' }} scope="col">Structure</th>
                <th style={{ width: '22%' }} scope="col">Occupancy</th>
                <th style={{ width: '14%' }} scope="col">Households</th>
                <th style={{ width: '10%' }} scope="col">Status</th>
                <th style={{ width: '8%' }} scope="col" />
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
                const cap = Number(props.capacity || 0)
                const assigned = Number(props.assigned || 0)
                const checkedIn = Number(props.occupied || 0)
                const status = centerStatus(props, checkedIn, assigned, cap)
                const hhRaw = props.household_count
                const hh = Number.isFinite(Number(hhRaw)) ? Number(hhRaw) : null

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
                      <div className="ec-center-barangays">
                        {brgyShown.map((b) => (
                          <span
                            key={b.id}
                            className="ds-chip ds-chip--neutral"
                            title={b.name}
                            style={{
                              fontSize: 'var(--text-xs)',
                              padding: '2px 8px',
                              backgroundColor: b.color || 'inherit',
                              color: b.color ? '#fff' : 'inherit',
                            }}
                          >
                            {b.name}
                          </span>
                        ))}
                        {extraBrgy > 0 && <span className="ec-plus-n">+{extraBrgy}</span>}
                        {!mapped && (
                          <span className="ec-pin-off" aria-label="Not mapped" title="Not mapped">
                            <FontAwesomeIcon icon={faBan} size="xs" />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="ec-cell-structure" data-label="Structure">{structureText(props)}</td>
                    <td className="ec-cell-occupancy" data-label="Occupancy">
                      {cap > 0 ? (
                        <>
                          <OccupancyBar checkedIn={checkedIn} assigned={assigned} capacity={cap} showLabel={false} />
                          <span className="ec-occ-number">{assigned} of {cap} assigned</span>
                          <span className="ec-occ-muted">{checkedIn} checked in</span>
                        </>
                      ) : (
                        <span className="ec-occ-muted">—</span>
                      )}
                    </td>
                    <td className="ec-cell-households" data-label="Households">
                      <span className="ec-hh-number">{hh === null ? '—' : hh}</span>
                      <span className="ec-hh-muted">
                        {hh === null ? '' : hh === 1 ? 'household' : 'households'}
                      </span>
                    </td>
                    <td className="ec-cell-status" data-label="Status"><StatusBadge status={status} /></td>
                    <td className="ec-cell-actions" data-label="Actions">
                      <ActionMenu items={kebabItems(feature)} label="More actions" align="right" />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
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

export function FilterChip({ options = [], value, onChange, ariaLabel }) {
  const handleSelect = (optionValue) => { if (optionValue !== value) onChange(optionValue) }
  return (
    <div className="fc-wrap" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const active = value === option.value
        return (
          <button type="button" key={option.value} role="radio" aria-checked={active} className={`fc-button ${active ? 'fc-button--active' : ''}`} onClick={() => handleSelect(option.value)}>
            {option.icon && <FontAwesomeIcon icon={option.icon} size="xs" className="fc-icon" />}
            <span className="fc-label">{option.label}</span>
            {option.count != null && <span className="fc-count">{option.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

export function ActionMenu({ items = [], label = 'More actions' }) {
  const [open, setOpen] = useState(false)
  const [flipped, setFlipped] = useState(false)
  const wrapRef = useRef(null)
  const menuRef = useRef(null)
  const close = useCallback(() => setOpen(false), [])
  useEscapeKey(open, close)
  useEffect(() => {
    if (!open) return undefined
    function onMouseDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) { close() }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open, close])
  useEffect(() => {
    if (!open || !wrapRef.current || !menuRef.current) return
    const check = () => {
      const wrapRect = wrapRef.current.getBoundingClientRect()
      const menuRect = menuRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - wrapRect.bottom
      const spaceAbove = wrapRect.top
      setFlipped(spaceBelow < menuRect.height && spaceAbove > spaceBelow)
    }
    check()
    window.addEventListener('scroll', check)
    window.addEventListener('resize', check)
    return () => { window.removeEventListener('scroll', check); window.removeEventListener('resize', check) }
  }, [open])
  const toggle = () => setOpen((p) => !p)
  return (
    <div className="am-wrap" ref={wrapRef} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="ds-btn ds-btn--icon ds-btn--ghost am-trigger" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
        <FontAwesomeIcon icon={faEllipsisVertical} />
      </button>
      {open && (
        <ul className="ds-menu ec-kebab-menu" role="menu">
          {items.map((item, i) => (
            <li key={i} role="none">
              <button type="button" role="menuitem" className={item.danger ? 'ds-menu__item ds-menu__item--danger' : 'ds-menu__item'} onClick={() => { setOpen(false); item.onClick && item.onClick() }}>
                {item.icon && <FontAwesomeIcon icon={item.icon} size="xs" style={{ marginRight: 'var(--space-2)' }} />}
                {item.label}
              </button>
            </li>
          ))}
        </ul>
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

export function OccupancyBar({ checkedIn = 0, assigned = 0, capacity = 0, showLabel = true, className = '' }) {
  const cap = Math.max(0, capacity || 0)
  const ci = Math.max(0, Math.min(checkedIn || 0, cap))
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
    <div className="ec-table-container">
      <table className="ds-table">
        <thead>
          <tr>
            <th style={{ width: '26%' }}>Center</th>
            <th style={{ width: '20%' }}>Structure</th>
            <th style={{ width: '22%' }}>Occupancy</th>
            <th style={{ width: '14%' }}>Households</th>
            <th style={{ width: '10%' }}>Status</th>
            <th style={{ width: '8%' }}></th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: count }).map((_, i) => (
            <tr key={i}>
              <td><div className="ds-skeleton ds-skeleton--title" style={{ width: '55%' }} /><div className="ds-skeleton" style={{ width: '40%', height: 'var(--text-xs)' }} /></td>
              <td><div className="ds-skeleton ds-skeleton--text" style={{ width: '60%' }} /></td>
              <td><div className="ds-skeleton ds-skeleton--text" style={{ width: '45%' }} /></td>
              <td><div className="ds-skeleton ds-skeleton--text" style={{ width: '50%' }} /></td>
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


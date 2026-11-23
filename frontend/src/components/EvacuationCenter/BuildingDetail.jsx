import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faBuilding,
  faDoorOpen,
  faDrawPolygon,
  faEllipsisVertical,
  faMap,
  faPen,
  faPlus,
  faSearch,
  faTrash,
  faUserCheck,
  faUsers,
  faXmark,
} from '@fortawesome/free-solid-svg-icons'
import { formatFloorLabel, formatRoomLabel } from '../../utils/formatRoomLabel'
import { Breadcrumb, Button, FilterChip, ProgressBar, StatCard, StatusPill } from '../ui'
import './BuildingDetail.css'

function getFloorTabLabel(floor) {
  if (Number(floor) === 1) return 'Ground'
  return formatFloorLabel(floor).replace(/\s+floor$/i, '')
}

function getFloorGroupHeading(floor, count) {
  const unit = count === 1 ? 'ROOM' : 'ROOMS'
  if (floor == null) return `NO FLOOR ASSIGNED - ${count} ${unit}`
  const label = Number(floor) === 1 ? 'GROUND FLOOR' : formatFloorLabel(floor).toUpperCase()
  return `${label} - ${count} ${unit}`
}

function getBuildingStatusMeta(status) {
  if (status === 'under_repair') {
    return { variant: 'almost-full', label: 'Under repair' }
  }
  if (status === 'closed') {
    return { variant: 'full', label: 'Closed' }
  }
  return { variant: 'open', label: 'Open' }
}

export default function BuildingDetail({
  center,
  building,
  rooms = [],
  families = [],
  loading = false,
  notFound = false,
  listHref,
  centerHref,
  onAddRoom,
  onEditBuilding,
  onDeleteBuilding,
  onViewBuildingMap,
  onPlaceBuilding,
  onOpenRoom,
}) {
  const [floorFilter, setFloorFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const menuWrapRef = useRef(null)

  useEffect(() => {
    if (!menuOpen) return undefined
    const handleOutside = (event) => {
      if (menuWrapRef.current && !menuWrapRef.current.contains(event.target)) {
        setMenuOpen(false)
      }
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen])

  const familiesByRoom = useMemo(() => {
    const map = new Map()
    families.forEach((family) => {
      if (family?.room_id == null) return
      const key = String(family.room_id)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(family)
    })
    return map
  }, [families])

  const buildingRooms = useMemo(() => {
    if (!building) return []
    return rooms.filter((room) => String(room.building_id ?? '') === String(building.id ?? ''))
  }, [rooms, building])

  const roomMetrics = useMemo(() => {
    const map = new Map()
    buildingRooms.forEach((room) => {
      const assignedList = familiesByRoom.get(String(room.id))
      const assignedFamilies = assignedList
        ? assignedList.length
        : Number(
            room?.used_slots ??
              (Array.isArray(room?.assigned_families) ? room.assigned_families.length : 0)
          )
      const arrivedFamilies = assignedList
        ? assignedList.filter((family) => Boolean(family?.is_checked_in)).length
        : Number(room?.arrived_families ?? 0)
      const familySlots = Math.max(1, Number(room?.family_slots ?? 5))
      const peopleSpaces = Math.max(1, Number(room?.people_spaces ?? room?.capacity ?? 25))
      const usedSlots = Number(room?.used_slots ?? assignedFamilies)
      const usedSpaces = Number(room?.used_spaces ?? room?.assigned ?? room?.occupied ?? 0)
      const isOverCapacity =
        Boolean(room?.is_over_capacity) || usedSlots > familySlots || usedSpaces > peopleSpaces
      const isFull =
        Boolean(room?.is_full) || usedSlots >= familySlots || usedSpaces >= peopleSpaces
      map.set(String(room.id), {
        familySlots,
        peopleSpaces,
        usedSlots,
        usedSpaces,
        assignedFamilies,
        arrivedFamilies,
        isOverCapacity,
        isFull,
      })
    })
    return map
  }, [buildingRooms, familiesByRoom])

  const getRoomUsage = (room) =>
    roomMetrics.get(String(room.id)) || {
      familySlots: 5,
      peopleSpaces: 25,
      usedSlots: 0,
      usedSpaces: 0,
      assignedFamilies: 0,
      arrivedFamilies: 0,
      isOverCapacity: false,
      isFull: false,
    }

  const floorCount = Math.max(1, Number(building?.floors || 1))
  const floors = useMemo(() => {
    const floorSet = new Set(Array.from({ length: floorCount }, (_, index) => index + 1))
    buildingRooms.forEach((room) => {
      if (room?.floor != null && Number.isFinite(Number(room.floor))) {
        floorSet.add(Number(room.floor))
      }
    })
    return Array.from(floorSet).sort((a, b) => a - b)
  }, [floorCount, buildingRooms])

  const hasUnsetFloorRooms = useMemo(
    () => buildingRooms.some((room) => room.floor == null),
    [buildingRooms]
  )

  const floorScopedRooms = useMemo(() => {
    return buildingRooms.filter((room) => {
      if (floorFilter === 'unset') return room.floor == null
      if (floorFilter !== 'all') return String(room.floor ?? '') === floorFilter
      return true
    })
  }, [buildingRooms, floorFilter])

  const searchScopedRooms = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return floorScopedRooms
    return floorScopedRooms.filter((room) =>
      formatRoomLabel(room.room_number).toLowerCase().includes(q)
    )
  }, [floorScopedRooms, search])

  const availableInScope = useMemo(
    () => searchScopedRooms.filter((room) => !(roomMetrics.get(String(room.id))?.isFull)).length,
    [searchScopedRooms, roomMetrics]
  )
  const fullInScope = searchScopedRooms.length - availableInScope

  const matchingRooms = useMemo(() => {
    return searchScopedRooms
      .filter((room) => {
        const isFull = Boolean(roomMetrics.get(String(room.id))?.isFull)
        if (statusFilter === 'available' && isFull) return false
        if (statusFilter === 'full' && !isFull) return false
        return true
      })
      .sort((a, b) => {
        const floorDiff = Number(a.floor ?? 999) - Number(b.floor ?? 999)
        if (floorDiff !== 0) return floorDiff
        return formatRoomLabel(a.room_number).localeCompare(formatRoomLabel(b.room_number), undefined, {
          numeric: true,
        })
      })
  }, [searchScopedRooms, statusFilter, roomMetrics])

  const floorSections = useMemo(() => {
    if (floorFilter === 'unset') {
      return matchingRooms.length > 0 ? [{ key: 'unset', floor: null, rooms: matchingRooms }] : []
    }
    if (floorFilter !== 'all') {
      const floorNum = Number(floorFilter)
      return matchingRooms.length > 0
        ? [{ key: `floor-${floorNum}`, floor: floorNum, rooms: matchingRooms }]
        : []
    }

    const sections = []
    floors.forEach((floorNum) => {
      const groupRooms = matchingRooms.filter((room) => Number(room.floor) === floorNum)
      if (groupRooms.length > 0) {
        sections.push({ key: `floor-${floorNum}`, floor: floorNum, rooms: groupRooms })
      }
    })
    const unsetRooms = matchingRooms.filter((room) => room.floor == null)
    if (unsetRooms.length > 0) {
      sections.push({ key: 'unset', floor: null, rooms: unsetRooms })
    }
    return sections
  }, [floorFilter, floors, matchingRooms])

  const summary = useMemo(() => {
    let totalSlots = 0
    let usedSlots = 0
    let totalSpaces = 0
    let usedSpaces = 0
    let fullRooms = 0
    let assignedFamilies = 0
    let arrivedFamilies = 0

    buildingRooms.forEach((room) => {
      const usage = roomMetrics.get(String(room.id))
      if (!usage) return
      totalSlots += usage.familySlots
      usedSlots += usage.usedSlots
      totalSpaces += usage.peopleSpaces
      usedSpaces += usage.usedSpaces
      if (usage.isFull) fullRooms += 1
      assignedFamilies += usage.assignedFamilies
      arrivedFamilies += usage.arrivedFamilies
    })

    const availableRooms = Math.max(0, buildingRooms.length - fullRooms)
    const freeSlots = Math.max(0, totalSlots - usedSlots)
    const freeSpaces = Math.max(0, totalSpaces - usedSpaces)
    const notYetArrived = Math.max(0, assignedFamilies - arrivedFamilies)

    return {
      totalSlots,
      usedSlots,
      freeSlots,
      totalSpaces,
      usedSpaces,
      freeSpaces,
      totalRooms: buildingRooms.length,
      fullRooms,
      availableRooms,
      assignedFamilies,
      arrivedFamilies,
      notYetArrived,
    }
  }, [buildingRooms, roomMetrics])

  const breadcrumbItems = [
    { label: 'Evacuation Centers', to: listHref },
    { label: center?.name || 'Evacuation Center', to: centerHref },
    { label: building?.name || 'Building' },
  ]

  if (loading && !building) {
    return (
      <main className="ec-building-detail-page" aria-busy="true">
        <Breadcrumb items={breadcrumbItems} />
        <div className="ec-bldg-skeleton-header">
          <div className="ds-skeleton ec-bldg-sk-title" />
          <div className="ds-skeleton ec-bldg-sk-sub" />
        </div>
        <div className="ec-bldg-stats-grid">
          {[0, 1, 2, 3].map((idx) => (
            <div key={idx} className="ds-skeleton ec-bldg-sk-stat" />
          ))}
        </div>
        <div className="ec-bldg-room-grid">
          {[0, 1, 2, 3, 4, 5].map((idx) => (
            <div key={idx} className="ds-skeleton ec-bldg-sk-room" />
          ))}
        </div>
      </main>
    )
  }

  if (notFound || !building) {
    return (
      <main className="ec-building-detail-page">
        <Breadcrumb
          items={[
            { label: 'Evacuation Centers', to: listHref },
            { label: center?.name || 'Evacuation Center', to: centerHref },
            { label: 'Building not found' },
          ]}
        />
        <section className="ec-bldg-state-card">
          <span className="ec-bldg-state-icon" aria-hidden="true">
            <FontAwesomeIcon icon={faBuilding} />
          </span>
          <h1>Building not found</h1>
          <p>This building may have been deleted or is unavailable.</p>
          <Link to={centerHref} className="ui-btn ui-btn--secondary">
            Back to {center?.name || 'Evacuation Center'}
          </Link>
        </section>
      </main>
    )
  }

  const operationalStatus =
    building.status || building.operational_status || building.building_status || 'open'
  const statusMeta = getBuildingStatusMeta(operationalStatus)

  const renderRoomCard = (room) => {
    const usage = getRoomUsage(room)
    const roomName = formatRoomLabel(room.room_number)
    const roomFamilies = familiesByRoom.get(String(room.id)) || []
    const familyNames = roomFamilies
      .map((family) => family.head_name || family.family_name || family.name)
      .filter(Boolean)

    const pillVariant = usage.isOverCapacity || usage.isFull ? 'full' : 'available'
    const pillLabel = usage.isOverCapacity ? 'Over capacity' : usage.isFull ? 'Full' : 'Available'

    return (
      <button
        key={room.id}
        type="button"
        className="ec-bldg-room-card"
        title={
          familyNames.length > 0
            ? `Assigned families: ${familyNames.join(', ')}`
            : `Families ${usage.usedSlots}/${usage.familySlots} · People ${usage.usedSpaces}/${usage.peopleSpaces}`
        }
        onClick={() => onOpenRoom?.(room)}
      >
        <div className="ec-bldg-room-top">
          <span className="ec-bldg-room-name" title={roomName}>
            {roomName}
          </span>
          <StatusPill variant={pillVariant} label={pillLabel} />
        </div>

        <div className="ec-bldg-room-meters">
          <div className="ec-bldg-meter">
            <div className="ec-bldg-meter-row">
              <span className="ec-bldg-meter-label">Families</span>
              <span className="ec-bldg-meter-val">
                {usage.usedSlots} / {usage.familySlots}
              </span>
            </div>
            <ProgressBar
              value={usage.usedSlots}
              max={usage.familySlots}
              ariaLabel={`${roomName} families ${usage.usedSlots} of ${usage.familySlots}`}
            />
          </div>

          <div className="ec-bldg-meter">
            <div className="ec-bldg-meter-row">
              <span className="ec-bldg-meter-label">People</span>
              <span className="ec-bldg-meter-val">
                {usage.usedSpaces} / {usage.peopleSpaces}
              </span>
            </div>
            <ProgressBar
              value={usage.usedSpaces}
              max={usage.peopleSpaces}
              ariaLabel={`${roomName} people ${usage.usedSpaces} of ${usage.peopleSpaces}`}
            />
          </div>
        </div>

        <div
          className={`ec-bldg-room-footer ${usage.arrivedFamilies > 0 ? 'has-arrivals' : ''}`}
        >
          <FontAwesomeIcon icon={faUserCheck} className="ec-bldg-room-footer-icon" aria-hidden="true" />
          <span>{usage.arrivedFamilies} arrived</span>
        </div>
      </button>
    )
  }

  return (
    <main className="ec-building-detail-page">
      {/* 1. Breadcrumb */}
      <Breadcrumb items={breadcrumbItems} />

      {/* 2. Header */}
      <header className="ec-bldg-header">
        <div className="ec-bldg-heading">
          <div className="ec-bldg-title-row">
            <h1 className="ec-bldg-title">{building.name}</h1>
            <StatusPill variant={statusMeta.variant} label={statusMeta.label} />
            {!building.is_mapped && (
              <StatusPill variant="unmapped" label="Not mapped on map" />
            )}
          </div>
          <p className="ec-bldg-subtitle">
            {summary.totalRooms} {summary.totalRooms === 1 ? 'room' : 'rooms'} across {floorCount}{' '}
            {floorCount === 1 ? 'floor' : 'floors'} at {center?.name || 'Evacuation Center'}
          </p>
        </div>

        <div className="ec-bldg-actions">
          {!building.is_mapped && onPlaceBuilding && (
            <Button
              variant="secondary"
              onClick={() => onPlaceBuilding(building, 'place_building')}
            >
              <FontAwesomeIcon icon={faDrawPolygon} aria-hidden="true" />
              <span>Place building on map</span>
            </Button>
          )}
          <div className="ec-bldg-menu-wrap" ref={menuWrapRef}>
            <button
              type="button"
              className="ec-bldg-menu-btn"
              aria-label="Building actions"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <FontAwesomeIcon icon={faEllipsisVertical} aria-hidden="true" />
            </button>
            {menuOpen && (
              <div className="ec-bldg-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className="ec-bldg-menu-item"
                  onClick={() => {
                    setMenuOpen(false)
                    onEditBuilding?.(building)
                  }}
                >
                  <FontAwesomeIcon icon={faPen} aria-hidden="true" />
                  <span>Edit building</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="ec-bldg-menu-item"
                  onClick={() => {
                    setMenuOpen(false)
                    onPlaceBuilding?.(building, building.is_mapped ? 'remap' : 'place_building')
                  }}
                >
                  <FontAwesomeIcon icon={faDrawPolygon} aria-hidden="true" />
                  <span>{building.is_mapped ? 'Remap building' : 'Place building'}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="ec-bldg-menu-item"
                  onClick={() => {
                    setMenuOpen(false)
                    onViewBuildingMap?.(building)
                  }}
                >
                  <FontAwesomeIcon icon={faMap} aria-hidden="true" />
                  <span>View on map</span>
                </button>
                <div className="ec-bldg-menu-divider" role="separator" />
                <button
                  type="button"
                  role="menuitem"
                  className="ec-bldg-menu-item is-danger"
                  onClick={() => {
                    setMenuOpen(false)
                    onDeleteBuilding?.(building)
                  }}
                >
                  <FontAwesomeIcon icon={faTrash} aria-hidden="true" />
                  <span>Delete building</span>
                </button>
              </div>
            )}
          </div>

          <Button
            variant="primary"
            disabled={operationalStatus !== 'open'}
            title={
              operationalStatus === 'open'
                ? 'Add room'
                : `Room additions are disabled while this building is ${statusMeta.label.toLowerCase()}`
            }
            onClick={onAddRoom}
          >
            <FontAwesomeIcon icon={faPlus} aria-hidden="true" />
            <span>Add room</span>
          </Button>
        </div>
      </header>

      {/* 3. Summary row: 4 StatCards */}
      <section className="ec-bldg-stats-grid" aria-label="Building summary">
        <StatCard
          icon={faDoorOpen}
          label="Family slots"
          value={summary.usedSlots}
          max={summary.totalSlots}
          showProgress
          progressValue={summary.usedSlots}
          progressMax={Math.max(summary.totalSlots, 1)}
          footer={`${summary.freeSlots} ${summary.freeSlots === 1 ? 'slot' : 'slots'} still free`}
        />
        <StatCard
          icon={faUsers}
          label="People spaces"
          value={summary.usedSpaces}
          max={summary.totalSpaces}
          showProgress
          progressValue={summary.usedSpaces}
          progressMax={Math.max(summary.totalSpaces, 1)}
          footer={`${summary.freeSpaces} ${summary.freeSpaces === 1 ? 'space' : 'spaces'} still free`}
        />
        <StatCard
          icon={faBuilding}
          label="Rooms"
          value={summary.totalRooms}
          showProgress
          progressValue={summary.fullRooms}
          progressMax={Math.max(summary.totalRooms, 1)}
          footer={`${summary.fullRooms} full, ${summary.availableRooms} available`}
        />
        <StatCard
          icon={faUserCheck}
          label="Families arrived"
          value={summary.arrivedFamilies}
          max={summary.assignedFamilies}
          showProgress
          progressValue={summary.arrivedFamilies}
          progressMax={Math.max(summary.assignedFamilies, 1)}
          footer={`${summary.notYetArrived} not yet arrived`}
        />
      </section>

      {/* 4. Filters row */}
      <section className="ec-bldg-filters" aria-label="Filter rooms">
        <div className="ec-bldg-floor-seg" role="tablist" aria-label="Filter by floor">
          <button
            type="button"
            role="tab"
            aria-selected={floorFilter === 'all'}
            className={`ec-bldg-floor-btn ${floorFilter === 'all' ? 'is-active' : ''}`}
            onClick={() => setFloorFilter('all')}
          >
            All
          </button>
          {floors.map((floorNum) => {
            const val = String(floorNum)
            const active = floorFilter === val
            return (
              <button
                key={floorNum}
                type="button"
                role="tab"
                aria-selected={active}
                className={`ec-bldg-floor-btn ${active ? 'is-active' : ''}`}
                onClick={() => setFloorFilter(val)}
              >
                {getFloorTabLabel(floorNum)}
              </button>
            )
          })}
          {hasUnsetFloorRooms && (
            <button
              type="button"
              role="tab"
              aria-selected={floorFilter === 'unset'}
              className={`ec-bldg-floor-btn ${floorFilter === 'unset' ? 'is-active' : ''}`}
              onClick={() => setFloorFilter('unset')}
            >
              No floor
            </button>
          )}
        </div>

        <div className="ec-bldg-search-wrap">
          <FontAwesomeIcon icon={faSearch} className="ec-bldg-search-icon" aria-hidden="true" />
          <input
            type="search"
            className="ec-bldg-search-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search rooms..."
            aria-label="Search rooms"
          />
          {search && (
            <button
              type="button"
              className="ec-bldg-search-clear"
              onClick={() => setSearch('')}
              aria-label="Clear room search"
            >
              <FontAwesomeIcon icon={faXmark} size="xs" />
            </button>
          )}
        </div>

        <div className="ec-bldg-filters-spacer" aria-hidden="true" />

        <div className="ec-bldg-status-chips" role="group" aria-label="Filter rooms by availability">
          <FilterChip
            label="All"
            count={searchScopedRooms.length}
            active={statusFilter === 'all'}
            onClick={() => setStatusFilter('all')}
          />
          <FilterChip
            label="Available"
            count={availableInScope}
            active={statusFilter === 'available'}
            onClick={() => setStatusFilter('available')}
          />
          <FilterChip
            label="Full"
            count={fullInScope}
            active={statusFilter === 'full'}
            onClick={() => setStatusFilter('full')}
          />
        </div>
      </section>

      {/* 5. Rooms grouped by floor */}
      {buildingRooms.length === 0 ? (
        <section className="ec-bldg-state-card">
          <span className="ec-bldg-state-icon" aria-hidden="true">
            <FontAwesomeIcon icon={faDoorOpen} />
          </span>
          <h2>No rooms in this building yet</h2>
          <p>Add the first room to start assigning families to {building.name}.</p>
          {operationalStatus === 'open' && onAddRoom && (
            <Button variant="primary" onClick={onAddRoom}>
              <FontAwesomeIcon icon={faPlus} aria-hidden="true" />
              <span>Add room</span>
            </Button>
          )}
        </section>
      ) : floorSections.length === 0 ? (
        <section className="ec-bldg-state-card">
          <span className="ec-bldg-state-icon" aria-hidden="true">
            <FontAwesomeIcon icon={faSearch} />
          </span>
          <h2>No rooms match your filters</h2>
          <p>Try adjusting the floor, search term, or availability filter.</p>
          <Button
            variant="secondary"
            onClick={() => {
              setFloorFilter('all')
              setStatusFilter('all')
              setSearch('')
            }}
          >
            Clear filters
          </Button>
        </section>
      ) : (
        <div className="ec-bldg-floor-sections">
          {floorSections.map((section) => (
            <section key={section.key} className="ec-bldg-floor-section">
              <h2 className="ec-bldg-floor-heading">
                {getFloorGroupHeading(section.floor, section.rooms.length)}
              </h2>
              <div className="ec-bldg-room-grid">
                {section.rooms.map(renderRoomCard)}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  )
}

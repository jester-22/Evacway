import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCircleCheck,
  faTriangleExclamation,
  faArrowRight,
} from '@fortawesome/free-solid-svg-icons'
import { resolveCenterStructureMode } from './utils'

/**
 * ReadinessChecklist - High-elevation operational readiness checklist for evacuation centers
 */
export default function ReadinessChecklist({
  center,
  onPlaceOnMap,
  onAddRooms,
  onAddBuilding,
  onSetEntrance,
  onEditContact,
  onEditAccessibility,
}) {
  if (!center) return null

  const structureMode = resolveCenterStructureMode(center)
  const isOpenArea = structureMode === 'open_area'
  const isBuildingsAndRooms = structureMode === 'buildings_and_rooms'

  // Determine room/building readiness based on center structure_mode
  const roomCount = Number(
    center.room_count ?? center.total_rooms ?? center.rooms?.length ?? 0
  )
  const buildingCount = Number(
    center.building_count ?? center.buildings?.length ?? 0
  )
  const unmappedBuildingCount = Number(
    center.unmapped_building_count ??
      (Array.isArray(center.buildings)
        ? center.buildings.filter((b) => !b?.is_mapped).length
        : 0)
  )
  const mappedBuildingCount = Math.max(0, buildingCount - unmappedBuildingCount)
  const hasRooms = roomCount > 0
  const hasBuildings = buildingCount > 0
  const allBuildingsMapped = hasBuildings && unmappedBuildingCount === 0

  const roomsRequired = !isOpenArea
  const buildingsRequired = isBuildingsAndRooms

  const roomsOk = roomsRequired ? hasRooms : true
  const buildingsOk = buildingsRequired ? hasBuildings : true
  const buildingsMappedOk = buildingsRequired ? allBuildingsMapped : true

  const items = [
    {
      key: 'mapped',
      label: 'Mapped on Map',
      ok: Boolean(center.has_map),
      fix: onPlaceOnMap,
      actionLabel: 'Place on map',
    },
    ...(!isOpenArea
      ? [
          {
            key: 'rooms',
            label: 'Rooms Defined',
            ok: roomsOk,
            fix: roomsRequired && !roomsOk ? onAddRooms : undefined,
            actionLabel: 'Add room',
          },
        ]
      : []),
    ...(isBuildingsAndRooms
      ? [
          {
            key: 'buildings',
            label: 'Buildings Defined',
            ok: buildingsOk,
            fix: buildingsRequired && !buildingsOk ? onAddBuilding : undefined,
            actionLabel: 'Add building',
          },
          {
            key: 'buildings_mapped',
            label: hasBuildings
              ? `Buildings Mapped (${mappedBuildingCount}/${buildingCount})`
              : 'Buildings Mapped on Map',
            ok: buildingsMappedOk,
            fix: !buildingsMappedOk ? (hasBuildings ? onPlaceOnMap : onAddBuilding) : undefined,
            actionLabel: hasBuildings ? 'Map buildings' : 'Add building',
          },
        ]
      : []),
    {
      key: 'entrance',
      label: 'Entrance Point Set',
      ok: Boolean(center.entrancePoint || center.has_map),
      fix: onSetEntrance,
      actionLabel: 'Set entrance',
    },
    {
      key: 'contact',
      label: 'Contact Number',
      ok: Boolean(center.contact_number),
      fix: onEditContact,
      actionLabel: 'Add contact',
    },
    {
      key: 'accessibility',
      label: 'Accessibility Info',
      ok: Boolean(Array.isArray(center.amenities) ? center.amenities.length > 0 : center.amenities),
      fix: onEditAccessibility,
      actionLabel: 'Add amenities',
    },
  ]

  const readyCount = items.filter((item) => item.ok).length
  const totalCount = items.length
  const percent = Math.round((readyCount / totalCount) * 100)
  const allReady = readyCount === totalCount

  return (
    <div className="ec-readiness-card">
      <div className="ec-readiness-header">
        <div className="ec-readiness-title-wrap">
          <h3 className="ec-readiness-title">Readiness Checklist</h3>
        </div>

        <div className="ec-readiness-score-box">
          <div className="ec-readiness-score-text">
            <span className="ec-readiness-score-num">
              {readyCount} of {totalCount}
            </span>
            <span className="ec-readiness-score-label">
              {allReady ? 'Fully Ready' : 'In Progress'}
            </span>
          </div>
          <div className="ec-readiness-track">
            <div
              className={`ec-readiness-bar ${allReady ? 'is-complete' : ''}`}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      </div>

      <div className="ec-readiness-list" role="list">
        {items.map((item) => {
          return (
            <div
              key={item.key}
              className="ec-readiness-item-line"
              role="listitem"
            >
              <div className="ec-readiness-line-left">
                <FontAwesomeIcon
                  icon={item.ok ? faCircleCheck : faTriangleExclamation}
                  className={`ec-readiness-status-icon ${item.ok ? 'icon-ready' : 'icon-pending'}`}
                />
                <span className="ec-readiness-line-label">{item.label}</span>
              </div>

              <div className="ec-readiness-line-right">
                {item.ok ? (
                  <span className="ec-readiness-pill is-ok">Ready</span>
                ) : item.fix ? (
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.preventDefault()
                      item.fix()
                    }}
                    className="ec-readiness-btn"
                  >
                    <span>{item.actionLabel || 'Configure'}</span>
                    <FontAwesomeIcon icon={faArrowRight} size="xs" />
                  </button>
                ) : (
                  <span className="ec-readiness-pill is-pending">Action needed</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

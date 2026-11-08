import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCircleCheck,
  faTriangleExclamation,
  faMinus,
  faListCheck,
  faArrowRight,
  faLocationDot,
  faDoorOpen,
  faBuilding,
  faMapPin,
  faPhone,
  faWheelchair,
} from '@fortawesome/free-solid-svg-icons'

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

  const isSingleVenue = center.center_type === 'single_venue'
  const isPrivateProperty = center.center_type === 'private_property'
  const isCampus = center.center_type === 'campus' || !center.center_type

  // Determine room/building readiness based on center type
  const roomCount = Number(
    center.room_count ?? center.total_rooms ?? center.rooms?.length ?? 0
  )
  const buildingCount = Number(
    center.building_count ?? center.buildings?.length ?? 0
  )
  const hasRooms = roomCount > 0
  const hasBuildings = buildingCount > 0

  const roomsRequired = !isSingleVenue
  const buildingsRequired = isCampus

  const roomsOk = roomsRequired ? hasRooms : true
  const buildingsOk = buildingsRequired ? hasBuildings : true

  const items = [
    {
      key: 'mapped',
      label: 'Mapped on Map',
      icon: faLocationDot,
      ok: Boolean(center.has_map),
      exempt: false,
      fix: onPlaceOnMap,
      actionLabel: 'Place on map',
      hint: 'Position center on the municipal map for routing and evacuee navigation.',
    },
    {
      key: 'rooms',
      label: 'Rooms Defined',
      icon: faDoorOpen,
      ok: roomsOk,
      exempt: !roomsRequired,
      fix: roomsRequired && !roomsOk ? onAddRooms : undefined,
      actionLabel: 'Add room',
      hint: isSingleVenue
        ? 'Not required — single venue allocates directly to the center.'
        : hasRooms
          ? `${roomCount} active room${roomCount === 1 ? '' : 's'} configured for evacuee allocation.`
          : isPrivateProperty
            ? 'Add rooms to assign evacuee households.'
            : 'Add rooms to begin allocating evacuee families.',
    },
    {
      key: 'buildings',
      label: 'Buildings Defined',
      icon: faBuilding,
      ok: buildingsOk,
      exempt: !buildingsRequired && !hasBuildings,
      fix: buildingsRequired && !buildingsOk ? onAddBuilding : undefined,
      actionLabel: 'Add building',
      hint: isSingleVenue
        ? 'Not required for single venue facilities.'
        : isPrivateProperty
          ? 'Not required for private properties.'
          : hasBuildings
            ? `${buildingCount} building${buildingCount === 1 ? '' : 's'} configured to organize rooms and structures.`
            : 'Define buildings to organize rooms and structures.',
    },
    {
      key: 'entrance',
      label: 'Entrance Point Set',
      icon: faMapPin,
      ok: Boolean(center.entrancePoint || center.has_map),
      exempt: false,
      fix: onSetEntrance,
      actionLabel: 'Set entrance',
      hint: 'Mark recommended access gateway for emergency responders.',
    },
    {
      key: 'contact',
      label: 'Contact Number',
      icon: faPhone,
      ok: Boolean(center.contact_number),
      exempt: false,
      fix: onEditContact,
      actionLabel: 'Add contact',
      hint: 'Designate on-duty phone line for center administrator.',
    },
    {
      key: 'accessibility',
      label: 'Accessibility Info',
      icon: faWheelchair,
      ok: Boolean(center.accessibility_notes),
      exempt: false,
      fix: onEditAccessibility,
      actionLabel: 'Add notes',
      hint: 'Record ramps, rails, and accessibility accommodations.',
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
          <div className={`ec-readiness-icon-bubble ${allReady ? 'is-complete' : ''}`}>
            <FontAwesomeIcon icon={faListCheck} />
          </div>
          <div>
            <h3 className="ec-readiness-title">Readiness Checklist</h3>
            <p className="ec-readiness-sub">Operational status for disaster mobilization</p>
          </div>
        </div>

        <div className="ec-readiness-score-box">
          <div className="ec-readiness-score-text">
            <span className="ec-readiness-score-num">{readyCount} of {totalCount}</span>
            <span className="ec-readiness-score-label">{allReady ? 'Fully Ready' : 'In Progress'}</span>
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
          const isExempt = Boolean(item.exempt)
          const isPending = !item.ok && !isExempt
          const isReady = item.ok && !isExempt

          return (
            <div
              key={item.key}
              className={`ec-readiness-item ${isReady ? 'is-ready' : isPending ? 'is-pending' : 'is-exempt'}`}
              role="listitem"
            >
              <div className="ec-readiness-left">
                <div className="ec-readiness-status-icon" aria-hidden="true">
                  {isReady && <FontAwesomeIcon icon={faCircleCheck} className="icon-ready" />}
                  {isPending && <FontAwesomeIcon icon={faTriangleExclamation} className="icon-pending" />}
                  {isExempt && <FontAwesomeIcon icon={faMinus} className="icon-exempt" />}
                </div>

                <div className="ec-readiness-content">
                  <div className="ec-readiness-label-row">
                    <span className="ec-readiness-label">{item.label}</span>
                    {isExempt && (
                      <span className="ec-readiness-tag is-exempt">Exempt</span>
                    )}
                    {isReady && (
                      <span className="ec-readiness-tag is-ready">Verified</span>
                    )}
                    {isPending && (
                      <span className="ec-readiness-tag is-pending">Action Needed</span>
                    )}
                  </div>
                  <p className="ec-readiness-hint">{item.hint}</p>
                </div>
              </div>

              <div className="ec-readiness-right">
                {isPending && item.fix && (
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
                )}
                {isReady && (
                  <span className="ec-readiness-pill is-ok">
                    Ready
                  </span>
                )}
                {isExempt && (
                  <span className="ec-readiness-pill is-na">
                    Not required
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

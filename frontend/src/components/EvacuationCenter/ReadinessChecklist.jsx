
/**
 * ReadinessChecklist - Shows readiness items for a center
 * For single_venue centers, "Rooms added" and "Buildings" are NOT required
 * For private_property centers, "Rooms added" IS required but "Buildings" is NOT
 * For campus centers, both "Rooms added" and "Buildings" are required
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
  const hasRooms = Number(center.room_count || 0) > 0
  const hasBuildings = Number(center.building_count || 0) > 0

  // For single_venue: neither rooms nor buildings required
  // For private_property: rooms required, buildings NOT required
  // For campus: both rooms and buildings required
  const roomsRequired = !isSingleVenue
  const buildingsRequired = isCampus

  const roomsOk = roomsRequired ? hasRooms : true
  const buildingsOk = buildingsRequired ? hasBuildings : true

  const items = [
    {
      key: 'mapped',
      label: 'Mapped on map',
      ok: Boolean(center.has_map),
      fix: onPlaceOnMap,
      hint: 'Place this center on the map so it can be routed to.',
    },
    {
      key: 'rooms',
      label: 'Rooms defined',
      ok: roomsOk,
      fix: roomsRequired && !roomsOk ? onAddRooms : undefined,
      hint: isSingleVenue
        ? 'Not required for single venue centers.'
        : isPrivateProperty
          ? 'Add at least one room for household assignments.'
          : 'Add at least one room so households can be assigned.',
    },
    {
      key: 'buildings',
      label: 'Buildings defined',
      ok: buildingsOk,
      fix: buildingsRequired && !buildingsOk ? onAddBuilding : undefined,
      hint: isSingleVenue
        ? 'Not required for single venue centers.'
        : isPrivateProperty
          ? 'Not required for private property centers.'
          : 'Add at least one building to organize rooms.',
    },
    {
      key: 'entrance',
      label: 'Entrance point set',
      ok: Boolean(center.entrancePoint || center.has_map),
      fix: onSetEntrance,
      hint: 'Set a recommended entrance point for responders.',
    },
    {
      key: 'contact',
      label: 'Contact number',
      ok: Boolean(center.contact_number),
      fix: onEditContact,
      hint: 'Add a contact number for the center manager.',
    },
    {
      key: 'accessibility',
      label: 'Accessibility info',
      ok: Boolean(center.accessibility_notes),
      fix: onEditAccessibility,
      hint: 'Record accessibility notes for the venue.',
    },
  ]

  return (
    <div className="ds-card">
      <h3 style={{ fontSize: 'var(--text-lg)', fontFamily: 'var(--font-display)', marginBottom: 'var(--space-3)' }}>
        Readiness checklist
      </h3>
      {items.map((item) => (
        <div
          key={item.key}
          className="ec-readiness-item"
          role="listitem"
          style={{ opacity: item.ok === true && item.fix === undefined ? 0.6 : 1 }}
        >
          <span
            className={`ds-badge ds-badge--${item.ok ? 'success' : 'warning'}`}
            style={{ fontSize: 'var(--text-xs)' }}
          >
            {item.ok ? 'Yes' : item.fix === undefined ? 'N/A' : 'No'} {item.label}
          </span>
          {!item.ok && item.fix && (
            <a
              href="#"
              onClick={(ev) => {
                ev.preventDefault()
                item.fix()
              }}
              className="ec-readiness-link"
              style={{ marginLeft: 'auto', padding: 0 }}
            >
              {item.hint}
            </a>
          )}
          {item.ok === true && item.fix === undefined && (
            <span className="ec-readiness-na" style={{ marginLeft: 'auto', fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>
              Not required
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
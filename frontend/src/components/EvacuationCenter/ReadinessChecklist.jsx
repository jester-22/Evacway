
/**
 * ReadinessChecklist - Shows readiness items for a center
 * For single_venue centers, "Rooms added" is NOT required (shows as N/A or hidden)
 */
export default function ReadinessChecklist({
  center,
  onPlaceOnMap,
  onAddRooms,
  onSetEntrance,
  onEditContact,
  onEditAccessibility,
}) {
  if (!center) return null

  const isSingleVenue = center.center_type === 'single_venue'

  // For single_venue: no rooms/buildings required
  // For private_property (house/single building): rooms required but no separate building step
  // For campus (multi-building): buildings and rooms required

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
      // For single_venue, this is N/A (not required)
      // For private_property and campus, check building_count or roomsDefined
      ok: isSingleVenue ? true : Boolean(center.building_count || center.roomsDefined),
      fix: isSingleVenue ? undefined : onAddRooms,
      hint: isSingleVenue
        ? 'Not required for single venue centers.'
        : 'Add at least one room so households can be assigned.',
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
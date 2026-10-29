import { useState, useEffect, useRef } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faMapPin, faXmark } from '@fortawesome/free-solid-svg-icons'
import { centerNeedsMapping, MAPPING_BANNER_STORAGE_KEY } from './utils'

/**
 * MappingBanner - Shows a banner for centers that aren't mapped yet
 * with a "Place on map" button that starts the placement flow.
 * Dismissal is persisted per-center in localStorage.
 */
export function MappingBanner({ center, onPlaceOnMap, onDismiss }) {
  const key = center?.id
    ? `${MAPPING_BANNER_STORAGE_KEY}-${center.id}`
    : MAPPING_BANNER_STORAGE_KEY

  const [dismissed, setDismissed] = useState(() => {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem(key) === '1'
    } catch {
      return false
    }
  })

  const prevCenterRef = useRef(center)

  // Re-check if center still needs mapping (in case it was mapped elsewhere)
  useEffect(() => {
    if (!dismissed) return
    const needs = centerNeedsMapping(center)
    if (!needs) {
      // Center was mapped elsewhere, reset dismissal so banner shows again if needed
      // Use setTimeout to avoid calling setState synchronously in effect
      setTimeout(() => {
        setDismissed(false)
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.removeItem(key)
          }
        } catch {
          // Ignore localStorage errors
        }
      }, 0)
    }
    prevCenterRef.current = center
  }, [center, key, dismissed])

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
        <button
          type="button"
          className="ds-btn ds-btn--primary ds-btn--sm"
          onClick={() => { onPlaceOnMap?.() }}
        >
          <FontAwesomeIcon icon={faMapPin} size="xs" /> Place on map
        </button>
        <button
          type="button"
          className="ds-btn ds-btn--ghost ds-btn--sm"
          onClick={handleDismiss}
        >
          <FontAwesomeIcon icon={faXmark} size="xs" />
        </button>
      </div>
    </div>
  )
}

export default MappingBanner
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
      // localStorage unavailable or quota exceeded
    }
    onDismiss?.()
  }

  return (
    <div className="ec-mapping-banner" role="status" aria-label="Mapping notice">
      <div className="ec-mapping-banner-left">
        <div className="ec-mapping-icon-bubble">
          <FontAwesomeIcon icon={faMapPin} />
        </div>
        <div className="ec-mapping-banner-text">
          <p className="ec-mapping-title">
            This center isn't on the map yet
          </p>
          <p className="ec-mapping-desc">
            Place it on the map so staff can route families here.
          </p>
        </div>
      </div>
      <div className="ec-mapping-banner-actions">
        <button
          type="button"
          className="ec-btn-place-map"
          onClick={() => { onPlaceOnMap?.() }}
        >
          <FontAwesomeIcon icon={faMapPin} />
          <span>Place on map</span>
        </button>
        <button
          type="button"
          className="ec-btn-dismiss-banner"
          onClick={handleDismiss}
          title="Dismiss notice"
          aria-label="Dismiss notice"
        >
          <FontAwesomeIcon icon={faXmark} />
        </button>
      </div>
    </div>
  )
}

export default MappingBanner

import { useEffect } from 'react'

// Status thresholds & helpers are defined in ./evacuationStatus and re-exported
// here so existing imports from './utils' keep working unchanged.
export {
  OCCUPANCY_THRESHOLDS,
  VULNERABILITY_KEYWORDS,
  centerStatus,
  statusVariant,
  computeCenterCheckedIn,
  computeCenterAssigned,
  computeOccupancySegments,
} from './evacuationStatus'

import { VULNERABILITY_KEYWORDS } from './evacuationStatus'

export function sumRooms(rooms, field) {
  return rooms.reduce((sum, r) => sum + (Number(r[field]) || 0), 0)
}

export function computeCenterCapacity(center, rooms) {
  const explicit = Number(center.capacity)
  if (explicit > 0) return explicit
  return sumRooms(rooms, 'capacity')
}

export function centerNeedsMapping(center) {
  return center.has_map === false || center.has_map === undefined
}

export function isCenterMapped(item) {
  if (!item) return false
  const geom = item.geometry || item.geom
  if (geom && Array.isArray(geom.coordinates) && geom.coordinates.length > 0) {
    return true
  }
  const props = item.properties || item
  if (props.has_map !== undefined) {
    return Boolean(props.has_map)
  }
  return false
}

export function countVulnerable(families = []) {
  return families.filter((fam) => {
    const needs = Array.isArray(fam.special_needs) ? fam.special_needs : []
    const text = [...needs, String(fam.special_needs || '')].join(' ').toLowerCase()
    return VULNERABILITY_KEYWORDS.some((k) => text.includes(k))
  }).length
}

export function vulnerableBreakdown(families = []) {
  const counts = {}
  VULNERABILITY_KEYWORDS.forEach((k) => (counts[k] = 0))
  families.forEach((fam) => {
    const needs = Array.isArray(fam.special_needs) ? fam.special_needs : []
    const text = [...needs, String(fam.special_needs || '')].join(' ').toLowerCase()
    VULNERABILITY_KEYWORDS.forEach((k) => {
      if (text.includes(k)) counts[k] = (counts[k] || 0) + 1
    })
  })
  return counts
}

export function formatBarangays(barangays = [], maxShow = 2) {
  if (!Array.isArray(barangays)) return []
  const names = barangays.map((b) => (typeof b === 'string' ? b : b.name || b)).filter(Boolean)
  return names.slice(0, maxShow)
}

export function plusN(barangays = [], maxShow = 2) {
  if (!Array.isArray(barangays)) return 0
  const names = barangays.map((b) => (typeof b === 'string' ? b : b.name || b)).filter(Boolean)
  return Math.max(0, names.length - maxShow)
}

/** Strip digits from a name field. Name fields must not accept digits. */
export function stripDigits(value = '') {
  return String(value).replace(/\d/g, '')
}

/**
 * Escape-to-close hook for modals/drawers.
 * Calls onEscape when Escape is pressed while enabled.
 */
export function useEscapeKey(enabled, onEscape) {
  useEffect(() => {
    if (!enabled || !onEscape) return undefined
    function onKeyDown(ev) {
      if (ev.key === 'Escape') onEscape()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [enabled, onEscape])
}

export const CENTER_TABS = [
  { key: 'overview', label: 'Overview', icon: 'faChartPie' },
  { key: 'structure', label: 'Structure', icon: 'faBuilding' },
  { key: 'households', label: 'Households', icon: 'faPeopleGroup' },
  { key: 'activity', label: 'Activity', icon: 'faClockRotateLeft' },
]

export const MAPPING_BANNER_STORAGE_KEY = 'evacway:dismissed-mapping-banner'
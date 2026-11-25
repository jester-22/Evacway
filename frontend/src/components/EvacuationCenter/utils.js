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
} from './evacuationStatus.js'

import { VULNERABILITY_KEYWORDS } from './evacuationStatus.js'

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

/** Use family terminology for legacy relationship labels without changing stored values. */
export function familyTerm(value) {
  return String(value ?? '').replace(/\bhouseholds?\b/gi, (word) => {
    const replacement = /s$/i.test(word) ? 'families' : 'family'
    if (word === word.toUpperCase()) return replacement.toUpperCase()
    if (word[0] === word[0].toUpperCase()) {
      return replacement[0].toUpperCase() + replacement.slice(1)
    }
    return replacement
  })
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
  { key: 'households', label: 'Families', icon: 'faPeopleGroup' },
  { key: 'activity', label: 'Activity', icon: 'faClockRotateLeft' },
]

export function resolveCenterStructureMode(center) {
  const props = center?.properties || center || {}
  const rawMode = String(props.structure_mode || props.center_structure || '')
    .trim()
    .toLowerCase()
  if (
    rawMode === 'open_area' ||
    rawMode === 'rooms_only' ||
    rawMode === 'buildings_and_rooms'
  ) {
    return rawMode
  }
  const typeCode = String(props.center_type || '').trim().toLowerCase()
  if (typeCode === 'single_venue') return 'open_area'
  if (typeCode === 'private_property') return 'rooms_only'
  return 'buildings_and_rooms'
}

const OPERATIONAL_BUILDING_STATUSES = new Set(['open', 'closed', 'under_repair'])

export function resolveBuildingOperationalStatus(building, room = null) {
  const candidates = [
    room?.building_status,
    building?.operational_status,
    building?.properties?.operational_status,
    building?.properties?.building_status,
    building?.status,
    building?.properties?.status,
  ]
  for (const raw of candidates) {
    const normalized = String(raw || '').trim().toLowerCase()
    if (OPERATIONAL_BUILDING_STATUSES.has(normalized)) {
      return normalized
    }
  }
  return 'open'
}

export const MAPPING_BANNER_STORAGE_KEY = 'evacway:dismissed-mapping-banner'

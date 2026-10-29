# Task 2 - Map Page Overhaul: Step 0 FINDINGS

## Draw Flow Functions

### 1. `startPlacementFlow(center)` (AdminMap.jsx:1193-1218)
- Sets `editingCenter` to the center
- Sets `selectedCenter` to the center
- Converts center geometry to footprint points via `polygonToPoints(center.geometry)`
- Normalizes entrances from `props.entrances` array
- Sets mapping tool to "draw", mapping step to "footprint", `isMapping` to true
- Closes bottom sheet if open
- **Use case**: Full center placement flow (polygon + entrances + buildings)

### 2. `startAddBuildingFlowForCenter(center)` (AdminMap.jsx:647-690)
- Sets `selectedCenter` and panel states (`panelSubView="map_rooms"`, `mapRoomsTab="buildings"`)
- Focuses map on center using `getCenterCoordinates(center)`
- Calculates default building name: "Building N" based on existing count
- Sets `isAddingBuilding=true`, `isDrawingBuilding=true`, `addBuildingStep="draw"`
- Initializes `newBuildingPoints=[], newBuildingName, newBuildingRoomIds=[]`
- **Use case**: Add a building to an existing mapped center

---

## Center Mapped Status

### `isCenterMapped(center)` (DashboardMap.jsx:243-256)
```javascript
export function isCenterMapped(center) {
  if (!center) return false;
  const geom = center.geometry || center.geom;
  if (geom && Array.isArray(geom.coordinates) && geom.coordinates.length > 0) {
    return true;
  }
  const props = center.properties || center;
  if (props.has_map !== undefined) {
    return Boolean(props.has_map);
  }
  const lat = Number(props.latitude ?? center.latitude);
  const lng = Number(props.longitude ?? center.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng);
}
```
**Checks in order:**
1. `center.geometry.coordinates` (or `center.geom`) - polygon exists
2. `props.has_map` boolean flag
3. `props.latitude` / `props.longitude` - point location

---

## Building Mapped Status

### Determined by `building.geometry` existence
- **AdminMap.jsx:456** - `getPolygonCentroid(building.geometry)` called when clicking building row
- **`getPolygonCentroid` function** (AdminMap.jsx:77-104) - extracts centroid from polygon geometry
- Building is "mapped" if `building.geometry` exists with valid coordinates
- Building is "unmapped" if `building.geometry` is null/undefined or has empty coordinates

---

## Incident Marker Code

### Location: AdminMap.jsx:1122-1190 (useEffect)
```javascript
// Only show incident marker for Hazard Reports/Rescue Alerts with explicit incident param
useEffect(() => {
  if (deepLinkedLat && deepLinkedLng && (deepLinkedHazardId || deepLinkedRescueId)) {
    // ... creates label and sets mapFocusLocation with hazardId/rescueId
  } else if (!deepLinkedHazardId && !deepLinkedRescueId) {
    // Clear incident marker when no hazard/rescue param
    setMapFocusLocation(null);
  }
}, [...]);
```

**Behavior:**
- Shows "Incident Location" marker ONLY when URL has `?lat=X&lng=Y&hazard=ID` or `?lat=X&lng=Y&rescue=ID`
- Clears marker when user navigates away from hazard/rescue deep link (e.g., selects a center)
- Label includes hazard type and barangay when available

---

## Center List Item Rendering

### `renderCenterItem(center)` (AdminMap.jsx:1492-1657)
- Uses `isCenterMapped(center)` for "Not mapped" exception badge
- Shows center type badge (Campus/Private Property/Single Venue)
- Displays room count and building count (for campus only)
- Shows "Add building" button for campus centers with 0 buildings
- Occupancy bar with assigned (grey) and occupied (colored) segments
- Exception badges: Not mapped, Inactive, Full

---

## Center Modal Structure

### Header (AdminMap.jsx:3405-3441)
- Title + Active/Inactive status badge
- "Not mapped" badge for campus centers without geometry
- Subtitle: barangay, address, owner (for private_property)
- Close button

### Summary (AdminMap.jsx:3444-3517)
- Occupancy text + Full/Fully assigned chips
- Progress bar (assigned + occupied)
- Stats row: rooms/buildings (campus) OR space type + spaces left (venue/house)

### Buildings List (AdminMap.jsx:3713-3810)
- For campus: list of building rows with swatch, name, room count, occupancy, chevron
- For venue/house: assigned households list
- Empty state with "Add building" button for campus

### Footer (AdminMap.jsx:3814-3831)
- Close button (secondary)
- "Manage center" button (text style) - navigates to centers tab

---

## Current CSS Classes (AdminMap.css)

### Center List Item
- `.admin-map-center-item` - container (min-height 72px, flex layout)
- `.admin-map-center-type-badge` - type badge with custom color per type
- `.admin-map-item-main` - main content area
- `.admin-map-item-title-row` - name + status dot + type badge
- `.admin-map-item-sub` - barangay + room/building counts
- `.admin-map-item-badge-wrap` - "X of Y here" + exception badge
- `.admin-map-item-occ-bar` - occupancy progress bar

### Center Modal
- `.admin-center-modal-backdrop` - fixed overlay, centered (desktop) / bottom sheet (mobile)
- `.admin-center-modal-dialog` - max-width 520px, max-height 85vh, border-radius 16px
- `.admin-center-modal-header` - fixed header with title, badges, close
- `.admin-center-modal-summary` - fixed summary with occupancy
- `.admin-center-modal-buildings-section` - scrollable list area
- `.admin-center-modal-building-row` - building row (min-height 48px)
- `.admin-center-modal-footer` - fixed footer with Close + Manage center

---

## Icon Imports Already Available
- `faBuildingColumns` - campus buildings
- `faHome` - private property
- `faPlaceOfWorship` - single venue
- `faWarehouse` - building count icon
- `faMapPin` - location/mapped indicator
- `faCircleExclamation` - alert/warning
- `faDrawPolygon` - draw building
- `faPen` - edit
- `faEye` - view
- `faCheckDouble` - validated
- `faLink` / `faUnlink` - linked/unlinked
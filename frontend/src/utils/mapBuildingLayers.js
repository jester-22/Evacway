import mapboxgl from "mapbox-gl";

/**
 * Shared Mapbox GL layer utilities for Buildings and Entrances.
 * Both residentHome.jsx and DashboardMap.jsx share this code.
 *
 * Rules:
 * 1. Zero DOM markers for rooms or buildings; all rendered as native Mapbox GL layers.
 * 2. Entrance markers are rendered as native Mapbox GL layers (circle + symbol)
 *    so everything stays 100% locked to the map with zero drift/lag on pan/zoom.
 * 3. Fill color by occupancy: green = available, amber = >70% full, red = full, gray = no data.
 *    Fill opacity ~0.55, outline 2px in darker matching color.
 *    Selected building: thicker outline (3.5px) and lift in fill opacity (0.80).
 * 4. Labels ("Building Name" or "Rm 3-6") only visible at building zoom (minzoom 17) where it fits inside.
 * 5. Touch target >= 44px with 24px bounding-box query.
 */

export const BUILDINGS_SOURCE_ID = "evacway-buildings-source";
export const BUILDINGS_FILL_LAYER = "evacway-buildings-fill";
export const BUILDINGS_HALO_LAYER = "evacway-buildings-outline-halo";
export const BUILDINGS_OUTLINE_LAYER = "evacway-buildings-outline";
export const BUILDINGS_SYMBOL_LAYER = "evacway-buildings-symbol";
export const BUILDING_MIN_ZOOM = 14;

export const ENTRANCES_SOURCE_ID = "evacway-entrances-source";
export const ENTRANCES_CIRCLE_LAYER = "evacway-entrances-circle";
export const ENTRANCES_SYMBOL_LAYER = "evacway-entrances-symbol";
export const ENTRANCES_MIN_ZOOM = BUILDING_MIN_ZOOM;
export const ENTRANCE_LABEL_MIN_ZOOM = BUILDING_MIN_ZOOM + 1;

/**
 * Remove any active building hover/tap tooltip and clear hover feature-state.
 */
export function removeBuildingTooltip(map) {
  if (!map) return;
  if (map.__buildingTooltip) {
    try {
      map.__buildingTooltip.remove();
    } catch (e) {}
    map.__buildingTooltip = null;
  }
  try {
    if (map.getCanvas()) {
      map.getCanvas().style.cursor = "";
    }
  } catch (e) {}

  const prevHoverId = map.__hoveredBuildingFeatureId;
  if (prevHoverId !== undefined && prevHoverId !== null) {
    try {
      if (map.getStyle() && map.getSource(BUILDINGS_SOURCE_ID)) {
        map.setFeatureState(
          { source: BUILDINGS_SOURCE_ID, id: prevHoverId },
          { hover: false }
        );
      }
    } catch (e) {}
    map.__hoveredBuildingFeatureId = null;
  }
  if (map.__buildingHoverNotify) {
    try {
      map.__buildingHoverNotify(null);
    } catch (e) {}
  }
}

/**
 * Initialize building layers on the map. Safe to call multiple times or after style reload.
 */
export function initBuildingLayers(map, onBuildingClick = null, options = {}) {
  if (!map) return;
  if (!map.getStyle()) {
    const onReady = () => initBuildingLayers(map, onBuildingClick, options);
    map.once("style.load", onReady);
    map.once("load", onReady);
    return;
  }

  const { enableTooltip = false, onHoverChange = null } = options;

  // Add source if missing
  try {
    if (!map.getSource(BUILDINGS_SOURCE_ID)) {
      map.addSource(BUILDINGS_SOURCE_ID, {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });
    }
  } catch (err) {
    const retry = () => initBuildingLayers(map, onBuildingClick, options);
    map.once("style.load", retry);
    map.once("idle", retry);
    return;
  }

  // 1. Fill Layer (0.45 opacity, 0.60 on hover, 0.75 on selected)
  if (!map.getLayer(BUILDINGS_FILL_LAYER)) {
    const layerDef = {
      id: BUILDINGS_FILL_LAYER,
      type: "fill",
      source: BUILDINGS_SOURCE_ID,
      minzoom: 14,
      paint: {
        "fill-color": [
          "coalesce",
          ["get", "fill_color"],
          "#16a34a",
        ],
        "fill-opacity": [
          "case",
          ["boolean", ["feature-state", "user_building"], false],
          0.70,
          ["boolean", ["feature-state", "selected"], false],
          0.75,
          ["boolean", ["feature-state", "hover"], false],
          0.60,
          0.45,
        ],
      },
    };

    try {
      map.addLayer(layerDef);
    } catch (e) {
      layerDef.slot = "top";
      map.addLayer(layerDef);
    }
  }

  // 1.5. White 1px Halo Layer (drawn beneath outline with line-join/line-cap round)
  if (!map.getLayer(BUILDINGS_HALO_LAYER)) {
    const layerDef = {
      id: BUILDINGS_HALO_LAYER,
      type: "line",
      source: BUILDINGS_SOURCE_ID,
      minzoom: 14,
      layout: {
        "line-join": "round",
        "line-cap": "round",
      },
      paint: {
        "line-color": "#ffffff",
        "line-width": [
          "case",
          ["boolean", ["feature-state", "user_building"], false],
          6.0,
          ["boolean", ["feature-state", "selected"], false],
          5.5,
          4.0, // 1px halo extending beyond 2px outline
        ],
        "line-opacity": 0.95,
      },
    };

    try {
      map.addLayer(layerDef);
    } catch (e) {
      layerDef.slot = "top";
      map.addLayer(layerDef);
    }
  }

  // 2. Outline Layer (2px darker outline; rounded joins; thick blue for user's building)
  if (!map.getLayer(BUILDINGS_OUTLINE_LAYER)) {
    const layerDef = {
      id: BUILDINGS_OUTLINE_LAYER,
      type: "line",
      source: BUILDINGS_SOURCE_ID,
      minzoom: 14,
      layout: {
        "line-join": "round",
        "line-cap": "round",
      },
      paint: {
        "line-color": [
          "case",
          ["boolean", ["feature-state", "found_person"], false],
          "#d97706",
          ["boolean", ["feature-state", "user_building"], false],
          "#2563eb", // thick blue outline for resident's building
          ["boolean", ["feature-state", "selected"], false],
          "#0f172a", // thicker dark outline for normal selected building
          ["coalesce", ["get", "outline_color"], "#15803d"],
        ],
        "line-width": [
          "case",
          ["boolean", ["feature-state", "building_pulse"], false],
          6.0,
          ["boolean", ["feature-state", "found_person"], false],
          4.5,
          ["boolean", ["feature-state", "user_building"], false],
          4.5, // visually thicker blue outline for user building
          ["boolean", ["feature-state", "selected"], false],
          4.5, // thicker dark outline for selected building
          ["boolean", ["feature-state", "hover"], false],
          2.5,
          2.0,
        ],
      },
    };

    try {
      map.addLayer(layerDef);
    } catch (e) {
      layerDef.slot = "top";
      map.addLayer(layerDef);
    }
  }

  // 3. Symbol Layer for room ranges or building names (minzoom 17 so it only shows when it fits)
  if (!map.getLayer(BUILDINGS_SYMBOL_LAYER)) {
    const layerDef = {
      id: BUILDINGS_SYMBOL_LAYER,
      type: "symbol",
      source: BUILDINGS_SOURCE_ID,
      minzoom: 17,
      layout: {
        "text-field": [
          "coalesce",
          ["get", "name"],
          ["get", "display_label"],
          "",
        ],
        "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
        "text-size": 14,
        "text-anchor": "center",
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": "#0f172a",
        "text-halo-color": "#ffffff",
        "text-halo-width": 2,
      },
    };

    try {
      map.addLayer(layerDef);
    } catch (e) {
      layerDef.slot = "top";
      map.addLayer(layerDef);
    }
  }

  // Setup cursor, hover state, and lifecycle-managed tooltip
  map.__hoveredBuildingFeatureId = map.__hoveredBuildingFeatureId ?? null;
  map.__buildingHoverNotify = onHoverChange || null;

  const isTouchLikeEvent = (e) => {
    const ptrType = e?.originalEvent?.pointerType;
    if (ptrType === "touch") return true;
    if (ptrType === "mouse" || ptrType === "pen") return false;
    return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)")?.matches;
  };

  const showBuildingTooltip = (feat, lngLat) => {
    if (!enableTooltip || !map || map.__pickingLocation || map.getZoom() < BUILDING_MIN_ZOOM) {
      return;
    }
    if (map.__buildingTooltip) {
      try {
        map.__buildingTooltip.remove();
      } catch (e) {}
      map.__buildingTooltip = null;
    }
    const p = feat.properties || {};
    const bName = p.name || "Building";
    const occ = p.occupied ?? 0;
    const cap = p.capacity ?? 0;
    const assigned = p.assigned ?? 0;
    const popup = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: "evacway-building-hover-tooltip",
      offset: 12,
    });
    popup
      .setLngLat(lngLat)
      .setHTML(
        `<div class="bld-tooltip-card"><strong>${bName}</strong><span>${occ} of ${cap} here · ${assigned} assigned</span></div>`
      )
      .addTo(map);
    map.__buildingTooltip = popup;
  };

  // Remove existing listeners if already attached
  if (map.__buildingMouseEnterHandler) {
    map.off("mouseenter", BUILDINGS_FILL_LAYER, map.__buildingMouseEnterHandler);
  }
  if (map.__buildingMouseMoveHandler) {
    map.off("mousemove", BUILDINGS_FILL_LAYER, map.__buildingMouseMoveHandler);
  }
  if (map.__buildingMouseLeaveHandler) {
    map.off("mouseleave", BUILDINGS_FILL_LAYER, map.__buildingMouseLeaveHandler);
  }
  if (map.__buildingZoomDismissHandler) {
    map.off("zoomstart", map.__buildingZoomDismissHandler);
    map.off("zoom", map.__buildingZoomDismissHandler);
    map.off("zoomend", map.__buildingZoomDismissHandler);
  }
  if (map.__buildingMoveDismissHandler) {
    map.off("movestart", map.__buildingMoveDismissHandler);
  }
  if (map.__buildingStyleDismissHandler) {
    map.off("style.load", map.__buildingStyleDismissHandler);
  }
  if (map.__buildingOutsideTapHandler) {
    map.off("click", map.__buildingOutsideTapHandler);
  }

  const handleBuildingHover = (e) => {
    if (map.__pickingLocation || map.getZoom() < BUILDING_MIN_ZOOM) {
      removeBuildingTooltip(map);
      return;
    }
    if (isTouchLikeEvent(e)) {
      return;
    }
    map.getCanvas().style.cursor = "pointer";
    if (e.features && e.features.length > 0) {
      const feat = e.features[0];
      const featId = feat.id;

      if (
        map.__hoveredBuildingFeatureId !== null &&
        map.__hoveredBuildingFeatureId !== featId
      ) {
        try {
          map.setFeatureState(
            { source: BUILDINGS_SOURCE_ID, id: map.__hoveredBuildingFeatureId },
            { hover: false }
          );
        } catch (err) {}
      }

      map.__hoveredBuildingFeatureId = featId;
      try {
        map.setFeatureState(
          { source: BUILDINGS_SOURCE_ID, id: featId },
          { hover: true }
        );
      } catch (err) {}

      showBuildingTooltip(feat, e.lngLat);

      if (onHoverChange) {
        onHoverChange(feat);
      }
    }
  };

  map.__buildingMouseEnterHandler = handleBuildingHover;
  map.__buildingMouseMoveHandler = handleBuildingHover;

  map.__buildingMouseLeaveHandler = () => {
    removeBuildingTooltip(map);
  };

  map.__buildingZoomDismissHandler = () => {
    if (map.getZoom() < BUILDING_MIN_ZOOM || map.__buildingTooltip) {
      removeBuildingTooltip(map);
    }
  };

  map.__buildingMoveDismissHandler = () => {
    removeBuildingTooltip(map);
  };

  map.__buildingStyleDismissHandler = () => {
    removeBuildingTooltip(map);
  };

  map.__buildingOutsideTapHandler = (e) => {
    if (!map.__buildingTooltip) return;
    try {
      const hits = map.queryRenderedFeatures(e.point, { layers: [BUILDINGS_FILL_LAYER] });
      if (!hits || hits.length === 0) {
        removeBuildingTooltip(map);
      }
    } catch (err) {
      removeBuildingTooltip(map);
    }
  };

  map.on("mouseenter", BUILDINGS_FILL_LAYER, map.__buildingMouseEnterHandler);
  map.on("mousemove", BUILDINGS_FILL_LAYER, map.__buildingMouseMoveHandler);
  map.on("mouseleave", BUILDINGS_FILL_LAYER, map.__buildingMouseLeaveHandler);
  map.on("zoomstart", map.__buildingZoomDismissHandler);
  map.on("zoom", map.__buildingZoomDismissHandler);
  map.on("zoomend", map.__buildingZoomDismissHandler);
  map.on("movestart", map.__buildingMoveDismissHandler);
  map.on("style.load", map.__buildingStyleDismissHandler);
  map.on("click", map.__buildingOutsideTapHandler);

  // Click handler
  if (onBuildingClick) {
    if (map.__buildingClickHandler) {
      map.off("click", BUILDINGS_FILL_LAYER, map.__buildingClickHandler);
    }

    map.__buildingClickHandler = (e) => {
      if (map.__pickingLocation || map.getZoom() < BUILDING_MIN_ZOOM) {
        removeBuildingTooltip(map);
        return;
      }
      if (e.features && e.features.length > 0) {
        const feat = e.features[0];
        if (isTouchLikeEvent(e)) {
          showBuildingTooltip(feat, e.lngLat);
        } else {
          removeBuildingTooltip(map);
        }
        onBuildingClick(feat);
      }
    };

    map.on("click", BUILDINGS_FILL_LAYER, map.__buildingClickHandler);
  }
}

/**
 * Synchronize the selected building feature-state
 */
export function setSelectedBuilding(map, selectedBuildingId) {
  if (!map || !map.getStyle() || !map.getSource(BUILDINGS_SOURCE_ID)) return;

  const prevId = map.__currentSelectedBuildingId;
  if (prevId !== undefined && prevId !== null) {
    try {
      map.setFeatureState(
        { source: BUILDINGS_SOURCE_ID, id: Number(prevId) },
        { selected: false }
      );
    } catch (e) {}
  }

  const numId = selectedBuildingId !== undefined && selectedBuildingId !== null
    ? Number(selectedBuildingId)
    : null;
  map.__currentSelectedBuildingId = numId;

  if (numId !== null && !isNaN(numId)) {
    try {
      map.setFeatureState(
        { source: BUILDINGS_SOURCE_ID, id: numId },
        { selected: true }
      );
    } catch (e) {}
  }
}

/**
 * Synchronize the user's assigned building feature-state (thick blue outline)
 */
export function setUserBuilding(map, userBuildingId, kind = "resident") {
  if (!map || !map.getStyle() || !map.getSource(BUILDINGS_SOURCE_ID)) return;

  const idKey = kind === "found" ? "__foundPersonBuildingId" : "__currentUserBuildingId";
  const stateKey = kind === "found" ? "found_person" : "user_building";
  const prevId = map[idKey];
  const numId = userBuildingId !== undefined && userBuildingId !== null
    ? Number(userBuildingId)
    : null;
  if (prevId !== numId) {
    clearInterval(map.__buildingPulseTimers?.[kind]);
  }
  if (prevId !== undefined && prevId !== null) {
    try {
      map.setFeatureState(
        { source: BUILDINGS_SOURCE_ID, id: Number(prevId) },
        { [stateKey]: false, building_pulse: false }
      );
    } catch (e) {}
  }

  map[idKey] = numId;

  if (numId !== null && !isNaN(numId)) {
    try {
      map.setFeatureState(
        { source: BUILDINGS_SOURCE_ID, id: numId },
        { [stateKey]: true }
      );
    } catch (e) {}
  }
}

/**
 * Animate a pulsing highlight around a building outline
 */
export function pulseBuilding(map, buildingId, kind = "resident") {
  if (!map || !buildingId) return;
  setSelectedBuilding(map, buildingId);
  setUserBuilding(map, buildingId, kind);
  map.__buildingPulseTimers ??= {};
  clearInterval(map.__buildingPulseTimers[kind]);
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  let step = 0;
  const maxSteps = 6;
  map.__buildingPulseTimers[kind] = setInterval(() => {
    step++;
    const isSelected = step % 2 === 0;
    try {
      map.setFeatureState(
        { source: BUILDINGS_SOURCE_ID, id: Number(buildingId) },
        { building_pulse: !isSelected }
      );
    } catch (e) {}
    if (step >= maxSteps) {
      clearInterval(map.__buildingPulseTimers[kind]);
      try {
        map.setFeatureState(
          { source: BUILDINGS_SOURCE_ID, id: Number(buildingId) },
          { building_pulse: false }
        );
      } catch (e) {}
    }
  }, 220);
}

/**
 * Set buildings GeoJSON data on map
 */
export function setBuildingsGeoJSON(map, geojsonData) {
  if (!map) return;
  if (!map.getStyle()) {
    const onReady = () => setBuildingsGeoJSON(map, geojsonData);
    map.once("style.load", onReady);
    map.once("load", onReady);
    return;
  }
  let source = null;
  try {
    source = map.getSource(BUILDINGS_SOURCE_ID);
  } catch (e) {}

  if (!source) {
    initBuildingLayers(map);
    try {
      source = map.getSource(BUILDINGS_SOURCE_ID);
    } catch (e) {}
  }

  const cleanData = geojsonData
    ? {
        ...geojsonData,
        features: (geojsonData.features || []).map((f) => {
          const numId = Number(f.properties?.id ?? f.id);
          return {
            ...f,
            id: numId,
            properties: {
              ...f.properties,
              id: numId,
            },
          };
        }),
      }
    : { type: "FeatureCollection", features: [] };

  if (source) {
    try {
      source.setData(cleanData);
    } catch (e) {}
  } else {
    const retry = () => setBuildingsGeoJSON(map, geojsonData);
    map.once("idle", retry);
    map.once("style.load", retry);
  }
}

/**
 * Initialize entrance layers on the map as native Mapbox layers (no DOM drift).
 */
export function initEntranceLayers(map, onEntranceClick = null) {
  if (!map) return;
  if (!map.getStyle()) {
    const onReady = () => initEntranceLayers(map, onEntranceClick);
    map.once("style.load", onReady);
    map.once("load", onReady);
    return;
  }

  try {
    if (!map.getSource(ENTRANCES_SOURCE_ID)) {
      map.addSource(ENTRANCES_SOURCE_ID, {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });
    }
  } catch (err) {
    const retry = () => initEntranceLayers(map, onEntranceClick);
    map.once("style.load", retry);
    map.once("idle", retry);
    return;
  }

  if (!map.getLayer(ENTRANCES_CIRCLE_LAYER)) {
    const layerDef = {
      id: ENTRANCES_CIRCLE_LAYER,
      type: "circle",
      source: ENTRANCES_SOURCE_ID,
      minzoom: ENTRANCES_MIN_ZOOM,
      paint: {
        "circle-radius": [
          "case",
          ["boolean", ["get", "is_chosen"], false],
          9,
          7,
        ],
        "circle-color": [
          "case",
          ["boolean", ["get", "is_chosen"], false],
          "#16a34a",
          "#2563eb",
        ],
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
        "circle-opacity": [
          "case",
          ["boolean", ["get", "is_dimmed"], false],
          0.35,
          1.0,
        ],
      },
    };
    try {
      map.addLayer(layerDef);
    } catch (e) {
      layerDef.slot = "top";
      map.addLayer(layerDef);
    }
  }

  if (!map.getLayer(ENTRANCES_SYMBOL_LAYER)) {
    const layerDef = {
      id: ENTRANCES_SYMBOL_LAYER,
      type: "symbol",
      source: ENTRANCES_SOURCE_ID,
      minzoom: ENTRANCE_LABEL_MIN_ZOOM,
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
        "text-size": 14,
        "text-offset": [0, 1.25],
        "text-anchor": "top",
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": "#0f172a",
        "text-halo-color": "#ffffff",
        "text-halo-width": 2,
        "text-opacity": [
          "case",
          ["boolean", ["get", "is_dimmed"], false],
          0.35,
          1.0,
        ],
      },
    };
    try {
      map.addLayer(layerDef);
    } catch (e) {
      layerDef.slot = "top";
      map.addLayer(layerDef);
    }
  }

  map.on("mouseenter", ENTRANCES_CIRCLE_LAYER, () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", ENTRANCES_CIRCLE_LAYER, () => {
    map.getCanvas().style.cursor = "";
  });

  if (onEntranceClick) {
    map.on("click", ENTRANCES_CIRCLE_LAYER, (e) => {
      if (e.features && e.features.length > 0) {
        onEntranceClick(e.features[0]);
      }
    });
  }
}

/**
 * Set entrances GeoJSON data on map
 */
export function setEntrancesGeoJSON(map, geojsonData) {
  if (!map) return;
  if (!map.getStyle()) {
    const onReady = () => setEntrancesGeoJSON(map, geojsonData);
    map.once("style.load", onReady);
    map.once("load", onReady);
    return;
  }
  let source = null;
  try {
    source = map.getSource(ENTRANCES_SOURCE_ID);
  } catch (e) {}

  if (!source) {
    initEntranceLayers(map);
    try {
      source = map.getSource(ENTRANCES_SOURCE_ID);
    } catch (e) {}
  }

  if (source) {
    try {
      source.setData(geojsonData || { type: "FeatureCollection", features: [] });
    } catch (e) {}
  } else {
    const retry = () => setEntrancesGeoJSON(map, geojsonData);
    map.once("idle", retry);
    map.once("style.load", retry);
  }
}


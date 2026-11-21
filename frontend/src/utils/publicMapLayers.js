export const PUBLIC_MAP_LAYER_GROUPS = Object.freeze({
  centers: [
    "evacuation-centers-fill",
    "evacuation-centers-line",
    "evacuation-centers-label",
    "evacway-buildings-fill",
    "evacway-buildings-outline-halo",
    "evacway-buildings-outline",
    "evacway-buildings-symbol",
    "evacway-entrances-circle",
    "evacway-entrances-symbol",
  ],
  hazards: [
    "resident-hazard-fill",
    "resident-hazard-outline",
    "resident-hazard-labels",
    "resident-hazard-reports-layer",
    "resident-hazard-reports-layer-compact",
    "roads-closed-display-layer",
    "hazard-report-100m-fill",
    "hazard-report-100m-line",
  ],
  boundaries: ["sogod-boundary-casing", "sogod-boundary-line"],
});

export function simplifyPublicBaseMap(map) {
  const layers = map?.getStyle?.()?.layers || [];
  layers.forEach((layer) => {
    if (layer.type !== "symbol" || !/(poi|transit|airport)/i.test(layer.id)) return;
    if (map.getLayoutProperty(layer.id, "visibility") !== "none") {
      map.setLayoutProperty(layer.id, "visibility", "none");
    }
  });
}

export function applyPublicMapLayerVisibility(map, visibility, centerMarkers = []) {
  if (!map) return;

  Object.entries(PUBLIC_MAP_LAYER_GROUPS).forEach(([group, layerIds]) => {
    const layerVisibility = visibility[group] ? "visible" : "none";
    layerIds.forEach((layerId) => {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, "visibility", layerVisibility);
      }
    });
  });

  centerMarkers.forEach((marker) => {
    const element = marker?.getElement?.();
    if (element) element.style.visibility = visibility.centers ? "" : "hidden";
  });
}

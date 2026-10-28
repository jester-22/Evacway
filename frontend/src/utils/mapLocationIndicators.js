import mapboxgl from "mapbox-gl";
import { icon } from "@fortawesome/fontawesome-svg-core";
import { faBan, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { createReportPopup } from "../components/mapReports/mapReports";

/**
 * Creates a GeoJSON circle polygon for accuracy circles or buffers.
 */
export function createGeoJSONCircle(centerLng, centerLat, radiusInMeters, points = 64) {
  const km = Math.max(radiusInMeters, 5) / 1000;
  const distanceX = km / (111.32 * Math.cos((centerLat * Math.PI) / 180));
  const distanceY = km / 110.574;
  const ret = [];
  for (let i = 0; i < points; i++) {
    const theta = (i / points) * (2 * Math.PI);
    const x = distanceX * Math.cos(theta);
    const y = distanceY * Math.sin(theta);
    ret.push([centerLng + x, centerLat + y]);
  }
  ret.push(ret[0]);
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [ret],
    },
    properties: {},
  };
}

/**
 * Creates the DOM element for the draggable selected location marker.
 * Minimum hit area is 44x44 px, pulsing 18 px dot with white border and label.
 */
export function createSelectedLocationElement() {
  const container = document.createElement("div");
  container.className = "selected-location-marker";
  container.setAttribute("aria-label", "Selected location");
  container.setAttribute("role", "button");

  container.innerHTML = `
    <div class="selected-location-dot-wrap">
      <div class="selected-location-pulse"></div>
      <div class="selected-location-dot"></div>
    </div>
    <span class="selected-location-label">Selected location</span>
  `;

  return container;
}

/**
 * Places or updates the draggable selected location marker on the map.
 * Ensures only ONE marker exists in the provided ref.
 */
export function setOrUpdateSelectedLocationMarker(map, markerRef, location, onDragEnd) {
  if (!map) return null;

  if (markerRef && markerRef.current) {
    markerRef.current.remove();
    markerRef.current = null;
  }

  if (!location || !Number.isFinite(Number(location.lat)) || !Number.isFinite(Number(location.lng))) {
    return null;
  }

  const lng = Number(location.lng);
  const lat = Number(location.lat);

  const placeMarker = () => {
    if (!map) return null;
    if (markerRef && markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }

    const element = createSelectedLocationElement();
    const marker = new mapboxgl.Marker({
      element,
      draggable: true,
      anchor: "center",
    })
      .setLngLat([lng, lat])
      .addTo(map);

    marker.on("dragend", () => {
      const lngLat = marker.getLngLat();
      if (onDragEnd) {
        onDragEnd({ lat: lngLat.lat, lng: lngLat.lng });
      }
    });

    if (markerRef) {
      markerRef.current = marker;
    }
    return marker;
  };

  if (!map.loaded()) {
    map.once("load", placeMarker);
    return null;
  }

  return placeMarker();
}

/**
 * Updates or adds the user location accuracy circle layer to the map.
 * Handles style reload and ensures clean single-source updates.
 */
export function setOrUpdateAccuracyCircle(map, lng, lat, accuracyMeters = 30) {
  if (!map) return;

  const sourceId = "user-location-accuracy-source";
  const fillLayerId = "user-location-accuracy-fill";
  const lineLayerId = "user-location-accuracy-line";

  const data = createGeoJSONCircle(lng, lat, accuracyMeters);

  function applyCircle() {
    if (!map || (typeof map.isStyleLoaded === "function" && !map.isStyleLoaded())) return;

    try {
      const existingSource = map.getSource(sourceId);
      if (existingSource) {
        existingSource.setData(data);
        return;
      }

      map.addSource(sourceId, {
        type: "geojson",
        data,
      });

      if (!map.getLayer(fillLayerId)) {
        map.addLayer({
          id: fillLayerId,
          type: "fill",
          source: sourceId,
          paint: {
            "fill-color": "#2563eb",
            "fill-opacity": 0.14,
          },
        });
      }

      if (!map.getLayer(lineLayerId)) {
        map.addLayer({
          id: lineLayerId,
          type: "line",
          source: sourceId,
          paint: {
            "line-color": "#2563eb",
            "line-opacity": 0.5,
            "line-width": 1.5,
          },
        });
      }
    } catch {
      // Style may still be mounting
    }
  }

  if (!map.loaded() || (typeof map.isStyleLoaded === "function" && !map.isStyleLoaded())) {
    map.once("style.load", applyCircle);
  } else {
    applyCircle();
  }
}

/**
 * Removes the accuracy circle layer and source from the map.
 */
export function removeAccuracyCircle(map) {
  if (!map) return;
  try {
    if (typeof map.isStyleLoaded === "function" && !map.isStyleLoaded()) return;
    if (map.getLayer("user-location-accuracy-line")) map.removeLayer("user-location-accuracy-line");
    if (map.getLayer("user-location-accuracy-fill")) map.removeLayer("user-location-accuracy-fill");
    if (map.getSource("user-location-accuracy-source")) map.removeSource("user-location-accuracy-source");
  } catch {
    // Ignore cleanup errors on unmount
  }
}

/**
 * Flies to a saved hazard report, displays a highlighted marker with
 * a 3-second pulsing ring, and opens the report popup.
 */
export function highlightAndOpenSavedReport(map, highlightMarkerRef, report, showPopup = true) {
  if (!map || !report) return null;
  const lng = Number(report.longitude ?? report.lng);
  const lat = Number(report.latitude ?? report.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;

  const doHighlight = () => {
    if (!map) return null;
    // Remove previous highlight marker if present so markers never pile up
    if (highlightMarkerRef && highlightMarkerRef.current) {
      highlightMarkerRef.current.remove();
      highlightMarkerRef.current = null;
    }

    const currentZoom = typeof map.getZoom === "function" ? map.getZoom() : 14;
    const targetZoom = Math.max(currentZoom, 16);
    map.flyTo({
      center: [lng, lat],
      zoom: targetZoom,
      duration: 1000,
      essential: true,
    });

    const isBlocked =
      report?.blocks_road === true ||
      report?.road_segment_id != null ||
      report?.road_id != null ||
      (Array.isArray(report?.closed_roads) && report.closed_roads.length > 0) ||
      /block|closed|obstruct/i.test(`${report?.report_type || ""} ${report?.hazard_type || ""}`);

    // Create highlight marker container with >= 44x44px touch area
    const container = document.createElement("div");
    container.className = "hazard-highlight-marker-wrap";
    container.setAttribute("aria-label", `Hazard: ${report.report_type || "Hazard report"}`);
    container.setAttribute("role", "button");

    // Outer ring that pulses for about 3 seconds
    const ring = document.createElement("div");
    ring.className = "hazard-highlight-ring";
    container.appendChild(ring);

    // Inner icon / pin using the hazard's existing icon
    const core = document.createElement("div");
    core.className = "hazard-highlight-core";
    core.innerHTML = icon(isBlocked ? faBan : faTriangleExclamation).html.join("");
    container.appendChild(core);

    // Auto-remove the ring animation after 3.2s
    window.setTimeout(() => {
      ring.remove();
    }, 3200);

    const marker = new mapboxgl.Marker({
      element: container,
      anchor: "center",
    }).setLngLat([lng, lat]);

    if (showPopup) {
      const popup = new mapboxgl.Popup({
        offset: [0, -32],
        className: "ew-popup",
        maxWidth: "320px",
      }).setDOMContent(createReportPopup(report));

      marker.setPopup(popup);
      marker.addTo(map);
      popup.addTo(map);
    } else {
      marker.addTo(map);
    }

    // Add / update 100m impact zone circle buffer
    try {
      if (typeof map.isStyleLoaded === "function" && map.isStyleLoaded()) {
        const circleGeoJSON = createGeoJSONCircle(lng, lat, 100);
        const sourceId = "hazard-report-100m-buffer";
        if (!map.getSource(sourceId)) {
          map.addSource(sourceId, {
            type: "geojson",
            data: circleGeoJSON,
          });
          map.addLayer({
            id: "hazard-report-100m-fill",
            type: "fill",
            source: sourceId,
            paint: {
              "fill-color": "#ef4444",
              "fill-opacity": 0.18,
            },
          });
          map.addLayer({
            id: "hazard-report-100m-line",
            type: "line",
            source: sourceId,
            paint: {
              "line-color": "#dc2626",
              "line-width": 2,
              "line-dasharray": [2, 2],
            },
          });
        } else {
          map.getSource(sourceId).setData(circleGeoJSON);
        }
      }
    } catch {
      // Ignore layer errors if map style is changing
    }

    if (highlightMarkerRef) {
      highlightMarkerRef.current = marker;
    }

    return marker;
  };

  if (!map.loaded()) {
    map.once("load", doHighlight);
    return null;
  }

  return doHighlight();
}

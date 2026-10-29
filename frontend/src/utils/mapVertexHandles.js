import mapboxgl from "mapbox-gl";

/**
 * Creates a vertex handle DOM element.
 * White fill, blue border, minimum 44px hit area for touch accessibility.
 * Uses CSS variables from design system: --ew-bg-surface (white), --ew-brand-primary (blue)
 */
export function createVertexHandleElement(isMidpoint = false) {
  const container = document.createElement("div");
  container.className = `vertex-handle ${isMidpoint ? "vertex-handle-midpoint" : "vertex-handle-corner"}`;
  container.setAttribute("role", "button");
  container.setAttribute("aria-label", isMidpoint ? "Add vertex" : "Drag vertex");

  const size = isMidpoint ? 20 : 24;
  const borderWidth = isMidpoint ? 2 : 3;

  container.style.cssText = `
  width: ${size}px;
  height: ${size}px;
  border-radius: 50%;
  background: var(--ew-bg-surface, #ffffff);
  border: ${borderWidth}px solid var(--ew-brand-primary, #2563eb);
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.3);
  cursor: ${isMidpoint ? "copy" : "grab"};
  transition: transform 0.1s ease, box-shadow 0.1s ease;
  display: flex;
  align-items: center;
  justify-content: center;
`;

  if (isMidpoint) {
    container.innerHTML = `
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <rect x="4" y="1" width="2" height="8" fill="var(--ew-brand-primary, #2563eb)"/>
        <rect x="1" y="4" width="8" height="2" fill="var(--ew-brand-primary, #2563eb)"/>
      </svg>
    `;
  }

  return container;
}

/**
 * Creates vertex handle markers for a polygon.
 * Returns an array of marker objects with cleanup function.
 */
export function createVertexHandleMarkers(map, points, options = {}) {
  const {
    onVertexDrag,
    onVertexDelete,
    onMidpointDrag,
    showMidpoints = true,
    minVertices = 3,
  } = options;

  const markers = [];
  const numPoints = points.length;

  // Create corner vertex handles
  points.forEach((point, index) => {
    const element = createVertexHandleElement(false);

    const marker = new mapboxgl.Marker({
      element,
      draggable: true,
      anchor: "center",
    })
      .setLngLat([point.lng, point.lat])
      .addTo(map);

    let isDragging = false;

    marker.on("dragstart", () => {
      isDragging = true;
      element.style.cursor = "grabbing";
      element.style.transform = "scale(1.2)";
      element.style.boxShadow = "0 4px 16px rgba(var(--ew-ink-rgb, 15, 23, 42), 0.4)";
    });

    marker.on("drag", () => {
      const lngLat = marker.getLngLat();
      if (onVertexDrag) {
        onVertexDrag(index, { lat: lngLat.lat, lng: lngLat.lng });
      }
    });

    marker.on("dragend", () => {
      isDragging = false;
      element.style.cursor = "grab";
      element.style.transform = "scale(1)";
      element.style.boxShadow = "0 2px 8px rgba(var(--ew-ink-rgb, 15, 23, 42), 0.3)";
      const lngLat = marker.getLngLat();
      if (onVertexDrag) {
        onVertexDrag(index, { lat: lngLat.lat, lng: lngLat.lng }, true);
      }
    });

    // Double-click to delete vertex (if more than minVertices)
    element.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      if (numPoints > minVertices && onVertexDelete) {
        onVertexDelete(index);
      }
    });

    // Right-click context menu for delete
    element.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (numPoints > minVertices && onVertexDelete) {
        onVertexDelete(index);
      }
    });

    markers.push({ marker, index, type: "corner" });
  });

  // Create midpoint handles
  if (showMidpoints) {
    points.forEach((point, index) => {
      const nextIndex = (index + 1) % numPoints;
      const nextPoint = points[nextIndex];

      // Calculate midpoint
      const midLng = (point.lng + nextPoint.lng) / 2;
      const midLat = (point.lat + nextPoint.lat) / 2;

      const element = createVertexHandleElement(true);

      const marker = new mapboxgl.Marker({
        element,
        draggable: true,
        anchor: "center",
      })
        .setLngLat([midLng, midLat])
        .addTo(map);

      marker.on("dragstart", () => {
        element.style.cursor = "grabbing";
        element.style.transform = "scale(1.2)";
        element.style.boxShadow = "0 4px 16px rgba(var(--ew-ink-rgb, 15, 23, 42), 0.4)";
      });

      marker.on("drag", () => {
        const lngLat = marker.getLngLat();
        if (onMidpointDrag) {
          onMidpointDrag(index, { lat: lngLat.lat, lng: lngLat.lng });
        }
      });

      marker.on("dragend", () => {
        element.style.cursor = "copy";
        element.style.transform = "scale(1)";
        element.style.boxShadow = "0 2px 8px rgba(var(--ew-ink-rgb, 15, 23, 42), 0.3)";
        const lngLat = marker.getLngLat();
        if (onMidpointDrag) {
          onMidpointDrag(index, { lat: lngLat.lat, lng: lngLat.lng }, true);
        }
      });

      markers.push({ marker, index, type: "midpoint" });
    });
  }

  return {
    markers,
    removeAll: () => {
      markers.forEach(({ marker }) => {
        try {
          marker.remove();
        } catch (e) {}
      });
    },
  };
}

/**
 * Updates vertex handle positions (for when polygon is updated externally).
 */
export function updateVertexHandleMarkers(markers, points) {
  markers.forEach(({ marker, index, type }) => {
    if (type === "corner") {
      const point = points[index];
      if (point) {
        marker.setLngLat([point.lng, point.lat]);
      }
    } else if (type === "midpoint") {
      const nextIndex = (index + 1) % points.length;
      const point = points[index];
      const nextPoint = points[nextIndex];
      if (point && nextPoint) {
        const midLng = (point.lng + nextPoint.lng) / 2;
        const midLat = (point.lat + nextPoint.lat) / 2;
        marker.setLngLat([midLng, midLat]);
      }
    }
  });
}

export default {
  createVertexHandleElement,
  createVertexHandleMarkers,
  updateVertexHandleMarkers,
};

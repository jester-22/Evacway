/**
 * Returns the exact pinpoint coordinates for an evacuation center.
 * 
 * Strategy:
 * 1. If center has buildings in `buildingsGeoJSON`, use the centroid of the
 *    center's buildings (where people actually go on campus).
 * 2. Otherwise, use the geometric centroid of the center's footprint polygon.
 * 3. Fallback to properties.latitude / properties.longitude.
 */
export function getValidCoordinates(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lng = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
  return [lng, lat];
}

export function getCenterCoordinates(center, buildingsGeoJSON = null) {
  if (!center) return null;
  const props = center.properties || center;
  const centerId = props.id ?? center.id;

  // 1. Prefer centroid of campus buildings when available
  if (buildingsGeoJSON?.features && centerId != null) {
    const centerBuildings = buildingsGeoJSON.features.filter((b) => {
      const bProps = b.properties || b;
      const bCenterId = bProps.evacuation_center_id ?? b.evacuation_center_id;
      return String(bCenterId) === String(centerId);
    });

    if (centerBuildings.length > 0) {
      let sumLng = 0;
      let sumLat = 0;
      let count = 0;

      centerBuildings.forEach((b) => {
        const geom = b.geometry || b.geom;
        if (!geom) return;

        if (geom.type === "Polygon" && Array.isArray(geom.coordinates?.[0])) {
          geom.coordinates[0].forEach((pt) => {
            const valid = getValidCoordinates(pt);
            if (valid) {
              sumLng += valid[0];
              sumLat += valid[1];
              count++;
            }
          });
        } else if (geom.type === "Point" && Array.isArray(geom.coordinates)) {
          const valid = getValidCoordinates(geom.coordinates);
          if (valid) {
            sumLng += valid[0];
            sumLat += valid[1];
            count++;
          }
        }
      });

      if (count > 0) {
        return {
          latitude: sumLat / count,
          longitude: sumLng / count,
        };
      }
    }
  }

  // 2. Centroid of footprint polygon
  const geom = center.geometry || center.geom;
  if (geom && geom.coordinates) {
    const coordinates = [];
    function collect(coords) {
      if (!Array.isArray(coords)) return;
      if (
        coords.length >= 2 &&
        typeof coords[0] === "number" &&
        typeof coords[1] === "number"
      ) {
        const valid = getValidCoordinates(coords);
        if (valid) coordinates.push(valid);
        return;
      }
      coords.forEach(collect);
    }
    collect(geom.coordinates);

    if (coordinates.length > 0) {
      let minLng = coordinates[0][0];
      let maxLng = coordinates[0][0];
      let minLat = coordinates[0][1];
      let maxLat = coordinates[0][1];

      coordinates.forEach(([lng, lat]) => {
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
      });

      return {
        latitude: (minLat + maxLat) / 2,
        longitude: (minLng + maxLng) / 2,
      };
    }
  }

  // 3. Fallback to properties lat/lng
  const lat = Number(props.latitude ?? center.latitude ?? props.lat);
  const lng = Number(props.longitude ?? center.longitude ?? props.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { latitude: lat, longitude: lng };
  }

  return null;
}


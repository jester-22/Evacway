import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import '../components_css/Map.css';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const SEV_COLOR = {
  critical: '#FF5A36',
  high: '#FF5A36',
  medium: '#FFC145',
  low: '#5B9CFF',
};

// Creates the hazard marker
function createHazardMarker(sev) {
  const color = SEV_COLOR[sev] || SEV_COLOR.low;

  const element = document.createElement('div');
  element.className = 'hazard-pulse';

  element.innerHTML = `
    <div class="ring" style="background:${color};"></div>
    <div class="core" style="background:${color};"></div>
  `;

  return element;
}

// Creates the user's location marker
function createUserMarker() {
  const element = document.createElement('div');
  element.className = 'me-marker';

  return element;
}

export default function Map({
  center,
  hazards = [],
  userLocation,
  focusOn,
}) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);

  const [mapLoaded, setMapLoaded] = useState(false);

  // Initialize Mapbox
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Your old Leaflet center is [lat, lng]
    // Mapbox uses [lng, lat]
    const initialCenter = center
      ? [center[1], center[0]]
      : [0, 0];

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,

      // Mapbox Standard
      style: 'mapbox://styles/mapbox/standard',

      center: initialCenter,
      zoom: 13,

      // Makes terrain and 3D buildings easier to see
      pitch: 45,
      bearing: 0,

      attributionControl: true,
    });

    mapRef.current = map;

    // Add terrain after the Mapbox style loads
    map.on('style.load', () => {
      if (!map.getSource('mapbox-dem')) {
        map.addSource('mapbox-dem', {
          type: 'raster-dem',
          url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
          tileSize: 512,
          maxzoom: 14,
        });
      }

      
    });

    map.on('load', () => {
      setMapLoaded(true);
    });

    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];

      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update hazard and user markers
  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded) return;

    // Remove old markers
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    // Add hazard markers
    hazards.forEach((h) => {
      const markerElement = createHazardMarker(h.sev);

      const popupContent = document.createElement('div');

      const typeElement = document.createElement('div');
      typeElement.className = 'popup-type';
      typeElement.textContent = h.type || '';

      const descElement = document.createElement('div');
      descElement.className = 'popup-desc';
      descElement.textContent = h.desc || '';

      popupContent.appendChild(typeElement);
      popupContent.appendChild(descElement);

      const popup = new mapboxgl.Popup({
        offset: 15,
      }).setDOMContent(popupContent);

      const marker = new mapboxgl.Marker({
        element: markerElement,
        anchor: 'center',
      })
        .setLngLat([h.lng, h.lat])
        .setPopup(popup)
        .addTo(map);

      markersRef.current.push(marker);
    });

    // Add user's location
    if (userLocation) {
      const userMarkerElement = createUserMarker();

      const userMarker = new mapboxgl.Marker({
        element: userMarkerElement,
        anchor: 'center',
      })
        .setLngLat([
          userLocation.lng,
          userLocation.lat,
        ])
        .addTo(map);

      markersRef.current.push(userMarker);
    }
  }, [hazards, userLocation, mapLoaded]);

  // Re-center map when an alert/hazard is selected
  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded || !focusOn) return;

    map.flyTo({
      center: [focusOn.lng, focusOn.lat],
      zoom: 15,
      pitch: 55,
      bearing: 0,
      duration: 1000,
      essential: true,
    });
  }, [focusOn, mapLoaded]);

  // Update map center if the center prop changes
  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded || !center) return;

    map.flyTo({
      center: [center[1], center[0]],
      zoom: 13,
      duration: 800,
      essential: true,
    });
  }, [center, mapLoaded]);

  return (
    <div className="map-container">
      <div
        ref={mapContainerRef}
        style={{
          width: '100%',
          height: '100%',
        }}
      />

      <div className="legend">
        <div className="legend-row">
          <span
            className="legend-swatch"
            style={{ background: 'var(--danger)' }}
          />
          Critical / High
        </div>

        <div className="legend-row">
          <span
            className="legend-swatch"
            style={{ background: 'var(--caution)' }}
          />
          Medium
        </div>

        <div className="legend-row">
          <span
            className="legend-swatch"
            style={{ background: 'var(--info)' }}
          />
          Low / Advisory
        </div>

        <div className="legend-row">
          <span
            className="legend-swatch"
            style={{ background: 'var(--safe)' }}
          />
          Your position
        </div>
      </div>
    </div>
  );
}
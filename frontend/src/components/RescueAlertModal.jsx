import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faLocationCrosshairs,
  faTriangleExclamation,
  faXmark,
  faMapPin,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../services/api";
import { queryKeys } from "../hooks/useEvacuationQueries";
import { createSelectedLocationElement } from "../utils/mapLocationIndicators";
import "../components_css/RescueAlertModal.css";

export default function RescueAlertModal({
  onClose,
  onSubmitted,
  initialCoordinates = null,
  onPinOnMap,
  onLocationCaptured,
}) {
  const queryClient = useQueryClient();
  const [description, setDescription] = useState("");
  const [locationDescription, setLocationDescription] = useState("");
  const [coordinates, setCoordinates] = useState(initialCoordinates);
  const [addressText, setAddressText] = useState("");
  const [locationMessage, setLocationMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [locating, setLocating] = useState(false);

  const previewContainerRef = useRef(null);
  const previewMapRef = useRef(null);
  const previewMarkerRef = useRef(null);

  // Sync initialCoordinates if provided
  useEffect(() => {
    if (initialCoordinates) {
      setCoordinates(initialCoordinates);
    }
  }, [initialCoordinates]);

  // Reverse geocode to resolve address / barangay text
  useEffect(() => {
    const lat = coordinates?.latitude ?? coordinates?.lat;
    const lng = coordinates?.longitude ?? coordinates?.lng;
    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
      setAddressText("");
      return undefined;
    }

    const token = import.meta.env.VITE_MAPBOX_TOKEN;
    if (!token) return undefined;

    let cancelled = false;
    const url =
      `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${lng}` +
      `&latitude=${lat}&types=locality,neighborhood,place,address&access_token=${encodeURIComponent(token)}`;

    fetch(url)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        if (cancelled) return;
        const feature = data.features?.[0];
        const name = feature?.properties?.name || feature?.properties?.place_formatted || "";
        setAddressText(name);
      })
      .catch(() => {
        if (!cancelled) setAddressText("");
      });

    return () => {
      cancelled = true;
    };
  }, [coordinates?.latitude, coordinates?.longitude, coordinates?.lat, coordinates?.lng]);

  // Non-interactive small Mapbox preview on the form
  useEffect(() => {
    const lat = Number(coordinates?.latitude ?? coordinates?.lat);
    const lng = Number(coordinates?.longitude ?? coordinates?.lng);
    if (!previewContainerRef.current || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return undefined;
    }

    let map = previewMapRef.current;

    if (!map) {
      map = new mapboxgl.Map({
        container: previewContainerRef.current,
        style: "mapbox://styles/mapbox/streets-v12",
        center: [lng, lat],
        zoom: 15,
        interactive: false,
        attributionControl: false,
      });

      previewMapRef.current = map;

      map.on("load", () => {
        map.resize();
      });
    } else {
      map.setCenter([lng, lat]);
      setTimeout(() => map?.resize(), 50);
    }

    if (previewMarkerRef.current) {
      previewMarkerRef.current.remove();
    }

    const markerEl = createSelectedLocationElement();
    const marker = new mapboxgl.Marker({
      element: markerEl,
      anchor: "center",
    })
      .setLngLat([lng, lat])
      .addTo(map);

    previewMarkerRef.current = marker;

    return () => {
      // keep map cached during dialog life
    };
  }, [coordinates]);

  // Cleanup preview map on unmount
  useEffect(() => {
    return () => {
      if (previewMarkerRef.current) {
        previewMarkerRef.current.remove();
        previewMarkerRef.current = null;
      }
      if (previewMapRef.current) {
        previewMapRef.current.remove();
        previewMapRef.current = null;
      }
    };
  }, []);

  function captureLocation() {
    setLocationMessage("");
    setError("");
    if (!navigator.geolocation) {
      setLocationMessage("GPS is unavailable. Describe your location below.");
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const captured = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
        setCoordinates(captured);
        setLocationMessage("Current GPS coordinates captured.");
        setLocating(false);

        if (onLocationCaptured) {
          onLocationCaptured({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
          });
        }
      },
      () => {
        setCoordinates(null);
        setLocationMessage("GPS was not shared. Describe your location below.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!coordinates && !locationDescription.trim()) {
      setError("Share your GPS location or describe where help is needed.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      await api.submitRescueRequest({
        description: description.trim(),
        location_description: locationDescription.trim() || null,
        latitude: coordinates?.latitude ?? coordinates?.lat ?? null,
        longitude: coordinates?.longitude ?? coordinates?.lng ?? null,
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.rescueRequests });
      onSubmitted();
    } catch (requestError) {
      setError(requestError.message || "Rescue request could not be sent.");
    } finally {
      setSubmitting(false);
    }
  }

  const hasCoords = coordinates && Number.isFinite(Number(coordinates.latitude ?? coordinates.lat));

  return (
    <div className="rescue-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <form className="rescue-modal" role="dialog" aria-modal="true" aria-labelledby="rescue-title" onSubmit={handleSubmit}>
        <header className="rescue-header">
          <div>
            <span className="rescue-eyebrow"><FontAwesomeIcon icon={faTriangleExclamation} /> Emergency</span>
            <h2 id="rescue-title">Request rescue</h2>
          </div>
          <button type="button" className="rescue-close" onClick={onClose} aria-label="Close rescue request">
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </header>

        <div className="rescue-body">
          <p className="rescue-intro">Send your situation to EvacWay response staff. Only information you submit is shared.</p>
          {error && <p className="rescue-error" role="alert">{error}</p>}

          <label className="rescue-field">
            <span>What help do you need?</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} required placeholder="Describe the emergency and anyone who needs assistance." />
          </label>

          <div className="rescue-field">
            <span>Location</span>
            <div className="rescue-location-btn-row">
              <button type="button" className="rescue-location-button" onClick={captureLocation} disabled={locating}>
                <FontAwesomeIcon icon={faLocationCrosshairs} />
                {locating ? "Getting location…" : hasCoords ? "Update GPS location" : "Use my current GPS location"}
              </button>
              {onPinOnMap && (
                <button type="button" className="rescue-location-button rescue-pin-button" onClick={onPinOnMap}>
                  <FontAwesomeIcon icon={faMapPin} />
                  Pin on map
                </button>
              )}
            </div>

            {hasCoords && (
              <div className="rescue-preview-card">
                <div ref={previewContainerRef} className="rescue-preview-map" />
                <div className="rescue-preview-meta">
                  <div className="rescue-preview-coords">
                    {Number(coordinates.latitude ?? coordinates.lat).toFixed(5)}° N, {Number(coordinates.longitude ?? coordinates.lng).toFixed(5)}° E
                  </div>
                  {addressText ? (
                    <div className="rescue-preview-address">{addressText}</div>
                  ) : (
                    <div className="rescue-preview-address rescue-preview-address-muted">Sogod, Southern Leyte</div>
                  )}
                </div>
              </div>
            )}

            {locationMessage && <small className="rescue-location-message" role="status">{locationMessage}</small>}
            <input
              type="text"
              value={locationDescription}
              onChange={(event) => setLocationDescription(event.target.value)}
              maxLength={255}
              required={!hasCoords}
              placeholder={hasCoords ? "Optional landmark or directions" : "Landmark, street, or barangay"}
            />
          </div>
        </div>

        <footer className="rescue-actions">
          <button type="button" className="rescue-cancel" onClick={onClose}>Cancel</button>
          <button type="submit" className="rescue-submit" disabled={submitting || locating}>
            {submitting ? "Sending request…" : "Send rescue alert"}
          </button>
        </footer>
      </form>
    </div>
  );
}
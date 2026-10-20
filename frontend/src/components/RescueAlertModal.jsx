import { useState, useEffect, useRef, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faLocationCrosshairs,
  faTriangleExclamation,
  faXmark,
  faMapPin,
  faCamera,
  faUser,
  faPhone,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../services/api";
import { queryKeys } from "../hooks/useEvacuationQueries";
import { createSelectedLocationElement } from "../utils/mapLocationIndicators";
import "../components_css/RescueAlertModal.css";

const MAX_PHOTOS = 5;

export default function RescueAlertModal({
  onClose,
  onSubmitted,
  initialCoordinates = null,
  onPinOnMap,
  onLocationCaptured,
}) {
  const queryClient = useQueryClient();
  const [description, setDescription] = useState("");
  const [requesterName, setRequesterName] = useState("");
  const [requesterContact, setRequesterContact] = useState("");
  const [proofImages, setProofImages] = useState([]);
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
  const fileInputRef = useRef(null);

  // Create & cleanup object URLs for image previews
  const previewUrls = useMemo(
    () => proofImages.map((file) => URL.createObjectURL(file)),
    [proofImages]
  );

  useEffect(() => {
    return () => {
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [previewUrls]);

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

  function handleFilesSelected(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;

    const remainingSlots = MAX_PHOTOS - proofImages.length;
    if (files.length > remainingSlots) {
      setError(`You can attach up to ${MAX_PHOTOS} photos total.`);
      const allowed = files.slice(0, Math.max(0, remainingSlots));
      if (allowed.length > 0) {
        setProofImages((prev) => [...prev, ...allowed]);
      }
      return;
    }

    setProofImages((prev) => [...prev, ...files]);
    setError("");
  }

  function handleRemovePhoto(indexToRemove) {
    setProofImages((prev) => prev.filter((_, index) => index !== indexToRemove));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!requesterName.trim()) {
      setError("Please provide your name.");
      return;
    }
    if (!requesterContact.trim()) {
      setError("Please provide your contact number.");
      return;
    }
    if (!coordinates && !locationDescription.trim()) {
      setError("Share your GPS location or describe where help is needed.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("description", description.trim());
      formData.append("requester_name", requesterName.trim());
      formData.append("requester_contact", requesterContact.trim());
      formData.append("location_description", locationDescription.trim() || "");
      formData.append("latitude", coordinates?.latitude ?? coordinates?.lat ?? "");
      formData.append("longitude", coordinates?.longitude ?? coordinates?.lng ?? "");
      proofImages.forEach((file) => formData.append("proof_images", file));

      await api.submitRescueRequest(formData);
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
    <div
      className="rescue-overlay"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <form
        className="rescue-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rescue-title"
        onSubmit={handleSubmit}
      >
        <header className="rescue-header">
          <div className="rescue-header-text">
            <span className="rescue-eyebrow">
              <FontAwesomeIcon icon={faTriangleExclamation} /> Emergency Dispatch
            </span>
            <h2 id="rescue-title">Request Rescue</h2>
            <p className="rescue-intro">
              Send your situation directly to EvacWay response staff.
            </p>
          </div>
          <button
            type="button"
            className="rescue-close"
            onClick={onClose}
            aria-label="Close rescue request"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </header>

        <div className="rescue-body">
          {error && (
            <p className="rescue-error" role="alert">
              {error}
            </p>
          )}

          {/* 2-Column Row for Name & Contact Number */}
          <div className="rescue-field-row">
            <label className="rescue-field">
              <span className="rescue-field-label">
                <FontAwesomeIcon icon={faUser} className="rescue-label-icon" />
                Your name <em className="rescue-req">*</em>
              </span>
              <input
                type="text"
                className="rescue-text-input"
                value={requesterName}
                onChange={(event) => setRequesterName(event.target.value)}
                maxLength={100}
                required
                placeholder="e.g. Juan Dela Cruz"
              />
            </label>

            <label className="rescue-field">
              <span className="rescue-field-label">
                <FontAwesomeIcon icon={faPhone} className="rescue-label-icon" />
                Contact number <em className="rescue-req">*</em>
              </span>
              <input
                type="tel"
                className="rescue-text-input"
                value={requesterContact}
                onChange={(event) => setRequesterContact(event.target.value)}
                maxLength={20}
                required
                placeholder="e.g. 0917 123 4567"
              />
            </label>
          </div>

          <label className="rescue-field">
            <span className="rescue-field-label">
              What help do you need? <em className="rescue-req">*</em>
            </span>
            <textarea
              className="rescue-textarea"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={2000}
              required
              rows={3}
              placeholder="Describe the emergency, water level, injuries, or anyone who needs immediate assistance."
            />
          </label>

          {/* Photo Upload (div wrapper so remove buttons don't re-trigger file input) */}
          <div className="rescue-field">
            <div className="rescue-field-label-row">
              <span className="rescue-field-label">Situation photos</span>
              <span className="rescue-field-optional">
                Optional ({proofImages.length}/{MAX_PHOTOS})
              </span>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              className="rescue-file-input-hidden"
              onChange={handleFilesSelected}
            />

            <div className="rescue-photo-upload">
              {proofImages.length < MAX_PHOTOS && (
                <button
                  type="button"
                  className="rescue-upload-trigger"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <span className="rescue-upload-icon-badge">
                    <FontAwesomeIcon icon={faCamera} />
                  </span>
                  <span className="rescue-upload-copy">
                    <strong>Add photo proof</strong>
                    <small>JPG, PNG, or WebP · Up to 5 photos</small>
                  </span>
                  <span className="rescue-upload-cta">Browse</span>
                </button>
              )}

              {proofImages.length > 0 && (
                <div className="rescue-image-preview">
                  {proofImages.map((file, index) => (
                    <div key={`${file.name}-${index}`} className="rescue-image-preview-item">
                      <img
                        src={previewUrls[index]}
                        alt={`Selected proof ${index + 1}`}
                        className="rescue-image-preview-img"
                      />
                      <button
                        type="button"
                        className="rescue-image-remove"
                        onClick={() => handleRemovePhoto(index)}
                        aria-label={`Remove photo ${index + 1}`}
                      >
                        <FontAwesomeIcon icon={faXmark} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="rescue-field">
            <div className="rescue-field-label-row">
              <span className="rescue-field-label">
                Location <em className="rescue-req">*</em>
              </span>
              {hasCoords && <span className="rescue-gps-pill">GPS Locked</span>}
            </div>

            <div className="rescue-location-btn-row">
              <button
                type="button"
                className="rescue-location-button"
                onClick={captureLocation}
                disabled={locating}
              >
                <FontAwesomeIcon icon={faLocationCrosshairs} />
                <span>
                  {locating
                    ? "Getting GPS…"
                    : hasCoords
                      ? "Update GPS"
                      : "Use my current GPS"}
                </span>
              </button>
              {onPinOnMap && (
                <button
                  type="button"
                  className="rescue-location-button rescue-pin-button"
                  onClick={onPinOnMap}
                >
                  <FontAwesomeIcon icon={faMapPin} />
                  <span>Pin on map</span>
                </button>
              )}
            </div>

            {hasCoords && (
              <div className="rescue-preview-card">
                <div ref={previewContainerRef} className="rescue-preview-map" />
                <div className="rescue-preview-meta">
                  <div className="rescue-preview-coords">
                    {Number(coordinates.latitude ?? coordinates.lat).toFixed(5)}° N,{" "}
                    {Number(coordinates.longitude ?? coordinates.lng).toFixed(5)}° E
                  </div>
                  <div
                    className={`rescue-preview-address ${!addressText ? "rescue-preview-address-muted" : ""}`}
                  >
                    {addressText || "Sogod, Southern Leyte"}
                  </div>
                </div>
              </div>
            )}

            {locationMessage && (
              <small className="rescue-location-message" role="status">
                {locationMessage}
              </small>
            )}

            <input
              type="text"
              className="rescue-text-input"
              value={locationDescription}
              onChange={(event) => setLocationDescription(event.target.value)}
              maxLength={255}
              required={!hasCoords}
              placeholder={
                hasCoords
                  ? "Optional landmark, house color, or floor level"
                  : "Landmark, street, or barangay (required if no GPS)"
              }
            />
          </div>
        </div>

        <footer className="rescue-actions">
          <button type="button" className="rescue-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="rescue-submit"
            disabled={submitting || locating}
          >
            {submitting ? "Sending request…" : "Send rescue alert"}
          </button>
        </footer>
      </form>
    </div>
  );
}
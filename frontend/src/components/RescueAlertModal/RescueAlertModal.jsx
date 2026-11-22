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
import { api } from "../../services/api";
import { emergencyContacts } from "../../config/emergencyContacts";
import { queryKeys } from "../../hooks/useEvacuationQueries";
import { createSelectedLocationElement, refineGeolocation } from "../../utils/mapLocationIndicators";
import { useAuth } from "../../context/AuthContext";
import { needsLocationConfirmation } from "../../utils/locationConfirmation";
import { maskContactNumber, RESCUE_NEEDS, RESCUE_VULNERABILITY_FLAGS } from "../../utils/rescueRequest.js";
import PublicMapDialogShell from "../PublicMapDialogShell/PublicMapDialogShell";
import "./RescueAlertModal.css";

const MAX_PHOTOS = 5;

export default function RescueAlertModal({
  onClose,
  onSubmitted,
  initialCoordinates = null,
  onPinOnMap,
  onLocationCaptured,
  isLocationAllowed,
  onOpenLogin,
  onOpenSignUp,
}) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const loggedInName =
    user?.name ||
    user?.full_name ||
    (user?.first_name ? `${user.first_name} ${user.last_name || ""}`.trim() : "") ||
    user?.email ||
    "";
  const savedContactNumber = user?.contact_number || user?.phone || "";

  const [description, setDescription] = useState("");
  const [selectedNeeds, setSelectedNeeds] = useState([]);
  const [vulnerabilityFlags, setVulnerabilityFlags] = useState([]);
  const [requesterName, setRequesterName] = useState(loggedInName);
  const [requesterContact, setRequesterContact] = useState(savedContactNumber);
  const [contactEditing, setContactEditing] = useState(!savedContactNumber);
  const [proofImages, setProofImages] = useState([]);
  const [locationDescription, setLocationDescription] = useState("");
  const [coordinates, setCoordinates] = useState(initialCoordinates);
  const [addressText, setAddressText] = useState("");
  const [locationMessage, setLocationMessage] = useState("");
  const [peopleNeedingRescue, setPeopleNeedingRescue] = useState(
    String(Math.max(1, Number(user?.family_member_count) || 1))
  );
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationConfirmation, setLocationConfirmation] = useState(null);

  const previewContainerRef = useRef(null);
  const previewMapRef = useRef(null);
  const previewMarkerRef = useRef(null);
  const fileInputRef = useRef(null);
  const peopleCountTouchedRef = useRef(false);
  const contactTouchedRef = useRef(false);

  useEffect(() => {
    if (user?.role !== "resident") return undefined;
    let active = true;
    api.getRescueRequestFormContext()
      .then((context) => {
        if (!active) return;
        if (!peopleCountTouchedRef.current && context.family_member_count) {
          setPeopleNeedingRescue(String(context.family_member_count));
        }
        if (!contactTouchedRef.current) {
          setRequesterContact(context.contact_number || "");
          setContactEditing(!context.contact_number);
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, [user?.id, user?.role]);

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "Escape") {
        onClose?.();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

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

  // Sync user details if logged in
  useEffect(() => {
    if (user) {
      if (loggedInName && !requesterName) setRequesterName(loggedInName);
      const userPhone = user.contact_number || user.phone || "";
      if (userPhone && !requesterContact) {
        setRequesterContact(userPhone);
      }
    }
  }, [user, loggedInName, requesterName, requesterContact]);

  // Sync initialCoordinates if provided
  useEffect(() => {
    if (initialCoordinates) {
      setCoordinates(initialCoordinates);
    }
  }, [initialCoordinates]);

  // Reverse geocode to resolve address / barangay text
  useEffect(() => {
    if (!user) return undefined;
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
  }, [user, coordinates?.latitude, coordinates?.longitude, coordinates?.lat, coordinates?.lng]);

  // Non-interactive small Mapbox preview on the form
  useEffect(() => {
    if (!user) return undefined;
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
  }, [user, coordinates]);

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

  function handleLoginClick() {
    onClose?.();
    if (onOpenLogin) {
      onOpenLogin("Log in to send a rescue request to EvacWay response staff.");
    }
  }

  function handleSignUpClick() {
    onClose?.();
    if (onOpenSignUp) {
      onOpenSignUp();
    }
  }

  function captureLocation() {
    setLocationMessage("");
    setError("");
    if (!navigator.geolocation) {
      setLocationMessage("GPS is unavailable. Describe your location below or pin on the map.");
      return;
    }

    setLocating(true);
    const applyCapturedPosition = (position, successMessage) => {
      const acc = position.coords.accuracy ?? null;
      const captured = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: acc,
        is_manual_pin: false,
        location_source: acc != null && acc > 100 ? "approximate" : "gps",
      };
      if (isLocationAllowed && !isLocationAllowed(captured)) {
        setCoordinates(null);
        setLocationConfirmation(null);
        setLocationMessage("Your GPS location is outside Sogod. Pin a location inside the boundary to request rescue.");
        return false;
      }
      setCoordinates(captured);
      setLocationMessage(successMessage(acc));
      onLocationCaptured?.(captured);
      return true;
    };
    refineGeolocation({
      onFirstFix: (position) => {
        applyCapturedPosition(position, (acc) => acc != null && acc > 100
          ? "Approximate location found. Refining signal..."
          : "Current GPS coordinates captured.");
      },
      onImprovement: (position) => {
        applyCapturedPosition(position, () => "GPS accuracy improved.");
      },
    })
      .then((bestPos) => {
        const acc = bestPos.coords.accuracy ?? null;
        applyCapturedPosition(bestPos, (accuracy) => accuracy != null && accuracy > 100
          ? "Approximate location captured. Please provide landmark details or pin on the map."
          : "GPS coordinates locked.");
      })
      .catch((err) => {
        setCoordinates(null);
        setLocationMessage(err.message || "GPS was not shared. Describe your location below or pin on the map.");
      })
      .finally(() => {
        setLocating(false);
      });
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
    if (submitting || locating) return;
    if (!description.trim() && selectedNeeds.length === 0) {
      setError("Select a need or briefly describe the situation.");
      return;
    }
    const finalName = (loggedInName || user?.email || "Resident").trim();
    if (!finalName) {
      setError("Please provide your name.");
      return;
    }

    // Optional contact number: fallback to saved number if left empty, or empty string
    const savedContact = (user?.contact_number || user?.phone || "").trim();
    const finalContact = requesterContact.trim() || savedContact || "";

    if (!coordinates && !locationDescription.trim()) {
      setError("Share your GPS location or describe where help is needed.");
      return;
    }
    if (coordinates && isLocationAllowed && !isLocationAllowed(coordinates)) {
      setError("Rescue requests can only use a location inside Sogod. Pin a location inside the boundary.");
      return;
    }

    if (needsLocationConfirmation(coordinates) && locationConfirmation !== coordinates) {
      setLocationConfirmation(coordinates);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const isManualPinSubmit = Boolean(coordinates?.is_manual_pin || coordinates?.location_source === "manual");
      const accNum = coordinates?.accuracy != null ? Number(coordinates.accuracy) : null;
      const isApproxSubmit = !isManualPinSubmit && ((accNum != null && accNum > 100) || coordinates?.location_source === "approximate");
      const locSource = isManualPinSubmit ? "manual" : (isApproxSubmit ? "approximate" : (hasCoords ? "gps" : ""));

      const formData = new FormData();
      formData.append("description", description.trim());
      formData.append("selected_needs", JSON.stringify(selectedNeeds));
      formData.append("people_count", peopleNeedingRescue);
      formData.append("vulnerability_flags", JSON.stringify(vulnerabilityFlags));
      formData.append("requester_name", finalName);
      formData.append("requester_contact", finalContact);
      formData.append("location_description", locationDescription.trim() || "");
      formData.append("latitude", coordinates?.latitude ?? coordinates?.lat ?? "");
      formData.append("longitude", coordinates?.longitude ?? coordinates?.lng ?? "");
      formData.append("accuracy", accNum != null && !Number.isNaN(accNum) ? String(accNum) : "");
      formData.append("is_manual_pin", isManualPinSubmit ? "true" : "false");
      formData.append("location_source", locSource);
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

  const hasCoords = Boolean(coordinates && Number.isFinite(Number(coordinates.latitude ?? coordinates.lat)));
  const isManualPin = Boolean(coordinates?.is_manual_pin || coordinates?.location_source === "manual");
  const accuracyMeters =
    coordinates?.accuracy != null && Number.isFinite(Number(coordinates.accuracy))
      ? Number(coordinates.accuracy)
      : null;
  const isApproximate =
    !isManualPin &&
    ((accuracyMeters != null && accuracyMeters > 100) ||
      coordinates?.location_source === "approximate");

  return (
    <PublicMapDialogShell onClose={onClose} labelledBy="rescue-title">
      {!user ? (
        /* Not logged in: simple message screen with hotline card */
        <div
          className="rescue-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rescue-title"
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

          <div className="rescue-body rescue-unauth-body">
            <p className="rescue-unauth-notice">
              Log in to send a rescue request to EvacWay response staff.
            </p>

            <div className="rescue-hotline-card">
              <div className="rescue-hotline-header">
                <span className="rescue-hotline-title">Emergency Hotlines</span>
                <span className="rescue-hotline-badge">24/7 Response</span>
              </div>

              <div className="rescue-hotline-list">
                {emergencyContacts.hotlines.map((item) => (
                  <a
                    key={`${item.label}-${item.number}`}
                    href={`tel:${item.number.replace(/[^+\d]/g, "")}`}
                    className="rescue-hotline-link"
                    title={`Call ${item.label} (${item.number})`}
                  >
                    <div className="rescue-hotline-icon">
                      <FontAwesomeIcon icon={faPhone} />
                    </div>
                    <div className="rescue-hotline-details">
                      <strong className="rescue-hotline-number">{item.number}</strong>
                      <span className="rescue-hotline-label">{item.label}</span>
                    </div>
                  </a>
                ))}
                {emergencyContacts.hotlines.length === 0 && (
                  <p className="rescue-hotline-unavailable" role="status">
                    Verified emergency hotline numbers are not configured yet.
                  </p>
                )}
              </div>

              <p className="rescue-hotline-note">
                If someone’s life is in danger, call now.
              </p>
            </div>
          </div>

          <footer className="rescue-unauth-footer">
            <div className="rescue-unauth-btn-row">
              <button
                type="button"
                className="rescue-btn-login"
                onClick={handleLoginClick}
              >
                Log in
              </button>
              <button
                type="button"
                className="rescue-btn-close-action"
                onClick={onClose}
              >
                Close
              </button>
            </div>
            <div className="rescue-unauth-signup-row">
              <span className="rescue-unauth-signup-text">
                Don’t have an account?{" "}
                <button
                  type="button"
                  className="rescue-unauth-signup-link"
                  onClick={handleSignUpClick}
                >
                  Sign up.
                </button>
              </span>
            </div>
          </footer>
        </div>
      ) : (
        /* Logged in: full rescue request form */
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

            {/* Requesting as verified account info */}
            <div className="rescue-logged-in-box">
              <div className="rescue-logged-in-profile">
                <div className="rescue-logged-in-avatar">
                  <FontAwesomeIcon icon={faUser} />
                </div>
                <div className="rescue-logged-in-details">
                  <span className="rescue-logged-in-label">Requesting as:</span>
                  <strong className="rescue-logged-in-name">{loggedInName}</strong>
                  {user.email && <span className="rescue-logged-in-email">{user.email}</span>}
                </div>
              </div>
              <div className="rescue-field" style={{ margin: 0 }}>
                <span className="rescue-field-label">
                  <FontAwesomeIcon icon={faPhone} className="rescue-label-icon" />
                  Saved contact number
                </span>
                {contactEditing ? (
                  <>
                    <input
                      type="tel"
                      className="rescue-text-input"
                      value={requesterContact}
                      onChange={(event) => {
                        contactTouchedRef.current = true;
                        setRequesterContact(event.target.value);
                      }}
                      maxLength={20}
                      placeholder="Enter your contact number"
                      autoComplete="tel"
                    />
                    {requesterContact && (
                      <button type="button" className="rescue-inline-link" onClick={() => setContactEditing(false)}>
                        Done
                      </button>
                    )}
                  </>
                ) : (
                  <div className="rescue-contact-confirm">
                    <strong>{maskContactNumber(requesterContact || savedContactNumber)}</strong>
                    <button type="button" className="rescue-inline-link" onClick={() => {
                      contactTouchedRef.current = true;
                      setContactEditing(true);
                    }}>
                      Edit
                    </button>
                  </div>
                )}
                <small className="rescue-field-hint">Confirm the number responders should use.</small>
              </div>
            </div>

            <label className="rescue-field">
              <span className="rescue-field-label">What help do you need?</span>
              <div className="rescue-choice-grid" role="group" aria-label="Choose all needs that apply">
                {RESCUE_NEEDS.map((need) => {
                  const selected = selectedNeeds.includes(need);
                  return (
                    <button
                      type="button"
                      key={need}
                      className={`rescue-choice ${selected ? "is-selected" : ""}`}
                      aria-pressed={selected}
                      onClick={() => setSelectedNeeds((current) => (
                        selected
                          ? current.filter((item) => item !== need)
                          : [...current, need]
                      ))}
                    >
                      {need}
                    </button>
                  );
                })}
              </div>
              <small className="rescue-field-hint">Choose any that apply. You can add a short description below.</small>
              <textarea
                className="rescue-textarea"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={2000}
                rows={3}
                placeholder="Optional details responders should know"
              />
            </label>

            <div className="rescue-field">
              <span className="rescue-field-label">Anyone needing extra assistance?</span>
              <div className="rescue-vulnerability-grid">
                {RESCUE_VULNERABILITY_FLAGS.map((flag) => (
                  <label className="rescue-check-option" key={flag}>
                    <input
                      type="checkbox"
                      checked={vulnerabilityFlags.includes(flag)}
                      onChange={(event) => setVulnerabilityFlags((current) => (
                        event.target.checked
                          ? [...current, flag]
                          : current.filter((item) => item !== flag)
                      ))}
                    />
                    <span>{flag}</span>
                  </label>
                ))}
              </div>
            </div>

            <label className="rescue-field">
              <span className="rescue-field-label">How many people?</span>
              <input
                type="number"
                className="rescue-text-input"
                value={peopleNeedingRescue}
                min="1"
                max="999"
                step="1"
                inputMode="numeric"
                onChange={(event) => {
                  peopleCountTouchedRef.current = true;
                  setPeopleNeedingRescue(event.target.value);
                }}
              />
            </label>

            {/* Photo Upload */}
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

            {/* Location */}
            <div className="rescue-field">
              <div className="rescue-field-label-row">
                <span className="rescue-field-label">
                  Location <em className="rescue-req">*</em>
                </span>
                {hasCoords && (
                  isApproximate ? (
                    <span className="rescue-gps-pill rescue-gps-pill--approximate">Approximate</span>
                  ) : isManualPin ? (
                    <span className="rescue-gps-pill rescue-gps-pill--manual">Manually pinned</span>
                  ) : (
                    <span className="rescue-gps-pill">GPS Locked</span>
                  )
                )}
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
                    <div className="rescue-preview-coords-row">
                      <span className="rescue-preview-coords">
                        {Number(coordinates.latitude ?? coordinates.lat).toFixed(5)}° N,{" "}
                        {Number(coordinates.longitude ?? coordinates.lng).toFixed(5)}° E
                      </span>
                      {accuracyMeters != null && !isManualPin && (
                        <span className="rescue-preview-accuracy">
                          Accuracy: about {Math.round(accuracyMeters)} m
                        </span>
                      )}
                      {isManualPin && (
                        <span className="rescue-preview-accuracy is-manual">
                          Manually pinned
                        </span>
                      )}
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

              <label className="rescue-field">
                <span className="rescue-field-label">Landmark or location details{hasCoords ? " (optional)" : ""}</span>
                {isApproximate && !isManualPin && (
                  <small className="rescue-field-hint">
                    GPS accuracy is approximate. A nearby landmark can help responders find you.
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
                    !hasCoords
                      ? "Street, landmark, or barangay (needed without GPS)"
                      : isApproximate && !isManualPin
                        ? "Add a nearby landmark (optional)"
                        : "Optional landmark or nearby place"
                  }
                />
              </label>
            </div>
          </div>

          {needsLocationConfirmation(coordinates) && locationConfirmation === coordinates && (
            <p className="rescue-location-confirmation" role="status">Location may be inaccurate. Check the pin, then confirm to send.</p>
          )}
          <footer className="rescue-actions">
            <button type="button" className="rescue-cancel" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="rescue-submit"
              disabled={submitting || locating}
            >
              {submitting ? "Sending request…" : needsLocationConfirmation(coordinates) && locationConfirmation === coordinates ? "Confirm and send" : "Send rescue alert"}
            </button>
          </footer>
        </form>
      )}
    </PublicMapDialogShell>
  );
}

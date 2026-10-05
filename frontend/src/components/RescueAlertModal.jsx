import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLocationCrosshairs, faTriangleExclamation, faXmark } from "@fortawesome/free-solid-svg-icons";
import { api } from "../services/api";
import "../components_css/RescueAlertModal.css";

export default function RescueAlertModal({ onClose, onSubmitted }) {
  const [description, setDescription] = useState("");
  const [locationDescription, setLocationDescription] = useState("");
  const [coordinates, setCoordinates] = useState(null);
  const [locationMessage, setLocationMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [locating, setLocating] = useState(false);

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
        setCoordinates({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setLocationMessage("Current GPS coordinates captured.");
        setLocating(false);
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
        latitude: coordinates?.latitude ?? null,
        longitude: coordinates?.longitude ?? null,
      });
      onSubmitted();
    } catch (requestError) {
      setError(requestError.message || "Rescue request could not be sent.");
    } finally {
      setSubmitting(false);
    }
  }

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
            <button type="button" className="rescue-location-button" onClick={captureLocation} disabled={locating}>
              <FontAwesomeIcon icon={faLocationCrosshairs} />
              {locating ? "Getting location…" : coordinates ? "Update GPS location" : "Use my current GPS location"}
            </button>
            {coordinates && <small className="rescue-coordinates">{coordinates.latitude.toFixed(5)}, {coordinates.longitude.toFixed(5)}</small>}
            {locationMessage && <small className="rescue-location-message" role="status">{locationMessage}</small>}
            <input
              type="text"
              value={locationDescription}
              onChange={(event) => setLocationDescription(event.target.value)}
              maxLength={255}
              required={!coordinates}
              placeholder={coordinates ? "Optional landmark or directions" : "Landmark, street, or barangay"}
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
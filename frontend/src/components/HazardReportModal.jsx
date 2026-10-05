import { useState, useEffect } from "react";
import { api } from "../services/api";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLocationDot, faCamera, faXmark, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import "../components_css/HazardReportModal.css";

const HAZARD_TYPES = [
  { value: "flood", label: "Flood" },
  { value: "landslide", label: "Landslide" },
  { value: "road blockage", label: "Road Blockage" },
  { value: "other", label: "Other" },
];

function HazardReportModal({ location, onClose, onSubmitted }) {
  const [description, setDescription] = useState("");
  const [reportType, setReportType] = useState("flood");
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!photo) {
      setPhotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  function handlePhotoChange(e) {
    setPhoto(e.target.files[0] || null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!photo) {
      setError("Please attach a photo.");
      return;
    }
    setSubmitting(true);
    setError("");

    const formData = new FormData();
    formData.append("description", description);
    formData.append("report_type", reportType);
    formData.append("latitude", location.lat);
    formData.append("longitude", location.lng);
    formData.append("photo", photo);

    try {
      await api.submitHazardReport(formData);
      onSubmitted();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="hzm-overlay" onClick={onClose}>
      

      <form onSubmit={handleSubmit} className="hzm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="hzm-header">
          <div className="hzm-header-text">
            <h3 className="hzm-title">Report a Hazard</h3>
            <span className="hzm-location">
              <FontAwesomeIcon icon={faLocationDot} />
              {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
            </span>
          </div>
          <button type="button" onClick={onClose} className="hzm-close" aria-label="Close">
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        <div className="hzm-body">
          {error && (
            <div className="hzm-error">
              <FontAwesomeIcon icon={faTriangleExclamation} />
              {error}
            </div>
          )}

          <label className="hzm-field">
            <span className="hzm-label">Hazard type</span>
            <div className="hzm-type-grid">
              {HAZARD_TYPES.map((t) => (
                <button
                  type="button"
                  key={t.value}
                  onClick={() => setReportType(t.value)}
                  className={`hzm-type-btn ${reportType === t.value ? "is-active" : ""}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </label>

          <label className="hzm-field">
            <span className="hzm-label">Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="hzm-textarea"
              placeholder="What are you seeing? (e.g. road flooded knee-deep, landslide blocking path)"
              required
            />
          </label>

          <label className="hzm-field">
            <span className="hzm-label">Photo</span>
            <label className="hzm-photo-drop">
              <input
                type="file"
                accept="image/png, image/jpeg, image/webp"
                onChange={handlePhotoChange}
                className="hzm-file-input"
                required
              />
              {photoPreview ? (
                <img src={photoPreview} alt="Selected hazard" className="hzm-photo-preview" />
              ) : (
                <span className="hzm-photo-placeholder">
                  <FontAwesomeIcon icon={faCamera} />
                  Tap to attach a photo
                </span>
              )}
            </label>
          </label>
        </div>

        <div className="hzm-actions">
          <button type="button" onClick={onClose} className="hzm-cancel-btn">
            Cancel
          </button>
          <button type="submit" disabled={submitting} className="hzm-submit-btn">
            {submitting ? "Submitting…" : "Submit report"}
          </button>
        </div>
      </form>
    </div>
  );
}



export default HazardReportModal;
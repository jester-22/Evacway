import { useState, useEffect } from "react";
import { api } from "../services/api";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLocationDot, faCamera, faXmark, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";

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
      <style>{CSS}</style>

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

const CSS = `
.hzm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(17, 24, 39, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  z-index: 2000;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  animation: hzm-fade-in 0.15s ease;
}
@keyframes hzm-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.hzm-modal {
  width: 100%;
  max-width: 400px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border-radius: 14px;
  box-shadow: 0 20px 50px rgba(17, 24, 39, 0.25);
  animation: hzm-pop-in 0.15s ease;
  overflow: hidden;
}
@keyframes hzm-pop-in {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.hzm-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 20px;
  border-bottom: 1px solid #f0f0f0;
}

.hzm-title {
  margin: 0;
  color: #111827;
  font-size: 16px;
  font-weight: 700;
}

.hzm-location {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  font-size: 12px;
  color: #6b7280;
}

.hzm-close {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: #f9fafb;
  color: #6b7280;
  border-radius: 999px;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.hzm-close:hover { background: #fee2e2; color: #dc2626; }

.hzm-body {
  padding: 18px 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.hzm-error {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #fee2e2;
  color: #991b1b;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
}

.hzm-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.hzm-label {
  font-size: 12px;
  font-weight: 600;
  color: #6b7280;
}

.hzm-type-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.hzm-type-btn {
  padding: 9px 10px;
  border-radius: 8px;
  border: 1px solid #ccc;
  background: #ffffff;
  color: #374151;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}
.hzm-type-btn:hover { border-color: #999; }
.hzm-type-btn.is-active {
  background: rgba(37, 99, 235, 0.1);
  border-color: #2563eb;
  color: #2563eb;
}

.hzm-textarea {
  width: 100%;
  min-height: 76px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid #ccc;
  background: #ffffff;
  color: #111827;
  font-family: inherit;
  font-size: 14px;
  resize: vertical;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.hzm-textarea:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
}

.hzm-photo-drop {
  position: relative;
  display: block;
  border: 1.5px dashed #ccc;
  border-radius: 10px;
  background: #f9fafb;
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.hzm-photo-drop:hover { border-color: #2563eb; background: rgba(37, 99, 235, 0.04); }

.hzm-file-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.hzm-photo-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 28px 12px;
  color: #6b7280;
  font-size: 13px;
  font-weight: 600;
}
.hzm-photo-placeholder svg { font-size: 18px; color: #9ca3af; }

.hzm-photo-preview {
  display: block;
  width: 100%;
  max-height: 180px;
  object-fit: cover;
}

.hzm-actions {
  display: flex;
  gap: 10px;
  padding: 16px 20px;
  border-top: 1px solid #f0f0f0;
}

.hzm-cancel-btn {
  flex: 1;
  padding: 11px;
  border-radius: 8px;
  border: 1px solid #ccc;
  background: white;
  color: #111827;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s ease;
}
.hzm-cancel-btn:hover { background: #f9fafb; }

.hzm-submit-btn {
  flex: 1;
  padding: 11px;
  border-radius: 8px;
  border: none;
  background: #2563eb;
  color: white;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s ease;
}
.hzm-submit-btn:hover:not(:disabled) { background: #1d4ed8; }
.hzm-submit-btn:disabled { opacity: 0.7; cursor: default; }

/* --- Mobile: bottom sheet --- */
@media (max-width: 640px) {
  .hzm-overlay { padding: 0; align-items: flex-end; }
  .hzm-modal {
    max-width: 100%;
    max-height: 85vh;
    border-radius: 16px 16px 0 0;
    animation: hzm-slide-up 0.2s ease;
  }
  .hzm-type-grid { grid-template-columns: 1fr 1fr; }
}
@keyframes hzm-slide-up {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
`;

export default HazardReportModal;
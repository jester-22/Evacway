import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { api } from "../../services/api";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faLocationDot,
  faCamera,
  faXmark,
  faTriangleExclamation,
  faPlus,
  faLocationCrosshairs,
  faMapPin,
  faCheck,
  faRoute,
  faCircleCheck,
} from "@fortawesome/free-solid-svg-icons";
import { createSelectedLocationElement } from "../../utils/mapLocationIndicators";
import "./HazardReportModal.css";

const MAX_PHOTOS = 5;

const HAZARD_TYPES = [
  { value: "flood", label: "Flood" },
  { value: "landslide", label: "Landslide" },
  { value: "road blockage", label: "Road Blockage" },
  { value: "other", label: "Other" },
];

function HazardReportModal({
  location,
  onClose,
  onSubmitted,
  onLocationChange,
  onAdjustOnMap,
  initialSuggestedRoad = null,
}) {
  const queryClient = useQueryClient();
  const [description, setDescription] = useState("");
  const [reportType, setReportType] = useState("flood");
  const [photos, setPhotos] = useState([]); // Array of File objects
  const [photoPreviews, setPhotoPreviews] = useState([]); // Array of blob URLs
  const [submitting, setSubmitting] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");
  const [addressText, setAddressText] = useState("");
  const [suggestedRoad, setSuggestedRoad] = useState(initialSuggestedRoad);
  const [isRoadConfirmed, setIsRoadConfirmed] = useState(initialSuggestedRoad ? false : true);

  // Sync initialSuggestedRoad if parent updates it
  useEffect(() => {
    if (initialSuggestedRoad) {
      setSuggestedRoad(initialSuggestedRoad);
      setIsRoadConfirmed(false);
    }
  }, [initialSuggestedRoad]);

  const previewContainerRef = useRef(null);
  const previewMapRef = useRef(null);
  const previewMarkerRef = useRef(null);

  // Keyboard Escape listener
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "Escape") {
        if (description || photos.length) {
          const confirmCancel = window.confirm("Discard hazard report draft?");
          if (!confirmCancel) return;
        }
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [description, photos.length, onClose]);

  // Object URLs for photo previews
  useEffect(() => {
    if (!photos.length) {
      setPhotoPreviews([]);
      return undefined;
    }
    const urls = photos.map((file) => URL.createObjectURL(file));
    setPhotoPreviews(urls);

    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [photos]);

  // Reverse geocode to resolve address / barangay text
  useEffect(() => {
    if (!location?.lat || !location?.lng) {
      setAddressText("");
      return undefined;
    }

    const lat = Number(location.lat);
    const lng = Number(location.lng);
    const token = import.meta.env.VITE_MAPBOX_TOKEN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !token) return undefined;

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
  }, [location?.lat, location?.lng]);

  // Non-interactive small Mapbox preview on the form
  useEffect(() => {
    if (!previewContainerRef.current || !location?.lat || !location?.lng) return undefined;

    const lat = Number(location.lat);
    const lng = Number(location.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;

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

    // Marker with the same pulsing 18px dot and "Selected location" label
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
      // Keep map instance cached during component life
    };
  }, [location?.lat, location?.lng]);

  // Cleanup preview map on unmount
  useEffect(() => {
    return () => {
      if (previewMarkerRef.current) previewMarkerRef.current.remove();
      if (previewMapRef.current) {
        previewMapRef.current.remove();
        previewMapRef.current = null;
      }
    };
  }, []);

  function handlePhotoAdd(e) {
    const selectedFiles = Array.from(e.target.files || []);
    if (!selectedFiles.length) return;

    setError("");
    const combined = [...photos, ...selectedFiles];

    if (combined.length > MAX_PHOTOS) {
      setError(`You can upload a maximum of ${MAX_PHOTOS} photos. The first ${MAX_PHOTOS} were kept.`);
      setPhotos(combined.slice(0, MAX_PHOTOS));
    } else {
      setPhotos(combined);
    }

    e.target.value = "";
  }

  function handleRemovePhoto(index) {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  }

  function handleUseMyLocation() {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser.");
      return;
    }

    setLocating(true);
    setError("");

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const rawLat = pos.coords.latitude;
        const rawLng = pos.coords.longitude;
        try {
          const snapData = await api.snapCoordinate(rawLat, rawLng);
          setLocating(false);
          const newLoc = {
            lat: snapData.snapped_lat,
            lng: snapData.snapped_lng,
            accuracy: pos.coords.accuracy,
            road_name: snapData.nearest_road,
          };
          const sugg = {
            road_name: snapData.nearest_road || "Unnamed road",
            distance_meters: snapData.snap_distance_meters,
            lat: snapData.snapped_lat,
            lng: snapData.snapped_lng,
            rawLat,
            rawLng,
          };
          setSuggestedRoad(sugg);
          setIsRoadConfirmed(false);
          if (onLocationChange) {
            onLocationChange(newLoc);
          }
        } catch {
          setLocating(false);
          setError("Could not find nearest road for your GPS location.");
        }
      },
      (err) => {
        setLocating(false);
        setError(err.message || "Could not retrieve your location.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (suggestedRoad && !isRoadConfirmed) {
      setError("Please check if the suggested nearest road is correct and click 'Yes, this is correct' before submitting.");
      return;
    }
    if (!photos.length) {
      setError("Please attach at least one photo.");
      return;
    }
    setSubmitting(true);
    setError("");

    const formData = new FormData();
    formData.append("description", description);
    formData.append("report_type", reportType);
    formData.append("latitude", location.lat);
    formData.append("longitude", location.lng);

    photos.forEach((file) => {
      formData.append("photos", file);
    });
    formData.append("photo", photos[0]);

    try {
      await api.submitHazardReport(formData);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["hazard-reports"] }),
        queryClient.invalidateQueries({ queryKey: ["hazard-reports", "public"] }),
      ]);
      onSubmitted();
    } catch (err) {
      setError(err.message || "Failed to submit hazard report.");
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
              {Number(location.lat).toFixed(5)}, {Number(location.lng).toFixed(5)}
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
              <span>{error}</span>
            </div>
          )}

          {/* SUGGESTED NEAREST ROAD CHECK CARD */}
          {suggestedRoad && (
            <div className={`hzm-road-check-card ${isRoadConfirmed ? "confirmed" : "pending"}`}>
              <div className="hzm-road-check-header">
                <div className="hzm-road-check-title-group">
                  <FontAwesomeIcon
                    icon={isRoadConfirmed ? faCircleCheck : faRoute}
                    className={isRoadConfirmed ? "hzm-icon-confirmed" : "hzm-icon-pending"}
                  />
                  <span className="hzm-road-check-title">
                    {isRoadConfirmed ? "Road Confirmed" : "Suggested Nearest Road"}
                  </span>
                </div>
                {suggestedRoad.distance_meters !== undefined && (
                  <span className="hzm-road-check-distance">
                    ~{Math.round(suggestedRoad.distance_meters)}m from GPS
                  </span>
                )}
              </div>

              <div className="hzm-road-check-name">
                <strong>{suggestedRoad.road_name || "Unnamed road"}</strong>
              </div>

              {!isRoadConfirmed ? (
                <div className="hzm-road-check-action-box">
                  <p className="hzm-road-check-prompt">
                    Please check if this is the correct road for your hazard report:
                  </p>
                  <div className="hzm-road-check-buttons">
                    <button
                      type="button"
                      className="hzm-btn-confirm-road"
                      onClick={() => {
                        setIsRoadConfirmed(true);
                        setError("");
                      }}
                    >
                      <FontAwesomeIcon icon={faCheck} />
                      <span>Yes, this is correct</span>
                    </button>
                    {onAdjustOnMap && (
                      <button
                        type="button"
                        className="hzm-btn-adjust-road"
                        onClick={onAdjustOnMap}
                      >
                        <FontAwesomeIcon icon={faMapPin} />
                        <span>Choose different road on map</span>
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="hzm-road-check-confirmed-row">
                  <span className="hzm-road-confirmed-badge">
                    <FontAwesomeIcon icon={faCheck} /> You confirmed this road is correct
                  </span>
                  <button
                    type="button"
                    className="hzm-btn-recheck-road"
                    onClick={() => setIsRoadConfirmed(false)}
                  >
                    Change
                  </button>
                </div>
              )}
            </div>
          )}

          {/* NON-INTERACTIVE MAP PREVIEW WITH THE SAME SELECTED LOCATION DOT */}
          <div className="hzm-map-preview-card">
            <div className="hzm-map-preview-header">
              <span className="hzm-label">Selected Location</span>
              <div className="hzm-map-preview-actions">
                <button
                  type="button"
                  onClick={handleUseMyLocation}
                  disabled={locating}
                  className="hzm-loc-btn"
                  title="Use current GPS position"
                >
                  <FontAwesomeIcon icon={faLocationCrosshairs} />
                  <span>{locating ? "Locating…" : "Use My Location"}</span>
                </button>
                {onAdjustOnMap && (
                  <button
                    type="button"
                    onClick={onAdjustOnMap}
                    className="hzm-adjust-btn"
                    title="Drag or click on map to adjust location"
                  >
                    <FontAwesomeIcon icon={faMapPin} />
                    <span>Adjust on Map</span>
                  </button>
                )}
              </div>
            </div>

            <div className="hzm-map-preview-box">
              <div ref={previewContainerRef} className="hzm-map-preview-canvas" />
            </div>

            <div className="hzm-map-coords-bar">
              <span className="hzm-coords-num">
                {Number(location.lat).toFixed(5)}° N, {Number(location.lng).toFixed(5)}° E
              </span>
              {location.road_name && (
                <span className="hzm-coords-road">
                  <FontAwesomeIcon icon={faRoute} /> {location.road_name}
                </span>
              )}
              {addressText && <span className="hzm-coords-address">{addressText}</span>}
            </div>
          </div>

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

          <div className="hzm-field">
            <div className="hzm-photo-label-row">
              <span className="hzm-label">Photos (up to {MAX_PHOTOS})</span>
              <span className="hzm-photo-count">
                {photos.length} / {MAX_PHOTOS}
              </span>
            </div>

            {photos.length === 0 ? (
              <label className="hzm-photo-drop">
                <input
                  type="file"
                  accept="image/png, image/jpeg, image/webp"
                  multiple
                  onChange={handlePhotoAdd}
                  className="hzm-file-input"
                  required
                />
                <span className="hzm-photo-placeholder">
                  <FontAwesomeIcon icon={faCamera} />
                  <span>Tap or drop photos to upload (max {MAX_PHOTOS})</span>
                </span>
              </label>
            ) : (
              <div className="hzm-multi-grid">
                {photoPreviews.map((previewUrl, idx) => (
                  <div key={previewUrl} className="hzm-preview-card">
                    <img
                      src={previewUrl}
                      alt={`Hazard upload ${idx + 1}`}
                      className="hzm-card-img"
                    />
                    {idx === 0 && <span className="hzm-cover-badge">Primary</span>}
                    <button
                      type="button"
                      onClick={() => handleRemovePhoto(idx)}
                      className="hzm-remove-btn"
                      aria-label="Remove photo"
                      title="Remove this photo"
                    >
                      <FontAwesomeIcon icon={faXmark} />
                    </button>
                  </div>
                ))}

                {photos.length < MAX_PHOTOS && (
                  <label className="hzm-add-more-card" title="Add another photo">
                    <input
                      type="file"
                      accept="image/png, image/jpeg, image/webp"
                      multiple
                      onChange={handlePhotoAdd}
                      className="hzm-file-input"
                    />
                    <FontAwesomeIcon icon={faPlus} />
                    <span>Add</span>
                  </label>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="hzm-actions">
          <button type="button" onClick={onClose} className="hzm-cancel-btn">
            Cancel
          </button>
          <button type="submit" disabled={submitting || !photos.length} className="hzm-submit-btn">
            {submitting ? "Submitting…" : "Submit report"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default HazardReportModal;
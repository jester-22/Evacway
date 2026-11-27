import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCamera,
  faXmark,
  faArrowsRotate,
  faCheck,
  faImages,
  faTriangleExclamation,
  faChevronLeft,
  faChevronRight,
  faTrash,
} from "@fortawesome/free-solid-svg-icons";
import "./CameraCaptureModal.css";

/**
 * Returns true when the browser supports live in-app camera capture via getUserMedia
 * (true on HTTPS and localhost across both desktop and mobile browsers).
 */
export function canUseInternalCamera() {
  return Boolean(
    typeof navigator !== "undefined" &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === "function"
  );
}

/**
 * Compact chooser modal opened when the user clicks a unified photo upload box,
 * letting them pick either the internal camera or choosing photo(s) from their device.
 */
export function PhotoSourceModal({
  isOpen,
  onClose,
  onUseCamera,
  onChoosePhoto,
  title = "Add photo",
  subtitle = "Take a live photo with your camera or choose from your device.",
}) {
  useEffect(() => {
    if (!isOpen) return undefined;
    function handleKeyDown(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose?.();
      }
    }
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const content = (
    <div
      className="ccm-overlay ccm-overlay--chooser"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="ccm-chooser-modal">
        <div className="ccm-header">
          <div className="ccm-title-stack">
            <h3 className="ccm-title">{title}</h3>
            {subtitle && <p className="ccm-subtitle">{subtitle}</p>}
          </div>
          <button
            type="button"
            className="ccm-close-btn"
            onClick={onClose}
            aria-label="Close photo options"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        <div className="ccm-chooser-list">
          <button
            type="button"
            className="ccm-chooser-option"
            onClick={() => {
              onClose?.();
              onUseCamera?.();
            }}
          >
            <span className="ccm-chooser-icon is-camera" aria-hidden="true">
              <FontAwesomeIcon icon={faCamera} />
            </span>
            <span className="ccm-chooser-copy">
              <strong>Use Camera</strong>
              <small>Open camera and take a photo now</small>
            </span>
            <FontAwesomeIcon icon={faChevronRight} className="ccm-chooser-arrow" aria-hidden="true" />
          </button>

          <button
            type="button"
            className="ccm-chooser-option"
            onClick={() => {
              onClose?.();
              onChoosePhoto?.();
            }}
          >
            <span className="ccm-chooser-icon is-gallery" aria-hidden="true">
              <FontAwesomeIcon icon={faImages} />
            </span>
            <span className="ccm-chooser-copy">
              <strong>Choose Photo</strong>
              <small>Pick existing image(s) from gallery or files</small>
            </span>
            <FontAwesomeIcon icon={faChevronRight} className="ccm-chooser-arrow" aria-hidden="true" />
          </button>
        </div>

        <div className="ccm-chooser-footer">
          <button type="button" className="ccm-btn ccm-btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(content, document.body) : content;
}

/**
 * Full-screen lightbox for inspecting attached upload thumbnails before submitting.
 * Supports prev/next navigation, keyboard arrows, Escape to close, and optional removal.
 */
export function PhotoLightboxModal({
  photos = [],
  activeIndex = null,
  onClose,
  onChangeIndex,
  onRemove,
}) {
  const isOpen =
    activeIndex !== null &&
    activeIndex >= 0 &&
    activeIndex < photos.length &&
    Boolean(photos[activeIndex]);

  useEffect(() => {
    if (!isOpen) return undefined;
    function handleKeyDown(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (photos.length > 1) {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          onChangeIndex?.(activeIndex > 0 ? activeIndex - 1 : photos.length - 1);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          onChangeIndex?.(activeIndex < photos.length - 1 ? activeIndex + 1 : 0);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, activeIndex, photos.length, onClose, onChangeIndex]);

  if (!isOpen) return null;

  const src = photos[activeIndex];
  const hasMultiple = photos.length > 1;

  function handlePrev(e) {
    e.stopPropagation();
    onChangeIndex?.(activeIndex > 0 ? activeIndex - 1 : photos.length - 1);
  }

  function handleNext(e) {
    e.stopPropagation();
    onChangeIndex?.(activeIndex < photos.length - 1 ? activeIndex + 1 : 0);
  }

  function handleRemoveClick(e) {
    e.stopPropagation();
    const nextLength = photos.length - 1;
    onRemove?.(activeIndex);
    if (nextLength <= 0) {
      onClose?.();
    } else if (activeIndex >= nextLength) {
      onChangeIndex?.(nextLength - 1);
    }
  }

  const content = (
    <div
      className="ccm-lightbox-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Photo preview ${activeIndex + 1} of ${photos.length}`}
      onClick={onClose}
    >
      <div className="ccm-lightbox-topbar" onClick={(e) => e.stopPropagation()}>
        <div className="ccm-lightbox-meta">
          <span className="ccm-lightbox-counter">
            Photo {activeIndex + 1} of {photos.length}
          </span>
          {activeIndex === 0 && <span className="ccm-lightbox-primary">Primary</span>}
        </div>
        <div className="ccm-lightbox-actions">
          {onRemove && (
            <button
              type="button"
              className="ccm-lightbox-action-btn is-danger"
              onClick={handleRemoveClick}
              aria-label="Remove this photo"
              title="Remove this photo"
            >
              <FontAwesomeIcon icon={faTrash} />
              <span>Remove</span>
            </button>
          )}
          <button
            type="button"
            className="ccm-lightbox-close-btn"
            onClick={onClose}
            aria-label="Close full view"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
      </div>

      <div className="ccm-lightbox-stage">
        {hasMultiple && (
          <button
            type="button"
            className="ccm-lightbox-nav is-prev"
            onClick={handlePrev}
            aria-label="Previous photo"
          >
            <FontAwesomeIcon icon={faChevronLeft} />
          </button>
        )}

        <img
          src={src}
          alt={`Uploaded photo ${activeIndex + 1}`}
          className="ccm-lightbox-img"
          onClick={(e) => e.stopPropagation()}
        />

        {hasMultiple && (
          <button
            type="button"
            className="ccm-lightbox-nav is-next"
            onClick={handleNext}
            aria-label="Next photo"
          >
            <FontAwesomeIcon icon={faChevronRight} />
          </button>
        )}
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(content, document.body) : content;
}

export default function CameraCaptureModal({
  isOpen,
  onClose,
  onCapture,
  onFallbackChooseFile,
  title = "Take a photo",
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const [facingMode, setFacingMode] = useState("environment");
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [capturedUrl, setCapturedUrl] = useState("");
  const [capturedBlob, setCapturedBlob] = useState(null);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore track stop errors
        }
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const clearCaptured = useCallback(() => {
    setCapturedUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return "";
    });
    setCapturedBlob(null);
  }, []);

  const startCamera = useCallback(
    async (mode) => {
      stopStream();
      setError("");
      setStarting(true);

      if (!canUseInternalCamera()) {
        setStarting(false);
        setError("Live camera is not available in this browser. You can choose a photo from your device instead.");
        return;
      }

      try {
        let stream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: mode },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
            audio: false,
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }

        if (typeof navigator.mediaDevices.enumerateDevices === "function") {
          try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoInputs = devices.filter((d) => d.kind === "videoinput");
            setHasMultipleCameras(videoInputs.length > 1);
          } catch {
            setHasMultipleCameras(false);
          }
        }
      } catch (err) {
        if (err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError") {
          setError("Camera permission was denied. Allow camera access in your browser settings or choose a photo from your device.");
        } else if (err?.name === "NotFoundError" || err?.name === "DevicesNotFoundError") {
          setError("No camera was detected on this device. Choose a photo from your files instead.");
        } else {
          setError("Could not start the camera right now. Try again or choose a photo from your device.");
        }
      } finally {
        setStarting(false);
      }
    },
    [stopStream]
  );

  const handleClose = useCallback(() => {
    stopStream();
    clearCaptured();
    setError("");
    onClose?.();
  }, [stopStream, clearCaptured, onClose]);

  useEffect(() => {
    if (!isOpen) {
      stopStream();
      return undefined;
    }

    if (!capturedUrl) {
      startCamera(facingMode);
    }

    return () => {
      stopStream();
    };
  }, [isOpen, facingMode, capturedUrl, startCamera, stopStream]);

  useEffect(() => {
    return () => {
      stopStream();
    };
  }, [stopStream]);

  useEffect(() => {
    if (!isOpen) return undefined;
    function handleKeyDown(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        handleClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, handleClose]);

  if (!isOpen) return null;

  function handleSnap() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError("Could not capture the photo. Please try again.");
          return;
        }
        stopStream();
        const objectUrl = URL.createObjectURL(blob);
        setCapturedBlob(blob);
        setCapturedUrl(objectUrl);
      },
      "image/jpeg",
      0.9
    );
  }

  function handleRetake() {
    clearCaptured();
  }

  function handleConfirmPhoto() {
    if (!capturedBlob) return;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = new File([capturedBlob], `evacway-camera-${timestamp}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
    clearCaptured();
    onCapture?.(file);
    onClose?.();
  }

  function handleToggleCamera() {
    setFacingMode((prev) => (prev === "environment" ? "user" : "environment"));
  }

  const content = (
    <div
      className="ccm-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="ccm-modal">
        <div className="ccm-header">
          <div className="ccm-title-row">
            <span className="ccm-title-icon" aria-hidden="true">
              <FontAwesomeIcon icon={faCamera} />
            </span>
            <h3 className="ccm-title">{title}</h3>
          </div>
          <button
            type="button"
            className="ccm-close-btn"
            onClick={handleClose}
            aria-label="Close camera"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        <div className="ccm-stage">
          {error ? (
            <div className="ccm-error-state" role="alert">
              <span className="ccm-error-icon" aria-hidden="true">
                <FontAwesomeIcon icon={faTriangleExclamation} />
              </span>
              <p className="ccm-error-text">{error}</p>
              <div className="ccm-error-actions">
                <button
                  type="button"
                  className="ccm-btn ccm-btn-secondary"
                  onClick={() => startCamera(facingMode)}
                >
                  <FontAwesomeIcon icon={faArrowsRotate} />
                  <span>Try again</span>
                </button>
                {onFallbackChooseFile && (
                  <button
                    type="button"
                    className="ccm-btn ccm-btn-primary"
                    onClick={onFallbackChooseFile}
                  >
                    <FontAwesomeIcon icon={faImages} />
                    <span>Choose photo instead</span>
                  </button>
                )}
              </div>
            </div>
          ) : capturedUrl ? (
            <img
              src={capturedUrl}
              alt="Captured preview"
              className="ccm-preview-img"
            />
          ) : (
            <>
              <video
                ref={videoRef}
                className="ccm-video"
                autoPlay
                playsInline
                muted
              />
              {starting && (
                <div className="ccm-loading-overlay">
                  <span>Starting camera…</span>
                </div>
              )}
            </>
          )}
          <canvas ref={canvasRef} className="ccm-canvas-hidden" />
        </div>

        {!error && (
          <div className="ccm-footer">
            {capturedUrl ? (
              <>
                <button
                  type="button"
                  className="ccm-btn ccm-btn-secondary"
                  onClick={handleRetake}
                >
                  <FontAwesomeIcon icon={faArrowsRotate} />
                  <span>Retake</span>
                </button>
                <button
                  type="button"
                  className="ccm-btn ccm-btn-primary"
                  onClick={handleConfirmPhoto}
                >
                  <FontAwesomeIcon icon={faCheck} />
                  <span>Use photo</span>
                </button>
              </>
            ) : (
              <>
                {hasMultipleCameras ? (
                  <button
                    type="button"
                    className="ccm-btn ccm-btn-secondary"
                    onClick={handleToggleCamera}
                    disabled={starting}
                  >
                    <FontAwesomeIcon icon={faArrowsRotate} />
                    <span>Switch</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="ccm-btn ccm-btn-secondary"
                    onClick={handleClose}
                  >
                    <span>Cancel</span>
                  </button>
                )}
                <button
                  type="button"
                  className="ccm-btn ccm-btn-capture"
                  onClick={handleSnap}
                  disabled={starting}
                >
                  <FontAwesomeIcon icon={faCamera} />
                  <span>Capture photo</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(content, document.body) : content;
}

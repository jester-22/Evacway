import { useState, useEffect } from "react";
import { api, BASE_URL } from "../services/api";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheck,
  faXmark,
  faImage,
  faArrowLeft,
  faLocationDot,
  faClock,
  faMagnifyingGlassPlus,
  faRoad,
  faWater,
  faMountain,
  faLockOpen,
  faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";

const FILTERS = ["pending", "validated", "rejected", "resolved", "all"];

const STATUS_META = {
  pending: { label: "Pending", color: "#2563eb", bg: "rgba(37, 99, 235, 0.1)" },
  validated: { label: "Validated", color: "#16a34a", bg: "rgba(22, 163, 74, 0.1)" },
  rejected: { label: "Rejected", color: "#dc2626", bg: "rgba(220, 38, 38, 0.1)" },
  resolved: { label: "Resolved", color: "#6b7280", bg: "rgba(107, 114, 128, 0.1)" },
  all: { label: "All", color: "#374151", bg: "rgba(55, 65, 81, 0.08)" },
};

function statusMeta(status) {
  return STATUS_META[status] || { label: status, color: "#6b7280", bg: "#f3f4f6" };
}

function reportIcon(reportType = "") {
  const type = reportType.toLowerCase();
  if (type.includes("road") || type.includes("block") || type.includes("obstruct")) return faRoad;
  if (type.includes("flood")) return faWater;
  if (type.includes("landslide")) return faMountain;
  return faTriangleExclamation;
}

function reportPhotoUrl(path) {
  if (!path) return "";
  return /^https?:\/\//i.test(path)
    ? path
    : `${BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

function HazardReportReview() {
  const [reports, setReports] = useState([]);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [selected, setSelected] = useState(null);
  const [responseNotes, setResponseNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [barangayName, setBarangayName] = useState("");
  const [barangayLoading, setBarangayLoading] = useState(false);
  const [photoError, setPhotoError] = useState(false);

  useEffect(() => {
    load();
  }, [statusFilter]);

  function load() {
    setLoading(true);
    api
      .getHazardReports(statusFilter === "all" ? null : statusFilter)
      .then(setReports)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!selected) {
      setBarangayName("");
      setBarangayLoading(false);
      return;
    }

    const knownBarangay =
      selected.barangay_name ||
      selected.barangay ||
      selected.location?.barangay ||
      selected.address?.barangay;

    if (knownBarangay) {
      setBarangayName(knownBarangay);
      setBarangayLoading(false);
      return;
    }

    const latitude = Number(selected.latitude);
    const longitude = Number(selected.longitude);
    const token = import.meta.env.VITE_MAPBOX_TOKEN;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !token) {
      setBarangayName("");
      setBarangayLoading(false);
      return;
    }

    let cancelled = false;
    setBarangayLoading(true);

    const url =
      `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${longitude}` +
      `&latitude=${latitude}&types=locality,neighborhood,place&access_token=${encodeURIComponent(token)}`;

    fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error("Barangay lookup failed.");
        return response.json();
      })
      .then((data) => {
        if (cancelled) return;
        const properties = data.features?.[0]?.properties;
        const context = properties?.context || {};
        const resolvedName =
          context.neighborhood?.name ||
          context.locality?.name ||
          context.place?.name ||
          properties?.name ||
          "";
        setBarangayName(resolvedName);
      })
      .catch(() => {
        if (!cancelled) setBarangayName("");
      })
      .finally(() => {
        if (!cancelled) setBarangayLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selected]);

  function openReport(r) {
    setSelected(r);
    setResponseNotes(r.response_notes || "");
    setPhotoError(false);
  }

  function backToList() {
    setSelected(null);
    setLightbox(false);
  }

  async function handleValidate(status) {
    if (!selected) return;
    try {
      const result = await api.validateHazardReport(selected.id, status, responseNotes);
      setSelected(null);
      setPhotoError(false);
      setResponseNotes("");
      setLightbox(false);
      load();

      if (result.closed_roads && result.closed_roads.length > 0) {
        alert(`Road(s) automatically closed due to this confirmed hazard:\n\n${result.closed_roads.join("\n")}`);
      }
    } catch (err) {
      alert(`Failed to update report: ${err.message}`);
    }
  }

  async function handleReopenRoad() {
    if (!selected) return;
    const confirmed = window.confirm(
      `Mark the road(s) tied to this report as fixed and reopen them for routing?`
    );
    if (!confirmed) return;

    setReopening(true);
    try {
      const result = await api.reopenRoad(selected.id);

      // Apply the actual updated report returned by the backend (status,
      // response_notes, validated_at, etc.) instead of patching a field
      // that doesn't exist on the model. This is what keeps the detail
      // panel and the list in sync with what really happened server-side.
      setSelected(result);
      setPhotoError(false);
      setReports((prev) => prev.map((r) => (r.id === result.id ? result : r)));

      if (result.reopened_roads?.length) {
        alert(`Reopened:\n\n${result.reopened_roads.join("\n")}`);
      }
      if (result.still_closed?.length) {
        alert(
          `Still closed — another active report is still nearby:\n\n${result.still_closed.join("\n")}`
        );
      }
      if (!result.reopened_roads?.length && !result.still_closed?.length) {
        alert("No closed roads were found near this report.");
      }
    } catch (err) {
      alert(`Failed to reopen road: ${err.message}`);
    } finally {
      setReopening(false);
    }
  }

  return (
    <div className="hr-page">
      <style>{CSS}</style>

      <div className={`hr-shell ${selected ? "has-selection" : ""}`}>
        {/* --- List panel --- */}
        <div className="hr-list-panel">
          <div className="hr-filter-row">
            {FILTERS.map((s) => {
              const meta = STATUS_META[s];
              const active = statusFilter === s;
              return (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`hr-filter-btn ${active ? "is-active" : ""}`}
                  style={active && meta ? { background: meta.color, borderColor: meta.color } : undefined}
                >
                  {meta && <span className="hr-filter-dot" style={{ background: active ? "#fff" : meta.color }} />}
                  {s}
                </button>
              );
            })}
          </div>

          <div className="hr-list-scroll">
            {loading && <div className="hr-loading">Loading reports…</div>}
            {!loading && reports.length === 0 && (
              <div className="hr-empty">
                <FontAwesomeIcon icon={faImage} className="hr-empty-icon" />
                <p className="hr-empty-title">No reports</p>
                <p className="hr-empty-text">Nothing in this filter right now.</p>
              </div>
            )}

            {reports.map((r) => {
              const meta = statusMeta(r.status);
              return (
                <button
                  key={r.id}
                  onClick={() => openReport(r)}
                  className={`hr-row ${selected?.id === r.id ? "is-selected" : ""}`}
                  style={{ borderLeftColor: meta.color }}
                >
                  <span className="hr-row-icon" aria-hidden="true">
                    <FontAwesomeIcon icon={reportIcon(r.report_type)} />
                  </span>
                  <div className="hr-row-body">
                    <div className="hr-row-top">
                      <strong className="hr-row-title">{r.report_type}</strong>
                      <span className="hr-pill" style={{ background: meta.bg, color: meta.color }}>
                        {meta.label}
                      </span>
                    </div>
                    <div className="hr-row-desc">
                      {(r.description || "No description provided").slice(0, 60)}
                    </div>
                    <div className="hr-row-meta">
                      {new Date(r.submitted_at).toLocaleString()}
                      {r.status === "validated" && (
                        <span className="hr-row-closed-tag">
                          <FontAwesomeIcon icon={faRoad} /> May have closed a road
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* --- Detail panel --- */}
        <div className="hr-detail-panel">
          {selected && (
            <button onClick={backToList} className="hr-back-btn">
              <FontAwesomeIcon icon={faArrowLeft} /> <span>Back to reports</span>
            </button>
          )}

          {!selected && (
            <div className="hr-placeholder">
              <FontAwesomeIcon icon={faImage} className="hr-placeholder-icon" />
              <p className="hr-placeholder-text">Select a report to review it</p>
            </div>
          )}

          {selected && (
            <div className="hr-detail">
              <div className="hr-detail-header">
                <h3 className="hr-detail-title">
                  <FontAwesomeIcon
                    icon={reportIcon(selected.report_type)}
                    className="hr-detail-type-icon"
                  />
                  {selected.report_type} <span className="hr-detail-id">#{selected.id}</span>
                </h3>
                <span
                  className="hr-pill hr-pill--lg"
                  style={{ background: statusMeta(selected.status).bg, color: statusMeta(selected.status).color }}
                >
                  {statusMeta(selected.status).label}
                </span>
              </div>

              {/* Only a report still in 'validated' status can trigger a
                  reopen — once the backend flips it to 'resolved' this
                  banner disappears on its own because selected.status
                  now reflects the real value from the API response. */}
              {selected.status === "validated" && (
                <div className="hr-road-banner">
                  <FontAwesomeIcon icon={faTriangleExclamation} />
                  <div className="hr-road-banner-text">
                    <strong>This hazard may have closed a nearby road.</strong> If it's been fixed, reopen the route.
                  </div>
                  <button
                    className="hr-unblock-btn"
                    onClick={handleReopenRoad}
                    disabled={reopening}
                  >
                    <FontAwesomeIcon icon={reopening ? faXmark : faLockOpen} />
                    {reopening ? "Reopening…" : "Mark fixed & reopen"}
                  </button>
                </div>
              )}

              {selected.status === "resolved" && (
                <div className="hr-resolved-banner">
                  <FontAwesomeIcon icon={faCheck} />
                  <div className="hr-road-banner-text">
                    <strong>Resolved.</strong> Any road closed by this report has been reopened.
                  </div>
                </div>
              )}

              {selected.photo_url && !photoError ? (
                <button className="hr-photo-btn" onClick={() => setLightbox(true)}>
                  <img
                    src={reportPhotoUrl(selected.photo_url)}
                    alt={`${selected.report_type || "Hazard"} report`}
                    className="hr-photo"
                    onError={() => setPhotoError(true)}
                  />
                  <span className="hr-photo-zoom">
                    <FontAwesomeIcon icon={faMagnifyingGlassPlus} /> View full size
                  </span>
                </button>
              ) : (
                <div className="hr-photo-missing">
                  <FontAwesomeIcon icon={reportIcon(selected.report_type)} />
                  <span>{photoError ? "Report photo unavailable" : "No photo attached"}</span>
                </div>
              )}

              <p className="hr-description">
                {selected.description || "No additional description provided."}
              </p>

              <div className="hr-detail-facts">
                <div className="hr-detail-fact hr-detail-fact--location">
                  <FontAwesomeIcon icon={faLocationDot} />
                  <span>Barangay</span>
                  <strong>
                    {barangayLoading
                      ? "Finding barangay..."
                      : barangayName || "Barangay not available"}
                  </strong>
                </div>
                <div className="hr-detail-fact">
                  <FontAwesomeIcon icon={faLocationDot} />
                  <span>Coordinates</span>
                  <strong>
                    {Number.isFinite(Number(selected.latitude)) &&
                    Number.isFinite(Number(selected.longitude))
                      ? `${Number(selected.latitude).toFixed(5)}, ${Number(selected.longitude).toFixed(5)}`
                      : "Location unavailable"}
                  </strong>
                </div>
                <div className="hr-detail-fact">
                  <FontAwesomeIcon icon={faClock} />
                  <span>Submitted</span>
                  <strong>
                    {selected.submitted_at
                      ? new Date(selected.submitted_at).toLocaleString()
                      : "Time unavailable"}
                  </strong>
                </div>
              </div>

              {selected.response_notes && (
                <div className="hr-response-notes">
                  <span>Previous response notes</span>
                  <p>{selected.response_notes}</p>
                </div>
              )}

              <label className="hr-label">Response notes</label>
              <textarea
                value={responseNotes}
                onChange={(e) => setResponseNotes(e.target.value)}
                className="hr-textarea"
                placeholder="Add context for this decision…"
              />

              {selected.status === "pending" && (
                <div className="hr-actions">
                  <button onClick={() => handleValidate("validated")} className="hr-approve-btn">
                    <FontAwesomeIcon icon={faCheck} /> <span>Validate</span>
                  </button>
                  <button onClick={() => handleValidate("rejected")} className="hr-reject-btn">
                    <FontAwesomeIcon icon={faXmark} /> <span>Reject</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {lightbox && selected?.photo_url && !photoError && (
        <div className="hr-overlay" onClick={() => setLightbox(false)}>
          <button className="hr-lightbox-close" onClick={() => setLightbox(false)} aria-label="Close">
            <FontAwesomeIcon icon={faXmark} />
          </button>
          <img
            src={reportPhotoUrl(selected.photo_url)}
            alt="hazard report full size"
            className="hr-lightbox-img"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

const CSS = `
.hr-page {
  display: flex;
  justify-content: center;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  height: 100%;
}

.hr-shell {
  position: relative;
  display: flex;
  width: 100%;
  max-width: 1100px;
  height: 100%;
  background: #ffffff;
  border: 1px solid #f0f0f0;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 1px 8px rgba(17, 24, 39, 0.04);
}

/* --- List panel --- */
.hr-list-panel {
  width: 320px;
  flex-shrink: 0;
  border-right: 1px solid #f0f0f0;
  display: flex;
  flex-direction: column;
  background: #ffffff;
}

.hr-filter-row {
  display: flex;
  padding: 14px;
  gap: 6px;
  flex-wrap: wrap;
  border-bottom: 1px solid #f0f0f0;
}

.hr-filter-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid #ccc;
  background: #ffffff;
  color: #374151;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  text-transform: capitalize;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.hr-filter-btn:hover { border-color: #999; }
.hr-filter-btn.is-active { color: #ffffff; }

.hr-filter-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  flex-shrink: 0;
}

.hr-list-scroll {
  flex: 1;
  overflow-y: auto;
}

.hr-loading, .hr-empty {
  padding: 24px 16px;
  text-align: center;
  color: #888;
}
.hr-empty-icon {
  font-size: 20px;
  color: #ccc;
  margin-bottom: 8px;
}
.hr-empty-title {
  margin: 0;
  color: #111827;
  font-weight: 600;
  font-size: 13px;
}
.hr-empty-text {
  margin: 4px 0 0;
  font-size: 12px;
  color: #888;
}

.hr-row {
  display: flex;
  gap: 10px;
  width: 100%;
  padding: 12px 14px;
  border: none;
  border-bottom: 1px solid #f0f0f0;
  border-left: 3px solid transparent;
  background: #ffffff;
  cursor: pointer;
  text-align: left;
  font: inherit;
  transition: background 0.15s ease;
}
.hr-row:hover { background: #f9fafb; }
.hr-row.is-selected { background: #eff6ff; }

.hr-thumb {
  width: 48px;
  height: 48px;
  border-radius: 8px;
  background-color: #f3f4f6;
  background-size: cover;
  background-position: center;
  flex-shrink: 0;
}

.hr-row-body {
  min-width: 0;
  flex: 1;
}

.hr-row-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.hr-row-title {
  font-size: 13px;
  color: #111827;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hr-row-desc {
  font-size: 12px;
  color: #666;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hr-row-meta {
  font-size: 11px;
  color: #999;
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.hr-row-closed-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #dc2626;
  font-weight: 700;
  font-size: 10px;
  background: rgba(220, 38, 38, 0.08);
  padding: 2px 6px;
  border-radius: 999px;
}

.hr-pill {
  font-size: 10px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 999px;
  white-space: nowrap;
  flex-shrink: 0;
}
.hr-pill--lg {
  font-size: 12px;
  padding: 5px 12px;
}

/* --- Detail panel --- */
.hr-detail-panel {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
  background: #ffffff;
  min-width: 0;
}

.hr-back-btn {
  display: none;
  align-items: center;
  gap: 8px;
  border: none;
  background: none;
  color: #2563eb;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  padding: 4px 0;
  margin-bottom: 12px;
}

.hr-placeholder {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #888;
  gap: 8px;
}
.hr-placeholder-icon { font-size: 22px; color: #ccc; }
.hr-placeholder-text { margin: 0; font-size: 13px; }

.hr-detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.hr-detail-title {
  margin: 0;
  color: #111827;
  font-size: 18px;
  font-weight: 700;
}
.hr-detail-id { color: #9ca3af; font-weight: 500; }

.hr-road-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(220, 38, 38, 0.07);
  border: 1px solid rgba(220, 38, 38, 0.25);
  color: #991b1b;
  flex-wrap: wrap;
}

.hr-resolved-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(22, 163, 74, 0.07);
  border: 1px solid rgba(22, 163, 74, 0.25);
  color: #15803d;
  flex-wrap: wrap;
}

.hr-road-banner-text {
  flex: 1;
  min-width: 160px;
  font-size: 13px;
  line-height: 1.4;
}

.hr-unblock-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 999px;
  border: none;
  background: #16a34a;
  color: #ffffff;
  font-weight: 600;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s ease, transform 0.1s ease;
}
.hr-unblock-btn:hover:not(:disabled) { background: #15803d; }
.hr-unblock-btn:active:not(:disabled) { transform: scale(0.97); }
.hr-unblock-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.hr-photo-btn {
  display: block;
  position: relative;
  width: 100%;
  max-width: 420px;
  margin: 14px 0;
  padding: 0;
  border: none;
  background: none;
  cursor: zoom-in;
  border-radius: 10px;
  overflow: hidden;
}
.hr-photo {
  display: block;
  width: 100%;
  border-radius: 10px;
  background: #f3f4f6;
}
.hr-photo-zoom {
  position: absolute;
  bottom: 8px;
  right: 8px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 999px;
  background: rgba(17, 24, 39, 0.65);
  color: #ffffff;
  font-size: 11px;
  font-weight: 600;
}

.hr-description {
  color: #374151;
  font-size: 14px;
  line-height: 1.5;
  max-width: 560px;
}

.hr-meta-box {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #6b7280;
  margin-right: 16px;
  margin-bottom: 8px;
}
.hr-meta-icon { color: #9ca3af; }

.hr-label {
  font-size: 12px;
  font-weight: 600;
  margin-top: 14px;
  margin-bottom: 6px;
  display: block;
  color: #6b7280;
}

.hr-textarea {
  width: 100%;
  max-width: 560px;
  min-height: 80px;
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
.hr-textarea:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
}

.hr-actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
  flex-wrap: wrap;
}

.hr-approve-btn, .hr-reject-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border-radius: 999px;
  border: none;
  color: white;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s ease, transform 0.1s ease;
}
.hr-approve-btn { background: #16a34a; }
.hr-approve-btn:hover { background: #15803d; }
.hr-reject-btn { background: #dc2626; }
.hr-reject-btn:hover { background: #b91c1c; }
.hr-approve-btn:active, .hr-reject-btn:active { transform: scale(0.97); }

/* --- Lightbox --- */
.hr-overlay {
  position: fixed;
  inset: 0;
  background: rgba(17, 24, 39, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  z-index: 60;
  animation: hr-fade-in 0.15s ease;
}
@keyframes hr-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
.hr-lightbox-img {
  max-width: 100%;
  max-height: 90vh;
  border-radius: 8px;
}
.hr-lightbox-close {
  position: absolute;
  top: 18px;
  right: 18px;
  width: 36px;
  height: 36px;
  border-radius: 999px;
  border: none;
  background: rgba(255, 255, 255, 0.15);
  color: #ffffff;
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease;
}
.hr-lightbox-close:hover { background: rgba(255, 255, 255, 0.3); }

/* --- Mobile: sliding master-detail --- */
@media (max-width: 768px) {
  .hr-page { height: 100%; }
  .hr-shell {
    border-radius: 0;
    border: none;
    box-shadow: none;
  }

  .hr-list-panel {
    width: 100%;
    position: absolute;
    inset: 0;
    transition: transform 0.2s ease;
    z-index: 1;
  }
  .hr-detail-panel {
    width: 100%;
    position: absolute;
    inset: 0;
    transform: translateX(100%);
    transition: transform 0.2s ease;
    z-index: 2;
  }
  .hr-shell.has-selection .hr-list-panel { transform: translateX(-100%); }
  .hr-shell.has-selection .hr-detail-panel { transform: translateX(0); }

  .hr-back-btn { display: inline-flex; }
  .hr-detail-panel { padding: 16px; }
  .hr-photo-btn { max-width: 100%; }
}

/* Hazard review workspace */
.hr-page {
  --hr-blue: #1759a6;
  --hr-blue-deep: #103d78;
  --hr-blue-pale: #edf4fc;
  --hr-ink: #18314d;
  --hr-muted: #6c7d92;
  --hr-line: #d9e3ee;
  height: 100%;
  color: var(--hr-ink);
  background: #f2f6fb;
  font-family: "Public Sans", "Segoe UI", sans-serif;
}

.hr-shell {
  border-color: #dce5ef;
  border-radius: 7px;
  box-shadow: 0 3px 12px rgba(23, 55, 91, 0.06);
}

.hr-list-panel {
  width: 350px;
  border-right-color: var(--hr-line);
  background: #fbfcfe;
}

.hr-filter-row {
  gap: 5px;
  padding: 12px;
  border-bottom-color: var(--hr-line);
  background: #fff;
}

.hr-filter-btn {
  min-height: 31px;
  padding: 5px 10px;
  border-color: #d5dfeb;
  border-radius: 5px;
  color: #566b83;
  font-size: 11px;
  transition: color 150ms ease, border-color 150ms ease, background 150ms ease;
}

.hr-filter-btn:hover {
  border-color: #86acd7;
  color: var(--hr-blue);
  background: #f4f8fd;
}

.hr-filter-btn.is-active {
  color: #fff;
  box-shadow: 0 2px 6px rgba(20, 65, 117, 0.16);
}

.hr-row {
  position: relative;
  align-items: flex-start;
  gap: 11px;
  padding: 12px;
  border-bottom-color: #e8edf3;
  transition: background 140ms ease, box-shadow 140ms ease;
  animation: hr-row-enter 260ms both;
}

.hr-row:nth-child(2) { animation-delay: 30ms; }
.hr-row:nth-child(3) { animation-delay: 60ms; }
.hr-row:nth-child(4) { animation-delay: 90ms; }

.hr-row:hover {
  background: #f1f6fc;
}

.hr-row.is-selected {
  background: #eaf3ff;
  box-shadow: inset 3px 0 0 #1f66ad;
}

.hr-row-icon {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  flex: 0 0 42px;
  border: 1px solid #d5e3f2;
  border-radius: 6px;
  color: var(--hr-blue);
  background: #edf4fc;
  font-size: 16px;
  transition: color 150ms ease, background 150ms ease, transform 150ms ease;
}

.hr-row:hover .hr-row-icon {
  color: #fff;
  background: var(--hr-blue);
  transform: translateY(-1px);
}

.hr-row-body { flex: 1; }

.hr-row-title {
  color: #173858;
  font-size: 12px;
  font-weight: 750;
}

.hr-row-desc {
  color: #5f7084;
  font-size: 11px;
  line-height: 1.4;
}

.hr-row-meta {
  color: #8090a3;
  font-size: 10px;
}

.hr-pill {
  padding: 3px 7px;
  border-radius: 4px;
  font-size: 9px;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.hr-detail-panel {
  padding: 22px 26px;
  background: #fff;
}

.hr-detail-header {
  align-items: center;
  padding-bottom: 13px;
  border-bottom: 1px solid #e5ebf2;
  animation: hr-detail-enter 300ms ease both;
}

.hr-detail-title {
  display: flex;
  align-items: center;
  gap: 9px;
  color: #173858;
  font-size: 18px;
}

.hr-detail-type-icon {
  color: var(--hr-blue);
  font-size: 16px;
}

.hr-road-banner,
.hr-resolved-banner {
  border-radius: 5px;
  animation: hr-detail-enter 240ms ease both;
}

.hr-photo-btn {
  max-width: 560px;
  max-height: 360px;
  margin: 16px 0 12px;
  border-radius: 6px;
  background: #eaf0f6;
  animation: hr-photo-enter 360ms ease both;
}

.hr-photo {
  max-height: 360px;
  object-fit: cover;
}

.hr-photo-missing {
  width: min(100%, 560px);
  min-height: 110px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  margin: 16px 0 12px;
  border: 1px dashed #c9d6e5;
  border-radius: 6px;
  color: #71849b;
  background: #f6f9fc;
  font-size: 12px;
}

.hr-photo-missing svg { color: var(--hr-blue); }

.hr-description {
  max-width: 680px;
  margin: 12px 0;
  color: #405670;
  font-size: 13px;
  line-height: 1.6;
}

.hr-detail-facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 14px 0;
}

.hr-detail-fact {
  min-width: 0;
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  column-gap: 8px;
  row-gap: 4px;
  padding: 10px;
  border: 1px solid #e0e8f1;
  border-radius: 5px;
  background: #f8fafd;
}

.hr-detail-fact > svg {
  grid-row: span 2;
  margin-top: 2px;
  color: var(--hr-blue);
  font-size: 12px;
}

.hr-detail-fact > span,
.hr-response-notes > span {
  color: #78899d;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

.hr-detail-fact strong {
  overflow-wrap: anywhere;
  color: #304963;
  font-size: 11px;
  font-weight: 650;
}

.hr-response-notes {
  max-width: 680px;
  padding: 11px 12px;
  border-left: 3px solid #7398c3;
  background: #f4f7fb;
}

.hr-response-notes p {
  margin: 5px 0 0;
  color: #405670;
  font-size: 12px;
  line-height: 1.5;
}

.hr-back-btn { color: var(--hr-blue); }

.hr-back-btn:hover { color: var(--hr-blue-deep); }

.hr-actions { gap: 8px; }

.hr-approve-btn,
.hr-reject-btn,
.hr-unblock-btn {
  min-height: 37px;
  border-radius: 5px;
  font-size: 12px;
}

.hr-approve-btn:hover,
.hr-reject-btn:hover,
.hr-unblock-btn:hover:not(:disabled) {
  transform: translateY(-1px);
}

@keyframes hr-row-enter {
  from { opacity: 0; transform: translateY(5px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes hr-detail-enter {
  from { opacity: 0; transform: translateX(7px); }
  to { opacity: 1; transform: translateX(0); }
}

@keyframes hr-photo-enter {
  from { opacity: 0; transform: scale(0.985); }
  to { opacity: 1; transform: scale(1); }
}

@media (max-width: 768px) {
  .hr-list-panel { width: 100%; }
  .hr-detail-facts { grid-template-columns: 1fr; }
  .hr-detail-panel { padding: 14px; }
}

@media (prefers-reduced-motion: reduce) {
  .hr-page *,
  .hr-page *::before,
  .hr-page *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
`;

export default HazardReportReview;
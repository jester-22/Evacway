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
import "../components_css/HazardReportReview.css";

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

function HazardReportReview({ focusReportId, onOpenMap }) {
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

  useEffect(() => {
    if (focusReportId == null) return undefined;
    let cancelled = false;
    api.getHazardReports(null).then((data) => {
      if (cancelled) return;
      const report = data.find((item) => String(item.id) === String(focusReportId));
      if (report) {
        setStatusFilter(report.status);
        setReports(data.filter((item) => item.status === report.status));
        openReport(report);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [focusReportId]);

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

              {Number.isFinite(Number(selected.latitude)) && Number.isFinite(Number(selected.longitude)) && (
                <button type="button" className="hr-map-button" onClick={() => onOpenMap?.(selected)}>
                  <FontAwesomeIcon icon={faLocationDot} /> Show report location on map
                </button>
              )}

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



export default HazardReportReview;
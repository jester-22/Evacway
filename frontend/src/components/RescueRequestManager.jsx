import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLocationDot, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { api } from "../services/api";
import "../components_css/RescueRequestManager.css";

const STATUS_OPTIONS = ["pending", "acknowledged", "responding", "resolved"];

export default function RescueRequestManager({ initialRequestId, onOpenMap }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState(null);
  const [selectedId, setSelectedId] = useState(initialRequestId || null);

  useEffect(() => {
    let mounted = true;

    async function loadRequests() {
      if (document.visibilityState !== "visible") return;
      try {
        const data = await api.getRescueRequests();
        if (mounted) {
          setRequests(data);
          setError("");
          setLoading(false);
        }
      } catch (requestError) {
        if (mounted) {
          setError(requestError.message || "Rescue requests could not be loaded.");
          setLoading(false);
        }
      }
    }

    loadRequests();
    const interval = window.setInterval(loadRequests, 30000);
    document.addEventListener("visibilitychange", loadRequests);
    return () => {
      mounted = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", loadRequests);
    };
  }, []);

  async function updateStatus(requestId, status) {
    setUpdatingId(requestId);
    setError("");
    try {
      const updated = await api.updateRescueRequest(requestId, status);
      setRequests((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (requestError) {
      setError(requestError.message || "Rescue request status could not be updated.");
    } finally {
      setUpdatingId(null);
    }
  }

  const selected = requests.find((item) => item.id === selectedId);

  return (
    <main className="rescue-queue-page">
      <header className="rescue-queue-header">
        <div>
          <p className="rescue-queue-kicker"><FontAwesomeIcon icon={faTriangleExclamation} /> Emergency response</p>
          <h1>Rescue requests</h1>
        </div>
        <span className="rescue-open-count">{requests.filter((item) => item.status !== "resolved").length} open</span>
      </header>

      {error && <p className="rescue-queue-error" role="alert">{error}</p>}

      <div className="rescue-queue-layout">
        <section className="rescue-request-list" aria-label="Rescue request list">
          {loading ? <p className="rescue-queue-empty">Loading rescue requests…</p> : requests.length === 0 ? (
            <p className="rescue-queue-empty">No rescue requests have been submitted.</p>
          ) : requests.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`rescue-request-row ${item.status !== "resolved" ? "is-open" : ""} ${selectedId === item.id ? "is-selected" : ""}`}
              onClick={() => setSelectedId(item.id)}
            >
              <span className="rescue-request-row-icon"><FontAwesomeIcon icon={faTriangleExclamation} /></span>
              <span className="rescue-request-row-copy">
                <strong>Rescue request #{item.id}</strong>
                <span>{item.description}</span>
                <small>{item.created_at ? new Date(item.created_at).toLocaleString() : ""}</small>
              </span>
              <span className={`rescue-status-badge status-${item.status}`}>{item.status}</span>
            </button>
          ))}
        </section>

        <section className="rescue-request-detail" aria-label="Rescue request details">
          {selected ? (
            <>
              <p className="rescue-detail-kicker">Emergency request #{selected.id}</p>
              <h2>Resident needs assistance</h2>
              <p className="rescue-detail-description">{selected.description}</p>
              <div className="rescue-detail-location">
                <FontAwesomeIcon icon={faLocationDot} />
                <div>
                  <strong>Location</strong>
                  {selected.latitude != null && selected.longitude != null ? (
                    <span>{selected.latitude.toFixed(5)}, {selected.longitude.toFixed(5)}</span>
                  ) : <span>GPS coordinates were not provided.</span>}
                  {selected.location_description && <span>{selected.location_description}</span>}
                </div>
              </div>
              {selected.latitude != null && selected.longitude != null && (
                <button type="button" className="rescue-map-button" onClick={() => onOpenMap(selected)}>
                  <FontAwesomeIcon icon={faLocationDot} /> Open location on dashboard map
                </button>
              )}
              <label className="rescue-status-control">
                <span>Response status</span>
                <select value={selected.status} disabled={updatingId === selected.id} onChange={(event) => updateStatus(selected.id, event.target.value)}>
                  {STATUS_OPTIONS.map((status) => <option value={status} key={status}>{status[0].toUpperCase() + status.slice(1)}</option>)}
                </select>
              </label>
            </>
          ) : (
            <p className="rescue-queue-empty">Select a rescue request to review its details.</p>
          )}
        </section>
      </div>
    </main>
  );
}
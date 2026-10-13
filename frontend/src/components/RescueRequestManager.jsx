import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLocationDot, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { api } from "../services/api";
import { queryKeys, useRescueRequests } from "../hooks/useEvacuationQueries";
import "../components_css/RescueRequestManager.css";

const STATUS_OPTIONS = ["pending", "acknowledged", "responding", "resolved"];

export default function RescueRequestManager({ initialRequestId, onOpenMap }) {
  const queryClient = useQueryClient();
  const requestsQuery = useRescueRequests();
  const refetchRequests = requestsQuery.refetch;
  const requests = requestsQuery.data || [];
  const loading = requestsQuery.isLoading;
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState(null);
  const [selectedId, setSelectedId] = useState(initialRequestId || null);

  useEffect(() => {
    function refreshWhenVisible() {
      if (document.visibilityState === "visible") refetchRequests();
    }

    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => document.removeEventListener("visibilitychange", refreshWhenVisible);
  }, [refetchRequests]);

  async function updateStatus(requestId, status) {
    setUpdatingId(requestId);
    setError("");
    try {
      const updated = await api.updateRescueRequest(requestId, status);
      queryClient.setQueryData(queryKeys.rescueRequests, (current = []) =>
        current.map((item) => item.id === updated.id ? updated : item)
      );
      await queryClient.invalidateQueries({ queryKey: queryKeys.rescueRequests });
    } catch (requestError) {
      setError(requestError.message || "Rescue request status could not be updated.");
    } finally {
      setUpdatingId(null);
    }
  }

  const selected = requests.find((item) => item.id === selectedId);
  const visibleError = error || requestsQuery.error?.message || "";
  const openCount = requests.filter((item) => item.status !== "resolved").length;

  return (
    <main className="rescue-queue-page">
      <header className="rescue-queue-header">
        <div>
          <h1>Rescue Alerts</h1>
          <p className="rescue-queue-subtitle">
            Review and respond to emergency rescue requests from residents.
          </p>
        </div>
        <span className="rescue-open-count">
          {openCount} {openCount === 1 ? "open alert" : "open alerts"}
        </span>
      </header>

      {visibleError && <p className="rescue-queue-error" role="alert">{visibleError}</p>}

      <div className="rescue-queue-layout">
        <section className="rescue-request-list" aria-label="Rescue request list">
          {loading ? (
            <p className="rescue-queue-empty">Loading rescue requests…</p>
          ) : requests.length === 0 ? (
            <p className="rescue-queue-empty">No rescue requests have been submitted.</p>
          ) : (
            requests.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`rescue-request-row ${item.status !== "resolved" ? "is-open" : ""} ${selectedId === item.id ? "is-selected" : ""}`}
                onClick={() => setSelectedId(item.id)}
              >
                <span className="rescue-request-row-icon">
                  <FontAwesomeIcon icon={faTriangleExclamation} />
                </span>
                <span className="rescue-request-row-copy">
                  <strong>Rescue Alert #{item.id}</strong>
                  <span>{item.description}</span>
                  <small>{item.created_at ? new Date(item.created_at).toLocaleString() : ""}</small>
                </span>
                <span className={`rescue-status-badge status-${item.status}`}>{item.status}</span>
              </button>
            ))
          )}
        </section>

        <section className="rescue-request-detail" aria-label="Rescue request details">
          {selected ? (
            <>
              <div className="rescue-detail-head">
                <h2>Rescue Alert #{selected.id}</h2>
                <span className={`rescue-status-badge status-${selected.status}`}>
                  {selected.status}
                </span>
              </div>
              <p className="rescue-detail-description">{selected.description}</p>
              <div className="rescue-detail-location">
                <FontAwesomeIcon icon={faLocationDot} />
                <div>
                  <strong>Location</strong>
                  {selected.latitude != null && selected.longitude != null ? (
                    <span>{selected.latitude.toFixed(5)}, {selected.longitude.toFixed(5)}</span>
                  ) : (
                    <span>Location coordinates were not provided.</span>
                  )}
                  {selected.location_description && <span>{selected.location_description}</span>}
                </div>
              </div>
              {selected.latitude != null && selected.longitude != null && (
                <button type="button" className="rescue-map-button" onClick={() => onOpenMap(selected)}>
                  <FontAwesomeIcon icon={faLocationDot} /> Show Location on Map
                </button>
              )}
              <label className="rescue-status-control">
                <span>Response Status</span>
                <select
                  value={selected.status}
                  disabled={updatingId === selected.id}
                  onChange={(event) => updateStatus(selected.id, event.target.value)}
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option value={status} key={status}>
                      {status[0].toUpperCase() + status.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <p className="rescue-queue-empty">Select a rescue alert on the left to view details and update its status.</p>
          )}
        </section>
      </div>
    </main>
  );
}
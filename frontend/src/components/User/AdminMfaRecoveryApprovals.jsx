import { useCallback, useEffect, useState } from "react";
import { api } from "../../services/api";
import "./AdminMfaRecoveryApprovals.css";

export default function AdminMfaRecoveryApprovals() {
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const result = await api.getAdminMfaRecoveryRequests();
      setRequests(result.requests || []);
      setError("");
    } catch (err) {
      setError(err.message || "Recovery requests could not be loaded.");
    }
  }, []);

  useEffect(() => {
    let active = true;
    api.getAdminMfaRecoveryRequests().then((result) => {
      if (active) setRequests(result.requests || []);
    }).catch((err) => {
      if (active) setError(err.message || "Recovery requests could not be loaded.");
    });
    return () => { active = false; };
  }, []);

  async function approve(id) {
    setBusyId(id);
    setError("");
    try {
      await api.approveAdminMfaRecoveryRequest(id);
      await refresh();
    } catch (err) {
      setError(err.message || "The recovery request could not be approved.");
    } finally {
      setBusyId(null);
    }
  }

  if (requests.length === 0 && !error) {
    return null;
  }

  return (
    <section className="amra-section ds-card" aria-labelledby="amra-title">
      <div className="amra-heading">
        <div>
          <h2 id="amra-title">Two-factor recovery requests</h2>
          <p>Approve a request only after verifying the staff member’s identity.</p>
        </div>
        <button type="button" className="ds-btn ds-btn--secondary" onClick={refresh}>Refresh</button>
      </div>
      {error && <p className="amra-error" role="alert">{error}</p>}
      {requests.length > 0 && (
        <ul className="amra-list">
          {requests.map((request) => (
            <li className="amra-row" key={request.id}>
              <div><strong>{request.name}</strong><span>{request.email}</span></div>
              <button type="button" className="ds-btn ds-btn--primary" disabled={busyId === request.id} onClick={() => approve(request.id)}>
                {busyId === request.id ? "Approving…" : "Approve recovery"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

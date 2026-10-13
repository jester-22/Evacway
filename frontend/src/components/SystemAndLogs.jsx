import { useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faClock,
  faDownload,
  faRotate,
  faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";
import "../components_css/SystemAndLogs.css";

function SystemAndLogs({ logs = [], user = null, loading = false, error = "" }) {
  const isPersonnel = user?.role === "lgu_personnel";
  const [adminScope, setAdminScope] = useState("all");
  const showOnlyMyLogs = isPersonnel ? true : adminScope === "mine";

  const safeUserId = user?.id ?? user?.user_id ?? user?.email ?? null;

  const filteredLogs = useMemo(() => {
    if (!showOnlyMyLogs) {
      return logs;
    }

    return logs.filter((log) => {
      const actorId =
        log.user_id ?? log.actor_id ?? log.created_by ?? log.user?.id ?? null;

      if (actorId == null && safeUserId == null) {
        return true;
      }

      return actorId != null && String(actorId) === String(safeUserId);
    });
  }, [logs, safeUserId, showOnlyMyLogs]);

  const totalLogs = filteredLogs.length;
  const lastActivity =
    totalLogs > 0 && filteredLogs[0]?.timestamp
      ? new Date(filteredLogs[0].timestamp).toLocaleString()
      : "No recent activity";

  function handleExport() {
    const rows = filteredLogs.map((log) => ({
      time: new Date(log.timestamp).toLocaleString(),
      action: log.action || "",
    }));

    const csv = [
      ["Time", "Action"],
      ...rows.map((row) => [row.time, row.action]),
    ]
      .map((line) =>
        line
          .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
          .join(",")
      )
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url;
    el.download = showOnlyMyLogs ? "my-logs.csv" : "system-logs.csv";
    el.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="sal-page">
      <div className="sal-shell">
        <header className="sal-header">
          <div>
            <h3 className="sal-title">
              {isPersonnel ? "My Activity Logs" : showOnlyMyLogs ? "My Activity Logs" : "Activity Logs"}
            </h3>
            <p className="sal-subtitle">
              View recent actions and system events.
            </p>
          </div>

          <div className="sal-actions">
            {!isPersonnel && (
              <div className="sal-toggle-group">
                <button
                  type="button"
                  className={!showOnlyMyLogs ? "sal-toggle active" : "sal-toggle"}
                  onClick={() => setAdminScope("all")}
                >
                  All Logs
                </button>
                <button
                  type="button"
                  className={showOnlyMyLogs ? "sal-toggle active" : "sal-toggle"}
                  onClick={() => setAdminScope("mine")}
                  disabled={!safeUserId}
                >
                  My Logs
                </button>
              </div>
            )}

            <button
              type="button"
              className="sal-export-btn"
              onClick={handleExport}
              disabled={loading || totalLogs === 0}
            >
              <FontAwesomeIcon icon={faDownload} />
              Export CSV
            </button>
          </div>
        </header>

        <div className="sal-summary-grid">
          <div className="sal-stat-card">
            <span>{showOnlyMyLogs ? "My Events" : "Total Events"}</span>
            <strong>{loading ? "..." : totalLogs}</strong>
          </div>

          <div className="sal-stat-card is-accent">
            <span>Latest Activity</span>
            <strong>{loading ? "Loading..." : lastActivity}</strong>
          </div>
        </div>

        <section className="sal-card">
          <div className="sal-card-header">
            <h4>{showOnlyMyLogs ? "My Activity" : "Recent Activity"}</h4>
            <span>{totalLogs} {totalLogs === 1 ? "entry" : "entries"}</span>
          </div>

          {loading ? (
            <div className="sal-loading" role="status" aria-live="polite">
              <div className="sal-loading-indicator">
                <FontAwesomeIcon icon={faRotate} spin />
              </div>
              <div className="sal-loading-copy">
                <strong>Loading activity logs...</strong>
                <span>Fetching recent system events</span>
              </div>
            </div>
          ) : error ? (
            <div className="sal-error-state" role="alert">
              <FontAwesomeIcon icon={faTriangleExclamation} />
              <span>{error}</span>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="sal-empty">
              <div className="sal-empty-icon">
                <FontAwesomeIcon icon={faClock} />
              </div>
              <p>
                {showOnlyMyLogs
                  ? "No activity has been recorded for your account yet."
                  : "No system activity recorded yet."}
              </p>
            </div>
          ) : (
            <div className="sal-table-wrap">
              <table className="sal-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredLogs.map((log) => (
                    <tr key={log.id ?? `${log.timestamp}-${log.action}`}>
                      <td>{new Date(log.timestamp).toLocaleString()}</td>
                      <td>{log.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default SystemAndLogs;

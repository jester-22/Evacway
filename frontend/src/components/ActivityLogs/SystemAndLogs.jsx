import { useMemo, useState, useEffect, Fragment } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faClock,
  faDownload,
  faRotate,
  faTriangleExclamation,
  faSearch,
  faXmark,
  faChevronLeft,
  faChevronRight,
  faUser,
} from "@fortawesome/free-solid-svg-icons";
import { useUsers } from "../../hooks/useEvacuationQueries";
import "./SystemAndLogs.css";

const ROLE_LABELS = {
  admin: "Admin",
  lgu_personnel: "LGU Personnel",
};

const PAGE_SIZE = 25;

export function getLogType(action = "") {
  const text = String(action || "").trim();
  const lower = text.toLowerCase();

  // Delete (starts with "Deleted" or "Safely deactivated/deleted", red)
  if (
    lower.startsWith("deleted") ||
    lower.startsWith("safely deactivated/deleted") ||
    lower.startsWith("safely deactivated")
  ) {
    return { key: "delete", label: "Delete", color: "red" };
  }

  // Create ("Created", "Added", "Registered", green)
  if (
    lower.startsWith("created") ||
    lower.startsWith("added") ||
    lower.startsWith("registered")
  ) {
    return { key: "create", label: "Create", color: "green" };
  }

  // Update ("Updated", "Edited", blue)
  if (lower.startsWith("updated") || lower.startsWith("edited")) {
    return { key: "update", label: "Update", color: "blue" };
  }

  // Assign ("Assigned", "Unassigned", "Reassigned", teal)
  if (
    lower.startsWith("assigned") ||
    lower.startsWith("unassigned") ||
    lower.startsWith("reassigned")
  ) {
    return { key: "assign", label: "Assign", color: "teal" };
  }

  // Import ("Imported", "Replaced ... from Excel", purple)
  if (
    lower.startsWith("imported") ||
    lower.startsWith("replaced") ||
    lower.includes("from excel")
  ) {
    return { key: "import", label: "Import", color: "purple" };
  }

  // Login ("Logged in", "Logged out", grey)
  if (lower.startsWith("logged in") || lower.startsWith("logged out")) {
    return { key: "login", label: "Login", color: "grey" };
  }

  // Review ("Verified", "Rejected", "Resolved", amber)
  if (
    lower.startsWith("verified") ||
    lower.startsWith("rejected") ||
    lower.startsWith("resolved")
  ) {
    return { key: "review", label: "Review", color: "amber" };
  }

  // Otherwise Other (grey)
  return { key: "other", label: "Other", color: "grey" };
}

function formatRelativeTime(dateString, now = Date.now()) {
  if (!dateString) return "";
  const date = new Date(dateString);
  const diffMs = now - date.getTime();
  if (Number.isNaN(diffMs)) return "";

  // Handle minor clock skew between client and server
  if (diffMs < 60 * 1000) return "Just now";

  const diffMins = Math.floor(diffMs / (1000 * 60));
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays <= 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getDayLabel(dateString) {
  if (!dateString) return "";
  const date = new Date(dateString);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today - target) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return target.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function SystemAndLogs({ logs = [], user = null, loading = false, error = "" }) {
  const isPersonnel = user?.role === "lgu_personnel";
  const [adminScope, setAdminScope] = useState("all");
  const showOnlyMyLogs = isPersonnel ? true : adminScope === "mine";

  // Filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [now, setNow] = useState(Date.now());

  // Periodically refresh relative time
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const usersQuery = useUsers();
  const users = usersQuery.data || [];

  const userMap = useMemo(() => {
    const map = new Map();
    users.forEach((u) => {
      map.set(String(u.id), u);
    });
    return map;
  }, [users]);

  function resolveUser(log) {
    if (log.user) {
      return {
        name: log.user.name || "User",
        role: ROLE_LABELS[log.user.role] || log.user.role || "",
      };
    }
    if (log.user_name) {
      return {
        name: log.user_name,
        role: ROLE_LABELS[log.role] || log.role || "",
      };
    }
    if (log.user_id != null) {
      const found = userMap.get(String(log.user_id));
      if (found) {
        return {
          name: found.name,
          role: ROLE_LABELS[found.role] || found.role || "",
        };
      }
      return {
        name: `User #${log.user_id}`,
        role: "",
      };
    }
    return {
      name: "System",
      role: "",
    };
  }

  const safeUserId = user?.id ?? user?.user_id ?? user?.email ?? null;

  // 1. Scope filter (All logs vs My logs)
  const scopedLogs = useMemo(() => {
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

  // Unique users found in data for user filter
  const userOptions = useMemo(() => {
    const map = new Map();
    users.forEach((u) => {
      map.set(String(u.id), {
        id: String(u.id),
        name: u.name,
        role: ROLE_LABELS[u.role] || u.role || "",
      });
    });
    logs.forEach((log) => {
      if (log.user_id != null && !map.has(String(log.user_id))) {
        map.set(String(log.user_id), {
          id: String(log.user_id),
          name: `User #${log.user_id}`,
          role: "",
        });
      }
    });

    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [users, logs]);

  const hasSystemLogs = useMemo(() => logs.some((l) => l.user_id == null), [logs]);

  // 2. Toolbar filters application
  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return scopedLogs.filter((log) => {
      const userInfo = resolveUser(log);
      const typeInfo = getLogType(log.action);

      // Search query (action text, user name, role)
      if (q) {
        const matchAction = (log.action || "").toLowerCase().includes(q);
        const matchUser = userInfo.name.toLowerCase().includes(q);
        const matchRole = userInfo.role.toLowerCase().includes(q);
        const matchId = String(log.user_id || "").includes(q);
        if (!matchAction && !matchUser && !matchRole && !matchId) {
          return false;
        }
      }

      // User filter
      if (userFilter) {
        if (userFilter === "system") {
          if (log.user_id != null) return false;
        } else if (String(log.user_id) !== String(userFilter)) {
          return false;
        }
      }

      // Type filter
      if (typeFilter) {
        if (typeInfo.key !== typeFilter) {
          return false;
        }
      }

      // Date range filter
      if (fromDate) {
        const fromTs = new Date(`${fromDate}T00:00:00`).getTime();
        const logTs = new Date(log.timestamp).getTime();
        if (logTs < fromTs) return false;
      }

      if (toDate) {
        const toTs = new Date(`${toDate}T23:59:59.999`).getTime();
        const logTs = new Date(log.timestamp).getTime();
        if (logTs > toTs) return false;
      }

      return true;
    });
  }, [scopedLogs, searchQuery, userFilter, typeFilter, fromDate, toDate, userMap]);

  // Reset to page 1 whenever any filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, userFilter, typeFilter, fromDate, toDate, adminScope]);

  const isFilterActive = Boolean(
    searchQuery.trim() || userFilter || typeFilter || fromDate || toDate
  );

  function handleClearFilters() {
    setSearchQuery("");
    setUserFilter("");
    setTypeFilter("");
    setFromDate("");
    setToDate("");
  }

  // Pagination calculation
  const totalLogs = filteredLogs.length;
  const totalPages = Math.max(1, Math.ceil(totalLogs / PAGE_SIZE));
  const pageStart = totalLogs === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(currentPage * PAGE_SIZE, totalLogs);

  const paginatedLogs = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredLogs.slice(start, start + PAGE_SIZE);
  }, [filteredLogs, currentPage]);

  const latestTimestamp = filteredLogs[0]?.timestamp;
  const latestActivityText =
    latestTimestamp ? formatRelativeTime(latestTimestamp, now) : "No recent activity";

  function handleExport() {
    const csvRows = [
      ["Time (ISO)", "User", "Role", "Type", "Action"],
      ...filteredLogs.map((log) => {
        const userInfo = resolveUser(log);
        const typeInfo = getLogType(log.action);
        return [
          log.timestamp ? new Date(log.timestamp).toISOString() : "",
          userInfo.name,
          userInfo.role,
          typeInfo.label,
          log.action || "",
        ];
      }),
    ];

    const csvContent = csvRows
      .map((row) =>
        row
          .map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`)
          .join(",")
      )
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = showOnlyMyLogs ? "my-activity-logs.csv" : "activity-logs.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  // Pre-calculate day separators for paginated rows
  let prevDayLabel = null;

  return (
    <div className="sal-page">
      <div className="sal-shell">
        {/* HEADER */}
        <header className="sal-header">
          <div>
            <h3 className="sal-title">
              {isPersonnel
                ? "My Activity Logs"
                : showOnlyMyLogs
                ? "My Activity Logs"
                : "Activity Logs"}
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

        {/* 5. STAT CARDS (NO BLUE HIGHLIGHT UNLESS FILTER) */}
        <div className="sal-summary-grid">
          <div className="sal-stat-card">
            <span>
              {scopedLogs.length === 200 && !isFilterActive
                ? "Latest 200 events"
                : "Events"}
            </span>
            <strong>
              {filteredLogs.length}
              {isFilterActive && (
                <span className="sal-stat-sub"> of {scopedLogs.length} loaded</span>
              )}
            </strong>
          </div>

          <div className="sal-stat-card">
            <span>Latest activity</span>
            <strong
              title={
                latestTimestamp
                  ? new Date(latestTimestamp).toLocaleString()
                  : undefined
              }
            >
              {loading ? "Loading..." : latestActivityText}
            </strong>
          </div>
        </div>

        {/* 4. FILTERS TOOLBAR */}
        <div className="sal-toolbar" role="region" aria-label="Filter logs">
          <div className="sal-search-wrap">
            <FontAwesomeIcon icon={faSearch} className="sal-search-icon" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search action or user…"
              className="sal-input sal-search-input"
              aria-label="Search action or user"
            />
          </div>

          <div className="sal-toolbar-filters">
            <select
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
              className="sal-select"
              aria-label="Filter by user"
            >
              <option value="">All users</option>
              {hasSystemLogs && <option value="system">System (Automated)</option>}
              {userOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.name} {opt.role ? `(${opt.role})` : ""}
                </option>
              ))}
            </select>

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="sal-select"
              aria-label="Filter by type"
            >
              <option value="">All types</option>
              <option value="create">Create</option>
              <option value="update">Update</option>
              <option value="delete">Delete</option>
              <option value="assign">Assign</option>
              <option value="import">Import</option>
              <option value="review">Review</option>
              <option value="login">Login</option>
              <option value="other">Other</option>
            </select>

            <div className="sal-date-group">
              <label className="sal-date-field">
                <span className="sal-date-label">From:</span>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="sal-date-input"
                  aria-label="From date"
                />
              </label>

              <label className="sal-date-field">
                <span className="sal-date-label">To:</span>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="sal-date-input"
                  aria-label="To date"
                />
              </label>
            </div>

            {isFilterActive && (
              <button
                type="button"
                className="sal-clear-btn"
                onClick={handleClearFilters}
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        {/* MAIN CARD & LOGS LIST */}
        <section className="sal-card">
          <div className="sal-card-header">
            <h4>{showOnlyMyLogs ? "My Activity" : "Recent Activity"}</h4>
            <span className="sal-result-count">
              {totalLogs} {totalLogs === 1 ? "entry" : "entries"}
            </span>
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
              <span>{error?.message || String(error)}</span>
            </div>
          ) : scopedLogs.length === 0 ? (
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
          ) : filteredLogs.length === 0 ? (
            /* 7. EMPTY STATE WITH CLEAR FILTERS */
            <div className="sal-empty">
              <div className="sal-empty-icon">
                <FontAwesomeIcon icon={faClock} />
              </div>
              <p className="sal-empty-title">No activity matches your filters</p>
              <p className="sal-empty-subtitle">
                Try adjusting your search terms or filter selections.
              </p>
              <button
                type="button"
                className="sal-clear-btn sal-empty-clear-btn"
                onClick={handleClearFilters}
              >
                Clear filters
              </button>
            </div>
          ) : (
            <>
              {/* DESKTOP TABLE VIEW (above 768px) */}
              <div className="sal-table-wrap">
                <table className="sal-table">
                  <thead>
                    <tr>
                      <th className="sal-th-time">Time</th>
                      <th className="sal-th-user">User</th>
                      <th className="sal-th-type">Type</th>
                      <th className="sal-th-action">Action</th>
                    </tr>
                  </thead>

                  <tbody>
                    {paginatedLogs.map((log) => {
                      const userInfo = resolveUser(log);
                      const typeInfo = getLogType(log.action);
                      const dayLabel = getDayLabel(log.timestamp);
                      const showSeparator = dayLabel !== prevDayLabel;
                      prevDayLabel = dayLabel;

                      return (
                        <Fragment key={log.id ?? `${log.timestamp}-${log.action}`}>
                          {showSeparator && (
                            <tr className="sal-day-row">
                              <td colSpan={4}>
                                <span className="sal-day-badge">{dayLabel}</span>
                              </td>
                            </tr>
                          )}
                          <tr className="sal-log-row">
                            <td
                              className="sal-td-time"
                              title={
                                log.timestamp
                                  ? new Date(log.timestamp).toLocaleString()
                                  : ""
                              }
                            >
                              {formatRelativeTime(log.timestamp, now)}
                            </td>
                            <td className="sal-td-user">
                              <strong className="sal-user-name">
                                {userInfo.name}
                              </strong>
                              {userInfo.role && (
                                <small className="sal-user-role">
                                  {userInfo.role}
                                </small>
                              )}
                            </td>
                            <td className="sal-td-type">
                              <span
                                className={`sal-type-badge type-${typeInfo.color}`}
                              >
                                {typeInfo.label}
                              </span>
                            </td>
                            <td className="sal-td-action">{log.action}</td>
                          </tr>
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* MOBILE CARDS VIEW (at 768px and below) */}
              <div className="sal-cards-wrap">
                {(() => {
                  let mobilePrevDay = null;
                  return paginatedLogs.map((log) => {
                    const userInfo = resolveUser(log);
                    const typeInfo = getLogType(log.action);
                    const dayLabel = getDayLabel(log.timestamp);
                    const showDay = dayLabel !== mobilePrevDay;
                    mobilePrevDay = dayLabel;

                    return (
                      <div
                        key={`m-${log.id ?? `${log.timestamp}-${log.action}`}`}
                        className="sal-card-container"
                      >
                        {showDay && (
                          <div className="sal-day-separator-mobile">
                            <span>{dayLabel}</span>
                          </div>
                        )}
                        <article className="sal-entry-card">
                          <div className="sal-entry-card-header">
                            <span
                              className={`sal-type-badge type-${typeInfo.color}`}
                            >
                              {typeInfo.label}
                            </span>
                            <span
                              className="sal-entry-time"
                              title={
                                log.timestamp
                                  ? new Date(log.timestamp).toLocaleString()
                                  : ""
                              }
                            >
                              {formatRelativeTime(log.timestamp, now)}
                            </span>
                          </div>

                          <p className="sal-entry-action">{log.action}</p>

                          <div className="sal-entry-user">
                            <FontAwesomeIcon
                              icon={faUser}
                              className="sal-entry-user-icon"
                            />
                            <div className="sal-entry-user-info">
                              <span className="sal-entry-user-name">
                                {userInfo.name}
                              </span>
                              {userInfo.role && (
                                <span className="sal-entry-user-role">
                                  {userInfo.role}
                                </span>
                              )}
                            </div>
                          </div>
                        </article>
                      </div>
                    );
                  });
                })()}
              </div>

              {/* 6. PAGINATION */}
              <div className="sal-pagination-bar">
                <span className="sal-pagination-info">
                  {pageStart}-{pageEnd} of {totalLogs}
                </span>

                <div className="sal-pagination-actions">
                  <button
                    type="button"
                    className="sal-page-btn"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage <= 1}
                    aria-label="Previous page"
                  >
                    <FontAwesomeIcon icon={faChevronLeft} />
                    <span>Previous</span>
                  </button>

                  <button
                    type="button"
                    className="sal-page-btn"
                    onClick={() =>
                      setCurrentPage((p) => Math.min(totalPages, p + 1))
                    }
                    disabled={currentPage >= totalPages}
                    aria-label="Next page"
                  >
                    <span>Next</span>
                    <FontAwesomeIcon icon={faChevronRight} />
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

export default SystemAndLogs;

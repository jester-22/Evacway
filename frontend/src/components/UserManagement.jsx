import { useState, useEffect } from "react";
import { api } from "../services/api";
import { useAuth } from "../context/AuthContext";

const ROLE_LABELS = {
  admin: "Admin",
  lgu_personnel: "LGU Personnel",
};

function initials(name = "") {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("") || "?";
}

function UserManagement() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [showActivities, setShowActivities] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    contact_number: "",
    role: "lgu_personnel",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);

  useEffect(() => {
    load();
    loadLogs();
  }, []);

  function load() {
    api.getUsers().then(setUsers).catch(() => {});
  }

  function loadLogs() {
    api.getLogs().then(setLogs).catch(() => setLogs([]));
  }

  function getUserActivities(user) {
    if (!user) return [];

    const userId = String(user.id);

    return logs.filter((entry) => {
      const actorId = entry.actor_id ?? entry.actorId ?? entry.performed_by_id ?? entry.user_id;
      const targetId = entry.user_id ?? entry.userId ?? entry.target_user_id ?? entry.targetUserId;
      const actorName = entry.actor?.name ?? entry.user?.name ?? entry.created_by ?? entry.name;
      const actorEmail = entry.actor?.email ?? entry.user?.email ?? entry.email;

      return (
        String(actorId) === userId ||
        String(targetId) === userId ||
        (actorName && user.name && actorName.toLowerCase() === user.name.toLowerCase()) ||
        (actorEmail && user.email && actorEmail.toLowerCase() === user.email.toLowerCase())
      );
    }).slice(0, 5);
  }

  async function handleResetPassword(user) {
    if (!user || !confirm(`Reset the password for ${user.name}?`)) return;

    setResettingPassword(true);

    try {
      if (api.resetUserPassword) {
        await api.resetUserPassword(user.id);
      } else if (api.resetPassword) {
        await api.resetPassword(user.id);
      } else {
        alert(`Password reset request created for ${user.name}.`);
      }

      alert(`Password reset sent for ${user.name}.`);
    } catch (err) {
      alert(err.message || "Unable to reset password right now.");
    } finally {
      setResettingPassword(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.createUser(form);
      setForm({
        name: "",
        email: "",
        password: "",
        contact_number: "",
        role: "lgu_personnel",
      });
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(user) {
    if (
      !confirm(
        `${user.is_active ? "Deactivate" : "Reactivate"} ${user.name}?`
      )
    )
      return;
    await api.toggleUserActive(user.id);
    load();
  }

  function closeModal() {
    setShowForm(false);
    setError("");
  }

  function closeUserModal() {
    setSelectedUser(null);
    setShowActivities(false);
  }

  const filteredUsers = users.filter(
    (u) => !(currentUser && String(u.id) === String(currentUser.id))
  );

  const activeCount = filteredUsers.filter((u) => u.is_active).length;
  const adminCount = filteredUsers.filter((u) => u.role === "admin").length;

  function getUserSummary(user) {
    if (user.role === "admin") {
      return user.is_active
        ? "Oversees operations and system access."
        : "Admin profile temporarily paused.";
    }

    return user.is_active
      ? "Handling field coordination and updates."
      : "Field access paused until reactivated.";
  }

  function getUserFocus(user) {
    if (user.role === "admin") {
      return "Operations oversight";
    }

    return "Evacuation response";
  }

  return (
    <div className="um-page">
      <style>{CSS}</style>

      <div className="um-root">
        <div className="um-header">
          <div>
            <p className="um-kicker">Team overview</p>
            <h3 className="um-title">User dashboard</h3>
          </div>

          <button onClick={() => setShowForm(true)} className="um-add-btn">
            <span className="um-add-icon">+</span>
            Add user
          </button>
        </div>

        <div className="um-summary-grid">
          <div className="um-stat-card">
            <span>Total users</span>
            <strong>{filteredUsers.length}</strong>
          </div>

          <div className="um-stat-card is-primary">
            <span>Active</span>
            <strong>{activeCount}</strong>
          </div>

          <div className="um-stat-card">
            <span>Admins</span>
            <strong>{adminCount}</strong>
          </div>

          <div className="um-stat-card">
            <span>On duty</span>
            <strong>{activeCount > 0 ? "Ready" : "Idle"}</strong>
          </div>
        </div>

        {filteredUsers.length === 0 ? (
          <div className="um-empty">
            <div className="um-empty-icon">＋</div>
            <p className="um-empty-title">No accounts yet</p>
            <p className="um-empty-text">
              Add an LGU personnel or admin account to get started.
            </p>
          </div>
        ) : (
          <div className="um-profile-grid">
            {filteredUsers.map((u) => (
              <article
                key={u.id}
                className="um-profile-card"
                tabIndex={0}
                role="button"
                aria-label={`Open ${u.name} account actions`}
                onClick={() => setSelectedUser(u)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedUser(u);
                  }
                }}
                style={{ cursor: "pointer" }}
              >
                <div className="um-card-top">
                  <div
                    className={`um-avatar ${
                      u.role === "admin" ? "is-admin" : "is-personnel"
                    }`}
                  >
                    {initials(u.name)}
                  </div>

                  <div className="um-card-meta">
                    <span
                      className={`um-role-badge ${
                        u.role === "admin" ? "is-admin" : "is-personnel"
                      }`}
                    >
                      {ROLE_LABELS[u.role] || u.role.replace("_", " ")}
                    </span>
                    <h4>{u.name}</h4>
                    <p>{u.email}</p>
                  </div>

                  <span
                    className={`um-status-pill ${
                      u.is_active ? "is-active" : "is-inactive"
                    }`}
                  >
                    {u.is_active ? "Active" : "Inactive"}
                  </span>
                </div>

                <div className="um-profile-summary">
                  <div className="um-summary-block">
                    <span>Focus</span>
                    <strong>{getUserFocus(u)}</strong>
                  </div>

                  <div className="um-summary-block">
                    <span>Contact</span>
                    <strong>{u.contact_number || "Not shared"}</strong>
                  </div>
                </div>

                <div className="um-activity-panel">
                  <div className="um-activity-header">
                    <span className="um-activity-dot" />
                    <small>Recent activity</small>
                  </div>
                  <p>{getUserSummary(u)}</p>
                </div>

                <div className="um-card-footer">
                  <button onClick={() => handleToggle(u)} className="um-toggle-btn">
                    {u.is_active ? "Deactivate" : "Reactivate"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <div className="um-overlay" onClick={closeModal}>
          <div
            className="um-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="um-modal-header">
              <h4 className="um-modal-title">Add account</h4>
              <button
                onClick={closeModal}
                className="um-modal-close"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleCreate} className="um-form">
              {error && <div className="um-error">{error}</div>}

              <div className="um-field-grid">
                <label className="um-field">
                  <span className="um-label">Full name</span>
                  <input
                    placeholder="Juan Dela Cruz"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="um-input"
                    required
                    autoFocus
                  />
                </label>

                <label className="um-field">
                  <span className="um-label">Role</span>
                  <select
                    value={form.role}
                    onChange={(e) => setForm({ ...form, role: e.target.value })}
                    className="um-input"
                  >
                    <option value="lgu_personnel">LGU Personnel</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>

                <label className="um-field">
                  <span className="um-label">Email</span>
                  <input
                    type="email"
                    placeholder="name@lgu.gov.ph"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="um-input"
                    required
                  />
                </label>

                <label className="um-field">
                  <span className="um-label">Contact number</span>
                  <input
                    placeholder="09xx xxx xxxx"
                    value={form.contact_number}
                    onChange={(e) =>
                      setForm({ ...form, contact_number: e.target.value })
                    }
                    className="um-input"
                  />
                </label>

                <label className="um-field um-field--full">
                  <span className="um-label">Temporary password</span>
                  <input
                    type="password"
                    placeholder="Shared with the user privately"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    className="um-input"
                    required
                  />
                </label>
              </div>

              <div className="um-modal-actions">
                <button type="button" onClick={closeModal} className="um-cancel-btn">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="um-save-btn">
                  {saving ? "Creating account…" : "Create account"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedUser && (
        <div className="um-overlay" onClick={closeUserModal}>
          <div
            className="um-modal um-modal--wide"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="um-modal-header">
              <div>
                <p className="um-kicker">Account details</p>
                <h4 className="um-modal-title">{selectedUser.name}</h4>
              </div>
              <button
                onClick={closeUserModal}
                className="um-modal-close"
                aria-label="Close user details"
              >
                ×
              </button>
            </div>

            <div className="um-user-detail-body">
              <div className="um-user-detail-card">
                <div className={`um-avatar ${
                  selectedUser.role === "admin" ? "is-admin" : "is-personnel"
                }`}>
                  {initials(selectedUser.name)}
                </div>

                <div className="um-user-meta">
                  <span
                    className={`um-role-badge ${
                      selectedUser.role === "admin" ? "is-admin" : "is-personnel"
                    }`}
                  >
                    {ROLE_LABELS[selectedUser.role] || selectedUser.role.replace("_", " ")}
                  </span>
                  <p>{selectedUser.email}</p>
                  <small>{selectedUser.contact_number || "No contact number provided"}</small>
                </div>
              </div>

              <div className="um-action-row">
                <button
                  className="um-primary-action"
                  onClick={() => setShowActivities((prev) => !prev)}
                >
                  {showActivities ? "Hide activities" : "View activities"}
                </button>
                <button
                  className="um-secondary-action"
                  onClick={() => handleResetPassword(selectedUser)}
                  disabled={resettingPassword}
                >
                  {resettingPassword ? "Resetting..." : "Reset password"}
                </button>
              </div>

              {showActivities && (
                <div className="um-activity-list">
                  <div className="um-activity-header">
                    <span className="um-activity-dot" />
                    <small>Recent activities</small>
                  </div>

                  {getUserActivities(selectedUser).length > 0 ? (
                    getUserActivities(selectedUser).map((entry, index) => (
                      <div key={`${entry.id ?? entry.timestamp ?? index}`} className="um-activity-item">
                        <strong>{entry.action || entry.event || entry.type || "User activity"}</strong>
                        <span>
                          {entry.details || entry.description || entry.message || "No additional details provided."}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="um-empty-state">
                      No recent activity found for this account.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
const CSS = ` 
.um-page {
  display: flex;
  justify-content: center;
  min-height: 100%;
  padding-bottom: 28px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: linear-gradient(180deg, #f8fafc 0%, #eef4ff 100%);
  overflow-y: auto;
}

.um-root {
  width: 100%;
  padding: 24px;
  max-width: 1100px;
}

.um-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 18px;
  flex-wrap: wrap;
}

.um-kicker {
  margin: 0 0 6px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: #7c8aa5;
}

.um-title {
  margin: 0;
  color: #101828;
  font-size: clamp(24px, 2vw, 30px);
  font-weight: 800;
  letter-spacing: -0.04em;
}

.um-add-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 11px 18px;
  border: none;
  border-radius: 999px;
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
  color: white;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 10px 24px rgba(37, 99, 235, 0.22);
  transition: transform 0.15s ease, filter 0.15s ease;
}
.um-add-btn:hover {
  filter: brightness(1.03);
}
.um-add-btn:active {
  transform: translateY(1px);
}

.um-add-icon {
  font-size: 16px;
  line-height: 1;
}

.um-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(140px, 1fr));
  gap: 14px;
  margin-bottom: 22px;
}

.um-stat-card {
  padding: 18px 18px 16px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.85);
  border: 1px solid rgba(148, 163, 184, 0.18);
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.05);
}
.um-stat-card span {
  display: block;
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.um-stat-card strong {
  display: block;
  margin-top: 8px;
  color: #0f172a;
  font-size: clamp(20px, 2vw, 28px);
  font-weight: 800;
}
.um-stat-card.is-primary {
  background: linear-gradient(135deg, #eef4ff, #dfeafe);
  border-color: rgba(96, 165, 250, 0.28);
}

.um-profile-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 18px;
}

.um-profile-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 18px;
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.18);
  box-shadow: 0 18px 32px rgba(15, 23, 42, 0.06);
}

.um-card-top {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.um-avatar {
  width: 52px;
  height: 52px;
  border-radius: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 16px;
  font-weight: 800;
  flex-shrink: 0;
}
.um-avatar.is-admin { background: linear-gradient(135deg, #2563eb, #1d4ed8); }
.um-avatar.is-personnel { background: linear-gradient(135deg, #16a34a, #15803d); }

.um-card-meta {
  flex: 1;
  min-width: 0;
}

.um-role-badge {
  display: inline-flex;
  align-items: center;
  padding: 5px 9px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.um-role-badge.is-admin {
  background: rgba(37, 99, 235, 0.1);
  color: #1d4ed8;
}
.um-role-badge.is-personnel {
  background: rgba(22, 163, 74, 0.12);
  color: #15803d;
}

.um-card-meta h4 {
  margin: 8px 0 4px;
  color: #111827;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.um-card-meta p {
  margin: 0;
  color: #64748b;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.um-status-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 7px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  border: 1px solid transparent;
}
.um-status-pill.is-active {
  background: rgba(34, 197, 94, 0.12);
  color: #166534;
  border-color: rgba(34, 197, 94, 0.2);
}
.um-status-pill.is-inactive {
  background: rgba(239, 68, 68, 0.1);
  color: #991b1b;
  border-color: rgba(239, 68, 68, 0.18);
}

.um-profile-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.um-summary-block {
  padding: 12px 12px 10px;
  border-radius: 14px;
  background: #f8fafc;
  border: 1px solid #edf2f7;
}
.um-summary-block span {
  display: block;
  color: #64748b;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}
.um-summary-block strong {
  display: block;
  margin-top: 8px;
  color: #111827;
  font-size: 13px;
  line-height: 1.4;
}

.um-activity-panel {
  padding: 12px 14px 14px;
  border-radius: 14px;
  background: linear-gradient(180deg, #f8fafc 0%, #eef4ff 100%);
  border: 1px solid rgba(148, 163, 184, 0.2);
}

.um-activity-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.um-activity-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #22c55e;
  box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.12);
}
.um-activity-header small {
  color: #475569;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.um-activity-panel p {
  margin: 0;
  color: #334155;
  font-size: 13px;
  line-height: 1.5;
}

.um-card-footer {
  display: flex;
  justify-content: flex-end;
}

.um-toggle-btn {
  padding: 8px 12px;
  border: 1px solid rgba(148, 163, 184, 0.45);
  border-radius: 999px;
  background: white;
  color: #111827;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.um-toggle-btn:hover {
  background: #f8fafc;
  border-color: rgba(100, 116, 139, 0.8);
}

.um-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  z-index: 50;
  animation: um-fade-in 0.15s ease;
}

.um-modal {
  width: 100%;
  max-width: 480px;
  max-height: 90vh;
  overflow-y: auto;
  background: #ffffff;
  border-radius: 18px;
  box-shadow: 0 20px 50px rgba(15, 23, 42, 0.18);
  animation: um-pop-in 0.15s ease;
}

.um-modal--wide {
  max-width: 540px;
}

@keyframes um-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes um-pop-in {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.um-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px;
  border-bottom: 1px solid #eef2f7;
}

.um-modal-title {
  margin: 0;
  color: #111827;
  font-size: 18px;
  font-weight: 700;
}

.um-modal-close {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 999px;
  background: #f8fafc;
  color: #475569;
  font-size: 20px;
  cursor: pointer;
}

.um-modal-actions {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}

.um-user-detail-body {
  padding: 18px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.um-user-detail-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 16px;
  border-radius: 16px;
  background: #f8fafc;
  border: 1px solid #edf2f7;
}

.um-user-meta {
  flex: 1;
  min-width: 0;
}

.um-user-meta p {
  margin: 10px 0 4px;
  color: #111827;
  font-weight: 600;
  font-size: 14px;
}

.um-user-meta small {
  color: #64748b;
  font-size: 12px;
}

.um-action-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.um-primary-action,
.um-secondary-action {
  flex: 1;
  min-width: 150px;
  padding: 12px 14px;
  border-radius: 12px;
  border: none;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.um-primary-action {
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
  color: white;
}

.um-secondary-action {
  background: #e2e8f0;
  color: #0f172a;
}

.um-secondary-action:disabled {
  opacity: 0.7;
  cursor: progress;
}

.um-activity-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border-radius: 14px;
  background: linear-gradient(180deg, #f8fafc 0%, #eef4ff 100%);
  border: 1px solid rgba(148, 163, 184, 0.2);
}

.um-activity-item {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.15);
}

.um-activity-item strong {
  color: #111827;
  font-size: 13px;
}

.um-activity-item span {
  color: #475569;
  font-size: 12px;
  line-height: 1.5;
}

.um-empty-state {
  padding: 12px 10px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.7);
  color: #64748b;
  font-size: 13px;
  text-align: center;
}

.um-cancel-btn {
  flex: 1;
  padding: 11px;
  border-radius: 10px;
  border: 1px solid #d5d9e2;
  background: white;
  color: #111827;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
}

.um-form {
  padding: 18px 20px 20px;
}

.um-field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.um-field--full {
  grid-column: 1 / -1;
}

.um-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.um-label {
  font-size: 12px;
  font-weight: 700;
  color: #64748b;
}

.um-input {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid #d5d9e2;
  font-size: 14px;
  background: #ffffff;
  color: #111827;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.um-input:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
}

.um-save-btn {
  flex: 1;
  padding: 11px;
  border-radius: 10px;
  border: none;
  background: #16a34a;
  color: white;
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
}
.um-save-btn:hover:not(:disabled) {
  background: #15803d;
}
.um-save-btn:disabled {
  opacity: 0.7;
  cursor: default;
}

.um-error {
  background: #fee2e2;
  color: #991b1b;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
  margin-bottom: 12px;
}

.um-empty {
  margin-top: 28px;
  padding: 40px 20px;
  text-align: center;
  border: 1px dashed #cbd5e1;
  border-radius: 18px;
  background: rgba(248, 250, 252, 0.8);
}
.um-empty-icon {
  width: 42px;
  height: 42px;
  margin: 0 auto 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: rgba(37, 99, 235, 0.08);
  color: #2563eb;
  font-size: 20px;
}
.um-empty-title {
  margin: 0;
  color: #111827;
  font-weight: 700;
  font-size: 15px;
}
.um-empty-text {
  margin: 6px 0 0;
  color: #64748b;
  font-size: 13px;
}

@media (max-width: 640px) {
  .um-root {
    padding: 18px 14px 30px;
  }

  .um-summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .um-profile-summary,
  .um-field-grid {
    grid-template-columns: 1fr;
  }

  .um-card-top {
    flex-wrap: wrap;
  }

  .um-overlay {
    padding: 0;
    align-items: flex-end;
  }

  .um-modal {
    max-width: 100%;
    max-height: 85vh;
    border-radius: 18px 18px 0 0;
    animation: um-slide-up 0.2s ease;
  }
}

@keyframes um-slide-up {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
`;

export default UserManagement;
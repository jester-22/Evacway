import { useState, useEffect } from "react";
import { api } from "../services/api";
import { useAuth } from "../context/AuthContext";
import "../components_css/UserManagement.css";

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
  const [editingUser, setEditingUser] = useState(null);
  const [editForm, setEditForm] = useState({ name: "", email: "", contact_number: "", role: "lgu_personnel" });
  const [editError, setEditError] = useState("");
  const [savingUser, setSavingUser] = useState(false);
  const [showActivities, setShowActivities] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    contact_number: "",
    role: "lgu_personnel",
  });
  const [error, setError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [emailAvailable, setEmailAvailable] = useState(null);
  const [emailChecking, setEmailChecking] = useState(false);
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

  async function checkEmailAvailability(value) {
    const email = value.trim().toLowerCase();
    if (!email) {
      setEmailError("");
      setEmailAvailable(null);
      return false;
    }

    setEmailChecking(true);
    try {
      const result = await api.checkUserEmailAvailability(email);
      const exists = Boolean(result.exists);
      setEmailAvailable(!exists);
      setEmailError(exists ? "This email is already registered." : "");
      return !exists;
    } catch (err) {
      setEmailAvailable(null);
      setEmailError(err.message || "Could not verify this email address.");
      return false;
    } finally {
      setEmailChecking(false);
    }
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
      const result = await api.resetUserPassword(user.id);
      alert(result.message || `Password setup email sent to ${user.email}.`);
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
      const email = form.email.trim().toLowerCase();
      const isAvailable = await checkEmailAvailability(email);
      if (!isAvailable) {
        setError("Use an email address that is not already registered.");
        return;
      }

      const result = await api.createUser({
        ...form,
        name: form.name.trim(),
        email,
      });
      setForm({
        name: "",
        email: "",
        contact_number: "",
        role: "lgu_personnel",
      });
      setShowForm(false);
      load();
      alert(result.message || `Account setup email sent to ${email}.`);
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

  function startEditingUser(user) {
    setEditForm({
      name: user.name || "",
      email: user.email || "",
      contact_number: user.contact_number || "",
      role: user.role || "lgu_personnel",
    });
    setEditError("");
    setEditingUser(user);
  }

  async function handleUpdateUser(event) {
    event.preventDefault();
    if (!editingUser) return;
    setSavingUser(true);
    setEditError("");
    try {
      const updated = await api.updateUser(editingUser.id, {
        ...editForm,
        name: editForm.name.trim(),
        email: editForm.email.trim().toLowerCase(),
        contact_number: editForm.contact_number.trim(),
      });
      setSelectedUser(updated);
      setEditingUser(null);
      load();
    } catch (requestError) {
      setEditError(requestError.message || "Account details could not be updated.");
    } finally {
      setSavingUser(false);
    }
  }

  function closeModal() {
    setShowForm(false);
    setError("");
    setEmailError("");
    setEmailAvailable(null);
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
                    onChange={(e) => {
                      setForm({ ...form, email: e.target.value });
                      setEmailError("");
                      setEmailAvailable(null);
                    }}
                    onBlur={(e) => checkEmailAvailability(e.target.value)}
                    className="um-input"
                    required
                  />
                  <small
                    className={`um-email-hint ${
                      emailError ? "is-error" : emailAvailable ? "is-available" : ""
                    }`}
                  >
                    {emailChecking
                      ? "Checking email availability..."
                      : emailError || (emailAvailable
                        ? "Email is available. A secure setup link will be sent."
                        : "We will email a secure password setup link.")}
                  </small>
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

              </div>

              <div className="um-modal-actions">
                <button type="button" onClick={closeModal} className="um-cancel-btn">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="um-save-btn">
                  {saving ? "Creating account…" : "Create & email setup link"}
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
                  className="um-secondary-action"
                  onClick={() => startEditingUser(selectedUser)}
                >
                  Edit details
                </button>
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
                  {resettingPassword ? "Sending email..." : "Email password reset"}
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

      {editingUser && (
        <div className="um-overlay um-edit-overlay" onClick={() => setEditingUser(null)}>
          <div className="um-modal um-modal--edit" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="um-edit-title">
            <div className="um-modal-header">
              <h4 className="um-modal-title" id="um-edit-title">Edit account details</h4>
              <button type="button" onClick={() => setEditingUser(null)} className="um-modal-close" aria-label="Close edit account">×</button>
            </div>
            <form className="um-form" onSubmit={handleUpdateUser}>
              {editError && <div className="um-error" role="alert">{editError}</div>}
              <div className="um-edit-fields">
                <label className="um-field">
                  <span className="um-label">Full name</span>
                  <input className="um-input" value={editForm.name} required maxLength={100} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} />
                </label>
                <label className="um-field">
                  <span className="um-label">Email</span>
                  <input className="um-input" type="email" value={editForm.email} required onChange={(event) => setEditForm({ ...editForm, email: event.target.value })} />
                </label>
                <label className="um-field">
                  <span className="um-label">Contact number</span>
                  <input className="um-input" value={editForm.contact_number} maxLength={20} onChange={(event) => setEditForm({ ...editForm, contact_number: event.target.value })} />
                </label>
                <label className="um-field">
                  <span className="um-label">Role</span>
                  <select className="um-input" value={editForm.role} onChange={(event) => setEditForm({ ...editForm, role: event.target.value })}>
                    <option value="lgu_personnel">LGU Personnel</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
              </div>
              <div className="um-modal-actions">
                <button type="button" onClick={() => setEditingUser(null)} className="um-cancel-btn">Cancel</button>
                <button type="submit" className="um-save-btn" disabled={savingUser}>{savingUser ? "Saving…" : "Save details"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}


export default UserManagement;
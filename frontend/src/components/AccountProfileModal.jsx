import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLock, faTriangleExclamation, faUser } from "@fortawesome/free-solid-svg-icons";
import { api } from "../services/api";
import "../components_css/AccountProfileModal.css";

const EMPTY_PASSWORD = { current: "", next: "", confirm: "" };

export default function AccountProfileModal({ user, onClose, onUpdated }) {
  const [view, setView] = useState("profile");
  const [profile, setProfile] = useState({
    name: user?.name || "",
    email: user?.email || "",
    contact_number: user?.contact_number || "",
  });
  const [password, setPassword] = useState(EMPTY_PASSWORD);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function saveProfile(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const updated = await api.updateMyProfile(profile);
      onUpdated(updated);
      setMessage("Account details updated.");
    } catch (requestError) {
      setError(requestError.message || "Account details could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (password.next !== password.confirm) {
      setError("The new passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const result = await api.changeMyPassword(password.current, password.next);
      setPassword(EMPTY_PASSWORD);
      setMessage(result.message || "Password changed successfully.");
    } catch (requestError) {
      setError(requestError.message || "Password could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  async function requestResetEmail() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api.requestMyPasswordReset();
      setMessage(result.message || `A password reset link was sent to ${profile.email}.`);
    } catch (requestError) {
      setError(requestError.message || "Password reset email could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="account-profile-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <section className="account-profile-modal" role="dialog" aria-modal="true" aria-labelledby="account-profile-title">
        <header className="account-profile-header">
          <span className="account-profile-icon"><FontAwesomeIcon icon={faUser} /></span>
          <div>
            <p>{user?.role === "admin" ? "Administrator" : "LGU Personnel"}</p>
            <h2 id="account-profile-title">My account</h2>
          </div>
          <button type="button" className="account-profile-close" onClick={onClose} aria-label="Close account settings">×</button>
        </header>

        <div className="account-profile-tabs" role="tablist" aria-label="Account settings">
          <button type="button" role="tab" aria-selected={view === "profile"} className={view === "profile" ? "is-active" : ""} onClick={() => { setView("profile"); setError(""); setMessage(""); }}>Profile details</button>
          <button type="button" role="tab" aria-selected={view === "security"} className={view === "security" ? "is-active" : ""} onClick={() => { setView("security"); setError(""); setMessage(""); }}>Password &amp; security</button>
        </div>

        {error && <p className="account-profile-feedback is-error" role="alert"><FontAwesomeIcon icon={faTriangleExclamation} />{error}</p>}
        {message && <p className="account-profile-feedback is-success" role="status">{message}</p>}

        {view === "profile" ? (
          <form className="account-profile-form" onSubmit={saveProfile}>
            <label>
              <span>Full name</span>
              <input value={profile.name} maxLength={100} required onChange={(event) => setProfile({ ...profile, name: event.target.value })} />
            </label>
            <label>
              <span>Email</span>
              <input type="email" autoComplete="email" value={profile.email} required onChange={(event) => setProfile({ ...profile, email: event.target.value })} />
            </label>
            <label>
              <span>Contact number</span>
              <input type="tel" autoComplete="tel" maxLength={20} value={profile.contact_number} onChange={(event) => setProfile({ ...profile, contact_number: event.target.value })} />
            </label>
            <button type="submit" className="account-profile-primary" disabled={busy}>Save details</button>
          </form>
        ) : (
          <form className="account-profile-form" onSubmit={changePassword}>
            <label>
              <span>Current password</span>
              <input type="password" autoComplete="current-password" required value={password.current} onChange={(event) => setPassword({ ...password, current: event.target.value })} />
            </label>
            <label>
              <span>New password</span>
              <input type="password" autoComplete="new-password" minLength={8} required value={password.next} onChange={(event) => setPassword({ ...password, next: event.target.value })} />
            </label>
            <label>
              <span>Confirm new password</span>
              <input type="password" autoComplete="new-password" minLength={8} required value={password.confirm} onChange={(event) => setPassword({ ...password, confirm: event.target.value })} />
            </label>
            <p className="account-password-hint">At least 8 characters, including uppercase, lowercase, number, and special character.</p>
            <button type="submit" className="account-profile-primary" disabled={busy}><FontAwesomeIcon icon={faLock} />Change password</button>
            <button type="button" className="account-profile-secondary" onClick={requestResetEmail} disabled={busy}>Email me a password reset link</button>
          </form>
        )}
      </section>
    </div>
  );
}
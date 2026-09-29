import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faShieldHalved,
  faCheck,
  faTriangleExclamation,
  faEye,
  faEyeSlash,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../../services/api";
import "./PasswordSetup.css";

function PasswordSetup() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    if (!token) {
      setError("This password link is missing its security token. Request a new email.");
      return;
    }
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
      setError("Use at least 8 characters, including an uppercase letter, a lowercase letter, and a number.");
      return;
    }
    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      await api.completePasswordSetup(token, password);
      setComplete(true);
      setPassword("");
      setConfirmation("");
    } catch (requestError) {
      setError(requestError.message || "This password link is invalid or expired.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="password-setup-page">
      <section className="password-setup-panel" aria-labelledby="password-setup-title">
        <div className="password-setup-brand">
          <span className="password-setup-brand-icon">
            <FontAwesomeIcon icon={faShieldHalved} />
          </span>
          <span>EvacWay</span>
        </div>

        {complete ? (
          <div className="password-setup-result is-complete" role="status">
            <span className="password-setup-result-icon">
              <FontAwesomeIcon icon={faCheck} />
            </span>
            <h1 id="password-setup-title">Password updated</h1>
            <p>Your account is ready. Sign in with your new password.</p>
            <Link className="password-setup-submit" to="/">Return to sign in</Link>
          </div>
        ) : (
          <>
            <div className="password-setup-heading">
              <p className="password-setup-eyebrow">Account security</p>
              <h1 id="password-setup-title">Set your password</h1>
              <p>Choose a strong password to access your EvacWay account.</p>
            </div>

            <form className="password-setup-form" onSubmit={handleSubmit}>
              {error && (
                <div className="password-setup-error" role="alert">
                  <FontAwesomeIcon icon={faTriangleExclamation} />
                  <span>{error}</span>
                </div>
              )}

              <div className="password-setup-password-field">
                <label htmlFor="new-password">New password</label>
                <div className="password-setup-input-wrap">
                <input
                  id="new-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={8}
                  required
                  autoFocus
                />
                  <button
                    className="password-setup-visibility"
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={showPassword ? "Hide passwords" : "Show passwords"}
                    aria-pressed={showPassword}
                  >
                    <FontAwesomeIcon icon={showPassword ? faEyeSlash : faEye} />
                  </button>
                </div>
              </div>

              <div className="password-setup-password-field">
                <label htmlFor="confirm-password">Confirm password</label>
                <div className="password-setup-input-wrap">
                <input
                  id="confirm-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  minLength={8}
                  required
                />
                </div>
              </div>

              <p className="password-setup-hint">
                At least 8 characters with uppercase, lowercase, and a number.
              </p>

              <button className="password-setup-submit" type="submit" disabled={submitting}>
                {submitting ? "Saving password..." : "Save password"}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}

export default PasswordSetup;

import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheck,
  faTriangleExclamation,
  faEye,
  faEyeSlash,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { PASSWORD_REQUIREMENTS_MESSAGE, validatePassword } from "../../utils/formValidation";
import "./PasswordSetup.css";

function PasswordSetup() {
  const { clearSession } = useAuth();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const [signInPath, setSignInPath] = useState("/login");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    if (!token) {
      setError("This password link is missing its security token. Request a new email.");
      return;
    }
    const pwdError = validatePassword(password);
    if (pwdError) {
      setError(PASSWORD_REQUIREMENTS_MESSAGE);
      return;
    }
    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.completePasswordSetup(token, password);
      // Clear any active session in this browser (e.g., an Admin who triggered the reset link)
      // so clicking "Return to sign in" never auto-redirects into the old logged-in account.
      clearSession();
      const isResident =
        res?.account_type === "resident_account" || res?.role === "resident";
      setSignInPath(isResident ? "/" : "/login");
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
      <section className="password-setup-panel ds-card" aria-labelledby="password-setup-title">
        <div className="password-setup-brand">
          <img src="/evacway-logo-text.png" alt="EvacWay" className="password-setup-logo" />
        </div>

        {complete ? (
          <div className="password-setup-result is-complete" role="status">
            <span className="password-setup-result-icon">
              <FontAwesomeIcon icon={faCheck} />
            </span>
            <h1 id="password-setup-title">Password updated</h1>
            <p>Your account is ready. Sign in with your new password.</p>
            <Link className="password-setup-submit ds-btn ds-btn--primary" to={signInPath}>Return to sign in</Link>
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
                <div className="password-setup-error ds-banner ds-banner--danger" role="alert">
                  <FontAwesomeIcon icon={faTriangleExclamation} className="password-setup-error-icon" aria-hidden="true" />
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
                  className="ds-input"
                />
                  <button
                    className="password-setup-visibility ds-btn ds-btn--icon ds-btn--sm"
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
                  className="ds-input"
                />
                </div>
              </div>

              <p className="password-setup-hint">
                At least 8 characters, with one uppercase letter, one lowercase letter, one number, and one special character.
              </p>

              <button className="password-setup-submit ds-btn ds-btn--primary" type="submit" disabled={submitting}>
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

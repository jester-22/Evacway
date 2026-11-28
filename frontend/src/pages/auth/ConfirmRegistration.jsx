import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheck,
  faRotateRight,
  faSpinner,
  faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import "./PasswordSetup.css";

// Deduplicate single-use confirmation requests per token (safe under React StrictMode)
const inFlightConfirmByToken = new Map();

function confirmTokenOnce(token) {
  if (!inFlightConfirmByToken.has(token)) {
    const promise = api.confirmResidentRegistration(token).catch((err) => {
      // Never permanently cache transient network or 5xx errors so the user can retry
      if (!err?.status || err.status >= 500) {
        inFlightConfirmByToken.delete(token);
      }
      throw err;
    });
    inFlightConfirmByToken.set(token, promise);
  }
  return inFlightConfirmByToken.get(token);
}

function ConfirmRegistration() {
  const { clearSession } = useAuth();
  const [searchParams] = useSearchParams();
  const token = (searchParams.get("token") || "").trim();
  const [attempt, setAttempt] = useState(0);

  const [state, setState] = useState(() =>
    token
      ? { status: "loading", email: "", message: "", code: "", canRetry: false }
      : {
          status: "error",
          email: "",
          message: "This confirmation link is missing its security token.",
          code: "missing_token",
          canRetry: false,
        }
  );

  useEffect(() => {
    if (!token) return undefined;
    let active = true;

    confirmTokenOnce(token)
      .then((res) => {
        if (!active) return;
        clearSession();
        setState({
          status: "success",
          email: res?.email || "",
          message:
            res?.message ||
            "Your email has been confirmed and your EvacWay resident account is now active.",
          code: "",
          canRetry: false,
        });
      })
      .catch((err) => {
        if (!active) return;
        const isTransient = !err?.status || err.status >= 500;
        setState({
          status: "error",
          email: "",
          message:
            err?.message ||
            "This confirmation link is invalid, expired, or has already been used.",
          code: err?.data?.code || "",
          canRetry: isTransient,
        });
      });

    return () => {
      active = false;
    };
  }, [token, attempt, clearSession]);

  const handleRetry = useCallback(() => {
    if (!token) return;
    inFlightConfirmByToken.delete(token);
    setState({ status: "loading", email: "", message: "", code: "", canRetry: false });
    setAttempt((n) => n + 1);
  }, [token]);

  return (
    <main className="password-setup-page">
      <section className="password-setup-panel ds-card" aria-labelledby="confirm-registration-title">
        <div className="password-setup-brand">
          <img src="/evacway-logo-text.png" alt="EvacWay" className="password-setup-logo" />
        </div>

        {state.status === "loading" && (
          <div className="password-setup-result" role="status" aria-live="polite">
            <span className="password-setup-result-icon" style={{ background: "#eff6ff", color: "#2563eb" }}>
              <FontAwesomeIcon icon={faSpinner} spin />
            </span>
            <h1 id="confirm-registration-title">Confirming your email</h1>
            <p>Please wait while we verify your link and activate your EvacWay resident account.</p>
          </div>
        )}

        {state.status === "success" && (
          <div className="password-setup-result is-complete" role="status">
            <span className="password-setup-result-icon">
              <FontAwesomeIcon icon={faCheck} />
            </span>
            <h1 id="confirm-registration-title">Account activated</h1>
            <p>
              {state.email ? (
                <>
                  Your email <strong>{state.email}</strong> has been confirmed and your EvacWay resident
                  account is now active. Sign in using your email and the password you chose during registration.
                </>
              ) : (
                state.message
              )}
            </p>
            <Link className="password-setup-submit ds-btn ds-btn--primary" to="/map?login=1&confirmed=1">
              Open EvacWay &amp; Sign In
            </Link>
          </div>
        )}

        {state.status === "error" && (
          <div className="password-setup-result" role="alert">
            <span className="password-setup-result-icon" style={{ background: "#fef2f2", color: "#dc2626" }}>
              <FontAwesomeIcon icon={faTriangleExclamation} />
            </span>
            <h1 id="confirm-registration-title">
              {state.code === "expired_token"
                ? "Confirmation link expired"
                : state.canRetry
                  ? "Temporary connection issue"
                  : "Could not confirm email"}
            </h1>
            <p>{state.message}</p>
            <p className="password-setup-hint" style={{ marginTop: 4 }}>
              {state.canRetry
                ? "Your confirmation link has not been used yet. Please try again in a moment."
                : state.code === "invalid_token"
                  ? "If you already confirmed your email earlier, your account is already active — you can go straight to EvacWay and sign in. Otherwise, ask LGU staff to resend your confirmation email."
                  : "If you still need to activate your account, please contact LGU staff to resend your confirmation email."}
            </p>
            {state.canRetry ? (
              <button
                type="button"
                className="password-setup-submit ds-btn ds-btn--primary"
                onClick={handleRetry}
              >
                <FontAwesomeIcon icon={faRotateRight} style={{ marginRight: 8 }} aria-hidden="true" />
                Try again
              </button>
            ) : (
              <Link className="password-setup-submit ds-btn ds-btn--primary" to="/map?login=1">
                Go to EvacWay &amp; Sign In
              </Link>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

export default ConfirmRegistration;

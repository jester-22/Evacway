import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faEnvelope,
  faLock,
  faCircleNotch,
  faTriangleExclamation,
  faArrowLeft,
  faPaperPlane,
  faCircleCheck,
} from "@fortawesome/free-solid-svg-icons";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../services/api";
import "./Login.css";

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState("credentials");
  const [flowToken, setFlowToken] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [emailOtpAvailable, setEmailOtpAvailable] = useState(true);
  const [emailOtpToken, setEmailOtpToken] = useState("");
  const [emailOtpCode, setEmailOtpCode] = useState("");
  const [sendingEmailOtp, setSendingEmailOtp] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  const { user, loginStaff, completeStaffLogin } = useAuth();
  const navigate = useNavigate();

  // If already authenticated, redirect straight to the appropriate page
  useEffect(() => {
    if (user) {
      if (user.role === "admin" || user.role === "lgu_personnel") {
        navigate("/dashboard", { replace: true });
      } else {
        navigate("/map", { replace: true });
      }
    }
  }, [user, navigate]);

  useEffect(() => {
    if (resendCooldown <= 0) return undefined;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  function resetEmailOtpState() {
    setEmailOtpToken("");
    setEmailOtpCode("");
    setInfoMessage("");
    setResendCooldown(0);
  }

  async function handleSendEmailCode() {
    if (!flowToken || sendingEmailOtp || resendCooldown > 0) return;
    setError("");
    setInfoMessage("");
    setSendingEmailOtp(true);
    try {
      const res = await api.sendStaffEmailOtp(flowToken);
      setEmailOtpToken(res.email_otp_token || "");
      if (res.masked_email) setMaskedEmail(res.masked_email);
      setInfoMessage(res.message || "A 6-digit verification code was sent to your email.");
      setResendCooldown(Number(res.resend_cooldown_seconds) || 30);
    } catch (err) {
      setError(err.message || "Could not send verification email right now.");
    } finally {
      setSendingEmailOtp(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (phase === "credentials") {
        const result = await loginStaff(email, password);
        if (result.access_token) {
          navigate("/dashboard");
        } else if (result.totp_enrollment_required || result.totp_required) {
          setFlowToken(result.challenge_token || result.setup_token || "");
          setMaskedEmail(result.masked_email || "");
          setEmailOtpAvailable(result.email_otp_available !== false);
          resetEmailOtpState();
          setPhase("verify");
        }
      } else if (phase === "verify") {
        if (!emailOtpToken) {
          setError("Send a verification code to your email first.");
          return;
        }
        const result = await api.verifyStaffEmailOtp(emailOtpToken, emailOtpCode);
        completeStaffLogin(result);
        navigate("/dashboard");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const isMfaStep = phase === "verify";

  return (
    <div className="login-wrapper">
      <form onSubmit={handleSubmit} className="login-card ds-card">
        <div className="login-icon">
          <img src="/evacway-logo-text.png" alt="EvacWay" className="login-logo" />
        </div>
        <h2 className="login-title">
          {isMfaStep ? "Verify with email code" : "Staff sign in"}
        </h2>
        <p className="login-subtitle">
          {isMfaStep
            ? `We'll send a one-time 6-digit verification code to ${maskedEmail || "your registered email"}.`
            : "Sign in with your LGU Personnel or admin account."}
        </p>

        {error && (
          <div className="login-error ds-banner ds-banner--danger" role="alert">
            <FontAwesomeIcon icon={faTriangleExclamation} className="login-error-icon" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {infoMessage && isMfaStep && (
          <div className="login-mfa-info" role="status">
            <FontAwesomeIcon icon={faCircleCheck} aria-hidden="true" />
            <span>{infoMessage}</span>
          </div>
        )}

        {phase === "credentials" && (
          <>
            <label className="login-label" htmlFor="login-email">Email</label>
            <div className="login-input-wrap">
              <FontAwesomeIcon icon={faEnvelope} className="login-input-icon" aria-hidden="true" />
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="login-input ds-input"
                placeholder="you@example.com"
                required
              />
            </div>

            <label className="login-label" htmlFor="login-password">Password</label>
            <div className="login-input-wrap">
              <FontAwesomeIcon icon={faLock} className="login-input-icon" aria-hidden="true" />
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="login-input ds-input"
                placeholder="Enter password"
                required
              />
            </div>

            <Link to="/forgot-password" className="login-forgot-link">
              Forgot your password?
            </Link>
          </>
        )}

        {isMfaStep && (
          <div className="login-mfa-email-box">
            {!emailOtpAvailable ? (
              <div className="login-error ds-banner ds-banner--danger" role="alert">
                <FontAwesomeIcon icon={faTriangleExclamation} className="login-error-icon" aria-hidden="true" />
                <span>
                  This account uses a local placeholder email and has no recovery email set. Add a recovery email in Users to receive verification codes.
                </span>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleSendEmailCode}
                  disabled={sendingEmailOtp || resendCooldown > 0}
                  className="login-mfa-send-btn ds-btn ds-btn--secondary"
                >
                  <FontAwesomeIcon
                    icon={sendingEmailOtp ? faCircleNotch : faPaperPlane}
                    spin={sendingEmailOtp}
                    aria-hidden="true"
                  />
                  <span>
                    {sendingEmailOtp
                      ? "Sending code…"
                      : resendCooldown > 0
                        ? `Resend code in ${resendCooldown}s`
                        : emailOtpToken
                          ? "Resend 6-digit code"
                          : "Send 6-digit code to email"}
                  </span>
                </button>

                <div className="login-mfa-field">
                  <label className="login-label" htmlFor="email-otp-code">Email verification code</label>
                  <input
                    id="email-otp-code"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="Enter 6-digit code from email"
                    value={emailOtpCode}
                    onChange={(e) => setEmailOtpCode(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
                    className="login-input login-input--plain ds-input"
                    required
                  />
                </div>
              </>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || (isMfaStep && !emailOtpToken)}
          className="login-button ds-btn ds-btn--primary"
        >
          {loading ? (
            <>
              <FontAwesomeIcon icon={faCircleNotch} spin className="login-loading-icon" />
              {phase === "credentials" ? "Logging in…" : "Verifying…"}
            </>
          ) : phase === "credentials" ? (
            "Log In"
          ) : (
            "Verify email code"
          )}
        </button>

        <Link to="/" className="login-back-link ds-btn ds-btn--ghost">
          <FontAwesomeIcon icon={faArrowLeft} className="login-back-icon" aria-hidden="true" />
          Back to public map
        </Link>
      </form>
    </div>
  );
}

export default Login;

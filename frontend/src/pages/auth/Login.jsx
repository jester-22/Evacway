import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faEnvelope,
  faLock,
  faEye,
  faEyeSlash,
  faShieldHalved,
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
  const [showPassword, setShowPassword] = useState(false);
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
      <div className="login-shell">
        <form onSubmit={handleSubmit} className="login-card ds-card">
          <div className="login-header">
            <div className="login-icon">
              <img src="/evacway-logo-text.png" alt="EvacWay" className="login-logo" />
            </div>
            <span className="login-portal-badge">
              <FontAwesomeIcon icon={faShieldHalved} aria-hidden="true" />
              <span>{isMfaStep ? "Two-Factor Verification" : "Staff & Admin Portal"}</span>
            </span>
            <h1 className="login-title">
              {isMfaStep ? "Verify with email code" : "Staff sign in"}
            </h1>
            <p className="login-subtitle">
              {isMfaStep
                ? `We'll send a one-time 6-digit verification code to ${maskedEmail || "your registered email"}.`
                : "Sign in with your LGU Personnel or admin credentials."}
            </p>
          </div>

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
            <div className="login-fields">
              <div className="login-field-group">
                <label className="login-label" htmlFor="login-email">Email address</label>
                <div className="login-input-wrap">
                  <FontAwesomeIcon icon={faEnvelope} className="login-input-icon" aria-hidden="true" />
                  <input
                    id="login-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="login-input ds-input"
                    placeholder="you@example.com"
                    required
                  />
                </div>
              </div>

              <div className="login-field-group">
                <div className="login-label-row">
                  <label className="login-label" htmlFor="login-password">Password</label>
                  <Link to="/forgot-password" className="login-forgot-link">
                    Forgot password?
                  </Link>
                </div>
                <div className="login-input-wrap">
                  <FontAwesomeIcon icon={faLock} className="login-input-icon" aria-hidden="true" />
                  <input
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="login-input login-input--password ds-input"
                    placeholder="Enter your password"
                    required
                  />
                  <button
                    type="button"
                    className="login-password-toggle"
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                  >
                    <FontAwesomeIcon icon={showPassword ? faEyeSlash : faEye} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
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
                {phase === "credentials" ? "Signing in…" : "Verifying…"}
              </>
            ) : phase === "credentials" ? (
              "Sign In"
            ) : (
              "Verify email code"
            )}
          </button>

          <div className="login-footer-divider" aria-hidden="true" />

          <Link to="/" className="login-back-link ds-btn ds-btn--ghost">
            <FontAwesomeIcon icon={faArrowLeft} className="login-back-icon" aria-hidden="true" />
            <span>Back to public map</span>
          </Link>
        </form>

        <p className="login-security-caption">
          Authorized LGU &amp; EvacWay personnel only
        </p>
      </div>
    </div>
  );
}

export default Login;

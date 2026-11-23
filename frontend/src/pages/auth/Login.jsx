import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faEnvelope,
  faLock,
  faCircleNotch,
  faTriangleExclamation,
  faArrowLeft,
  faMobileScreenButton,
  faPaperPlane,
  faCircleCheck,
} from "@fortawesome/free-solid-svg-icons";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../services/api";
import { QRCodeSVG } from "qrcode.react";
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
  const [mfaMethod, setMfaMethod] = useState("totp"); // "totp" | "email"
  const [totpCode, setTotpCode] = useState("");
  const [emailOtpToken, setEmailOtpToken] = useState("");
  const [emailOtpCode, setEmailOtpCode] = useState("");
  const [sendingEmailOtp, setSendingEmailOtp] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [enrollment, setEnrollment] = useState(null);
  const [backupCodes, setBackupCodes] = useState([]);
  const [pendingSession, setPendingSession] = useState(null);
  const [recoveryRequested, setRecoveryRequested] = useState(false);

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

  function handleSwitchMethod(nextMethod) {
    if (nextMethod === mfaMethod) return;
    setError("");
    setMfaMethod(nextMethod);
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
        } else if (result.totp_enrollment_required) {
          setEnrollment(result);
          setFlowToken(result.setup_token);
          setMaskedEmail(result.masked_email || "");
          setEmailOtpAvailable(result.email_otp_available !== false);
          setMfaMethod("totp");
          resetEmailOtpState();
          setPhase("enroll");
        } else if (result.totp_required) {
          setFlowToken(result.challenge_token);
          setMaskedEmail(result.masked_email || "");
          setEmailOtpAvailable(result.email_otp_available !== false);
          setMfaMethod("totp");
          resetEmailOtpState();
          setPhase("verify");
        }
      } else if ((phase === "verify" || phase === "enroll") && mfaMethod === "email") {
        if (!emailOtpToken) {
          setError("Send a verification code to your email first.");
          return;
        }
        const result = await api.verifyStaffEmailOtp(emailOtpToken, emailOtpCode);
        completeStaffLogin(result);
        navigate("/dashboard");
      } else if (phase === "enroll") {
        const result = await api.confirmStaffTotpEnrollment(flowToken, totpCode);
        setPendingSession(result);
        setBackupCodes(result.backup_codes || []);
        setPhase("backup");
        setTotpCode("");
      } else if (phase === "verify") {
        const result = await api.verifyStaffTotp(flowToken, totpCode);
        completeStaffLogin(result);
        navigate("/dashboard");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRecovery() {
    setError("");
    setLoading(true);
    try {
      await api.requestStaffTotpRecovery(flowToken);
      setRecoveryRequested(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function finishEnrollment() {
    if (!pendingSession) return;
    completeStaffLogin(pendingSession);
    navigate("/dashboard");
  }

  const isMfaStep = phase === "verify" || phase === "enroll";

  return (
    <div className="login-wrapper">
      <form onSubmit={handleSubmit} className="login-card ds-card">
        <div className="login-icon">
          <img src="/evacway-logo-text.png" alt="EvacWay" className="login-logo" />
        </div>
        <h2 className="login-title">
          {phase === "enroll"
            ? mfaMethod === "email"
              ? "Verify with email code"
              : "Set up two-factor sign in"
            : phase === "verify"
              ? "Verify your sign in"
              : phase === "backup"
                ? "Save your backup codes"
                : "Staff sign in"}
        </h2>
        <p className="login-subtitle">
          {isMfaStep && mfaMethod === "email"
            ? `We'll send a one-time 6-digit verification code to ${maskedEmail || "your registered email"}.`
            : phase === "enroll"
              ? "Scan the QR code with an authenticator app, enter the key manually, or switch to an email code."
              : phase === "verify"
                ? "Choose your verification method: authenticator app, backup code, or email code."
                : phase === "backup"
                  ? "These codes are shown once. Store them somewhere safe."
                  : "Sign in with your LGU Personnel or admin account."}
        </p>

        {isMfaStep && (
          <div className="login-mfa-methods" role="tablist" aria-label="Two-factor verification method">
            <button
              type="button"
              role="tab"
              aria-selected={mfaMethod === "totp"}
              className={`login-mfa-method-btn ${mfaMethod === "totp" ? "is-active" : ""}`}
              onClick={() => handleSwitchMethod("totp")}
              disabled={loading}
            >
              <FontAwesomeIcon icon={faMobileScreenButton} aria-hidden="true" />
              <span>Authenticator app</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mfaMethod === "email"}
              className={`login-mfa-method-btn ${mfaMethod === "email" ? "is-active" : ""}`}
              onClick={() => handleSwitchMethod("email")}
              disabled={loading}
            >
              <FontAwesomeIcon icon={faEnvelope} aria-hidden="true" />
              <span>Email code</span>
            </button>
          </div>
        )}

        {error && (
          <div className="login-error ds-banner ds-banner--danger" role="alert">
            <FontAwesomeIcon icon={faTriangleExclamation} className="login-error-icon" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {infoMessage && isMfaStep && mfaMethod === "email" && (
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

        {phase === "enroll" && mfaMethod === "totp" && enrollment && (
          <div className="login-mfa-enrollment">
            <div className="login-mfa-qr"><QRCodeSVG value={enrollment.otpauth_uri} size={196} includeMargin /></div>
            <label className="login-label" htmlFor="totp-manual-key">Manual key</label>
            <code id="totp-manual-key" className="login-mfa-key">{enrollment.totp_secret}</code>
          </div>
        )}

        {isMfaStep && mfaMethod === "totp" && (
          <div className="login-mfa-field">
            <label className="login-label" htmlFor="totp-code">
              {phase === "enroll" ? "Authenticator code" : "Authenticator or backup code"}
            </label>
            <input
              id="totp-code"
              autoComplete="one-time-code"
              inputMode="text"
              placeholder={phase === "enroll" ? "Enter 6-digit code" : "6-digit code or backup code"}
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              className="login-input login-input--plain ds-input"
              required
            />
          </div>
        )}

        {isMfaStep && mfaMethod === "email" && (
          <div className="login-mfa-email-box">
            {!emailOtpAvailable ? (
              <div className="login-error ds-banner ds-banner--danger" role="alert">
                <FontAwesomeIcon icon={faTriangleExclamation} className="login-error-icon" aria-hidden="true" />
                <span>
                  This account uses a local placeholder email and has no recovery email set. Add a recovery email in Users, or verify using your Authenticator app.
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

        {phase === "backup" && (
          <>
            <ul className="login-mfa-backup-codes">
              {backupCodes.map((code) => <li key={code}><code>{code}</code></li>)}
            </ul>
            <button type="button" onClick={finishEnrollment} className="login-button ds-btn ds-btn--primary">
              I saved these codes
            </button>
          </>
        )}

        {phase === "verify" && mfaMethod === "totp" && (
          <button
            type="button"
            onClick={handleRecovery}
            disabled={loading || recoveryRequested}
            className="login-forgot-link login-mfa-recovery"
          >
            {recoveryRequested ? "Recovery request sent for admin approval." : "Request account recovery"}
          </button>
        )}

        {phase !== "backup" && (
          <button
            type="submit"
            disabled={loading || (isMfaStep && mfaMethod === "email" && !emailOtpToken)}
            className="login-button ds-btn ds-btn--primary"
          >
            {loading ? (
              <>
                <FontAwesomeIcon icon={faCircleNotch} spin className="login-loading-icon" />
                {phase === "credentials" ? "Logging in…" : "Verifying…"}
              </>
            ) : phase === "credentials" ? (
              "Log In"
            ) : isMfaStep && mfaMethod === "email" ? (
              "Verify email code"
            ) : phase === "enroll" ? (
              "Verify and finish setup"
            ) : (
              "Verify code"
            )}
          </button>
        )}

        <Link to="/" className="login-back-link ds-btn ds-btn--ghost">
          <FontAwesomeIcon icon={faArrowLeft} className="login-back-icon" aria-hidden="true" />
          Back to public map
        </Link>
      </form>
    </div>
  );
}

export default Login;

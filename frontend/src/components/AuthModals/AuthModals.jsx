import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faXmark,
  faCircleExclamation,
  faEnvelope,
  faLock,
  faEye,
  faEyeSlash,
  faCircleNotch,
  faShieldHalved,
  faHouseUser,
  faUserShield,
  faArrowRight,
  faArrowLeft,
  faTriangleExclamation,
  faCircleCheck,
} from "@fortawesome/free-solid-svg-icons";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../services/api";
import "./AuthModals.css";

export function ResidentSignUpDialog({ dialogRef, isOpen, onClose, onOpenLogin }) {
  const [values, setValues] = useState({
    first_name: "",
    middle_name: "",
    last_name: "",
    birthdate: "",
    barangay: "",
    address: "",
    contact_number: "",
    email: "",
    password: "",
    confirm_password: "",
  });
  const [barangays, setBarangays] = useState([]);
  const [barangaysLoading, setBarangaysLoading] = useState(false);
  const [barangaysError, setBarangaysError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!isOpen) return undefined;
    let active = true;
    Promise.resolve()
      .then(() => {
        if (active) setBarangaysLoading(true);
        return api.getPublicBarangays();
      })
      .then((result) => {
        if (active) setBarangays(Array.isArray(result) ? result : []);
      })
      .catch(() => {
        if (active) {
          setBarangays([]);
          setBarangaysError("Registered barangays could not be loaded. Enter the barangay name as it appears in the roster.");
        }
      })
      .finally(() => {
        if (active) setBarangaysLoading(false);
      });
    return () => { active = false; };
  }, [isOpen]);

  function close() {
    dialogRef.current?.close();
  }

  function handleClose() {
    setValues({
      first_name: "",
      middle_name: "",
      last_name: "",
      birthdate: "",
      barangay: "",
      address: "",
      contact_number: "",
      email: "",
      password: "",
      confirm_password: "",
    });
    setFieldErrors({});
    setFormError("");
    setSubmitted(false);
    onClose?.();
  }

  function updateField(event) {
    const { name, value } = event.target;
    setValues((current) => ({ ...current, [name]: value }));
    setFieldErrors((current) => ({ ...current, [name]: "" }));
    setFormError("");
  }

  function validate() {
    const errors = {};
    if (!values.first_name.trim()) errors.first_name = "Enter your first name.";
    if (!values.last_name.trim()) errors.last_name = "Enter your last name.";
    if (!values.birthdate) errors.birthdate = "Enter your birthdate.";
    else if (values.birthdate > new Date().toISOString().slice(0, 10)) errors.birthdate = "Birthdate cannot be in the future.";
    if (!values.barangay.trim()) errors.barangay = "Enter your barangay.";
    if (!values.address.trim()) errors.address = "Enter your address or purok.";
    if (!/^[+\d][\d\s()-]{6,19}$/.test(values.contact_number.trim())) errors.contact_number = "Enter a valid contact number.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) errors.email = "Enter a valid email address.";
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).{8,}$/.test(values.password)) {
      errors.password = "Use at least 8 characters with uppercase, lowercase, a number, and a special character.";
    }
    if (values.confirm_password !== values.password) errors.confirm_password = "Passwords do not match.";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError("");
    if (!validate()) return;
    setSubmitting(true);
    try {
      await api.submitResidentRegistration({
        first_name: values.first_name.trim(),
        middle_name: values.middle_name.trim(),
        last_name: values.last_name.trim(),
        birthdate: values.birthdate,
        barangay: values.barangay.trim(),
        address: values.address.trim(),
        contact_number: values.contact_number.trim(),
        email: values.email.trim(),
        password: values.password,
      });
      setSubmitted(true);
    } catch (error) {
      const message = error.message || "Registration could not be submitted. Please try again.";
      const normalizedMessage = message.toLowerCase();
      if (normalizedMessage.includes("email")) {
        setFieldErrors((current) => ({ ...current, email: message }));
      } else if (normalizedMessage.includes("contact number")) {
        setFieldErrors((current) => ({ ...current, contact_number: message }));
      } else {
        setFormError(message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function field(name, label, type = "text", options = {}) {
    return (
      <label className="ew-field" htmlFor={`signup-${name}`} key={name}>
        <span>{label}{options.required ? " *" : ""}</span>
        <input
          id={`signup-${name}`}
          name={name}
          type={type}
          value={values[name]}
          onChange={updateField}
          autoComplete={options.autoComplete}
          max={type === "date" ? new Date().toISOString().slice(0, 10) : undefined}
          aria-invalid={Boolean(fieldErrors[name])}
          aria-describedby={fieldErrors[name] ? `signup-${name}-error` : undefined}
          required={options.required}
        />
        {fieldErrors[name] && <span className="ew-field-error" id={`signup-${name}-error`}>{fieldErrors[name]}</span>}
      </label>
    );
  }

  return (
    <dialog
      ref={dialogRef}
      className="ew-dialog ew-signup-dialog"
      aria-labelledby="ew-signup-title"
      onClose={handleClose}
      onClick={(event) => event.target === dialogRef.current && close()}
    >
      {submitted ? (
        <div className="ew-login ew-signup-success">
          <div className="ew-login-head">
            <h2 id="ew-signup-title">Request submitted</h2>
            <button type="button" className="ew-icon-btn" onClick={close} aria-label="Close sign-up">
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>
          <p role="status">Your request is pending staff validation. We will email you once it has been reviewed.</p>
          <button type="button" className="ew-btn ew-btn-primary ew-btn-block ds-btn ds-btn--primary" onClick={close}>Done</button>
        </div>
      ) : (
        <form className="ew-login ew-signup" onSubmit={handleSubmit} noValidate>
          <div className="ew-login-head">
            <h2 id="ew-signup-title">Create a resident account</h2>
            <button type="button" className="ew-icon-btn" onClick={close} aria-label="Close sign-up">
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>
          <p className="ew-login-sub">Your account unlocks live shelter & room assignments, personalized route alerts, and community hazard reporting.</p>

          {formError && <p className="ew-error" role="alert">{formError}</p>}

          <div className="ew-signup-grid">
            {field("first_name", "First name", "text", { required: true, autoComplete: "given-name" })}
            {field("middle_name", "Middle name (optional)", "text", { autoComplete: "additional-name" })}
            {field("last_name", "Last name", "text", { required: true, autoComplete: "family-name" })}
            {field("birthdate", "Birthdate", "date", { required: true })}
            <label className="ew-field ew-signup-wide" htmlFor="signup-barangay">
              <span>Barangay *</span>
              {barangays.length ? (
                <select
                  id="signup-barangay"
                  name="barangay"
                  value={values.barangay}
                  onChange={updateField}
                  aria-invalid={Boolean(fieldErrors.barangay)}
                  aria-describedby={fieldErrors.barangay ? "signup-barangay-error" : undefined}
                  required
                >
                  <option value="">{barangaysLoading ? "Loading barangays…" : "Select your barangay"}</option>
                  {barangays.map((barangay) => <option key={barangay.id} value={barangay.name}>{barangay.name}</option>)}
                </select>
              ) : (
                <input
                  id="signup-barangay"
                  name="barangay"
                  value={values.barangay}
                  onChange={updateField}
                  autoComplete="address-level3"
                  aria-invalid={Boolean(fieldErrors.barangay)}
                  aria-describedby={fieldErrors.barangay ? "signup-barangay-error" : undefined}
                  required
                />
              )}
              {barangaysError && <span className="ew-field-note">{barangaysError}</span>}
              {fieldErrors.barangay && <span className="ew-field-error" id="signup-barangay-error">{fieldErrors.barangay}</span>}
            </label>
            {field("address", "Address / purok", "text", { required: true, autoComplete: "street-address" })}
            {field("contact_number", "Contact number", "tel", { required: true, autoComplete: "tel" })}
            <div className="ew-signup-wide">
              {field("email", "Email", "email", { required: true, autoComplete: "email" })}
            </div>
            {field("password", "Password", "password", { required: true, autoComplete: "new-password" })}
            {field("confirm_password", "Confirm password", "password", { required: true, autoComplete: "new-password" })}
          </div>

          <button type="submit" className="ew-btn ew-btn-primary ew-btn-block ds-btn ds-btn--primary" disabled={submitting || barangaysLoading}>
            {submitting ? "Submitting request…" : "Submit for validation"}
          </button>
          <p className="ew-login-alt">Already have an account? <button type="button" className="ew-text-btn" onClick={onOpenLogin}>Log in</button></p>
        </form>
      )}
    </dialog>
  );
}

export function LoginDialog({ dialogRef, onOpenSignUp, onLoginSuccess, notice = "" }) {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("resident");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [recoveryLoading, setRecoveryLoading] = useState(false);

  function close() {
    dialogRef.current?.close();
  }

  function handleClose() {
    setPassword("");
    setShowPassword(false);
    setError("");
    setRecoveryMode(false);
    setRecoveryMessage("");
  }

  function openRecovery() {
    setError("");
    setRecoveryMessage("");
    setRecoveryMode(true);
  }

  async function handleRecoverySubmit(event) {
    event.preventDefault();
    setError("");
    setRecoveryMessage("");
    setRecoveryLoading(true);
    try {
      const result = await api.requestPasswordReset(email.trim());
      setRecoveryMessage(result.message || "If an account matches that email, a password reset link has been sent.");
    } catch (requestError) {
      setError(requestError.message || "Unable to request a password reset right now.");
    } finally {
      setRecoveryLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const user = await login(email, password);
      close();
      if (typeof onLoginSuccess === "function") {
        onLoginSuccess(user);
      } else {
        if (user?.role === "resident") {
          navigate("/map");
        } else if (user?.role === "admin" || user?.role === "lgu_personnel") {
          navigate("/dashboard");
        } else {
          navigate("/dashboard");
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="ew-dialog ew-login-modal"
      aria-labelledby="ew-login-title"
      onClose={handleClose}
      onClick={(e) => e.target === dialogRef.current && close()}
    >
      <form className="ew-login ew-modern-login" onSubmit={recoveryMode ? handleRecoverySubmit : handleSubmit}>
        {/* Header with Brand Badge and Close */}
        <div className="ew-login-head">
          <div className="ew-brand-pill">
            <span className="ew-brand-pill-icon">
              <FontAwesomeIcon icon={faShieldHalved} />
            </span>
            <span className="ew-brand-pill-text">EvacWay Portal</span>
          </div>
          <button type="button" className="ew-icon-btn" onClick={close} aria-label="Close dialog">
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        <div className="ew-login-intro">
          <h2 id="ew-login-title" className="ew-login-heading">
            {recoveryMode ? "Reset your password" : "Sign in to your account"}
          </h2>
          <p className="ew-login-sub">
            {recoveryMode
              ? "Enter your registered email to receive recovery instructions."
              : "Access real-time emergency routing, shelter updates, and disaster response tools."}
          </p>
        </div>

        {/* Role Selector Tabs (when not in recovery mode) */}
        {!recoveryMode && (
          <div className="ew-role-tabs" role="tablist" aria-label="Account category">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "resident"}
              className={`ew-role-tab ${activeTab === "resident" ? "active" : ""}`}
              onClick={() => setActiveTab("resident")}
            >
              <FontAwesomeIcon icon={faHouseUser} className="ew-tab-icon" />
              <span>Resident</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "staff"}
              className={`ew-role-tab ${activeTab === "staff" ? "active" : ""}`}
              onClick={() => setActiveTab("staff")}
            >
              <FontAwesomeIcon icon={faUserShield} className="ew-tab-icon" />
              <span>LGU & Admin</span>
            </button>
          </div>
        )}

        {/* Contextual Role Info Banner */}
        {!recoveryMode && (
          <div className="ew-role-banner" role="status">
            {activeTab === "resident" ? (
              <p>
                <strong>Resident Access:</strong> Check your designated evacuation shelter, building, and room assignment, and report community road hazards.
              </p>
            ) : (
              <p>
                <strong>Staff Access:</strong> Authorized dashboard for Sogod DRRM personnel, center supervisors, and administrative officers.
              </p>
            )}
          </div>
        )}

        {/* Priority notices (e.g., when prompted from hazard report) */}
        {notice && !recoveryMode && (
          <div className="ew-login-notice" role="status">
            <FontAwesomeIcon icon={faCircleExclamation} className="ew-notice-icon" />
            <span>{notice}</span>
          </div>
        )}

        {/* Error notification */}
        {error && (
          <div className="ew-error" role="alert">
            <FontAwesomeIcon icon={faTriangleExclamation} className="ew-error-icon" />
            <span>{error}</span>
          </div>
        )}

        {/* Success recovery notification */}
        {recoveryMessage && (
          <div className="ew-recovery-message" role="status">
            <FontAwesomeIcon icon={faCircleCheck} className="ew-success-icon" />
            <span>{recoveryMessage}</span>
          </div>
        )}

        {/* Email Field with leading icon */}
        <div className="ew-field">
          <label htmlFor="login-email" className="ew-field-label">
            Email Address
          </label>
          <div className="ew-input-wrap">
            <FontAwesomeIcon icon={faEnvelope} className="ew-input-icon" aria-hidden="true" />
            <input
              id="login-email"
              type="email"
              name="email"
              autoComplete="email"
              placeholder={activeTab === "resident" ? "resident@example.com" : "officer@sogod.gov.ph"}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
        </div>

        {/* Password Field with leading icon and eye toggle */}
        {!recoveryMode && (
          <div className="ew-field">
            <div className="ew-field-split-label">
              <label htmlFor="login-password" className="ew-field-label">
                Password
              </label>
              <button type="button" className="ew-forgot-link" onClick={openRecovery}>
                Forgot password?
              </button>
            </div>
            <div className="ew-input-wrap">
              <FontAwesomeIcon icon={faLock} className="ew-input-icon" aria-hidden="true" />
              <input
                id="login-password"
                type={showPassword ? "text" : "password"}
                name="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                className="ew-eye-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-pressed={showPassword}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                <FontAwesomeIcon icon={showPassword ? faEyeSlash : faEye} />
              </button>
            </div>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          className="ew-submit-btn"
          disabled={recoveryMode ? recoveryLoading : loading}
        >
          {recoveryMode ? (
            recoveryLoading ? (
              <>
                <FontAwesomeIcon icon={faCircleNotch} spin className="ew-spin-icon" />
                <span>Sending link…</span>
              </>
            ) : (
              "Send password reset link"
            )
          ) : loading ? (
            <>
              <FontAwesomeIcon icon={faCircleNotch} spin className="ew-spin-icon" />
              <span>Signing in…</span>
            </>
          ) : (
            `Sign In as ${activeTab === "resident" ? "Resident" : "LGU / Admin"}`
          )}
        </button>

        {/* Back to login from recovery */}
        {recoveryMode && (
          <button
            type="button"
            className="ew-text-back-btn"
            onClick={() => {
              setRecoveryMode(false);
              setRecoveryMessage("");
              setError("");
            }}
          >
            <FontAwesomeIcon icon={faArrowLeft} />
            <span>Back to sign in</span>
          </button>
        )}

        {/* Sign-up Callout Box for Residents */}
        {!recoveryMode && (
          <div className="ew-signup-callout">
            <div className="ew-signup-callout-text">
              <span className="ew-signup-callout-title">Need a resident account?</span>
              <span className="ew-signup-callout-desc">Register your household to see your room & shelter.</span>
            </div>
            <button
              type="button"
              className="ew-signup-callout-btn"
              onClick={onOpenSignUp}
            >
              Sign up
              <FontAwesomeIcon icon={faArrowRight} className="ew-callout-arrow" />
            </button>
          </div>
        )}

        {/* Public Map Direct Access */}
        {!recoveryMode && (
          <div className="ew-public-bypass">
            <Link to="/map" onClick={close} className="ew-public-link">
              Looking for open routes right now? <span>Open public map →</span>
            </Link>
          </div>
        )}
      </form>
    </dialog>
  );
}


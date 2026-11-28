import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faXmark,
  faCircleExclamation,
  faEnvelope,
  faLock,
  faEye,
  faEyeSlash,
  faCircleNotch,
  faArrowLeft,
  faTriangleExclamation,
  faCircleCheck,
  faCheck,
} from "@fortawesome/free-solid-svg-icons";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../services/api";
import {
  evaluatePasswordRules,
  getLocalMinDobIso,
  getLocalYesterdayIso,
  sanitizeNameInput,
  sanitizePhoneInput,
  validateContactNumber,
  validateEmail,
  validatePassword,
  validatePastBirthdate,
  validatePersonName,
} from "../../utils/formValidation";
import PublicMapDialogShell from "../PublicMapDialogShell/PublicMapDialogShell";
import "./AuthModals.css";

const FIELD_ORDER = [
  "first_name",
  "middle_name",
  "last_name",
  "birthdate",
  "barangay",
  "address",
  "contact_number",
  "email",
  "password",
  "confirm_password",
];

function validateField(name, currentValues) {
  const val = (currentValues[name] || "").trim();
  switch (name) {
    case "first_name":
      return validatePersonName(val, { label: "First name", required: true, min: 2, max: 50 });

    case "middle_name":
      return validatePersonName(val, { label: "Middle name", required: false, min: 2, max: 50 });

    case "last_name":
      return validatePersonName(val, { label: "Last name", required: true, min: 2, max: 50 });

    case "birthdate":
      return validatePastBirthdate(val, { label: "Birthdate", required: true });

    case "barangay":
      if (!val) return "Select your barangay.";
      return "";

    case "address":
      if (!val) return "Address or purok is required.";
      if (val.length < 3 || val.length > 100) return "Address must be between 3 and 100 characters.";
      return "";

    case "contact_number":
      return validateContactNumber(val, { required: true, label: "Contact number" });

    case "email":
      return validateEmail(val, { label: "Email", required: true });

    case "password":
      return validatePassword(currentValues.password || "");

    case "confirm_password": {
      const cpwd = currentValues.confirm_password || "";
      if (!cpwd) return "Please confirm your password.";
      if (cpwd !== (currentValues.password || "")) return "Passwords do not match.";
      return "";
    }

    default:
      return "";
  }
}

export function ResidentSignUpDialog({ dialogRef, isOpen, onClose, onOpenLogin, usePublicMapShell = false }) {
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
  const [touched, setTouched] = useState({});
  const [barangays, setBarangays] = useState([]);
  const [barangaysLoading, setBarangaysLoading] = useState(false);
  const [barangaysError, setBarangaysError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [hasTypedPassword, setHasTypedPassword] = useState(false);

  const fieldRefs = useRef({});

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [dialogRef, isOpen]);

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
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
    // Drive the controlled parent state directly instead of depending only on
    // the native dialog's asynchronous close event.
    handleClose();
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
    setTouched({});
    setFieldErrors({});
    setPrivacyConsent(false);
    setFormError("");
    setSubmitted(false);
    setShowPassword(false);
    setShowConfirmPassword(false);
    setPasswordFocused(false);
    setHasTypedPassword(false);
    onClose?.();
  }

  function handleBlur(name) {
    setTouched((prev) => ({ ...prev, [name]: true }));
    const error = validateField(name, values);
    setFieldErrors((prev) => ({ ...prev, [name]: error }));

    if (name === "password" && touched.confirm_password) {
      const confirmError = validateField("confirm_password", values);
      setFieldErrors((prev) => ({ ...prev, confirm_password: confirmError }));
    }
  }

  function updateField(event) {
    const { name, value: rawValue } = event.target;
    const value =
      name === "first_name" || name === "middle_name" || name === "last_name"
        ? sanitizeNameInput(rawValue)
        : name === "contact_number"
          ? sanitizePhoneInput(rawValue)
          : rawValue;
    const nextValues = { ...values, [name]: value };
    setValues(nextValues);
    setFormError("");

    if (name === "password") {
      setHasTypedPassword(true);
      if (touched.password) {
        const error = validateField("password", nextValues);
        setFieldErrors((prev) => ({ ...prev, password: error }));
      }
      // Re-check Confirm password when Password changes
      if (touched.confirm_password || values.confirm_password) {
        const confirmError = validateField("confirm_password", nextValues);
        setFieldErrors((prev) => ({
          ...prev,
          confirm_password: touched.confirm_password ? confirmError : "",
        }));
      }
    } else if (name === "confirm_password") {
      if (touched.confirm_password) {
        const error = validateField("confirm_password", nextValues);
        setFieldErrors((prev) => ({ ...prev, confirm_password: error }));
      }
    } else if (touched[name]) {
      const error = validateField(name, nextValues);
      setFieldErrors((prev) => ({ ...prev, [name]: error }));
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError("");

    // Mark all fields touched
    const allTouched = {};
    FIELD_ORDER.forEach((name) => {
      allTouched[name] = true;
    });
    setTouched(allTouched);

    // Validate all fields
    const errors = {};
    for (const name of FIELD_ORDER) {
      const error = validateField(name, values);
      if (error) {
        errors[name] = error;
      }
    }

    setFieldErrors(errors);

    if (Object.keys(errors).length > 0) {
      const firstInvalidField = FIELD_ORDER.find((name) => errors[name]);
      if (firstInvalidField && fieldRefs.current[firstInvalidField]) {
        fieldRefs.current[firstInvalidField].focus();
      }
      return;
    }

    setSubmitting(true);
    try {
      await api.submitResidentRegistration({
        first_name: values.first_name.trim(),
        middle_name: values.middle_name.trim(),
        last_name: values.last_name.trim(),
        birthdate: values.birthdate.trim(),
        barangay: values.barangay.trim(),
        address: values.address.trim(),
        contact_number: values.contact_number.trim(),
        email: values.email.trim().toLowerCase(),
        password: values.password,
        privacy_consent: privacyConsent,
      });
      setSubmitted(true);
    } catch (error) {
      const message = error.message || "Registration could not be submitted. Please try again.";
      const lower = message.toLowerCase();
      let matchedField = null;

      if (lower.includes("email")) {
        matchedField = "email";
      } else if (lower.includes("contact number") || lower.includes("contact")) {
        matchedField = "contact_number";
      } else if (lower.includes("password")) {
        matchedField = "password";
      } else if (lower.includes("barangay")) {
        matchedField = "barangay";
      } else if (lower.includes("birthdate") || lower.includes("date of birth")) {
        matchedField = "birthdate";
      } else if (lower.includes("address") || lower.includes("purok")) {
        matchedField = "address";
      } else if (lower.includes("name")) {
        matchedField = "last_name";
      }

      if (matchedField) {
        setFieldErrors((prev) => ({ ...prev, [matchedField]: message }));
        setTouched((prev) => ({ ...prev, [matchedField]: true }));
        fieldRefs.current[matchedField]?.focus();
      } else {
        setFormError(message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const pwdVal = values.password || "";
  const cpwdVal = values.confirm_password || "";

  const passwordRules = evaluatePasswordRules(pwdVal, cpwdVal);

  const showPasswordGuide =
    passwordFocused ||
    Boolean(fieldErrors.password) ||
    hasTypedPassword ||
    pwdVal.length > 0;

  function renderField(name, labelText, type = "text", options = {}) {
    const isRequired = options.required;
    const isInvalid = Boolean(touched[name] && fieldErrors[name]);
    const errorMsg = touched[name] ? fieldErrors[name] : "";
    const helperText = options.helperText;
    const isPassword = type === "password";
    const showText = isPassword && (name === "password" ? showPassword : showConfirmPassword);
    const inputType = isPassword ? (showText ? "text" : "password") : type;

    const describedBy = [
      helperText ? `signup-${name}-hint` : null,
      isInvalid ? `signup-${name}-error` : null,
      name === "password" && showPasswordGuide ? "signup-password-guide" : null,
    ].filter(Boolean).join(" ") || undefined;

    return (
      <div className={`ew-field ${options.wide ? "ew-signup-wide" : ""} ${options.className || ""}`} key={name}>
        <label className="ew-field-label" htmlFor={`signup-${name}`}>
          <span>{labelText}</span>
          {isRequired && <span className="ew-required-star" aria-hidden="true">*</span>}
        </label>

        {helperText && (
          <span className="ew-field-hint" id={`signup-${name}-hint`}>
            {helperText}
          </span>
        )}

        {isPassword ? (
          <div className="ew-input-wrap">
            <input
              id={`signup-${name}`}
              name={name}
              type={inputType}
              value={values[name]}
              onChange={updateField}
              onBlur={() => {
                if (name === "password") setPasswordFocused(false);
                handleBlur(name);
              }}
              onFocus={name === "password" ? () => setPasswordFocused(true) : undefined}
              ref={(el) => { fieldRefs.current[name] = el; }}
              autoComplete={options.autoComplete}
              aria-invalid={isInvalid ? "true" : "false"}
              aria-describedby={describedBy}
              required={isRequired}
              placeholder={options.placeholder}
            />
            <button
              type="button"
              className="ew-eye-toggle"
              onClick={() => {
                if (name === "password") {
                  setShowPassword((prev) => !prev);
                } else {
                  setShowConfirmPassword((prev) => !prev);
                }
              }}
              aria-label={showText ? `Hide ${labelText.toLowerCase()}` : `Show ${labelText.toLowerCase()}`}
            >
              <FontAwesomeIcon icon={showText ? faEyeSlash : faEye} />
            </button>
          </div>
        ) : (
          <input
            id={`signup-${name}`}
            name={name}
            type={inputType}
            value={values[name]}
            onChange={updateField}
            onBlur={() => handleBlur(name)}
            ref={(el) => { fieldRefs.current[name] = el; }}
            autoComplete={options.autoComplete}
            min={type === "date" ? getLocalMinDobIso() : undefined}
            max={type === "date" ? getLocalYesterdayIso() : undefined}
            aria-invalid={isInvalid ? "true" : "false"}
            aria-describedby={describedBy}
            required={isRequired}
            placeholder={options.placeholder}
          />
        )}

        {isInvalid && (
          <span className="ew-field-error" id={`signup-${name}-error`} role="alert">
            {errorMsg}
          </span>
        )}
      </div>
    );
  }

  const dialog = (
    <dialog
      ref={dialogRef}
      className="ew-dialog ew-signup-dialog"
      aria-labelledby="ew-signup-title"
      onClose={handleClose}
      onClick={(event) => event.target === dialogRef.current && close()}
    >
      {submitted ? (
        <div className="ew-login ew-signup ew-signup-success">
          <div className="ew-signup-header">
            <div className="ew-login-head">
              <h2 id="ew-signup-title">Request submitted</h2>
              <button type="button" className="ew-icon-btn" onClick={close} aria-label="Close sign-up">
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
          </div>
          <div className="ew-signup-confirmation" role="status">
            <p>Your request is awaiting staff review. Staff will review your details and match them with the resident roster.</p>
            <p><strong>Expected wait:</strong> Review times vary with staff workload; there is no fixed estimate.</p>
            <p>
              We’ll email the decision to <strong>{values.email}</strong>. Once approved, click the confirmation link in that email to activate your account.
            </p>
          </div>
          <button type="button" className="ew-btn ew-btn-primary ew-btn-block" onClick={close}>Done</button>
        </div>
      ) : (
        <form className="ew-login ew-signup" onSubmit={handleSubmit} noValidate>
          <div className="ew-signup-header">
            <div className="ew-login-head">
              <h2 id="ew-signup-title">Create a resident account</h2>
              <button type="button" className="ew-icon-btn" onClick={close} aria-label="Close sign-up">
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
            <p className="ew-login-sub">Your account unlocks live shelter &amp; room assignments, personalized route alerts, and community hazard reporting.</p>

            {formError && (
              <p className="ew-error" role="alert">
                <FontAwesomeIcon icon={faCircleExclamation} className="ew-error-icon" />
                <span>{formError}</span>
              </p>
            )}
          </div>

          <div className="ew-signup-grid">
            {renderField("first_name", "First name", "text", { required: true, autoComplete: "given-name", placeholder: "e.g. Maria" })}
            {renderField("middle_name", "Middle name", "text", { helperText: "Optional (2–50 characters)", autoComplete: "additional-name", placeholder: "e.g. Santos" })}
            {renderField("last_name", "Last name", "text", { required: true, autoComplete: "family-name", placeholder: "e.g. Dela Cruz" })}
            {renderField("birthdate", "Birthdate", "date", { required: true })}

            <div className="ew-field ew-signup-wide">
              <label className="ew-field-label" htmlFor="signup-barangay">
                <span>Barangay</span>
                <span className="ew-required-star" aria-hidden="true">*</span>
              </label>
              {barangays.length > 0 ? (
                <select
                  id="signup-barangay"
                  name="barangay"
                  value={values.barangay}
                  onChange={updateField}
                  onBlur={() => handleBlur("barangay")}
                  ref={(el) => { fieldRefs.current.barangay = el; }}
                  aria-invalid={touched.barangay && Boolean(fieldErrors.barangay) ? "true" : "false"}
                  aria-describedby={touched.barangay && fieldErrors.barangay ? "signup-barangay-error" : undefined}
                  required
                >
                  <option value="">{barangaysLoading ? "Loading barangays…" : "Select your barangay"}</option>
                  {barangays.map((barangay) => (
                    <option key={barangay.id || barangay.name} value={barangay.name}>
                      {barangay.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="signup-barangay"
                  name="barangay"
                  value={values.barangay}
                  onChange={updateField}
                  onBlur={() => handleBlur("barangay")}
                  ref={(el) => { fieldRefs.current.barangay = el; }}
                  autoComplete="address-level3"
                  aria-invalid={touched.barangay && Boolean(fieldErrors.barangay) ? "true" : "false"}
                  aria-describedby={touched.barangay && fieldErrors.barangay ? "signup-barangay-error" : undefined}
                  placeholder="Enter your barangay"
                  required
                />
              )}
              {barangaysError && <span className="ew-field-hint">{barangaysError}</span>}
              {touched.barangay && fieldErrors.barangay && (
                <span className="ew-field-error" id="signup-barangay-error" role="alert">
                  {fieldErrors.barangay}
                </span>
              )}
            </div>

            {renderField("address", "Address / purok", "text", { required: true, helperText: "3 to 100 characters", autoComplete: "street-address", placeholder: "e.g. Purok 4, Riverside" })}
            {renderField("contact_number", "Contact number", "tel", { required: true, helperText: "Format: 09XX XXX XXXX or +639XX XXX XXXX", autoComplete: "tel", placeholder: "e.g. 0917 123 4567" })}
            {renderField("email", "Email", "email", { required: true, wide: true, autoComplete: "email", placeholder: "e.g. maria@example.com" })}
            {renderField("password", "Password", "password", { required: true, autoComplete: "new-password", placeholder: "Create a password", className: "ew-field-password" })}
            {renderField("confirm_password", "Confirm password", "password", { required: true, autoComplete: "new-password", placeholder: "Confirm your password", className: "ew-field-confirm-password" })}

            {showPasswordGuide && (
              <div
                className="ew-password-guide-row ew-signup-wide"
                id="signup-password-guide"
                aria-live="polite"
              >
                <div className="ew-password-guide">
                  <span className="ew-password-guide-title">Your password must have:</span>
                  <ul className="ew-password-guide-list">
                    <li className={`ew-guide-item ${passwordRules.minLen ? "is-met" : ""}`}>
                      <span className="ew-guide-bullet" aria-hidden="true">
                        {passwordRules.minLen ? (
                          <FontAwesomeIcon icon={faCheck} className="ew-guide-icon-check" />
                        ) : (
                          <span className="ew-guide-dot" />
                        )}
                      </span>
                      <span>
                        <span className="sr-only">{passwordRules.minLen ? "Rule met: " : "Requirement: "}</span>
                        At least 8 characters
                      </span>
                    </li>
                    <li className={`ew-guide-item ${passwordRules.upper ? "is-met" : ""}`}>
                      <span className="ew-guide-bullet" aria-hidden="true">
                        {passwordRules.upper ? (
                          <FontAwesomeIcon icon={faCheck} className="ew-guide-icon-check" />
                        ) : (
                          <span className="ew-guide-dot" />
                        )}
                      </span>
                      <span>
                        <span className="sr-only">{passwordRules.upper ? "Rule met: " : "Requirement: "}</span>
                        At least one uppercase letter (A to Z)
                      </span>
                    </li>
                    <li className={`ew-guide-item ${passwordRules.lower ? "is-met" : ""}`}>
                      <span className="ew-guide-bullet" aria-hidden="true">
                        {passwordRules.lower ? (
                          <FontAwesomeIcon icon={faCheck} className="ew-guide-icon-check" />
                        ) : (
                          <span className="ew-guide-dot" />
                        )}
                      </span>
                      <span>
                        <span className="sr-only">{passwordRules.lower ? "Rule met: " : "Requirement: "}</span>
                        At least one lowercase letter (a to z)
                      </span>
                    </li>
                    <li className={`ew-guide-item ${passwordRules.number ? "is-met" : ""}`}>
                      <span className="ew-guide-bullet" aria-hidden="true">
                        {passwordRules.number ? (
                          <FontAwesomeIcon icon={faCheck} className="ew-guide-icon-check" />
                        ) : (
                          <span className="ew-guide-dot" />
                        )}
                      </span>
                      <span>
                        <span className="sr-only">{passwordRules.number ? "Rule met: " : "Requirement: "}</span>
                        At least one number (0 to 9)
                      </span>
                    </li>
                    <li className={`ew-guide-item ${passwordRules.special ? "is-met" : ""}`}>
                      <span className="ew-guide-bullet" aria-hidden="true">
                        {passwordRules.special ? (
                          <FontAwesomeIcon icon={faCheck} className="ew-guide-icon-check" />
                        ) : (
                          <span className="ew-guide-dot" />
                        )}
                      </span>
                      <span>
                        <span className="sr-only">{passwordRules.special ? "Rule met: " : "Requirement: "}</span>
                        At least one special character (!@#$%...)
                      </span>
                    </li>
                    <li className={`ew-guide-item ${passwordRules.match ? "is-met" : ""}`}>
                      <span className="ew-guide-bullet" aria-hidden="true">
                        {passwordRules.match ? (
                          <FontAwesomeIcon icon={faCheck} className="ew-guide-icon-check" />
                        ) : (
                          <span className="ew-guide-dot" />
                        )}
                      </span>
                      <span>
                        <span className="sr-only">{passwordRules.match ? "Rule met: " : "Requirement: "}</span>
                        Matches the Confirm password field
                      </span>
                    </li>
                  </ul>
                </div>
              </div>
            )}

            <div className="ew-field ew-signup-wide ew-privacy-consent">
              <label className="ew-privacy-consent-label" htmlFor="signup-privacy-consent">
                <input
                  id="signup-privacy-consent"
                  type="checkbox"
                  checked={privacyConsent}
                  onChange={(event) => setPrivacyConsent(event.target.checked)}
                  aria-describedby="signup-privacy-consent-error"
                  aria-invalid={!privacyConsent ? "true" : "false"}
                  required
                />
                <span>
                  I have read and agree to the{" "}
                  <Link to="/data-privacy-notice" target="_blank" rel="noreferrer">
                    Data Privacy Notice
                  </Link>
                </span>
              </label>
              {!privacyConsent && (
                <span className="ew-field-error" id="signup-privacy-consent-error" role="alert">
                  Please agree to continue.
                </span>
              )}
            </div>
          </div>

          <div className="ew-signup-actions">
            <button
              type="submit"
              className="ew-btn ew-btn-primary ew-btn-block"
              disabled={submitting || barangaysLoading || !privacyConsent}
            >
              {submitting ? (
                <>
                  <FontAwesomeIcon icon={faCircleNotch} spin className="ew-spin-icon" />
                  <span>Submitting request…</span>
                </>
              ) : (
                "Submit for validation"
              )}
            </button>
            <p className="ew-login-alt">
              Already have an account?{" "}
              <button type="button" className="ew-text-btn" onClick={onOpenLogin}>
                Log in
              </button>
            </p>
          </div>
        </form>
      )}
    </dialog>
  );
  return usePublicMapShell
    ? <PublicMapDialogShell native labelledBy="ew-signup-title">{dialog}</PublicMapDialogShell>
    : dialog;
}

export function LoginDialog({ dialogRef, onOpenSignUp, onLoginSuccess, notice = "", usePublicMapShell = false }) {
  const { loginResident } = useAuth();
  const navigate = useNavigate();
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
      const user = await loginResident(email, password);
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

  const dialog = (
    <dialog
      ref={dialogRef}
      className="ew-dialog ew-login-modal"
      aria-labelledby="ew-login-title"
      onClose={handleClose}
      onClick={(e) => e.target === dialogRef.current && close()}
    >
      <form className="ew-login ew-modern-login" onSubmit={recoveryMode ? handleRecoverySubmit : handleSubmit}>
        {/* Header with Centered Title and Top-Right Close Button */}
        <div className="ew-login-head">
          <h2 id="ew-login-title" className="ew-login-heading">
            {recoveryMode ? "Reset your password" : "Sign in"}
          </h2>
          <button type="button" className="ew-icon-btn ew-login-close-btn" onClick={close} aria-label="Close dialog">
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
        {recoveryMode && (
          <p className="ew-login-sub ew-login-sub-recovery">
            Enter your registered email to receive recovery instructions.
          </p>
        )}

        {!recoveryMode && (
          <div className="ew-role-banner" role="status">
            <p>
              <strong>Resident Access:</strong> Sign in to view your evacuation center and room assignment, and report community road hazards.
            </p>
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
              placeholder="Email address"
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
            "Sign in as Resident"
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

        {!recoveryMode && (
          <>
            <div className="ew-login-footer">
              <span className="ew-login-footer-text">No account?</span>{" "}
              <button
                type="button"
                className="ew-login-signup-link"
                onClick={onOpenSignUp}
              >
                Sign up
              </button>
            </div>
            <div className="ew-login-footer">
              <span className="ew-login-footer-text">Staff access?</span>{" "}
              <Link className="ew-login-signup-link" to="/login" onClick={close}>Staff sign in</Link>
            </div>
          </>
        )}
      </form>
    </dialog>
  );
  const content = usePublicMapShell
    ? <PublicMapDialogShell native labelledBy="ew-login-title">{dialog}</PublicMapDialogShell>
    : dialog;
  return typeof document !== "undefined" ? createPortal(content, document.body) : content;
}


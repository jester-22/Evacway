import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faUser,
  faLock,
  faEye,
  faEyeSlash,
  faPen,
  faCheck,
  faXmark,
  faCircleCheck,
  faTriangleExclamation,
  faPaperPlane,
  faCalendarDays,
  faAddressCard,
  faRightFromBracket,
  faShieldHalved,
  faHouseFlag,
  faCircleInfo,
} from "@fortawesome/free-solid-svg-icons";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../services/api";
import { formatManilaDate } from "../../utils/dateTime";
import {
  PASSWORD_REQUIREMENTS_MESSAGE,
  PASSWORD_RULES,
  sanitizeNameInput,
  sanitizePhoneInput,
  validateContactNumber,
  validateEmail,
  validatePassword,
  validatePersonName,
} from "../../utils/formValidation";
import "./ResidentProfile.css";

export default function ResidentProfile() {
  const { user, logout, updateUser } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [accountData, setAccountData] = useState(null);
  const [residentRecord, setResidentRecord] = useState(null);

  // Account-only edit state
  const [isEditing, setIsEditing] = useState(false);
  const [profileForm, setProfileForm] = useState({
    display_name: "",
    email: user?.email || "",
    contact_number: "",
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSuccessMsg, setProfileSuccessMsg] = useState("");
  const [profileErrorMsg, setProfileErrorMsg] = useState("");

  // Privacy setting state
  const [findSomeoneSearchable, setFindSomeoneSearchable] = useState(true);
  const [hasFamily, setHasFamily] = useState(false);
  const [privacySaving, setPrivacySaving] = useState(false);
  const [privacyErrorMsg, setPrivacyErrorMsg] = useState("");
  const [privacySuccessMsg, setPrivacySuccessMsg] = useState("");

  // Password state
  const [passwordForm, setPasswordForm] = useState({
    current: "",
    next: "",
    confirm: "",
  });
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordSuccessMsg, setPasswordSuccessMsg] = useState("");
  const [passwordErrorMsg, setPasswordErrorMsg] = useState("");

  // Password reset email state
  const [resetSending, setResetSending] = useState(false);
  const [resetCooldown, setResetCooldown] = useState(0);
  const [resetStatusMsg, setResetStatusMsg] = useState("");
  const [resetErrorMsg, setResetErrorMsg] = useState("");
  const cooldownTimerRef = useRef(null);

  useEffect(() => {
    if (resetCooldown > 0) {
      cooldownTimerRef.current = setTimeout(() => {
        setResetCooldown((prev) => prev - 1);
      }, 1000);
    }
    return () => clearTimeout(cooldownTimerRef.current);
  }, [resetCooldown]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    api
      .getResidentProfile()
      .then((res) => {
        if (!active) return;
        setAccountData(res.account || null);
        setResidentRecord(res.resident_record || null);
        setFindSomeoneSearchable(Boolean(res.privacy?.searchable ?? true));
        setHasFamily(Boolean(res.privacy?.has_family));
        setProfileForm({
          display_name: res.account?.display_name || "",
          email: res.account?.email || "",
          contact_number: res.account?.contact_number || "",
        });
        if (res.user) updateUser(res.user);
      })
      .catch((err) => {
        if (!active) return;
        setLoadError(err.message || "Could not load your account profile.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const effectiveName =
    accountData?.name ||
    residentRecord?.full_name ||
    user?.name ||
    "Resident";

  const effectiveEmail = accountData?.email || user?.email || "";

  const initials = useMemo(() => {
    const parts = String(effectiveName || "R").trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }, [effectiveName]);

  const memberSinceFormatted = useMemo(() => {
    const createdAt = accountData?.created_at || user?.created_at;
    if (!createdAt) return "Active resident account";
    return formatManilaDate(
      createdAt,
      { year: "numeric", month: "long", day: "numeric" },
      "Active resident account"
    );
  }, [accountData?.created_at, user?.created_at]);

  const birthdateFormatted = useMemo(() => {
    if (!residentRecord?.date_of_birth) return "Not on file";
    return formatManilaDate(
      residentRecord.date_of_birth,
      { year: "numeric", month: "long", day: "numeric" },
      residentRecord.date_of_birth
    );
  }, [residentRecord?.date_of_birth]);

  function handleStartEdit() {
    setProfileForm({
      display_name: accountData?.display_name || "",
      email: accountData?.email || user?.email || "",
      contact_number: accountData?.contact_number || "",
    });
    setFieldErrors({});
    setProfileSuccessMsg("");
    setProfileErrorMsg("");
    setIsEditing(true);
  }

  function handleCancelEdit() {
    setProfileForm({
      display_name: accountData?.display_name || "",
      email: accountData?.email || user?.email || "",
      contact_number: accountData?.contact_number || "",
    });
    setFieldErrors({});
    setProfileErrorMsg("");
    setIsEditing(false);
  }

  function validateProfileForm() {
    const errors = {};
    if (profileForm.display_name.trim()) {
      const nameError = validatePersonName(profileForm.display_name, {
        label: "Display name",
        required: false,
        min: 2,
        max: 100,
      });
      if (nameError) errors.display_name = nameError;
    }

    const emailError = validateEmail(profileForm.email, {
      label: "Email address",
      required: true,
    });
    if (emailError) errors.email = emailError;

    const phoneError = validateContactNumber(profileForm.contact_number, {
      required: false,
      label: "Contact number",
    });
    if (phoneError) errors.contact_number = phoneError;

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSaveProfile(e) {
    e.preventDefault();
    setProfileSuccessMsg("");
    setProfileErrorMsg("");
    if (!validateProfileForm()) return;

    setProfileSaving(true);
    try {
      const payload = {
        display_name: profileForm.display_name.trim() || null,
        email: profileForm.email.trim().toLowerCase(),
        contact_number: profileForm.contact_number.trim() || null,
      };
      const res = await api.updateResidentProfile(payload);
      setAccountData(res.account || null);
      if (res.resident_record) setResidentRecord(res.resident_record);
      if (res.user) updateUser(res.user);
      setProfileSuccessMsg(
        res.message || "Your account details were updated. Your official barangay resident record was not changed."
      );
      setIsEditing(false);
    } catch (err) {
      setProfileErrorMsg(err.message || "Failed to update account profile.");
    } finally {
      setProfileSaving(false);
    }
  }

  async function handlePrivacyChange(e) {
    const nextValue = e.target.checked;
    const prevValue = findSomeoneSearchable;
    setFindSomeoneSearchable(nextValue);
    setPrivacySaving(true);
    setPrivacyErrorMsg("");
    setPrivacySuccessMsg("");
    try {
      const res = await api.updateFindSomeonePrivacy(nextValue);
      setFindSomeoneSearchable(Boolean(res.searchable));
      setPrivacySuccessMsg(
        res.searchable
          ? "Others can now search for your family's evacuation center."
          : "Your family's evacuation center is now hidden from Find Someone."
      );
    } catch (err) {
      setFindSomeoneSearchable(prevValue);
      setPrivacyErrorMsg(err.message || "Could not update search visibility.");
    } finally {
      setPrivacySaving(false);
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    setPasswordSuccessMsg("");
    setPasswordErrorMsg("");

    if (!passwordForm.current) {
      setPasswordErrorMsg("Current password is required.");
      return;
    }
    if (passwordForm.next !== passwordForm.confirm) {
      setPasswordErrorMsg("New password and confirmation password do not match.");
      return;
    }
    if (validatePassword(passwordForm.next)) {
      setPasswordErrorMsg(PASSWORD_REQUIREMENTS_MESSAGE);
      return;
    }

    setPasswordSaving(true);
    try {
      const res = await api.changeResidentPassword(
        passwordForm.current,
        passwordForm.next
      );
      setPasswordForm({ current: "", next: "", confirm: "" });
      setPasswordSuccessMsg(res.message || "Password changed successfully.");
    } catch (err) {
      setPasswordErrorMsg(err.message || "Could not change password.");
    } finally {
      setPasswordSaving(false);
    }
  }

  async function handleRequestReset() {
    if (resetCooldown > 0 || resetSending) return;
    setResetSending(true);
    setResetStatusMsg("");
    setResetErrorMsg("");
    try {
      const res = await api.requestResidentPasswordReset();
      setResetStatusMsg(
        res.message || `A password reset link has been sent to ${effectiveEmail}.`
      );
      setResetCooldown(60);
    } catch (err) {
      setResetErrorMsg(err.message || "Could not send password reset email.");
    } finally {
      setResetSending(false);
    }
  }

  return (
    <div className="res-profile-page">
      <header className="res-profile-topbar">
        <div className="res-profile-topbar-inner">
          <div className="res-profile-topbar-left">
            <button
              type="button"
              onClick={() => navigate("/map")}
              className="profile-btn profile-btn-secondary ds-btn ds-btn--secondary"
            >
              <FontAwesomeIcon icon={faArrowLeft} />
              <span>Back to Map</span>
            </button>
            <img
              src="/evacway-logo-text.png"
              alt="EvacWay"
              className="res-profile-logo"
            />
          </div>
          <button
            type="button"
            onClick={logout}
            className="profile-btn profile-btn-secondary ds-btn ds-btn--secondary"
          >
            <FontAwesomeIcon icon={faRightFromBracket} />
            <span>Log Out</span>
          </button>
        </div>
      </header>

      <main className="res-profile-main">
        <div className="profile-container">
          <div className="profile-page-header">
            <h1 className="profile-heading">Manage Profile</h1>
            <p className="profile-subheading">
              Update your EvacWay login account details. Your official barangay resident record is shown below as a read-only guide.
            </p>
          </div>

          {loadError && (
            <div className="profile-alert is-error ds-banner ds-banner--danger" role="alert">
              <FontAwesomeIcon icon={faTriangleExclamation} />
              <span>{loadError}</span>
            </div>
          )}

          {/* IDENTITY CARD */}
          <section className="profile-identity-card ds-card" aria-label="Account Identity">
            <div className="profile-identity-avatar" aria-hidden="true">
              <span>{initials}</span>
            </div>
            <div className="profile-identity-info">
              <div className="profile-identity-name-row">
                <h2 className="profile-identity-name">{effectiveName}</h2>
                <span className="ds-badge ds-badge--neutral profile-role-badge is-lgu">
                  <FontAwesomeIcon icon={faUser} className="profile-role-icon" />
                  Resident Account
                </span>
              </div>
              <p className="profile-identity-email">{effectiveEmail}</p>
            </div>
          </section>

          {/* 1. ACCOUNT INFORMATION (EDITABLE — ACCOUNT ONLY) */}
          <section className="profile-card ds-card" aria-labelledby="res-account-info-heading">
            <div className="profile-card-header">
              <div>
                <h2 id="res-account-info-heading" className="profile-card-title">
                  Account Information
                </h2>
                <p className="profile-card-desc">
                  Changes here only update your EvacWay account and do not modify your official barangay resident record.
                </p>
              </div>
              {!isEditing && !loading && (
                <button
                  type="button"
                  onClick={handleStartEdit}
                  className="profile-btn profile-btn-secondary ds-btn ds-btn--secondary"
                >
                  <FontAwesomeIcon icon={faPen} />
                  <span>Edit Account</span>
                </button>
              )}
            </div>

            {profileSuccessMsg && (
              <div className="profile-alert is-success ds-banner ds-banner--success" role="status">
                <FontAwesomeIcon icon={faCircleCheck} />
                <span>{profileSuccessMsg}</span>
              </div>
            )}

            {profileErrorMsg && (
              <div className="profile-alert is-error ds-banner ds-banner--danger" role="alert">
                <FontAwesomeIcon icon={faTriangleExclamation} />
                <span>{profileErrorMsg}</span>
              </div>
            )}

            {loading ? (
              <p className="profile-card-desc">Loading your account details...</p>
            ) : !isEditing ? (
              <div className="profile-fields-grid">
                <div className="profile-field-item">
                  <span className="profile-field-label">Account Display Name</span>
                  <p className="profile-field-value">
                    {accountData?.display_name || (
                      <span className="profile-field-empty">
                        Using roster name ({residentRecord?.full_name || "Resident"})
                      </span>
                    )}
                  </p>
                </div>

                <div className="profile-field-item">
                  <span className="profile-field-label">Account Email</span>
                  <p className="profile-field-value">{effectiveEmail || "—"}</p>
                </div>

                <div className="profile-field-item">
                  <span className="profile-field-label">Account Contact Number</span>
                  <p className="profile-field-value">
                    {accountData?.contact_number || (
                      <span className="profile-field-empty">
                        {residentRecord?.contact_number
                          ? `Using roster contact (${residentRecord.contact_number})`
                          : "Not provided"}
                      </span>
                    )}
                  </p>
                </div>

                <div className="profile-field-item">
                  <span className="profile-field-label">Member Since</span>
                  <p className="profile-field-value flex items-center gap-2">
                    <FontAwesomeIcon icon={faCalendarDays} className="text-slate-400" />
                    <span>{memberSinceFormatted}</span>
                  </p>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSaveProfile} noValidate className="profile-form">
                {residentRecord && (
                  <div className="res-guide-inline-banner" role="note">
                    <FontAwesomeIcon icon={faCircleInfo} />
                    <div>
                      <strong>Reference from your official resident record:</strong>{" "}
                      <span>
                        Name: <strong>{residentRecord.full_name || "—"}</strong>
                        {residentRecord.contact_number
                          ? ` · Roster contact: ${residentRecord.contact_number}`
                          : ""}
                        {residentRecord.barangay
                          ? ` · Barangay: ${residentRecord.barangay}`
                          : ""}
                      </span>
                    </div>
                  </div>
                )}

                <div className="profile-form-grid">
                  <div className="profile-input-group">
                    <label htmlFor="res-display-name">Account Display Name (optional)</label>
                    <div className="profile-input-wrapper">
                      <input
                        id="res-display-name"
                        type="text"
                        maxLength={100}
                        value={profileForm.display_name}
                        onChange={(e) => {
                          setProfileForm({
                            ...profileForm,
                            display_name: sanitizeNameInput(e.target.value),
                          });
                          if (fieldErrors.display_name) {
                            setFieldErrors({ ...fieldErrors, display_name: "" });
                          }
                        }}
                        className={`profile-input ${fieldErrors.display_name ? "is-invalid" : ""}`}
                        placeholder={residentRecord?.full_name || "Leave blank to use official roster name"}
                      />
                    </div>
                    {residentRecord?.full_name &&
                      profileForm.display_name.trim() !== residentRecord.full_name && (
                        <button
                          type="button"
                          className="res-guide-fill-btn"
                          onClick={() =>
                            setProfileForm({
                              ...profileForm,
                              display_name: residentRecord.full_name,
                            })
                          }
                        >
                          Use roster name ({residentRecord.full_name})
                        </button>
                      )}
                    {fieldErrors.display_name && (
                      <p className="profile-field-error" role="alert">
                        {fieldErrors.display_name}
                      </p>
                    )}
                  </div>

                  <div className="profile-input-group">
                    <label htmlFor="res-email">
                      Account Email <span className="profile-required">*</span>
                    </label>
                    <div className="profile-input-wrapper">
                      <input
                        id="res-email"
                        type="email"
                        required
                        autoComplete="email"
                        value={profileForm.email}
                        onChange={(e) => {
                          setProfileForm({ ...profileForm, email: e.target.value });
                          if (fieldErrors.email) {
                            setFieldErrors({ ...fieldErrors, email: "" });
                          }
                        }}
                        className={`profile-input ${fieldErrors.email ? "is-invalid" : ""}`}
                        placeholder="e.g. you@gmail.com"
                      />
                    </div>
                    {fieldErrors.email && (
                      <p className="profile-field-error" role="alert">
                        {fieldErrors.email}
                      </p>
                    )}
                  </div>

                  <div className="profile-input-group">
                    <label htmlFor="res-contact">Account Contact Number (optional)</label>
                    <div className="profile-input-wrapper">
                      <input
                        id="res-contact"
                        type="tel"
                        autoComplete="tel"
                        maxLength={20}
                        value={profileForm.contact_number}
                        onChange={(e) => {
                          setProfileForm({
                            ...profileForm,
                            contact_number: sanitizePhoneInput(e.target.value),
                          });
                          if (fieldErrors.contact_number) {
                            setFieldErrors({ ...fieldErrors, contact_number: "" });
                          }
                        }}
                        className={`profile-input ${fieldErrors.contact_number ? "is-invalid" : ""}`}
                        placeholder={residentRecord?.contact_number || "e.g. 0912 345 6789"}
                      />
                    </div>
                    {residentRecord?.contact_number &&
                      profileForm.contact_number.trim() !== residentRecord.contact_number && (
                        <button
                          type="button"
                          className="res-guide-fill-btn"
                          onClick={() =>
                            setProfileForm({
                              ...profileForm,
                              contact_number: residentRecord.contact_number,
                            })
                          }
                        >
                          Use roster contact ({residentRecord.contact_number})
                        </button>
                      )}
                    {fieldErrors.contact_number && (
                      <p className="profile-field-error" role="alert">
                        {fieldErrors.contact_number}
                      </p>
                    )}
                  </div>
                </div>

                <div className="profile-form-actions">
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    disabled={profileSaving}
                    className="profile-btn profile-btn-secondary ds-btn ds-btn--secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={profileSaving}
                    className="profile-btn profile-btn-primary ds-btn ds-btn--primary"
                  >
                    {profileSaving ? "Saving changes..." : "Save Account Changes"}
                  </button>
                </div>
              </form>
            )}
          </section>

          {/* 2. OFFICIAL RESIDENT RECORD (READ-ONLY GUIDE) */}
          {residentRecord && (
            <section
              className="profile-card ds-card res-roster-guide-card"
              aria-labelledby="res-roster-guide-heading"
            >
              <div className="profile-card-header">
                <div>
                  <h2 id="res-roster-guide-heading" className="profile-card-title">
                    Official Resident Record
                  </h2>
                  <p className="profile-card-desc">
                    Managed by your Barangay / LGU office and shown here as a read-only reference guide.
                  </p>
                </div>
                <span className="profile-status-pill is-inactive">
                  <FontAwesomeIcon icon={faAddressCard} />
                  <span>Read-Only Guide</span>
                </span>
              </div>

              <div className="profile-fields-grid">
                <div className="profile-field-item">
                  <span className="profile-field-label">Registered Full Name</span>
                  <p className="profile-field-value">{residentRecord.full_name || "—"}</p>
                </div>

                <div className="profile-field-item">
                  <span className="profile-field-label">Birthdate</span>
                  <p className="profile-field-value">{birthdateFormatted}</p>
                </div>

                <div className="profile-field-item">
                  <span className="profile-field-label">Barangay</span>
                  <p className="profile-field-value">{residentRecord.barangay || "—"}</p>
                </div>

                <div className="profile-field-item">
                  <span className="profile-field-label">Address / Purok</span>
                  <p className="profile-field-value">
                    {residentRecord.address || (
                      <span className="profile-field-empty">Not provided</span>
                    )}
                  </p>
                </div>

                <div className="profile-field-item">
                  <span className="profile-field-label">Roster Contact Number</span>
                  <p className="profile-field-value">
                    {residentRecord.contact_number || (
                      <span className="profile-field-empty">Not on file</span>
                    )}
                  </p>
                </div>

                <div className="profile-field-item">
                  <span className="profile-field-label">Household / Family</span>
                  <p className="profile-field-value">
                    {residentRecord.family_code ? `${residentRecord.family_code}` : "—"}
                    {residentRecord.household_head_name
                      ? ` · Head: ${residentRecord.household_head_name}`
                      : ""}
                  </p>
                </div>

                <div className="profile-field-item">
                  <span className="profile-field-label">Relationship to Head</span>
                  <p className="profile-field-value">
                    {residentRecord.relationship_to_head || "—"}
                  </p>
                </div>

                <div className="profile-field-item">
                  <span className="profile-field-label">Assigned Evacuation Center</span>
                  <p className="profile-field-value flex items-center gap-2">
                    <FontAwesomeIcon icon={faHouseFlag} className="text-slate-400" />
                    <span>{residentRecord.evacuation_center_name || "Not assigned yet"}</span>
                  </p>
                </div>
              </div>

              <p className="res-roster-guide-note">
                Need to correct your official name, birthdate, barangay, or family roster? Please visit or contact your Barangay or LGU office so staff can update the official record.
              </p>
            </section>
          )}

          {/* 3. FAMILY SEARCH PRIVACY */}
          {hasFamily && (
            <section className="profile-card ds-card" aria-labelledby="res-privacy-heading">
              <div className="profile-card-header">
                <div>
                  <h2 id="res-privacy-heading" className="profile-card-title">
                    Family Search Privacy
                  </h2>
                  <p className="profile-card-desc">
                    Control whether relatives and neighbors can look up your family's assigned evacuation center name via Find Someone.
                  </p>
                </div>
                <span
                  className={`profile-status-pill ${findSomeoneSearchable ? "is-active" : "is-inactive"}`}
                >
                  <FontAwesomeIcon icon={faShieldHalved} />
                  <span>{findSomeoneSearchable ? "Visible" : "Hidden"}</span>
                </span>
              </div>

              {privacySuccessMsg && (
                <div className="profile-alert is-success ds-banner ds-banner--success" role="status">
                  <FontAwesomeIcon icon={faCircleCheck} />
                  <span>{privacySuccessMsg}</span>
                </div>
              )}

              {privacyErrorMsg && (
                <div className="profile-alert is-error ds-banner ds-banner--danger" role="alert">
                  <FontAwesomeIcon icon={faTriangleExclamation} />
                  <span>{privacyErrorMsg}</span>
                </div>
              )}

              <label className="res-privacy-toggle-row">
                <input
                  type="checkbox"
                  checked={findSomeoneSearchable}
                  disabled={privacySaving}
                  onChange={handlePrivacyChange}
                />
                <span>
                  <strong>Let others find my family's evacuation center</strong>
                  <small>
                    Only the evacuation center name is shown — never your address, contact number, or personal details.
                  </small>
                </span>
              </label>
            </section>
          )}

          {/* 4. PASSWORD & SECURITY */}
          <section className="profile-card ds-card" aria-labelledby="res-password-heading">
            <div className="profile-card-header">
              <div>
                <h2 id="res-password-heading" className="profile-card-title">
                  Password &amp; Security
                </h2>
                <p className="profile-card-desc">
                  Update your account password or request a password reset link via email.
                </p>
              </div>
            </div>

            {passwordSuccessMsg && (
              <div className="profile-alert is-success ds-banner ds-banner--success" role="status">
                <FontAwesomeIcon icon={faCircleCheck} />
                <span>{passwordSuccessMsg}</span>
              </div>
            )}

            {passwordErrorMsg && (
              <div className="profile-alert is-error ds-banner ds-banner--danger" role="alert">
                <FontAwesomeIcon icon={faTriangleExclamation} />
                <span>{passwordErrorMsg}</span>
              </div>
            )}

            <form onSubmit={handleChangePassword} noValidate className="profile-form">
              <div className="profile-password-fields">
                <div className="profile-input-group">
                  <label htmlFor="res-current-password">Current Password</label>
                  <div className="profile-password-input-wrap">
                    <input
                      id="res-current-password"
                      type={showCurrent ? "text" : "password"}
                      autoComplete="current-password"
                      required
                      value={passwordForm.current}
                      onChange={(e) =>
                        setPasswordForm({ ...passwordForm, current: e.target.value })
                      }
                      className="profile-input"
                      placeholder="Enter current password"
                    />
                    <button
                      type="button"
                      className="profile-password-toggle"
                      onClick={() => setShowCurrent(!showCurrent)}
                      aria-label={showCurrent ? "Hide current password" : "Show current password"}
                    >
                      <FontAwesomeIcon icon={showCurrent ? faEyeSlash : faEye} />
                    </button>
                  </div>
                </div>

                <div className="profile-input-group">
                  <label htmlFor="res-new-password">New Password</label>
                  <div className="profile-password-input-wrap">
                    <input
                      id="res-new-password"
                      type={showNext ? "text" : "password"}
                      autoComplete="new-password"
                      required
                      minLength={8}
                      value={passwordForm.next}
                      onChange={(e) =>
                        setPasswordForm({ ...passwordForm, next: e.target.value })
                      }
                      className="profile-input"
                      placeholder="Enter new secure password"
                    />
                    <button
                      type="button"
                      className="profile-password-toggle"
                      onClick={() => setShowNext(!showNext)}
                      aria-label={showNext ? "Hide new password" : "Show new password"}
                    >
                      <FontAwesomeIcon icon={showNext ? faEyeSlash : faEye} />
                    </button>
                  </div>
                </div>

                <div className="profile-input-group">
                  <label htmlFor="res-confirm-password">Confirm New Password</label>
                  <div className="profile-password-input-wrap">
                    <input
                      id="res-confirm-password"
                      type={showConfirm ? "text" : "password"}
                      autoComplete="new-password"
                      required
                      minLength={8}
                      value={passwordForm.confirm}
                      onChange={(e) =>
                        setPasswordForm({ ...passwordForm, confirm: e.target.value })
                      }
                      className="profile-input"
                      placeholder="Re-enter new password"
                    />
                    <button
                      type="button"
                      className="profile-password-toggle"
                      onClick={() => setShowConfirm(!showConfirm)}
                      aria-label={showConfirm ? "Hide confirm password" : "Show confirm password"}
                    >
                      <FontAwesomeIcon icon={showConfirm ? faEyeSlash : faEye} />
                    </button>
                  </div>
                </div>
              </div>

              <div className="profile-rules-box">
                <p className="profile-rules-title">Password Requirements:</p>
                <ul className="profile-rules-list">
                  {PASSWORD_RULES.map((rule) => {
                    const passed = rule.test(passwordForm.next);
                    return (
                      <li
                        key={rule.id}
                        className={`profile-rule-item ${passed ? "is-passed" : ""}`}
                      >
                        <FontAwesomeIcon
                          icon={passed ? faCheck : faCircleCheck}
                          className="profile-rule-icon"
                        />
                        <span>{rule.label}</span>
                      </li>
                    );
                  })}
                  {passwordForm.confirm && (
                    <li
                      className={`profile-rule-item ${
                        passwordForm.next === passwordForm.confirm ? "is-passed" : ""
                      }`}
                    >
                      <FontAwesomeIcon
                        icon={passwordForm.next === passwordForm.confirm ? faCheck : faXmark}
                        className="profile-rule-icon"
                      />
                      <span>Passwords match</span>
                    </li>
                  )}
                </ul>
              </div>

              <div className="profile-form-actions">
                <button
                  type="submit"
                  disabled={passwordSaving || !passwordForm.current || !passwordForm.next}
                  className="profile-btn profile-btn-primary ds-btn ds-btn--primary"
                >
                  <FontAwesomeIcon icon={faLock} />
                  <span>{passwordSaving ? "Updating password..." : "Update Password"}</span>
                </button>
              </div>
            </form>

            <div className="profile-reset-card">
              <div className="profile-reset-info">
                <h3 className="profile-reset-title">Forgot your current password?</h3>
                <p className="profile-reset-desc">
                  Send a secure password reset link directly to your account email (
                  <strong>{effectiveEmail}</strong>).
                </p>
                {resetStatusMsg && (
                  <p className="profile-reset-msg is-success" role="status">
                    <FontAwesomeIcon icon={faCircleCheck} /> {resetStatusMsg}
                  </p>
                )}
                {resetErrorMsg && (
                  <p className="profile-reset-msg is-error" role="alert">
                    <FontAwesomeIcon icon={faTriangleExclamation} /> {resetErrorMsg}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={handleRequestReset}
                disabled={resetSending || resetCooldown > 0}
                className="profile-btn profile-btn-secondary ds-btn ds-btn--secondary shrink-0"
              >
                <FontAwesomeIcon icon={faPaperPlane} />
                <span>
                  {resetSending
                    ? "Sending reset email..."
                    : resetCooldown > 0
                    ? `Resend available in ${resetCooldown}s`
                    : "Send Password Reset Link"}
                </span>
              </button>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

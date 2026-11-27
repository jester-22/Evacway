import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faUser,
  faEnvelope,
  faPhone,
  faShieldHalved,
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
  faArrowRotateLeft,
} from "@fortawesome/free-solid-svg-icons";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../services/api";
import { queryKeys } from "../../hooks/useEvacuationQueries";
import { useQueryClient } from "@tanstack/react-query";
import { useIsMobile } from "../../hooks/useIsMobile";
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
import Sidebar from "../../components/Sidebar/Sidebar";
import "./ManageProfile.css";

export default function ManageProfile() {
  const { user, logout, updateUser, completeStaffLogin } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === "admin";

  // Personal Information State
  const [isEditing, setIsEditing] = useState(false);
  const [profileForm, setProfileForm] = useState({
    name: user?.name || "",
    email: user?.email || "",
    contact_number: user?.contact_number || "",
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSuccessMsg, setProfileSuccessMsg] = useState("");
  const [profileErrorMsg, setProfileErrorMsg] = useState("");

  // Keep form in sync if user object changes externally
  useEffect(() => {
    if (!isEditing && user) {
      setProfileForm({
        name: user.name || "",
        email: user.email || "",
        contact_number: user.contact_number || "",
      });
    }
  }, [user, isEditing]);

  // Check if profile form is dirty
  const isDirty = useMemo(() => {
    if (!user) return false;
    return (
      profileForm.name.trim() !== (user.name || "").trim() ||
      profileForm.email.trim().toLowerCase() !== (user.email || "").trim().toLowerCase() ||
      profileForm.contact_number.trim() !== (user.contact_number || "").trim()
    );
  }, [profileForm, user]);

  // Prevent leaving window with unsaved changes
  useEffect(() => {
    function handleBeforeUnload(e) {
      if (isEditing && isDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isEditing, isDirty]);

  // Password State
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

  // Password Reset State
  const [resetSending, setResetSending] = useState(false);
  const [resetCooldown, setResetCooldown] = useState(0);
  const [resetStatusMsg, setResetStatusMsg] = useState("");
  const [resetErrorMsg, setResetErrorMsg] = useState("");
  const cooldownTimerRef = useRef(null);

  // Two-Factor Authentication (2FA) State
  const [mfaSending, setMfaSending] = useState(false);
  const [mfaConfirming, setMfaConfirming] = useState(false);
  const [mfaDisabling, setMfaDisabling] = useState(false);
  const [mfaVerificationToken, setMfaVerificationToken] = useState("");
  const [mfaMaskedEmail, setMfaMaskedEmail] = useState("");
  const [mfaOtpCode, setMfaOtpCode] = useState("");
  const [mfaResendCooldown, setMfaResendCooldown] = useState(0);
  const [mfaShowDisableForm, setMfaShowDisableForm] = useState(false);
  const [mfaDisablePassword, setMfaDisablePassword] = useState("");
  const [mfaShowDisablePassword, setMfaShowDisablePassword] = useState(false);
  const [mfaSuccessMsg, setMfaSuccessMsg] = useState("");
  const [mfaErrorMsg, setMfaErrorMsg] = useState("");

  // Refresh current profile from backend on mount so 2FA flags stay in sync
  useEffect(() => {
    let active = true;
    api.getMyProfile()
      .then((fresh) => {
        if (active && fresh) updateUser(fresh);
      })
      .catch(() => {});
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mfaResendCooldown <= 0) return undefined;
    const timer = setTimeout(() => {
      setMfaResendCooldown((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => clearTimeout(timer);
  }, [mfaResendCooldown]);

  useEffect(() => {
    if (resetCooldown > 0) {
      cooldownTimerRef.current = setTimeout(() => {
        setResetCooldown((prev) => prev - 1);
      }, 1000);
    }
    return () => clearTimeout(cooldownTimerRef.current);
  }, [resetCooldown]);

  // Navigation from Sidebar
  async function handleTabChange(nextTab) {
    if (isEditing && isDirty) {
      const { appConfirm } = await import("../../utils/appDialog");
      const confirmLeave = await appConfirm(
        "You have unsaved profile changes. Are you sure you want to leave without saving?",
        {
          title: "Discard Unsaved Changes?",
          confirmText: "Leave Without Saving",
          danger: true,
        }
      );
      if (!confirmLeave) return;
    }

    if (nextTab === "profile") return;
    if (nextTab === "dashboard") {
      navigate("/dashboard");
      return;
    }
    if (nextTab === "map") {
      navigate("/admin/map");
      return;
    }
    const path = isAdmin ? "/admin" : "/lgu";
    navigate(`${path}?tab=${encodeURIComponent(nextTab)}`);
  }

  async function handleNotificationSelect(notification) {
    if (isEditing && isDirty) {
      const { appConfirm } = await import("../../utils/appDialog");
      const confirmLeave = await appConfirm(
        "You have unsaved profile changes. Are you sure you want to leave without saving?",
        {
          title: "Discard Unsaved Changes?",
          confirmText: "Leave Without Saving",
          danger: true,
        }
      );
      if (!confirmLeave) return;
    }
    const path = isAdmin ? "/admin" : "/lgu";
    let tab = "rescue";
    if (notification.resource_type === "hazard_report") {
      tab = "reports";
    } else if (notification.resource_type === "resident_registration" || notification.resource_type === "resident_account") {
      tab = "registrations";
    }
    const params = new URLSearchParams({
      tab,
      notificationId: String(notification.id),
      resourceType: String(notification.resource_type || ""),
      resourceId: String(notification.resource_id ?? ""),
    });
    navigate(`${path}?${params.toString()}`);
  }

  // Personal Information Actions
  function handleStartEdit() {
    setProfileForm({
      name: user?.name || "",
      email: user?.email || "",
      contact_number: user?.contact_number || "",
    });
    setFieldErrors({});
    setProfileSuccessMsg("");
    setProfileErrorMsg("");
    setIsEditing(true);
  }

  function handleCancelEdit() {
    setProfileForm({
      name: user?.name || "",
      email: user?.email || "",
      contact_number: user?.contact_number || "",
    });
    setFieldErrors({});
    setProfileErrorMsg("");
    setIsEditing(false);
  }

  function validateProfileForm() {
    const errors = {};
    const nameError = validatePersonName(profileForm.name, {
      label: "Full name",
      required: true,
      min: 2,
      max: 100,
    });
    if (nameError) errors.name = nameError;

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
        name: profileForm.name.trim(),
        email: profileForm.email.trim().toLowerCase(),
        contact_number: profileForm.contact_number.trim() || null,
      };

      const updated = await api.updateMyProfile(payload);

      // Update state in AuthContext without reload
      updateUser(updated);
      setMfaVerificationToken("");
      setMfaOtpCode("");

      // Invalidate queries
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.users }),
        queryClient.invalidateQueries({ queryKey: queryKeys.logs }),
      ]);

      setProfileSuccessMsg("Profile updated successfully.");
      setIsEditing(false);
    } catch (err) {
      setProfileErrorMsg(err.message || "Failed to update profile details.");
    } finally {
      setProfileSaving(false);
    }
  }

  // Password Actions
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
      const result = await api.changeMyPassword(passwordForm.current, passwordForm.next);
      setPasswordForm({ current: "", next: "", confirm: "" });
      setPasswordSuccessMsg(result.message || "Password changed successfully.");
      await queryClient.invalidateQueries({ queryKey: queryKeys.logs });
    } catch (err) {
      setPasswordErrorMsg(err.message || "Could not change password.");
    } finally {
      setPasswordSaving(false);
    }
  }

  // Password Reset Action
  async function handleRequestReset() {
    if (resetCooldown > 0 || resetSending) return;

    setResetSending(true);
    setResetStatusMsg("");
    setResetErrorMsg("");

    try {
      const result = await api.requestMyPasswordReset();
      setResetStatusMsg(
        result.message || `A password reset link has been sent to ${user?.email}.`
      );
      setResetCooldown(60); // 60s cooldown to prevent duplicates
      await queryClient.invalidateQueries({ queryKey: queryKeys.logs });
    } catch (err) {
      setResetErrorMsg(err.message || "Could not send password reset email.");
    } finally {
      setResetSending(false);
    }
  }

  // Two-Factor Authentication (2FA) Actions
  const mfaRequiredByPolicy = Boolean(user?.mfa_required_by_policy ?? isAdmin);
  const mfaEnabled = Boolean(user?.mfa_enabled ?? (user?.totp_enabled || isAdmin));
  const mfaDeliveryEmail =
    user?.mfa_delivery_email ??
    (user?.recovery_email || user?.email || "");
  const mfaEmailDeliverable =
    user?.mfa_email_deliverable !== undefined
      ? Boolean(user.mfa_email_deliverable)
      : Boolean(
          mfaDeliveryEmail &&
            !(/\.(local|localhost|invalid|internal|lan)$/i.test(mfaDeliveryEmail.trim()))
        );
  const mfaEnableModalOpen = Boolean(!mfaRequiredByPolicy && !mfaEnabled && mfaVerificationToken);
  const mfaDisableModalOpen = Boolean(!mfaRequiredByPolicy && mfaEnabled && mfaShowDisableForm);

  useEffect(() => {
    if (!mfaEnableModalOpen && !mfaDisableModalOpen) return undefined;
    function handleEsc(e) {
      if (e.key !== "Escape") return;
      if (mfaEnableModalOpen && !mfaConfirming) {
        setMfaVerificationToken("");
        setMfaOtpCode("");
        setMfaErrorMsg("");
        setMfaSuccessMsg("");
      } else if (mfaDisableModalOpen && !mfaDisabling) {
        setMfaShowDisableForm(false);
        setMfaDisablePassword("");
        setMfaErrorMsg("");
      }
    }
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [mfaEnableModalOpen, mfaDisableModalOpen, mfaConfirming, mfaDisabling]);

  async function handleSendMfaEnableCode() {
    if (mfaSending || mfaResendCooldown > 0) return;
    setMfaSending(true);
    setMfaSuccessMsg("");
    setMfaErrorMsg("");
    try {
      const res = await api.sendMyMfaEnableCode();
      setMfaVerificationToken(res.verification_token || "");
      setMfaMaskedEmail(res.masked_email || mfaDeliveryEmail);
      setMfaOtpCode("");
      setMfaResendCooldown(Number(res.resend_cooldown_seconds) || 30);
      setMfaSuccessMsg(
        res.message || `A 6-digit test code was sent to ${res.masked_email || mfaDeliveryEmail}.`
      );
    } catch (err) {
      setMfaErrorMsg(
        err.message || "Could not send a verification code to your email. Please check your email address."
      );
    } finally {
      setMfaSending(false);
    }
  }

  async function handleConfirmMfaEnable(e) {
    e.preventDefault();
    if (mfaConfirming || !mfaVerificationToken) return;
    setMfaConfirming(true);
    setMfaSuccessMsg("");
    setMfaErrorMsg("");
    try {
      const res = await api.confirmMyMfaEnable(mfaVerificationToken, mfaOtpCode);
      if (res.access_token && res.user) {
        completeStaffLogin(res);
      } else if (res.user) {
        updateUser(res.user);
      }
      setMfaVerificationToken("");
      setMfaOtpCode("");
      setMfaResendCooldown(0);
      setMfaSuccessMsg(
        res.message || "Two-factor authentication is now enabled on your account."
      );
      await queryClient.invalidateQueries({ queryKey: queryKeys.logs });
    } catch (err) {
      setMfaErrorMsg(err.message || "Invalid verification code. Please check your email and try again.");
    } finally {
      setMfaConfirming(false);
    }
  }

  function handleCancelMfaEnable() {
    setMfaVerificationToken("");
    setMfaOtpCode("");
    setMfaErrorMsg("");
    setMfaSuccessMsg("");
  }

  async function handleDisableMfa(e) {
    e.preventDefault();
    if (mfaDisabling) return;
    if (!mfaDisablePassword) {
      setMfaErrorMsg("Enter your current password to disable two-factor authentication.");
      return;
    }
    setMfaDisabling(true);
    setMfaSuccessMsg("");
    setMfaErrorMsg("");
    try {
      const res = await api.disableMyMfa(mfaDisablePassword);
      if (res.access_token && res.user) {
        completeStaffLogin(res);
      } else if (res.user) {
        updateUser(res.user);
      }
      setMfaShowDisableForm(false);
      setMfaDisablePassword("");
      setMfaShowDisablePassword(false);
      setMfaSuccessMsg(res.message || "Two-factor authentication has been disabled.");
      await queryClient.invalidateQueries({ queryKey: queryKeys.logs });
    } catch (err) {
      setMfaErrorMsg(err.message || "Could not disable two-factor authentication.");
    } finally {
      setMfaDisabling(false);
    }
  }

  const memberSinceFormatted = useMemo(() => {
    if (!user?.created_at) return "Active member";
    return formatManilaDate(
      user.created_at,
      {
        year: "numeric",
        month: "long",
        day: "numeric",
      },
      "Active member"
    );
  }, [user?.created_at]);

  const initials = useMemo(() => {
    if (!user?.name) return "U";
    const parts = user.name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }, [user?.name]);

  return (
    <div className="dashboard-layout">
      <Sidebar
        tab="profile"
        setTab={handleTabChange}
        user={user}
        logout={logout}
        isMobile={isMobile}
        onSelectNotification={handleNotificationSelect}
      />

      <main className="dashboard-content profile-page-main">
        <div className="profile-container">

          {/* PAGE HEADER */}
          <div className="profile-page-header">
            <h1 className="profile-heading">Manage Profile</h1>
            <p className="profile-subheading">
              View and manage your personal information, role details, and account security.
            </p>
          </div>

          {/* IDENTITY CARD HEADER */}
          <section className="profile-identity-card ds-card" aria-label="Account Identity">
            <div className="profile-identity-avatar" aria-hidden="true">
              <span>{initials}</span>
            </div>
            <div className="profile-identity-info">
              <div className="profile-identity-name-row">
                <h2 className="profile-identity-name">{user?.name || "Officer"}</h2>
                <span className={`ds-badge ds-badge--neutral profile-role-badge ${isAdmin ? "is-admin" : "is-lgu"}`}>
                  <FontAwesomeIcon icon={faShieldHalved} className="profile-role-icon" />
                  {isAdmin ? "Administrator" : "LGU Personnel"}
                </span>
              </div>
              <p className="profile-identity-email">{user?.email}</p>
            </div>
          </section>

          {/* 1. PERSONAL INFORMATION SECTION */}
          <section className="profile-card" aria-labelledby="personal-info-heading">
            <div className="profile-card-header">
              <div>
                <h2 id="personal-info-heading" className="profile-card-title">
                  Personal Information
                </h2>
                <p className="profile-card-desc">
                  Your primary contact details used for notifications and operations.
                </p>
              </div>

              {!isEditing && (
                <button
                  type="button"
                  onClick={handleStartEdit}
                  className="profile-btn profile-btn-secondary ds-btn ds-btn--secondary"
                  aria-label="Edit personal information"
                >
                  <FontAwesomeIcon icon={faPen} />
                  <span>Edit Profile</span>
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

            {!isEditing ? (
              /* READ-ONLY VIEW */
              <div className="profile-fields-grid">
                <div className="profile-field-item">
                  <span className="profile-field-label">Full Name</span>
                  <p className="profile-field-value">{user?.name || "—"}</p>
                </div>

                <div className="profile-field-item">
                  <span className="profile-field-label">Email Address</span>
                  <p className="profile-field-value">{user?.email || "—"}</p>
                </div>

                <div className="profile-field-item">
                  <span className="profile-field-label">Contact Number</span>
                  <p className="profile-field-value">
                    {user?.contact_number || (
                      <span className="profile-field-empty">Not provided</span>
                    )}
                  </p>
                </div>
              </div>
            ) : (
              /* EDIT FORM */
              <form onSubmit={handleSaveProfile} noValidate className="profile-form">
                <div className="profile-form-grid">
                  <div className="profile-input-group">
                    <label htmlFor="profile-name">
                      Full Name <span className="profile-required">*</span>
                    </label>
                    <div className="profile-input-wrapper">
                      <input
                        id="profile-name"
                        type="text"
                        required
                        maxLength={100}
                        value={profileForm.name}
                        onChange={(e) => {
                          setProfileForm({ ...profileForm, name: sanitizeNameInput(e.target.value) });
                          if (fieldErrors.name) setFieldErrors({ ...fieldErrors, name: "" });
                        }}
                        className={`profile-input ${fieldErrors.name ? "is-invalid" : ""}`}
                        placeholder="e.g. Juan Dela Cruz"
                      />
                    </div>
                    {fieldErrors.name && (
                      <p className="profile-field-error" role="alert">
                        {fieldErrors.name}
                      </p>
                    )}
                  </div>

                  <div className="profile-input-group">
                    <label htmlFor="profile-email">
                      Email Address <span className="profile-required">*</span>
                    </label>
                    <div className="profile-input-wrapper">
                      <input
                        id="profile-email"
                        type="email"
                        required
                        autoComplete="email"
                        value={profileForm.email}
                        onChange={(e) => {
                          setProfileForm({ ...profileForm, email: e.target.value });
                          if (fieldErrors.email) setFieldErrors({ ...fieldErrors, email: "" });
                        }}
                        className={`profile-input ${fieldErrors.email ? "is-invalid" : ""}`}
                        placeholder="e.g. juan@evacway.local"
                      />
                    </div>
                    {fieldErrors.email && (
                      <p className="profile-field-error" role="alert">
                        {fieldErrors.email}
                      </p>
                    )}
                  </div>

                  <div className="profile-input-group">
                    <label htmlFor="profile-contact">Contact Number</label>
                    <div className="profile-input-wrapper">
                      <input
                        id="profile-contact"
                        type="tel"
                        autoComplete="tel"
                        maxLength={20}
                        value={profileForm.contact_number}
                        onChange={(e) => {
                          setProfileForm({ ...profileForm, contact_number: sanitizePhoneInput(e.target.value) });
                          if (fieldErrors.contact_number)
                            setFieldErrors({ ...fieldErrors, contact_number: "" });
                        }}
                        className={`profile-input ${fieldErrors.contact_number ? "is-invalid" : ""}`}
                        placeholder="e.g. 0912 345 6789"
                      />
                    </div>
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
                    className="profile-btn profile-btn-primary"
                  >
                    {profileSaving ? "Saving changes..." : "Save Changes"}
                  </button>
                </div>
              </form>
            )}
          </section>

          {/* 2. ACCOUNT DETAILS SECTION (READ-ONLY) */}
          <section className="profile-card ds-card" aria-labelledby="account-details-heading">
            <div className="profile-card-header">
              <div>
                <h2 id="account-details-heading" className="profile-card-title">
                  Account Details
                </h2>
                <p className="profile-card-desc">
                  Security permissions and authentication status associated with your account.
                </p>
              </div>
            </div>

            <div className="profile-fields-grid">
              <div className="profile-field-item">
                <span className="profile-field-label">Assigned Role</span>
                <p className="profile-field-value font-semibold">
                  {isAdmin ? "Administrator (Full System Access)" : "LGU Operations Personnel"}
                </p>
              </div>

              <div className="profile-field-item">
                <span className="profile-field-label">Account Status</span>
                <div className="profile-status-wrap">
                  <span className="profile-status-pill is-active">
                    <FontAwesomeIcon icon={faCircleCheck} />
                    <span>Active Account</span>
                  </span>
                </div>
              </div>

              <div className="profile-field-item">
                <span className="profile-field-label">Member Since</span>
                <p className="profile-field-value flex items-center gap-2">
                  <FontAwesomeIcon icon={faCalendarDays} className="text-slate-400" />
                  <span>{memberSinceFormatted}</span>
                </p>
              </div>
            </div>
          </section>

          {/* 3. TWO-FACTOR AUTHENTICATION (2FA) SECTION */}
          <section className="profile-card ds-card" aria-labelledby="mfa-heading">
            <div className="profile-card-header">
              <div>
                <h2 id="mfa-heading" className="profile-card-title">
                  Two-Factor Authentication (2FA)
                </h2>
                <p className="profile-card-desc">
                  Add an extra layer of sign-in security with a one-time 6-digit verification code sent to your email.
                </p>
              </div>
              <span
                className={`profile-status-pill ${mfaEnabled ? "is-active" : "is-inactive"}`}
              >
                <FontAwesomeIcon icon={mfaEnabled ? faCircleCheck : faShieldHalved} />
                <span>
                  {mfaRequiredByPolicy
                    ? "Required & Active"
                    : mfaEnabled
                    ? "Enabled"
                    : "Disabled"}
                </span>
              </span>
            </div>

            {mfaSuccessMsg && !mfaEnableModalOpen && !mfaDisableModalOpen && (
              <div className="profile-alert is-success ds-banner ds-banner--success" role="status">
                <FontAwesomeIcon icon={faCircleCheck} />
                <span>{mfaSuccessMsg}</span>
              </div>
            )}

            {mfaErrorMsg && !mfaEnableModalOpen && !mfaDisableModalOpen && (
              <div className="profile-alert is-error ds-banner ds-banner--danger" role="alert">
                <FontAwesomeIcon icon={faTriangleExclamation} />
                <span>{mfaErrorMsg}</span>
              </div>
            )}

            <div className="profile-mfa-summary">
              <div className="profile-mfa-meta">
                <p className="profile-mfa-meta-title">
                  Email verification code (OTP)
                </p>
                <p className="profile-mfa-meta-desc">
                  {mfaEmailDeliverable ? (
                    <>
                      Verification codes are sent to <strong>{mfaDeliveryEmail}</strong>.
                    </>
                  ) : (
                    <>
                      Your current address (<strong>{user?.email || "—"}</strong>) cannot receive external email codes. Update your email in Personal Information to a working address (e.g. Gmail) first.
                    </>
                  )}
                </p>
              </div>

              {!mfaRequiredByPolicy && !mfaEnabled && (
                <button
                  type="button"
                  onClick={handleSendMfaEnableCode}
                  disabled={mfaSending || !mfaEmailDeliverable}
                  className="profile-btn profile-btn-primary ds-btn ds-btn--primary"
                >
                  <FontAwesomeIcon icon={faPaperPlane} />
                  <span>
                    {mfaSending ? "Sending test code..." : "Test Email & Enable 2FA"}
                  </span>
                </button>
              )}

              {!mfaRequiredByPolicy && mfaEnabled && (
                <button
                  type="button"
                  onClick={() => {
                    setMfaErrorMsg("");
                    setMfaSuccessMsg("");
                    setMfaDisablePassword("");
                    setMfaShowDisableForm(true);
                  }}
                  className="profile-btn profile-btn-danger-outline"
                >
                  <FontAwesomeIcon icon={faXmark} />
                  <span>Disable 2FA</span>
                </button>
              )}
            </div>

            {mfaRequiredByPolicy && (
              <p className="profile-mfa-panel-desc" style={{ marginTop: "12px" }}>
                Two-factor authentication is enforced by system policy for {isAdmin ? "Administrator" : "LGU"} accounts and cannot be turned off.
              </p>
            )}
          </section>

          {/* ENABLE 2FA OTP CONFIRMATION MODAL */}
          {mfaEnableModalOpen &&
            createPortal(
              <div
                className="profile-modal-backdrop"
                role="presentation"
                onClick={() => {
                  if (!mfaConfirming) handleCancelMfaEnable();
                }}
              >
                <div
                  className="profile-modal"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="mfa-enable-modal-title"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="profile-modal-header">
                    <div className="profile-modal-title-group">
                      <span className="profile-modal-icon is-brand" aria-hidden="true">
                        <FontAwesomeIcon icon={faShieldHalved} />
                      </span>
                      <div>
                        <h3 id="mfa-enable-modal-title" className="profile-modal-title">
                          Confirm your email works
                        </h3>
                        <p className="profile-modal-subtitle">
                          Two-Factor Authentication (2FA)
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="profile-modal-close"
                      onClick={handleCancelMfaEnable}
                      disabled={mfaConfirming}
                      aria-label="Close modal"
                    >
                      <FontAwesomeIcon icon={faXmark} />
                    </button>
                  </div>

                  <form onSubmit={handleConfirmMfaEnable} className="profile-modal-body">
                    <p className="profile-modal-desc">
                      We sent a 6-digit test verification code to{" "}
                      <strong>{mfaMaskedEmail || mfaDeliveryEmail}</strong>. Enter it below to verify email delivery and activate 2FA on your account.
                    </p>

                    {mfaSuccessMsg && (
                      <div className="profile-alert is-success ds-banner ds-banner--success" role="status">
                        <FontAwesomeIcon icon={faCircleCheck} />
                        <span>{mfaSuccessMsg}</span>
                      </div>
                    )}

                    {mfaErrorMsg && (
                      <div className="profile-alert is-error ds-banner ds-banner--danger" role="alert">
                        <FontAwesomeIcon icon={faTriangleExclamation} />
                        <span>{mfaErrorMsg}</span>
                      </div>
                    )}

                    <div className="profile-input-group">
                      <label htmlFor="profile-mfa-otp">6-Digit Verification Code</label>
                      <input
                        id="profile-mfa-otp"
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        autoFocus
                        maxLength={6}
                        required
                        value={mfaOtpCode}
                        onChange={(e) =>
                          setMfaOtpCode(e.target.value.replace(/[^\d]/g, "").slice(0, 6))
                        }
                        className="profile-input profile-mfa-otp-input is-modal"
                        placeholder="000000"
                      />
                    </div>

                    <div className="profile-modal-resend-row">
                      <span className="profile-modal-resend-hint">Didn&apos;t receive the code?</span>
                      <button
                        type="button"
                        onClick={handleSendMfaEnableCode}
                        disabled={mfaSending || mfaResendCooldown > 0}
                        className="profile-modal-resend-btn"
                      >
                        {mfaSending
                          ? "Sending..."
                          : mfaResendCooldown > 0
                          ? `Resend in ${mfaResendCooldown}s`
                          : "Resend code"}
                      </button>
                    </div>

                    <div className="profile-modal-footer">
                      <button
                        type="button"
                        onClick={handleCancelMfaEnable}
                        disabled={mfaConfirming}
                        className="profile-btn profile-btn-secondary"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={mfaConfirming || mfaOtpCode.length !== 6}
                        className="profile-btn profile-btn-primary"
                      >
                        <FontAwesomeIcon icon={faCheck} />
                        <span>{mfaConfirming ? "Confirming..." : "Confirm & Enable 2FA"}</span>
                      </button>
                    </div>
                  </form>
                </div>
              </div>,
              document.body
            )}

          {/* DISABLE 2FA CONFIRMATION MODAL */}
          {mfaDisableModalOpen &&
            createPortal(
              <div
                className="profile-modal-backdrop"
                role="presentation"
                onClick={() => {
                  if (!mfaDisabling) {
                    setMfaShowDisableForm(false);
                    setMfaDisablePassword("");
                    setMfaErrorMsg("");
                  }
                }}
              >
                <div
                  className="profile-modal"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="mfa-disable-modal-title"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="profile-modal-header">
                    <div className="profile-modal-title-group">
                      <span className="profile-modal-icon is-danger" aria-hidden="true">
                        <FontAwesomeIcon icon={faTriangleExclamation} />
                      </span>
                      <div>
                        <h3 id="mfa-disable-modal-title" className="profile-modal-title">
                          Disable two-factor authentication?
                        </h3>
                        <p className="profile-modal-subtitle">
                          Confirm with your password
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="profile-modal-close"
                      onClick={() => {
                        setMfaShowDisableForm(false);
                        setMfaDisablePassword("");
                        setMfaErrorMsg("");
                      }}
                      disabled={mfaDisabling}
                      aria-label="Close modal"
                    >
                      <FontAwesomeIcon icon={faXmark} />
                    </button>
                  </div>

                  <form onSubmit={handleDisableMfa} className="profile-modal-body">
                    <p className="profile-modal-desc">
                      Your account will only require your email and password at sign in. Enter your current password to confirm disabling 2FA.
                    </p>

                    {mfaErrorMsg && (
                      <div className="profile-alert is-error ds-banner ds-banner--danger" role="alert">
                        <FontAwesomeIcon icon={faTriangleExclamation} />
                        <span>{mfaErrorMsg}</span>
                      </div>
                    )}

                    <div className="profile-input-group">
                      <label htmlFor="mfa-disable-password">Current Password</label>
                      <div className="profile-password-input-wrap">
                        <input
                          id="mfa-disable-password"
                          type={mfaShowDisablePassword ? "text" : "password"}
                          autoComplete="current-password"
                          autoFocus
                          required
                          value={mfaDisablePassword}
                          onChange={(e) => setMfaDisablePassword(e.target.value)}
                          className="profile-input"
                          placeholder="Enter current password"
                        />
                        <button
                          type="button"
                          className="profile-password-toggle"
                          onClick={() => setMfaShowDisablePassword((prev) => !prev)}
                          aria-label={mfaShowDisablePassword ? "Hide password" : "Show password"}
                        >
                          <FontAwesomeIcon icon={mfaShowDisablePassword ? faEyeSlash : faEye} />
                        </button>
                      </div>
                    </div>

                    <div className="profile-modal-footer">
                      <button
                        type="button"
                        onClick={() => {
                          setMfaShowDisableForm(false);
                          setMfaDisablePassword("");
                          setMfaErrorMsg("");
                        }}
                        disabled={mfaDisabling}
                        className="profile-btn profile-btn-secondary"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={mfaDisabling || !mfaDisablePassword}
                        className="profile-btn profile-btn-danger"
                      >
                        <span>{mfaDisabling ? "Disabling..." : "Confirm Disable 2FA"}</span>
                      </button>
                    </div>
                  </form>
                </div>
              </div>,
              document.body
            )}

          {/* 4. PASSWORD & SECURITY SECTION */}
          <section className="profile-card ds-card" aria-labelledby="password-heading">
            <div className="profile-card-header">
              <div>
                <h2 id="password-heading" className="profile-card-title">
                  Password &amp; Security
                </h2>
                <p className="profile-card-desc">
                  Change your operational password or request an email reset link.
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
                {/* Current Password */}
                <div className="profile-input-group">
                  <label htmlFor="current-password">Current Password</label>
                  <div className="profile-password-input-wrap">
                    <input
                      id="current-password"
                      type={showCurrent ? "text" : "password"}
                      autoComplete="current-password"
                      required
                      value={passwordForm.current}
                      onChange={(e) => setPasswordForm({ ...passwordForm, current: e.target.value })}
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

                {/* New Password */}
                <div className="profile-input-group">
                  <label htmlFor="new-password">New Password</label>
                  <div className="profile-password-input-wrap">
                    <input
                      id="new-password"
                      type={showNext ? "text" : "password"}
                      autoComplete="new-password"
                      required
                      minLength={8}
                      value={passwordForm.next}
                      onChange={(e) => setPasswordForm({ ...passwordForm, next: e.target.value })}
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

                {/* Confirm Password */}
                <div className="profile-input-group">
                  <label htmlFor="confirm-password">Confirm New Password</label>
                  <div className="profile-password-input-wrap">
                    <input
                      id="confirm-password"
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

              {/* Password Requirements Live Checklist */}
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

            {/* REQUEST PASSWORD RESET CALLOUT */}
            <div className="profile-reset-card">
              <div className="profile-reset-info">
                <h3 className="profile-reset-title">Forgot your current password?</h3>
                <p className="profile-reset-desc">
                  You can send a secure reset link directly to your email address (
                  <strong>{user?.email}</strong>) to regain access.
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

import { useCallback, useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheck,
  faCircleNotch,
  faEnvelope,
  faEye,
  faEyeSlash,
  faIdCard,
  faKey,
  faMagnifyingGlass,
  faShieldHalved,
  faTriangleExclamation,
  faUserPlus,
  faWandMagicSparkles,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../../services/api";

function generateSecurePassword() {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let pwd = "Evac!";
  for (let i = 0; i < 6; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pwd;
}

function formatDate(val) {
  if (!val) return "Not provided";
  const parsed = new Date(`${val}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? val
    : new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(parsed);
}

export default function CreateResidentAccountModal({
  isOpen,
  onClose,
  onSuccess,
}) {
  const [mode, setMode] = useState("link"); // "link" | "new"
  const [barangays, setBarangays] = useState([]);

  // Link Mode State
  const [rosterQuery, setRosterQuery] = useState("");
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterResults, setRosterResults] = useState([]);
  const [selectedRosterResident, setSelectedRosterResident] = useState(null);

  // New Mode State
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [suffix, setSuffix] = useState("");
  const [barangayId, setBarangayId] = useState("");
  const [address, setAddress] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [birthdate, setBirthdate] = useState("");

  // Credentials State
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [sendEmail, setSendEmail] = useState(true);

  // Status
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const modalRef = useRef(null);

  // Load barangays once
  useEffect(() => {
    let active = true;
    api
      .getBarangays()
      .then((data) => {
        if (!active) return;
        const list = Array.isArray(data) ? data : data.barangays || [];
        setBarangays(list);
        if (list.length > 0 && !barangayId) {
          setBarangayId(String(list[0].id));
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Reset or preset on open
  useEffect(() => {
    if (isOpen) {
      setMode("link");
      setRosterQuery("");
      setRosterResults([]);
      setSelectedRosterResident(null);
      setFirstName("");
      setMiddleName("");
      setLastName("");
      setSuffix("");
      setAddress("");
      setContactNumber("");
      setBirthdate("");
      setEmail("");
      setPassword(generateSecurePassword());
      setShowPassword(false);
      setSendEmail(true);
      setFormError("");
    }
  }, [isOpen]);

  // Debounced search for roster residents
  const handleRosterSearch = useCallback(
    async (query) => {
      const q = query.trim().toLowerCase();
      if (q.length < 2) {
        setRosterResults([]);
        return;
      }
      setRosterLoading(true);
      try {
        const [suggestions, allResidents] = await Promise.all([
          api.autosuggestResidents(q).catch(() => ({ suggestions: [] })),
          api.getResidents().catch(() => []),
        ]);

        const rawList = Array.isArray(allResidents) ? allResidents : [];
        const filtered = rawList.filter((res) => {
          const fullName = [res.first_name, res.middle_name, res.last_name]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          const brgy = (res.barangay?.name || res.barangay || "").toLowerCase();
          return fullName.includes(q) || brgy.includes(q);
        });

        // Deduplicate and prioritize unlinked residents
        const mapped = filtered.slice(0, 8).map((r) => ({
          id: r.id,
          first_name: r.first_name,
          middle_name: r.middle_name,
          last_name: r.last_name,
          full_name:
            r.full_name ||
            [r.first_name, r.middle_name, r.last_name].filter(Boolean).join(" "),
          barangay: r.barangay?.name || r.barangay || "N/A",
          barangay_id: r.barangay_id || r.barangay?.id,
          address: r.address || "",
          contact_number: r.contact_number || r.alternate_contact || "",
          birthdate: r.date_of_birth || r.birthdate || "",
          already_linked: Boolean(r.has_account || r.already_linked),
        }));

        setRosterResults(mapped);
      } catch (err) {
        console.error("Failed to search roster residents:", err);
      } finally {
        setRosterLoading(false);
      }
    },
    []
  );

  function onSelectRosterResident(res) {
    if (res.already_linked) return;
    setSelectedRosterResident(res);
    setFormError("");
    // If resident has a contact or email prefill where applicable
    if (res.contact_number) setContactNumber(res.contact_number);
  }

  function handleAutoGeneratePassword() {
    setPassword(generateSecurePassword());
    setShowPassword(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setFormError("");

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      setFormError("Please enter a valid email address.");
      return;
    }
    if (!password || password.length < 6) {
      setFormError("Password must be at least 6 characters.");
      return;
    }

    let payload = {
      email: cleanEmail,
      password: password,
      send_email: sendEmail,
    };

    if (mode === "link") {
      if (!selectedRosterResident) {
        setFormError("Please search and select a resident from the roster.");
        return;
      }
      payload.resident_id = selectedRosterResident.id;
    } else {
      if (!firstName.trim() || !lastName.trim()) {
        setFormError("First name and last name are required.");
        return;
      }
      if (!birthdate) {
        setFormError("Please provide the resident's date of birth.");
        return;
      }
      payload.first_name = firstName.trim();
      payload.middle_name = middleName.trim();
      payload.last_name = lastName.trim();
      payload.suffix = suffix.trim();
      payload.barangay_id = barangayId;
      payload.address = address.trim();
      payload.contact_number = contactNumber.trim();
      payload.birthdate = birthdate;
    }

    setSubmitting(true);
    try {
      const res = await api.createResidentAccount(payload);
      onSuccess?.({
        message:
          res.message ||
          `Resident account created successfully for ${
            mode === "link"
              ? selectedRosterResident.full_name
              : `${firstName} ${lastName}`
          }!`,
        email_sent: res.email_sent,
      });
      onClose();
    } catch (err) {
      setFormError(
        err.message ||
          "Failed to create resident account. Please check the details and try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div
      className="resident-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-resident-account-title"
    >
      <div className="resident-modal-dialog" ref={modalRef}>
        {/* Header */}
        <header className="resident-modal-header">
          <div className="resident-modal-title-group">
            <div className="resident-modal-icon-badge">
              <FontAwesomeIcon icon={faUserPlus} />
            </div>
            <div>
              <h2 id="create-resident-account-title" className="resident-modal-title">
                Create Resident Account
              </h2>
              <p className="resident-modal-subtitle">
                Manually provision portal access and credentials for a community member.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="resident-modal-close-btn"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close modal"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </header>

        {/* Mode Switcher */}
        <div className="resident-mode-selector" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "link"}
            className={`resident-mode-btn ${mode === "link" ? "is-active" : ""}`}
            onClick={() => {
              setMode("link");
              setFormError("");
            }}
          >
            <FontAwesomeIcon icon={faIdCard} />
            <span>Link Existing Resident</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "new"}
            className={`resident-mode-btn ${mode === "new" ? "is-active" : ""}`}
            onClick={() => {
              setMode("new");
              setFormError("");
            }}
          >
            <FontAwesomeIcon icon={faUserPlus} />
            <span>Register New Resident</span>
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="resident-modal-form">
          {formError && (
            <div className="resident-form-alert is-error" role="alert">
              <FontAwesomeIcon icon={faTriangleExclamation} />
              <span>{formError}</span>
            </div>
          )}

          {/* Mode 1: Link Existing Roster Resident */}
          {mode === "link" && (
            <div className="resident-form-section">
              <label className="resident-form-label" htmlFor="roster-search-input">
                Find resident in official roster <span>*</span>
              </label>

              {!selectedRosterResident ? (
                <div className="resident-roster-search-box">
                  <div className="resident-search-input-wrap">
                    <FontAwesomeIcon
                      icon={rosterLoading ? faCircleNotch : faMagnifyingGlass}
                      spin={rosterLoading}
                      className="resident-search-icon"
                    />
                    <input
                      id="roster-search-input"
                      type="text"
                      className="resident-input"
                      value={rosterQuery}
                      onChange={(e) => {
                        setRosterQuery(e.target.value);
                        handleRosterSearch(e.target.value);
                      }}
                      placeholder="Type resident name or barangay (e.g. Maria Santos)..."
                      autoFocus
                    />
                    {rosterQuery && (
                      <button
                        type="button"
                        className="resident-search-clear"
                        onClick={() => {
                          setRosterQuery("");
                          setRosterResults([]);
                        }}
                      >
                        <FontAwesomeIcon icon={faXmark} />
                      </button>
                    )}
                  </div>

                  {rosterResults.length > 0 && (
                    <div className="resident-search-results-dropdown" role="listbox">
                      {rosterResults.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={`resident-result-item ${
                            item.already_linked ? "is-disabled" : ""
                          }`}
                          onClick={() => onSelectRosterResident(item)}
                          disabled={item.already_linked}
                        >
                          <div className="resident-result-avatar">
                            {item.first_name?.[0]}
                            {item.last_name?.[0]}
                          </div>
                          <div className="resident-result-info">
                            <span className="resident-result-name">{item.full_name}</span>
                            <span className="resident-result-meta">
                              {item.barangay} · {formatDate(item.birthdate)}
                              {item.contact_number ? ` · ${item.contact_number}` : ""}
                            </span>
                          </div>
                          {item.already_linked ? (
                            <span className="resident-result-tag is-linked">
                              Has Account
                            </span>
                          ) : (
                            <span className="resident-result-tag is-select">
                              Select
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}

                  {rosterQuery.trim().length >= 2 &&
                    !rosterLoading &&
                    rosterResults.length === 0 && (
                      <p className="resident-search-empty-hint">
                        No unlinked resident found matching "{rosterQuery}". You can switch to
                        "Register New Resident" above if they are not yet in the system.
                      </p>
                    )}
                </div>
              ) : (
                /* Selected resident preview card */
                <div className="resident-selected-card">
                  <div className="resident-selected-left">
                    <div className="resident-selected-avatar">
                      <FontAwesomeIcon icon={faIdCard} />
                    </div>
                    <div>
                      <strong className="resident-selected-name">
                        {selectedRosterResident.full_name}
                      </strong>
                      <span className="resident-selected-sub">
                        {selectedRosterResident.barangay} · Born:{" "}
                        {formatDate(selectedRosterResident.birthdate)}
                      </span>
                      {selectedRosterResident.contact_number && (
                        <span className="resident-selected-contact">
                          Contact: {selectedRosterResident.contact_number}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="resident-change-btn"
                    onClick={() => {
                      setSelectedRosterResident(null);
                      setRosterQuery("");
                    }}
                  >
                    Change
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Mode 2: Register New Resident & Account */}
          {mode === "new" && (
            <div className="resident-form-section">
              <div className="resident-form-grid-2">
                <div>
                  <label className="resident-form-label" htmlFor="first-name-input">
                    First Name <span>*</span>
                  </label>
                  <input
                    id="first-name-input"
                    type="text"
                    className="resident-input"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="e.g. Maria"
                    required
                  />
                </div>
                <div>
                  <label className="resident-form-label" htmlFor="middle-name-input">
                    Middle Name <small>(Optional)</small>
                  </label>
                  <input
                    id="middle-name-input"
                    type="text"
                    className="resident-input"
                    value={middleName}
                    onChange={(e) => setMiddleName(e.target.value)}
                    placeholder="e.g. Dela"
                  />
                </div>
              </div>

              <div className="resident-form-grid-2" style={{ marginTop: "12px" }}>
                <div>
                  <label className="resident-form-label" htmlFor="last-name-input">
                    Last Name <span>*</span>
                  </label>
                  <input
                    id="last-name-input"
                    type="text"
                    className="resident-input"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="e.g. Cruz"
                    required
                  />
                </div>
                <div>
                  <label className="resident-form-label" htmlFor="suffix-input">
                    Suffix <small>(Optional)</small>
                  </label>
                  <input
                    id="suffix-input"
                    type="text"
                    className="resident-input"
                    value={suffix}
                    onChange={(e) => setSuffix(e.target.value)}
                    placeholder="e.g. Jr., III"
                  />
                </div>
              </div>

              <div className="resident-form-grid-2" style={{ marginTop: "12px" }}>
                <div>
                  <label className="resident-form-label" htmlFor="barangay-select">
                    Barangay <span>*</span>
                  </label>
                  <select
                    id="barangay-select"
                    className="resident-input resident-select"
                    value={barangayId}
                    onChange={(e) => setBarangayId(e.target.value)}
                    required
                  >
                    {barangays.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="resident-form-label" htmlFor="birthdate-input">
                    Date of Birth <span>*</span>
                  </label>
                  <input
                    id="birthdate-input"
                    type="date"
                    className="resident-input"
                    value={birthdate}
                    onChange={(e) => setBirthdate(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="resident-form-grid-2" style={{ marginTop: "12px" }}>
                <div>
                  <label className="resident-form-label" htmlFor="address-input">
                    Address / Purok
                  </label>
                  <input
                    id="address-input"
                    type="text"
                    className="resident-input"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="e.g. Purok 4, Riverside"
                  />
                </div>
                <div>
                  <label className="resident-form-label" htmlFor="contact-input">
                    Contact Number
                  </label>
                  <input
                    id="contact-input"
                    type="tel"
                    className="resident-input"
                    value={contactNumber}
                    onChange={(e) => setContactNumber(e.target.value)}
                    placeholder="e.g. 0917-123-4567"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Account Credentials Section (Common to both modes) */}
          <div className="resident-credentials-section">
            <div className="resident-section-title">
              <FontAwesomeIcon icon={faShieldHalved} />
              <span>Portal Login Credentials</span>
            </div>

            <div className="resident-form-group">
              <label className="resident-form-label" htmlFor="account-email-input">
                Login Email Address <span>*</span>
              </label>
              <div className="resident-input-icon-wrap">
                <FontAwesomeIcon icon={faEnvelope} className="resident-field-icon" />
                <input
                  id="account-email-input"
                  type="email"
                  className="resident-input with-left-icon"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="resident.email@example.com"
                  required
                />
              </div>
            </div>

            <div className="resident-form-group" style={{ marginTop: "12px" }}>
              <div className="resident-label-row">
                <label className="resident-form-label" htmlFor="account-password-input">
                  Initial Password <span>*</span>
                </label>
                <button
                  type="button"
                  className="resident-generate-pwd-btn"
                  onClick={handleAutoGeneratePassword}
                  title="Generate a secure temporary password"
                >
                  <FontAwesomeIcon icon={faWandMagicSparkles} />
                  <span>Auto-generate</span>
                </button>
              </div>
              <div className="resident-input-icon-wrap">
                <FontAwesomeIcon icon={faKey} className="resident-field-icon" />
                <input
                  id="account-password-input"
                  type={showPassword ? "text" : "password"}
                  className="resident-input with-left-icon with-right-btn"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  required
                />
                <button
                  type="button"
                  className="resident-pwd-toggle-btn"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  <FontAwesomeIcon icon={showPassword ? faEyeSlash : faEye} />
                </button>
              </div>
              <small className="resident-field-hint">
                The resident can change this password after logging into their portal.
              </small>
            </div>

            {/* Send email toggle */}
            <label className="resident-checkbox-label">
              <input
                type="checkbox"
                checked={sendEmail}
                onChange={(e) => setSendEmail(e.target.checked)}
              />
              <span className="resident-checkbox-custom"></span>
              <span className="resident-checkbox-text">
                Send welcome email with portal link and login credentials
              </span>
            </label>
          </div>

          {/* Footer Actions */}
          <footer className="resident-modal-footer">
            <button
              type="button"
              className="resident-action-secondary"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="resident-action-primary"
              disabled={
                submitting ||
                (mode === "link" && !selectedRosterResident) ||
                (mode === "new" && (!firstName.trim() || !lastName.trim() || !birthdate)) ||
                !email.trim() ||
                !password.trim()
              }
            >
              {submitting ? (
                <>
                  <FontAwesomeIcon icon={faCircleNotch} spin />
                  <span>Creating Account…</span>
                </>
              ) : (
                <>
                  <FontAwesomeIcon icon={faCheck} />
                  <span>Create Account</span>
                </>
              )}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}


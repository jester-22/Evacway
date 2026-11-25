import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Ban,
  Check,
  KeyRound,
  Mail,
  MoreVertical,
  Pencil,
  Phone,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  UserCheck,
  Users,
  UserX,
  X,
} from "lucide-react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faXmark,
  faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { queryKeys, useUsers } from "../../hooks/useEvacuationQueries";
import { appAlert, appConfirm } from "../../utils/appDialog";
import {
  sanitizeNameInput,
  sanitizePhoneInput,
  validateContactNumber,
  validateEmail,
  validatePersonName,
} from "../../utils/formValidation";
import { Button, RoleChip, StatCard, StatusPill, MobileFilterButton } from "../ui";
import AdminMfaRecoveryApprovals from "./AdminMfaRecoveryApprovals";
import "./UserManagement.css";

function initials(name = "") {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?"
  );
}

function getEditErrorField(message) {
  if (!message) return null;
  const lower = String(message).toLowerCase();
  if (lower.includes("email")) return "email";
  if (lower.includes("role")) return "role";
  if (lower.includes("contact") || lower.includes("phone")) return "contact_number";
  if (lower.includes("name")) return "name";
  return null;
}

function UserManagement() {
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const usersQuery = useUsers();
  const users = useMemo(() => usersQuery.data || [], [usersQuery.data]);

  // Search input state; role and status filters live in the URL query string
  const [searchQuery, setSearchQuery] = useState("");
  const rawRoleParam = searchParams.get("role") || "";
  const roleFilter =
    rawRoleParam === "admin" || rawRoleParam === "lgu_personnel" ? rawRoleParam : "";
  const rawStatusParam = searchParams.get("status") || "";
  const statusFilter =
    rawStatusParam === "active" || rawStatusParam === "inactive" ? rawStatusParam : "";

  const updateFilterParams = useCallback(
    ({ role, status }) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (role !== undefined) {
            if (role) next.set("role", role);
            else next.delete("role");
          }
          if (status !== undefined) {
            if (status) next.set("status", status);
            else next.delete("status");
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  // Dropdown action menu state ({ userId, top, bottom, right, openAbove } | null)
  const [openActionMenu, setOpenActionMenu] = useState(null);

  // Modal states
  const [showForm, setShowForm] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [modalMode, setModalMode] = useState("overview"); // "overview" | "edit"
  const [deactivatingUser, setDeactivatingUser] = useState(null);

  // Form states
  const [form, setForm] = useState({
    name: "",
    email: "",
    contact_number: "",
    role: "lgu_personnel",
  });
  const [editForm, setEditForm] = useState({
    name: "",
    email: "",
    contact_number: "",
    role: "lgu_personnel",
  });

  // Action / error states
  const [actionError, setActionError] = useState("");
  const [formError, setFormError] = useState("");
  const [editError, setEditError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [emailAvailable, setEmailAvailable] = useState(null);
  const [emailChecking, setEmailChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingUser, setSavingUser] = useState(false);
  const [togglingId, setTogglingId] = useState(null);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [resetError, setResetError] = useState("");
  const [resetErrorUserId, setResetErrorUserId] = useState(null);
  const [resetCooldown, setResetCooldown] = useState(0);
  const [resetSuccess, setResetSuccess] = useState(null);
  const resetRequestRef = useRef({ sending: false, nextAllowedAt: 0 });
  const detailsModalRef = useRef(null);
  const previouslyFocusedRef = useRef(null);

  useEffect(() => {
    if (resetCooldown <= 0) return undefined;

    const timer = window.setInterval(() => {
      setResetCooldown((current) => Math.max(0, current - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [resetCooldown]);

  function invalidateUsersAndLogs() {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.users }),
      queryClient.invalidateQueries({ queryKey: queryKeys.logs }),
    ]);
  }

  // Count active administrators to protect the last active admin
  const activeAdminCount = useMemo(
    () => users.filter((u) => u.role === "admin" && u.is_active).length,
    [users]
  );

  // Stat calculations
  const totalCount = users.length;
  const activeCount = users.filter((u) => u.is_active).length;
  const inactiveCount = users.filter((u) => !u.is_active).length;
  const adminCount = users.filter((u) => u.role === "admin").length;

  const selectedStatCard = useMemo(() => {
    if (!roleFilter && !statusFilter) {
      return "total";
    }
    if (statusFilter === "active" && !roleFilter) {
      return "active";
    }
    if (statusFilter === "inactive" && !roleFilter) {
      return "inactive";
    }
    if (roleFilter === "admin" && !statusFilter) {
      return "admins";
    }
    return null;
  }, [roleFilter, statusFilter]);

  // Stat card clicking logic (URL-backed: clicking selected card again clears it)
  function handleStatCardClick(cardKey) {
    if (cardKey === "total") {
      updateFilterParams({ role: "", status: "" });
      return;
    }

    if (selectedStatCard === cardKey) {
      updateFilterParams({ role: "", status: "" });
      return;
    }

    if (cardKey === "active") {
      updateFilterParams({ role: "", status: "active" });
    } else if (cardKey === "inactive") {
      updateFilterParams({ role: "", status: "inactive" });
    } else if (cardKey === "admins") {
      updateFilterParams({ role: "admin", status: "" });
    }
  }

  function clearAllFilters() {
    setSearchQuery("");
    updateFilterParams({ role: "", status: "" });
  }

  // Filtered users list
  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return users.filter((u) => {
      // Role filter
      if (roleFilter && u.role !== roleFilter) {
        return false;
      }

      // Status filter
      if (statusFilter === "active" && !u.is_active) {
        return false;
      }
      if (statusFilter === "inactive" && u.is_active) {
        return false;
      }

      // Search filter (name, email, phone)
      if (q) {
        const nameMatch = (u.name || "").toLowerCase().includes(q);
        const emailMatch = (u.email || "").toLowerCase().includes(q);
        const phoneMatch = (u.contact_number || "").toLowerCase().includes(q);
        if (!nameMatch && !emailMatch && !phoneMatch) {
          return false;
        }
      }

      return true;
    });
  }, [users, roleFilter, statusFilter, searchQuery]);

  // Click outside / scroll / resize listener for the row action menu
  useEffect(() => {
    if (!openActionMenu) return undefined;
    function handleClickOutside(e) {
      if (
        !e.target.closest(".um-action-cell") &&
        !e.target.closest("[data-um-menu='true']")
      ) {
        setOpenActionMenu(null);
      }
    }
    function handleCloseOnViewportChange() {
      setOpenActionMenu(null);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    window.addEventListener("scroll", handleCloseOnViewportChange, true);
    window.addEventListener("resize", handleCloseOnViewportChange);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
      window.removeEventListener("scroll", handleCloseOnViewportChange, true);
      window.removeEventListener("resize", handleCloseOnViewportChange);
    };
  }, [openActionMenu]);

  const closeModal = useCallback(() => {
    setShowForm(false);
    setFormError("");
    setEmailError("");
    setEmailAvailable(null);
  }, []);

  const closeUserModal = useCallback(() => {
    setSelectedUser(null);
    setModalMode("overview");
    setEditError("");
    setResetError("");
    setResetErrorUserId(null);
    setResetSuccess(null);
    const trigger = previouslyFocusedRef.current;
    previouslyFocusedRef.current = null;
    if (trigger && typeof trigger.focus === "function") {
      window.requestAnimationFrame(() => trigger.focus());
    }
  }, []);

  // Focus trap for the Account profile / Edit account dialog
  useEffect(() => {
    if (!selectedUser) return undefined;
    previouslyFocusedRef.current =
      previouslyFocusedRef.current || document.activeElement;

    const dialogEl = detailsModalRef.current;
    const focusableSelector =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    if (dialogEl && !dialogEl.contains(document.activeElement)) {
      const firstFocusable = dialogEl.querySelector(focusableSelector);
      if (firstFocusable) {
        firstFocusable.focus();
      } else {
        dialogEl.focus();
      }
    }

    function handleTrapTab(e) {
      if (e.key !== "Tab" || !detailsModalRef.current) return;
      const focusables = Array.from(
        detailsModalRef.current.querySelectorAll(focusableSelector)
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) {
        e.preventDefault();
        detailsModalRef.current.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first || !detailsModalRef.current.contains(document.activeElement)) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last || !detailsModalRef.current.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleTrapTab);
    return () => document.removeEventListener("keydown", handleTrapTab);
  }, [selectedUser, modalMode]);

  // Global escape key handler to close menus/modals
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "Escape") {
        if (openActionMenu) {
          setOpenActionMenu(null);
        } else if (deactivatingUser) {
          setDeactivatingUser(null);
        } else if (selectedUser) {
          closeUserModal();
        } else if (showForm) {
          closeModal();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openActionMenu, deactivatingUser, selectedUser, showForm, closeUserModal, closeModal]);

  function toggleRowActionMenu(userRecord, triggerEl) {
    setOpenActionMenu((prev) => {
      if (prev?.userId === userRecord.id) return null;
      const rect = triggerEl.getBoundingClientRect();
      const estimatedMenuHeight = 148;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const openAbove = spaceBelow < estimatedMenuHeight + 12 && spaceAbove > spaceBelow;
      return {
        userId: userRecord.id,
        right: Math.max(12, window.innerWidth - rect.right),
        top: openAbove ? null : rect.bottom + 4,
        bottom: openAbove ? window.innerHeight - rect.top + 4 : null,
        openAbove,
      };
    });
  }

  // Check if deactivation is disallowed
  function getDeactivateRestriction(targetUser) {
    if (currentUser && String(targetUser.id) === String(currentUser.id)) {
      return {
        isSelf: true,
        disabled: true,
        tooltip: "You cannot deactivate your own account",
      };
    }
    if (
      targetUser.role === "admin" &&
      targetUser.is_active &&
      activeAdminCount <= 1
    ) {
      return {
        isSelf: false,
        disabled: true,
        tooltip: "Cannot deactivate the last active administrator",
      };
    }
    return {
      isSelf: false,
      disabled: false,
      tooltip: "",
    };
  }

  async function confirmDeactivate() {
    if (!deactivatingUser) return;
    setTogglingId(deactivatingUser.id);
    setActionError("");
    try {
      await api.toggleUserActive(deactivatingUser.id);
      setDeactivatingUser(null);
      await invalidateUsersAndLogs();
    } catch (err) {
      setActionError(err?.message || String(err));
    } finally {
      setTogglingId(null);
    }
  }

  async function handleReactivate(targetUser) {
    setTogglingId(targetUser.id);
    setActionError("");
    try {
      await api.toggleUserActive(targetUser.id);
      await invalidateUsersAndLogs();
    } catch (err) {
      setActionError(err?.message || String(err));
    } finally {
      setTogglingId(null);
    }
  }

  async function checkEmailAvailability(value) {
    const email = value.trim().toLowerCase();
    if (!email) {
      setEmailError("");
      setEmailAvailable(null);
      return false;
    }

    setEmailChecking(true);
    try {
      const result = await api.checkUserEmailAvailability(email);
      const exists = Boolean(result.exists);
      setEmailAvailable(!exists);
      setEmailError(exists ? "This email is already registered." : "");
      return !exists;
    } catch (err) {
      setEmailAvailable(null);
      setEmailError(err?.message || String(err) || "Could not verify this email address.");
      return false;
    } finally {
      setEmailChecking(false);
    }
  }

  async function handleResetPassword(targetUser, skipConfirmation = false) {
    if (!targetUser || resetRequestRef.current.sending || Date.now() < resetRequestRef.current.nextAllowedAt) return;
    if (
      !skipConfirmation &&
      !(await appConfirm(`Send password reset email to ${targetUser.name}?`, {
        title: "Send Password Reset Email?",
        confirmText: "Send Email",
        tone: "info",
      }))
    ) {
      return;
    }

    resetRequestRef.current = { sending: true, nextAllowedAt: Date.now() + 5000 };
    setResetError("");
    setResetErrorUserId(null);
    setResetSuccess(null);
    setResettingPassword(true);
    setResetCooldown(5);
    try {
      const result = await api.resetUserPassword(targetUser.id);
      await invalidateUsersAndLogs();
      setResetSuccess({ userId: targetUser.id, message: result.message || `Password setup email sent to ${targetUser.email}.` });
    } catch (err) {
      const message = err?.message || String(err) || "Unable to reset password right now.";
      setResetError(message);
      setResetErrorUserId(targetUser.id);
    } finally {
      resetRequestRef.current.sending = false;
      setResettingPassword(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    setFormError("");
    const nameErr = validatePersonName(form.name, { label: "Full name", required: true, min: 2, max: 100 });
    if (nameErr) {
      setFormError(nameErr);
      return;
    }
    const emailErr = validateEmail(form.email, { label: "Email address", required: true });
    if (emailErr) {
      setFormError(emailErr);
      return;
    }
    const phoneErr = validateContactNumber(form.contact_number, { required: false, label: "Contact number" });
    if (phoneErr) {
      setFormError(phoneErr);
      return;
    }
    setSaving(true);
    try {
      const email = form.email.trim().toLowerCase();
      const isAvailable = await checkEmailAvailability(email);
      if (!isAvailable) {
        setFormError("Use an email address that is not already registered.");
        return;
      }

      const result = await api.createUser({
        ...form,
        name: form.name.trim(),
        email,
        contact_number: form.contact_number.trim() || null,
      });
      setForm({
        name: "",
        email: "",
        contact_number: "",
        role: "lgu_personnel",
      });
      setShowForm(false);
      await invalidateUsersAndLogs();
      await appAlert(result.message || `Account setup email sent to ${email}.`, {
        title: "Account Setup Email Sent",
        tone: "success",
      });
    } catch (err) {
      setFormError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  function openDetailsModal(user, mode = "overview") {
    setSelectedUser(user);
    setModalMode(mode);
    setEditForm({
      name: user.name || "",
      email: user.email || "",
      recovery_email: user.recovery_email || "",
      contact_number: user.contact_number || "",
      role: user.role || "lgu_personnel",
    });
    setEditError("");
    setResetError("");
    setResetErrorUserId(null);
    setResetSuccess(null);
  }

  async function handleUpdateUser(event) {
    event.preventDefault();
    if (!selectedUser) return;
    setEditError("");
    const nameErr = validatePersonName(editForm.name, { label: "Full name", required: true, min: 2, max: 100 });
    if (nameErr) {
      setEditError(nameErr);
      return;
    }
    const emailErr = validateEmail(editForm.email, { label: "Email address", required: true });
    if (emailErr) {
      setEditError(emailErr);
      return;
    }
    if ((editForm.recovery_email || "").trim()) {
      const recErr = validateEmail(editForm.recovery_email, { label: "Recovery email", required: false });
      if (recErr) {
        setEditError(recErr);
        return;
      }
    }
    const phoneErr = validateContactNumber(editForm.contact_number, { required: false, label: "Contact number" });
    if (phoneErr) {
      setEditError(phoneErr);
      return;
    }
    setSavingUser(true);
    try {
      const updated = await api.updateUser(selectedUser.id, {
        ...editForm,
        name: editForm.name.trim(),
        email: editForm.email.trim().toLowerCase(),
        recovery_email: (editForm.recovery_email || "").trim().toLowerCase(),
        contact_number: editForm.contact_number.trim(),
      });
      setSelectedUser(updated);
      setModalMode("overview");
      await invalidateUsersAndLogs();
    } catch (requestError) {
      setEditError(
        requestError?.message ||
          String(requestError) ||
          "Account details could not be updated."
      );
    } finally {
      setSavingUser(false);
    }
  }

  const editErrorField = getEditErrorField(editError);
  const activeMenuUser = openActionMenu
    ? filteredUsers.find((u) => u.id === openActionMenu.userId) || null
    : null;
  const activeMenuRestriction = activeMenuUser ? getDeactivateRestriction(activeMenuUser) : null;

  return (
    <div className="um-page">
      <div className="um-root">
        {/* PAGE HEADER */}
        <header className="um-header">
          <div className="um-header-copy">
            <h1 className="um-title">Users</h1>
            <p className="um-subtitle">
              Manage LGU personnel and administrator accounts.
            </p>
          </div>

          <Button
            variant="primary"
            onClick={() => setShowForm(true)}
            className="um-add-btn"
          >
            <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
            <span>Add User</span>
          </Button>
        </header>

        {currentUser?.role === "admin" && <AdminMfaRecoveryApprovals />}

        {/* ACTION ERROR BANNER (mutation errors) */}
        {actionError && (
          <div className="um-error-banner" role="alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>{actionError}</span>
          </div>
        )}

        {/* 1. STAT CARDS: CLICKABLE URL FILTERS */}
        <section className="um-stats-grid" aria-label="User account filters">
          {usersQuery.isLoading ? (
            [0, 1, 2, 3].map((slot) => (
              <div key={slot} className="um-stat-skeleton" aria-hidden="true">
                <div className="um-stat-skeleton__top">
                  <span className="um-stat-skeleton__icon" />
                  <span className="um-stat-skeleton__label" />
                </div>
                <span className="um-stat-skeleton__value" />
                <span className="um-stat-skeleton__footer" />
              </div>
            ))
          ) : (
            <>
              <StatCard
                icon={Users}
                iconTone="primary"
                tint="default"
                label="Total"
                value={totalCount}
                footer="All user accounts"
                selected={selectedStatCard === "total"}
                onClick={() => handleStatCardClick("total")}
              />
              <StatCard
                icon={UserCheck}
                tint="success"
                label="Active"
                value={activeCount}
                footer="Active user accounts"
                selected={selectedStatCard === "active"}
                onClick={() => handleStatCardClick("active")}
              />
              <StatCard
                icon={UserX}
                tint="neutral"
                label="Inactive"
                value={inactiveCount}
                footer="Inactive user accounts"
                selected={selectedStatCard === "inactive"}
                onClick={() => handleStatCardClick("inactive")}
              />
              <StatCard
                icon={ShieldCheck}
                iconTone="primary"
                tint="default"
                label="Admins"
                value={adminCount}
                footer="Administrator accounts"
                selected={selectedStatCard === "admins"}
                onClick={() => handleStatCardClick("admins")}
              />
            </>
          )}
        </section>

        {/* 2. UNIFIED TABLE CARD (TOOLBAR + TABLE / STATES + FOOTER) */}
        <section className="um-table-card" aria-label="Users directory">
          <div className="um-table-toolbar">
            <div className="um-search-field">
              <label htmlFor="um-search-input" className="sr-only">
                Search users
              </label>
              <Search size={16} className="um-search-icon" aria-hidden="true" />
              <input
                id="um-search-input"
                type="search"
                placeholder="Search by name, email, or phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="um-toolbar-input"
              />
            </div>

            <MobileFilterButton
              activeCount={(roleFilter ? 1 : 0) + (statusFilter ? 1 : 0)}
              title="Filter users"
              onReset={() => updateFilterParams({ role: "", status: "" })}
            >
              <label className="ui-mobile-filter-field">
                <span className="ui-mobile-filter-field__label">Role</span>
                <select
                  value={roleFilter}
                  onChange={(e) => updateFilterParams({ role: e.target.value })}
                  aria-label="Filter by role"
                >
                  <option value="">All Roles</option>
                  <option value="admin">Admin</option>
                  <option value="lgu_personnel">LGU Personnel</option>
                </select>
              </label>
              <label className="ui-mobile-filter-field">
                <span className="ui-mobile-filter-field__label">Status</span>
                <select
                  value={statusFilter}
                  onChange={(e) => updateFilterParams({ status: e.target.value })}
                  aria-label="Filter by status"
                >
                  <option value="">All Statuses</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
            </MobileFilterButton>

            <div className="um-toolbar-selects">
              <div className="um-select-field">
                <label htmlFor="um-role-select" className="sr-only">
                  Filter by role
                </label>
                <select
                  id="um-role-select"
                  value={roleFilter}
                  onChange={(e) => updateFilterParams({ role: e.target.value })}
                  className="um-toolbar-select"
                >
                  <option value="">All Roles</option>
                  <option value="admin">Admin</option>
                  <option value="lgu_personnel">LGU Personnel</option>
                </select>
              </div>

              <div className="um-select-field">
                <label htmlFor="um-status-select" className="sr-only">
                  Filter by status
                </label>
                <select
                  id="um-status-select"
                  value={statusFilter}
                  onChange={(e) => updateFilterParams({ status: e.target.value })}
                  className="um-toolbar-select"
                >
                  <option value="">All Statuses</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>
          </div>

          {usersQuery.isLoading ? (
            <div className="um-table-scroll" aria-busy="true" aria-label="Loading users list">
              <table className="um-table">
                <thead>
                  <tr>
                    <th scope="col" className="um-th-user">USER</th>
                    <th scope="col" className="um-th-role">ROLE</th>
                    <th scope="col" className="um-th-phone">PHONE</th>
                    <th scope="col" className="um-th-status">STATUS</th>
                    <th scope="col" className="um-th-actions">ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {[1, 2, 3, 4, 5].map((idx) => (
                    <tr key={idx} className="um-skeleton-row">
                      <td>
                        <div className="um-skeleton-user">
                          <div className="um-skeleton um-skeleton-avatar" />
                          <div className="um-skeleton-copy">
                            <div className="um-skeleton um-skeleton-line um-skeleton-line--long" />
                            <div className="um-skeleton um-skeleton-line um-skeleton-line--short" />
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="um-skeleton um-skeleton-badge" />
                      </td>
                      <td>
                        <div className="um-skeleton um-skeleton-line um-skeleton-line--medium" />
                      </td>
                      <td>
                        <div className="um-skeleton um-skeleton-pill" />
                      </td>
                      <td className="um-td-actions">
                        <div className="um-skeleton um-skeleton-btn" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : usersQuery.isError ? (
            <div className="um-state-box" role="alert">
              <div className="um-state-icon um-state-icon--danger" aria-hidden="true">
                <AlertTriangle size={22} />
              </div>
              <h2 className="um-state-title">Could not load users</h2>
              <p className="um-state-text">
                {usersQuery.error?.message || "Something went wrong while fetching user accounts."}
              </p>
              <Button variant="secondary" onClick={() => usersQuery.refetch()}>
                <RotateCcw size={15} aria-hidden="true" />
                <span>Try again</span>
              </Button>
            </div>
          ) : users.length === 0 ? (
            <div className="um-state-box">
              <div className="um-state-icon" aria-hidden="true">
                <Users size={22} />
              </div>
              <h2 className="um-state-title">No accounts yet</h2>
              <p className="um-state-text">
                Add an LGU personnel or administrator account to get started.
              </p>
              <Button variant="primary" onClick={() => setShowForm(true)}>
                <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
                <span>Add User</span>
              </Button>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="um-state-box">
              <div className="um-state-icon" aria-hidden="true">
                <Search size={22} />
              </div>
              <h2 className="um-state-title">No users match your filters</h2>
              <p className="um-state-text">
                Try adjusting your search or resetting the role and status filters.
              </p>
              <Button variant="secondary" onClick={clearAllFilters}>
                <RotateCcw size={15} aria-hidden="true" />
                <span>Clear filters</span>
              </Button>
            </div>
          ) : (
            <>
              {/* DESKTOP TABLE VIEW (Visible > 768px) */}
              <div className="um-table-scroll">
                <table className="um-table">
                  <thead>
                    <tr>
                      <th scope="col" className="um-th-user">USER</th>
                      <th scope="col" className="um-th-role">ROLE</th>
                      <th scope="col" className="um-th-phone">PHONE</th>
                      <th scope="col" className="um-th-status">STATUS</th>
                      <th scope="col" className="um-th-actions">ACTIONS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((u) => {
                      const isMuted = !u.is_active;
                      const isMenuOpen = openActionMenu?.userId === u.id;

                      return (
                        <tr
                          key={u.id}
                          className={`um-table-row ${isMuted ? "is-muted" : ""}`}
                          onClick={() => openDetailsModal(u, "overview")}
                        >
                          {/* USER CELL */}
                          <td className="um-td-user">
                            <button
                              type="button"
                              className="um-user-row-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                openDetailsModal(u, "overview");
                              }}
                              aria-label={`Open account profile for ${u.name}`}
                            >
                              <span
                                className={`um-avatar ${
                                  u.role === "admin" ? "is-admin" : "is-personnel"
                                }`}
                                aria-hidden="true"
                              >
                                {initials(u.name)}
                              </span>
                              <span className="um-user-cell-info">
                                <span className="um-user-name">{u.name}</span>
                                <span className="um-user-email">{u.email}</span>
                              </span>
                            </button>
                          </td>

                          {/* ROLE CHIP */}
                          <td className="um-td-role">
                            <RoleChip role={u.role} />
                          </td>

                          {/* PHONE */}
                          <td className="um-td-phone">
                            <span className="um-phone-text">
                              {u.contact_number || "—"}
                            </span>
                          </td>

                          {/* STATUS PILL */}
                          <td className="um-td-status">
                            <StatusPill variant={u.is_active ? "active" : "inactive"} />
                          </td>

                          {/* ROW ACTION MENU ("⋮") */}
                          <td
                            className="um-td-actions um-action-cell"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="um-action-menu-wrap">
                              <button
                                type="button"
                                className={`um-action-trigger-btn ${isMenuOpen ? "is-open" : ""}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleRowActionMenu(u, e.currentTarget);
                                }}
                                aria-label={`More actions for ${u.name}`}
                                aria-haspopup="menu"
                                aria-expanded={isMenuOpen}
                              >
                                <MoreVertical size={16} aria-hidden="true" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* MOBILE STACKED CARDS VIEW (Visible <= 768px) */}
              <div className="um-cards-wrapper">
                {filteredUsers.map((u) => {
                  const isMuted = !u.is_active;
                  const isMenuOpen = openActionMenu?.userId === u.id;

                  return (
                    <article
                      key={u.id}
                      className={`um-user-card ${isMuted ? "is-muted" : ""}`}
                    >
                      <div className="um-card-header">
                        <button
                          type="button"
                          className="um-card-user-btn"
                          onClick={() => openDetailsModal(u, "overview")}
                          aria-label={`Open account profile for ${u.name}`}
                        >
                          <span
                            className={`um-avatar ${
                              u.role === "admin" ? "is-admin" : "is-personnel"
                            }`}
                            aria-hidden="true"
                          >
                            {initials(u.name)}
                          </span>

                          <span className="um-card-header-meta">
                            <span className="um-card-title-row">
                              <span className="um-card-name">{u.name}</span>
                              <StatusPill variant={u.is_active ? "active" : "inactive"} />
                            </span>
                            <span className="um-card-email">{u.email}</span>
                          </span>
                        </button>

                        <div className="um-action-cell um-card-action-cell">
                          <button
                            type="button"
                            className={`um-action-trigger-btn ${isMenuOpen ? "is-open" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleRowActionMenu(u, e.currentTarget);
                            }}
                            aria-label={`More actions for ${u.name}`}
                            aria-haspopup="menu"
                            aria-expanded={isMenuOpen}
                          >
                            <MoreVertical size={16} aria-hidden="true" />
                          </button>
                        </div>
                      </div>

                      <div className="um-card-body">
                        <RoleChip role={u.role} />
                        <span className="um-phone-text">
                          {u.contact_number || "—"}
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}

          {!usersQuery.isLoading && !usersQuery.isError && (
            <div className="um-table-footer">
              <span className="um-footer-count">
                Showing <strong>{filteredUsers.length}</strong> of{" "}
                <strong>{totalCount}</strong> users
              </span>
            </div>
          )}
        </section>

        {openActionMenu && activeMenuUser && activeMenuRestriction &&
          createPortal(
            <div
              data-um-menu="true"
              className={`um-action-menu-dropdown um-action-menu-dropdown--portal ${
                openActionMenu.openAbove ? "is-upward" : ""
              }`}
              style={{
                right: `${openActionMenu.right}px`,
                ...(openActionMenu.openAbove
                  ? { bottom: `${openActionMenu.bottom}px` }
                  : { top: `${openActionMenu.top}px` }),
              }}
              role="menu"
              aria-label={`More actions for ${activeMenuUser.name}`}
            >
              <button
                type="button"
                className="um-menu-item"
                role="menuitem"
                onClick={() => {
                  setOpenActionMenu(null);
                  openDetailsModal(activeMenuUser, "edit");
                }}
              >
                <Pencil size={15} className="um-menu-icon" aria-hidden="true" />
                <span>Edit</span>
              </button>

              <button
                type="button"
                className="um-menu-item"
                role="menuitem"
                disabled={resettingPassword || resetCooldown > 0}
                onClick={() => {
                  setOpenActionMenu(null);
                  openDetailsModal(activeMenuUser);
                  handleResetPassword(activeMenuUser);
                }}
              >
                <KeyRound size={15} className="um-menu-icon" aria-hidden="true" />
                <span>Email password reset</span>
              </button>

              {activeMenuUser.is_active ? (
                !activeMenuRestriction.isSelf && (
                  <button
                    type="button"
                    className="um-menu-item is-danger"
                    role="menuitem"
                    disabled={
                      activeMenuRestriction.disabled ||
                      togglingId === activeMenuUser.id
                    }
                    title={activeMenuRestriction.tooltip || undefined}
                    onClick={() => {
                      setOpenActionMenu(null);
                      setDeactivatingUser(activeMenuUser);
                    }}
                  >
                    <Ban size={15} className="um-menu-icon" aria-hidden="true" />
                    <span>Deactivate</span>
                  </button>
                )
              ) : (
                <button
                  type="button"
                  className="um-menu-item is-success"
                  role="menuitem"
                  disabled={togglingId === activeMenuUser.id}
                  onClick={() => {
                    setOpenActionMenu(null);
                    handleReactivate(activeMenuUser);
                  }}
                >
                  <Check size={15} className="um-menu-icon" aria-hidden="true" />
                  <span>Reactivate</span>
                </button>
              )}
            </div>,
            document.body
          )}
      </div>

      {/* 4. CONFIRM DEACTIVATE MODAL */}
      {deactivatingUser && (
        <div
          className="um-overlay um-confirm-overlay"
          onClick={() => setDeactivatingUser(null)}
          role="presentation"
        >
          <div
            className="um-modal um-confirm-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="um-deactivate-title"
          >
            <div className="um-modal-header">
              <h2 className="um-modal-title" id="um-deactivate-title">
                Deactivate Account
              </h2>
              <button
                type="button"
                onClick={() => setDeactivatingUser(null)}
                className="um-modal-close"
                aria-label="Close dialog"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            <div className="um-confirm-body">
              <p className="um-confirm-message">
                Are you sure you want to deactivate <strong>{deactivatingUser.name}</strong>?
                They will immediately lose access to the system and cannot log in until reactivated.
              </p>
            </div>

            <div className="um-modal-footer">
              <button
                type="button"
                onClick={() => setDeactivatingUser(null)}
                className="um-cancel-btn"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeactivate}
                disabled={togglingId === deactivatingUser.id}
                className="um-danger-btn"
              >
                {togglingId === deactivatingUser.id
                  ? "Deactivating…"
                  : "Deactivate Account"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. ADD ACCOUNT MODAL */}
      {showForm && (
        <div className="um-overlay" onClick={closeModal} role="presentation">
          <div
            className="um-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="um-add-title"
          >
            <div className="um-modal-header">
              <div>
                <h2 className="um-modal-title" id="um-add-title">
                  Add Account
                </h2>
                <p className="um-modal-subtitle">
                  Create a personnel or admin account and dispatch a setup link.
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="um-modal-close"
                aria-label="Close modal"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            <form onSubmit={handleCreate} className="um-modal-form">
              {formError && (
                <div className="um-form-error" role="alert">
                  <FontAwesomeIcon icon={faTriangleExclamation} />
                  <span>{formError}</span>
                </div>
              )}

              <div className="um-form-fields">
                <div className="um-form-group">
                  <label htmlFor="add-name" className="um-label">
                    Full name
                  </label>
                  <input
                    id="add-name"
                    placeholder="Juan Dela Cruz"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: sanitizeNameInput(e.target.value) })}
                    className="um-input"
                    required
                    autoFocus
                  />
                </div>

                <div className="um-form-group">
                  <label htmlFor="add-role" className="um-label">
                    Role
                  </label>
                  <select
                    id="add-role"
                    value={form.role}
                    onChange={(e) =>
                      setForm({ ...form, role: e.target.value })
                    }
                    className="um-input"
                  >
                    <option value="lgu_personnel">LGU Personnel</option>
                    <option value="admin">Administrator</option>
                  </select>
                </div>

                <div className="um-form-group">
                  <label htmlFor="add-email" className="um-label">
                    Email address
                  </label>
                  <input
                    id="add-email"
                    type="email"
                    placeholder="name@lgu.gov.ph"
                    value={form.email}
                    onChange={(e) => {
                      setForm({ ...form, email: e.target.value });
                      setEmailError("");
                      setEmailAvailable(null);
                    }}
                    onBlur={(e) => checkEmailAvailability(e.target.value)}
                    className="um-input"
                    required
                  />
                  <small
                    className={`um-email-hint ${
                      emailError
                        ? "is-error"
                        : emailAvailable
                        ? "is-available"
                        : ""
                    }`}
                  >
                    {emailChecking
                      ? "Verifying email availability..."
                      : emailError ||
                        (emailAvailable
                          ? "Email is available. A setup link will be emailed."
                          : "We will email a secure password setup link to this address.")}
                  </small>
                </div>

                <div className="um-form-group">
                  <label htmlFor="add-phone" className="um-label">
                    Contact number
                  </label>
                  <input
                    id="add-phone"
                    placeholder="09xx xxx xxxx"
                    value={form.contact_number}
                    onChange={(e) =>
                      setForm({ ...form, contact_number: sanitizePhoneInput(e.target.value) })
                    }
                    className="um-input"
                  />
                </div>
              </div>

              <div className="um-modal-footer">
                <button
                  type="button"
                  onClick={closeModal}
                  className="um-cancel-btn"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="um-save-btn"
                >
                  {saving ? "Creating account…" : "Create & email setup link"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 6. ACCOUNT PROFILE & EDIT MODAL (SINGLE SURFACE, NO TABS) */}
      {selectedUser && (
        <div
          className="um-overlay um-overlay--details"
          onClick={closeUserModal}
          role="presentation"
        >
          <div
            ref={detailsModalRef}
            tabIndex={-1}
            className="um-modal um-modal--details"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="um-details-title"
          >
            {/* MODAL HEADER */}
            <div className="um-modal-header um-details-header">
              <div className="um-modal-header-main">
                {modalMode === "edit" && (
                  <span className="um-modal-icon-tile" aria-hidden="true">
                    <Pencil size={18} />
                  </span>
                )}
                <div className="um-modal-header-copy">
                  <h2 className="um-details-title" id="um-details-title">
                    {modalMode === "edit" ? "Edit account" : "Account profile"}
                  </h2>
                  {modalMode === "edit" && (
                    <p className="um-modal-subtitle">
                      Update name, role and contact details.
                    </p>
                  )}
                </div>
              </div>
              <div className="um-modal-header-actions">
                {modalMode !== "edit" && (
                  <Button
                    variant="secondary"
                    onClick={() => setModalMode("edit")}
                    className="um-modal-edit-btn"
                  >
                    <Pencil size={14} aria-hidden="true" />
                    <span>Edit details</span>
                  </Button>
                )}
                <button
                  type="button"
                  onClick={closeUserModal}
                  className="um-modal-close"
                  aria-label="Close"
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* IF IN EDIT MODE: DISPLAY IN-PLACE EDIT FORM */}
            {modalMode === "edit" ? (
              <form onSubmit={handleUpdateUser} className="um-modal-form">
                {editError && !editErrorField && (
                  <div className="um-form-error" role="alert">
                    <AlertTriangle size={15} aria-hidden="true" />
                    <span>{editError}</span>
                  </div>
                )}

                <div className="um-form-fields">
                  <div className="um-form-group">
                    <label htmlFor="edit-name" className="um-label">
                      Full name
                    </label>
                    <input
                      id="edit-name"
                      className={`um-input ${editErrorField === "name" ? "is-invalid" : ""}`}
                      value={editForm.name}
                      required
                      maxLength={100}
                      aria-invalid={editErrorField === "name" ? "true" : undefined}
                      aria-describedby={editErrorField === "name" ? "edit-name-error" : undefined}
                      onChange={(e) =>
                        setEditForm({ ...editForm, name: sanitizeNameInput(e.target.value) })
                      }
                      autoFocus
                    />
                    {editErrorField === "name" && (
                      <p id="edit-name-error" className="um-field-error" role="alert">
                        <AlertTriangle size={13} aria-hidden="true" />
                        <span>{editError}</span>
                      </p>
                    )}
                  </div>

                  <div className="um-form-group">
                    <label htmlFor="edit-role" className="um-label">
                      Role
                    </label>
                    <select
                      id="edit-role"
                      className={`um-input um-input--select ${editErrorField === "role" ? "is-invalid" : ""}`}
                      value={editForm.role}
                      aria-invalid={editErrorField === "role" ? "true" : undefined}
                      aria-describedby={editErrorField === "role" ? "edit-role-error" : undefined}
                      onChange={(e) =>
                        setEditForm({ ...editForm, role: e.target.value })
                      }
                    >
                      <option value="lgu_personnel">LGU Personnel</option>
                      <option value="admin">Administrator</option>
                    </select>
                    {editErrorField === "role" && (
                      <p id="edit-role-error" className="um-field-error" role="alert">
                        <AlertTriangle size={13} aria-hidden="true" />
                        <span>{editError}</span>
                      </p>
                    )}
                  </div>

                  <div className="um-form-group">
                    <label htmlFor="edit-email" className="um-label">
                      Email address
                    </label>
                    <input
                      id="edit-email"
                      className={`um-input ${editErrorField === "email" ? "is-invalid" : ""}`}
                      type="email"
                      value={editForm.email}
                      required
                      aria-invalid={editErrorField === "email" ? "true" : undefined}
                      aria-describedby={editErrorField === "email" ? "edit-email-error" : undefined}
                      onChange={(e) =>
                        setEditForm({ ...editForm, email: e.target.value })
                      }
                    />
                    {editErrorField === "email" && (
                      <p id="edit-email-error" className="um-field-error" role="alert">
                        <AlertTriangle size={13} aria-hidden="true" />
                        <span>{editError}</span>
                      </p>
                    )}
                  </div>

                  <div className="um-form-group">
                    <label htmlFor="edit-recovery-email" className="um-label">
                      Recovery / 2FA email <span style={{ fontWeight: 400, color: "#64748b" }}>(optional)</span>
                    </label>
                    <input
                      id="edit-recovery-email"
                      className="um-input"
                      type="email"
                      placeholder="e.g. evacway599@gmail.com"
                      value={editForm.recovery_email || ""}
                      onChange={(e) =>
                        setEditForm({ ...editForm, recovery_email: e.target.value })
                      }
                    />
                    <span style={{ fontSize: "11.5px", color: "#64748b" }}>
                      Used to receive 6-digit email verification codes and password resets (especially for .local accounts).
                    </span>
                  </div>

                  <div className="um-form-group">
                    <label htmlFor="edit-phone" className="um-label">
                      Contact number
                    </label>
                    <input
                      id="edit-phone"
                      className={`um-input ${editErrorField === "contact_number" ? "is-invalid" : ""}`}
                      value={editForm.contact_number}
                      maxLength={20}
                      aria-invalid={editErrorField === "contact_number" ? "true" : undefined}
                      aria-describedby={editErrorField === "contact_number" ? "edit-phone-error" : undefined}
                      onChange={(e) =>
                        setEditForm({
                          ...editForm,
                          contact_number: sanitizePhoneInput(e.target.value),
                        })
                      }
                    />
                    {editErrorField === "contact_number" && (
                      <p id="edit-phone-error" className="um-field-error" role="alert">
                        <AlertTriangle size={13} aria-hidden="true" />
                        <span>{editError}</span>
                      </p>
                    )}
                  </div>
                </div>

                <div className="um-modal-footer um-edit-footer">
                  <Button
                    variant="secondary"
                    className="um-edit-footer-btn"
                    onClick={() => {
                      setModalMode("overview");
                      setEditError("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    type="submit"
                    className="um-edit-footer-btn"
                    disabled={savingUser}
                  >
                    {savingUser ? "Saving…" : "Save changes"}
                  </Button>
                </div>
              </form>
            ) : (
              /* VIEW MODE: ACCOUNT PROFILE */
              <div className="um-modal-content">
                <div className="um-profile-body">
                  <div className="um-profile-banner">
                    <span
                      className={`um-avatar is-profile ${
                        selectedUser.role === "admin" ? "is-admin" : "is-personnel"
                      }`}
                      aria-hidden="true"
                    >
                      {initials(selectedUser.name)}
                    </span>

                    <div className="um-profile-meta">
                      <h3 className="um-profile-name">{selectedUser.name}</h3>
                      <div className="um-profile-badge-row">
                        <RoleChip role={selectedUser.role} />
                        <StatusPill
                          variant={selectedUser.is_active ? "active" : "inactive"}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="um-detail-grid">
                    <div className="um-detail-card">
                      <div className="um-detail-label">
                        <Mail size={13} aria-hidden="true" />
                        <span>Email address</span>
                      </div>
                      <div className="um-detail-value">{selectedUser.email}</div>
                    </div>

                    <div className="um-detail-card">
                      <div className="um-detail-label">
                        <Phone size={13} aria-hidden="true" />
                        <span>Contact number</span>
                      </div>
                      <div className="um-detail-value um-detail-value--num">
                        {selectedUser.contact_number || "Not specified"}
                      </div>
                    </div>
                  </div>
                </div>

                {/* MODAL FOOTER WITH PASSWORD RESET ON LEFT & CLOSE ON RIGHT */}
                <div className="um-modal-footer um-modal-footer--split um-profile-footer">
                  <div className="um-reset-action">
                    <Button
                      variant="secondary"
                      className="um-profile-footer-btn"
                      onClick={() => handleResetPassword(selectedUser)}
                      disabled={resettingPassword || resetCooldown > 0}
                    >
                      <KeyRound size={15} aria-hidden="true" />
                      <span>
                        {resettingPassword ? "Sending reset email..." : "Send reset email"}
                      </span>
                    </Button>

                    {resetSuccess?.userId === selectedUser.id && (
                      <p className="um-email-hint is-available" role="status">
                        {resetSuccess.message}
                      </p>
                    )}

                    {resetError && resetErrorUserId === selectedUser.id && (
                      <div className="um-reset-error" role="alert">
                        <span>{resetError}</span>
                        <button
                          type="button"
                          className="um-reset-retry-btn"
                          onClick={() => handleResetPassword(selectedUser, true)}
                          disabled={resettingPassword || resetCooldown > 0}
                        >
                          Retry
                        </button>
                      </div>
                    )}
                  </div>

                  <Button
                    variant="secondary"
                    className="um-profile-footer-btn"
                    onClick={closeUserModal}
                  >
                    Close
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default UserManagement;

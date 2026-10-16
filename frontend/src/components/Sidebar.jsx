import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faHouseFlag,
  faTriangleExclamation,
  faPeopleGroup,
  faUsers,
  faClockRotateLeft,
  faRightFromBracket,
  faShieldHalved,
  faUser,
  faChartLine,
  faLifeRing,
  faDatabase,
  faBars,
  faXmark,
  faChevronUp,
  faChevronDown,
} from "@fortawesome/free-solid-svg-icons";

import "../components_css/Sidebar.css";
import NotificationCenter from "./NotificationCenter";
import { useAuth } from "../context/AuthContext";

const TABS = [
  {
    key: "dashboard",
    label: "Dashboard",
    icon: faChartLine,
    roles: ["admin", "lgu_personnel"],
  },
  {
    key: "centers",
    label: "Evacuation Centers",
    icon: faHouseFlag,
    roles: ["admin", "lgu_personnel"],
  },
  {
    key: "barangays",
    label: "Barangays",
    icon: faPeopleGroup,
    roles: ["admin", "lgu_personnel"],
  },
  {
    key: "reports",
    label: "Hazard Reports",
    icon: faTriangleExclamation,
    roles: ["admin", "lgu_personnel"],
  },
  {
    key: "rescue",
    label: "Rescue Alerts",
    icon: faLifeRing,
    roles: ["admin", "lgu_personnel"],
  },
  {
    key: "users",
    label: "Users",
    icon: faUsers,
    roles: ["admin"],
  },
  {
    key: "data-management",
    label: "Data Management",
    icon: faDatabase,
    roles: ["admin"],
  },
  {
    key: "settings",
    label: "Activity Logs",
    icon: faClockRotateLeft,
    roles: ["admin", "lgu_personnel"],
  },
];

function Sidebar({
  tab,
  setTab,
  user,
  logout,
  isMobile,
  onSelectNotification,
}) {
  const role = user?.role;
  const { updateUser } = useAuth();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [drawerProfileMenuOpen, setDrawerProfileMenuOpen] = useState(false);
  const [mobileProfileMenuOpen, setMobileProfileMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const logoutTimer = useRef(null);

  const profileTriggerRef = useRef(null);
  const profileMenuRef = useRef(null);
  const menuItemRefs = [useRef(null), useRef(null)];

  const drawerProfileTriggerRef = useRef(null);
  const drawerProfileMenuRef = useRef(null);
  const drawerMenuItemRefs = [useRef(null), useRef(null)];

  const mobileProfileTriggerRef = useRef(null);
  const mobileProfileMenuRef = useRef(null);
  const mobileMenuItemRefs = [useRef(null), useRef(null)];

  const availableTabs = TABS.filter((item) =>
    item.roles.includes(role)
  );

  const activeTabObj = availableTabs.find((t) => t.key === tab) || availableTabs[0];

  useEffect(() => () => window.clearTimeout(logoutTimer.current), []);

  // Close drawer on Escape key
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "Escape" && drawerOpen) {
        setDrawerOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [drawerOpen]);

  // Close profile dropdown on click outside
  useEffect(() => {
    if (!profileMenuOpen) return;
    function handleClickOutside(e) {
      if (
        profileMenuRef.current &&
        !profileMenuRef.current.contains(e.target) &&
        profileTriggerRef.current &&
        !profileTriggerRef.current.contains(e.target)
      ) {
        setProfileMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [profileMenuOpen]);

  // Close drawer profile dropdown on click outside
  useEffect(() => {
    if (!drawerProfileMenuOpen) return;
    function handleClickOutside(e) {
      if (
        drawerProfileMenuRef.current &&
        !drawerProfileMenuRef.current.contains(e.target) &&
        drawerProfileTriggerRef.current &&
        !drawerProfileTriggerRef.current.contains(e.target)
      ) {
        setDrawerProfileMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [drawerProfileMenuOpen]);

  // Close profile dropdown on Escape and return focus
  useEffect(() => {
    if (!profileMenuOpen) return;
    function handleEscape(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        setProfileMenuOpen(false);
        profileTriggerRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [profileMenuOpen]);

  // Close drawer profile dropdown on Escape and return focus
  useEffect(() => {
    if (!drawerProfileMenuOpen) return;
    function handleEscape(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        setDrawerProfileMenuOpen(false);
        drawerProfileTriggerRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [drawerProfileMenuOpen]);

  // Close mobile profile dropdown on click outside
  useEffect(() => {
    if (!mobileProfileMenuOpen) return;
    function handleClickOutside(e) {
      if (
        mobileProfileMenuRef.current &&
        !mobileProfileMenuRef.current.contains(e.target) &&
        mobileProfileTriggerRef.current &&
        !mobileProfileTriggerRef.current.contains(e.target)
      ) {
        setMobileProfileMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [mobileProfileMenuOpen]);

  // Close mobile profile dropdown on Escape and return focus
  useEffect(() => {
    if (!mobileProfileMenuOpen) return;
    function handleEscape(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        setMobileProfileMenuOpen(false);
        mobileProfileTriggerRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [mobileProfileMenuOpen]);

  function handleTriggerKeyDown(e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setProfileMenuOpen((prev) => {
        const next = !prev;
        if (next) {
          setTimeout(() => menuItemRefs[0].current?.focus(), 50);
        }
        return next;
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setProfileMenuOpen(true);
      setTimeout(() => menuItemRefs[1].current?.focus(), 50);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setProfileMenuOpen(true);
      setTimeout(() => menuItemRefs[0].current?.focus(), 50);
    }
  }

  function handleMenuItemKeyDown(e, index) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const nextIndex = (index + 1) % 2;
      menuItemRefs[nextIndex].current?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prevIndex = (index - 1 + 2) % 2;
      menuItemRefs[prevIndex].current?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setProfileMenuOpen(false);
      profileTriggerRef.current?.focus();
    } else if (e.key === "Tab") {
      setProfileMenuOpen(false);
    }
  }

  function handleDrawerTriggerKeyDown(e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setDrawerProfileMenuOpen((prev) => {
        const next = !prev;
        if (next) {
          setTimeout(() => drawerMenuItemRefs[0].current?.focus(), 50);
        }
        return next;
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setDrawerProfileMenuOpen(true);
      setTimeout(() => drawerMenuItemRefs[1].current?.focus(), 50);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setDrawerProfileMenuOpen(true);
      setTimeout(() => drawerMenuItemRefs[0].current?.focus(), 50);
    }
  }

  function handleDrawerMenuItemKeyDown(e, index) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const nextIndex = (index + 1) % 2;
      drawerMenuItemRefs[nextIndex].current?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prevIndex = (index - 1 + 2) % 2;
      drawerMenuItemRefs[prevIndex].current?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDrawerProfileMenuOpen(false);
      drawerProfileTriggerRef.current?.focus();
    } else if (e.key === "Tab") {
      setDrawerProfileMenuOpen(false);
    }
  }

  function handleMobileTriggerKeyDown(e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setMobileProfileMenuOpen((prev) => {
        const next = !prev;
        if (next) {
          setTimeout(() => mobileMenuItemRefs[0].current?.focus(), 50);
        }
        return next;
      });
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setMobileProfileMenuOpen(true);
      setTimeout(() => mobileMenuItemRefs[0].current?.focus(), 50);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setMobileProfileMenuOpen(true);
      setTimeout(() => mobileMenuItemRefs[1].current?.focus(), 50);
    }
  }

  function handleMobileMenuItemKeyDown(e, index) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const nextIndex = (index + 1) % 2;
      mobileMenuItemRefs[nextIndex].current?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prevIndex = (index - 1 + 2) % 2;
      mobileMenuItemRefs[prevIndex].current?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setMobileProfileMenuOpen(false);
      mobileProfileTriggerRef.current?.focus();
    } else if (e.key === "Tab") {
      setMobileProfileMenuOpen(false);
    }
  }

  function handleOpenProfile() {
    setProfileMenuOpen(false);
    setDrawerProfileMenuOpen(false);
    setMobileProfileMenuOpen(false);
    if (drawerOpen) {
      setDrawerOpen(false);
    }
    navigate("/profile");
    if (typeof setTab === "function") {
      setTab("profile");
    }
  }

  function handleLogoutFromDropdown() {
    setProfileMenuOpen(false);
    setDrawerProfileMenuOpen(false);
    setMobileProfileMenuOpen(false);
    if (drawerOpen) {
      setDrawerOpen(false);
    }
    handleLogout();
  }

  function handleLogout() {
    if (loggingOut) return;

    setLogoutConfirmOpen(true);
  }

  function confirmLogout() {
    setLogoutConfirmOpen(false);
    setLoggingOut(true);
    logoutTimer.current = window.setTimeout(logout, 450);
  }

  return (
    <>
      {/* Mobile & Tablet Header Bar (Visible <= 1024px) */}
      <header className="sidebar-mobile-header" aria-label="Mobile Navigation Bar">
        <button
          type="button"
          className="sidebar-mobile-menu-btn"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation menu"
          title="Open menu"
        >
          <FontAwesomeIcon icon={faBars} />
        </button>

        <div className="sidebar-mobile-brand">
          <span className="sidebar-brand-icon">
            <FontAwesomeIcon icon={faShieldHalved} />
          </span>
          <span className="sidebar-mobile-brand-title">EvacWay</span>
          {activeTabObj && (
            <span className="sidebar-mobile-tab-tag">{activeTabObj.label}</span>
          )}
        </div>

        <div className="sidebar-mobile-right">
          <NotificationCenter onSelect={onSelectNotification} />
          
          <div className="sidebar-mobile-profile-wrap">
            <button
              ref={mobileProfileTriggerRef}
              type="button"
              className={`sidebar-mobile-avatar-btn ${tab === "profile" ? "is-active" : ""}`}
              onClick={() => setMobileProfileMenuOpen((prev) => !prev)}
              onKeyDown={handleMobileTriggerKeyDown}
              aria-label="User account menu"
              aria-haspopup="menu"
              aria-expanded={mobileProfileMenuOpen}
              title="My account"
            >
              <FontAwesomeIcon icon={faUser} />
            </button>

            {mobileProfileMenuOpen && (
              <div
                className="sidebar-mobile-profile-dropdown"
                role="menu"
                aria-label="User profile options"
                ref={mobileProfileMenuRef}
              >
                <button
                  type="button"
                  role="menuitem"
                  ref={mobileMenuItemRefs[0]}
                  className="sidebar-dropdown-item"
                  onClick={handleOpenProfile}
                  onKeyDown={(e) => handleMobileMenuItemKeyDown(e, 0)}
                >
                  <span className="sidebar-dropdown-icon">
                    <FontAwesomeIcon icon={faUser} />
                  </span>
                  <span>Manage Profile</span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  ref={mobileMenuItemRefs[1]}
                  className="sidebar-dropdown-item is-logout"
                  onClick={handleLogoutFromDropdown}
                  onKeyDown={(e) => handleMobileMenuItemKeyDown(e, 1)}
                >
                  <span className="sidebar-dropdown-icon">
                    <FontAwesomeIcon icon={faRightFromBracket} />
                  </span>
                  <span>Log out</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Drawer Overlay for Mobile & Tablet */}
      {drawerOpen && (
        <div
          className="sidebar-drawer-overlay"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Drawer Panel for Mobile & Tablet */}
      <aside
        className={`sidebar-drawer ${drawerOpen ? "is-open" : ""}`}
        aria-label="Slide-over navigation menu"
        aria-hidden={!drawerOpen}
      >
        <div className="sidebar-drawer-header">
          <div className="sidebar-brand">
            <span className="sidebar-brand-icon">
              <FontAwesomeIcon icon={faShieldHalved} />
            </span>
            <span className="sidebar-brand-copy">
              <strong>EvacWay</strong>
            </span>
          </div>
          <button
            type="button"
            className="sidebar-drawer-close-btn"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close menu"
            title="Close menu"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        <nav className="sidebar-drawer-nav" aria-label="Drawer navigation">
          {availableTabs.map((item) => (
            <button
              key={item.key}
              onClick={() => {
                setTab(item.key);
                setDrawerOpen(false);
              }}
              title={item.label}
              aria-label={item.label}
              aria-current={tab === item.key ? "page" : undefined}
              className={`sidebar-tab ${tab === item.key ? "sidebar-tab-active" : ""}`}
            >
              <FontAwesomeIcon icon={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-drawer-footer">
          {drawerProfileMenuOpen && (
            <div
              className="sidebar-profile-dropdown"
              role="menu"
              aria-label="User profile options"
              ref={drawerProfileMenuRef}
            >
              <button
                type="button"
                role="menuitem"
                ref={drawerMenuItemRefs[0]}
                className="sidebar-dropdown-item"
                onClick={handleOpenProfile}
                onKeyDown={(e) => handleDrawerMenuItemKeyDown(e, 0)}
              >
                <span className="sidebar-dropdown-icon">
                  <FontAwesomeIcon icon={faUser} />
                </span>
                <span>Manage Profile</span>
              </button>

              <button
                type="button"
                role="menuitem"
                ref={drawerMenuItemRefs[1]}
                className="sidebar-dropdown-item is-logout"
                onClick={handleLogoutFromDropdown}
                onKeyDown={(e) => handleDrawerMenuItemKeyDown(e, 1)}
              >
                <span className="sidebar-dropdown-icon">
                  <FontAwesomeIcon icon={faRightFromBracket} />
                </span>
                <span>Log out</span>
              </button>
            </div>
          )}

          <button
            type="button"
            className={`sidebar-profile-trigger ${tab === "profile" ? "is-active" : ""}`}
            onClick={() => setDrawerProfileMenuOpen((prev) => !prev)}
            onKeyDown={handleDrawerTriggerKeyDown}
            ref={drawerProfileTriggerRef}
            aria-label="User account menu"
            aria-haspopup="menu"
            aria-expanded={drawerProfileMenuOpen}
            title="My account"
          >
            <span className="sidebar-avatar">
              <FontAwesomeIcon icon={faUser} />
            </span>
            <span className="sidebar-account-copy">
              <strong>{user?.name || "Account"}</strong>
              <small>{role === "admin" ? "Administrator" : "LGU Personnel"}</small>
            </span>
            <span className="sidebar-profile-chevron" aria-hidden="true">
              <FontAwesomeIcon icon={drawerProfileMenuOpen ? faChevronDown : faChevronUp} />
            </span>
          </button>
        </div>
      </aside>

      {/* Desktop Sidebar Rail (Visible > 1024px) */}
      <aside className="sidebar-rail">
        <div className="sidebar-brand">
          <span className="sidebar-brand-icon">
            <FontAwesomeIcon icon={faShieldHalved} />
          </span>
          <span className="sidebar-brand-copy">
            <strong>EvacWay</strong>
          </span>
          <NotificationCenter onSelect={onSelectNotification} />
        </div>

        <nav className="sidebar-navigation" aria-label="Main navigation">
          {availableTabs.map((item) => (
            <button
              key={item.key}
              onClick={() => setTab(item.key)}
              title={item.label}
              aria-label={item.label}
              aria-current={tab === item.key ? "page" : undefined}
              className={`sidebar-tab ${tab === item.key ? "sidebar-tab-active" : ""}`}
            >
              <FontAwesomeIcon icon={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-account">
          {profileMenuOpen && (
            <div
              className="sidebar-profile-dropdown"
              role="menu"
              aria-label="User profile options"
              ref={profileMenuRef}
            >
              <button
                type="button"
                role="menuitem"
                ref={menuItemRefs[0]}
                className="sidebar-dropdown-item"
                onClick={handleOpenProfile}
                onKeyDown={(e) => handleMenuItemKeyDown(e, 0)}
              >
                <span className="sidebar-dropdown-icon">
                  <FontAwesomeIcon icon={faUser} />
                </span>
                <span>Manage Profile</span>
              </button>

              <button
                type="button"
                role="menuitem"
                ref={menuItemRefs[1]}
                className="sidebar-dropdown-item is-logout"
                onClick={handleLogoutFromDropdown}
                onKeyDown={(e) => handleMenuItemKeyDown(e, 1)}
              >
                <span className="sidebar-dropdown-icon">
                  <FontAwesomeIcon icon={faRightFromBracket} />
                </span>
                <span>Log out</span>
              </button>
            </div>
          )}

          <button
            type="button"
            className={`sidebar-profile-trigger ${tab === "profile" ? "is-active" : ""}`}
            onClick={() => setProfileMenuOpen((prev) => !prev)}
            onKeyDown={handleTriggerKeyDown}
            ref={profileTriggerRef}
            aria-label="User account menu"
            aria-haspopup="menu"
            aria-expanded={profileMenuOpen}
            title="My account"
          >
            <span className="sidebar-avatar">
              <FontAwesomeIcon icon={faUser} />
            </span>
            <span className="sidebar-account-copy">
              <strong>{user?.name || "Account"}</strong>
              <small>{role === "admin" ? "Administrator" : "LGU Personnel"}</small>
            </span>
            <span className="sidebar-profile-chevron" aria-hidden="true">
              <FontAwesomeIcon icon={profileMenuOpen ? faChevronDown : faChevronUp} />
            </span>
          </button>
        </div>
      </aside>

      {logoutConfirmOpen && (
        <div
          className="logout-confirm-overlay"
          onClick={(event) => event.target === event.currentTarget && setLogoutConfirmOpen(false)}
        >
          <section className="logout-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="logout-confirm-title">
            <div className="logout-confirm-mark">
              <FontAwesomeIcon icon={faRightFromBracket} />
            </div>
            <h2 id="logout-confirm-title">Sign out of EvacWay?</h2>
            <p>You’ll need to sign in again to access the operations dashboard.</p>
            <div className="logout-confirm-actions">
              <button type="button" className="logout-confirm-cancel" autoFocus onClick={() => setLogoutConfirmOpen(false)}>
                Cancel
              </button>
              <button type="button" className="logout-confirm-submit" onClick={confirmLogout}>
                Sign out
              </button>
            </div>
          </section>
        </div>
      )}

      {loggingOut && (
        <div className="logout-transition" role="status" aria-live="polite">
          <div className="logout-transition-mark">
            <FontAwesomeIcon icon={faRightFromBracket} />
          </div>
          <strong>Signing out</strong>
          <span>Closing your EvacWay session</span>
        </div>
      )}
    </>
  );
}

export default Sidebar;
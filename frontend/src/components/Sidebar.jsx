import { useEffect, useRef, useState } from "react";
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
} from "@fortawesome/free-solid-svg-icons";

import "../components_css/Sidebar.css";
import NotificationCenter from "./NotificationCenter";
import AccountProfileModal from "./AccountProfileModal";
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
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const logoutTimer = useRef(null);

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
          <button
            type="button"
            className="sidebar-mobile-avatar-btn"
            onClick={() => setProfileOpen(true)}
            aria-label="Open my account profile"
            title="My account"
          >
            <FontAwesomeIcon icon={faUser} />
          </button>
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
          <button
            type="button"
            className="sidebar-profile-trigger"
            onClick={() => {
              setDrawerOpen(false);
              setProfileOpen(true);
            }}
            aria-label="Open my account profile"
            title="My account"
          >
            <span className="sidebar-avatar"><FontAwesomeIcon icon={faUser} /></span>
            <span className="sidebar-account-copy">
              <strong>{user?.name || "Account"}</strong>
              <small>{role === "admin" ? "Administrator" : "LGU Personnel"}</small>
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setDrawerOpen(false);
              handleLogout();
            }}
            className="sidebar-logout-btn"
            title="Log out"
            aria-label="Log out"
          >
            <FontAwesomeIcon icon={faRightFromBracket} />
            <span>Log out</span>
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
          <button
            type="button"
            className="sidebar-profile-trigger"
            onClick={() => setProfileOpen(true)}
            aria-label="Open my account profile"
            title="My account"
          >
            <span className="sidebar-avatar"><FontAwesomeIcon icon={faUser} /></span>
            <span className="sidebar-account-copy">
              <strong>{user?.name || "Account"}</strong>
              <small>{role === "admin" ? "Administrator" : "LGU Personnel"}</small>
            </span>
          </button>
          <button
            onClick={handleLogout}
            className="sidebar-logout-btn"
            title="Log out"
            aria-label="Log out"
          >
            <FontAwesomeIcon icon={faRightFromBracket} />
            <span>Log out</span>
          </button>
        </div>
      </aside>

      {profileOpen && (
        <AccountProfileModal
          user={user}
          onClose={() => setProfileOpen(false)}
          onUpdated={updateUser}
        />
      )}

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
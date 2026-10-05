import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faHouseFlag,
  faTriangleExclamation,
  faPeopleGroup,
  faUsers,
  faGear,
  faRightFromBracket,
  faShieldHalved,
  faUser,
} from "@fortawesome/free-solid-svg-icons";

import "../components_css/Sidebar.css";
import NotificationCenter from "./NotificationCenter";
import AccountProfileModal from "./AccountProfileModal";
import { useAuth } from "../context/AuthContext";

const TABS = [
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
    label: "Rescue Requests",
    icon: faTriangleExclamation,
    roles: ["admin", "lgu_personnel"],
  },
  {
    key: "users",
    label: "Manage Users",
    icon: faUsers,
    roles: ["admin"],
  },
  {
    key: "settings",
    label: "Settings / Logs",
    icon: faGear,
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
  const logoutTimer = useRef(null);

  const availableTabs = TABS.filter((item) =>
    item.roles.includes(role)
  );

  useEffect(() => () => window.clearTimeout(logoutTimer.current), []);

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
      <aside className={`sidebar-rail ${isMobile ? "is-mobile" : ""}`}>
        <div className="sidebar-brand">
          <span className="sidebar-brand-icon">
            <FontAwesomeIcon icon={faShieldHalved} />
          </span>
          {!isMobile && (
            <span className="sidebar-brand-copy">
              <strong>EvacWay</strong>
              <small>Operations</small>
            </span>
          )}
          {!isMobile && <NotificationCenter onSelect={onSelectNotification} />}
        </div>

        <div className="sidebar-section-label">Workspace</div>
        <nav className="sidebar-navigation" aria-label="Dashboard sections">
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
              {!isMobile && <span>{item.label}</span>}
            </button>
          ))}
          {isMobile && <NotificationCenter onSelect={onSelectNotification} />}
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
            {!isMobile && (
              <span className="sidebar-account-copy">
                <strong>{user?.name || "Account"}</strong>
                <small>{role === "admin" ? "Administrator" : "LGU Personnel"}</small>
              </span>
            )}
          </button>
          <button
            onClick={handleLogout}
            className="sidebar-logout-btn"
            title="Log out"
            aria-label="Log out"
          >
            <FontAwesomeIcon icon={faRightFromBracket} />
            {!isMobile && <span>Log out</span>}
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
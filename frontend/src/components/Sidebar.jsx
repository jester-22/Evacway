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
    key: "users",
    label: "Manage Users",
    icon: faUsers,
    roles: ["admin"],
  },
  {
    key: "settings",
    label: "Settings / Logs",
    icon: faGear,
    roles: ["admin"],
  },
];

function Sidebar({
  tab,
  setTab,
  user,
  logout,
  isMobile,
}) {
  const role = user?.role;
  const [loggingOut, setLoggingOut] = useState(false);
  const logoutTimer = useRef(null);

  const availableTabs = TABS.filter((item) =>
    item.roles.includes(role)
  );

  useEffect(() => () => window.clearTimeout(logoutTimer.current), []);

  function handleLogout() {
    if (loggingOut) return;

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
        </nav>

        <div className="sidebar-account">
          <span className="sidebar-avatar">
            <FontAwesomeIcon icon={faUser} />
          </span>
          {!isMobile && (
            <span className="sidebar-account-copy">
              <strong>{user?.name || "Account"}</strong>
              <small>{role === "admin" ? "Administrator" : "LGU Personnel"}</small>
            </span>
          )}
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
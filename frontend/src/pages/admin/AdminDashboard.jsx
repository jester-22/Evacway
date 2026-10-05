import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../../services/api";
import { useAuth } from "../../context/AuthContext";

import Sidebar from "../../components/Sidebar";
import EvacuationCenterManager from "../../components/EvacuationCenterManager";
import HazardReportReview from "../../components/HazardReportReview";
import UserManagement from "../../components/UserManagement";
import BarangayManager from "../../components/BarangayManager";
import SystemAndLogs from "../../components/SystemAndLogs";
import RescueRequestManager from "../../components/RescueRequestManager";

const MOBILE_BREAKPOINT = 720;

function useIsMobile(breakpoint = MOBILE_BREAKPOINT) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined"
      ? window.innerWidth < breakpoint
      : false
  );

  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth < breakpoint);
    }

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [breakpoint]);

  return isMobile;
}

function AdminDashboard() {
  const location = useLocation();
  const requestedTab = new URLSearchParams(location.search).get("tab");
  const [tab, setTab] = useState(["reports", "rescue"].includes(requestedTab) ? requestedTab : "centers");
  const [focusedReportId, setFocusedReportId] = useState(null);
  const [focusedRescueId, setFocusedRescueId] = useState(null);
  const [mapFocusLocation, setMapFocusLocation] = useState(null);
  const [centers, setCenters] = useState(null);
  const [hazardZones, setHazardZones] = useState(null);
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState("");

  const { user, logout } = useAuth();
  const isMobile = useIsMobile();

  useEffect(() => {
    refreshCenters();

    api
      .getHazardZones()
      .then(setHazardZones)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const notificationId = new URLSearchParams(location.search).get("notificationId");
    if (!notificationId) return undefined;

    let cancelled = false;
    api.getNotifications().then((result) => {
      if (cancelled) return;
      const notification = result.notifications?.find((item) => String(item.id) === notificationId);
      if (!notification) return;
      api.markNotificationRead(notification.id).catch(() => {});
      if (notification.resource_type === "hazard_report") {
        setFocusedReportId(notification.resource_id);
        setFocusedRescueId(null);
        setTab("reports");
      } else {
        setFocusedRescueId(notification.resource_id);
        setFocusedReportId(null);
        setTab("rescue");
      }
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [location.search]);

  function handleNotificationSelect(notification) {
    if (notification.resource_type === "hazard_report") {
      setFocusedReportId(notification.resource_id);
      setFocusedRescueId(null);
      setTab("reports");
    } else {
      setFocusedRescueId(notification.resource_id);
      setFocusedReportId(null);
      setTab("rescue");
    }
  }

  function openMapLocation(item) {
    if (!Number.isFinite(Number(item.latitude)) || !Number.isFinite(Number(item.longitude))) return;
    setMapFocusLocation({
      latitude: Number(item.latitude),
      longitude: Number(item.longitude),
      requestedAt: Date.now(),
    });
    setTab("centers");
  }

  useEffect(() => {
    if (tab === "settings") {
      setLogsLoading(true);
      setLogsError("");
      api
        .getLogs()
        .then(setLogs)
        .catch((error) => {
          setLogs([]);
          setLogsError(error.message || "Could not load activity logs.");
        })
        .finally(() => setLogsLoading(false));
    }
  }, [tab]);

  function refreshCenters() {
    api
      .getEvacuationCenters(true)
      .then(setCenters)
      .catch(() => {});
  }

  return (
    <div className="dashboard-layout">
      <Sidebar
        tab={tab}
        setTab={setTab}
        user={user}
        logout={logout}
        isMobile={isMobile}
        onSelectNotification={handleNotificationSelect}
      />

      {/* CONTENT */}
      <div className="dashboard-content">
        {/* EVACUATION CENTERS */}
        {tab === "centers" && (
          <EvacuationCenterManager
            centers={centers}
            hazardZones={hazardZones}
            onRefresh={refreshCenters}
            canDeactivate={true}
            focusLocation={mapFocusLocation}
          />
        )}

        {/* BARANGAYS */}
        {tab === "barangays" && (
          <BarangayManager />
        )}

        {/* HAZARD REPORTS */}
        {tab === "reports" && (
          <HazardReportReview focusReportId={focusedReportId} onOpenMap={openMapLocation} />
        )}

        {tab === "rescue" && (
          <RescueRequestManager key={focusedRescueId ?? "rescue-queue"} initialRequestId={focusedRescueId} onOpenMap={openMapLocation} />
        )}

        {/* MANAGE USERS */}
        {tab === "users" && (
          <UserManagement />
        )}

        {/* SYSTEM & LOGS */}
        {tab === "settings" && (
          <SystemAndLogs
            logs={logs}
            user={user}
            loading={logsLoading}
            error={logsError}
          />
        )}
      </div>
    </div>
  );
}

const styles = {
  th: {
    textAlign: "left",
    padding: 8,
    borderBottom: "2px solid #eee",
    fontSize: 13,
  },

  td: {
    padding: 8,
    borderBottom: "1px solid #f0f0f0",
    fontSize: 13,
  },
};

export default AdminDashboard;
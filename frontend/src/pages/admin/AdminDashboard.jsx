import { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { queryKeys, useEvacuationCenters, useHazardZones, useLogs, useNotifications } from "../../hooks/useEvacuationQueries";
import { useQueryClient } from "@tanstack/react-query";

import Sidebar from "../../components/Sidebar";
import EvacuationCenterManager from "../../components/EvacuationCenterManager";
import HazardReportReview from "../../components/HazardReportReview";
import UserManagement from "../../components/UserManagement";
import BarangayManager from "../../components/BarangayManager";
import DataManagement from "../../components/DataManagement";
import SystemAndLogs from "../../components/SystemAndLogs";
import RescueRequestManager from "../../components/RescueRequestManager";

const MOBILE_BREAKPOINT = 1024;

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

const ADMIN_TABS = ["centers", "barangays", "reports", "rescue", "users", "data-management", "settings"];

function AdminDashboard() {
  const location = useLocation();
  const requestedTab = new URLSearchParams(location.search).get("tab");
  const notificationId = new URLSearchParams(location.search).get("notificationId");
  const [tab, setTab] = useState(ADMIN_TABS.includes(requestedTab) ? requestedTab : "centers");
  const [focusedReportId, setFocusedReportId] = useState(null);
  const [focusedRescueId, setFocusedRescueId] = useState(null);
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const notificationsQuery = useNotifications({ enabled: Boolean(notificationId) });
  const handledNotificationId = useRef(null);
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const centersQuery = useEvacuationCenters(true);
  const hazardZonesQuery = useHazardZones();
  const logsQuery = useLogs({ enabled: tab === "settings" });
  const centers = centersQuery.data ?? null;
  const hazardZones = hazardZonesQuery.data ?? null;
  const logs = logsQuery.data || [];

  // Protect Admin Dashboard: Redirect non-admins to their dashboard with short message
  useEffect(() => {
    if (user && user.role !== "admin") {
      navigate("/lgu", { replace: true, state: { flashMessage: "Admins only" } });
    }
  }, [user, navigate]);

  function handleTabChange(nextTab) {
    if (nextTab === "dashboard") {
      navigate("/dashboard");
      return;
    }
    if (nextTab === "profile") {
      navigate("/profile");
      return;
    }
    if (nextTab === "map") {
      navigate("/admin/map");
      return;
    }
    setTab(nextTab);
    navigate(`/admin?tab=${encodeURIComponent(nextTab)}`);
  }

  // Keep tab state synchronized with URL query params
  useEffect(() => {
    if (requestedTab && ADMIN_TABS.includes(requestedTab)) {
      setTab(requestedTab);
    }
  }, [requestedTab]);

  useEffect(() => {
    if (!notificationId) {
      handledNotificationId.current = null;
      return;
    }
    if (handledNotificationId.current === notificationId) return;

    const notification = notificationsQuery.data?.notifications?.find(
      (item) => String(item.id) === notificationId
    );
    if (!notification) return;

    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled || handledNotificationId.current === notificationId) return;

      handledNotificationId.current = notificationId;
      if (!notification.is_read) {
        api.markNotificationRead(notification.id)
          .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.notifications }))
          .catch(() => {});
      }
      if (notification.resource_type === "hazard_report") {
        setFocusedReportId(notification.resource_id);
        setFocusedRescueId(null);
        setTab("reports");
      } else {
        setFocusedRescueId(notification.resource_id);
        setFocusedReportId(null);
        setTab("rescue");
      }
    });
    return () => { cancelled = true; };
  }, [location.search, notificationId, notificationsQuery.data, queryClient]);

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
    const lat = Number(item.latitude ?? item.lat);
    const lng = Number(item.longitude ?? item.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const query = new URLSearchParams({
      lat: String(lat),
      lng: String(lng),
    });
    if (item.id) {
      if (item.request_status || item.number_of_people !== undefined || item.people_count !== undefined) {
        query.set("rescue", String(item.id));
      } else {
        query.set("hazard", String(item.id));
      }
    }
    navigate(`/admin/map?${query.toString()}`);
  }

  function refreshCenters() {
    return centersQuery.refetch();
  }

  return (
    <div className="dashboard-layout">
      <Sidebar
        tab={tab}
        setTab={handleTabChange}
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

        {/* DATA MANAGEMENT */}
        {tab === "data-management" && (
          <DataManagement />
        )}

        {/* SYSTEM & LOGS */}
        {tab === "settings" && (
          <SystemAndLogs
            logs={logs}
            user={user}
            loading={logsQuery.isLoading}
            error={logsQuery.error?.message || ""}
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
import { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { queryKeys, useEvacuationCenters, useHazardZones, useLogs, useNotifications } from "../../hooks/useEvacuationQueries";
import { useQueryClient } from "@tanstack/react-query";
import { useIsMobile } from "../../hooks/useIsMobile";

import Sidebar from "../../components/Sidebar/Sidebar";
import EvacuationCenterManager from "../../components/EvacuationCenter/EvacuationCenterManager";
import HazardReportReview from "../../components/HazardReportReview/HazardReportReview";
import UserManagement from "../../components/User/UserManagement";
import BarangayManager from "../../components/BarangayManager/BarangayManager";
import DataManagement from "../../components/DataManagement/DataManagement";
import SystemAndLogs from "../../components/ActivityLogs/SystemAndLogs";
import RescueRequestManager from "../../components/RescueRequestManager/RescueRequestManager";
import ResidentRegistrations from "../../components/ResidentRegistrations/ResidentRegistrations";
import EvacueeCheckIn from "../../components/EvacueeCheckIn/EvacueeCheckIn";

const ADMIN_TABS = ["centers", "barangays", "reports", "rescue", "checkin", "registrations", "users", "data-management", "settings"];
function AdminDashboard() {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const requestedTab = searchParams.get("tab");
  const notificationId = searchParams.get("notificationId");
  const resourceTypeParam = searchParams.get("resourceType");
  const resourceIdParam = searchParams.get("resourceId");
  const [tab, setTab] = useState(ADMIN_TABS.includes(requestedTab) ? requestedTab : "centers");
  const [focusedReportId, setFocusedReportId] = useState(null);
  const [focusedRescueId, setFocusedRescueId] = useState(null);
  const [focusedRegistrationId, setFocusedRegistrationId] = useState(null);
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

  // When visiting /admin directly without a tab, redirect to operational Dashboard
  useEffect(() => {
    if (!requestedTab) {
      navigate("/dashboard", { replace: true });
    }
  }, [requestedTab, navigate]);

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
    const focusKey = `${notificationId || ""}:${resourceTypeParam || ""}:${resourceIdParam || ""}`;
    if (!notificationId && !resourceTypeParam && !resourceIdParam) {
      handledNotificationId.current = null;
      return;
    }
    if (handledNotificationId.current === focusKey) return;

    const notification = notificationId
      ? notificationsQuery.data?.notifications?.find(
          (item) => String(item.id) === notificationId
        )
      : null;

    const resolvedResourceType = notification?.resource_type || resourceTypeParam;
    const resolvedResourceId =
      notification?.resource_id ?? (resourceIdParam ? Number(resourceIdParam) : null);

    if (!resolvedResourceType) return;

    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled || handledNotificationId.current === focusKey) return;

      handledNotificationId.current = focusKey;
      if (notification && !notification.is_read) {
        api.markNotificationRead(notification.id)
          .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.notifications }))
          .catch(() => { });
      }
      if (resolvedResourceType === "hazard_report") {
        setFocusedReportId(resolvedResourceId);
        setFocusedRescueId(null);
        setFocusedRegistrationId(null);
        setTab("reports");
      } else if (resolvedResourceType === "resident_registration" || resolvedResourceType === "resident_account") {
        setFocusedRegistrationId(resolvedResourceId);
        setFocusedReportId(null);
        setFocusedRescueId(null);
        setTab("registrations");
      } else {
        setFocusedRescueId(resolvedResourceId);
        setFocusedReportId(null);
        setFocusedRegistrationId(null);
        setTab("rescue");
      }
    });
    return () => { cancelled = true; };
  }, [location.search, notificationId, resourceTypeParam, resourceIdParam, notificationsQuery.data, queryClient]);

  function handleNotificationSelect(notification) {
    if (notification.resource_type === "hazard_report") {
      setFocusedReportId(notification.resource_id);
      setFocusedRescueId(null);
      setFocusedRegistrationId(null);
      setTab("reports");
    } else if (notification.resource_type === "resident_registration" || notification.resource_type === "resident_account") {
      setFocusedRegistrationId(notification.resource_id);
      setFocusedReportId(null);
      setFocusedRescueId(null);
      setTab("registrations");
    } else {
      setFocusedRescueId(notification.resource_id);
      setFocusedReportId(null);
      setFocusedRegistrationId(null);
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

        {tab === "checkin" && (
          <EvacueeCheckIn />
        )}

        {tab === "registrations" && <ResidentRegistrations focusRegistrationId={focusedRegistrationId} />}

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
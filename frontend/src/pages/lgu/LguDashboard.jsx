import { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTriangleExclamation, faXmark } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { queryKeys, useEvacuationCenters, useHazardZones, useLogs, useNotifications } from "../../hooks/useEvacuationQueries";
import { useQueryClient } from "@tanstack/react-query";
import { useIsMobile } from "../../hooks/useIsMobile";

import Sidebar from "../../components/Sidebar/Sidebar";
import EvacuationCenterManager from "../../components/EvacuationCenter/EvacuationCenterManager";
import HazardReportReview from "../../components/HazardReportReview/HazardReportReview";
import BarangayManager from "../../components/BarangayManager/BarangayManager";
import RescueRequestManager from "../../components/RescueRequestManager/RescueRequestManager";
import SystemAndLogs from "../../components/ActivityLogs/SystemAndLogs";
import ResidentRegistrations from "../../components/ResidentRegistrations/ResidentRegistrations";
import EvacueeCheckIn from "../../components/EvacueeCheckIn/EvacueeCheckIn";

function LguDashboard() {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const isCenterDetailRoute = location.pathname.startsWith("/lgu/evacuation-centers/");
  const rawRequestedTab = isCenterDetailRoute ? "centers" : searchParams.get("tab");
  const requestedTab =
    rawRequestedTab === "families" || rawRequestedTab === "overview"
      ? "barangays"
      : rawRequestedTab;
  const notificationId = searchParams.get("notificationId");
  const resourceTypeParam = searchParams.get("resourceType");
  const resourceIdParam = searchParams.get("resourceId");
  const hazardParam = searchParams.get("hazard");
  const rescueParam = searchParams.get("rescue");
  const [tab, setTab] = useState(["centers", "barangays", "reports", "rescue", "checkin", "registrations", "settings"].includes(requestedTab) ? requestedTab : "centers");
  const [flashNotice, setFlashNotice] = useState(location.state?.flashMessage || "");
  const [focusedReportId, setFocusedReportId] = useState(() => {
    if (!hazardParam) return null;
    const parsed = Number(hazardParam);
    return Number.isFinite(parsed) ? parsed : hazardParam;
  });
  const [focusedRescueId, setFocusedRescueId] = useState(() => {
    if (!rescueParam) return null;
    const parsed = Number(rescueParam);
    return Number.isFinite(parsed) ? parsed : rescueParam;
  });
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
    navigate(`/lgu?tab=${encodeURIComponent(nextTab)}`);
  }

  useEffect(() => {
    if (location.state?.flashMessage) {
      setFlashNotice(location.state.flashMessage);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  // When visiting /lgu directly without a tab, redirect to operational Dashboard
  useEffect(() => {
    if (!requestedTab) {
      navigate("/dashboard", { replace: true });
    }
  }, [requestedTab, navigate]);

  useEffect(() => {
    if (requestedTab === "data-management") {
      setFlashNotice("Admins only");
      setTab("centers");
      navigate("/lgu?tab=centers", { replace: true });
    } else if (requestedTab && ["centers", "barangays", "reports", "rescue", "checkin", "registrations", "settings"].includes(requestedTab)) {
      setTab(requestedTab);
    }
  }, [requestedTab, navigate]);

  useEffect(() => {
    if (!hazardParam) return;
    const parsed = Number(hazardParam);
    setFocusedReportId(Number.isFinite(parsed) ? parsed : hazardParam);
  }, [hazardParam]);

  useEffect(() => {
    if (!rescueParam) return;
    const parsed = Number(rescueParam);
    setFocusedRescueId(Number.isFinite(parsed) ? parsed : rescueParam);
  }, [rescueParam]);

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
          .catch(() => {});
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
      navigate("/lgu?tab=reports", { replace: true });
    } else if (notification.resource_type === "resident_registration" || notification.resource_type === "resident_account") {
      setFocusedRegistrationId(notification.resource_id);
      setFocusedReportId(null);
      setFocusedRescueId(null);
      setTab("registrations");
      navigate("/lgu?tab=registrations", { replace: true });
    } else {
      setFocusedRescueId(notification.resource_id);
      setFocusedReportId(null);
      setFocusedRegistrationId(null);
      setTab("rescue");
      navigate("/lgu?tab=rescue", { replace: true });
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
    const status = item.status || item.request_status;
    if (status) {
      query.set("status", String(status).toLowerCase());
    }
    navigate(`/lgu/map?${query.toString()}`);
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
        {flashNotice && (
          <div
            role="status"
            aria-live="polite"
            style={{
              position: "fixed",
              top: "24px",
              right: "24px",
              zIndex: 10000,
              maxWidth: "min(460px, calc(100vw - 32px))",
              padding: "12px 20px",
              borderRadius: "12px",
              background: "#0f172a",
              border: "1px solid rgba(248, 113, 113, 0.28)",
              color: "#ffffff",
              display: "flex",
              alignItems: "center",
              gap: "10px",
              fontSize: "0.875rem",
              fontWeight: "500",
              boxShadow: "var(--shadow-lg)",
            }}
          >
            <FontAwesomeIcon icon={faTriangleExclamation} style={{ color: "#f87171", flexShrink: 0 }} />
            <span>{flashNotice}</span>
            <button
              type="button"
              onClick={() => setFlashNotice("")}
              style={{
                marginLeft: "4px",
                background: "transparent",
                border: "none",
                color: "rgba(255, 255, 255, 0.65)",
                cursor: "pointer",
                padding: "4px 6px",
                borderRadius: "6px",
                fontSize: "14px",
                display: "inline-flex",
                alignItems: "center",
              }}
              aria-label="Dismiss"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>
        )}

        {/* EVACUATION CENTERS */}
        {tab === "centers" && (
          <EvacuationCenterManager
            centers={centers}
            hazardZones={hazardZones}
            onRefresh={refreshCenters}
            canDeactivate={false}
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

        {tab === "settings" && (
          <SystemAndLogs logs={logs} user={user} loading={logsQuery.isLoading} error={logsQuery.error?.message || ""} />
        )}
      </div>
    </div>
  );
}

export default LguDashboard;

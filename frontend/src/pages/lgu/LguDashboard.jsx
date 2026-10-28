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

function LguDashboard() {
  const requestedTab = new URLSearchParams(location.search).get("tab");
  const notificationId = new URLSearchParams(location.search).get("notificationId");
  const [tab, setTab] = useState(["centers", "barangays", "reports", "rescue", "settings"].includes(requestedTab) ? requestedTab : "centers");
  const [flashNotice, setFlashNotice] = useState(location.state?.flashMessage || "");
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

  useEffect(() => {
    if (requestedTab === "data-management") {
      setFlashNotice("Admins only");
      setTab("centers");
      navigate("/lgu?tab=centers", { replace: true });
    } else if (requestedTab && ["centers", "barangays", "reports", "rescue", "settings"].includes(requestedTab)) {
      setTab(requestedTab);
    }
  }, [requestedTab, navigate]);

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
      <div className="dashboard-content" style={{ overflow: "hidden" }}>
        {flashNotice && (
          <div
            style={{
              margin: "14px 20px 0",
              padding: "10px 16px",
              borderRadius: "8px",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              color: "#991b1b",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: "13.5px",
              fontWeight: "600",
              boxShadow: "0 2px 6px rgba(220, 38, 38, 0.08)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <FontAwesomeIcon icon={faTriangleExclamation} />
              <span>{flashNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setFlashNotice("")}
              style={{
                background: "none",
                border: "none",
                color: "#991b1b",
                cursor: "pointer",
                padding: "2px 6px",
                fontSize: "14px",
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

        {tab === "settings" && (
          <SystemAndLogs logs={logs} user={user} loading={logsQuery.isLoading} error={logsQuery.error?.message || ""} />
        )}
      </div>
    </div>
  );
}

export default LguDashboard;
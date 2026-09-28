import { useState, useEffect } from "react";
import { api } from "../../services/api";
import { useAuth } from "../../context/AuthContext";

import Sidebar from "../../components/Sidebar";
import EvacuationCenterManager from "../../components/EvacuationCenterManager";
import HazardReportReview from "../../components/HazardReportReview";
import UserManagement from "../../components/UserManagement";
import BarangayManager from "../../components/BarangayManager";
import SystemAndLogs from "../../components/SystemAndLogs";

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
  const [tab, setTab] = useState("centers");
  const [centers, setCenters] = useState(null);
  const [hazardZones, setHazardZones] = useState(null);
  const [logs, setLogs] = useState([]);

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
    if (tab === "settings") {
      api
        .getLogs()
        .then(setLogs)
        .catch(() => {});
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
          <HazardReportReview />
        )}

        {/* MANAGE USERS */}
        {tab === "users" && (
          <UserManagement />
        )}

        {/* SYSTEM & LOGS */}
        {tab === "settings" && <SystemAndLogs logs={logs} user={user} />}
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
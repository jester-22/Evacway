import { useState, useEffect } from "react";
import { api } from "../../services/api";
import { useAuth } from "../../context/AuthContext";

import Sidebar from "../../components/Sidebar";
import EvacuationCenterManager from "../../components/EvacuationCenterManager";
import HazardReportReview from "../../components/HazardReportReview";
import BarangayManager from "../../components/BarangayManager";

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

function LguDashboard() {
  const [tab, setTab] = useState("centers");
  const [centers, setCenters] = useState(null);
  const [hazardZones, setHazardZones] = useState(null);

  const { user, logout } = useAuth();
  const isMobile = useIsMobile();

  useEffect(() => {
    refreshCenters();

    api
      .getHazardZones()
      .then(setHazardZones)
      .catch(() => {});
  }, []);

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
      <div className="dashboard-content" style={{ overflow: "hidden" }}>
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
          <HazardReportReview />
        )}
      </div>
    </div>
  );
}

export default LguDashboard;
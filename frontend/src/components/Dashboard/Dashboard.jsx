import { useMemo, useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowsRotate,
  faArrowRight,
  faCircleCheck,
  faUserCheck,
  faPersonWalking,
  faDoorOpen,
  faClock,
  faHouseFlag,
  faLifeRing,
  faLocationDot,
  faPeopleGroup,
  faTriangleExclamation,
  faUsers,
  faMapLocationDot,
  faChartPie,
  faShieldHalved,
  faBolt,
  faMagnifyingGlass,
  faBell,
  faXmark,
  faSpinner,
} from "@fortawesome/free-solid-svg-icons";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../services/api";
import {
  useDashboardSummary,
  useBarangays,
  useHazardReports,
  useRescueRequests,
} from "../../hooks/useEvacuationQueries";
import LoadingState from "../LoadingState/LoadingState";
import Sidebar from "../Sidebar/Sidebar";
import { useIsMobile } from "../../hooks/useIsMobile";
import "./Dashboard.css";

function decodeVapidKey(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(window.atob(base64), (character) => character.charCodeAt(0));
}

async function getOrRegisterServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  let reg = await navigator.serviceWorker.getRegistration();
  if (!reg) {
    reg = await navigator.serviceWorker.register("/sw.js");
  }
  if (reg.active) return reg;

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(reg), 1500);
    navigator.serviceWorker.ready.then((readyReg) => {
      clearTimeout(timer);
      resolve(readyReg);
    }).catch(() => {
      clearTimeout(timer);
      resolve(reg);
    });
  });
}

function formatCount(value) {
  return Number(value || 0).toLocaleString();
}

function percentage(value, total) {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function formatTimeAgo(dateString) {
  if (!dateString) return "Recently";
  const date = new Date(dateString);
  const now = new Date();
  const diffInMinutes = Math.floor((now - date) / (1000 * 60));
  if (diffInMinutes < 1) return "Just now";
  if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}h ago`;
  const diffInDays = Math.floor(diffInHours / 24);
  return `${diffInDays}d ago`;
}

function getReadinessStatus({
  openRescueCount = 0,
  totalCapacity = 0,
  totalAssignedPeople = 0,
  unassignedFamilies = 0,
  pendingHazardCount = 0,
  pendingArrivalFamilies = 0,
}) {
  const totalRemaining = Math.max(0, totalCapacity - totalAssignedPeople);
  const isCapacityLow = totalCapacity > 0 && totalRemaining / totalCapacity < 0.1;

  if (openRescueCount > 0 || isCapacityLow) {
    const reasons = [];
    if (openRescueCount > 0) {
      reasons.push(`${openRescueCount} open rescue request${openRescueCount > 1 ? "s" : ""}`);
    }
    if (isCapacityLow) {
      const remainingPercent = Math.round((totalRemaining / totalCapacity) * 100);
      reasons.push(`Remaining shelter capacity below 10% (${remainingPercent}%)`);
    }
    return {
      status: "action_needed",
      label: "Critical Action Needed",
      badgeClass: "ds-badge ds-badge--danger",
      dotColor: "bg-red-500",
      barColor: "bg-red-500",
      reason: reasons.join(", "),
    };
  }

  if (unassignedFamilies > 0 || pendingHazardCount > 0 || pendingArrivalFamilies > 0) {
    const reasons = [];
    if (pendingArrivalFamilies > 0) {
      reasons.push(`${formatCount(pendingArrivalFamilies)} family arrival${pendingArrivalFamilies > 1 ? "s" : ""} pending`);
    }
    if (unassignedFamilies > 0) {
      reasons.push(`${formatCount(unassignedFamilies)} unassigned household${unassignedFamilies > 1 ? "s" : ""}`);
    }
    if (pendingHazardCount > 0) {
      reasons.push(`${pendingHazardCount} pending hazard report${pendingHazardCount > 1 ? "s" : ""}`);
    }
    return {
      status: "monitoring",
      label: "Active Monitoring",
      badgeClass: "ds-badge ds-badge--warning",
      dotColor: "bg-amber-500",
      barColor: "bg-amber-500",
      reason: reasons.join(", "),
    };
  }

  return {
    status: "ready",
    label: "All Shelters Ready",
    badgeClass: "ds-badge ds-badge--success",
    dotColor: "bg-emerald-500",
    barColor: "bg-emerald-500",
    reason: "All assigned evacuees verified on site & within headroom",
  };
}

/* -------------------------------------------------------------
   SVG CIRCULAR RADIAL GAUGE
   ------------------------------------------------------------- */
function CircularRadialGauge({ percent = 0, strokeColor = "#10b981", label = "Arrived", size = 104 }) {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, percent));
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div
      className="relative shrink-0 flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg className="size-full dashboard-donut-ring" viewBox="0 0 100 100">
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth="8"
        />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="dashboard-gauge-arc"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="dashboard-mono text-lg font-black text-slate-900 leading-none">
          {clamped}%
        </span>
        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-1">
          {label}
        </span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------
   SLICK EXECUTIVE KPI CARD
   ------------------------------------------------------------- */
function ExecutiveKpiCard({
  title,
  value,
  subtext,
  icon,
  accentColor,
  trendText,
  trendType = "neutral",
  onClick,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="dashboard-kpi-card text-left flex flex-col justify-between group cursor-pointer w-full focus:outline-none focus:ring-2 focus:ring-blue-500/40"
    >
      <div
        className="dashboard-kpi-glow"
        style={{ backgroundColor: accentColor }}
      />
      <div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider truncate">
            {title}
          </span>
          <span
            className="grid size-9 shrink-0 place-items-center rounded-xl transition-transform duration-200 group-hover:scale-110"
            style={{ backgroundColor: `${accentColor}18`, color: accentColor }}
          >
            <FontAwesomeIcon icon={icon} className="text-sm" />
          </span>
        </div>

        <p className="dashboard-mono mt-2 text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
          {formatCount(value)}
        </p>
      </div>

      <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
        <span className="text-slate-500 truncate font-medium">{subtext}</span>
        {trendText && (
          <span
            className={`dashboard-mono text-[11px] font-bold shrink-0 px-2 py-0.5 rounded-full ${
              trendType === "danger"
                ? "bg-red-50 text-red-700 border border-red-200"
                : trendType === "warning"
                ? "bg-amber-50 text-amber-700 border border-amber-200"
                : trendType === "success"
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : "bg-slate-100 text-slate-600"
            }`}
          >
            {trendText}
          </span>
        )}
      </div>
    </button>
  );
}

/* -------------------------------------------------------------
   ROOM UTILIZATION DONUT CHART
   ------------------------------------------------------------- */
function RoomDonutChart({ total = 0, assigned = 0, unassigned = 0, onManage }) {
  const percent = total > 0 ? Math.round((assigned / total) * 100) : 0;
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percent / 100) * circumference;

  return (
    <div className="flex flex-col justify-between h-full space-y-4">
      <div className="flex items-center gap-5 p-3.5 rounded-2xl bg-slate-50/70 border border-slate-100">
        <div className="relative size-24 shrink-0 flex items-center justify-center">
          <svg className="size-full dashboard-donut-ring" viewBox="0 0 100 100">
            <defs>
              <linearGradient id="roomDonutGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#4f46e5" />
                <stop offset="100%" stopColor="#6366f1" />
              </linearGradient>
            </defs>
            <circle
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke="#e2e8f0"
              strokeWidth="10"
            />
            {total > 0 && (
              <circle
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                stroke="url(#roomDonutGrad)"
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                className="dashboard-gauge-arc"
              />
            )}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="dashboard-mono text-base font-black text-slate-900 leading-none">
              {percent}%
            </span>
            <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">
              Allocated
            </span>
          </div>
        </div>

        <div className="space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
            Room Inventory
          </span>
          <p className="dashboard-mono text-lg font-black text-slate-900 leading-tight">
            {formatCount(assigned)}{" "}
            <span className="text-xs font-semibold text-slate-400">of {formatCount(total)} in use</span>
          </p>
          <p className="text-[11px] text-slate-500 font-medium">
            Rooms sheltering registered evacuee households
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between p-2.5 rounded-xl border border-slate-100 bg-white">
          <div className="flex items-center gap-2.5">
            <span className="size-2.5 rounded-full bg-indigo-600 shadow-xs" />
            <div>
              <span className="text-xs font-bold text-slate-800 block">Assigned Rooms</span>
              <span className="text-[10px] text-slate-400">Housing verified families</span>
            </div>
          </div>
          <div className="text-right">
            <span className="dashboard-mono text-xs font-bold text-slate-900 block">
              {formatCount(assigned)}
            </span>
            <span className="dashboard-mono text-[10px] text-slate-400 font-medium">
              {percent}% load
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between p-2.5 rounded-xl border border-slate-100 bg-white">
          <div className="flex items-center gap-2.5">
            <span className="size-2.5 rounded-full bg-emerald-500 shadow-xs" />
            <div>
              <span className="text-xs font-bold text-slate-800 block">Available Rooms</span>
              <span className="text-[10px] text-slate-400">Vacant & ready for intake</span>
            </div>
          </div>
          <div className="text-right">
            <span className="dashboard-mono text-xs font-bold text-emerald-700 block">
              {formatCount(unassigned)}
            </span>
            <span className="dashboard-mono text-[10px] text-emerald-600 font-medium">
              {percentage(unassigned, total)}% free
            </span>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onManage}
        className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition"
      >
        <FontAwesomeIcon icon={faDoorOpen} className="text-slate-500 text-xs" />
        <span>Manage Shelter Facilities</span>
        <FontAwesomeIcon icon={faArrowRight} className="text-[10px] text-slate-400 ml-1" />
      </button>
    </div>
  );
}

/* -------------------------------------------------------------
   MAIN COMPONENT
   ------------------------------------------------------------- */
function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const isAdmin = user?.role === "admin";

  const refreshOptions = {
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  };

  const { stats, isLoading, isFetching, error, refetch: refetchSummary } = useDashboardSummary(isAdmin);
  const { data: barangaysData, refetch: refetchBarangays } = useBarangays(refreshOptions);
  const { data: hazardReportsData, refetch: refetchHazardReports } = useHazardReports("all", refreshOptions);
  const { data: rescueRequestsData, refetch: refetchRescueRequests } = useRescueRequests(refreshOptions);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [barangayMetric, setBarangayMetric] = useState("households");
  const [barangaySearch, setBarangaySearch] = useState("");
  const [centerFilter, setCenterFilter] = useState("all"); // "all" | "arrived" | "high" | "available"
  const [activeFeedTab, setActiveFeedTab] = useState("rescue"); // "rescue" | "hazards"

  const [pushStatus, setPushStatus] = useState("checking");
  const [pushStripDismissed, setPushStripDismissed] = useState(() => {
    try {
      return sessionStorage.getItem("evacway_push_strip_dismissed") === "true";
    } catch {
      return false;
    }
  });
  const [pushActivating, setPushActivating] = useState(false);
  const [pushSuccess, setPushSuccess] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setPushStatus("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setPushStatus("denied");
      return;
    }
    getOrRegisterServiceWorker().then((reg) => {
      if (!reg) {
        setPushStatus("inactive");
        return;
      }
      reg.pushManager.getSubscription().then((sub) => {
        if (sub) {
          setPushStatus("active");
        } else {
          setPushStatus("inactive");
        }
      }).catch(() => setPushStatus("inactive"));
    }).catch(() => setPushStatus("inactive"));
  }, []);

  const handleActivatePushFromDashboard = useCallback(async () => {
    setPushActivating(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushStatus("denied");
        return;
      }
      const reg = await getOrRegisterServiceWorker();
      if (!reg) return;

      const config = await api.getVapidPublicKey();
      if (!config.enabled || !config.public_key) return;

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeVapidKey(config.public_key),
        });
      }
      await api.savePushSubscription(sub.toJSON());
      setPushStatus("active");
      setPushSuccess(true);
      setTimeout(() => {
        setPushSuccess(false);
      }, 2500);
    } catch (err) {
      console.warn("Failed to activate push notifications:", err);
    } finally {
      setPushActivating(false);
    }
  }, []);

  async function handleRefreshAll() {
    setIsRefreshing(true);
    try {
      await Promise.all([
        refetchSummary(),
        refetchBarangays(),
        refetchHazardReports(),
        refetchRescueRequests(),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  }

  function handleSectionChange(nextTab, extraParams = {}) {
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
    const path = isAdmin ? "/admin" : "/lgu";
    const query = new URLSearchParams({ tab: nextTab, ...extraParams }).toString();
    navigate(`${path}?${query}`);
  }

  function handleNotificationSelect(notification) {
    const path = isAdmin ? "/admin" : "/lgu";
    let tab = "rescue";
    if (notification.resource_type === "hazard_report") {
      tab = "reports";
    } else if (notification.resource_type === "resident_registration" || notification.resource_type === "resident_account") {
      tab = "registrations";
    }
    navigate(`${path}?tab=${tab}&notificationId=${notification.id}`);
  }

  const todayFormatted = useMemo(() => {
    return new Date().toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }, []);

  // Family Arrival Metrics
  const arrivedFamilies = Number(stats?.arrivedFamilies || 0);
  const partialFamilies = Number(stats?.partialFamilies || 0);
  const totalArrivedFamilies = Number(stats?.totalArrivedFamilies || arrivedFamilies + partialFamilies);
  const assignedFamilies = Number(stats?.assignedFamilies || 0);
  const pendingArrivalFamilies = Number(stats?.pendingArrivalFamilies || Math.max(0, assignedFamilies - totalArrivedFamilies));
  const unassignedFamilies = Number(stats?.unassignedFamilies || 0);
  const totalFamilies = Number(stats?.families || 0);

  // Resident Headcount Arrival Metrics
  const arrivedResidents = Number(stats?.arrivedResidents || 0);
  const assignedResidents = Number(stats?.assignedResidents || 0);
  const pendingResidents = Number(stats?.pendingResidents || Math.max(0, assignedResidents - arrivedResidents));

  // Key Arrival Rates
  const familyArrivalRate = percentage(totalArrivedFamilies, assignedFamilies);
  const residentArrivalRate = percentage(arrivedResidents, assignedResidents);
  const assignedFamiliesRate = percentage(assignedFamilies, totalFamilies);

  // Incidents
  const rescueList = useMemo(() => {
    return Array.isArray(rescueRequestsData) ? rescueRequestsData : [];
  }, [rescueRequestsData]);

  const hazardList = useMemo(() => {
    return Array.isArray(hazardReportsData) ? hazardReportsData : [];
  }, [hazardReportsData]);

  const openRescueCount = useMemo(() => {
    return rescueList.filter((r) => r.status !== "resolved").length;
  }, [rescueList]);

  const pendingHazardCount = useMemo(() => {
    return hazardList.filter((h) => h.status === "pending").length;
  }, [hazardList]);

  // Operational metrics
  const totalCapacity = Number(stats?.totalCapacity || 0);
  const totalRemainingCapacity = Math.max(0, totalCapacity - (stats?.totalOccupiedPeople || 0));
  const remainingPercent = totalCapacity > 0 ? Math.round((totalRemainingCapacity / totalCapacity) * 100) : 0;
  const capacityUsedPercent = totalCapacity > 0 ? Math.min(100, Math.round(((stats?.totalOccupiedPeople || 0) / totalCapacity) * 100)) : 0;

  // Overall readiness status
  const readiness = useMemo(() => {
    return getReadinessStatus({
      openRescueCount,
      totalCapacity,
      totalAssignedPeople: stats?.totalAssignedPeople || 0,
      unassignedFamilies,
      pendingHazardCount,
      pendingArrivalFamilies,
    });
  }, [openRescueCount, totalCapacity, stats, unassignedFamilies, pendingHazardCount, pendingArrivalFamilies]);

  // Center Check-In Map
  const checkInCenterMap = useMemo(() => {
    const map = new Map();
    (stats?.checkInCenters || []).forEach((c) => {
      map.set(String(c.id), c);
    });
    return map;
  }, [stats?.checkInCenters]);

  // Center Occupancy List
  const centersProcessed = useMemo(() => {
    const list = Array.isArray(stats?.centerRooms) ? [...stats.centerRooms] : [];
    return list
      .map((center) => {
        const checkInData = checkInCenterMap.get(String(center.id));
        const capacity = Number(center.capacity || checkInData?.capacity || 0);
        const checkedInCount = Number(checkInData?.checked_in ?? center.occupiedPeople ?? 0);
        const assignedCount = Number(checkInData?.assigned ?? center.assignedPeople ?? 0);
        const occupiedPercent = capacity > 0 ? Math.min(100, Math.round((checkedInCount / capacity) * 100)) : 0;
        const assignedPercent = capacity > 0 ? Math.min(100, Math.round((assignedCount / capacity) * 100)) : 0;
        const arrivalPercent = assignedCount > 0 ? Math.min(100, Math.round((checkedInCount / assignedCount) * 100)) : 0;

        return {
          ...center,
          capacity,
          checkedInCount,
          assignedCount,
          occupiedPercent,
          assignedPercent,
          arrivalPercent,
        };
      })
      .sort((a, b) => b.checkedInCount - a.checkedInCount || b.assignedPercent - a.assignedPercent || a.name.localeCompare(b.name));
  }, [stats, checkInCenterMap]);

  const filteredCenters = useMemo(() => {
    if (centerFilter === "arrived") {
      return centersProcessed.filter((c) => c.checkedInCount > 0);
    }
    if (centerFilter === "high") {
      return centersProcessed.filter((c) => c.occupiedPercent >= 70);
    }
    if (centerFilter === "available") {
      return centersProcessed.filter((c) => c.occupiedPercent < 70);
    }
    return centersProcessed;
  }, [centersProcessed, centerFilter]);

  // Consolidated Priority Triage Items
  const urgentActionItems = useMemo(() => {
    if (!stats) return [];
    const items = [];

    // Pending arrivals need attention
    if (pendingArrivalFamilies > 0) {
      items.push({
        id: "pending-arrivals",
        severity: "warning",
        icon: faPersonWalking,
        title: `${formatCount(pendingArrivalFamilies)} Household${pendingArrivalFamilies > 1 ? "s" : ""} En Route / Awaiting Intake`,
        subtitle: `${formatCount(pendingResidents)} residents assigned but not yet verified at shelter desk`,
        tab: "checkin",
        action: "Check-In Desk",
      });
    }

    if (openRescueCount > 0) {
      items.push({
        id: "open-rescues",
        severity: "danger",
        icon: faLifeRing,
        title: `${openRescueCount} Citizen Distress Rescue Call${openRescueCount > 1 ? "s" : ""}`,
        subtitle: "Immediate field response required",
        tab: "rescue",
        action: "Respond Now",
      });
    }

    if (pendingHazardCount > 0) {
      items.push({
        id: "pending-hazards",
        severity: "warning",
        icon: faTriangleExclamation,
        title: `${pendingHazardCount} Pending Hazard Obstacle Report${pendingHazardCount > 1 ? "s" : ""}`,
        subtitle: "Awaiting field verification",
        tab: "reports",
        action: "Review",
      });
    }

    if (unassignedFamilies > 0) {
      items.push({
        id: "unassigned-households",
        severity: "info",
        icon: faPeopleGroup,
        title: `${formatCount(unassignedFamilies)} Unassigned Household${unassignedFamilies > 1 ? "s" : ""}`,
        subtitle: "Awaiting shelter room assignment",
        tab: "barangays",
        action: "Assign",
      });
    }

    const centersList = Array.isArray(stats.centerRooms) ? stats.centerRooms : [];
    centersList.forEach((center) => {
      const cap = Number(center.capacity || 0);
      const assigned = Number(center.assignedPeople || 0);
      const remaining = Math.max(0, cap - assigned);
      if (cap > 0 && remaining / cap < 0.1) {
        items.push({
          id: `low-capacity-${center.id}`,
          severity: "danger",
          icon: faHouseFlag,
          title: `${center.name} Near Full (<10% headroom)`,
          subtitle: `Only ${formatCount(remaining)} spaces available`,
          tab: "centers",
          action: "Inspect",
        });
      }
    });

    return items;
  }, [stats, pendingArrivalFamilies, pendingResidents, openRescueCount, pendingHazardCount, unassignedFamilies]);

  // All Barangays Demographic Data (Ranked & Filterable)
  const allBarangays = useMemo(() => {
    const list = Array.isArray(barangaysData) ? [...barangaysData] : [];
    if (!list.length) return [];
    const metricKey = barangayMetric === "residents" ? "resident_count" : "household_count";
    return list
      .map((b) => ({
        ...b,
        val: Number(b[metricKey] || 0),
      }))
      .sort((a, b) => b.val - a.val || a.name.localeCompare(b.name))
      .map((b, index) => ({
        ...b,
        rank: index + 1,
      }));
  }, [barangaysData, barangayMetric]);

  const filteredBarangays = useMemo(() => {
    if (!barangaySearch.trim()) return allBarangays;
    const q = barangaySearch.trim().toLowerCase();
    return allBarangays.filter((b) => b.name?.toLowerCase().includes(q));
  }, [allBarangays, barangaySearch]);

  const maxBarangayVal = useMemo(() => {
    if (!allBarangays.length) return 1;
    return Math.max(...allBarangays.map((b) => b.val || 0), 1);
  }, [allBarangays]);

  return (
    <div className="dashboard-layout">
      <Sidebar
        tab="dashboard"
        setTab={handleSectionChange}
        user={user}
        logout={logout}
        isMobile={isMobile}
        onSelectNotification={handleNotificationSelect}
        unmappedCentersCount={0}
      />

      <main className="dashboard-content dashboard-page">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 space-y-6">
          {/* Push Notification Activation Prompt (Hides once activated) */}
          {(pushStatus === "inactive" || pushSuccess) && !pushStripDismissed && (
            <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 rounded-2xl border text-xs font-semibold transition ${
              pushSuccess
                ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                : "bg-blue-50/90 border-blue-200 text-blue-900 shadow-2xs"
            }`}>
              <div className="flex items-center gap-2.5">
                <FontAwesomeIcon
                  icon={pushSuccess ? faCircleCheck : faBell}
                  className={`text-sm ${pushSuccess ? "text-emerald-600" : "text-blue-600 animate-pulse"}`}
                />
                <span>
                  {pushSuccess
                    ? "✓ Push notifications activated! Real-time alerts are now enabled."
                    : "Push notifications are currently inactive on this device. Allow notifications to receive instant alerts for resident accounts and emergency rescues."}
                </span>
              </div>
              {!pushSuccess && (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleActivatePushFromDashboard}
                    disabled={pushActivating}
                    className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs transition shadow-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    {pushActivating ? (
                      <>
                        <FontAwesomeIcon icon={faSpinner} spin className="text-[11px]" />
                        <span>Activating...</span>
                      </>
                    ) : (
                      <span>Allow & Activate</span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPushStripDismissed(true);
                      try { sessionStorage.setItem("evacway_push_strip_dismissed", "true"); } catch {}
                    }}
                    className="p-1.5 text-blue-400 hover:text-blue-700 rounded-lg transition cursor-pointer"
                    title="Dismiss"
                  >
                    <FontAwesomeIcon icon={faXmark} />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 1. EXECUTIVE COMMAND HEADER */}
          <header className="dashboard-card p-5 sm:p-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <FontAwesomeIcon icon={faClock} className="text-slate-400 text-[11px]" />
                <span>{todayFormatted}</span>
                <span className="text-slate-300">•</span>
                <span className="text-blue-600 font-bold">Sogod Command Center</span>
              </div>
              <h1 className="dashboard-heading mt-1 text-2xl font-black text-slate-900 sm:text-3xl tracking-tight">
                Welcome back, {user?.name || "Officer"}
              </h1>
              <p className="mt-0.5 text-xs sm:text-sm text-slate-500 font-medium">
                Live evacuation arrival tracking, shelter capacity management, and incident dispatch
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => handleSectionChange("checkin")}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-700 shadow-xs transition"
              >
                <FontAwesomeIcon icon={faUserCheck} />
                <span>Evacuee Check-In Desk</span>
              </button>

              <button
                type="button"
                onClick={() => handleSectionChange("map")}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-blue-700 shadow-xs transition"
              >
                <FontAwesomeIcon icon={faMapLocationDot} />
                <span>Map Operations</span>
              </button>

              <button
                type="button"
                onClick={handleRefreshAll}
                disabled={isRefreshing}
                title="Sync all metrics now"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition shadow-2xs"
              >
                <FontAwesomeIcon
                  icon={faArrowsRotate}
                  className={`text-slate-500 ${isRefreshing || isFetching ? "fa-spin text-blue-600" : ""}`}
                />
                <span>{isRefreshing || isFetching ? "Syncing..." : "Sync"}</span>
              </button>
            </div>
          </header>

          {/* ERROR ALERT */}
          {error && !isLoading && (
            <div
              className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800 shadow-xs"
              role="alert"
            >
              <div>
                <p className="font-bold flex items-center gap-2 text-sm">
                  <FontAwesomeIcon icon={faTriangleExclamation} />
                  Failed to synchronize operational metrics
                </p>
                <p className="mt-1 text-xs text-red-700">{error?.message || String(error)}</p>
              </div>
              <button
                type="button"
                className="shrink-0 px-4 py-2 rounded-xl bg-red-600 text-white text-xs font-bold hover:bg-red-700 transition"
                onClick={handleRefreshAll}
              >
                Retry Sync
              </button>
            </div>
          )}

          {/* MAIN CONTENT AREA */}
          {stats ? (
            <>
              {/* 2. EVACUEE ARRIVAL & SHELTERING COMMAND HERO */}
              <section className="dashboard-hero-banner p-5 sm:p-6" aria-label="Evacuation arrival and sheltering status">
                <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between relative z-10">
                  <div className="flex-1 min-w-0 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`ds-badge ${readiness.badgeClass}`}>
                          <span
                            className={`size-2 rounded-full ${readiness.dotColor} ${
                              readiness.status !== "ready" ? "beacon-pulse" : ""
                            }`}
                          />
                          {readiness.label}
                        </span>
                        {readiness.reason && (
                          <span className="text-xs font-semibold text-slate-600">
                            {readiness.reason}
                          </span>
                        )}
                      </div>
                    </div>

                    <div>
                      <h2 className="dashboard-heading text-lg sm:text-xl font-black text-slate-900 tracking-tight">
                        Evacuee Arrival &amp; Shelter Check-In Status
                      </h2>
                      <p className="text-xs sm:text-sm text-slate-600 font-medium mt-1 leading-relaxed">
                        <span className="dashboard-mono font-black text-emerald-700">
                          {formatCount(totalArrivedFamilies)}
                        </span>{" "}
                        of{" "}
                        <span className="dashboard-mono font-bold text-slate-900">
                          {formatCount(assignedFamilies)}
                        </span>{" "}
                        assigned households have verified safe arrival across evacuation centers (
                        <span className="font-bold text-emerald-700">{familyArrivalRate}% verified on-site</span>
                        ).{" "}
                        {pendingArrivalFamilies > 0 ? (
                          <span className="font-bold text-amber-700">
                            {formatCount(pendingArrivalFamilies)} households are currently en route or awaiting intake.
                          </span>
                        ) : (
                          <span className="font-bold text-emerald-700">
                            All assigned families have arrived safely!
                          </span>
                        )}
                      </p>
                    </div>

                    {/* High-Impact Arrival Metric Badges */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                      <div className="p-3 rounded-xl bg-white/95 border border-slate-200/80 shadow-2xs flex flex-col justify-between">
                        <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider truncate">
                          Arrived Families
                        </span>
                        <span className="dashboard-mono text-lg font-black text-emerald-700 mt-1">
                          {formatCount(totalArrivedFamilies)}
                        </span>
                        <span className="text-[11px] text-slate-500 font-medium mt-0.5 truncate">
                          {formatCount(arrivedResidents)} residents
                        </span>
                      </div>

                      <div className="p-3 rounded-xl bg-white/95 border border-slate-200/80 shadow-2xs flex flex-col justify-between">
                        <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider truncate">
                          Pending Arrival
                        </span>
                        <span className="dashboard-mono text-lg font-black text-amber-600 mt-1">
                          {formatCount(pendingArrivalFamilies)}
                        </span>
                        <span className="text-[11px] text-slate-500 font-medium mt-0.5 truncate">
                          {formatCount(pendingResidents)} residents
                        </span>
                      </div>

                      <div className="p-3 rounded-xl bg-white/95 border border-slate-200/80 shadow-2xs flex flex-col justify-between">
                        <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider truncate">
                          Assigned Total
                        </span>
                        <span className="dashboard-mono text-lg font-black text-blue-700 mt-1">
                          {formatCount(assignedFamilies)}
                        </span>
                        <span className="text-[11px] text-slate-500 font-medium mt-0.5 truncate">
                          {assignedFamiliesRate}% of municipality
                        </span>
                      </div>

                      <div className="p-3 rounded-xl bg-white/95 border border-slate-200/80 shadow-2xs flex flex-col justify-between">
                        <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider truncate">
                          Unassigned
                        </span>
                        <span className="dashboard-mono text-lg font-black text-slate-700 mt-1">
                          {formatCount(unassignedFamilies)}
                        </span>
                        <span className="text-[11px] text-slate-500 font-medium mt-0.5 truncate">
                          Needs allocation
                        </span>
                      </div>
                    </div>

                    {/* Progress Spectrum Bar */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2 text-[11px] font-bold text-slate-500">
                        <span>Evacuee Arrival Distribution</span>
                        <span className="dashboard-mono shrink-0">
                          {familyArrivalRate}% Arrived · {100 - familyArrivalRate}% Pending
                        </span>
                      </div>
                      <div className="h-2.5 w-full rounded-full bg-slate-200/80 overflow-hidden flex shadow-inner">
                        <div
                          className="h-full bg-emerald-500 transition-all duration-700"
                          style={{ width: `${familyArrivalRate}%` }}
                          title={`Arrived: ${formatCount(totalArrivedFamilies)} families`}
                        />
                        <div
                          className="h-full bg-amber-400 transition-all duration-700"
                          style={{ width: `${Math.max(0, 100 - familyArrivalRate)}%` }}
                          title={`Pending: ${formatCount(pendingArrivalFamilies)} families`}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Dual Radial Gauges */}
                  <div className="flex items-center justify-center gap-6 sm:gap-8 shrink-0 bg-white/95 px-6 py-5 rounded-2xl border border-slate-200/80 shadow-2xs">
                    <div className="flex flex-col items-center text-center">
                      <CircularRadialGauge
                        percent={familyArrivalRate}
                        strokeColor={familyArrivalRate >= 80 ? "#10b981" : familyArrivalRate >= 40 ? "#3b82f6" : "#f59e0b"}
                        label="Arrived"
                        size={104}
                      />
                      <span className="text-xs font-bold text-slate-700 mt-2">
                        Arrival Rate
                      </span>
                      <span className="text-[10px] text-slate-400 font-medium">
                        {formatCount(totalArrivedFamilies)} / {formatCount(assignedFamilies)} families
                      </span>
                    </div>

                    <div className="h-20 w-px bg-slate-200/80" />

                    <div className="flex flex-col items-center text-center">
                      <CircularRadialGauge
                        percent={capacityUsedPercent}
                        strokeColor={capacityUsedPercent > 90 ? "#ef4444" : "#4f46e5"}
                        label="Capacity"
                        size={104}
                      />
                      <span className="text-xs font-bold text-slate-700 mt-2">
                        Shelter Load
                      </span>
                      <span className="text-[10px] text-slate-400 font-medium">
                        {formatCount(stats?.totalOccupiedPeople || 0)} / {formatCount(totalCapacity)} on-site
                      </span>
                    </div>
                  </div>
                </div>
              </section>

              {/* 3. EXECUTIVE KPI METRICS (4 Actionable Command Tiles) */}
              <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4" aria-label="Executive KPI tiles">
                {/* 1. Verified Arrived Families */}
                <ExecutiveKpiCard
                  title="Families Arrived"
                  value={totalArrivedFamilies}
                  subtext={`${formatCount(arrivedResidents)} residents on-site`}
                  icon={faUserCheck}
                  accentColor="#10b981"
                  trendText={`${familyArrivalRate}% arrived`}
                  trendType={familyArrivalRate >= 70 ? "success" : "warning"}
                  onClick={() => handleSectionChange("checkin")}
                />

                {/* 2. Pending Arrival (En Route) */}
                <ExecutiveKpiCard
                  title="Pending Arrival"
                  value={pendingArrivalFamilies}
                  subtext={`${formatCount(pendingResidents)} residents en route`}
                  icon={faPersonWalking}
                  accentColor="#f59e0b"
                  trendText={pendingArrivalFamilies > 0 ? "Awaiting Intake" : "None Pending"}
                  trendType={pendingArrivalFamilies > 0 ? "warning" : "success"}
                  onClick={() => handleSectionChange("checkin")}
                />

                {/* 3. Available Headroom */}
                <ExecutiveKpiCard
                  title="Available Headroom"
                  value={totalRemainingCapacity}
                  subtext={`of ${formatCount(totalCapacity)} total capacity`}
                  icon={faDoorOpen}
                  accentColor={remainingPercent < 15 ? "#ef4444" : "#3b82f6"}
                  trendText={`${remainingPercent}% free`}
                  trendType={remainingPercent < 15 ? "danger" : "success"}
                  onClick={() => handleSectionChange("centers")}
                />

                {/* 4. Emergency Alerts & Incidents */}
                <ExecutiveKpiCard
                  title="Emergency Alerts"
                  value={openRescueCount + pendingHazardCount}
                  subtext={`${openRescueCount} Rescues · ${pendingHazardCount} Hazards`}
                  icon={faLifeRing}
                  accentColor={openRescueCount > 0 ? "#ef4444" : pendingHazardCount > 0 ? "#f59e0b" : "#64748b"}
                  trendText={openRescueCount > 0 ? "Needs Rescue" : pendingHazardCount > 0 ? "Needs Review" : "All Clear"}
                  trendType={openRescueCount > 0 ? "danger" : pendingHazardCount > 0 ? "warning" : "success"}
                  onClick={() => handleSectionChange(openRescueCount > 0 ? "rescue" : "reports")}
                />
              </section>

              {/* 4. SHELTER OPERATIONS & ARRIVAL BREAKDOWN PER CENTER */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Left 8 cols: Center Arrival & Capacity Matrix */}
                <section className="dashboard-card p-5 sm:p-6 lg:col-span-8 flex flex-col justify-between" aria-label="Center arrivals matrix">
                  <div>
                    {/* Header + Filter controls */}
                    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <FontAwesomeIcon icon={faHouseFlag} className="text-blue-600 text-sm" />
                          <h2 className="dashboard-heading text-lg font-black text-slate-900 tracking-tight">
                            Center Arrival & Capacity Matrix
                          </h2>
                        </div>
                        <p className="text-xs text-slate-500 font-medium mt-0.5">
                          Verified evacuee arrivals vs assigned household rosters across shelters
                        </p>
                      </div>

                      {/* Filter Pills */}
                      <div className="flex items-center p-1 rounded-xl bg-slate-100 border border-slate-200/60 text-xs font-bold">
                        <button
                          type="button"
                          onClick={() => setCenterFilter("all")}
                          className={`px-3 py-1 rounded-lg transition cursor-pointer ${
                            centerFilter === "all"
                              ? "bg-white text-blue-700 shadow-2xs font-extrabold"
                              : "text-slate-600 hover:text-slate-900"
                          }`}
                        >
                          All ({centersProcessed.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setCenterFilter("arrived")}
                          className={`px-3 py-1 rounded-lg transition cursor-pointer ${
                            centerFilter === "arrived"
                              ? "bg-white text-emerald-700 shadow-2xs font-extrabold"
                              : "text-slate-600 hover:text-slate-900"
                          }`}
                        >
                          Arrived (&gt;0)
                        </button>
                        <button
                          type="button"
                          onClick={() => setCenterFilter("high")}
                          className={`px-3 py-1 rounded-lg transition cursor-pointer ${
                            centerFilter === "high"
                              ? "bg-white text-amber-700 shadow-2xs font-extrabold"
                              : "text-slate-600 hover:text-slate-900"
                          }`}
                        >
                          High Load
                        </button>
                        <button
                          type="button"
                          onClick={() => setCenterFilter("available")}
                          className={`px-3 py-1 rounded-lg transition cursor-pointer ${
                            centerFilter === "available"
                              ? "bg-white text-emerald-700 shadow-2xs font-extrabold"
                              : "text-slate-600 hover:text-slate-900"
                          }`}
                        >
                          Headroom Available
                        </button>
                      </div>
                    </div>

                    {/* Matrix list */}
                    {filteredCenters.length > 0 ? (
                      <div className="dashboard-scrollbar max-h-96 space-y-3.5 overflow-y-auto pr-1.5">
                        {filteredCenters.map((center) => {
                          const isHigh = center.occupiedPercent >= 85;
                          const isMed = center.occupiedPercent >= 60;
                          return (
                            <div
                              key={center.id}
                              className="p-3.5 rounded-xl border border-slate-200/80 bg-white hover:border-blue-300 hover:bg-slate-50/50 transition"
                            >
                              <div className="flex items-baseline justify-between gap-2">
                                <div className="flex items-center gap-2 truncate">
                                  <span className="font-bold text-sm text-slate-900 truncate">
                                    {center.name}
                                  </span>
                                  {center.barangay && (
                                    <span className="text-[10px] font-semibold text-slate-500 px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200/60 truncate max-w-xs">
                                      {center.barangay}
                                    </span>
                                  )}
                                </div>

                                <div className="dashboard-mono text-xs shrink-0 text-right">
                                  <span className="text-emerald-700 font-black">
                                    {formatCount(center.checkedInCount)} arrived
                                  </span>
                                  <span className="text-slate-400 font-semibold ml-1">
                                    · {formatCount(center.assignedCount)} assigned / {formatCount(center.capacity)} cap
                                  </span>
                                </div>
                              </div>

                              {/* Multi-tier progress bar */}
                              <div className="mt-2.5">
                                <div className="h-2.5 w-full rounded-full bg-slate-100 relative overflow-hidden flex">
                                  {/* Assigned bar */}
                                  <div
                                    className="h-full bg-indigo-300/60 rounded-full transition-all duration-500 absolute top-0 left-0"
                                    style={{ width: `${center.assignedPercent}%` }}
                                  />
                                  {/* Verified arrived bar */}
                                  <div
                                    className={`h-full rounded-full transition-all duration-500 relative z-10 ${
                                      isHigh ? "bg-red-500" : isMed ? "bg-amber-500" : "bg-emerald-500"
                                    }`}
                                    style={{ width: `${center.occupiedPercent}%` }}
                                  />
                                </div>
                              </div>

                              <div className="mt-1.5 flex items-center justify-between text-[11px] font-medium text-slate-500">
                                <div className="flex items-center gap-3">
                                  <span className="flex items-center gap-1">
                                    <span className={`size-1.5 rounded-full ${isHigh ? "bg-red-500" : isMed ? "bg-amber-500" : "bg-emerald-500"}`} />
                                    <span>Verified on-site: {center.occupiedPercent}% cap</span>
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <span className="size-1.5 rounded-full bg-indigo-400" />
                                    <span>Assigned roster: {center.assignedPercent}% cap</span>
                                  </span>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => handleSectionChange("checkin", { center_id: center.id })}
                                  className="text-blue-600 hover:text-blue-800 font-bold inline-flex items-center gap-1 transition"
                                >
                                  <span>Check-In Desk</span>
                                  <FontAwesomeIcon icon={faArrowRight} className="text-[9px]" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="rounded-xl bg-slate-50 px-4 py-10 text-center text-xs text-slate-500 font-medium">
                        No evacuation centers match the selected filter.
                      </p>
                    )}
                  </div>
                </section>

                {/* Right 4 cols: Room Distribution Donut */}
                <section className="dashboard-card p-5 sm:p-6 lg:col-span-4 flex flex-col justify-between" aria-label="Room distribution chart">
                  <div>
                    <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <FontAwesomeIcon icon={faChartPie} className="text-indigo-600 text-sm" />
                          <h2 className="dashboard-heading text-lg font-black text-slate-900 tracking-tight">
                            Room Distribution
                          </h2>
                        </div>
                        <p className="text-xs text-slate-500 font-medium mt-0.5">
                          Shelter room allocation ratio
                        </p>
                      </div>
                    </div>

                    <RoomDonutChart
                      total={stats.totalRooms}
                      assigned={stats.occupiedRooms}
                      unassigned={Math.max(0, (stats.totalRooms || 0) - (stats.occupiedRooms || 0))}
                      onManage={() => handleSectionChange("centers")}
                    />
                  </div>
                </section>
              </div>

              {/* 5. INCIDENT COMMAND & OPERATIONS HUB */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Left 6 cols: Priority Attention & Action */}
                <section className="dashboard-card p-5 sm:p-6 lg:col-span-6 flex flex-col justify-between" aria-label="Operations priority triage">
                  <div>
                    <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <FontAwesomeIcon icon={faBolt} className="text-amber-600 text-sm" />
                          <h2 className="dashboard-heading text-lg font-black text-slate-900 tracking-tight">
                            Operations Priority Triage
                          </h2>
                        </div>
                        <p className="text-xs text-slate-500 font-medium mt-0.5">
                          Critical bottlenecks requiring immediate coordination
                        </p>
                      </div>

                      <span className="dashboard-mono text-xs font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">
                        {urgentActionItems.length} {urgentActionItems.length === 1 ? "Item" : "Items"}
                      </span>
                    </div>

                    {urgentActionItems.length > 0 ? (
                      <div className="space-y-3">
                        {urgentActionItems.map((item) => (
                          <div
                            key={item.id}
                            className={`flex items-center justify-between gap-3 p-3.5 rounded-xl border ${
                              item.severity === "danger"
                                ? "bg-red-50/70 border-red-200/80"
                                : item.severity === "warning"
                                ? "bg-amber-50/70 border-amber-200/80"
                                : "bg-blue-50/70 border-blue-200/80"
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <span
                                className={`grid size-9 shrink-0 place-items-center rounded-xl text-sm ${
                                  item.severity === "danger"
                                    ? "bg-red-200/70 text-red-800"
                                    : item.severity === "warning"
                                    ? "bg-amber-200/70 text-amber-800"
                                    : "bg-blue-200/70 text-blue-800"
                                }`}
                              >
                                <FontAwesomeIcon icon={item.icon} />
                              </span>
                              <div className="min-w-0">
                                <h3 className="text-xs font-bold text-slate-900 truncate">{item.title}</h3>
                                <p className="text-[11px] text-slate-500 truncate">{item.subtitle}</p>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleSectionChange(item.tab)}
                              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-bold text-slate-800 hover:bg-slate-50 shadow-2xs transition"
                            >
                              <span>{item.action}</span>
                              <FontAwesomeIcon icon={faArrowRight} className="text-[10px]" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center p-8 rounded-xl bg-emerald-50/60 border border-emerald-200/80 text-center">
                        <span className="grid size-12 place-items-center rounded-full bg-emerald-100 text-emerald-600 text-xl mb-2">
                          <FontAwesomeIcon icon={faCircleCheck} />
                        </span>
                        <h3 className="text-sm font-bold text-emerald-900">All Operations Clear</h3>
                        <p className="text-xs text-emerald-700 max-w-xs mt-1">
                          All assigned families have arrived safely. No open distress rescues or unverified hazards.
                        </p>
                      </div>
                    )}
                  </div>
                </section>

                {/* Right 6 cols: Live Incident & Activity Stream */}
                <section className="dashboard-card p-5 sm:p-6 lg:col-span-6 flex flex-col justify-between" aria-label="Incident feed">
                  <div>
                    {/* Header + Stream Selector Tabs */}
                    <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <FontAwesomeIcon icon={faShieldHalved} className="text-blue-600 text-sm" />
                          <h2 className="dashboard-heading text-lg font-black text-slate-900 tracking-tight">
                            Live Emergency Stream
                          </h2>
                        </div>
                        <p className="text-xs text-slate-500 font-medium mt-0.5">
                          Chronological citizen requests and hazard obstacles
                        </p>
                      </div>

                      {/* Feed selector */}
                      <div className="flex items-center p-1 rounded-xl bg-slate-100 border border-slate-200/60 text-xs font-bold">
                        <button
                          type="button"
                          onClick={() => setActiveFeedTab("rescue")}
                          className={`px-3 py-1 rounded-lg transition cursor-pointer ${
                            activeFeedTab === "rescue"
                              ? "bg-white text-red-700 shadow-2xs font-extrabold"
                              : "text-slate-600 hover:text-slate-900"
                          }`}
                        >
                          Rescues ({rescueList.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveFeedTab("hazards")}
                          className={`px-3 py-1 rounded-lg transition cursor-pointer ${
                            activeFeedTab === "hazards"
                              ? "bg-white text-amber-700 shadow-2xs font-extrabold"
                              : "text-slate-600 hover:text-slate-900"
                          }`}
                        >
                          Hazards ({hazardList.length})
                        </button>
                      </div>
                    </div>

                    {/* Feed Content */}
                    <div className="dashboard-scrollbar max-h-72 space-y-3 overflow-y-auto pr-1">
                      {activeFeedTab === "rescue" ? (
                        rescueList.length > 0 ? (
                          rescueList.slice(0, 5).map((rescue) => (
                            <div
                              key={rescue.id}
                              onClick={() => handleSectionChange("rescue")}
                              className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-100 bg-white hover:border-red-200 hover:bg-slate-50/70 transition cursor-pointer"
                            >
                              <div className="min-w-0 space-y-0.5">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-bold text-slate-900 truncate">
                                    {rescue.location_description || `Rescue Request #${rescue.id}`}
                                  </span>
                                  <span className="text-slate-300">•</span>
                                  <span className="text-[10px] text-slate-400 font-medium flex items-center gap-1">
                                    <FontAwesomeIcon icon={faClock} className="text-[9px]" />
                                    {formatTimeAgo(rescue.created_at)}
                                  </span>
                                </div>
                                <p className="text-[11px] text-slate-600 truncate max-w-md">
                                  {rescue.description || "Citizen reported distress at location."}
                                </p>
                              </div>

                              <span
                                className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                                  rescue.status === "resolved"
                                    ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                                    : rescue.status === "responding"
                                    ? "bg-blue-50 text-blue-800 border-blue-200"
                                    : "bg-red-50 text-red-800 border-red-200"
                                }`}
                              >
                                {rescue.status || "Pending"}
                              </span>
                            </div>
                          ))
                        ) : (
                          <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-xs text-slate-500 font-medium">
                            No emergency rescue requests on record.
                          </p>
                        )
                      ) : hazardList.length > 0 ? (
                        hazardList.slice(0, 5).map((hazard) => (
                          <div
                            key={hazard.id}
                            onClick={() => handleSectionChange("reports")}
                            className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-100 bg-white hover:border-amber-200 hover:bg-slate-50/70 transition cursor-pointer"
                          >
                            <div className="min-w-0 space-y-0.5">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-slate-900 truncate uppercase">
                                  {hazard.report_type || "Hazard Obstacle"}
                                </span>
                                <span className="text-slate-300">•</span>
                                <span className="text-[10px] text-slate-400 font-medium flex items-center gap-1">
                                  <FontAwesomeIcon icon={faClock} className="text-[9px]" />
                                  {formatTimeAgo(hazard.submitted_at)}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-600 truncate max-w-md">
                                {hazard.description || "Field obstacle reported by community."}
                              </p>
                            </div>

                            <span
                              className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                                hazard.status === "validated"
                                  ? "bg-blue-50 text-blue-800 border-blue-200"
                                  : hazard.status === "resolved"
                                  ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                                  : "bg-amber-50 text-amber-800 border-amber-200"
                              }`}
                            >
                              {hazard.status || "Pending"}
                            </span>
                          </div>
                        ))
                      ) : (
                        <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-xs text-slate-500 font-medium">
                          No hazard reports on record.
                        </p>
                      )}
                    </div>
                  </div>
                </section>
              </div>

              {/* 6. DEMOGRAPHICS BY BARANGAY COMPARATIVE ANALYTICS (ALL BARANGAYS) */}
              <section className="dashboard-card p-5 sm:p-6" aria-label="Demographic distribution">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <FontAwesomeIcon icon={faLocationDot} className="text-blue-600 text-sm" />
                      <h2 className="dashboard-heading text-lg font-black text-slate-900 tracking-tight">
                        Demographics & Evacuee Density by Barangay
                      </h2>
                    </div>
                    <p className="text-xs text-slate-500 font-medium mt-0.5">
                      All {allBarangays.length} registered communities across Sogod, Southern Leyte
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    {/* Live Search input */}
                    <div className="relative">
                      <FontAwesomeIcon
                        icon={faMagnifyingGlass}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none"
                      />
                      <input
                        type="text"
                        value={barangaySearch}
                        onChange={(e) => setBarangaySearch(e.target.value)}
                        placeholder="Search barangay..."
                        className="pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:bg-white w-40 sm:w-48 transition"
                      />
                    </div>

                    {/* Metric Switch */}
                    <div className="flex items-center p-1 rounded-xl bg-slate-100 border border-slate-200/60 text-xs font-bold">
                      <button
                        type="button"
                        onClick={() => setBarangayMetric("households")}
                        className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                          barangayMetric === "households"
                            ? "bg-white text-blue-700 shadow-2xs font-extrabold"
                            : "text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        Households
                      </button>
                      <button
                        type="button"
                        onClick={() => setBarangayMetric("residents")}
                        className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                          barangayMetric === "residents"
                            ? "bg-white text-blue-700 shadow-2xs font-extrabold"
                            : "text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        Residents
                      </button>
                    </div>
                  </div>
                </div>

                {filteredBarangays.length > 0 ? (
                  <div className="dashboard-scrollbar max-h-[520px] overflow-y-auto pr-1">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {filteredBarangays.map((barangay) => {
                        const barWidth = Math.round((barangay.val / maxBarangayVal) * 100);

                        return (
                          <div
                            key={barangay.id || barangay.rank}
                            className="p-3 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-slate-50/90 hover:border-blue-200 transition"
                          >
                            <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                              <span className="flex items-center gap-2 truncate">
                                <span className="dashboard-mono size-5 rounded-md bg-white border border-slate-200 grid place-items-center text-[10px] text-slate-600 font-black shrink-0">
                                  #{barangay.rank}
                                </span>
                                <span className="truncate" title={barangay.name}>{barangay.name}</span>
                              </span>
                              <span className="dashboard-mono text-slate-900 shrink-0 font-extrabold ml-1">
                                {formatCount(barangay.val)}{" "}
                                <span className="font-normal text-[10px] text-slate-400">
                                  {barangayMetric === "residents" ? "residents" : "households"}
                                </span>
                              </span>
                            </div>

                            <div className="mt-2 h-2 w-full rounded-full bg-slate-200/70 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-linear-to-r from-blue-600 to-indigo-600 transition-all duration-500"
                                style={{ width: `${barWidth}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-xs text-slate-500 font-medium">
                    {barangaySearch ? `No barangays found matching "${barangaySearch}".` : "No barangay census records registered yet."}
                  </p>
                )}

                {isAdmin && (
                  <div className="mt-6 pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500 font-medium">
                    <div className="flex items-center gap-2">
                      <span className="size-2 rounded-full bg-emerald-500" />
                      <span>
                        LGU Personnel System:{" "}
                        <strong className="text-slate-800 font-bold">
                          {formatCount(stats.activeStaff)} active
                        </strong>{" "}
                        of {formatCount(stats.totalStaff)} total staff accounts
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleSectionChange("users")}
                      className="text-blue-600 hover:text-blue-800 font-bold inline-flex items-center gap-1.5 transition"
                    >
                      <span>Manage Personnel Accounts</span>
                      <FontAwesomeIcon icon={faArrowRight} className="text-[10px]" />
                    </button>
                  </div>
                )}
              </section>
            </>
          ) : error ? (
            <div className="flex flex-col items-center justify-center p-12 text-center bg-white rounded-2xl border border-slate-200 shadow-xs my-6">
              <div className="size-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mb-4">
                <FontAwesomeIcon icon={faTriangleExclamation} className="text-xl" />
              </div>
              <h3 className="text-base font-bold text-slate-800">Operational Metrics Unavailable</h3>
              <p className="mt-1 text-xs text-slate-500 max-w-md">
                {error?.message || "Could not retrieve live dashboard analytics. Please verify connectivity and retry."}
              </p>
              <button
                type="button"
                onClick={handleRefreshAll}
                className="mt-4 px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition shadow-xs"
              >
                Retry Loading
              </button>
            </div>
          ) : (
            <div className="dashboard-loading-wrap">
              <LoadingState message="Loading command analytics…" size="lg" />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default Dashboard;

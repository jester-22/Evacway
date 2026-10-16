import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowsRotate,
  faArrowRight,
  faBed,
  faCircleCheck,
  faClock,
  faHouseFlag,
  faLifeRing,
  faLocationDot,
  faPeopleGroup,
  faTriangleExclamation,
  faUserCheck,
  faUsers,
} from "@fortawesome/free-solid-svg-icons";
import { useAuth } from "../context/AuthContext";
import {
  useDashboardSummary,
  useBarangays,
  useHazardReports,
  useRescueRequests,
} from "../hooks/useEvacuationQueries";
import Sidebar from "./Sidebar";
import "../components_css/Dashboard.css";

const MOBILE_BREAKPOINT = 720;

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < MOBILE_BREAKPOINT : false
  );

  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return isMobile;
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

function StatCard({ label, value, description, icon, accentColor, progressPercent, progressColor }) {
  return (
    <article className="dashboard-card p-6 flex flex-col justify-between">
      <div>
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-semibold text-slate-600">{label}</p>
          <span
            className="grid size-11 shrink-0 place-items-center rounded-xl"
            style={{ backgroundColor: `${accentColor}15`, color: accentColor }}
          >
            <FontAwesomeIcon icon={icon} className="text-lg" aria-hidden="true" />
          </span>
        </div>
        <p className="dashboard-mono mt-3 text-3xl font-extrabold text-slate-900 tracking-tight sm:text-4xl">
          {formatCount(value)}
        </p>
      </div>

      <div className="mt-4 pt-3 border-t border-slate-100">
        {progressPercent !== undefined && progressPercent !== null ? (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-slate-500">
              <span>{description}</span>
              <span className="dashboard-mono font-medium">{progressPercent}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, Math.max(0, progressPercent))}%`,
                  backgroundColor: progressColor || accentColor,
                }}
              />
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500">{description}</p>
        )}
      </div>
    </article>
  );
}

function RoomDonut({ total, assigned, unassigned }) {
  const radius = 43;
  const circumference = 2 * Math.PI * radius;
  const assignedArc = total ? (assigned / total) * circumference : 0;
  const unassignedArc = total ? (unassigned / total) * circumference : 0;

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:justify-center sm:gap-8">
      <div
        className="relative size-44 shrink-0"
        role="img"
        aria-label={`Room Distribution: ${assigned} assigned and ${unassigned} unassigned out of ${total} total rooms`}
      >
        <svg className="size-full -rotate-90" viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r={radius} fill="none" stroke="#f1f5f9" strokeWidth="12" />
          {total > 0 && (
            <>
              <circle
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                stroke="#2563eb"
                strokeWidth="12"
                strokeLinecap="round"
                strokeDasharray={`${assignedArc} ${circumference}`}
              />
              {unassigned > 0 && (
                <circle
                  cx="60"
                  cy="60"
                  r={radius}
                  fill="none"
                  stroke="#cbd5e1"
                  strokeWidth="12"
                  strokeLinecap="round"
                  strokeDasharray={`${unassignedArc} ${circumference}`}
                  strokeDashoffset={-assignedArc}
                />
              )}
            </>
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center px-2 text-center">
          {total > 0 ? (
            <>
              <strong className="dashboard-mono text-xl font-extrabold text-slate-900 sm:text-2xl">
                {formatCount(assigned)} of {formatCount(total)}
              </strong>
              <span className="mt-0.5 text-xs font-medium text-slate-500 uppercase tracking-wider">
                rooms in use
              </span>
            </>
          ) : (
            <span className="text-xs font-medium text-slate-500">No rooms configured</span>
          )}
        </div>
      </div>

      <div className="w-full max-w-xs space-y-3">
        {[
          { label: "Assigned", value: assigned, color: "bg-blue-600", desc: "Sheltering families" },
          { label: "Unassigned", value: unassigned, color: "bg-slate-300", desc: "Open capacity" },
        ].map((item) => (
          <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-100" key={item.label}>
            <div className="flex items-center gap-2.5">
              <span className={`size-3 rounded-full ${item.color} shadow-sm`} />
              <div>
                <span className="text-sm font-semibold text-slate-800 block">{item.label}</span>
                <span className="text-xs text-slate-400">{item.desc}</span>
              </div>
            </div>
            <div className="text-right">
              <span className="dashboard-mono text-sm font-bold text-slate-900">
                {formatCount(item.value)}
              </span>
              <span className="text-xs text-slate-500 block">
                {percentage(item.value, total)}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

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
  const [barangayMetric, setBarangayMetric] = useState("households"); // "households" | "residents"

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

  function handleSectionChange(nextTab) {
    if (nextTab === "dashboard") {
      navigate("/dashboard");
      return;
    }
    const path = isAdmin ? "/admin" : "/lgu";
    navigate(`${path}?tab=${encodeURIComponent(nextTab)}`);
  }

  function handleNotificationSelect(notification) {
    const path = isAdmin ? "/admin" : "/lgu";
    const tab = notification.resource_type === "hazard_report" ? "reports" : "rescue";
    navigate(`${path}?tab=${tab}&notificationId=${notification.id}`);
  }

  const todayFormatted = useMemo(() => {
    return new Date().toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }, []);

  // Readiness Calculations
  const assignedFamiliesRate = percentage(stats?.assignedFamilies || 0, stats?.families || 0);
  const roomAvailability = percentage(stats?.availableRooms || 0, stats?.totalRooms || 0);
  const roomOccupiedRate = percentage(stats?.occupiedRooms || 0, stats?.totalRooms || 0);
  const unassignedFamiliesRate = percentage(stats?.unassignedFamilies || 0, stats?.families || 0);
  const staffAvailability = percentage(stats?.activeStaff || 0, stats?.totalStaff || 0);

  // Readiness Badge Config
  const readinessConfig = useMemo(() => {
    if (assignedFamiliesRate >= 80) {
      return {
        label: "Optimal Preparedness",
        badgeClass: "bg-emerald-100 text-emerald-800 border-emerald-300",
        barColor: "bg-emerald-500",
        desc: "Over 80% of registered households have secured shelter assignments.",
      };
    }
    if (assignedFamiliesRate >= 50) {
      return {
        label: "Moderate Evacuation Readiness",
        badgeClass: "bg-amber-100 text-amber-800 border-amber-300",
        barColor: "bg-amber-500",
        desc: "Between 50% and 79% of households sheltered. Continued room placement recommended.",
      };
    }
    return {
      label: "Action Required: Low Readiness",
      badgeClass: "bg-rose-100 text-rose-800 border-rose-300",
      barColor: "bg-rose-500",
      desc: "Less than 50% of households are assigned. Immediate room allocation needed.",
    };
  }, [assignedFamiliesRate]);

  // Needs Attention List
  const needsAttentionItems = useMemo(() => {
    if (!stats) return [];
    const items = [];

    // 1. Unassigned Households
    if (stats.unassignedFamilies > 0) {
      items.push({
        id: "unassigned-households",
        severity: "warning",
        badge: "Assignment Gap",
        title: `${formatCount(stats.unassignedFamilies)} Unassigned Households`,
        desc: "Registered families awaiting room assignment in active evacuation centers.",
        actionLabel: "Assign Families",
        tab: "barangay",
      });
    }

    // 2. Critical Room Availability (< 20%)
    if (stats.totalRooms > 0 && roomAvailability < 20) {
      items.push({
        id: "low-rooms",
        severity: "danger",
        badge: "Critical Space",
        title: `Low Room Capacity (${roomAvailability}% Remaining)`,
        desc: `Only ${formatCount(stats.availableRooms)} of ${formatCount(stats.totalRooms)} rooms are available across all centers.`,
        actionLabel: "View Rooms",
        tab: "centers",
      });
    }

    // 3. Evacuation Centers without rooms
    const emptyCenters = (stats.centerRooms || []).filter((c) => c.total === 0);
    if (emptyCenters.length > 0) {
      items.push({
        id: "empty-centers",
        severity: "warning",
        badge: "Setup Needed",
        title: `${emptyCenters.length} Center(s) Without Rooms`,
        desc: "Evacuation facilities exist in the system with 0 configured shelter rooms.",
        actionLabel: "Configure Centers",
        tab: "centers",
      });
    }

    // 4. Inactive Staff (Admin only)
    if (isAdmin && stats.totalStaff > 0 && stats.totalStaff - stats.activeStaff > 0) {
      const inactiveStaffCount = stats.totalStaff - stats.activeStaff;
      items.push({
        id: "inactive-staff",
        severity: "info",
        badge: "Staff Accounts",
        title: `${inactiveStaffCount} Inactive Staff Account${inactiveStaffCount > 1 ? "s" : ""}`,
        desc: "Staff accounts currently inactive or pending credential verification.",
        actionLabel: "Manage Users",
        tab: "users",
      });
    }

    // 5. Pending Rescue Requests
    const rescueList = Array.isArray(rescueRequestsData) ? rescueRequestsData : [];
    const pendingRescueCount = rescueList.filter((r) => r.status === "pending").length;
    if (pendingRescueCount > 0) {
      items.push({
        id: "pending-rescues",
        severity: "danger",
        badge: "Rescue Alert",
        title: `${pendingRescueCount} Pending Rescue Alert${pendingRescueCount > 1 ? "s" : ""}`,
        desc: "Urgent citizen rescue calls requiring immediate LGU dispatch and response.",
        actionLabel: "View Rescue",
        tab: "rescue",
      });
    }

    // 6. Pending Hazard Reports
    const hazardList = Array.isArray(hazardReportsData) ? hazardReportsData : [];
    const pendingHazardCount = hazardList.filter((h) => h.status === "pending").length;
    if (pendingHazardCount > 0) {
      items.push({
        id: "pending-hazards",
        severity: "warning",
        badge: "Hazard Review",
        title: `${pendingHazardCount} Hazard Report${pendingHazardCount > 1 ? "s" : ""} Pending Review`,
        desc: "Submitted community hazard reports awaiting field verification.",
        actionLabel: "Review Reports",
        tab: "reports",
      });
    }

    return items;
  }, [stats, roomAvailability, isAdmin, rescueRequestsData, hazardReportsData]);

  // Top 8 Barangays Chart Data
  const topBarangays = useMemo(() => {
    const list = Array.isArray(barangaysData) ? [...barangaysData] : [];
    if (!list.length) return [];
    const metricKey = barangayMetric === "residents" ? "resident_count" : "household_count";
    list.sort((a, b) => (b[metricKey] || 0) - (a[metricKey] || 0));
    return list.slice(0, 8);
  }, [barangaysData, barangayMetric]);

  const maxBarangayVal = useMemo(() => {
    if (!topBarangays.length) return 1;
    const metricKey = barangayMetric === "residents" ? "resident_count" : "household_count";
    return Math.max(...topBarangays.map((b) => b[metricKey] || 0), 1);
  }, [topBarangays, barangayMetric]);

  // Recent Activity Data (5 each)
  const recentHazardReports = useMemo(() => {
    const list = Array.isArray(hazardReportsData) ? hazardReportsData : [];
    return list.slice(0, 5);
  }, [hazardReportsData]);

  const recentRescueRequests = useMemo(() => {
    const list = Array.isArray(rescueRequestsData) ? rescueRequestsData : [];
    return list.slice(0, 5);
  }, [rescueRequestsData]);

  // Pending count for quick action pills
  const pendingRescueTotal = useMemo(() => {
    const list = Array.isArray(rescueRequestsData) ? rescueRequestsData : [];
    return list.filter((r) => r.status === "pending").length;
  }, [rescueRequestsData]);

  const pendingHazardTotal = useMemo(() => {
    const list = Array.isArray(hazardReportsData) ? hazardReportsData : [];
    return list.filter((h) => h.status === "pending").length;
  }, [hazardReportsData]);

  return (
    <div className="dashboard-layout">
      <Sidebar
        tab="dashboard"
        setTab={handleSectionChange}
        user={user}
        logout={logout}
        isMobile={isMobile}
        onSelectNotification={handleNotificationSelect}
      />

      <main className="dashboard-content dashboard-page bg-slate-50">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 space-y-6">

          {/* 1. HEADER */}
          <header className="dashboard-card p-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                {todayFormatted}
              </p>
              <h1 className="dashboard-heading mt-1 text-2xl font-bold text-slate-900 sm:text-3xl">
                Welcome back, {user?.name || "Officer"}
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Sogod Disaster Preparedness & Evacuation Operations Center
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm">
                <span className={`size-2.5 rounded-full ${isFetching ? "bg-amber-500 animate-ping" : "bg-emerald-500"}`} />
                <span>{isFetching ? "Syncing data..." : "Auto-updates every 30s"}</span>
              </div>

              <button
                type="button"
                onClick={handleRefreshAll}
                disabled={isRefreshing || isFetching}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 active:bg-blue-800 transition disabled:opacity-50"
                title="Refresh dashboard metrics"
              >
                <FontAwesomeIcon
                  icon={faArrowsRotate}
                  className={isRefreshing || isFetching ? "animate-spin" : ""}
                />
                <span>Refresh</span>
              </button>
            </div>
          </header>

          {/* ERROR STATE */}
          {error && (
            <section
              className="flex flex-col justify-between gap-4 rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800 sm:flex-row sm:items-center shadow-sm"
              role="alert"
            >
              <div>
                <h2 className="text-base font-bold flex items-center gap-2">
                  <FontAwesomeIcon icon={faTriangleExclamation} />
                  Could not load dashboard data
                </h2>
                <p className="mt-1 text-sm text-red-700">{error?.message || String(error)}</p>
              </div>
              <button
                type="button"
                className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-700 transition"
                onClick={handleRefreshAll}
              >
                Try Again
              </button>
            </section>
          )}

          {/* LOADING SKELETON */}
          {isLoading && !stats ? (
            <div className="space-y-6" aria-label="Loading dashboard" aria-busy="true">
              <div className="dashboard-skeleton h-36 rounded-2xl border border-slate-200 bg-white p-6" />
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }, (_, index) => (
                  <div className="dashboard-skeleton h-36 rounded-2xl border border-slate-200 bg-white p-6" key={index} />
                ))}
              </div>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div className="dashboard-skeleton h-80 rounded-2xl border border-slate-200 bg-white p-6" />
                <div className="dashboard-skeleton h-80 rounded-2xl border border-slate-200 bg-white p-6" />
              </div>
            </div>
          ) : stats ? (
            <>
              {/* 2. EVACUATION READINESS BANNER */}
              <section className="dashboard-card p-6 border-l-8 border-l-blue-600" aria-label="Evacuation readiness status">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                        Operational Status
                      </span>
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-0.5 text-xs font-bold ${readinessConfig.badgeClass}`}>
                        <span className={`size-2 rounded-full ${readinessConfig.barColor}`} />
                        {readinessConfig.label}
                      </span>
                    </div>
                    <h2 className="dashboard-heading text-xl font-bold text-slate-900 sm:text-2xl">
                      Evacuation Sheltering Readiness: {assignedFamiliesRate}%
                    </h2>
                    <p className="text-sm text-slate-600 max-w-2xl">
                      {formatCount(stats.assignedFamilies)} of {formatCount(stats.families)} registered households have been safely assigned to evacuation rooms. {readinessConfig.desc}
                    </p>
                  </div>

                  <div className="sm:text-right shrink-0">
                    <span className="dashboard-mono text-3xl font-extrabold text-blue-600 sm:text-4xl">
                      {assignedFamiliesRate}%
                    </span>
                    <span className="text-xs text-slate-400 block font-medium">Assigned Rate</span>
                  </div>
                </div>

                <div className="mt-5 space-y-2">
                  <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100 shadow-inner" role="progressbar" aria-valuenow={assignedFamiliesRate} aria-valuemin={0} aria-valuemax={100}>
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${readinessConfig.barColor}`}
                      style={{ width: `${Math.min(100, Math.max(0, assignedFamiliesRate))}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-slate-500 font-medium">
                    <span>0% (Empty)</span>
                    <span>Target: 100% Fully Sheltered</span>
                  </div>
                </div>
              </section>

              {/* 3. STAT CARDS */}
              <section className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-label="Summary statistics">
                <StatCard
                  label="Barangays"
                  value={stats.barangays}
                  description="Registered Sogod communities"
                  icon={faLocationDot}
                  accentColor="#2563eb"
                />
                <StatCard
                  label="Households"
                  value={stats.families}
                  description={`${formatCount(stats.assignedFamilies)} assigned to rooms`}
                  icon={faPeopleGroup}
                  accentColor="#4f46e5"
                  progressPercent={assignedFamiliesRate}
                  progressColor="#4f46e5"
                />
                <StatCard
                  label="Unassigned Households"
                  value={stats.unassignedFamilies}
                  description={`${unassignedFamiliesRate}% awaiting room placement`}
                  icon={faTriangleExclamation}
                  accentColor="#d97706"
                  progressPercent={unassignedFamiliesRate}
                  progressColor="#d97706"
                />
                <StatCard
                  label="Residents"
                  value={stats.residents}
                  description={`Across ${formatCount(stats.families)} households`}
                  icon={faUsers}
                  accentColor="#0d9488"
                />
                <StatCard
                  label="Evacuation Centers"
                  value={stats.centers}
                  description="Active shelter facilities"
                  icon={faHouseFlag}
                  accentColor="#059669"
                />
                <StatCard
                  label="Available Rooms"
                  value={stats.availableRooms}
                  description={`${roomAvailability}% of ${formatCount(stats.totalRooms)} rooms open`}
                  icon={faCircleCheck}
                  accentColor="#0284c7"
                  progressPercent={roomAvailability}
                  progressColor="#0284c7"
                />
              </section>

              {/* 4. CAPACITY SECTION: ROOM DONUT + OPERATIONAL CAPACITY PROGRESS BARS */}
              <section className="dashboard-card p-6" aria-label="Room capacity and assignment breakdown">
                <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
                  <div>
                    <h2 className="dashboard-heading text-lg font-bold text-slate-900 sm:text-xl">
                      Capacity & Resource Allocation
                    </h2>
                    <p className="text-xs text-slate-500">
                      Real-time breakdown of shelter rooms, assigned households, and operational limits
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-blue-50 text-blue-700">
                      {formatCount(stats.totalRooms)} Total Configured Rooms
                    </span>
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-slate-100 text-slate-700">
                      {formatCount(stats.totalCapacity)} Total Center Capacity
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-center">
                  {/* Donut Chart (5 Cols) */}
                  <div className="lg:col-span-5 flex flex-col items-center justify-center p-2">
                    <h3 className="text-sm font-bold text-slate-700 mb-4 text-center">
                      Room Status: Assigned vs Unassigned
                    </h3>
                    <RoomDonut
                      total={stats.totalRooms}
                      assigned={stats.occupiedRooms}
                      unassigned={Math.max(0, (stats.totalRooms || 0) - (stats.occupiedRooms || 0))}
                    />
                  </div>

                  {/* Horizontal Capacity Bars (7 Cols) */}
                  <div className="lg:col-span-7 space-y-5 lg:border-l lg:border-slate-100 lg:pl-8">
                    <h3 className="text-sm font-bold text-slate-700 mb-2">
                      Operational Thresholds
                    </h3>

                    {/* Households Assigned */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                        <span className="flex items-center gap-2">
                          <FontAwesomeIcon icon={faPeopleGroup} className="text-blue-600" />
                          Households Sheltered
                        </span>
                        <span className="dashboard-mono text-slate-900">
                          {formatCount(stats.assignedFamilies)} / {formatCount(stats.families)}{" "}
                          <span className="font-normal text-slate-500">({assignedFamiliesRate}%)</span>
                        </span>
                      </div>
                      <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={assignedFamiliesRate} aria-valuemin={0} aria-valuemax={100}>
                        <div
                          className="h-full rounded-full bg-blue-600 transition-all duration-500"
                          style={{ width: `${assignedFamiliesRate}%` }}
                        />
                      </div>
                    </div>

                    {/* Rooms in Use */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                        <span className="flex items-center gap-2">
                          <FontAwesomeIcon icon={faBed} className="text-indigo-600" />
                          Rooms in Active Use
                        </span>
                        <span className="dashboard-mono text-slate-900">
                          {formatCount(stats.occupiedRooms)} / {formatCount(stats.totalRooms)}{" "}
                          <span className="font-normal text-slate-500">({roomOccupiedRate}%)</span>
                        </span>
                      </div>
                      <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={roomOccupiedRate} aria-valuemin={0} aria-valuemax={100}>
                        <div
                          className="h-full rounded-full bg-indigo-600 transition-all duration-500"
                          style={{ width: `${roomOccupiedRate}%` }}
                        />
                      </div>
                    </div>

                    {/* Unassigned Backlog */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                        <span className="flex items-center gap-2">
                          <FontAwesomeIcon icon={faTriangleExclamation} className="text-amber-500" />
                          Unassigned Household Backlog
                        </span>
                        <span className="dashboard-mono text-slate-900">
                          {formatCount(stats.unassignedFamilies)} / {formatCount(stats.families)}{" "}
                          <span className="font-normal text-slate-500">({unassignedFamiliesRate}%)</span>
                        </span>
                      </div>
                      <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={unassignedFamiliesRate} aria-valuemin={0} aria-valuemax={100}>
                        <div
                          className="h-full rounded-full bg-amber-500 transition-all duration-500"
                          style={{ width: `${unassignedFamiliesRate}%` }}
                        />
                      </div>
                    </div>

                    {/* Staff Accounts (Admin only) */}
                    {isAdmin && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                          <span className="flex items-center gap-2">
                            <FontAwesomeIcon icon={faUserCheck} className="text-emerald-600" />
                            Active Response Personnel
                          </span>
                          <span className="dashboard-mono text-slate-900">
                            {formatCount(stats.activeStaff)} / {formatCount(stats.totalStaff)}{" "}
                            <span className="font-normal text-slate-500">({staffAvailability}%)</span>
                          </span>
                        </div>
                        <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={staffAvailability} aria-valuemin={0} aria-valuemax={100}>
                          <div
                            className="h-full rounded-full bg-emerald-600 transition-all duration-500"
                            style={{ width: `${staffAvailability}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </section>

              {/* 5 & 6. NEEDS ATTENTION & QUICK ACTIONS */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                {/* Needs Attention List (8 cols) */}
                <section className="dashboard-card p-6 lg:col-span-8 flex flex-col justify-between" aria-label="Action items requiring attention">
                  <div>
                    <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
                      <div>
                        <h2 className="dashboard-heading text-lg font-bold text-slate-900">
                          Needs Attention
                        </h2>
                        <p className="text-xs text-slate-500">
                          Prioritized operational bottlenecks and alert items
                        </p>
                      </div>
                      <span className="dashboard-mono text-xs font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">
                        {needsAttentionItems.length} Item{needsAttentionItems.length === 1 ? "" : "s"}
                      </span>
                    </div>

                    {needsAttentionItems.length > 0 ? (
                      <div className="space-y-3 dashboard-scrollbar max-h-80 overflow-y-auto pr-1">
                        {needsAttentionItems.map((item) => (
                          <div
                            key={item.id}
                            className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl border ${
                              item.severity === "danger"
                                ? "bg-red-50/60 border-red-200"
                                : item.severity === "warning"
                                ? "bg-amber-50/60 border-amber-200"
                                : "bg-blue-50/60 border-blue-200"
                            }`}
                          >
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`text-[10px] uppercase tracking-wider font-extrabold px-2 py-0.5 rounded ${
                                    item.severity === "danger"
                                      ? "bg-red-200 text-red-900"
                                      : item.severity === "warning"
                                      ? "bg-amber-200 text-amber-900"
                                      : "bg-blue-200 text-blue-900"
                                  }`}
                                >
                                  {item.badge}
                                </span>
                                <h3 className="text-sm font-bold text-slate-900">{item.title}</h3>
                              </div>
                              <p className="text-xs text-slate-600">{item.desc}</p>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleSectionChange(item.tab)}
                              className="shrink-0 inline-flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-800 hover:bg-slate-50 shadow-sm transition"
                            >
                              <span>{item.actionLabel}</span>
                              <FontAwesomeIcon icon={faArrowRight} className="text-[10px]" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-10 text-center">
                        <span className="grid size-12 place-items-center rounded-full bg-emerald-100 text-emerald-600 mb-3">
                          <FontAwesomeIcon icon={faCircleCheck} className="text-xl" />
                        </span>
                        <h3 className="text-sm font-bold text-slate-800">All Systems Operational</h3>
                        <p className="text-xs text-slate-500 mt-1 max-w-sm">
                          No capacity shortages, missing room records, or unhandled emergency alerts detected.
                        </p>
                      </div>
                    )}
                  </div>
                </section>

                {/* Quick Actions (4 cols) */}
                <section className="dashboard-card p-6 lg:col-span-4 flex flex-col justify-between" aria-label="Quick operations">
                  <div>
                    <div className="mb-4 border-b border-slate-100 pb-3">
                      <h2 className="dashboard-heading text-lg font-bold text-slate-900">
                        Quick Actions
                      </h2>
                      <p className="text-xs text-slate-500">
                        Frequently accessed operational consoles
                      </p>
                    </div>

                    <div className="space-y-3">
                      <button
                        type="button"
                        onClick={() => handleSectionChange("reports")}
                        className="w-full flex items-center justify-between p-3.5 rounded-xl border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition group text-left"
                      >
                        <div className="flex items-center gap-3">
                          <span className="grid size-9 place-items-center rounded-lg bg-amber-100 text-amber-700">
                            <FontAwesomeIcon icon={faTriangleExclamation} />
                          </span>
                          <div>
                            <span className="text-sm font-bold text-slate-800 block group-hover:text-blue-700">
                              Hazard Reports
                            </span>
                            <span className="text-xs text-slate-500">Citizen submissions</span>
                          </div>
                        </div>
                        {pendingHazardTotal > 0 ? (
                          <span className="dashboard-mono text-xs font-bold px-2 py-0.5 rounded-full bg-amber-500 text-white">
                            {pendingHazardTotal}
                          </span>
                        ) : (
                          <FontAwesomeIcon icon={faArrowRight} className="text-slate-300 text-xs group-hover:text-blue-500" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSectionChange("rescue")}
                        className="w-full flex items-center justify-between p-3.5 rounded-xl border border-slate-200 hover:border-red-300 hover:bg-red-50/50 transition group text-left"
                      >
                        <div className="flex items-center gap-3">
                          <span className="grid size-9 place-items-center rounded-lg bg-red-100 text-red-700">
                            <FontAwesomeIcon icon={faLifeRing} />
                          </span>
                          <div>
                            <span className="text-sm font-bold text-slate-800 block group-hover:text-red-700">
                              Rescue Requests
                            </span>
                            <span className="text-xs text-slate-500">Emergency dispatches</span>
                          </div>
                        </div>
                        {pendingRescueTotal > 0 ? (
                          <span className="dashboard-mono text-xs font-bold px-2 py-0.5 rounded-full bg-red-600 text-white animate-pulse">
                            {pendingRescueTotal}
                          </span>
                        ) : (
                          <FontAwesomeIcon icon={faArrowRight} className="text-slate-300 text-xs group-hover:text-red-500" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSectionChange("barangay")}
                        className="w-full flex items-center justify-between p-3.5 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50 transition group text-left"
                      >
                        <div className="flex items-center gap-3">
                          <span className="grid size-9 place-items-center rounded-lg bg-indigo-100 text-indigo-700">
                            <FontAwesomeIcon icon={faPeopleGroup} />
                          </span>
                          <div>
                            <span className="text-sm font-bold text-slate-800 block group-hover:text-indigo-700">
                              Household Directory
                            </span>
                            <span className="text-xs text-slate-500">Family & resident records</span>
                          </div>
                        </div>
                        <FontAwesomeIcon icon={faArrowRight} className="text-slate-300 text-xs group-hover:text-indigo-500" />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSectionChange("centers")}
                        className="w-full flex items-center justify-between p-3.5 rounded-xl border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/50 transition group text-left"
                      >
                        <div className="flex items-center gap-3">
                          <span className="grid size-9 place-items-center rounded-lg bg-emerald-100 text-emerald-700">
                            <FontAwesomeIcon icon={faHouseFlag} />
                          </span>
                          <div>
                            <span className="text-sm font-bold text-slate-800 block group-hover:text-emerald-700">
                              Evacuation Centers
                            </span>
                            <span className="text-xs text-slate-500">Facility rooms & beds</span>
                          </div>
                        </div>
                        <FontAwesomeIcon icon={faArrowRight} className="text-slate-300 text-xs group-hover:text-emerald-500" />
                      </button>
                    </div>
                  </div>
                </section>
              </div>

              {/* 7. QUICK INSIGHTS TILES */}
              <section aria-label="Operational insight averages">
                <div className="mb-3">
                  <h2 className="dashboard-heading text-base font-bold text-slate-900">
                    Operational Insights
                  </h2>
                </div>
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <div className="dashboard-card p-5">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Avg Residents / Household
                    </p>
                    <p className="dashboard-mono mt-2 text-2xl font-bold text-slate-900 sm:text-3xl">
                      {(stats.residents / (stats.families || 1)).toFixed(1)}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">Average family size</p>
                  </div>

                  <div className="dashboard-card p-5">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Avg Households / Barangay
                    </p>
                    <p className="dashboard-mono mt-2 text-2xl font-bold text-slate-900 sm:text-3xl">
                      {Math.round(stats.families / (stats.barangays || 1))}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">Distribution per community</p>
                  </div>

                  <div className="dashboard-card p-5">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Avg Rooms / Center
                    </p>
                    <p className="dashboard-mono mt-2 text-2xl font-bold text-slate-900 sm:text-3xl">
                      {(stats.totalRooms / (stats.centers || 1)).toFixed(1)}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">Facility partitioning</p>
                  </div>

                  <div className="dashboard-card p-5">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Residents / Open Room
                    </p>
                    <p className="dashboard-mono mt-2 text-2xl font-bold text-slate-900 sm:text-3xl">
                      {stats.availableRooms > 0 ? (stats.residents / stats.availableRooms).toFixed(1) : "N/A"}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">Theoretical pressure ratio</p>
                  </div>
                </div>
              </section>

              {/* BAR CHARTS: ROOM OCCUPANCY PER CENTER & TOP 8 BARANGAYS */}
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                {/* Bar Chart 1: Room Occupancy per Evacuation Center */}
                <section className="dashboard-card p-6 flex flex-col justify-between" aria-label="Room occupancy per evacuation center">
                  <div>
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                      <div>
                        <h2 className="dashboard-heading text-lg font-bold text-slate-900">
                          Room Occupancy by Center
                        </h2>
                        <p className="text-xs text-slate-500">
                          Rooms currently in use versus total capacity per center
                        </p>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500 font-medium">
                        <span className="flex items-center gap-1.5">
                          <span className="size-2.5 rounded-sm bg-blue-600" /> Occupied
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="size-2.5 rounded-sm bg-slate-200" /> Available
                        </span>
                      </div>
                    </div>

                    {stats.centerRooms && stats.centerRooms.length > 0 ? (
                      <div className="dashboard-scrollbar max-h-80 space-y-4 overflow-y-auto pr-1">
                        {stats.centerRooms.map((center) => {
                          const occPercent = percentage(center.occupied, center.total);
                          return (
                            <div key={center.id} className="space-y-1.5">
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="min-w-0 truncate font-semibold text-sm text-slate-800" title={`${center.name} (${center.barangay})`}>
                                  {center.name}
                                  <span className="ml-2 text-xs font-normal text-slate-500">
                                    {center.barangay}
                                  </span>
                                </span>
                                <span className="dashboard-mono shrink-0 text-xs font-medium text-slate-600">
                                  {center.occupied} / {center.total} rooms ({occPercent}%)
                                </span>
                              </div>

                              <div
                                className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100 flex"
                                role="progressbar"
                                aria-valuenow={occPercent}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-label={`${center.name}: ${center.occupied} of ${center.total} rooms occupied`}
                              >
                                <div
                                  className="h-full bg-blue-600 rounded-l-full transition-all duration-500"
                                  style={{ width: `${occPercent}%` }}
                                />
                                <div
                                  className="h-full bg-slate-200"
                                  style={{ width: `${100 - occPercent}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                        No evacuation center rooms recorded yet.
                      </p>
                    )}
                  </div>
                </section>

                {/* Bar Chart 2: Households or Residents per Barangay (Top 8) */}
                <section className="dashboard-card p-6 flex flex-col justify-between" aria-label="Top 8 barangays demographic breakdown">
                  <div>
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                      <div>
                        <h2 className="dashboard-heading text-lg font-bold text-slate-900">
                          Demographics by Barangay (Top 8)
                        </h2>
                        <p className="text-xs text-slate-500">
                          Highest registered volume of evacuees across Sogod
                        </p>
                      </div>

                      <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
                        <button
                          type="button"
                          onClick={() => setBarangayMetric("households")}
                          className={`px-2.5 py-1 rounded-md font-semibold transition ${
                            barangayMetric === "households"
                              ? "bg-white text-blue-700 shadow-sm"
                              : "text-slate-600 hover:text-slate-900"
                          }`}
                        >
                          Households
                        </button>
                        <button
                          type="button"
                          onClick={() => setBarangayMetric("residents")}
                          className={`px-2.5 py-1 rounded-md font-semibold transition ${
                            barangayMetric === "residents"
                              ? "bg-white text-blue-700 shadow-sm"
                              : "text-slate-600 hover:text-slate-900"
                          }`}
                        >
                          Residents
                        </button>
                      </div>
                    </div>

                    {topBarangays.length > 0 ? (
                      <div className="space-y-3.5">
                        {topBarangays.map((barangay, index) => {
                          const val = barangayMetric === "residents"
                            ? Number(barangay.resident_count || 0)
                            : Number(barangay.household_count || 0);
                          const barWidth = Math.round((val / maxBarangayVal) * 100);

                          return (
                            <div key={barangay.id || index} className="space-y-1">
                              <div className="flex items-center justify-between text-xs font-semibold text-slate-800">
                                <span className="flex items-center gap-2 truncate">
                                  <span className="dashboard-mono size-5 rounded bg-slate-100 grid place-items-center text-[10px] text-slate-500">
                                    {index + 1}
                                  </span>
                                  <span className="truncate">{barangay.name}</span>
                                </span>
                                <span className="dashboard-mono text-slate-900 shrink-0">
                                  {formatCount(val)}{" "}
                                  <span className="font-normal text-slate-400">
                                    {barangayMetric === "residents" ? "residents" : "households"}
                                  </span>
                                </span>
                              </div>

                              <div
                                className="h-2 w-full overflow-hidden rounded-full bg-slate-100"
                                role="progressbar"
                                aria-valuenow={barWidth}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-label={`${barangay.name}: ${val} ${barangayMetric}`}
                              >
                                <div
                                  className="h-full rounded-full bg-indigo-600 transition-all duration-500"
                                  style={{ width: `${barWidth}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                        No barangay records available.
                      </p>
                    )}
                  </div>
                </section>
              </div>

              {/* RECENT ACTIVITY: LATEST HAZARD REPORTS & RESCUE REQUESTS (5 EACH) */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {/* Recent Hazard Reports */}
                <section className="dashboard-card p-6" aria-label="Latest hazard reports">
                  <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-2.5">
                      <span className="grid size-8 place-items-center rounded-lg bg-amber-100 text-amber-700">
                        <FontAwesomeIcon icon={faTriangleExclamation} />
                      </span>
                      <div>
                        <h2 className="dashboard-heading text-lg font-bold text-slate-900">
                          Latest Hazard Reports
                        </h2>
                        <p className="text-xs text-slate-500">Recent environmental & road obstacles</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSectionChange("reports")}
                      className="text-xs font-semibold text-blue-600 hover:text-blue-800"
                    >
                      View all
                    </button>
                  </div>

                  {recentHazardReports.length > 0 ? (
                    <div className="space-y-3">
                      {recentHazardReports.map((report) => (
                        <div
                          key={report.id}
                          onClick={() => handleSectionChange("reports")}
                          className="flex items-start justify-between gap-3 p-3 rounded-xl border border-slate-100 hover:border-blue-200 hover:bg-slate-50/70 transition cursor-pointer"
                        >
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-bold text-slate-800 uppercase tracking-wider">
                                {report.report_type || "Hazard"}
                              </span>
                              <span className="text-slate-300">•</span>
                              <span className="text-xs text-slate-400 flex items-center gap-1">
                                <FontAwesomeIcon icon={faClock} className="text-[10px]" />
                                {formatTimeAgo(report.submitted_at)}
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 truncate max-w-sm">
                              {report.description || "No description provided."}
                            </p>
                          </div>

                          <span
                            className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                              report.status === "validated"
                                ? "bg-blue-100 text-blue-800 border-blue-200"
                                : report.status === "resolved"
                                ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                                : "bg-amber-100 text-amber-800 border-amber-200"
                            }`}
                          >
                            {report.status || "Pending"}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-xs text-slate-500">
                      No recent hazard reports recorded.
                    </p>
                  )}
                </section>

                {/* Recent Rescue Requests */}
                <section className="dashboard-card p-6" aria-label="Latest rescue requests">
                  <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-2.5">
                      <span className="grid size-8 place-items-center rounded-lg bg-red-100 text-red-700">
                        <FontAwesomeIcon icon={faLifeRing} />
                      </span>
                      <div>
                        <h2 className="dashboard-heading text-lg font-bold text-slate-900">
                          Latest Rescue Requests
                        </h2>
                        <p className="text-xs text-slate-500">Emergency citizen distress dispatches</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSectionChange("rescue")}
                      className="text-xs font-semibold text-blue-600 hover:text-blue-800"
                    >
                      View all
                    </button>
                  </div>

                  {recentRescueRequests.length > 0 ? (
                    <div className="space-y-3">
                      {recentRescueRequests.map((rescue) => (
                        <div
                          key={rescue.id}
                          onClick={() => handleSectionChange("rescue")}
                          className="flex items-start justify-between gap-3 p-3 rounded-xl border border-slate-100 hover:border-red-200 hover:bg-slate-50/70 transition cursor-pointer"
                        >
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-bold text-slate-900 truncate">
                                {rescue.location_description || `Incident #${rescue.id}`}
                              </span>
                              <span className="text-slate-300">•</span>
                              <span className="text-xs text-slate-400 flex items-center gap-1">
                                <FontAwesomeIcon icon={faClock} className="text-[10px]" />
                                {formatTimeAgo(rescue.created_at)}
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 truncate max-w-sm">
                              {rescue.description || "Emergency rescue request."}
                            </p>
                          </div>

                          <span
                            className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                              rescue.status === "resolved"
                                ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                                : rescue.status === "responding"
                                ? "bg-blue-100 text-blue-800 border-blue-200"
                                : rescue.status === "acknowledged"
                                ? "bg-amber-100 text-amber-800 border-amber-200"
                                : "bg-red-100 text-red-800 border-red-200"
                            }`}
                          >
                            {rescue.status || "Pending"}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-xs text-slate-500">
                      No emergency rescue requests recorded.
                    </p>
                  )}
                </section>
              </div>

              {/* 8. ADMIN ONLY: STAFF ACCOUNTS */}
              {isAdmin && (
                <section className="dashboard-card p-6" aria-labelledby="dashboard-staff-heading">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                    <div>
                      <h2 id="dashboard-staff-heading" className="dashboard-heading text-lg font-bold text-slate-900">
                        LGU Staff Accounts & Deployment
                      </h2>
                      <p className="text-xs text-slate-500">
                        Operational readiness and authentication status of designated personnel
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSectionChange("users")}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition"
                    >
                      Manage Personnel
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between">
                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Staff</p>
                        <p className="dashboard-mono text-2xl font-bold text-slate-900 mt-1">
                          {formatCount(stats.totalStaff)}
                        </p>
                      </div>
                      <span className="grid size-10 place-items-center rounded-lg bg-blue-100 text-blue-700">
                        <FontAwesomeIcon icon={faUsers} />
                      </span>
                    </div>

                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between">
                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active Staff</p>
                        <p className="dashboard-mono text-2xl font-bold text-slate-900 mt-1">
                          {formatCount(stats.activeStaff)}
                        </p>
                      </div>
                      <span className="grid size-10 place-items-center rounded-lg bg-emerald-100 text-emerald-700">
                        <FontAwesomeIcon icon={faUserCheck} />
                      </span>
                    </div>

                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex flex-col justify-between">
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span className="text-slate-600">Personnel Readiness</span>
                        <span className="dashboard-mono text-slate-900">{staffAvailability}%</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 mt-2" role="progressbar" aria-valuenow={staffAvailability} aria-valuemin={0} aria-valuemax={100}>
                        <div
                          className="h-full rounded-full bg-emerald-600 transition-all duration-500"
                          style={{ width: `${staffAvailability}%` }}
                        />
                      </div>
                      <p className="text-[11px] text-slate-400 mt-2">
                        {stats.totalStaff - stats.activeStaff} account(s) pending or deactivated
                      </p>
                    </div>
                  </div>
                </section>
              )}
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}

export default Dashboard;
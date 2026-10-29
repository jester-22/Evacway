import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowsRotate,
  faArrowRight,
  faCircleCheck,
  faClock,
  faHouseFlag,
  faLifeRing,
  faLocationDot,
  faPeopleGroup,
  faTriangleExclamation,
  faUsers,
} from "@fortawesome/free-solid-svg-icons";
import { useAuth } from "../../context/AuthContext";
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
}) {
  const totalRemaining = Math.max(0, totalCapacity - totalAssignedPeople);
  const isCapacityLow = totalCapacity > 0 && (totalRemaining / totalCapacity) < 0.10;

  if (openRescueCount > 0 || isCapacityLow) {
    const reasons = [];
    if (openRescueCount > 0) {
      reasons.push(`${openRescueCount} open rescue request${openRescueCount > 1 ? "s" : ""}`);
    }
    if (isCapacityLow) {
      const remainingPercent = Math.round((totalRemaining / totalCapacity) * 100);
      reasons.push(`Remaining capacity below 10% (${remainingPercent}%)`);
    }
    return {
      status: "action_needed",
      label: "Action needed",
      badgeClass: "ds-badge ds-badge--danger",
      dotColor: "ds-badge--danger",
      barColor: "ds-badge--danger",
      reason: reasons.join(", "),
    };
  }

  if (unassignedFamilies > 0 || pendingHazardCount > 0) {
    const reasons = [];
    if (unassignedFamilies > 0) {
      reasons.push(`${formatCount(unassignedFamilies)} unassigned household${unassignedFamilies > 1 ? "s" : ""}`);
    }
    if (pendingHazardCount > 0) {
      reasons.push(`${pendingHazardCount} pending hazard report${pendingHazardCount > 1 ? "s" : ""}`);
    }
    return {
      status: "monitoring",
      label: "Monitoring",
      badgeClass: "ds-badge ds-badge--warning",
      dotColor: "ds-badge--warning",
      barColor: "ds-badge--warning",
      reason: reasons.join(", "),
    };
  }

  return {
    status: "ready",
    label: "Ready",
    badgeClass: "ds-badge ds-badge--success",
    dotColor: "ds-badge--success",
    barColor: "ds-badge--success",
    reason: "All operations ready and within capacity",
  };
}

function StatCard({ label, value, description, icon, accentColor }) {
  return (
    <article className="dashboard-card p-4 sm:p-6 flex flex-col justify-between">
      <div>
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs sm:text-sm font-semibold text-slate-600 truncate">{label}</p>
          <span
            className="grid size-9 sm:size-11 shrink-0 place-items-center rounded-xl"
            style={{ backgroundColor: `${accentColor}15`, color: accentColor }}
          >
            <FontAwesomeIcon icon={icon} className="text-base sm:text-lg" aria-hidden="true" />
          </span>
        </div>
        <p className="dashboard-mono mt-2 sm:mt-3 text-2xl font-extrabold text-slate-900 tracking-tight sm:text-4xl">
          {formatCount(value)}
        </p>
      </div>

      <div className="mt-3 sm:mt-4 pt-2.5 sm:pt-3 border-t border-slate-100">
        <p className="text-[11px] sm:text-xs text-slate-500 truncate">{description}</p>
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
        className="relative size-36 sm:size-44 shrink-0"
        role="img"
        aria-label={`Room Distribution: ${assigned} of ${total} rooms in use`}
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
              <strong className="dashboard-mono text-lg font-extrabold text-slate-900 sm:text-2xl">
                {formatCount(assigned)} of {formatCount(total)}
              </strong>
              <span className="mt-0.5 text-[11px] sm:text-xs font-medium text-slate-500 uppercase tracking-wider">
                rooms assigned
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
          { label: "Unassigned", value: unassigned, color: "bg-slate-300", desc: "Ready for assignment" },
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

  // Assigned Families Rate
  const assignedFamiliesRate = percentage(stats?.assignedFamilies || 0, stats?.families || 0);

  // Open rescue requests & pending hazard reports
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

  // Operational metrics for action cards
  const unassignedFamilies = Number(stats?.unassignedFamilies || 0);
  const totalCapacity = Number(stats?.totalCapacity || 0);
  const totalAssignedPeople = Number(stats?.totalAssignedPeople || 0);
  const totalRemainingCapacity = Math.max(0, totalCapacity - totalAssignedPeople);
  const remainingPercent = totalCapacity > 0 ? Math.round((totalRemainingCapacity / totalCapacity) * 100) : 0;

  const rescueNumberColorClass = openRescueCount > 0 ? "text-red-600" : "text-slate-900";
  const remainingColorClass =
    totalCapacity > 0 && remainingPercent < 10
      ? "text-red-600"
      : totalCapacity > 0 && remainingPercent < 20
      ? "text-amber-600"
      : "text-slate-900";

  // Overall readiness status derived via rule helper
  const readiness = useMemo(() => {
    return getReadinessStatus({
      openRescueCount,
      totalCapacity,
      totalAssignedPeople,
      unassignedFamilies,
      pendingHazardCount,
    });
  }, [openRescueCount, totalCapacity, totalAssignedPeople, unassignedFamilies, pendingHazardCount]);

  // Needs Attention List
  const needsAttentionItems = useMemo(() => {
    if (!stats) return [];
    const items = [];

    // 1. Open rescue requests
    if (openRescueCount > 0) {
      items.push({
        id: "open-rescues",
        severity: "danger",
        badge: "Rescue Alert",
        title: `${openRescueCount} Open Rescue Request${openRescueCount > 1 ? "s" : ""}`,
        desc: "Urgent citizen distress calls requiring immediate emergency dispatch.",
        actionLabel: "View Rescue",
        tab: "rescue",
      });
    }

    // 2. Pending hazard reports
    if (pendingHazardCount > 0) {
      items.push({
        id: "pending-hazards",
        severity: "warning",
        badge: "Hazard Review",
        title: `${pendingHazardCount} Pending Hazard Report${pendingHazardCount > 1 ? "s" : ""}`,
        desc: "Submitted community hazard reports awaiting field verification.",
        actionLabel: "Review Reports",
        tab: "reports",
      });
    }

    // 3. Unassigned households
    if (stats.unassignedFamilies > 0) {
      items.push({
        id: "unassigned-households",
        severity: "warning",
        badge: "Assignment Gap",
        title: `${formatCount(stats.unassignedFamilies)} Unassigned Household${stats.unassignedFamilies > 1 ? "s" : ""}`,
        desc: "Registered families awaiting room assignment in active evacuation centers.",
        actionLabel: "Assign Families",
        tab: "barangays",
      });
    }

    // 4. Low remaining capacity below 10% in a center
    const centersList = Array.isArray(stats.centerRooms) ? stats.centerRooms : [];
    centersList.forEach((center) => {
      const cap = Number(center.capacity || 0);
      const assigned = Number(center.assignedPeople || 0);
      const remaining = Math.max(0, cap - assigned);
      if (cap > 0 && (remaining / cap) < 0.10) {
        const remainingPercent = Math.round((remaining / cap) * 100);
        items.push({
          id: `low-capacity-${center.id}`,
          severity: "danger",
          badge: "Low Capacity",
          title: `${center.name} (${remainingPercent}% capacity left)`,
          desc: `Only ${formatCount(remaining)} of ${formatCount(cap)} remaining capacity across configured rooms.`,
          actionLabel: "View Centers",
          tab: "centers",
        });
      }
    });

    return items;
  }, [stats, openRescueCount, pendingHazardCount]);

  // Occupancy by Center Data (sorted highest to lowest occupancy)
  const occupancyByCenter = useMemo(() => {
    const list = Array.isArray(stats?.centerRooms) ? [...stats.centerRooms] : [];
    return list
      .map((center) => {
        const capacity = Number(center.capacity || 0);
        const occupied = Number(center.occupiedPeople || 0);
        const assigned = Number(center.assignedPeople || 0);
        const rate = capacity > 0 ? occupied / capacity : 0;
        const percent = capacity > 0 ? Math.round((occupied / capacity) * 100) : 0;
        const assignedPercent = capacity > 0 ? Math.min(100, Math.round((assigned / capacity) * 100)) : 0;
        return {
          ...center,
          capacity,
          occupied,
          assigned,
          rate,
          percent,
          assignedPercent,
        };
      })
      .sort((a, b) => b.rate - a.rate || b.assigned - a.assigned || a.name.localeCompare(b.name));
  }, [stats]);

  // Top 8 Barangays Demographic Data
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
    return hazardList.slice(0, 5);
  }, [hazardList]);

  const recentRescueRequests = useMemo(() => {
    return rescueList.slice(0, 5);
  }, [rescueList]);

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

      <main className="dashboard-content dashboard-page bg-slate-50">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 space-y-6">
          {isLoading && !stats && (
            <div className="dashboard-loading-wrap">
              <LoadingState message="Loading dashboard data…" size="lg" />
            </div>
          )}

          {/* 1. HEADER */}
          <header className="dashboard-card p-4 sm:p-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
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
              <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm min-h-[44px]">
                <span className={`size-2.5 rounded-full ${isFetching ? "bg-amber-500 animate-ping" : "bg-emerald-500"}`} />
                <span>{isFetching ? "Syncing data..." : "Auto-updates every 30s"}</span>
              </div>

              <button
                type="button"
                onClick={handleRefreshAll}
                disabled={isRefreshing || isFetching}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 active:bg-blue-800 transition disabled:opacity-50 min-h-[44px]"
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
          {error && !isLoading && (
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
                className="inline-flex items-center justify-center rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-700 transition min-h-[44px]"
                onClick={handleRefreshAll}
              >
                Try Again
              </button>
            </section>
          )}

          {/* LOADING SKELETON - shows while loading and no stats yet */}
          {isLoading && !stats ? (
            <div className="space-y-6" aria-label="Loading dashboard" aria-busy="true">
              <div className="dashboard-skeleton h-36 rounded-2xl border border-slate-200 bg-white p-6" />
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
                {Array.from({ length: 4 }, (_, index) => (
                  <div className="dashboard-skeleton h-36 rounded-2xl border border-slate-200 bg-white p-6" key={index} />
                ))}
              </div>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                <div className="lg:col-span-8 dashboard-skeleton h-80 rounded-2xl border border-slate-200 bg-white p-6" />
                <div className="lg:col-span-4 dashboard-skeleton h-80 rounded-2xl border border-slate-200 bg-white p-6" />
              </div>
            </div>
          ) : stats ? (
            <>
              {/* 2. EVACUATION READINESS HERO BANNER */}
              <section className="dashboard-card p-4 sm:p-6 border-l-4 border-l-blue-600" aria-label="Evacuation readiness status">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                        Operational Status
                      </span>
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-0.5 text-xs font-bold ${readiness.badgeClass}`}>
                        <span className={`size-2 rounded-full ${readiness.dotColor}`} />
                        {readiness.label}
                      </span>
                      {readiness.reason && (
                        <span className="text-xs font-medium text-slate-600">
                          ({readiness.reason})
                        </span>
                      )}
                    </div>
                    <h2 className="dashboard-heading text-xl font-bold text-slate-900 sm:text-2xl">
                      Evacuation Sheltering Readiness
                    </h2>
                    <p className="text-sm text-slate-600 max-w-2xl">
                      {formatCount(stats.assignedFamilies)} of {formatCount(stats.families)} registered households are assigned to evacuation rooms.
                    </p>
                  </div>

                  <div className="sm:text-right shrink-0">
                    <span className="dashboard-mono text-3xl font-extrabold text-blue-600 sm:text-4xl">
                      {assignedFamiliesRate}%
                    </span>
                    <span className="text-xs text-slate-400 block font-medium">Assigned Rate</span>
                  </div>
                </div>

                <div className="mt-5">
                  <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100 shadow-inner" role="progressbar" aria-valuenow={assignedFamiliesRate} aria-valuemin={0} aria-valuemax={100}>
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${readiness.barColor}`}
                      style={{ width: `${Math.min(100, Math.max(0, assignedFamiliesRate))}%` }}
                    />
                  </div>
                </div>
              </section>

              {/* ACTION CARDS ROW (4 clickable action cards directly under readiness hero, above stat cards) */}
              <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4" aria-label="Operational action cards">
                {/* 1. Pending hazard reports */}
                <button
                  type="button"
                  onClick={() => handleSectionChange("reports", { status: "pending" })}
                  className="dashboard-card p-4 flex flex-col justify-between text-left hover:border-amber-400 hover:shadow-md hover:bg-amber-50/20 transition-all cursor-pointer min-h-[56px] group focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-bold text-slate-700 group-hover:text-amber-700 transition truncate">
                      Pending Hazard Reports
                    </span>
                    <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-700 text-xs">
                      <FontAwesomeIcon icon={faTriangleExclamation} />
                    </span>
                  </div>
                  <div className="mt-2">
                    <p className="dashboard-mono text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                      {formatCount(pendingHazardCount)}
                    </p>
                    <p className="mt-1 text-[11px] sm:text-xs text-slate-500 truncate">
                      Awaiting review & dispatch
                    </p>
                  </div>
                </button>

                {/* 2. Open rescue requests */}
                <button
                  type="button"
                  onClick={() => handleSectionChange("rescue")}
                  className="dashboard-card p-4 flex flex-col justify-between text-left hover:border-red-400 hover:shadow-md hover:bg-red-50/20 transition-all cursor-pointer min-h-[56px] group focus:outline-none focus:ring-2 focus:ring-red-500/50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-bold text-slate-700 group-hover:text-red-700 transition truncate">
                      Open Rescue Requests
                    </span>
                    <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-red-100 text-red-700 text-xs">
                      <FontAwesomeIcon icon={faLifeRing} />
                    </span>
                  </div>
                  <div className="mt-2">
                    <p className={`dashboard-mono text-2xl sm:text-3xl font-extrabold tracking-tight ${rescueNumberColorClass}`}>
                      {formatCount(openRescueCount)}
                    </p>
                    <p className="mt-1 text-[11px] sm:text-xs text-slate-500 truncate">
                      {openRescueCount > 0 ? "Requires emergency response" : "All distress calls resolved"}
                    </p>
                  </div>
                </button>

                {/* 3. Unassigned households */}
                <button
                  type="button"
                  onClick={() => handleSectionChange("barangays", { subtab: "families", status: "unassigned" })}
                  className="dashboard-card p-4 flex flex-col justify-between text-left hover:border-indigo-400 hover:shadow-md hover:bg-indigo-50/20 transition-all cursor-pointer min-h-[56px] group focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-bold text-slate-700 group-hover:text-indigo-700 transition truncate">
                      Unassigned Households
                    </span>
                    <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-indigo-100 text-indigo-700 text-xs">
                      <FontAwesomeIcon icon={faPeopleGroup} />
                    </span>
                  </div>
                  <div className="mt-2">
                    <p className="dashboard-mono text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                      {formatCount(unassignedFamilies)}
                    </p>
                    <p className="mt-1 text-[11px] sm:text-xs text-slate-500 truncate">
                      Awaiting room placement
                    </p>
                  </div>
                </button>

                {/* 4. Remaining capacity */}
                <button
                  type="button"
                  onClick={() => handleSectionChange("centers")}
                  className={`dashboard-card p-4 flex flex-col justify-between text-left hover:border-blue-400 hover:shadow-md transition-all cursor-pointer min-h-[56px] group focus:outline-none focus:ring-2 ${
                    remainingPercent < 10
                      ? "hover:bg-red-50/20 focus:ring-red-500/50"
                      : remainingPercent < 20
                      ? "hover:bg-amber-50/20 focus:ring-amber-500/50"
                      : "hover:bg-blue-50/20 focus:ring-blue-500/50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-bold text-slate-700 group-hover:text-blue-700 transition truncate">
                      Remaining Capacity
                    </span>
                    <span className={`grid size-7 shrink-0 place-items-center rounded-lg text-xs ${
                      remainingPercent < 10
                        ? "bg-red-100 text-red-700"
                        : remainingPercent < 20
                        ? "bg-amber-100 text-amber-700"
                        : "bg-blue-100 text-blue-700"
                    }`}>
                      <FontAwesomeIcon icon={faHouseFlag} />
                    </span>
                  </div>
                  <div className="mt-2">
                    <div className="flex items-baseline gap-1.5 flex-wrap">
                      <p className={`dashboard-mono text-2xl sm:text-3xl font-extrabold tracking-tight ${remainingColorClass}`}>
                        {formatCount(totalRemainingCapacity)}
                      </p>
                      <span className={`dashboard-mono text-xs font-bold ${remainingColorClass}`}>
                        ({remainingPercent}% left)
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] sm:text-xs text-slate-500 truncate">
                      {formatCount(stats?.totalOccupiedPeople ?? 0)} of {formatCount(totalCapacity)} here · {formatCount(totalAssignedPeople)} assigned
                    </p>
                  </div>
                </button>
              </section>

              {/* 3. STAT CARDS (4 cards: 2x2 on mobile, 4 across on desktop) */}
              <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6" aria-label="Summary statistics">
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
              </section>

              {/* 4. NEEDS ATTENTION + QUICK ACTIONS */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
                {/* Needs Attention List (8 cols) */}
                <section className="dashboard-card p-4 sm:p-6 lg:col-span-8 flex flex-col justify-between" aria-label="Action items requiring attention">
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
                        {needsAttentionItems.length} {needsAttentionItems.length === 1 ? "Item" : "Items"}
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
                              className="shrink-0 inline-flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-800 hover:bg-slate-50 shadow-sm transition min-h-[44px]"
                            >
                              <span>{item.actionLabel}</span>
                              <FontAwesomeIcon icon={faArrowRight} className="text-[10px]" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2.5 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-semibold">
                        <FontAwesomeIcon icon={faCircleCheck} className="text-emerald-600 text-base shrink-0" />
                        <span>Nothing needs attention right now.</span>
                      </div>
                    )}
                  </div>
                </section>

                {/* Quick Actions (4 cols) */}
                <section className="dashboard-card p-4 sm:p-6 lg:col-span-4 flex flex-col justify-between" aria-label="Quick operations">
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
                        className="w-full flex items-center justify-between p-3.5 rounded-xl border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition group text-left min-h-[44px]"
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
                        {pendingHazardCount > 0 ? (
                          <span className="dashboard-mono text-xs font-bold px-2 py-0.5 rounded-full bg-amber-500 text-white">
                            {pendingHazardCount}
                          </span>
                        ) : (
                          <FontAwesomeIcon icon={faArrowRight} className="text-slate-300 text-xs group-hover:text-blue-500" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSectionChange("rescue")}
                        className="w-full flex items-center justify-between p-3.5 rounded-xl border border-slate-200 hover:border-red-300 hover:bg-red-50/50 transition group text-left min-h-[44px]"
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
                        {openRescueCount > 0 ? (
                          <span className="dashboard-mono text-xs font-bold px-2 py-0.5 rounded-full bg-red-600 text-white animate-pulse">
                            {openRescueCount}
                          </span>
                        ) : (
                          <FontAwesomeIcon icon={faArrowRight} className="text-slate-300 text-xs group-hover:text-red-500" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSectionChange("barangays")}
                        className="w-full flex items-center justify-between p-3.5 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50 transition group text-left min-h-[44px]"
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
                        className="w-full flex items-center justify-between p-3.5 rounded-xl border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/50 transition group text-left min-h-[44px]"
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

              {/* 5. RECENT ACTIVITY: LATEST HAZARD REPORTS & RESCUE REQUESTS */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 items-start">
                {/* Recent Hazard Reports */}
                <section className="dashboard-card p-4 sm:p-6" aria-label="Latest hazard reports">
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
                      className="inline-flex items-center justify-center text-xs font-semibold text-blue-600 hover:text-blue-800 min-h-[44px] px-2"
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
                          className="flex items-start justify-between gap-3 p-3 rounded-xl border border-slate-100 hover:border-blue-200 hover:bg-slate-50/70 transition cursor-pointer min-h-[44px]"
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
                <section className="dashboard-card p-4 sm:p-6" aria-label="Latest rescue requests">
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
                      className="inline-flex items-center justify-center text-xs font-semibold text-blue-600 hover:text-blue-800 min-h-[44px] px-2"
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
                          className="flex items-start justify-between gap-3 p-3 rounded-xl border border-slate-100 hover:border-red-200 hover:bg-slate-50/70 transition cursor-pointer min-h-[44px]"
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

              {/* 6. OCCUPANCY BY CENTER + ROOMS DONUT */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
                {/* Occupancy by Center (7 cols) */}
                <section className="dashboard-card p-4 sm:p-6 lg:col-span-7 flex flex-col justify-between" aria-label="Occupancy by center">
                  <div>
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                      <div>
                        <h2 className="dashboard-heading text-lg font-bold text-slate-900">
                          Occupancy by Center
                        </h2>
                        <p className="text-xs text-slate-500">
                          People assigned compared with facility capacity
                        </p>
                      </div>
                      <span className="dashboard-mono text-xs font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">
                        {occupancyByCenter.length} {occupancyByCenter.length === 1 ? "Center" : "Centers"}
                      </span>
                    </div>

                    {occupancyByCenter.length > 0 ? (
                      <div className="dashboard-scrollbar max-h-80 space-y-4 overflow-y-auto pr-1">
                        {occupancyByCenter.map((center) => (
                          <div key={center.id} className="space-y-1.5">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="min-w-0 truncate font-semibold text-sm text-slate-800" title={`${center.name} (${center.barangay})`}>
                                {center.name}
                                <span className="ml-2 text-xs font-normal text-slate-500">
                                  {center.barangay}
                                </span>
                              </span>
                              <span className="dashboard-mono shrink-0 text-xs font-semibold text-slate-700">
                                {formatCount(center.occupied)} of {formatCount(center.capacity)} here · {formatCount(center.assigned)} assigned
                              </span>
                            </div>

                            <div
                              className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100 flex relative"
                              role="progressbar"
                              aria-valuenow={center.percent}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-label={`${center.name}: ${center.occupied} of ${center.capacity} here, ${center.assigned} assigned`}
                            >
                              {center.assignedPercent > 0 && (
                                <div
                                  className="h-full bg-slate-400/45 rounded-full transition-all duration-500 absolute top-0 left-0"
                                  style={{ width: `${Math.min(100, Math.max(0, center.assignedPercent))}%` }}
                                />
                              )}
                              <div
                                className="h-full bg-emerald-600 rounded-full transition-all duration-500 relative z-10"
                                style={{ width: `${Math.min(100, Math.max(0, center.percent))}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                        No evacuation center rooms recorded yet.
                      </p>
                    )}
                  </div>
                </section>

                {/* Rooms Donut (5 cols) */}
                <section className="dashboard-card p-4 sm:p-6 lg:col-span-5 flex flex-col justify-between" aria-label="Room status">
                  <div>
                    <div className="mb-4 border-b border-slate-100 pb-3">
                      <h2 className="dashboard-heading text-lg font-bold text-slate-900">
                        Room Distribution
                      </h2>
                      <p className="text-xs text-slate-500">
                        Shelter rooms currently assigned vs unassigned
                      </p>
                    </div>

                    <RoomDonut
                      total={stats.totalRooms}
                      assigned={stats.occupiedRooms}
                      unassigned={Math.max(0, (stats.totalRooms || 0) - (stats.occupiedRooms || 0))}
                    />
                  </div>
                </section>
              </div>

              {/* 7. DEMOGRAPHICS BY BARANGAY (TOP 8) */}
              <section className="dashboard-card p-4 sm:p-6 flex flex-col justify-between" aria-label="Top 8 barangays demographic breakdown">
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
                        className={`px-3 py-1.5 rounded-md font-semibold transition min-h-[44px] inline-flex items-center justify-center ${
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
                        className={`px-3 py-1.5 rounded-md font-semibold transition min-h-[44px] inline-flex items-center justify-center ${
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

              {/* 8. STAFF CARD (AT BOTTOM OF PAGE) */}
              {isAdmin && (
                <section className="dashboard-card p-4 sm:p-6" aria-labelledby="dashboard-staff-heading">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                      <h2 id="dashboard-staff-heading" className="dashboard-heading text-lg font-bold text-slate-900">
                        LGU Staff Accounts
                      </h2>
                      <p className="mt-1 text-sm text-slate-600">
                        Active accounts <span className="dashboard-mono font-bold text-slate-900">{formatCount(stats.activeStaff)} of {formatCount(stats.totalStaff)}</span>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSectionChange("users")}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 hover:text-blue-600 transition min-h-[44px]"
                    >
                      <span>Manage Users</span>
                      <FontAwesomeIcon icon={faArrowRight} className="text-xs" />
                    </button>
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
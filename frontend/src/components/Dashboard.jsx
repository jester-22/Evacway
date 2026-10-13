import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCircleCheck,
  faHouseFlag,
  faLocationDot,
  faPeopleGroup,
  faTriangleExclamation,
  faUserCheck,
  faUsers,
} from "@fortawesome/free-solid-svg-icons";
import { useAuth } from "../context/AuthContext";
import { useDashboardSummary } from "../hooks/useEvacuationQueries";
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

function StatCard({ label, value, description, icon }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-600">{label}</p>
          <p className="dashboard-mono mt-2 text-2xl font-bold text-slate-900 sm:text-3xl">
            {formatCount(value)}
          </p>
        </div>
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-600">
          <FontAwesomeIcon icon={icon} aria-hidden="true" />
        </span>
      </div>
      <p className="mt-3 text-xs text-slate-500">{description}</p>
    </article>
  );
}

function RoomDonut({ total, available, occupied }) {
  const radius = 43;
  const circumference = 2 * Math.PI * radius;
  const availableArc = total ? (available / total) * circumference : 0;
  const occupiedArc = total ? (occupied / total) * circumference : 0;

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:justify-center sm:gap-10">
      <div className="relative size-44 shrink-0" role="img" aria-label={`Rooms: ${available} available and ${occupied} occupied, ${total} total`}>
        <svg className="size-full -rotate-90" viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r={radius} fill="none" stroke="#e2e8f0" strokeWidth="12" />
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
                strokeDasharray={`${availableArc} ${circumference}`}
              />
              {occupied > 0 && (
                <circle
                  cx="60"
                  cy="60"
                  r={radius}
                  fill="none"
                  stroke="#94a3b8"
                  strokeWidth="12"
                  strokeLinecap="round"
                  strokeDasharray={`${occupiedArc} ${circumference}`}
                  strokeDashoffset={-availableArc}
                />
              )}
            </>
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          {total > 0 ? (
            <>
              <strong className="dashboard-mono text-2xl font-bold text-slate-900">{formatCount(total)}</strong>
              <span className="mt-0.5 text-xs text-slate-500">Total Rooms</span>
            </>
          ) : (
            <span className="max-w-24 text-xs font-medium text-slate-500">No rooms yet</span>
          )}
        </div>
      </div>

      <div className="w-full max-w-xs space-y-3">
        {[
          { label: "Available Rooms", value: available, color: "bg-blue-600" },
          { label: "Rooms in Use", value: occupied, color: "bg-slate-400" },
        ].map((item) => (
          <div className="flex items-center justify-between gap-4" key={item.label}>
            <span className="flex items-center gap-2 text-sm text-slate-600">
              <span className={`size-2.5 rounded-full ${item.color}`} />
              {item.label}
            </span>
            <span className="dashboard-mono text-sm font-semibold text-slate-900">
              {formatCount(item.value)} <span className="font-normal text-slate-500">({percentage(item.value, total)}%)</span>
            </span>
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
  const { stats, isLoading, isFetching, error, refetch } = useDashboardSummary(isAdmin);

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

  const roomAvailability = percentage(stats?.availableRooms || 0, stats?.totalRooms || 0);
  const staffAvailability = percentage(stats?.activeStaff || 0, stats?.totalStaff || 0);

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
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
          <header className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
              <p className="mt-1 text-sm text-slate-500">Summary of households, evacuation centers, and room availability.</p>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">
              <span className="size-2 rounded-full bg-green-600" />
              {isFetching ? "Updating..." : "Auto-updates every 30s"}
            </div>
          </header>

          {error && (
            <section className="mb-6 flex flex-col justify-between gap-4 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800 sm:flex-row sm:items-center" role="alert">
              <div>
                <h2 className="text-sm font-bold">Could not load dashboard data</h2>
                <p className="mt-1 text-sm text-red-700">{error?.message || String(error)}</p>
              </div>
              <button
                type="button"
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
                onClick={refetch}
              >
                Try Again
              </button>
            </section>
          )}

          {isLoading && !stats ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Loading dashboard" aria-busy="true">
              {Array.from({ length: isAdmin ? 6 : 4 }, (_, index) => (
                <div className="dashboard-skeleton h-32 rounded-xl border border-slate-200 bg-white p-5" key={index}>
                  <div className="h-3 w-2/5 rounded bg-slate-200" />
                  <div className="mt-4 h-7 w-1/2 rounded bg-slate-200" />
                  <div className="mt-4 h-3 w-3/4 rounded bg-slate-100" />
                </div>
              ))}
            </div>
          ) : !stats && error ? (
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
              Statistics will appear once the connection is restored.
            </div>
          ) : stats ? (
            <>
              <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Summary statistics">
                <StatCard label="Barangays" value={stats.barangays} description="Registered barangays" icon={faLocationDot} />
                <StatCard label="Households" value={stats.families} description={`${formatCount(stats.assignedFamilies || 0)} assigned to rooms`} icon={faPeopleGroup} />
                <StatCard label="Unassigned Households" value={stats.unassignedFamilies} description="Households without an evacuation assignment" icon={faTriangleExclamation} />
                <StatCard label="Residents" value={stats.residents} description="Registered individual residents" icon={faUsers} />
                <StatCard label="Evacuation Centers" value={stats.centers} description="Active evacuation centers" icon={faHouseFlag} />
                <StatCard label="Available Rooms" value={stats.availableRooms} description={`${roomAvailability}% of ${formatCount(stats.totalRooms || 0)} rooms are open`} icon={faCircleCheck} />
              </section>

              <section className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-2" aria-label="Room availability">
                <article className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="mb-4">
                    <h2 className="text-base font-bold text-slate-900">Room Availability</h2>
                    <p className="mt-0.5 text-xs text-slate-500">Open rooms compared with rooms currently in use</p>
                  </div>
                  <RoomDonut total={stats.totalRooms} available={stats.availableRooms} occupied={stats.occupiedRooms} />
                </article>

                <article className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-bold text-slate-900">Rooms by Evacuation Center</h2>
                      <p className="mt-0.5 text-xs text-slate-500">Open rooms in each center</p>
                    </div>
                    <div className="flex gap-3 text-xs text-slate-500">
                      <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-blue-600" />Available</span>
                      <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-slate-300" />In Use</span>
                    </div>
                  </div>
                  {stats.centerRooms.length ? (
                    <div className="max-h-72 space-y-4 overflow-y-auto pr-1">
                      {stats.centerRooms.map((center) => (
                        <div key={center.id}>
                          <div className="mb-1.5 flex items-baseline justify-between gap-3">
                            <span className="min-w-0 truncate" title={`${center.name} (${center.barangay})`}>
                              <span className="block truncate text-sm font-semibold text-slate-800">{center.name}</span>
                              <span className="block truncate text-xs text-slate-500">{center.barangay}</span>
                            </span>
                            <span className="dashboard-mono shrink-0 text-xs font-medium text-slate-600">{center.available} of {center.total} open</span>
                          </div>
                          {center.total > 0 ? (
                            <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${center.name}: ${center.available} available and ${center.occupied} occupied of ${center.total} rooms`}>
                              <span
                                className="bg-blue-600"
                                style={{ width: `${percentage(center.available, center.total)}%` }}
                              />
                              <span
                                className="bg-slate-300"
                                style={{ width: `${percentage(center.occupied, center.total)}%` }}
                              />
                            </div>
                          ) : (
                            <div className="h-2.5 rounded-full bg-slate-100" />
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">No evacuation centers recorded yet.</p>
                  )}
                </article>
              </section>

              {isAdmin && (
                <section className="mt-6" aria-labelledby="dashboard-staff-heading">
                  <div className="mb-3">
                    <h2 id="dashboard-staff-heading" className="text-base font-bold text-slate-900">Staff Accounts</h2>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <StatCard label="Total Staff" value={stats.totalStaff} description="Registered personnel" icon={faUsers} />
                    <StatCard label="Active Staff" value={stats.activeStaff} description={`${staffAvailability}% active`} icon={faUserCheck} />
                    <article className="rounded-xl border border-slate-200 bg-white p-5 sm:col-span-2 lg:col-span-2">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-800">Staff Availability</h3>
                          <p className="mt-0.5 text-xs text-slate-500">Active accounts out of total registered staff</p>
                        </div>
                        <span className="dashboard-mono text-sm font-semibold text-slate-800">{formatCount(stats.activeStaff)} / {formatCount(stats.totalStaff)}</span>
                      </div>
                      <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${stats.activeStaff} active staff out of ${stats.totalStaff}`}>
                        <span className="block h-full rounded-full bg-blue-600" style={{ width: `${staffAvailability}%` }} />
                      </div>
                    </article>
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
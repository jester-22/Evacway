import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  DoorOpen,
  LifeBuoy,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  UserCheck,
  X,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { countOpenRescueRequests } from "../../utils/rescueStatus";
import { formatManilaDate, getManilaDateKey } from "../../utils/dateTime";
import { api } from "../../services/api";
import {
  useDashboardSummary,
  useHazardReports,
  useRescueRequests,
} from "../../hooks/useEvacuationQueries";
import { Button, ProgressBar, SectionHeader, SegmentedControl, StatCard } from "../ui";
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

function DashboardStatSkeleton({ label }) {
  return (
    <div
      className="dashboard-stat-skeleton"
      role="status"
      aria-busy="true"
      aria-label={`Loading ${label}`}
    >
      <div className="dashboard-stat-skeleton__top">
        <span className="ds-skeleton dashboard-stat-skeleton__icon" aria-hidden="true" />
        <span className="ds-skeleton dashboard-stat-skeleton__label" aria-hidden="true" />
      </div>
      <span className="ds-skeleton dashboard-stat-skeleton__value" aria-hidden="true" />
      <span className="ds-skeleton dashboard-stat-skeleton__footer" aria-hidden="true" />
    </div>
  );
}

/* -------------------------------------------------------------
   CENTER ARRIVAL & CAPACITY MATRIX (2-COLUMN GRID)
   ------------------------------------------------------------- */
function CenterArrivalList({
  centers = [],
  basePath = "/admin",
  isLoading = false,
  error = null,
  onRetry,
}) {
  const [tooltip, setTooltip] = useState(null);

  const handleShowTooltip = useCallback((center, element) => {
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const width = 260;
    const height = 56;

    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(12, Math.min(window.innerWidth - width - 12, left));

    let top = rect.top - height - 8;
    if (top < 10) {
      top = rect.bottom + 8;
    }

    setTooltip({
      center,
      top,
      left,
    });
  }, []);

  const handleHideTooltip = useCallback(() => {
    setTooltip(null);
  }, []);

  useEffect(() => {
    if (!tooltip) return undefined;
    const handleDismiss = () => setTooltip(null);
    const handleKeyDown = (e) => {
      if (e.key === "Escape") setTooltip(null);
    };
    window.addEventListener("scroll", handleDismiss, true);
    window.addEventListener("resize", handleDismiss);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("scroll", handleDismiss, true);
      window.removeEventListener("resize", handleDismiss);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [tooltip]);

  const sortedCenters = useMemo(() => {
    const list = Array.isArray(centers) ? centers : [];
    return [...list].sort((a, b) => {
      const diff = (b?.assignedPercent ?? 0) - (a?.assignedPercent ?? 0);
      if (diff !== 0) return diff;
      return (a?.name || "").localeCompare(b?.name || "");
    });
  }, [centers]);

  const countLabel = `${sortedCenters.length} ${sortedCenters.length === 1 ? "center" : "centers"}`;

  return (
    <section
      className="dashboard-surface-card dashboard-capacity-card"
      aria-label="Center arrival and capacity"
    >
      <SectionHeader
        icon={Building2}
        title="Center arrival & capacity"
        meta={
          !isLoading && !error ? (
            <span className="dashboard-count-chip">{countLabel}</span>
          ) : null
        }
        actions={
          <Link to={`${basePath}?tab=centers`} className="dashboard-section-link">
            <span>Manage shelter facilities</span>
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        }
      />

      {isLoading ? (
        <div
          className="dashboard-capacity-grid"
          role="status"
          aria-busy="true"
          aria-label="Loading evacuation center capacity"
        >
          {[0, 1, 2, 3].map((slot) => (
            <div key={slot} className="dashboard-capacity-skeleton" aria-hidden="true">
              <div className="dashboard-capacity-skeleton__top">
                <span className="ds-skeleton dashboard-skel-line dashboard-skel-line--mid" />
                <span className="ds-skeleton dashboard-skel-line dashboard-skel-line--xs" />
              </div>
              <span className="ds-skeleton dashboard-skel-bar dashboard-skel-bar--sm" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="dashboard-card-state" role="alert">
          <AlertTriangle
            size={18}
            className="dashboard-card-state__icon--danger"
            aria-hidden="true"
          />
          <p className="dashboard-card-state__text">
            {error?.message || "Could not load evacuation center capacity."}
          </p>
          {onRetry && (
            <Button variant="secondary" onClick={onRetry}>
              Retry sync
            </Button>
          )}
        </div>
      ) : sortedCenters.length === 0 ? (
        <div className="dashboard-empty-card">
          <span className="dashboard-empty-card__icon" aria-hidden="true">
            <Building2 size={20} />
          </span>
          <p className="dashboard-empty-card__title">No evacuation centers yet</p>
          <p className="dashboard-empty-card__text">
            Add an evacuation center to monitor capacity and arrivals here.
          </p>
        </div>
      ) : (
        <div className="dashboard-capacity-grid">
          {sortedCenters.map((center) => {
            const pct = Number(center.assignedPercent ?? 0);
            const isHigh = pct >= 80;
            const tooltipId = `dashboard-center-tip-${center.id}`;
            const isTooltipVisible = tooltip?.center?.id === center.id;

            return (
              <Link
                key={center.id}
                to={`${basePath}?tab=checkin&center_id=${encodeURIComponent(center.id)}`}
                className="dashboard-capacity-item"
                aria-describedby={isTooltipVisible ? tooltipId : undefined}
                onMouseEnter={(e) => handleShowTooltip(center, e.currentTarget)}
                onMouseLeave={handleHideTooltip}
                onFocus={(e) => handleShowTooltip(center, e.currentTarget)}
                onBlur={handleHideTooltip}
              >
                <div className="dashboard-capacity-item__top">
                  <span className="dashboard-capacity-item__name">{center.name}</span>
                  <span
                    className={`dashboard-capacity-item__pct ${isHigh ? "is-high" : ""}`}
                  >
                    {pct}%
                  </span>
                </div>

                <ProgressBar
                  value={pct}
                  max={100}
                  variant="capacity"
                  size={6}
                  ariaLabel={`${center.name}: ${pct}% assigned (${formatCount(center.checkedInCount)} arrived, ${formatCount(center.assignedCount)} assigned, ${formatCount(center.capacity)} capacity)`}
                />
              </Link>
            );
          })}
        </div>
      )}

      {/* Floating Hover / Keyboard Focus Tooltip */}
      {tooltip && (
        <div
          id={`dashboard-center-tip-${tooltip.center.id}`}
          role="tooltip"
          className="dashboard-capacity-tooltip"
          style={{
            top: `${tooltip.top}px`,
            left: `${tooltip.left}px`,
          }}
        >
          <div className="dashboard-capacity-tooltip__title">
            {tooltip.center.name}
          </div>
          <div className="dashboard-capacity-tooltip__stats">
            <strong>{formatCount(tooltip.center.checkedInCount)}</strong> arrived /{" "}
            <strong>{formatCount(tooltip.center.assignedCount)}</strong> assigned /{" "}
            <strong>{formatCount(tooltip.center.capacity)}</strong> capacity
          </div>
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------
   STATUS GROUPING HELPERS
   ------------------------------------------------------------- */
function getHazardStatusGroup(report) {
  const serverGroup = String(report?.status_group || "").toLowerCase();
  if (["active", "pending", "cleared"].includes(serverGroup)) return serverGroup;
  const status = String(report?.status || "").toLowerCase().trim();
  if (status === "pending") return "pending";
  if (["resolved", "cleared", "rejected"].includes(status)) return "cleared";
  return "active";
}

function getRescueStatusGroup(status) {
  const rawStatus = typeof status === "object" ? status?.status : status;
  const s = String(rawStatus || "").toLowerCase().trim();
  if (s === "pending" || s === "open") return "open";
  if (s === "acknowledged" || s === "responding" || s === "in_progress") return "in_progress";
  if (s === "resolved" || s === "closed" || s === "cleared") return "resolved";
  return "open";
}

/* -------------------------------------------------------------
   MONOTONE CUBIC SPLINE HELPER (FRITSCH-CARLSON)
   ------------------------------------------------------------- */
function getMonotoneBezierPath(points) {
  const n = points.length;
  if (n === 0) return "";
  if (n === 1) return `M ${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
  if (n === 2) {
    return `M ${points[0][0].toFixed(1)},${points[0][1].toFixed(1)} L ${points[1][0].toFixed(1)},${points[1][1].toFixed(1)}`;
  }

  const dxs = [];
  const dys = [];
  const deltas = [];

  for (let i = 0; i < n - 1; i++) {
    const dx = points[i + 1][0] - points[i][0];
    const dy = points[i + 1][1] - points[i][1];
    dxs.push(dx);
    dys.push(dy);
    deltas.push(dx !== 0 ? dy / dx : 0);
  }

  const ms = new Array(n).fill(0);
  ms[0] = deltas[0];
  ms[n - 1] = deltas[n - 2];

  for (let i = 1; i < n - 1; i++) {
    if (deltas[i - 1] * deltas[i] <= 0) {
      ms[i] = 0;
    } else {
      ms[i] = (deltas[i - 1] + deltas[i]) / 2;
    }
  }

  for (let i = 0; i < n - 1; i++) {
    if (deltas[i] === 0) {
      ms[i] = 0;
      ms[i + 1] = 0;
    } else {
      const alpha = ms[i] / deltas[i];
      const beta = ms[i + 1] / deltas[i];
      if (alpha < 0) ms[i] = 0;
      if (beta < 0) ms[i + 1] = 0;
      const dist2 = alpha * alpha + beta * beta;
      if (dist2 > 9) {
        const tau = 3 / Math.sqrt(dist2);
        ms[i] = tau * alpha * deltas[i];
        ms[i + 1] = tau * beta * deltas[i];
      }
    }
  }

  let path = `M ${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = dxs[i];
    const cp1x = points[i][0] + dx / 3;
    const cp1y = points[i][1] + (ms[i] * dx) / 3;
    const cp2x = points[i + 1][0] - dx / 3;
    const cp2y = points[i + 1][1] - (ms[i + 1] * dx) / 3;
    path += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${points[i + 1][0].toFixed(1)},${points[i + 1][1].toFixed(1)}`;
  }
  return path;
}

/* -------------------------------------------------------------
   INCIDENT TRENDS LINE GRAPH CARD (CURRENT CALENDAR MONTH)
   ------------------------------------------------------------- */
function IncidentTrendsCard({
  title,
  icon: IconComponent,
  items = [],
  isLoading = false,
  error = null,
  onRetry,
  dateExtractor,
  statusExtractor,
  seriesConfig = [],
  selectedYear,
  selectedMonth,
  monthLabel,
  isCurrentMonth,
  onPrevMonth,
  onNextMonth,
  emptyTitle,
  ariaLabel,
}) {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const [hiddenSeries, setHiddenSeries] = useState(() => new Set());
  const containerRef = useRef(null);

  const toggleSeries = (key) => {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // 1. Filter items to only the selected month (in Asia/Manila time)
  const monthItems = useMemo(() => {
    const targetPrefix = `${selectedYear}-${String(selectedMonth + 1).padStart(2, "0")}-`;
    return (items || []).filter((item) => {
      const raw = dateExtractor ? dateExtractor(item) : item?.submitted_at || item?.created_at;
      if (!raw) return false;
      const manilaKey = getManilaDateKey(raw);
      return Boolean(manilaKey && manilaKey.startsWith(targetPrefix));
    });
  }, [items, dateExtractor, selectedYear, selectedMonth]);

  // 2. Legend totals for the selected month
  const totalCounts = useMemo(() => {
    const counts = {};
    seriesConfig.forEach((s) => {
      counts[s.key] = 0;
    });
    monthItems.forEach((item) => {
      const grp = statusExtractor ? statusExtractor(item) : item.status;
      if (counts[grp] !== undefined) {
        counts[grp] += 1;
      }
    });
    return counts;
  }, [monthItems, seriesConfig, statusExtractor]);

  // 3. Days in selected month & counts per day
  const monthMeta = useMemo(() => {
    const totalDays = new Date(selectedYear, selectedMonth + 1, 0).getDate();
    const monthPadded = String(selectedMonth + 1).padStart(2, "0");
    const shortMonthName = formatManilaDate(
      `${selectedYear}-${monthPadded}-01`,
      { month: "short" }
    );
    const [todayYear, todayMonthOneBased, todayDay] = getManilaDateKey(new Date())
      .split("-")
      .map(Number);
    const todayMonth = (todayMonthOneBased || 1) - 1;
    const isThisMonth = selectedYear === todayYear && selectedMonth === todayMonth;
    const maxDayWithData = isThisMonth
      ? Math.min(todayDay, totalDays)
      : selectedYear < todayYear || (selectedYear === todayYear && selectedMonth < todayMonth)
        ? totalDays
        : 0;

    const list = [];
    for (let d = 1; d <= totalDays; d++) {
      const key = `${selectedYear}-${monthPadded}-${String(d).padStart(2, "0")}`;
      const shortDay = `${shortMonthName} ${d}`;
      const fullDate = formatManilaDate(key, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      const counts = {};
      seriesConfig.forEach((s) => {
        counts[s.key] = 0;
      });

      list.push({
        dayNum: d,
        key,
        shortDay,
        fullDate,
        counts,
      });
    }

    monthItems.forEach((item) => {
      const raw = dateExtractor ? dateExtractor(item) : item?.submitted_at || item?.created_at;
      if (!raw) return;
      const manilaKey = getManilaDateKey(raw);
      const dayNum = manilaKey ? Number(manilaKey.slice(8, 10)) : NaN;
      if (dayNum >= 1 && dayNum <= totalDays) {
        const grp = statusExtractor ? statusExtractor(item) : item.status;
        if (list[dayNum - 1] && list[dayNum - 1].counts[grp] !== undefined) {
          list[dayNum - 1].counts[grp] += 1;
        }
      }
    });

    return {
      daysList: list,
      totalDays,
      maxDayWithData,
    };
  }, [selectedYear, selectedMonth, monthItems, dateExtractor, statusExtractor, seriesConfig]);

  const { daysList, totalDays, maxDayWithData } = monthMeta;
  const passedDays = daysList.slice(0, maxDayWithData);

  // SVG dimensions
  const vbWidth = 500;
  const vbHeight = 220;
  const padLeft = 32;
  const padRight = 16;
  const padTop = 16;
  const padBottom = 32;

  const plotW = vbWidth - padLeft - padRight;
  const plotH = vbHeight - padTop - padBottom;
  const baseY = padTop + plotH;

  const activeSeries = seriesConfig.filter((s) => !hiddenSeries.has(s.key));
  const maxVal = Math.max(
    ...passedDays.flatMap((d) => activeSeries.map((s) => d.counts[s.key] || 0)),
    0
  );

  let maxY = 4;
  let yTicks = [0, 1, 2, 3, 4];
  if (maxVal > 4) {
    const step = Math.ceil(maxVal / 4);
    maxY = step * 4;
    yTicks = [0, step, step * 2, step * 3, maxY];
  } else if (maxVal > 0) {
    maxY = Math.max(2, maxVal);
    yTicks = Array.from({ length: maxY + 1 }, (_, i) => i);
  }

  // Calculate points only for passedDays (up to today's date)
  const seriesPoints = {};
  seriesConfig.forEach((s) => {
    seriesPoints[s.key] = passedDays.map((d) => {
      const x = padLeft + ((d.dayNum - 1) / (totalDays - 1)) * plotW;
      const count = d.counts[s.key] || 0;
      const y = maxY > 0 ? baseY - (count / maxY) * plotH : baseY;
      return [x, y];
    });
  });

  const hoveredDay = hoveredIndex != null ? passedDays[hoveredIndex] : null;
  const hoveredX = hoveredDay ? padLeft + ((hoveredDay.dayNum - 1) / (totalDays - 1)) * plotW : null;

  return (
    <section
      className="dashboard-surface-card dashboard-chart-card"
      aria-label={title}
    >
      <div className="dashboard-chart-top">
        <SectionHeader
          icon={IconComponent}
          title={title}
          actions={
            <div className="dashboard-month-switcher" role="group" aria-label={`${title} month navigation`}>
              <button
                type="button"
                onClick={onPrevMonth}
                aria-label={`Previous month for ${title}`}
                className="dashboard-month-btn"
              >
                <ChevronLeft size={14} aria-hidden="true" />
              </button>

              <span className="dashboard-month-label">{monthLabel}</span>

              <button
                type="button"
                onClick={onNextMonth}
                disabled={isCurrentMonth}
                aria-label={`Next month for ${title}`}
                className="dashboard-month-btn"
              >
                <ChevronRight size={14} aria-hidden="true" />
              </button>
            </div>
          }
        />

        {/* Legend with colored dots and bold counts */}
        <div className="dashboard-chart-legend">
          {isLoading
            ? seriesConfig.map((s) => (
                <span
                  key={s.key}
                  className="ds-skeleton dashboard-skel-legend-pill"
                  aria-hidden="true"
                />
              ))
            : seriesConfig.map((s) => {
                const isHidden = hiddenSeries.has(s.key);
                return (
                  <button
                    key={s.key}
                    type="button"
                    aria-pressed={!isHidden}
                    onClick={() => toggleSeries(s.key)}
                    className={`dashboard-legend-btn ${isHidden ? "is-hidden" : ""}`}
                  >
                    <span
                      className="dashboard-legend-dot"
                      style={{ backgroundColor: s.color }}
                      aria-hidden="true"
                    />
                    <span className="dashboard-legend-label">{s.label}</span>
                    <strong className="dashboard-legend-count">
                      {totalCounts[s.key] || 0}
                    </strong>
                  </button>
                );
              })}
        </div>
      </div>

      {/* Loading / Error / Empty / Chart Body */}
      {isLoading ? (
        <div
          className="dashboard-chart-skeleton"
          role="status"
          aria-busy="true"
          aria-label={`Loading ${title.toLowerCase()} chart`}
        >
          <span className="ds-skeleton dashboard-skel-line dashboard-chart-skeleton__line" aria-hidden="true" />
          <span className="ds-skeleton dashboard-skel-line dashboard-chart-skeleton__line" aria-hidden="true" />
          <span className="ds-skeleton dashboard-skel-line dashboard-chart-skeleton__line" aria-hidden="true" />
          <span className="ds-skeleton dashboard-skel-line dashboard-chart-skeleton__line" aria-hidden="true" />
        </div>
      ) : error ? (
        <div className="dashboard-card-state" role="alert">
          <AlertTriangle
            size={18}
            className="dashboard-card-state__icon--danger"
            aria-hidden="true"
          />
          <p className="dashboard-card-state__text">
            {error?.message || `Could not load ${title.toLowerCase()}.`}
          </p>
          {onRetry && (
            <Button variant="secondary" onClick={onRetry}>
              Retry
            </Button>
          )}
        </div>
      ) : monthItems.length === 0 ? (
        <div className="dashboard-chart-empty-state">
          <span className="dashboard-empty-card__icon" aria-hidden="true">
            {IconComponent && <IconComponent size={20} />}
          </span>
          <p className="dashboard-empty-card__title">{emptyTitle}</p>
        </div>
      ) : (
        <div
          ref={containerRef}
          tabIndex={0}
          className="dashboard-chart-container"
          aria-label={`${ariaLabel}. Use left and right arrow keys to inspect daily counts.`}
          aria-describedby={hoveredDay ? `dashboard-chart-tip-${title.toLowerCase().replace(/\s+/g, "-")}` : undefined}
          onMouseLeave={() => setHoveredIndex(null)}
          onFocus={() => {
            if (passedDays.length > 0) {
              setHoveredIndex((prev) => (prev != null ? prev : passedDays.length - 1));
            }
          }}
          onBlur={() => setHoveredIndex(null)}
          onKeyDown={(e) => {
            if (passedDays.length === 0) return;
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              setHoveredIndex((prev) =>
                prev == null ? passedDays.length - 1 : Math.max(0, prev - 1)
              );
            } else if (e.key === "ArrowRight") {
              e.preventDefault();
              setHoveredIndex((prev) =>
                prev == null ? 0 : Math.min(passedDays.length - 1, prev + 1)
              );
            } else if (e.key === "Home") {
              e.preventDefault();
              setHoveredIndex(0);
            } else if (e.key === "End") {
              e.preventDefault();
              setHoveredIndex(passedDays.length - 1);
            } else if (e.key === "Escape") {
              setHoveredIndex(null);
            }
          }}
        >
          <svg
            role="img"
            aria-label={ariaLabel}
            viewBox={`0 0 ${vbWidth} ${vbHeight}`}
            className="dashboard-chart-svg"
            preserveAspectRatio="none"
          >
            {/* Horizontal gridlines (--divider) & 10px Y-axis labels (--muted) */}
            {yTicks.map((tick) => {
              const y = baseY - (tick / maxY) * plotH;
              return (
                <g key={tick}>
                  <line
                    x1={padLeft}
                    x2={padLeft + plotW}
                    y1={y}
                    y2={y}
                    stroke="var(--divider)"
                    strokeWidth="1"
                    strokeDasharray="4 4"
                  />
                  <text
                    x={padLeft - 8}
                    y={y + 3.5}
                    textAnchor="end"
                    fontSize="10"
                    fill="var(--muted)"
                    className="dashboard-chart-axis-label"
                  >
                    {tick}
                  </text>
                </g>
              );
            })}

            {/* Lines (thin 2px, monotone interpolation, only up to today's date) */}
            {seriesConfig.map((s) => {
              if (hiddenSeries.has(s.key)) return null;
              const pts = seriesPoints[s.key];
              const pathD = getMonotoneBezierPath(pts);
              return (
                <path
                  key={s.key}
                  d={pathD}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              );
            })}

            {/* Small dots on data points (only up to today's date) */}
            {seriesConfig.map((s) => {
              if (hiddenSeries.has(s.key)) return null;
              const pts = seriesPoints[s.key];
              return pts.map(([x, y], i) => (
                <circle
                  key={`${s.key}-dot-${i}`}
                  cx={x}
                  cy={y}
                  r={hoveredIndex === i ? 4.5 : 2.5}
                  fill={s.color}
                  stroke="var(--surface)"
                  strokeWidth={hoveredIndex === i ? 2 : 1}
                  className="dashboard-chart-dot"
                />
              ));
            })}

            {/* 10px X-axis day labels (--muted) every 5 days: 1, 5, 10, 15, 20, 25, 30 */}
            {daysList.map((d) => {
              const isTick =
                d.dayNum === 1 ||
                d.dayNum === 5 ||
                d.dayNum === 10 ||
                d.dayNum === 15 ||
                d.dayNum === 20 ||
                d.dayNum === 25 ||
                d.dayNum === 30;
              if (!isTick) return null;
              const x = padLeft + ((d.dayNum - 1) / (totalDays - 1)) * plotW;
              return (
                <text
                  key={d.key}
                  x={x}
                  y={baseY + 18}
                  textAnchor="middle"
                  fontSize="10"
                  fill="var(--muted)"
                  className="dashboard-chart-axis-label"
                >
                  {d.shortDay}
                </text>
              );
            })}

            {/* Vertical guide line on hover */}
            {hoveredX != null && (
              <line
                x1={hoveredX}
                x2={hoveredX}
                y1={padTop}
                y2={baseY}
                stroke="var(--ew-border-strong)"
                strokeWidth="1.5"
                strokeDasharray="3 3"
                className="dashboard-chart-guide"
              />
            )}

            {/* Interactive columns for hover detection (only up to today's date) */}
            {passedDays.map((d, i) => {
              const x = padLeft + ((d.dayNum - 1) / (totalDays - 1)) * plotW;
              const colW = plotW / (totalDays - 1);
              return (
                <rect
                  key={`col-${i}`}
                  x={x - colW / 2}
                  y={padTop}
                  width={colW}
                  height={plotH}
                  fill="transparent"
                  className="dashboard-chart-hitbox"
                  onMouseEnter={() => setHoveredIndex(i)}
                  onTouchStart={() => setHoveredIndex(i)}
                />
              );
            })}
          </svg>

          {/* Hover / Keyboard Focus Tooltip Card */}
          {hoveredDay != null && hoveredX != null && (
            <div
              id={`dashboard-chart-tip-${title.toLowerCase().replace(/\s+/g, "-")}`}
              role="tooltip"
              className="dashboard-chart-tooltip"
              style={{
                left: `${Math.max(10, Math.min(90, (hoveredX / vbWidth) * 100))}%`,
                top: "10px",
                transform:
                  hoveredX / vbWidth > 0.65
                    ? "translateX(-100%)"
                    : hoveredX / vbWidth < 0.35
                      ? "translateX(0%)"
                      : "translateX(-50%)",
              }}
            >
              <div className="dashboard-chart-tooltip__date">
                {hoveredDay.fullDate}
              </div>
              <div className="dashboard-chart-tooltip__rows">
                {seriesConfig.map((s) => (
                  <div key={s.key} className="dashboard-chart-tooltip__row">
                    <span className="dashboard-chart-tooltip__series">
                      <span
                        className="dashboard-legend-dot"
                        style={{ backgroundColor: s.color }}
                        aria-hidden="true"
                      />
                      <span>{s.label}</span>
                    </span>
                    <strong className="dashboard-chart-tooltip__val">
                      {hoveredDay.counts[s.key] || 0}
                    </strong>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
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
  const dashboardBasePath = isAdmin ? "/admin" : "/lgu";

  const refreshOptions = {
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
  };

  const {
    stats,
    barangays: barangaysData,
    isLoading,
    loading: summaryLoading,
    error,
    refetch: refetchSummary,
  } = useDashboardSummary(isAdmin);
  const barangaysLoading = Boolean(summaryLoading?.barangays);
  const barangaysError = error;
  const {
    data: hazardReportsData,
    isLoading: hazardLoading,
    error: hazardError,
    refetch: refetchHazardReports,
  } = useHazardReports("all", refreshOptions);
  const {
    data: rescueRequestsData,
    isLoading: rescueLoading,
    error: rescueError,
    refetch: refetchRescueRequests,
  } = useRescueRequests(refreshOptions);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [barangayMetric, setBarangayMetric] = useState("households");
  const [barangaySearch, setBarangaySearch] = useState("");
  const [activeBarangayPopover, setActiveBarangayPopover] = useState(null);

  // Month Switcher State for Incident Trends (shared across Hazard Reports & Rescue Requests)
  const [trendYearMonth, setTrendYearMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const now = new Date();
  const currentTrendYear = now.getFullYear();
  const currentTrendMonth = now.getMonth();
  const isCurrentTrendMonth =
    trendYearMonth.year === currentTrendYear && trendYearMonth.month === currentTrendMonth;

  const trendMonthLabel = useMemo(() => {
    const monthPadded = String(trendYearMonth.month + 1).padStart(2, "0");
    return formatManilaDate(`${trendYearMonth.year}-${monthPadded}-01`, {
      month: "short",
      year: "numeric",
    });
  }, [trendYearMonth]);

  const handlePrevTrendMonth = useCallback(() => {
    setTrendYearMonth((prev) => {
      let m = prev.month - 1;
      let y = prev.year;
      if (m < 0) {
        m = 11;
        y -= 1;
      }
      return { year: y, month: m };
    });
  }, []);

  const handleNextTrendMonth = useCallback(() => {
    setTrendYearMonth((prev) => {
      const d = new Date();
      if (prev.year === d.getFullYear() && prev.month === d.getMonth()) {
        return prev;
      }
      let m = prev.month + 1;
      let y = prev.year;
      if (m > 11) {
        m = 0;
        y += 1;
      }
      return { year: y, month: m };
    });
  }, []);

  const getBarangayDemographics = useCallback((b) => {
    const demo = b?.demographics || null;
    return {
      households: demo?.households ?? Number(b.household_count ?? b.family_count ?? 0),
      residents: demo?.residents ?? Number(b.resident_count ?? b.population ?? 0),
      pwd: demo?.pwd ?? 0,
      pregnant: demo?.pregnant ?? 0,
      senior: demo?.senior ?? 0,
      soloParent: demo?.soloParent ?? 0,
      needsAssistance: demo?.needsAssistance ?? 0,
    };
  }, []);

  const handleOpenPopover = useCallback((barangay, element) => {
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const popoverWidth = 230;
    const popoverHeight = 220;

    let left = rect.left + rect.width / 2 - popoverWidth / 2;
    left = Math.max(12, Math.min(window.innerWidth - popoverWidth - 12, left));

    let top;
    if (rect.top > popoverHeight + 16) {
      top = rect.top - popoverHeight - 8;
    } else {
      top = rect.bottom + 8;
    }
    top = Math.max(8, Math.min(window.innerHeight - popoverHeight - 8, top));

    setActiveBarangayPopover({
      barangay,
      demographics: getBarangayDemographics(barangay),
      top,
      left,
    });
  }, [getBarangayDemographics]);

  useEffect(() => {
    if (!activeBarangayPopover) return;
    const handleClose = () => setActiveBarangayPopover(null);
    const handleKeyDown = (e) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("scroll", handleClose, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("scroll", handleClose, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeBarangayPopover]);

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
    if (!("Notification" in window)) {
      setPushStatus("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setPushStatus("denied");
      return;
    }
    let explicitlyDisabled = false;
    try {
      explicitlyDisabled = localStorage.getItem("evacway_push_enabled") === "false";
    } catch {
      // ignore storage errors
    }
    if (Notification.permission === "granted" && !explicitlyDisabled) {
      setPushStatus("active");
    }
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      if (Notification.permission !== "granted" || explicitlyDisabled) {
        setPushStatus("inactive");
      }
      return;
    }
    getOrRegisterServiceWorker().then((reg) => {
      if (!reg) {
        if (Notification.permission !== "granted" || explicitlyDisabled) {
          setPushStatus("inactive");
        }
        return;
      }
      reg.pushManager.getSubscription().then((sub) => {
        if (sub && !explicitlyDisabled) {
          setPushStatus("active");
        } else if (Notification.permission === "granted" && !explicitlyDisabled) {
          setPushStatus("active");
        } else {
          setPushStatus("inactive");
        }
      }).catch(() => {
        if (Notification.permission === "granted" && !explicitlyDisabled) {
          setPushStatus("active");
        } else {
          setPushStatus("inactive");
        }
      });
    }).catch(() => {
      if (Notification.permission === "granted" && !explicitlyDisabled) {
        setPushStatus("active");
      } else {
        setPushStatus("inactive");
      }
    });
  }, []);

  useEffect(() => {
    function handlePushStatusChanged(event) {
      const nextStatus = event?.detail?.status;
      if (nextStatus) {
        setPushStatus(nextStatus);
        if (nextStatus === "active") {
          setPushSuccess(false);
        }
      }
    }
    window.addEventListener("evacway:push-status-changed", handlePushStatusChanged);
    return () => window.removeEventListener("evacway:push-status-changed", handlePushStatusChanged);
  }, []);

  const handleActivatePushFromDashboard = useCallback(async () => {
    setPushActivating(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushStatus("denied");
        window.dispatchEvent(
          new CustomEvent("evacway:push-status-changed", {
            detail: { status: "denied", subscription: null },
          })
        );
        return;
      }

      try {
        localStorage.setItem("evacway_push_enabled", "true");
      } catch {
        // ignore storage errors
      }

      let sub = null;
      try {
        const reg = await getOrRegisterServiceWorker();
        if (reg && "pushManager" in reg) {
          sub = await reg.pushManager.getSubscription();
          if (!sub) {
            const config = await api.getVapidPublicKey();
            if (config?.enabled && config?.public_key) {
              sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: decodeVapidKey(config.public_key),
              });
            }
          }
          if (sub) {
            await api.savePushSubscription(sub.toJSON());
          }
        }
      } catch (swErr) {
        console.warn("Web Push subscription fallback to browser Notification API:", swErr);
      }

      setPushStatus("active");
      setPushSuccess(true);
      window.dispatchEvent(
        new CustomEvent("evacway:push-status-changed", {
          detail: { status: "active", subscription: sub },
        })
      );
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
    const params = new URLSearchParams({
      tab,
      notificationId: String(notification.id),
      resourceType: String(notification.resource_type || ""),
      resourceId: String(notification.resource_id ?? ""),
    });
    navigate(`${path}?${params.toString()}`);
  }

  const todayFormatted = useMemo(() => {
    return formatManilaDate(new Date(), {
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

  // Resident Headcount Arrival Metrics
  const arrivedResidents = Number(stats?.arrivedResidents || 0);
  const assignedResidents = Number(stats?.assignedResidents || 0);
  const pendingResidents = Number(stats?.pendingResidents || Math.max(0, assignedResidents - arrivedResidents));

  // Key Arrival Rate
  const familyArrivalRate = percentage(totalArrivedFamilies, assignedFamilies);

  // Incidents
  const rescueList = useMemo(() => {
    return Array.isArray(rescueRequestsData) ? rescueRequestsData : [];
  }, [rescueRequestsData]);

  const hazardList = useMemo(() => {
    return Array.isArray(hazardReportsData) ? hazardReportsData : [];
  }, [hazardReportsData]);

  const openRescueCount = useMemo(() => {
    if (typeof stats?.openRescues === "number") {
      return stats.openRescues;
    }
    return countOpenRescueRequests(rescueList);
  }, [stats?.openRescues, rescueList]);

  const pendingHazardCount = useMemo(() => {
    return hazardList.filter((h) => h.status === "pending").length;
  }, [hazardList]);

  // Operational metrics
  const totalCapacity = Number(stats?.totalCapacity || 0);
  const totalRemainingCapacity = Math.max(0, totalCapacity - (stats?.totalOccupiedPeople || 0));
  const remainingPercent = totalCapacity > 0 ? Math.round((totalRemainingCapacity / totalCapacity) * 100) : 0;

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
        const checkedInCount = Number(checkInData?.current_occupancy ?? checkInData?.checked_in ?? center.occupiedPeople ?? 0);
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


  const maxBarangayVal = useMemo(() => {
    if (!allBarangays.length) return 1;
    return Math.max(...allBarangays.map((b) => b.val || 0), 1);
  }, [allBarangays]);

  const visibleBarangays = useMemo(() => {
    const query = barangaySearch.trim().toLocaleLowerCase();
    return query
      ? allBarangays.filter((barangay) => String(barangay.name || "").toLocaleLowerCase().includes(query))
      : allBarangays;
  }, [allBarangays, barangaySearch]);

  const isArrivalLoading = Boolean(
    (isLoading && !stats) || summaryLoading?.families || summaryLoading?.checkIn
  );
  const isAlertsLoading = Boolean(
    (hazardLoading && hazardList.length === 0) || (rescueLoading && rescueList.length === 0)
  );
  const isCapacityLoading = Boolean(
    (isLoading && !stats) || summaryLoading?.centers
  );
  const isBarangaysCardLoading = Boolean(
    (barangaysLoading || summaryLoading?.barangays) && allBarangays.length === 0
  );

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
        <div className="dashboard-shell">
          {/* Push Notification Activation Prompt (Hides once activated) */}
          {(pushStatus === "inactive" || pushSuccess) && !pushStripDismissed && (
            <div className={`dashboard-push-banner ${pushSuccess ? "is-success" : ""}`}>
              <div className="dashboard-push-banner__copy">
                {pushSuccess ? (
                  <CheckCircle2 size={16} className="dashboard-push-banner__icon" aria-hidden="true" />
                ) : (
                  <Bell size={16} className="dashboard-push-banner__icon" aria-hidden="true" />
                )}
                <span>
                  {pushSuccess
                    ? "Push notifications activated! Real-time alerts are now enabled."
                    : "Push notifications are currently inactive on this device. Allow notifications to receive instant alerts for resident accounts and emergency rescues."}
                </span>
              </div>
              {!pushSuccess && (
                <div className="dashboard-push-banner__actions">
                  <Button
                    variant="primary"
                    onClick={handleActivatePushFromDashboard}
                    disabled={pushActivating}
                    className="dashboard-push-btn"
                  >
                    {pushActivating ? (
                      <>
                        <Loader2 size={14} className="dashboard-spin" aria-hidden="true" />
                        <span>Activating...</span>
                      </>
                    ) : (
                      <span>Allow &amp; Activate</span>
                    )}
                  </Button>
                  <button
                    type="button"
                    onClick={() => {
                      setPushStripDismissed(true);
                      try {
                        sessionStorage.setItem("evacway_push_strip_dismissed", "true");
                      } catch {
                        // ignore storage quota / privacy mode errors
                      }
                    }}
                    className="dashboard-push-dismiss"
                    aria-label="Dismiss notification prompt"
                    title="Dismiss"
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 1. PAGE HEADER (NO CARD WRAPPER) */}
          <header className="dashboard-header">
            <div className="dashboard-header-copy">
              <div className="dashboard-label-chip">
                <Clock size={12} aria-hidden="true" />
                <span>{todayFormatted}</span>
                <span className="dashboard-label-sep" aria-hidden="true">·</span>
                <span>Sogod Command Center</span>
              </div>
              <h1 className="dashboard-header-title">
                Welcome back, {user?.name || "Officer"}
              </h1>
            </div>

            <div className="dashboard-header-actions">
              <Button
                variant="secondary"
                onClick={handleRefreshAll}
                disabled={isRefreshing}
                aria-label="Sync data"
                title="Sync data"
                className="dashboard-sync-btn"
              >
                <RefreshCw
                  size={16}
                  className={isRefreshing ? "dashboard-spin" : ""}
                  aria-hidden="true"
                />
              </Button>

              <Button
                variant="secondary"
                onClick={() => handleSectionChange("checkin")}
                className="dashboard-action-btn"
              >
                <UserCheck size={16} aria-hidden="true" />
                <span>Evacuee Arrival Desk</span>
              </Button>

              <Button
                variant="primary"
                onClick={() => handleSectionChange("map")}
                className="dashboard-action-btn"
              >
                <MapPin size={16} aria-hidden="true" />
                <span>Map Operations</span>
              </Button>
            </div>
          </header>

          {/* ERROR ALERT (when stale data exists alongside a sync error) */}
          {error && !isLoading && stats && (
            <div className="dashboard-error-banner" role="alert">
              <div className="dashboard-error-banner__copy">
                <p className="dashboard-error-banner__title">
                  <AlertTriangle size={16} aria-hidden="true" />
                  <span>Failed to synchronize operational metrics</span>
                </p>
                <p className="dashboard-error-banner__msg">
                  {error?.message || String(error)}
                </p>
              </div>
              <Button variant="secondary" onClick={handleRefreshAll}>
                Retry Sync
              </Button>
            </div>
          )}

          {/* 2. EVACUEE & SHELTER ARRIVAL STATUS CARD */}
          <section
            className="dashboard-surface-card dashboard-arrival-card"
            aria-label="Evacuee and shelter arrival status"
          >
            <SectionHeader
              icon={UserCheck}
              title="Evacuee & shelter arrival status"
            />

            {isArrivalLoading ? (
              <div
                className="dashboard-arrival-skeleton"
                role="status"
                aria-busy="true"
                aria-label="Loading arrival status"
              >
                <span className="ds-skeleton dashboard-skel-line dashboard-skel-line--wide" aria-hidden="true" />
                <span className="ds-skeleton dashboard-skel-bar" aria-hidden="true" />
                <div className="dashboard-arrival-ends" aria-hidden="true">
                  <span className="ds-skeleton dashboard-skel-line dashboard-skel-line--sm" />
                  <span className="ds-skeleton dashboard-skel-line dashboard-skel-line--sm" />
                </div>
              </div>
            ) : error && !stats ? (
              <div className="dashboard-card-state" role="alert">
                <AlertTriangle size={18} className="dashboard-card-state__icon--danger" aria-hidden="true" />
                <p className="dashboard-card-state__text">
                  {error?.message || "Could not load arrival status."}
                </p>
                <Button variant="secondary" onClick={handleRefreshAll}>
                  Retry sync
                </Button>
              </div>
            ) : assignedFamilies === 0 ? (
              <div className="dashboard-card-state">
                <p className="dashboard-card-state__text">
                  No families are assigned to evacuation centers yet.
                </p>
              </div>
            ) : (
              <div className="dashboard-arrival-body">
                <p className="dashboard-arrival-summary">
                  <strong>{formatCount(totalArrivedFamilies)}</strong> of{" "}
                  <strong>{formatCount(assignedFamilies)}</strong> assigned families have verified safe arrival across evacuation centers
                </p>

                <div className="dashboard-arrival-progress">
                  <ProgressBar
                    value={totalArrivedFamilies}
                    max={assignedFamilies}
                    variant="completion"
                    size={8}
                    ariaLabel={`${familyArrivalRate}% of assigned families arrived`}
                  />
                  <div className="dashboard-arrival-ends">
                    <span>{formatCount(totalArrivedFamilies)} arrived</span>
                    <span>{formatCount(pendingArrivalFamilies)} pending</span>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* 3. EXECUTIVE KPI METRICS (4 Link StatCards) */}
          <section className="dashboard-kpi-grid" aria-label="Operational summary metrics">
            {error && !stats && !isLoading ? (
              <div className="dashboard-surface-card dashboard-kpi-error" role="alert">
                <div className="dashboard-card-state">
                  <AlertTriangle size={18} className="dashboard-card-state__icon--danger" aria-hidden="true" />
                  <p className="dashboard-card-state__text">
                    {error?.message || "Could not load summary metrics."}
                  </p>
                  <Button variant="secondary" onClick={handleRefreshAll}>
                    Retry sync
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {isAlertsLoading ? (
                  <DashboardStatSkeleton label="emergency alerts" />
                ) : (
                  <StatCard
                    to={`${dashboardBasePath}?tab=rescue`}
                    tint="danger"
                    icon={LifeBuoy}
                    label="Emergency alerts"
                    value={formatCount(openRescueCount + pendingHazardCount)}
                    footer={`${openRescueCount} rescues · ${pendingHazardCount} hazards${
                      openRescueCount > 0
                        ? " · Needs Rescue"
                        : pendingHazardCount > 0
                          ? " · Needs Review"
                          : " · All Clear"
                    }`}
                  />
                )}

                {isArrivalLoading ? (
                  <DashboardStatSkeleton label="pending arrivals" />
                ) : (
                  <StatCard
                    to={`${dashboardBasePath}?tab=checkin`}
                    tint="warn"
                    icon={Clock}
                    label="Pending arrival"
                    value={formatCount(pendingArrivalFamilies)}
                    footer={`${formatCount(pendingResidents)} residents${
                      pendingArrivalFamilies > 0 ? " · Awaiting Intake" : " · None Pending"
                    }`}
                  />
                )}

                {isArrivalLoading ? (
                  <DashboardStatSkeleton label="arrived families" />
                ) : (
                  <StatCard
                    to={`${dashboardBasePath}?tab=checkin`}
                    tint="success"
                    icon={UserCheck}
                    label="Families arrived"
                    value={formatCount(totalArrivedFamilies)}
                    footer={`${formatCount(arrivedResidents)} residents on-site · ${familyArrivalRate}% arrived`}
                  />
                )}

                {isCapacityLoading ? (
                  <DashboardStatSkeleton label="available headroom" />
                ) : (
                  <StatCard
                    to={`${dashboardBasePath}?tab=centers`}
                    tint="success"
                    icon={DoorOpen}
                    label="Available headroom"
                    value={formatCount(totalRemainingCapacity)}
                    footer={`of ${formatCount(totalCapacity)} capacity · ${remainingPercent}% free`}
                  />
                )}
              </>
            )}
          </section>

          {/* 4. CENTER ARRIVAL & CAPACITY MATRIX */}
          <CenterArrivalList
            centers={centersProcessed}
            basePath={dashboardBasePath}
            isLoading={isCapacityLoading}
            error={error && !stats ? error : null}
            onRetry={handleRefreshAll}
          />

          {/* 5. HAZARD REPORTS & RESCUE REQUESTS TRENDS (Side by Side) */}
          <div className="dashboard-trends-grid">
            <IncidentTrendsCard
              title="Hazard reports"
              icon={AlertTriangle}
              items={hazardList}
              isLoading={hazardLoading && hazardList.length === 0}
              error={hazardError && hazardList.length === 0 ? hazardError : null}
              onRetry={refetchHazardReports}
              dateExtractor={(item) => item?.submitted_at || item?.created_at}
              statusExtractor={getHazardStatusGroup}
              seriesConfig={[
                { key: "active", label: "Active", color: "var(--danger)" },
                { key: "pending", label: "Pending", color: "var(--warn)" },
                { key: "cleared", label: "Cleared", color: "var(--success)" },
              ]}
              selectedYear={trendYearMonth.year}
              selectedMonth={trendYearMonth.month}
              monthLabel={trendMonthLabel}
              isCurrentMonth={isCurrentTrendMonth}
              onPrevMonth={handlePrevTrendMonth}
              onNextMonth={handleNextTrendMonth}
              emptyTitle="No reports yet"
              ariaLabel="Hazard reports monthly trend line graph showing active, pending, and cleared reports"
            />

            <IncidentTrendsCard
              title="Rescue requests"
              icon={LifeBuoy}
              items={rescueList}
              isLoading={rescueLoading && rescueList.length === 0}
              error={rescueError && rescueList.length === 0 ? rescueError : null}
              onRetry={refetchRescueRequests}
              dateExtractor={(item) => item?.created_at || item?.submitted_at}
              statusExtractor={getRescueStatusGroup}
              seriesConfig={[
                { key: "open", label: "Open", color: "var(--danger)" },
                { key: "in_progress", label: "In Progress", color: "var(--primary)" },
                { key: "resolved", label: "Resolved", color: "var(--success)" },
              ]}
              selectedYear={trendYearMonth.year}
              selectedMonth={trendYearMonth.month}
              monthLabel={trendMonthLabel}
              isCurrentMonth={isCurrentTrendMonth}
              onPrevMonth={handlePrevTrendMonth}
              onNextMonth={handleNextTrendMonth}
              emptyTitle="No requests yet"
              ariaLabel="Rescue requests monthly trend line graph showing open, in progress, and resolved requests"
            />
          </div>

          {/* 6. DEMOGRAPHICS & EVACUEE DENSITY BY BARANGAY */}
          <section
            className="dashboard-surface-card dashboard-demographics-card"
            aria-label="Demographics and evacuee density by barangay"
          >
            <SectionHeader
              icon={MapPin}
              title="Demographics & evacuee density by barangay"
              actions={
                <div className="dashboard-demographics-controls">
                  <div className="dashboard-demographics-search">
                    <label htmlFor="dashboard-barangay-search" className="sr-only">
                      Search barangays
                    </label>
                    <Search size={15} className="dashboard-demographics-search__icon" aria-hidden="true" />
                    <input
                      id="dashboard-barangay-search"
                      type="search"
                      value={barangaySearch}
                      onChange={(event) => setBarangaySearch(event.target.value)}
                      placeholder="Search barangays..."
                      className="dashboard-demographics-search__input"
                    />
                  </div>

                  <SegmentedControl
                    size="sm"
                    ariaLabel="Demographics metric"
                    value={barangayMetric}
                    onChange={setBarangayMetric}
                    options={[
                      { value: "households", label: "Families" },
                      { value: "residents", label: "Residents" },
                    ]}
                  />
                </div>
              }
            />

            {isBarangaysCardLoading ? (
              <div
                className="dashboard-demographics-grid"
                role="status"
                aria-busy="true"
                aria-label="Loading barangay demographics"
              >
                {[0, 1, 2, 3, 4, 5].map((slot) => (
                  <div key={slot} className="dashboard-demographic-skeleton" aria-hidden="true">
                    <div className="dashboard-demographic-skeleton__top">
                      <span className="ds-skeleton dashboard-skel-line dashboard-skel-line--mid" />
                      <span className="ds-skeleton dashboard-skel-line dashboard-skel-line--xs" />
                    </div>
                    <span className="ds-skeleton dashboard-skel-bar dashboard-skel-bar--sm" />
                  </div>
                ))}
              </div>
            ) : (barangaysError || error) && allBarangays.length === 0 ? (
              <div className="dashboard-card-state" role="alert">
                <AlertTriangle
                  size={18}
                  className="dashboard-card-state__icon--danger"
                  aria-hidden="true"
                />
                <p className="dashboard-card-state__text">
                  {(barangaysError || error)?.message || "Could not load barangay demographics."}
                </p>
                <Button variant="secondary" onClick={handleRefreshAll}>
                  Retry sync
                </Button>
              </div>
            ) : visibleBarangays.length === 0 ? (
              <div className="dashboard-empty-card">
                <span className="dashboard-empty-card__icon" aria-hidden="true">
                  {barangaySearch.trim() ? <Search size={20} /> : <MapPin size={20} />}
                </span>
                <p className="dashboard-empty-card__title">
                  {barangaySearch.trim()
                    ? "No barangays match your search"
                    : "No barangay census records yet"}
                </p>
                {barangaySearch.trim() && (
                  <Button
                    variant="secondary"
                    onClick={() => setBarangaySearch("")}
                    className="dashboard-empty-card__btn"
                  >
                    Clear search
                  </Button>
                )}
              </div>
            ) : (
              <div className="dashboard-demographics-scroll">
                <div className="dashboard-demographics-grid">
                  {visibleBarangays.map((barangay) => {
                    const barWidth = Math.min(
                      100,
                      Math.max(0, Math.round((barangay.val / maxBarangayVal) * 100))
                    );
                    const unitLabel = barangayMetric === "residents" ? "residents" : "families";
                    const popoverId = `dashboard-brgy-tip-${barangay.id || barangay.rank}`;
                    const isPopoverOpen =
                      activeBarangayPopover?.barangay?.id === barangay.id &&
                      activeBarangayPopover?.barangay?.rank === barangay.rank;

                    return (
                      <button
                        key={barangay.id || barangay.rank}
                        type="button"
                        aria-label={`${barangay.name}, rank ${barangay.rank}: ${formatCount(barangay.val)} ${unitLabel}. Focus or click for demographic breakdown`}
                        aria-describedby={isPopoverOpen ? popoverId : undefined}
                        onMouseEnter={(e) => handleOpenPopover(barangay, e.currentTarget)}
                        onMouseLeave={() => setActiveBarangayPopover(null)}
                        onFocus={(e) => handleOpenPopover(barangay, e.currentTarget)}
                        onBlur={() => setActiveBarangayPopover(null)}
                        onClick={(e) => {
                          if (isPopoverOpen) {
                            setActiveBarangayPopover(null);
                          } else {
                            handleOpenPopover(barangay, e.currentTarget);
                          }
                        }}
                        className="dashboard-demographic-item"
                      >
                        <div className="dashboard-demographic-item__top">
                          <span className="dashboard-demographic-item__identity">
                            <span className="dashboard-rank-chip">#{barangay.rank}</span>
                            <span className="dashboard-demographic-name" title={barangay.name}>
                              {barangay.name}
                            </span>
                          </span>

                          <span className="dashboard-demographic-metric">
                            <strong>{formatCount(barangay.val)}</strong>{" "}
                            <span className="dashboard-demographic-unit">{unitLabel}</span>
                          </span>
                        </div>

                        <div className="dashboard-density-track" aria-hidden="true">
                          <div
                            className="dashboard-density-fill"
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Floating Demographics Breakdown Popover */}
            {activeBarangayPopover && (
              <div
                id={`dashboard-brgy-tip-${activeBarangayPopover.barangay.id || activeBarangayPopover.barangay.rank}`}
                role="tooltip"
                className="dashboard-demographics-popover"
                style={{
                  top: `${activeBarangayPopover.top}px`,
                  left: `${activeBarangayPopover.left}px`,
                }}
              >
                <div className="dashboard-popover-header">
                  <span className="dashboard-popover-title">
                    {activeBarangayPopover.barangay.name}
                  </span>
                  <span className="dashboard-popover-rank">
                    #{activeBarangayPopover.barangay.rank}
                  </span>
                </div>

                <div className="dashboard-popover-rows">
                  <div className="dashboard-popover-row">
                    <span>Total families</span>
                    <strong>{formatCount(activeBarangayPopover.demographics.households)}</strong>
                  </div>
                  <div className="dashboard-popover-row">
                    <span>Total residents</span>
                    <strong>{formatCount(activeBarangayPopover.demographics.residents)}</strong>
                  </div>
                  <div className="dashboard-popover-row">
                    <span>PWD</span>
                    <strong>{formatCount(activeBarangayPopover.demographics.pwd)}</strong>
                  </div>
                  <div className="dashboard-popover-row">
                    <span>Pregnant</span>
                    <strong>{formatCount(activeBarangayPopover.demographics.pregnant)}</strong>
                  </div>
                  <div className="dashboard-popover-row">
                    <span>Senior</span>
                    <strong>{formatCount(activeBarangayPopover.demographics.senior)}</strong>
                  </div>
                  <div className="dashboard-popover-row">
                    <span>Solo parent</span>
                    <strong>{formatCount(activeBarangayPopover.demographics.soloParent)}</strong>
                  </div>
                  <div className="dashboard-popover-row">
                    <span>Needs assistance</span>
                    <strong>{formatCount(activeBarangayPopover.demographics.needsAssistance)}</strong>
                  </div>
                </div>
              </div>
            )}

            {isAdmin && stats && (
              <div className="dashboard-staff-footer">
                <div className="dashboard-staff-status">
                  <span className="dashboard-staff-dot" aria-hidden="true" />
                  <span>
                    <strong>{formatCount(stats.activeStaff)} active</strong> of{" "}
                    {formatCount(stats.totalStaff)} total staff accounts
                  </span>
                </div>

                <Link to="/admin?tab=users" className="dashboard-section-link">
                  <span>Manage personnel accounts</span>
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

export default Dashboard;

import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChevronDown,
  faChevronUp,
  faCircle,
  faMapLocationDot,
  faTriangleExclamation,
  faRoad,
  faBuildingColumns,
  faDoorOpen,
} from "@fortawesome/free-solid-svg-icons";

const DEFAULT_ITEMS = [
  { id: "risk-high", label: "High-risk zone" },
  { id: "risk-medium", label: "Medium-risk zone" },
  { id: "risk-low", label: "Other risk zone" },
  { id: "report", label: "Hazard report" },
  { id: "blocked", label: "Road blocked" },
  { id: "closed", label: "Closed road" },
  { id: "center", label: "Evacuation center" },
  { id: "room", label: "Room" },
];

const LEGEND_ICONS = {
  report: faTriangleExclamation,
  blocked: faRoad,
  closed: faRoad,
  center: faBuildingColumns,
  room: faDoorOpen,
  "risk-high": faCircle,
  "risk-medium": faCircle,
  "risk-low": faCircle,
};

export function MapLegend({ items = DEFAULT_ITEMS, bottomOffset = 18 }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <aside
      className={`mo-legend ${expanded ? "is-expanded" : "is-collapsed"}`}
      style={{ bottom: bottomOffset }}
      aria-label="Map legend"
    >
      <button
        type="button"
        className="mo-legend-toggle"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-label={expanded ? "Collapse map legend" : "Expand map legend"}
      >
        <span>Map key</span>
        <FontAwesomeIcon icon={expanded ? faChevronDown : faChevronUp} />
      </button>

      {expanded && (
        <ul className="mo-legend-list">
          {items.map((item) => (
            <li key={item.id}>
              <span className={`mo-legend-symbol mo-${item.id}`}>
                <FontAwesomeIcon icon={LEGEND_ICONS[item.id] || faCircle} />
              </span>
              <span>{item.label}</span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

export function MapStats({ items = [] }) {
  return (
    <div className="mo-stats" aria-label="Map summary">
      {items.map((item) => (
        <div className={`mo-stat mo-${item.tone || "blue"}`} key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

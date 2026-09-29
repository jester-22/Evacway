import { icon } from "@fortawesome/fontawesome-svg-core";
import {
  faBan,
  faMagnifyingGlassPlus,
  faTriangleExclamation,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { BASE_URL } from "../services/api";

const VALIDATED_STATUS = "validated";

export function isValidatedReport(report) {
  return String(report?.status || "").toLowerCase() === VALIDATED_STATUS;
}

function isBlockedRoadReport(report) {
  const description = `${report?.report_type || ""} ${report?.hazard_type || ""}`;

  return (
    report?.blocks_road === true ||
    report?.road_segment_id != null ||
    report?.road_id != null ||
    (Array.isArray(report?.closed_roads) && report.closed_roads.length > 0) ||
    /block|closed|obstruct/i.test(description)
  );
}

function resolvePhotoUrl(path) {
  if (!path || typeof path !== "string") return "";
  if (/^(https?:|data:|blob:)/i.test(path)) return path;

  const baseUrl = BASE_URL.endsWith("/") ? BASE_URL : `${BASE_URL}/`;
  return new URL(path, baseUrl).toString();
}

export function createReportMarker(report) {
  const blocked = isBlockedRoadReport(report);
  const reportType = report?.report_type || report?.hazard_type || "Hazard report";
  const marker = document.createElement("button");
  marker.type = "button";
  marker.className = `map-report-marker ${blocked ? "is-blocked" : "is-hazard"}`;
  marker.setAttribute(
    "aria-label",
    `View ${blocked ? "blocked road" : "hazard"}: ${reportType}`
  );

  const symbol = document.createElement("span");
  symbol.className = "map-report-symbol";
  symbol.innerHTML = icon(
    blocked ? faBan : faTriangleExclamation
  ).html.join("");

  const label = document.createElement("span");
  label.className = "map-report-label";
  label.textContent = blocked ? "Road blocked" : reportType;

  marker.append(symbol, label);
  return marker;
}

export function createReportPopup(report) {
  const popup = document.createElement("article");
  popup.className = "map-report-popup";

  const heading = document.createElement("strong");
  heading.textContent = report?.report_type || report?.hazard_type || "Hazard report";
  popup.appendChild(heading);

  const status = document.createElement("span");
  status.className = `map-report-status status-${String(report?.status || "reported").toLowerCase()}`;
  status.textContent = isBlockedRoadReport(report)
    ? "Road blocked"
    : report?.status || "Reported";
  popup.appendChild(status);

    if (isBlockedRoadReport(report)) {
      const warning = document.createElement("strong");
      warning.className = "map-report-warning";
      warning.textContent = "Avoid this road";
      popup.appendChild(warning);
    }

    if (report?.risk_level) {
      const risk = document.createElement("div");
      risk.textContent = `Risk level: ${report.risk_level}`;
      risk.className = `map-report-risk risk-${String(report.risk_level).toLowerCase()}`;
      popup.appendChild(risk);
    }
  const type = report?.hazard_type;
  if (type && type !== report?.report_type) {
    const typeLine = document.createElement("div");
    typeLine.textContent = `Type: ${type}`;
    popup.appendChild(typeLine);
  }

  if (Array.isArray(report?.closed_roads) && report.closed_roads.length > 0) {
    const roads = document.createElement("div");
    roads.className = "map-report-roads";
    roads.textContent = `Affected roads: ${report.closed_roads.join(", ")}`;
    popup.appendChild(roads);
  } else if (report?.road_name) {
    const road = document.createElement("div");
    road.className = "map-report-roads";
    road.textContent = `Affected road: ${report.road_name}`;
    popup.appendChild(road);
  }

  if (report?.description) {
    const description = document.createElement("p");
    description.textContent = report.description;
    popup.appendChild(description);
  }

  const submittedAt = report?.submitted_at || report?.created_at;
  if (submittedAt) {
    const date = new Date(submittedAt);
    if (!Number.isNaN(date.getTime())) {
      const time = document.createElement("small");
      time.textContent = `Reported ${date.toLocaleString()}`;
      popup.appendChild(time);
    }
  }

  const photoPath =
    report?.photo_url ??
    report?.image_url ??
    report?.photo_path ??
    report?.image_path ??
    report?.photo ??
    report?.image;
  const photoUrl = resolvePhotoUrl(photoPath);

  if (photoUrl) {
    const photoButton = document.createElement("button");
    photoButton.type = "button";
    photoButton.className = "map-report-photo-button";
    photoButton.setAttribute("aria-label", "View report photo full screen");

    const photo = document.createElement("img");
    photo.className = "map-report-photo";
    photo.src = photoUrl;
    photo.alt = `${report?.report_type || "Hazard"} report photo`;
    photo.onerror = () => photoButton.remove();

    const zoomLabel = document.createElement("span");
    zoomLabel.className = "map-report-photo-zoom";
    zoomLabel.appendChild(document.createTextNode("View full photo "));
    const zoomIcon = document.createElement("span");
    zoomIcon.innerHTML = icon(faMagnifyingGlassPlus).html.join("");
    zoomLabel.appendChild(zoomIcon);
    photoButton.append(photo, zoomLabel);

    const openPhoto = () => {
      const overlay = document.createElement("div");
      overlay.className = "map-report-photo-overlay";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-label", "Full-size hazard report photo");

      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.className = "map-report-photo-close";
      closeButton.setAttribute("aria-label", "Close photo");
      closeButton.innerHTML = icon(faXmark).html.join("");

      const fullImage = document.createElement("img");
      fullImage.className = "map-report-photo-full";
      fullImage.src = photoUrl;
      fullImage.alt = photo.alt;

      const close = () => {
        overlay.remove();
        document.removeEventListener("keydown", handleKeyDown);
        photoButton.focus();
      };
      const handleKeyDown = (event) => {
        if (event.key === "Escape") close();
      };

      closeButton.addEventListener("click", close);
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) close();
      });
      fullImage.addEventListener("click", (event) => event.stopPropagation());
      document.addEventListener("keydown", handleKeyDown);
      overlay.append(closeButton, fullImage);
      document.body.appendChild(overlay);
      closeButton.focus();
    };

    photoButton.addEventListener("click", (event) => {
      event.stopPropagation();
      openPhoto();
    });
    popup.appendChild(photoButton);
  } else {
    const noPhoto = document.createElement("small");
    noPhoto.className = "map-report-no-photo";
    noPhoto.textContent = "No photo attached";
    popup.appendChild(noPhoto);
  }

  return popup;
}

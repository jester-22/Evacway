import { icon } from "@fortawesome/fontawesome-svg-core";
import {
  faBan,
  faChevronLeft,
  faChevronRight,
  faExpand,
  faImage,
  faTriangleExclamation,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { BASE_URL } from "../../services/api";

const VALIDATED_STATUS = "validated";

export function isValidatedReport(report) {
  return String(report?.status || "").toLowerCase() === VALIDATED_STATUS;
}

export function isBlockedRoadReport(report) {
  const description = `${report?.report_type || ""} ${report?.hazard_type || ""}`;

  return (
    report?.blocks_road === true ||
    report?.road_segment_id != null ||
    report?.road_id != null ||
    (Array.isArray(report?.closed_roads) && report.closed_roads.length > 0) ||
    /block|closed|obstruct/i.test(description)
  );
}

export function resolvePhotoUrl(path) {
  if (!path || typeof path !== "string") return "";
  if (/^(https?:|data:|blob:)/i.test(path)) return path;

  // Same-origin deployments use an empty (or relative) API base.
  const baseUrl = new URL(
    BASE_URL.endsWith("/") ? BASE_URL : `${BASE_URL}/`,
    window.location.origin
  );
  return new URL(path, baseUrl).toString();
}

export function extractPhotoUrls(report) {
  if (!report) return [];

  const arrayCandidates = [
    report.photos,
    report.photo_urls,
    report.images,
    report.image_urls,
    report.attachments,
  ];

  for (const candidate of arrayCandidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      const urls = candidate
        .map((item) => {
          if (!item) return "";
          if (typeof item === "string") return resolvePhotoUrl(item);
          return resolvePhotoUrl(
            item.url || item.path || item.photo_url || item.image_url || ""
          );
        })
        .filter(Boolean);
      if (urls.length > 0) return urls;
    }
  }

  const single =
    report.photo_url ??
    report.image_url ??
    report.photo_path ??
    report.image_path ??
    report.photo ??
    report.image;

  if (typeof single === "string" && single.trim()) {
    if (single.includes(",") && !single.startsWith("data:")) {
      return single
        .split(",")
        .map((s) => resolvePhotoUrl(s.trim()))
        .filter(Boolean);
    }
    const resolved = resolvePhotoUrl(single.trim());
    return resolved ? [resolved] : [];
  }

  return [];
}

export function createReportMarker(report) {
  const blocked = isBlockedRoadReport(report);
  const reportType =
    report?.report_type || report?.hazard_type || "Hazard report";
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

function getHazardTitle(report) {
  if (isBlockedRoadReport(report)) {
    return "Road blockage";
  }
  const raw =
    report?.report_type ||
    report?.hazard_type ||
    report?.title ||
    report?.name ||
    "Hazard report";
  const cleaned = String(raw).replace(/_/g, " ").trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function renderPhotoCarousel(photos, container) {
  if (!photos || photos.length === 0) {
    return null;
  }

  const carouselWrap = document.createElement("div");
  carouselWrap.className = "map-report-carousel-wrap";
  carouselWrap.setAttribute("role", "group");
  carouselWrap.setAttribute("aria-roledescription", "carousel");
  carouselWrap.setAttribute("aria-label", "Hazard report photos");
  carouselWrap.setAttribute("tabindex", "0");

  const stage = document.createElement("div");
  stage.className = "map-report-carousel-stage";

  const track = document.createElement("div");
  track.className = "map-report-carousel-track";
  stage.appendChild(track);

  photos.forEach((photoUrl, idx) => {
    const slide = document.createElement("div");
    slide.className = "map-report-carousel-slide";
    slide.setAttribute("role", "group");
    slide.setAttribute("aria-roledescription", "slide");
    slide.setAttribute("aria-label", `Photo ${idx + 1} of ${photos.length}`);

    const skeleton = document.createElement("div");
    skeleton.className = "map-report-img-skeleton";
    skeleton.setAttribute("aria-hidden", "true");
    slide.appendChild(skeleton);

    const fallback = document.createElement("div");
    fallback.className = "map-report-img-fallback";
    fallback.style.display = "none";
    fallback.innerHTML = `
      <span class="map-report-fallback-icon" aria-hidden="true">${icon(faImage).html.join("")}</span>
      <span>Photo could not be loaded</span>
    `;
    slide.appendChild(fallback);

    const img = document.createElement("img");
    img.className = "map-report-carousel-img";
    img.src = photoUrl;
    img.alt = `Hazard report photo ${idx + 1}`;
    img.loading = "lazy";

    img.onload = () => {
      skeleton.style.display = "none";
      img.style.opacity = "1";
    };

    img.onerror = () => {
      skeleton.style.display = "none";
      img.style.display = "none";
      fallback.style.display = "flex";
    };

    slide.appendChild(img);
    track.appendChild(slide);
  });

  let currentIndex = 0;
  let prevBtn = null;
  let nextBtn = null;
  let counter = null;
  const dotElements = [];

  function goToSlide(newIndex) {
    currentIndex = Math.max(0, Math.min(photos.length - 1, newIndex));
    track.style.transform = `translateX(-${currentIndex * 100}%)`;

    if (counter) {
      counter.textContent = `${currentIndex + 1} / ${photos.length}`;
    }

    if (prevBtn) {
      prevBtn.style.display = currentIndex === 0 ? "none" : "flex";
    }

    if (nextBtn) {
      nextBtn.style.display =
        currentIndex === photos.length - 1 ? "none" : "flex";
    }

    dotElements.forEach((dot, dotIdx) => {
      const isActive = dotIdx === currentIndex;
      dot.classList.toggle("is-active", isActive);
      dot.setAttribute("aria-selected", isActive ? "true" : "false");
    });
  }

  // Multiple photos controls
  if (photos.length > 1) {
    // Counter pill (top right)
    counter = document.createElement("div");
    counter.className = "map-report-carousel-counter";
    counter.setAttribute("aria-live", "polite");
    counter.textContent = `1 / ${photos.length}`;
    stage.appendChild(counter);

    // Prev Button
    prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "map-report-carousel-arrow is-prev";
    prevBtn.setAttribute("aria-label", "Previous photo");
    prevBtn.innerHTML = icon(faChevronLeft).html.join("");
    prevBtn.style.display = "none";
    prevBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      goToSlide(currentIndex - 1);
    });
    stage.appendChild(prevBtn);

    // Next Button
    nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "map-report-carousel-arrow is-next";
    nextBtn.setAttribute("aria-label", "Next photo");
    nextBtn.innerHTML = icon(faChevronRight).html.join("");
    nextBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      goToSlide(currentIndex + 1);
    });
    stage.appendChild(nextBtn);

    // Pagination dots (bottom center)
    const dotsWrap = document.createElement("div");
    dotsWrap.className = "map-report-carousel-dots";
    dotsWrap.setAttribute("role", "tablist");
    dotsWrap.setAttribute("aria-label", "Choose photo");

    photos.forEach((_, dotIdx) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = `map-report-carousel-dot ${dotIdx === 0 ? "is-active" : ""}`;
      dot.setAttribute("role", "tab");
      dot.setAttribute("aria-label", `Go to photo ${dotIdx + 1}`);
      dot.setAttribute("aria-selected", dotIdx === 0 ? "true" : "false");
      dot.addEventListener("click", (e) => {
        e.stopPropagation();
        goToSlide(dotIdx);
      });
      dotElements.push(dot);
      dotsWrap.appendChild(dot);
    });
    stage.appendChild(dotsWrap);

    // Keyboard navigation when carousel is focused
    carouselWrap.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (currentIndex > 0) goToSlide(currentIndex - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (currentIndex < photos.length - 1) goToSlide(currentIndex + 1);
      }
    });

    // Touch swipe navigation
    let touchStartX = 0;
    let touchStartY = 0;
    let isSwiping = false;

    stage.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length === 1) {
          touchStartX = e.touches[0].clientX;
          touchStartY = e.touches[0].clientY;
          isSwiping = true;
        }
      },
      { passive: true }
    );

    stage.addEventListener(
      "touchmove",
      (e) => {
        if (!isSwiping || e.touches.length !== 1) return;
        const diffX = e.touches[0].clientX - touchStartX;
        const diffY = e.touches[0].clientY - touchStartY;
        if (Math.abs(diffX) > Math.abs(diffY)) {
          e.preventDefault();
        }
      },
      { passive: false }
    );

    stage.addEventListener("touchend", (e) => {
      if (!isSwiping) return;
      isSwiping = false;
      const diffX = e.changedTouches[0].clientX - touchStartX;
      const threshold = 40;
      if (diffX > threshold && currentIndex > 0) {
        goToSlide(currentIndex - 1);
      } else if (diffX < -threshold && currentIndex < photos.length - 1) {
        goToSlide(currentIndex + 1);
      }
    });
  }

  carouselWrap.appendChild(stage);

  // "View full photo" button (below photo on mobile, absolute overlay on desktop)
  const viewFullBtn = document.createElement("button");
  viewFullBtn.type = "button";
  viewFullBtn.className = "map-report-view-full-btn";
  viewFullBtn.setAttribute("aria-label", "View full photo");
  viewFullBtn.innerHTML = `
    <span class="map-report-view-full-icon" aria-hidden="true">${icon(faExpand).html.join("")}</span>
    <span>View full photo</span>
  `;

  viewFullBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openFullViewer(currentIndex);
  });
  carouselWrap.appendChild(viewFullBtn);

  // Full Photo Viewer Modal
  function openFullViewer(startIndex) {
    let viewerIndex = startIndex;

    const overlay = document.createElement("div");
    overlay.className = "map-report-photo-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Full size hazard report photo");

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "map-report-photo-close";
    closeBtn.setAttribute("aria-label", "Close photo viewer");
    closeBtn.innerHTML = icon(faXmark).html.join("");

    let viewerCounter = null;
    if (photos.length > 1) {
      viewerCounter = document.createElement("div");
      viewerCounter.className = "map-report-viewer-counter";
      viewerCounter.setAttribute("aria-live", "polite");
      viewerCounter.textContent = `${viewerIndex + 1} / ${photos.length}`;
      overlay.appendChild(viewerCounter);
    }

    const imgWrap = document.createElement("div");
    imgWrap.className = "map-report-viewer-img-wrap";

    const fullImg = document.createElement("img");
    fullImg.className = "map-report-photo-full";
    fullImg.src = photos[viewerIndex];
    fullImg.alt = `Hazard report photo ${viewerIndex + 1}`;
    imgWrap.appendChild(fullImg);

    let vPrevBtn = null;
    let vNextBtn = null;

    function updateViewer(newIdx) {
      viewerIndex = Math.max(0, Math.min(photos.length - 1, newIdx));
      fullImg.src = photos[viewerIndex];
      fullImg.alt = `Hazard report photo ${viewerIndex + 1}`;
      if (viewerCounter) {
        viewerCounter.textContent = `${viewerIndex + 1} / ${photos.length}`;
      }
      if (vPrevBtn) {
        vPrevBtn.style.display = viewerIndex === 0 ? "none" : "flex";
      }
      if (vNextBtn) {
        vNextBtn.style.display =
          viewerIndex === photos.length - 1 ? "none" : "flex";
      }
      goToSlide(viewerIndex);
    }

    if (photos.length > 1) {
      vPrevBtn = document.createElement("button");
      vPrevBtn.type = "button";
      vPrevBtn.className = "map-report-viewer-arrow is-prev";
      vPrevBtn.setAttribute("aria-label", "Previous photo");
      vPrevBtn.innerHTML = icon(faChevronLeft).html.join("");
      vPrevBtn.style.display = viewerIndex === 0 ? "none" : "flex";
      vPrevBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        updateViewer(viewerIndex - 1);
      });
      overlay.appendChild(vPrevBtn);

      vNextBtn = document.createElement("button");
      vNextBtn.type = "button";
      vNextBtn.className = "map-report-viewer-arrow is-next";
      vNextBtn.setAttribute("aria-label", "Next photo");
      vNextBtn.innerHTML = icon(faChevronRight).html.join("");
      vNextBtn.style.display =
        viewerIndex === photos.length - 1 ? "none" : "flex";
      vNextBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        updateViewer(viewerIndex + 1);
      });
      overlay.appendChild(vNextBtn);
    }

    const closeViewer = () => {
      overlay.remove();
      document.removeEventListener("keydown", handleViewerKeyDown);
      viewFullBtn.focus();
    };

    const handleViewerKeyDown = (e) => {
      if (e.key === "Escape") {
        closeViewer();
      } else if (e.key === "ArrowLeft" && photos.length > 1) {
        if (viewerIndex > 0) updateViewer(viewerIndex - 1);
      } else if (e.key === "ArrowRight" && photos.length > 1) {
        if (viewerIndex < photos.length - 1) updateViewer(viewerIndex + 1);
      }
    };

    let vTouchStartX = 0;
    overlay.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length === 1) vTouchStartX = e.touches[0].clientX;
      },
      { passive: true }
    );

    overlay.addEventListener("touchend", (e) => {
      const diff = e.changedTouches[0].clientX - vTouchStartX;
      if (photos.length > 1) {
        if (diff > 40 && viewerIndex > 0) updateViewer(viewerIndex - 1);
        else if (diff < -40 && viewerIndex < photos.length - 1)
          updateViewer(viewerIndex + 1);
      }
    });

    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeViewer();
    });

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay || e.target === imgWrap) closeViewer();
    });

    document.addEventListener("keydown", handleViewerKeyDown);
    overlay.append(closeBtn, imgWrap);
    document.body.appendChild(overlay);
    closeBtn.focus();
  }

  container.appendChild(carouselWrap);
  return carouselWrap;
}

export function createReportPopup(report, options = {}) {
  const popup = document.createElement("article");
  popup.className = "map-report-popup";

  // Mobile bottom-sheet handle
  const sheetHandle = document.createElement("div");
  sheetHandle.className = "map-report-sheet-handle";
  sheetHandle.setAttribute("aria-hidden", "true");
  popup.appendChild(sheetHandle);

  // Header (Fixed)
  const header = document.createElement("div");
  header.className = "map-report-header";

  const headerText = document.createElement("div");
  headerText.className = "map-report-header-text";

  const title = document.createElement("h3");
  title.className = "map-report-title";
  title.textContent = getHazardTitle(report);
  headerText.appendChild(title);

  // Status pill with colored dot
  const statusRow = document.createElement("div");
  statusRow.className = "map-report-status-row";

  const isBlocked = isBlockedRoadReport(report);
  const rawStatus = String(report?.status || "").toLowerCase();
  const isPendingReview = rawStatus === "pending";
  let statusText = "Reported";
  let statusKey = "reported";

  if (isPendingReview) {
    statusText = "Needs review";
    statusKey = "pending";
  } else if (isBlocked) {
    statusText = "Road Blocked";
    statusKey = "blocked";
  } else if (report?.status) {
    statusKey = rawStatus;
    statusText = report.status.charAt(0).toUpperCase() + report.status.slice(1);
  } else if (report?.risk_level) {
    const r = String(report.risk_level).toLowerCase();
    statusKey = r;
    statusText = `${report.risk_level.charAt(0).toUpperCase() + report.risk_level.slice(1)} Risk`;
  }

  const statusPill = document.createElement("span");
  statusPill.className = `map-report-status-pill status-${statusKey}`;

  const statusDot = document.createElement("span");
  statusDot.className = "map-report-status-dot";
  statusDot.setAttribute("aria-hidden", "true");

  statusPill.append(statusDot, document.createTextNode(statusText));
  statusRow.appendChild(statusPill);

  if (report?.risk_level && !isBlocked && String(report?.status).toLowerCase() !== String(report?.risk_level).toLowerCase()) {
    const riskBadge = document.createElement("span");
    riskBadge.className = `map-report-risk-badge risk-${String(report.risk_level).toLowerCase()}`;
    riskBadge.textContent = `Risk: ${report.risk_level}`;
    statusRow.appendChild(riskBadge);
  }

  headerText.appendChild(statusRow);
  header.appendChild(headerText);

  // 36px light gray close button with thin outlined X
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "map-report-close-btn";
  closeBtn.setAttribute("aria-label", "Close hazard details");
  closeBtn.setAttribute("title", "Close");
  closeBtn.innerHTML = icon(faXmark).html.join("");

  closeBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof options.onClose === "function") {
      options.onClose();
    } else if (options.popup && typeof options.popup.remove === "function") {
      options.popup.remove();
    } else {
      const mapboxPopup = popup.closest(".mapboxgl-popup");
      if (mapboxPopup) {
        const defaultClose = mapboxPopup.querySelector(".mapboxgl-popup-close-button");
        if (defaultClose) defaultClose.click();
        else mapboxPopup.remove();
      }
    }
  });

  header.appendChild(closeBtn);
  popup.appendChild(header);

  // Scrollable body container (fixed header remains above)
  const body = document.createElement("div");
  body.className = "map-report-body";

  // Content Section: Alert Banner (Avoid this road) — only for validated blockages
  if (isBlocked && !isPendingReview) {
    const alertBanner = document.createElement("div");
    alertBanner.className = "map-report-alert-banner";

    const alertIcon = document.createElement("span");
    alertIcon.className = "map-report-alert-icon";
    alertIcon.setAttribute("aria-hidden", "true");
    alertIcon.innerHTML = icon(faTriangleExclamation).html.join("");

    const alertText = document.createElement("span");
    alertText.className = "map-report-alert-text";
    alertText.textContent = "Avoid this road";

    alertBanner.append(alertIcon, alertText);
    body.appendChild(alertBanner);
  }

  // Affected Roads (wrapping row of small pills)
  let roadNames = [];
  if (Array.isArray(report?.closed_roads) && report.closed_roads.length > 0) {
    roadNames = report.closed_roads;
  } else if (report?.road_name) {
    roadNames = [report.road_name];
  } else if (Array.isArray(report?.road_names) && report.road_names.length > 0) {
    roadNames = report.road_names;
  }

  if (roadNames.length > 0) {
    const roadsSection = document.createElement("div");
    roadsSection.className = "map-report-roads-section";

    const roadsLabel = document.createElement("span");
    roadsLabel.className = "map-report-section-label";
    roadsLabel.textContent = "AFFECTED ROADS";
    roadsSection.appendChild(roadsLabel);

    const pillsWrap = document.createElement("div");
    pillsWrap.className = "map-report-roads-pills";
    roadNames.forEach((name) => {
      const pill = document.createElement("span");
      pill.className = "map-report-road-pill";
      pill.textContent = name;
      pillsWrap.appendChild(pill);
    });
    roadsSection.appendChild(pillsWrap);
    body.appendChild(roadsSection);
  }

  // Description with clamp (2 lines on mobile) and "Read more" toggle
  const descriptionText =
    report?.description ||
    report?.details ||
    "";
  if (descriptionText) {
    const descWrap = document.createElement("div");
    descWrap.className = "map-report-desc-wrap";

    const descElem = document.createElement("p");
    descElem.className = "map-report-desc is-clamped";
    descElem.textContent = descriptionText;
    descWrap.appendChild(descElem);

    if (descriptionText.length > 60) {
      let isExpanded = false;
      const readMoreBtn = document.createElement("button");
      readMoreBtn.type = "button";
      readMoreBtn.className = "map-report-read-more-btn";
      readMoreBtn.textContent = "Read more";
      readMoreBtn.setAttribute("aria-expanded", "false");

      readMoreBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        isExpanded = !isExpanded;
        descElem.classList.toggle("is-clamped", !isExpanded);
        readMoreBtn.textContent = isExpanded ? "Show less" : "Read more";
        readMoreBtn.setAttribute("aria-expanded", isExpanded ? "true" : "false");
      });

      descWrap.appendChild(readMoreBtn);
    }

    body.appendChild(descWrap);
  }

  // Photo Carousel (appended to scrollable body)
  const photos = extractPhotoUrls(report);
  renderPhotoCarousel(photos, body);

  // Time reported (small muted text under the photo)
  const submittedAt =
    report?.submitted_at || report?.created_at || report?.validated_at;
  if (submittedAt) {
    const date = new Date(submittedAt);
    if (!Number.isNaN(date.getTime())) {
      const timeElem = document.createElement("div");
      timeElem.className = "map-report-time";
      timeElem.textContent = `Reported ${date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })} at ${date.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })}`;
      body.appendChild(timeElem);
    }
  }

  // Staff action row at the bottom (verify, resolve, edit, delete)
  if (options.isStaff) {
    const actionRow = document.createElement("div");
    actionRow.className = "map-report-staff-actions";

    const isBlocked = isBlockedRoadReport(report);
    const statusVal = String(report.status || "").toLowerCase();
    const isResolved = statusVal === "resolved";
    const isValidated = statusVal === "validated";

    // Verify / Validate button
    if (!isValidated && !isResolved && typeof options.onVerify === "function") {
      const verifyBtn = document.createElement("button");
      verifyBtn.type = "button";
      verifyBtn.className = "map-report-btn-secondary";
      verifyBtn.textContent = "Verify";
      verifyBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        verifyBtn.disabled = true;
        try {
          await options.onVerify(report);
          statusPill.className = "map-report-status-pill status-validated";
          statusPill.innerHTML = "";
          const newDot = document.createElement("span");
          newDot.className = "map-report-status-dot";
          statusPill.append(newDot, document.createTextNode("Validated"));
          verifyBtn.remove();
        } catch (err) {
          verifyBtn.disabled = false;
        }
      });
      actionRow.appendChild(verifyBtn);
    }

    // Resolve / Reopen road button
    if (!isResolved && typeof options.onResolve === "function") {
      const resolveBtn = document.createElement("button");
      resolveBtn.type = "button";
      resolveBtn.className = "map-report-btn-secondary";
      resolveBtn.textContent = isBlocked ? "Reopen road" : "Resolve";
      resolveBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        resolveBtn.disabled = true;
        try {
          await options.onResolve(report);
          statusPill.className = "map-report-status-pill status-resolved";
          statusPill.innerHTML = "";
          const newDot = document.createElement("span");
          newDot.className = "map-report-status-dot";
          statusPill.append(newDot, document.createTextNode("Resolved"));
          resolveBtn.remove();
        } catch (err) {
          resolveBtn.disabled = false;
        }
      });
      actionRow.appendChild(resolveBtn);
    }

    // Go back button (opens report details in Hazard Reports)
    if (typeof options.onEdit === "function") {
      const goBackBtn = document.createElement("button");
      goBackBtn.type = "button";
      goBackBtn.className = "map-report-btn-ghost";
      goBackBtn.textContent = "Go back";
      goBackBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        options.onEdit(report);
      });
      actionRow.appendChild(goBackBtn);
    }

    // Delete button (admin-only ghost danger button)
    if (options.isAdmin && typeof options.onDelete === "function") {
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "map-report-btn-ghost map-report-btn-danger";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await options.onDelete(report);
      });
      actionRow.appendChild(deleteBtn);
    }

    if (actionRow.children.length > 0) {
      body.appendChild(actionRow);
    }
  }

  popup.appendChild(body);

  return popup;
}

const RESCUE_STATUS_META = {
  pending: { label: "Pending", cls: "status-danger", next: "acknowledged", nextLabel: "Acknowledge" },
  open: { label: "Pending", cls: "status-danger", next: "acknowledged", nextLabel: "Acknowledge" },
  acknowledged: { label: "Acknowledged", cls: "status-pending", next: "responding", nextLabel: "Start responding" },
  responding: { label: "Responding", cls: "status-responding", next: "resolved", nextLabel: "Mark resolved" },
  resolved: { label: "Resolved", cls: "status-resolved", next: null, nextLabel: null },
};

export function createRescuePopup(rescue, options = {}) {
  const popup = document.createElement("div");
  popup.className = "map-report-popup map-rescue-popup";

  // Header
  const header = document.createElement("div");
  header.className = "map-report-header";

  const headerText = document.createElement("div");
  headerText.className = "map-report-header-text";

  const title = document.createElement("h3");
  title.className = "map-report-title";
  title.textContent = rescue?.requester_name || "Rescue request";
  headerText.appendChild(title);

  const statusRow = document.createElement("div");
  statusRow.className = "map-report-status-row";

  let currentStatus = String(rescue?.status || "pending").toLowerCase();
  const initialMeta = RESCUE_STATUS_META[currentStatus] || RESCUE_STATUS_META.pending;

  const statusPill = document.createElement("span");
  statusPill.className = `map-report-status-pill ${initialMeta.cls}`;

  const statusDot = document.createElement("span");
  statusDot.className = "map-report-status-dot";
  statusDot.setAttribute("aria-hidden", "true");

  statusPill.append(statusDot, document.createTextNode(initialMeta.label));
  statusRow.appendChild(statusPill);

  if (rescue?.location_source) {
    const locBadge = document.createElement("span");
    locBadge.className = "map-rescue-loc-badge";
    const srcLabel = rescue.location_source === "manual" ? "Manual pin" : "GPS";
    const acc = Number(rescue.accuracy);
    locBadge.textContent =
      rescue.location_source !== "manual" && Number.isFinite(acc) && acc > 0
        ? `${srcLabel} ±${Math.round(acc)}m`
        : srcLabel;
    statusRow.appendChild(locBadge);
  }

  headerText.appendChild(statusRow);
  header.appendChild(headerText);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "map-report-close-btn";
  closeBtn.setAttribute("aria-label", "Close rescue details");
  closeBtn.setAttribute("title", "Close");
  closeBtn.innerHTML = icon(faXmark).html.join("");
  closeBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof options.onClose === "function") {
      options.onClose();
    } else if (options.popup && typeof options.popup.remove === "function") {
      options.popup.remove();
    }
  });
  header.appendChild(closeBtn);
  popup.appendChild(header);

  // Body
  const body = document.createElement("div");
  body.className = "map-report-body";

  // Contact & Location details
  const hasContact = Boolean(rescue?.requester_contact && String(rescue.requester_contact).trim());
  const hasLocationDesc = Boolean(rescue?.location_description && String(rescue.location_description).trim());

  if (hasContact || hasLocationDesc) {
    const metaCard = document.createElement("div");
    metaCard.className = "map-rescue-meta-card";

    if (hasContact) {
      const row = document.createElement("div");
      row.className = "map-rescue-meta-row";
      const lbl = document.createElement("span");
      lbl.className = "map-rescue-meta-label";
      lbl.textContent = "Contact";
      const link = document.createElement("a");
      link.className = "map-rescue-meta-link";
      link.href = `tel:${String(rescue.requester_contact).replace(/[^+\d]/g, "")}`;
      link.textContent = String(rescue.requester_contact).trim();
      row.append(lbl, link);
      metaCard.appendChild(row);
    }

    if (hasLocationDesc) {
      const row = document.createElement("div");
      row.className = "map-rescue-meta-row";
      const lbl = document.createElement("span");
      lbl.className = "map-rescue-meta-label";
      lbl.textContent = "Location";
      const val = document.createElement("span");
      val.className = "map-rescue-meta-val";
      val.textContent = String(rescue.location_description).trim();
      row.append(lbl, val);
      metaCard.appendChild(row);
    }

    body.appendChild(metaCard);
  }

  // Emergency description
  if (rescue?.description && String(rescue.description).trim()) {
    const descWrap = document.createElement("div");
    descWrap.className = "map-report-desc-wrap";
    const desc = document.createElement("p");
    desc.className = "map-report-desc";
    desc.textContent = String(rescue.description).trim();
    descWrap.appendChild(desc);
    body.appendChild(descWrap);
  }

  // Proof photos
  const photos = extractPhotoUrls({ photos: rescue?.proof_images });
  renderPhotoCarousel(photos, body);

  // Requested timestamp
  if (rescue?.created_at) {
    const date = new Date(rescue.created_at);
    if (!Number.isNaN(date.getTime())) {
      const timeElem = document.createElement("div");
      timeElem.className = "map-report-time";
      timeElem.textContent = `Requested ${date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })} at ${date.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })}`;
      body.appendChild(timeElem);
    }
  }

  // Staff actions
  const actionRow = document.createElement("div");
  actionRow.className = "map-report-staff-actions";

  if (initialMeta.next && typeof options.onAdvanceStatus === "function") {
    const advanceBtn = document.createElement("button");
    advanceBtn.type = "button";
    advanceBtn.className = "map-report-btn-primary";
    advanceBtn.textContent = initialMeta.nextLabel;

    advanceBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const meta = RESCUE_STATUS_META[currentStatus];
      if (!meta?.next) return;
      advanceBtn.disabled = true;
      try {
        await options.onAdvanceStatus(rescue, meta.next);
        currentStatus = meta.next;
        const nextMeta = RESCUE_STATUS_META[currentStatus] || RESCUE_STATUS_META.resolved;
        statusPill.className = `map-report-status-pill ${nextMeta.cls}`;
        statusPill.innerHTML = "";
        const dot = document.createElement("span");
        dot.className = "map-report-status-dot";
        dot.setAttribute("aria-hidden", "true");
        statusPill.append(dot, document.createTextNode(nextMeta.label));

        if (nextMeta.next) {
          advanceBtn.textContent = nextMeta.nextLabel;
          advanceBtn.disabled = false;
        } else {
          advanceBtn.remove();
          if (typeof options.onClose === "function") {
            options.onClose();
          }
        }
      } catch {
        advanceBtn.disabled = false;
      }
    });
    actionRow.appendChild(advanceBtn);
  }

  if (typeof options.onOpenInRescueAlerts === "function") {
    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "map-report-btn-secondary";
    openBtn.textContent = "Go back";
    openBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      options.onOpenInRescueAlerts(rescue);
    });
    actionRow.appendChild(openBtn);
  }

  if (actionRow.children.length > 0) {
    body.appendChild(actionRow);
  }

  popup.appendChild(body);
  return popup;
}

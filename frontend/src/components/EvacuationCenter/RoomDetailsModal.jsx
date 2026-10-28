import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faXmark,
  faBuildingColumns,
  faUsers,
  faPhone,
  faSpinner,
  faArrowUpRightFromSquare,
  faDoorOpen,
  faChevronDown,
} from "@fortawesome/free-solid-svg-icons";
import { useRoomFamilies } from "../../hooks/useEvacuationQueries";
import "./RoomDetailsModal.css";

export default function RoomDetailsModal({
  isOpen,
  room,
  centers,
  canManageRooms = false,
  basePath = "/admin",
  onClose,
}) {
  const navigate = useNavigate();
  const modalRef = useRef(null);
  const closeBtnRef = useRef(null);
  const lastActiveElementRef = useRef(null);
  const [expandedFamilyIds, setExpandedFamilyIds] = useState({});

  const toggleFamilyExpand = (famKey) => {
    setExpandedFamilyIds((prev) => ({
      ...prev,
      [famKey]: !prev[famKey],
    }));
  };

  // Focus management: move focus into modal on open, restore on close
  useEffect(() => {
    if (isOpen) {
      lastActiveElementRef.current = document.activeElement;
      requestAnimationFrame(() => {
        if (closeBtnRef.current) {
          closeBtnRef.current.focus();
        } else if (modalRef.current) {
          modalRef.current.focus();
        }
      });
    } else if (lastActiveElementRef.current) {
      try {
        lastActiveElementRef.current.focus();
      } catch (e) {}
      lastActiveElementRef.current = null;
    }
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose?.();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Resolve evacuation center from room's evacuation_center_id
  const center = useMemo(() => {
    if (!room?.evacuation_center_id || !centers?.features) return null;
    return (
      centers.features.find((c) => {
        const id = c.properties?.id ?? c.id;
        return String(id) === String(room.evacuation_center_id);
      }) || null
    );
  }, [room, centers]);

  const centerId = room?.evacuation_center_id || center?.properties?.id || center?.id;
  const centerName = center?.properties?.name || "Evacuation Center";

  // Query assigned families for the room
  const roomFamiliesQuery = useRoomFamilies(isOpen && room?.id ? room.id : null);
  const roomFamiliesData = roomFamiliesQuery.data || null;
  const loadingRoomFamilies = roomFamiliesQuery.isLoading;
  const roomFamiliesError = roomFamiliesQuery.isError;

  if (!isOpen || !room) return null;

  const roomTitle = room.room_number
    ? String(room.room_number).trim().toLowerCase().startsWith("room")
      ? room.room_number
      : `Room ${room.room_number}`
    : "Unnamed Room";

  const isClosed = room.is_active === false;
  const capacity = Number(room.capacity || 0);
  const occupied = Number(
    roomFamiliesData?.occupied ?? room.occupied ?? 0
  );
  const assigned = Number(
    roomFamiliesData?.assigned ?? room.assigned ?? 0
  );
  const isFull = capacity > 0 && occupied >= capacity;
  const isFullyAssigned = capacity > 0 && assigned >= capacity;

  const statusBadge = isClosed
    ? { label: "Closed", cls: "is-closed" }
    : isFull
    ? { label: "Full", cls: "is-full" }
    : { label: "Available", cls: "is-available" };

  const occPercent =
    capacity > 0 ? Math.min(100, Math.round((occupied / capacity) * 100)) : 0;
  const assignedPercent =
    capacity > 0 ? Math.min(100, Math.round((assigned / capacity) * 100)) : 0;
  const occColor =
    isFull ? "#dc2626" : occPercent >= 70 ? "#d97706" : "#16a34a";
  const statusText =
    isFull ? "Full" : occPercent >= 70 ? "Near Capacity" : "Available";
  const spacesLeftText =
    capacity > occupied ? `${capacity - occupied} spaces left` : "No space left";

  const families = Array.isArray(roomFamiliesData?.families)
    ? roomFamiliesData.families
    : [];

  const sortedFamilies = [...families].sort((a, b) => {
    const nameA = String(a.head_name || a.household_head_name || "").trim();
    const nameB = String(b.head_name || b.household_head_name || "").trim();
    return nameA.localeCompare(nameB, undefined, { sensitivity: "base" });
  });

  return (
    <div
      className="admin-room-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose?.();
        }
      }}
      aria-hidden={!isOpen}
    >
      <div
        ref={modalRef}
        className="admin-room-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-room-modal-title"
        tabIndex={-1}
      >
        {/* Mobile handle indicator */}
        <div className="admin-room-modal-handle-bar" aria-hidden="true" />

        {/* Fixed Header */}
        <div className="admin-room-modal-header">
          <div className="admin-room-modal-title-row">
            <div className="admin-room-modal-title-left">
              <h2 id="admin-room-modal-title" className="admin-room-modal-title">
                {roomTitle}
              </h2>
              <span className={`admin-map-status-badge ${statusBadge.cls}`}>
                {statusBadge.label}
              </span>
              {isFullyAssigned && (
                <span
                  className="admin-map-status-badge"
                  style={{
                    backgroundColor: "#f1f5f9",
                    color: "#475569",
                    border: "1px solid #cbd5e1",
                  }}
                >
                  Fully assigned
                </span>
              )}
            </div>
            <button
              ref={closeBtnRef}
              type="button"
              className="admin-room-modal-close-btn"
              onClick={onClose}
              aria-label="Close room details modal"
              title="Close (Esc)"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>

          <div className="admin-room-modal-center-name">
            <FontAwesomeIcon icon={faBuildingColumns} />
            <span>{centerName}</span>
          </div>
        </div>

        {/* Fixed Occupancy Section */}
        <div className="admin-room-modal-occ-section">
          <div className="admin-map-detail-occ-header">
            <span className="admin-map-detail-label">Occupancy</span>
            <span className="admin-map-detail-occ-count">
              {occupied} of {capacity} here · {assigned} assigned
            </span>
          </div>
          <div
            className="admin-map-slim-progress-track"
            aria-hidden="true"
            style={{ position: "relative" }}
          >
            {assignedPercent > 0 && (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  height: "100%",
                  width: `${assignedPercent}%`,
                  backgroundColor: "#94a3b8",
                  opacity: 0.45,
                  borderRadius: "999px",
                }}
              />
            )}
            <div
              className="admin-map-slim-progress-fill"
              style={{
                position: "relative",
                zIndex: 2,
                width: `${occPercent}%`,
                backgroundColor: occColor,
              }}
            />
          </div>
          <div className="admin-map-detail-occ-sub">
            <span style={{ color: occColor, fontWeight: 600 }}>
              {occPercent}% ({statusText})
            </span>
            <span className="admin-map-detail-muted-text">
              {spacesLeftText}
            </span>
          </div>
        </div>

        {/* Scrollable Families Section */}
        <div className="admin-room-modal-families-wrap">
          <div
            className="admin-map-families-header"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px",
            }}
          >
            <span className="admin-map-detail-label" style={{ textTransform: "none" }}>
              Assigned families ({sortedFamilies.length})
            </span>
            <span className="admin-map-detail-muted-text" style={{ fontSize: "12px", fontWeight: 600 }}>
              {assigned} {assigned === 1 ? "member" : "members"} assigned
            </span>
          </div>

          <div
            className="admin-room-modal-families-list"
            role="list"
            aria-label="Assigned families in this room"
          >
            {loadingRoomFamilies ? (
              <div className="admin-map-families-loading" role="status">
                <FontAwesomeIcon
                  icon={faSpinner}
                  spin
                  className="admin-map-spinner-icon"
                />
                <span>Loading assigned families...</span>
              </div>
            ) : roomFamiliesError ? (
              <div className="admin-map-families-error" role="alert">
                <span>Failed to load assigned families.</span>
                <button
                  type="button"
                  className="admin-map-retry-btn"
                  onClick={() => roomFamiliesQuery.refetch()}
                >
                  Retry
                </button>
              </div>
            ) : sortedFamilies.length === 0 ? (
              <div className="admin-map-families-empty">
                <span>No families assigned yet</span>
              </div>
            ) : (
              sortedFamilies.map((fam, idx) => {
                const famKey = fam.family_id || fam.id || `fam-${idx}`;
                const isExpanded = Boolean(expandedFamilyIds[famKey]);
                const famMembers = Array.isArray(fam.members) ? fam.members : [];
                const headName =
                  fam.head_name ||
                  fam.household_head_name ||
                  "Unknown Household Head";
                const memberCount =
                  famMembers.length ||
                  fam.family_members ||
                  fam.assigned_members ||
                  fam.total_members ||
                  1;
                const contact = canManageRooms ? fam.contact_number : null;
                const specialNeeds = Array.isArray(fam.special_needs)
                  ? fam.special_needs
                  : [];
                const isCheckedIn = Boolean(fam.is_checked_in);
                const checkinChipText =
                  fam.checkin_status ||
                  (isCheckedIn ? "Checked in" : "Not yet arrived");

                return (
                  <div
                    key={famKey}
                    className="admin-map-family-card"
                    role="listitem"
                  >
                    <button
                      type="button"
                      onClick={() => toggleFamilyExpand(famKey)}
                      aria-expanded={isExpanded}
                      style={{
                        width: "100%",
                        background: "transparent",
                        border: "none",
                        padding: 0,
                        margin: 0,
                        textAlign: "left",
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      <div className="admin-map-family-top">
                        <strong className="admin-map-family-name">{headName}</strong>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                          <span
                            style={{
                              padding: "2px 7px",
                              borderRadius: "999px",
                              fontSize: "10px",
                              fontWeight: 700,
                              backgroundColor: isCheckedIn ? "#dcfce7" : "#f1f5f9",
                              color: isCheckedIn ? "#166534" : "#475569",
                              border: isCheckedIn ? "none" : "1px solid #cbd5e1",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {checkinChipText}
                          </span>
                          <span className="admin-map-family-count">
                            <FontAwesomeIcon icon={faUsers} />
                            <span>
                              {memberCount} {memberCount === 1 ? "member" : "members"}
                            </span>
                          </span>
                          <FontAwesomeIcon
                            icon={faChevronDown}
                            style={{
                              fontSize: "11px",
                              color: "#64748b",
                              transform: isExpanded ? "rotate(180deg)" : "none",
                              transition: "transform 160ms ease",
                            }}
                          />
                        </div>
                      </div>

                      {contact ? (
                        <div className="admin-map-family-contact" style={{ marginTop: "4px" }}>
                          <FontAwesomeIcon icon={faPhone} />
                          <span>{contact}</span>
                        </div>
                      ) : null}

                      {specialNeeds.length > 0 ? (
                        <div
                          className="admin-map-family-tags"
                          aria-label="Special needs flags"
                          style={{ marginTop: "4px" }}
                        >
                          {specialNeeds.map((tag) => (
                            <span
                              key={tag}
                              className={`special-needs-tag tag-${tag
                                .toLowerCase()
                                .replace(/[^a-z0-9]/g, "-")}`}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </button>

                    {isExpanded && (
                      <div
                        style={{
                          marginTop: "8px",
                          paddingTop: "8px",
                          borderTop: "1px solid #e2e8f0",
                          display: "flex",
                          flexDirection: "column",
                          gap: "5px",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            fontSize: "11px",
                            fontWeight: 600,
                            color: "#64748b",
                          }}
                        >
                          <span>
                            {memberCount} {memberCount === 1 ? "member" : "members"}
                          </span>
                          <span>Total in room: {assigned} assigned</span>
                        </div>
                        {famMembers.map((mem, mIdx) => {
                          const memName =
                            typeof mem === "string"
                              ? mem
                              : mem.full_name || mem.name || "Household Member";
                          const hasMemCheckin =
                            mem &&
                            typeof mem === "object" &&
                            (typeof mem.is_checked_in === "boolean" ||
                              mem.checked_in_at !== undefined ||
                              Boolean(mem.checkin_status));
                          const memCheckedIn = Boolean(
                            mem?.is_checked_in || mem?.checked_in_at
                          );
                          const memChip =
                            mem?.checkin_status ||
                            (memCheckedIn ? "Checked in" : "Not yet arrived");

                          return (
                            <div
                              key={mem?.resident_id || `mem-${mIdx}`}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: "8px",
                                padding: "5px 8px",
                                background: "#ffffff",
                                border: "1px solid #e2e8f0",
                                borderRadius: "6px",
                                fontSize: "12px",
                                color: "#1e293b",
                              }}
                            >
                              <span style={{ fontWeight: 500 }}>{memName}</span>
                              {hasMemCheckin && (
                                <span
                                  style={{
                                    padding: "2px 7px",
                                    borderRadius: "999px",
                                    fontSize: "10px",
                                    fontWeight: 700,
                                    backgroundColor: memCheckedIn
                                      ? "#dcfce7"
                                      : "#f1f5f9",
                                    color: memCheckedIn ? "#166534" : "#475569",
                                    border: memCheckedIn
                                      ? "none"
                                      : "1px solid #cbd5e1",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {memChip}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Fixed Actions Footer */}
        <div className="admin-room-modal-actions">
          <button
            type="button"
            className="admin-map-btn admin-map-btn-primary"
            onClick={() => {
              navigate(
                `${basePath}?tab=centers&center=${centerId}&subtab=households&room=${room.id}`
              );
            }}
          >
            <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
            <span>View room details</span>
          </button>
          {canManageRooms && (
            <button
              type="button"
              className="admin-map-btn admin-map-btn-secondary"
              onClick={() => {
                navigate(
                  `${basePath}?tab=centers&center=${centerId}&subtab=rooms&room=${room.id}`
                );
              }}
            >
              <FontAwesomeIcon icon={faDoorOpen} />
              <span>Manage room</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}




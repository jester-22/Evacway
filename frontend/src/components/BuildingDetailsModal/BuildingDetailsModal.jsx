import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faXmark,
  faBuildingColumns,
  faUsers,
  faPhone,
  faSpinner,
  faDoorOpen,
  faHouseUser,
  faCheckCircle,
  faChevronDown,
  faArrowRightToBracket,
  faLinkSlash,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../../services/api";
import "./BuildingDetailsModal.css";

export default function BuildingDetailsModal({
  isOpen,
  buildingId,
  initialBuildingData = null,
  onClose,
  userHousehold = null,
  isStaff = false,
  onViewRoomAdmin = null,
}) {
  const modalRef = useRef(null);
  const closeBtnRef = useRef(null);
  const lastActiveElementRef = useRef(null);

  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [selectedRoomId, setSelectedRoomId] = useState(null);
  const [expandedFamilyKeys, setExpandedFamilyKeys] = useState({});

  const handleUnlinkRoom = async (roomId, roomLabel) => {
    if (
      !window.confirm(
        `Are you sure you want to remove ${roomLabel} from this building? The room will become unassigned and remain in the evacuation center.`
      )
    )
      return;
    try {
      await api.unlinkRoomFromBuilding(roomId);
      queryClient.invalidateQueries({ queryKey: ["evacuation-centers"] });
      queryClient.invalidateQueries({ queryKey: ["evacuation-center-details"] });
      if (buildingId) {
        api.getBuildingDetails(buildingId).then(setData).catch(() => {});
      }
    } catch (err) {
      alert(err.message || "Failed to unlink room");
    }
  };

  const toggleFamilyExpanded = (key) => {
    setExpandedFamilyKeys((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  // Focus management: focus close button on open, restore on close
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

  // Escape key handler
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

  // Load building details from API
  useEffect(() => {
    if (!isOpen || !buildingId) {
      setData(null);
      setError(null);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    const queryParams = {};
    if (userHousehold?.resident_id) {
      queryParams.resident_id = userHousehold.resident_id;
    }
    if (userHousehold?.household_head_name) {
      queryParams.head_name = userHousehold.household_head_name;
    }

    api
      .getBuildingDetails(buildingId, queryParams)
      .then((res) => {
        if (!isMounted) return;
        setData(res);
        setLoading(false);
        // Default selected room: resident's assigned room if in this building (expanded), else null (all collapsed)
        if (Array.isArray(res.rooms) && res.rooms.length > 0) {
          const userAssignedBldgId = userHousehold?.room?.building_id;
          const userBldgName = (userHousehold?.room?.building_name || "").trim().toLowerCase();
          const currentBldgName = (res.name || "").trim().toLowerCase();
          const bldgMatches =
            userAssignedBldgId != null
              ? String(userAssignedBldgId) === String(buildingId)
              : (userBldgName && currentBldgName && userBldgName === currentBldgName);

          let myRoom = null;
          if (bldgMatches) {
            const myRoomStr =
              userHousehold?.room?.room_number || userHousehold?.room_number || "";
            myRoom = res.rooms.find(
              (r) =>
                r.is_my_room ||
                (userHousehold?.room?.id != null &&
                  String(userHousehold.room.id) === String(r.id)) ||
                (myRoomStr &&
                  String(myRoomStr).replace(/^Room\s*/i, "").trim() ===
                    String(r.room_number).replace(/^Room\s*/i, "").trim())
            );
          }
          setSelectedRoomId(myRoom ? myRoom.id : null);
        } else {
          setSelectedRoomId(null);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err.message || "Failed to load building details");
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, buildingId, userHousehold]);

  const building =
    data?.building || (data?.id ? data : null) || initialBuildingData || {};
  const rooms = Array.isArray(data?.rooms) ? data.rooms : [];

  const userAssignedBuildingId = userHousehold?.room?.building_id;
  const userBldgName = (userHousehold?.room?.building_name || "").trim().toLowerCase();
  const currentBldgName = (building?.name || "").trim().toLowerCase();
  const isCurrentBuildingUserBuilding =
    userAssignedBuildingId != null
      ? String(userAssignedBuildingId) === String(buildingId)
      : (userBldgName && currentBldgName && userBldgName === currentBldgName);

  const myRoomStr =
    userHousehold?.room?.room_number || userHousehold?.room_number || "";

  const checkIsMine = (r) => {
    if (!isCurrentBuildingUserBuilding) return false;
    return Boolean(
      r.is_my_room ||
        (userHousehold?.room?.id != null &&
          String(userHousehold.room.id) === String(r.id)) ||
        (myRoomStr &&
          String(myRoomStr).replace(/^Room\s*/i, "").trim() ===
            String(r.room_number).replace(/^Room\s*/i, "").trim())
    );
  };

  const sortedRooms = useMemo(() => {
    if (!rooms.length) return [];
    if (!isCurrentBuildingUserBuilding) return rooms;

    const myRooms = [];
    const otherRooms = [];
    rooms.forEach((r) => {
      if (checkIsMine(r)) {
        myRooms.push(r);
      } else {
        otherRooms.push(r);
      }
    });

    return [...myRooms, ...otherRooms];
  }, [rooms, isCurrentBuildingUserBuilding, buildingId, userHousehold]);

  const activeRoom = useMemo(() => {
    if (!sortedRooms.length) return null;
    return sortedRooms.find((r) => r.id === selectedRoomId) || sortedRooms[0];
  }, [sortedRooms, selectedRoomId]);

  if (!isOpen) return null;

  const buildingName =
    building.name ||
    (rooms.length === 1
      ? `Room ${rooms[0].room_number}`
      : `Building #${buildingId}`);

  const centerName = building.center_name || "Evacuation Center";

  const totalCapacity =
    building.total_capacity ??
    building.capacity ??
    rooms.reduce((acc, r) => acc + (r.capacity || 0), 0);
  const totalOccupied =
    building.total_occupied ??
    building.occupied ??
    rooms.reduce((acc, r) => acc + (r.occupied || 0), 0);
  const totalAssigned =
    building.total_assigned ??
    building.assigned ??
    rooms.reduce((acc, r) => acc + (r.assigned ?? 0), 0);

  const occPercent =
    totalCapacity > 0
      ? Math.min(100, Math.round((totalOccupied / totalCapacity) * 100))
      : 0;
  const assignedPercent =
    totalCapacity > 0
      ? Math.min(100, Math.round((totalAssigned / totalCapacity) * 100))
      : 0;
  const isBuildingFullyAssigned =
    totalCapacity > 0 && totalAssigned >= totalCapacity;

  const occColor =
    totalCapacity === 0
      ? "#94a3b8"
      : totalOccupied >= totalCapacity
      ? "#dc2626"
      : occPercent >= 70
      ? "#d97706"
      : "#16a34a";

  const statusLabel =
    totalCapacity === 0
      ? "Closed"
      : totalOccupied >= totalCapacity
      ? "Full"
      : occPercent >= 70
      ? "Near Capacity"
      : "Available";

  const statusCls =
    statusLabel === "Closed"
      ? "is-closed"
      : statusLabel === "Full"
      ? "is-full"
      : "is-available";

  const hasStaffAccess =
    isStaff || data?.role === "staff" || data?.is_staff_view === true;

  return (
    <div
      className="bldg-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose?.();
        }
      }}
      aria-hidden={!isOpen}
    >
      <div
        ref={modalRef}
        className="bldg-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bldg-modal-title"
        tabIndex={-1}
      >
        {/* Mobile handle indicator */}
        <div className="bldg-modal-handle-bar" aria-hidden="true" />

        {/* Header */}
        <div className="bldg-modal-header">
          <div className="bldg-modal-title-row">
            <div className="bldg-modal-title-left">
              <h2 id="bldg-modal-title" className="bldg-modal-title">
                {buildingName}
              </h2>
              <span className={`bldg-status-badge ${statusCls}`}>
                {statusLabel}
              </span>
              {isBuildingFullyAssigned && (
                <span className="bldg-status-badge is-fully-assigned">
                  Fully assigned
                </span>
              )}
            </div>
            <button
              ref={closeBtnRef}
              type="button"
              className="bldg-modal-close-btn"
              onClick={onClose}
              aria-label="Close building details modal"
              title="Close (Esc)"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>

          <div className="bldg-modal-center-name">
            <FontAwesomeIcon icon={faBuildingColumns} />
            <span>{centerName}</span>
          </div>
        </div>

        {/* Occupancy Progress Bar */}
        <div className="bldg-modal-occ-section">
          <div className="bldg-modal-occ-header">
            <span className="bldg-modal-label">Building Occupancy</span>
            <span className="bldg-modal-occ-count">
              <strong>{totalOccupied}</strong> of {totalCapacity} here · {totalAssigned} assigned
            </span>
          </div>
          <div className="bldg-modal-progress-track" aria-hidden="true">
            {assignedPercent > 0 && (
              <div
                className="bldg-modal-progress-assigned"
                style={{ width: `${assignedPercent}%` }}
              />
            )}
            <div
              className="bldg-modal-progress-fill"
              style={{
                width: `${occPercent}%`,
                backgroundColor: occColor,
              }}
            />
          </div>
          <div className="bldg-modal-occ-sub">
            <span style={{ color: occColor, fontWeight: 600 }}>
              {occPercent}% ({statusLabel})
            </span>
            <span className="bldg-modal-muted-text">
              {totalCapacity > totalOccupied
                ? `${totalCapacity - totalOccupied} spaces left`
                : "No spaces left"}
            </span>
          </div>
        </div>

        {/* Loading / Error States */}
        {loading && (
          <div className="bldg-modal-loading" role="status">
            <FontAwesomeIcon icon={faSpinner} spin className="bldg-spinner-icon" />
            <span>Loading building rooms and occupancy...</span>
          </div>
        )}

        {error && (
          <div className="bldg-modal-error" role="alert">
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && (
          <div className="bldg-modal-body">
            {/* Rooms Vertical Accordion List (one per row, never a grid) */}
            <div className="bldg-modal-rooms-section">
              <div className="bldg-modal-rooms-header-row">
                <span className="bldg-modal-subheading">
                  Rooms in this building ({sortedRooms.length})
                </span>
                <span className="bldg-modal-muted-hint">Tap a room to view details</span>
              </div>

              <div
                className="bldg-modal-rooms-accordion-list"
                role="list"
                aria-label="Rooms inside this building"
              >
                {sortedRooms.length === 0 ? (
                  <div className="bldg-rooms-empty">No rooms mapped in this building yet.</div>
                ) : (
                  sortedRooms.map((r) => {
                    const isExpanded = selectedRoomId === r.id;
                    const rOcc = r.occupied || 0;
                    const rAssigned = r.assigned ?? 0;
                    const rCap = r.capacity || 0;
                    const rPct = rCap > 0 ? Math.min(100, Math.round((rOcc / rCap) * 100)) : 0;
                    const rAssignedPct = rCap > 0 ? Math.min(100, Math.round((rAssigned / rCap) * 100)) : 0;
                    const rIsFullyAssigned = rCap > 0 && rAssigned >= rCap;
                    const rColor =
                      rCap === 0
                        ? "#94a3b8"
                        : rOcc >= rCap
                        ? "#dc2626"
                        : rPct >= 70
                        ? "#d97706"
                        : "#16a34a";
                    const rStatusLabel =
                      rCap === 0
                        ? "Closed"
                        : rOcc >= rCap
                        ? "Full"
                        : rPct >= 70
                        ? "Near Capacity"
                        : "Available";

                    const isMine = checkIsMine(r);
                    const isMyHouseholdCheckedIn = Boolean(
                      r.my_household?.is_checked_in ||
                        userHousehold?.is_checked_in ||
                        userHousehold?.room?.is_checked_in
                    );
                    const myHouseholdStatusLabel = isMyHouseholdCheckedIn
                      ? "Checked in"
                      : "Reserved for your household";
                    const entrance =
                      (isMine && (userHousehold?.room?.recommended_entrance || userHousehold?.recommended_entrance)) ||
                      r.recommended_entrance;

                    const cleanRoomNum = String(r.room_number || "").replace(/^room\s*/i, "").trim();
                    const roomLabel = cleanRoomNum ? `Room ${cleanRoomNum}` : "Room";

                    const unassignedSpaces = Math.max(0, rCap - Math.max(rOcc, rAssigned));
                    const spaceLeftText =
                      rCap > 0
                        ? unassignedSpaces > 0
                          ? `${unassignedSpaces} spaces left`
                          : rIsFullyAssigned
                            ? "Fully assigned"
                            : "No spaces left"
                        : "Closed / No data";

                    return (
                      <div
                        key={r.id}
                        className={`bldg-room-accordion-item ${isExpanded ? "is-expanded" : ""} ${
                          isMine ? "is-my-room" : ""
                        }`}
                        role="listitem"
                      >
                        {/* 64px compact room row button */}
                        <button
                          type="button"
                          className="bldg-room-accordion-row"
                          onClick={() => setSelectedRoomId(isExpanded ? null : r.id)}
                          aria-expanded={isExpanded}
                          aria-controls={`room-content-${r.id}`}
                        >
                          <div className="bldg-room-row-left">
                            <div className="bldg-room-icon-box">
                              <FontAwesomeIcon icon={faDoorOpen} />
                            </div>
                            <div className="bldg-room-meta-group">
                              <div className="bldg-room-number-wrap">
                                <strong>{roomLabel}</strong>
                                {isMine && (
                                  <span className="bldg-badge-yours">
                                    <FontAwesomeIcon icon={faCheckCircle} /> {myHouseholdStatusLabel}
                                  </span>
                                )}
                              </div>
                              <span className="bldg-room-subline">
                                {spaceLeftText}
                                {entrance ? ` · Enter via ${entrance}` : ""}
                              </span>
                            </div>
                          </div>

                          <div className="bldg-room-row-right">
                            <div className="bldg-room-occ-badge">
                              <span className="bldg-room-occ-text">
                                <strong>{rOcc}</strong> of {rCap} here · {rAssigned} assigned
                              </span>
                              <div className="bldg-room-pills-row">
                                {rIsFullyAssigned ? (
                                  <span className="bldg-room-status-pill is-fully-assigned">
                                    Fully assigned
                                  </span>
                                ) : (
                                  <span
                                    className="bldg-room-status-pill"
                                    style={{
                                      color: rColor,
                                      backgroundColor: `${rColor}15`,
                                    }}
                                  >
                                    {rStatusLabel}
                                  </span>
                                )}
                              </div>
                            </div>
                            <FontAwesomeIcon
                              icon={faChevronDown}
                              className={`bldg-room-chevron ${isExpanded ? "is-rotated" : ""}`}
                            />
                          </div>

                          {/* 4px bottom occupancy bar */}
                          <div className="bldg-room-bar-track" aria-hidden="true">
                            {rAssignedPct > 0 && (
                              <div
                                className="bldg-room-bar-assigned"
                                style={{ width: `${rAssignedPct}%` }}
                              />
                            )}
                            <div
                              className="bldg-room-bar-fill"
                              style={{ width: `${rPct}%`, backgroundColor: rColor }}
                            />
                          </div>
                        </button>

                        {/* Accordion expandable panel */}
                        {isExpanded && (
                          <div
                            id={`room-content-${r.id}`}
                            className="bldg-room-accordion-content"
                            role="region"
                            aria-label={`Details for ${roomLabel}`}
                          >
                            {/* Room details & space banner */}
                            <div className="bldg-resident-space-wrap">
                              <div className="bldg-resident-space-banner">
                                <div className="bldg-resident-space-left">
                                  <span className="bldg-space-big">
                                    {rCap > 0
                                      ? unassignedSpaces > 0
                                        ? `${unassignedSpaces} spaces left`
                                        : rIsFullyAssigned
                                          ? "Fully assigned"
                                          : "Room is currently full"
                                      : "Closed"}
                                  </span>
                                  <span className="bldg-space-sub">
                                    {rOcc} of {rCap} here · {rAssigned} assigned
                                  </span>
                                </div>
                                <div className="bldg-room-pills-row">
                                  {rIsFullyAssigned ? (
                                    <span className="bldg-room-status-badge is-fully-assigned">
                                      Fully assigned
                                    </span>
                                  ) : (
                                    <span
                                      className="bldg-room-status-badge"
                                      style={{
                                        color: rColor,
                                        backgroundColor: `${rColor}15`,
                                      }}
                                    >
                                      {rStatusLabel}
                                    </span>
                                  )}
                                </div>
                              </div>

                              {entrance && (
                                <div className="bldg-room-entrance-callout">
                                  <FontAwesomeIcon icon={faArrowRightToBracket} />
                                  <span>Enter via <strong>{entrance}</strong></span>
                                </div>
                              )}

                              {/* Families assigned to this room */}
                              {(() => {
                                const roomFamilies = Array.isArray(r.families) ? r.families : [];
                                const totalRoomMembers =
                                  roomFamilies.reduce(
                                    (sum, fam) =>
                                      sum +
                                      Number(
                                        (Array.isArray(fam.members) ? fam.members.length : null) ??
                                          fam.assigned_members ??
                                          fam.member_count ??
                                          0
                                      ),
                                    0
                                  ) || rAssigned;

                                return (
                                  <div className="bldg-staff-families-wrap">
                                    <div className="bldg-staff-header">
                                      <span>
                                        Assigned families ({roomFamilies.length})
                                      </span>
                                      <span className="bldg-staff-total-members">
                                        {totalRoomMembers}{" "}
                                        {totalRoomMembers === 1 ? "member" : "members"} ({rAssigned} assigned)
                                      </span>
                                    </div>

                                    {roomFamilies.length === 0 ? (
                                      <div className="bldg-families-empty">
                                        No families assigned yet
                                      </div>
                                    ) : (
                                      <div className="bldg-families-stack">
                                        {roomFamilies.map((fam, fIdx) => {
                                          const famKey = `${r.id}-fam-${fam.family_id || fIdx}`;
                                          const isFamExpanded = Boolean(expandedFamilyKeys[famKey]);
                                          const famMembers = Array.isArray(fam.members)
                                            ? fam.members
                                            : [];
                                          const famMemberCount =
                                            famMembers.length ||
                                            Number(fam.assigned_members ?? fam.member_count ?? 1);
                                          const famCheckedIn = Boolean(fam.is_checked_in);
                                          const famChipText =
                                            fam.checkin_status ||
                                            (famCheckedIn ? "Checked in" : "Not yet arrived");

                                          return (
                                            <div
                                              key={fam.family_id || `fam-${fIdx}`}
                                              className={`bldg-family-item-card ${
                                                isFamExpanded ? "is-expanded" : ""
                                              }`}
                                            >
                                              <button
                                                type="button"
                                                className="bldg-family-toggle-btn"
                                                onClick={() => toggleFamilyExpanded(famKey)}
                                                aria-expanded={isFamExpanded}
                                              >
                                                <div className="bldg-family-top">
                                                  <strong className="bldg-family-name">
                                                    {fam.head_name || "Unknown Household Head"}
                                                  </strong>
                                                  <div className="bldg-family-top-right">
                                                    <span
                                                      className={`bldg-family-checkin-chip ${
                                                        famCheckedIn
                                                          ? "is-checked-in"
                                                          : "is-not-arrived"
                                                      }`}
                                                    >
                                                      {famChipText}
                                                    </span>
                                                    <span className="bldg-family-count">
                                                      <FontAwesomeIcon icon={faUsers} />
                                                      <span>
                                                        {famMemberCount}{" "}
                                                        {famMemberCount === 1
                                                          ? "member"
                                                          : "members"}
                                                      </span>
                                                    </span>
                                                    <FontAwesomeIcon
                                                      icon={faChevronDown}
                                                      className={`bldg-family-chevron ${
                                                        isFamExpanded ? "is-rotated" : ""
                                                      }`}
                                                    />
                                                  </div>
                                                </div>

                                                {fam.contact_number &&
                                                  fam.contact_number !== "N/A" && (
                                                    <div className="bldg-family-contact">
                                                      <FontAwesomeIcon icon={faPhone} />
                                                      <span>{fam.contact_number}</span>
                                                    </div>
                                                  )}

                                                {Array.isArray(fam.special_needs) &&
                                                  fam.special_needs.length > 0 && (
                                                    <div className="bldg-family-tags">
                                                      {fam.special_needs.map((flag) => (
                                                        <span
                                                          key={flag}
                                                          className={`bldg-special-flag flag-${flag
                                                            .toLowerCase()
                                                            .replace(/[^a-z0-9]/g, "-")}`}
                                                        >
                                                          {flag}
                                                        </span>
                                                      ))}
                                                    </div>
                                                  )}
                                              </button>

                                              {isFamExpanded && (
                                                <div className="bldg-family-members-panel">
                                                  <div className="bldg-family-members-header">
                                                    <span>
                                                      {famMemberCount}{" "}
                                                      {famMemberCount === 1
                                                        ? "member"
                                                        : "members"}
                                                    </span>
                                                    <span>
                                                      Total in room: {rAssigned} assigned
                                                    </span>
                                                  </div>
                                                  {famMembers.length > 0 ? (
                                                    <div className="bldg-family-members-list">
                                                      {famMembers.map((mem, mIdx) => {
                                                        const memName =
                                                          typeof mem === "string"
                                                            ? mem
                                                            : mem.full_name ||
                                                              mem.name ||
                                                              "Household Member";
                                                        const hasMemCheckin =
                                                          mem &&
                                                          typeof mem === "object" &&
                                                          (typeof mem.is_checked_in ===
                                                            "boolean" ||
                                                            mem.checked_in_at !== undefined ||
                                                            Boolean(mem.checkin_status));
                                                        const memCheckedIn = Boolean(
                                                          mem?.is_checked_in ||
                                                            mem?.checked_in_at
                                                        );
                                                        const memChip =
                                                          mem?.checkin_status ||
                                                          (memCheckedIn
                                                            ? "Checked in"
                                                            : "Not yet arrived");

                                                        return (
                                                          <div
                                                            key={
                                                              mem?.resident_id ||
                                                              `mem-${mIdx}`
                                                            }
                                                            className="bldg-family-member-row"
                                                          >
                                                            <span className="bldg-family-member-name">
                                                              {memName}
                                                            </span>
                                                            {hasMemCheckin && (
                                                              <span
                                                                className={`bldg-family-checkin-chip ${
                                                                  memCheckedIn
                                                                    ? "is-checked-in"
                                                                    : "is-not-arrived"
                                                                }`}
                                                              >
                                                                {memChip}
                                                              </span>
                                                            )}
                                                          </div>
                                                        );
                                                      })}
                                                    </div>
                                                  ) : (
                                                    <div className="bldg-family-members-empty">
                                                      {famMemberCount}{" "}
                                                      {famMemberCount === 1
                                                        ? "member"
                                                        : "members"}{" "}
                                                      assigned
                                                    </div>
                                                  )}
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                              {/* Staff Action: Unlink Room from Building */}
                              {hasStaffAccess && (
                                <div style={{ marginTop: "12px", paddingTop: "10px", borderTop: "1px dashed #e2e8f0", display: "flex", justifyContent: "flex-end" }}>
                                  <button
                                    type="button"
                                    style={{
                                      background: "#fffbeb",
                                      border: "1px solid #fde68a",
                                      borderRadius: "6px",
                                      padding: "5px 12px",
                                      fontSize: "12px",
                                      fontWeight: 600,
                                      color: "#b45309",
                                      cursor: "pointer",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: "6px",
                                    }}
                                    onClick={() => handleUnlinkRoom(r.id, roomLabel)}
                                    title={`Remove ${roomLabel} from this building`}
                                  >
                                    <FontAwesomeIcon icon={faLinkSlash} />
                                    <span>Remove from Building (Unlink)</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Empty state if building has no rooms yet */}
            {sortedRooms.length === 0 && (
              <div className="bldg-modal-no-rooms">
                <FontAwesomeIcon icon={faDoorOpen} />
                <p>No rooms linked to this building yet.</p>
              </div>
            )}
          </div>
        )}

        {/* Admin action button if staff */}
        {hasStaffAccess && activeRoom && onViewRoomAdmin && (
          <div className="bldg-modal-footer">
            <button
              type="button"
              className="bldg-admin-btn"
              onClick={() => onViewRoomAdmin(activeRoom.id, building.center_id)}
            >
              <span>Manage Room Assignments</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

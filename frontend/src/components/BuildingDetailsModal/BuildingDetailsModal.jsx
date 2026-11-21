import { useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  Building2,
  DoorOpen,
  Users,
  Phone,
  ChevronDown,
  LogIn,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { api } from "../../services/api";
import { findAssignedRoom } from "../../utils/resolveRoomBuilding";
import { formatFloorLabel } from "../../utils/formatRoomLabel";
import { StatusPill, ProgressBar } from "../ui";
import PublicMapDialogShell from "../PublicMapDialogShell/PublicMapDialogShell";
import "./BuildingDetailsModal.css";

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export default function BuildingDetailsModal({
  isOpen,
  buildingId,
  initialBuildingData = null,
  onClose,
  isStaff = false,
  onViewRoomAdmin = null,
  highlightedRoom = null,
  hideHouseholds = false,
  usePublicMapShell = false,
}) {
  const modalRef = useRef(null);
  const closeBtnRef = useRef(null);
  const lastActiveElementRef = useRef(null);
  const assignedRoomRef = useRef(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  // Keep the existing staff modal keyboard behavior; the public map shell owns
  // focus management when this component is used from the public map.
  useEffect(() => {
    if (usePublicMapShell) return undefined;
    if (isOpen) {
      lastActiveElementRef.current = document.activeElement;
      requestAnimationFrame(() => {
        closeBtnRef.current?.focus();
      });
    } else if (lastActiveElementRef.current) {
      try {
        lastActiveElementRef.current.focus();
      } catch {
        // Ignore focus restore errors if trigger unmounted.
      }
      lastActiveElementRef.current = null;
    }
    return undefined;
  }, [isOpen, usePublicMapShell]);

  useEffect(() => {
    if (!isOpen || usePublicMapShell) return undefined;
    function handleKeyDown(e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key !== "Tab" || !modalRef.current) return;
      const focusables = Array.from(
        modalRef.current.querySelectorAll(FOCUSABLE_SELECTOR)
      ).filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
      if (focusables.length === 0) {
        e.preventDefault();
        modalRef.current.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !modalRef.current.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !modalRef.current.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, usePublicMapShell]);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [selectedRoomId, setSelectedRoomId] = useState(null);
  const [expandedFloor, setExpandedFloor] = useState(null);
  const [expandedFamilyKeys, setExpandedFamilyKeys] = useState({});
  const [isScrolled, setIsScrolled] = useState(false);

  const toggleFamilyExpanded = (key) => {
    setExpandedFamilyKeys((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

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

    api
      .getBuildingDetails(buildingId)
      .then((res) => {
        if (!isMounted) return;
        setData(res);
        setLoading(false);
        // Default selected room: resident's assigned room if in this building (expanded), else null (all collapsed)
        if (Array.isArray(res.rooms) && res.rooms.length > 0) {
          const myRoom = res.rooms.find((r) => r.is_my_room === true);
          const foundRoom = findAssignedRoom(res.rooms, highlightedRoom);
          setSelectedRoomId(foundRoom?.id ?? myRoom?.id ?? null);
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
  }, [isOpen, buildingId, highlightedRoom, reloadNonce]);

  useEffect(() => {
    if (!isOpen || loading || !highlightedRoom || !data) return;
    const frame = requestAnimationFrame(() => {
      assignedRoomRef.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen, loading, data, highlightedRoom, expandedFloor]);

  const building =
    data?.building || (data?.id ? data : null) || initialBuildingData || {};
  const rooms = Array.isArray(data?.rooms) ? data.rooms : [];

  const checkIsMine = (r) => !isStaff && r.is_my_room === true;

  const sortedRooms = useMemo(() => {
    if (!rooms.length) return [];
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
  }, [rooms, isStaff]);

  const buildingFloors = Number(data?.floors || data?.building?.floors || initialBuildingData?.floors || 1);
  const floorGroups = useMemo(() => {
    const floors = [...new Set(sortedRooms.map((room) => room.floor).filter((floor) => floor != null))].sort((a, b) => a - b);
    return [
      ...floors.map((floor) => ({
        floor,
        rooms: sortedRooms.filter((room) => Number(room.floor) === Number(floor)),
      })),
      ...(sortedRooms.some((room) => room.floor == null)
        ? [{ floor: null, rooms: sortedRooms.filter((room) => room.floor == null) }]
        : []),
    ];
  }, [sortedRooms]);

  const displayRooms =
    buildingFloors >= 2
      ? floorGroups.flatMap((group) => [
          ...(group.floor != null
            ? [{ __floorHeader: true, floor: group.floor, count: group.rooms.length }]
            : []),
          ...(group.floor == null ||
          expandedFloor == null ||
          expandedFloor === Number(group.floor)
            ? group.rooms
            : []),
        ])
      : sortedRooms;

  useEffect(() => {
    if (!isOpen || buildingFloors < 2) return;
    const foundRoom =
      findAssignedRoom(rooms, highlightedRoom) ||
      sortedRooms.find((room) => String(room.id) === String(selectedRoomId));
    setExpandedFloor(
      foundRoom?.floor ?? floorGroups.find((group) => group.floor != null)?.floor ?? null
    );
  }, [isOpen, buildingFloors, rooms, highlightedRoom, floorGroups, sortedRooms, selectedRoomId]);

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
  const isBuildingFullyAssigned =
    totalCapacity > 0 && totalAssigned >= totalCapacity;
  const spacesLeft = Math.max(0, totalCapacity - totalOccupied);
  const availableFamilySlots = rooms.reduce(
    (total, room) => total + Number(room.available_slots || 0),
    0
  );
  const availablePeopleSpaces = rooms.reduce(
    (total, room) => total + Number(room.available_spaces || 0),
    0
  );
  const publicBuildingStatusRaw = data?.status || "Available";
  const publicBuildingStatus = publicBuildingStatusRaw
    .replaceAll("_", " ")
    .replace(/^\w/, (letter) => letter.toUpperCase());
  const publicBuildingStatusVariant =
    publicBuildingStatus.toLowerCase() === "closed"
      ? "inactive"
      : publicBuildingStatus.toLowerCase() === "under repair"
        ? "warn"
        : publicBuildingStatus.toLowerCase() === "full"
          ? "full"
          : "available";

  let statusLabel = "Available";
  let statusVariant = "available";
  let statusToneClass = "is-success";

  if (totalCapacity === 0) {
    statusLabel = "No data";
    statusVariant = "neutral";
    statusToneClass = "is-neutral";
  } else if (totalOccupied >= totalCapacity) {
    statusLabel = "Full";
    statusVariant = "full";
    statusToneClass = "is-danger";
  } else if (isBuildingFullyAssigned) {
    statusLabel = "Fully assigned";
    statusVariant = "fully-assigned";
    statusToneClass = "is-warn";
  } else if (occPercent >= 70) {
    statusLabel = "Filling";
    statusVariant = "almost-full";
    statusToneClass = "is-warn";
  }

  const hasStaffAccess =
    isStaff || data?.role === "staff" || data?.is_staff_view === true;

  const dialog = (
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

        {/* Fixed Top Section: Header & Occupancy Card */}
        <div className={`bldg-modal-top-fixed ${isScrolled ? "is-scrolled" : ""}`}>
          {/* Header */}
          <div className="bldg-modal-header">
            <div className="bldg-modal-title-row">
              <div className="bldg-modal-title-left">
                <h2 id="bldg-modal-title" className="bldg-modal-title">
                  {buildingName}
                </h2>
                <StatusPill
                  variant={isStaff ? statusVariant : publicBuildingStatusVariant}
                  label={isStaff ? statusLabel : publicBuildingStatus}
                />
              </div>
              <button
                ref={closeBtnRef}
                type="button"
                className="bldg-modal-close-btn"
                onClick={onClose}
                aria-label="Close"
                title="Close (Esc)"
              >
                <X size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>

            <div className="bldg-modal-center-name">
              <Building2 size={14} strokeWidth={2} aria-hidden="true" />
              <span>{centerName}</span>
            </div>
          </div>

          {isStaff ? (
            <div className="bldg-modal-occ-wrapper">
              <div className="bldg-occ-card">
              <div className="bldg-occ-card-top">
                <span className="bldg-occ-card-label">Building occupancy</span>
                <div className="bldg-occ-figure">
                  <strong className="bldg-occ-numbers">
                    {totalOccupied} / {totalCapacity}
                  </strong>
                  <span className="bldg-occ-here-label">here</span>
                </div>
              </div>

              <ProgressBar
                value={totalOccupied}
                max={totalCapacity}
                size={8}
                ariaLabel={`Building occupancy: ${totalOccupied} of ${totalCapacity} here`}
              />

              <div className="bldg-occ-card-bottom">
                <span className={`bldg-occ-status-text ${statusToneClass}`}>
                  {occPercent}% · {statusLabel}
                </span>
                <span className="bldg-occ-bottom-meta">
                  {totalAssigned} assigned · {spacesLeft}{" "}
                  {spacesLeft === 1 ? "space" : "spaces"} left
                </span>
              </div>
              </div>
            </div>
          ) : (
            <div className="bldg-modal-occ-wrapper">
              <div className="bldg-occ-card" aria-label="Building availability">
                <div className="bldg-occ-card-bottom">
                  <span className="bldg-occ-bottom-meta">
                    {availableFamilySlots} free family {availableFamilySlots === 1 ? "slot" : "slots"}
                  </span>
                  <span className="bldg-occ-bottom-meta">
                    {availablePeopleSpaces} free people {availablePeopleSpaces === 1 ? "space" : "spaces"}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Loading Skeletons */}
        {loading && (
          <div
            className="bldg-modal-body"
            role="status"
            aria-busy="true"
            aria-label="Loading building rooms"
          >
            <div className="bldg-modal-rooms-section">
              <div className="bldg-modal-rooms-header-row">
                <span className="bldg-modal-subheading">Rooms</span>
                <span className="bldg-modal-muted-hint">Loading rooms...</span>
              </div>
              {[0, 1, 2].map((idx) => (
                <div key={idx} className="bldg-room-skeleton" aria-hidden="true">
                  <div className="bldg-room-skeleton__row">
                    <div className="bldg-room-skeleton__icon" />
                    <div className="bldg-room-skeleton__copy">
                      <div className="bldg-room-skeleton__line bldg-room-skeleton__line--title" />
                      <div className="bldg-room-skeleton__line bldg-room-skeleton__line--sub" />
                    </div>
                    <div className="bldg-room-skeleton__pill" />
                  </div>
                  <div className="bldg-room-skeleton__bar" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="bldg-modal-body">
            <div className="bldg-modal-error" role="alert">
              <AlertCircle size={20} strokeWidth={2} aria-hidden="true" />
              <p className="bldg-modal-error__text">{error}</p>
              <button
                type="button"
                className="bldg-modal-retry-btn"
                onClick={() => setReloadNonce((n) => n + 1)}
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Scrollable Room List */}
        {!loading && !error && (
          <div
            className="bldg-modal-body"
            onScroll={(e) => setIsScrolled(e.currentTarget.scrollTop > 4)}
          >
            <div className="bldg-modal-rooms-section">
              <div className="bldg-modal-rooms-header-row">
                <span className="bldg-modal-subheading">
                  {isStaff ? `Rooms (${sortedRooms.length})` : "Rooms"}
                </span>
                <span className="bldg-modal-muted-hint">
                  Tap a room to view details
                </span>
              </div>

              {buildingFloors >= 2 && (
                <div className="bldg-floor-chips" role="group" aria-label="Jump to floor">
                  <button
                    type="button"
                    className={expandedFloor == null ? "is-active" : ""}
                    onClick={() => setExpandedFloor(null)}
                  >
                    All
                  </button>
                  {floorGroups
                    .filter((group) => group.floor != null)
                    .map(({ floor }) => (
                      <button
                        type="button"
                        key={floor}
                        className={Number(expandedFloor) === Number(floor) ? "is-active" : ""}
                        onClick={() => {
                          setExpandedFloor(Number(floor));
                          requestAnimationFrame(() => {
                            const prefersReduced =
                              typeof window !== "undefined" &&
                              window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
                            document
                              .getElementById(`bldg-floor-${floor}`)
                              ?.scrollIntoView({
                                block: "nearest",
                                behavior: prefersReduced ? "auto" : "smooth",
                              });
                          });
                        }}
                      >
                        {formatFloorLabel(floor).replace(" floor", "")}
                      </button>
                    ))}
                </div>
              )}

              {sortedRooms.length === 0 ? (
                <div className="bldg-modal-no-rooms">
                  <DoorOpen size={24} strokeWidth={1.75} aria-hidden="true" />
                  <p>No rooms linked to this building yet.</p>
                </div>
              ) : (
                <div
                  className="bldg-modal-rooms-accordion-list"
                  role="list"
                  aria-label="Rooms inside this building"
                >
                  {displayRooms.map((r) => {
                    if (r.__floorHeader) {
                      const isFloorExpanded = Number(expandedFloor) === Number(r.floor);
                      return (
                        <button
                          type="button"
                          id={`bldg-floor-${r.floor}`}
                          key={`floor-header-${r.floor}`}
                          className="bldg-floor-group-header"
                          onClick={() =>
                            setExpandedFloor((current) =>
                              Number(current) === Number(r.floor) ? null : Number(r.floor)
                            )
                          }
                          aria-expanded={isFloorExpanded}
                        >
                          <span>
                            {formatFloorLabel(r.floor)} · {r.count}{" "}
                            {r.count === 1 ? "room" : "rooms"}
                          </span>
                          <ChevronDown
                            size={15}
                            strokeWidth={2}
                            className={`bldg-room-chevron ${isFloorExpanded ? "is-rotated" : ""}`}
                            aria-hidden="true"
                          />
                        </button>
                      );
                    }

                    const isExpanded = selectedRoomId === r.id;
                    const isFoundRoom = findAssignedRoom(rooms, highlightedRoom)?.id === r.id;
                    const rOcc = r.occupied || 0;
                    const rAssigned = r.assigned ?? 0;
                    const rCap = r.capacity || 0;
                    const rAvailableSlots = Number(r.available_slots || 0);
                    const rAvailableSpaces = Number(r.available_spaces || 0);
                    const rPct =
                      rCap > 0
                        ? Math.min(100, Math.round((rOcc / rCap) * 100))
                        : 0;
                    const rIsFullyAssigned = rCap > 0 && rAssigned >= rCap;

                    let rStatusText = "Available";
                    let rStatusVariant = "available";

                    if (!isStaff) {
                      rStatusText = r.status || "Available";
                      rStatusVariant = rStatusText.toLowerCase() === "closed"
                        ? "inactive"
                        : rStatusText.toLowerCase() === "under repair"
                          ? "warn"
                          : rStatusText.toLowerCase() === "full"
                            ? "full"
                            : "available";
                    } else if (rCap === 0) {
                      rStatusText = "No data";
                      rStatusVariant = "neutral";
                    } else if (rOcc >= rCap) {
                      rStatusText = "Full";
                      rStatusVariant = "full";
                    } else if (rIsFullyAssigned) {
                      rStatusText = "Fully assigned";
                      rStatusVariant = "fully-assigned";
                    } else if (rPct >= 70) {
                      rStatusText = "Filling";
                      rStatusVariant = "almost-full";
                    }

                    const isMine = checkIsMine(r);
                    const entrance = isStaff ? r.recommended_entrance : null;

                    const cleanRoomNum = String(r.room_number || "")
                      .replace(/^room\s*/i, "")
                      .trim();
                    const roomLabel = cleanRoomNum
                      ? `Room ${cleanRoomNum}`
                      : "Room";

                    const unassignedSpaces = isStaff
                      ? Math.max(0, rCap - Math.max(rOcc, rAssigned))
                      : rAvailableSpaces;

                    return (
                      <div
                        key={r.id}
                        ref={isFoundRoom ? assignedRoomRef : null}
                        className={`bldg-room-card ${
                          isExpanded ? "is-expanded" : ""
                        } ${isMine ? "is-my-room" : ""} ${isFoundRoom ? "is-found-room" : ""}`}
                        role="listitem"
                      >
                        <button
                          type="button"
                          className="bldg-room-card-btn"
                          onClick={() =>
                            setSelectedRoomId(isExpanded ? null : r.id)
                          }
                          aria-expanded={isExpanded}
                          aria-controls={`room-content-${r.id}`}
                        >
                          <div className="bldg-room-card-main">
                            {/* 36px icon tile */}
                            <div className="bldg-room-icon-box" aria-hidden="true">
                              <DoorOpen size={17} strokeWidth={2} />
                            </div>

                            {/* Room Name & Muted Subline */}
                            <div className="bldg-room-info">
                              <div className="bldg-room-title-row">
                                <span className="bldg-room-name">
                                  {roomLabel}
                                </span>
                                  {isMine && (
                                  <span className="bldg-badge-yours">
                                    <CheckCircle2 size={11} strokeWidth={2.25} aria-hidden="true" />
                                      <span>Your room</span>
                                  </span>
                                )}
                                {isFoundRoom && (
                                  <span className="bldg-badge-assigned">Assigned</span>
                                )}
                              </div>
                              <div className="bldg-room-subline">
                                {isStaff
                                  ? `${rOcc} of ${rCap} here · ${rAssigned} assigned`
                                  : `${rAvailableSlots} free family ${rAvailableSlots === 1 ? "slot" : "slots"} · ${rAvailableSpaces} free people ${rAvailableSpaces === 1 ? "space" : "spaces"}`}
                                {entrance ? ` · Enter via ${entrance}` : ""}
                              </div>
                            </div>

                            {/* StatusPill & Rotating Chevron */}
                            <div className="bldg-room-card-right">
                              <StatusPill
                                variant={rStatusVariant}
                                label={rStatusText}
                              />
                              <ChevronDown
                                size={15}
                                strokeWidth={2}
                                className={`bldg-room-chevron ${
                                  isExpanded ? "is-rotated" : ""
                                }`}
                                aria-hidden="true"
                              />
                            </div>
                          </div>

                          {isStaff && (
                            <ProgressBar
                              value={rOcc}
                              max={rCap}
                              size={6}
                              ariaLabel={`${roomLabel} occupancy: ${rPct}%`}
                            />
                          )}
                        </button>

                        {/* Expanded room panel */}
                        {isExpanded && (
                          <div
                            id={`room-content-${r.id}`}
                            className="bldg-room-accordion-content"
                            role="region"
                            aria-label={`Details for ${roomLabel}`}
                          >
                            {!isStaff ? (
                              <div className="bldg-resident-space-banner">
                                <span className="bldg-space-big">
                                  {rAvailableSlots} free family {rAvailableSlots === 1 ? "slot" : "slots"}
                                </span>
                                <span className="bldg-space-sub">
                                  {rAvailableSpaces} free people {rAvailableSpaces === 1 ? "space" : "spaces"}
                                </span>
                                <StatusPill variant={rStatusVariant} label={rStatusText} />
                              </div>
                            ) : (
                            <div className="bldg-resident-space-wrap">
                              {/* Summary card */}
                              <div className="bldg-resident-space-banner">
                                <div className="bldg-resident-space-left">
                                  <span className="bldg-space-big">
                                    {rCap > 0
                                      ? unassignedSpaces > 0
                                        ? `${unassignedSpaces} ${
                                            unassignedSpaces === 1 ? "space" : "spaces"
                                          } left`
                                        : rIsFullyAssigned
                                          ? "Fully assigned"
                                          : "Room is currently full"
                                      : "Closed"}
                                  </span>
                                  <span className="bldg-space-sub">
                                    {rOcc} of {rCap} here · {rAssigned} assigned
                                  </span>
                                </div>
                                <StatusPill
                                  variant={rStatusVariant}
                                  label={rStatusText}
                                />
                              </div>

                              {entrance && (
                                <div className="bldg-room-entrance-callout">
                                  <LogIn size={14} strokeWidth={2} aria-hidden="true" />
                                  <span>
                                    Enter via <strong>{entrance}</strong>
                                  </span>
                                </div>
                              )}

                              {/* Families assigned to this room */}
                              {isStaff && !hideHouseholds &&
                                (() => {
                                  const roomFamilies = Array.isArray(r.families)
                                    ? r.families
                                    : [];
                                  const totalRoomMembers =
                                    roomFamilies.reduce(
                                      (sum, fam) =>
                                        sum +
                                        Number(
                                          (Array.isArray(fam.members)
                                            ? fam.members.length
                                            : null) ??
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
                                          {totalRoomMembers === 1
                                            ? "member"
                                            : "members"}{" "}
                                          ({rAssigned} assigned)
                                        </span>
                                      </div>

                                      {roomFamilies.length === 0 ? (
                                        <div className="bldg-families-empty">
                                          No families assigned yet
                                        </div>
                                      ) : (
                                        <div className="bldg-families-stack">
                                          {roomFamilies.map((fam, fIdx) => {
                                            const famKey = `${r.id}-fam-${
                                              fam.family_id || fIdx
                                            }`;
                                            const isFamExpanded = Boolean(
                                              expandedFamilyKeys[famKey]
                                            );
                                            const famMembers = Array.isArray(
                                              fam.members
                                            )
                                              ? fam.members
                                              : [];
                                            const famMemberCount =
                                              famMembers.length ||
                                              Number(
                                                fam.assigned_members ??
                                                  fam.member_count ??
                                                  1
                                              );
                                            const famCheckedIn = Boolean(
                                              fam.is_checked_in
                                            );
                                            const famChipLabel = famCheckedIn
                                              ? "Arrived"
                                              : "Not yet arrived";

                                            return (
                                              <div
                                                key={
                                                  fam.family_id || `fam-${fIdx}`
                                                }
                                                className={`bldg-family-item-card ${
                                                  isFamExpanded
                                                    ? "is-expanded"
                                                    : ""
                                                }`}
                                              >
                                                <button
                                                  type="button"
                                                  className="bldg-family-toggle-btn"
                                                  onClick={() =>
                                                    toggleFamilyExpanded(famKey)
                                                  }
                                                  aria-expanded={isFamExpanded}
                                                >
                                                  <div className="bldg-family-top">
                                                    <strong className="bldg-family-name">
                                                      {fam.head_name ||
                                                        "Unknown Family Head"}
                                                    </strong>
                                                    <div className="bldg-family-top-right">
                                                      <StatusPill
                                                        variant={
                                                          famCheckedIn
                                                            ? "arrived"
                                                            : "pending-arrival"
                                                        }
                                                        label={famChipLabel}
                                                        className="bldg-pill-sm"
                                                      />
                                                      <span className="bldg-family-count">
                                                        <Users
                                                          size={12}
                                                          strokeWidth={2}
                                                          aria-hidden="true"
                                                        />
                                                        <span>
                                                          {famMemberCount}{" "}
                                                          {famMemberCount === 1
                                                            ? "member"
                                                            : "members"}
                                                        </span>
                                                      </span>
                                                      <ChevronDown
                                                        size={14}
                                                        strokeWidth={2}
                                                        className={`bldg-family-chevron ${
                                                          isFamExpanded
                                                            ? "is-rotated"
                                                            : ""
                                                        }`}
                                                        aria-hidden="true"
                                                      />
                                                    </div>
                                                  </div>

                                                  {fam.contact_number &&
                                                    fam.contact_number !==
                                                      "N/A" && (
                                                      <div className="bldg-family-contact">
                                                        <Phone
                                                          size={12}
                                                          strokeWidth={2}
                                                          aria-hidden="true"
                                                        />
                                                        <span>
                                                          {fam.contact_number}
                                                        </span>
                                                      </div>
                                                    )}

                                                  {Array.isArray(
                                                    fam.special_needs
                                                  ) &&
                                                    fam.special_needs.length >
                                                      0 && (
                                                      <div className="bldg-family-tags">
                                                        {fam.special_needs.map(
                                                          (flag) => (
                                                            <span
                                                              key={flag}
                                                              className="bldg-special-flag"
                                                            >
                                                              {flag}
                                                            </span>
                                                          )
                                                        )}
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
                                                        Total in room: {rAssigned}{" "}
                                                        assigned
                                                      </span>
                                                    </div>
                                                    {famMembers.length > 0 ? (
                                                      <div className="bldg-family-members-list">
                                                        {famMembers.map(
                                                          (mem, mIdx) => {
                                                            const memName =
                                                              typeof mem ===
                                                              "string"
                                                                ? mem
                                                                : mem.full_name ||
                                                                  mem.name ||
                                                                  "Family Member";
                                                            const hasMemCheckin =
                                                              mem &&
                                                              typeof mem ===
                                                                "object" &&
                                                              (typeof mem.is_checked_in ===
                                                                "boolean" ||
                                                                mem.checked_in_at !==
                                                                  undefined ||
                                                                Boolean(
                                                                  mem.checkin_status
                                                                ));
                                                            const memCheckedIn =
                                                              Boolean(
                                                                mem?.is_checked_in ||
                                                                  mem?.checked_in_at
                                                              );
                                                            const memChipLabel =
                                                              memCheckedIn
                                                                ? "Arrived"
                                                                : "Not yet arrived";

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
                                                                  <StatusPill
                                                                    variant={
                                                                      memCheckedIn
                                                                        ? "arrived"
                                                                        : "pending-arrival"
                                                                    }
                                                                    label={memChipLabel}
                                                                    className="bldg-pill-sm"
                                                                  />
                                                                )}
                                                              </div>
                                                            );
                                                          }
                                                        )}
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
  );

  if (usePublicMapShell) {
    return (
      <PublicMapDialogShell onClose={onClose} labelledBy="bldg-modal-title" hasHandle>
        {dialog}
      </PublicMapDialogShell>
    );
  }

  return (
    <div
      className="bldg-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      {dialog}
    </div>
  );
}

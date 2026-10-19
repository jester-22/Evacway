import { useState, useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api";
import { queryKeys, useBarangays, useRoomFamilies, useRooms } from "../hooks/useEvacuationQueries";
import LoadingState from "./LoadingState";
import BarangaysServedPicker from "./BarangaysServedPicker";
import { displayEntityName } from "../utils/displayEntityName";
import { formatRoomLabel } from "../utils/formatRoomLabel";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlus,
  faCheck,
  faXmark,
  faFloppyDisk,
  faPen,
  faUsers,
  faDrawPolygon,
  faDoorOpen,
  faHouseFlag,
  faLocationDot,
  faMagnifyingGlass,
  faTrash,
  faArrowLeft,
  faArrowRightArrowLeft,
  faUserMinus,
  faMap,
  faList,
  faCircleExclamation,
  faCircleCheck,
  faRotate,
  faTriangleExclamation,
  faSliders,
  faChevronDown,
  faChevronUp,
  faHand,
  faDownload,
  faPrint,
  faFileCsv,
  faBuilding,
} from "@fortawesome/free-solid-svg-icons";
import "../components_css/EvacuationCenterManager.css";

function getOccupancyStatus(occupied = 0, capacity = 0) {
  const cap = Number(capacity) || 0;
  const occ = Number(occupied) || 0;
  const percent = cap > 0 ? Math.min(100, Math.round((occ / cap) * 100)) : (occ > 0 ? 100 : 0);

  if (percent >= 90) {
    return {
      percent,
      color: "#dc2626", // Red: 90% and above
      barClass: "is-full",
      level: "full",
    };
  }
  if (percent >= 70) {
    return {
      percent,
      color: "#d97706", // Amber: 70% to 89%
      barClass: "is-high",
      level: "high",
    };
  }
  return {
    percent,
    color: "#16a34a", // Green: below 70%
    barClass: "is-low",
    level: "normal",
  };
}

function getOccupancyColor(occupied = 0, capacity = 0) {
  return getOccupancyStatus(occupied, capacity).color;
}

function RoomHouseholdsButton({ room, onClick, title }) {
  const occ = Number(room?.occupied || 0);
  const roomId = room?.id;
  const { data } = useRoomFamilies(occ > 0 && roomId ? roomId : null);
  const householdCount =
    occ === 0
      ? 0
      : data?.families
      ? data.families.length
      : (room?.assigned_families ?? 0);

  return (
    <button
      type="button"
      className="btn btn-sm btn-primary"
      onClick={onClick}
      title={title || "View households assigned to this room"}
    >
      <FontAwesomeIcon icon={faUsers} /> Households ({householdCount})
    </button>
  );
}

function isCenterMapped(item) {
  if (!item) return false;
  const geom = item.geometry || item.geom;
  if (geom && Array.isArray(geom.coordinates) && geom.coordinates.length > 0) {
    return true;
  }
  const props = item.properties || item;
  if (props.has_map !== undefined) {
    return Boolean(props.has_map);
  }
  return false;
}

function normalizeCenter(c) {
  if (!c) return null;
  if (c.properties) {
    return {
      ...c.properties,
      geometry: c.geometry,
    };
  }
  return c;
}

function EvacuationCenterManager({
  centers,
  hazardZones,
  onRefresh,
  canDeactivate = true,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const isLgu = location.pathname.startsWith("/lgu");
  const mapBasePath = isLgu ? "/lgu/map" : "/admin/map";

  // Center detail view section: "overview" | "rooms" | "households"
  const [centerSection, setCenterSection] = useState("overview");

  // Mobile filters bottom sheet
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // Multi-criteria filters
  const [searchQuery, setSearchQuery] = useState("");
  const [barangayFilter, setBarangayFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // "all" | "active" | "inactive"
  const [mappingFilter, setMappingFilter] = useState("all"); // "all" | "mapped" | "unmapped"
  const [occupancyFilter, setOccupancyFilter] = useState("all"); // "all" | "available" | "full"

  // Barangays
  const queryClient = useQueryClient();
  const barangaysQuery = useBarangays();
  const barangays = Array.isArray(barangaysQuery.data) ? barangaysQuery.data : [];

  // Active selections
  const [selectedCenter, setSelectedCenter] = useState(null);
  const centerRoomsQuery = useRooms(selectedCenter?.id);
  const centerRooms = centerRoomsQuery.data || [];
  const loadingRooms = centerRoomsQuery.isLoading;

  const [roomAssignmentFilter, setRoomAssignmentFilter] = useState("all"); // "all" | "assigned" | "unassigned"

  const assignedRoomCount = useMemo(() => {
    return centerRooms.filter((r) =>
      Boolean(r.is_assigned || r.assignment_status === "Assigned" || (r.occupied && r.occupied > 0))
    ).length;
  }, [centerRooms]);

  const unassignedRoomCount = Math.max(0, centerRooms.length - assignedRoomCount);

  const filteredCenterRooms = useMemo(() => {
    return centerRooms.filter((room) => {
      const isAssigned = Boolean(
        room.is_assigned ||
        room.assignment_status === "Assigned" ||
        (room.occupied && room.occupied > 0)
      );
      if (roomAssignmentFilter === "assigned") return isAssigned;
      if (roomAssignmentFilter === "unassigned") return !isAssigned;
      return true;
    });
  }, [centerRooms, roomAssignmentFilter]);

  const [selectedRoom, setSelectedRoom] = useState(null);
  const roomFamiliesQuery = useRoomFamilies(
    selectedRoom?.id && selectedRoom?.id !== "all" ? selectedRoom.id : null
  );
  const roomFamilies = roomFamiliesQuery.data?.families || [];
  const loadingRoomFamilies = roomFamiliesQuery.isLoading;

  // Center details query to fetch assigned_families across the whole center
  const centerDetailsQuery = useQuery({
    queryKey: ["evacuation-center-details", selectedCenter?.id],
    queryFn: () => api.getEvacuationCenter(selectedCenter.id),
    enabled: Boolean(selectedCenter?.id),
  });
  const allCenterFamilies = centerDetailsQuery.data?.assigned_families || [];
  const loadingAllCenterFamilies = centerDetailsQuery.isLoading;

  // Search filter inside Assigned Households tab
  const [householdSearch, setHouseholdSearch] = useState("");

  // Available unassigned families for assignment
  const [availableFamilies, setAvailableFamilies] = useState([]);
  const [loadingAvailableFamilies, setLoadingAvailableFamilies] = useState(false);

  // Alerts
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Modals state
  const [centerModalMode, setCenterModalMode] = useState(null); // 'add' | 'edit' | null
  const [centerForm, setCenterForm] = useState({
    name: "",
    barangay_ids: [],
    capacity: "",
    building_material: "",
    accessibility_notes: "",
    contact_number: "",
  });
  const [savingCenter, setSavingCenter] = useState(false);

  const [roomModalMode, setRoomModalMode] = useState(null); // 'add' | 'edit' | null
  const [roomForm, setRoomForm] = useState({
    room_number: "",
    capacity: "",
    barangay_id: "",
    latitude: "",
    longitude: "",
  });
  const [savingRoom, setSavingRoom] = useState(false);

  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [selectedFamilyIdToAssign, setSelectedFamilyIdToAssign] = useState("");
  const [assigningFamily, setAssigningFamily] = useState(false);

  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [movingFamily, setMovingFamily] = useState(null);
  const [targetCenterId, setTargetCenterId] = useState("");
  const [targetRoomId, setTargetRoomId] = useState("");
  const targetRoomsQuery = useRooms(targetCenterId ? Number(targetCenterId) : null);
  const targetCenterRooms = (targetRoomsQuery.data || []).filter(
    (room) => room.is_active !== false
  );
  const loadingTargetRooms = targetRoomsQuery.isLoading;
  const [moving, setMoving] = useState(false);

  // Confirmation dialog
  const [confirmDialog, setConfirmDialog] = useState(null);

  // Mapbox drawing states


  async function loadCenterRooms(centerId) {
    if (!centerId) return;
    try {
      await queryClient.invalidateQueries({ queryKey: queryKeys.rooms(centerId) });
    } catch (err) {
      console.error("Failed to load rooms:", err);
      setError(err.message || "Failed to load rooms.");
    }
  }

  async function invalidateCenterData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["evacuation-centers"] }),
      queryClient.invalidateQueries({ queryKey: ["evacuation-center-details"] }),
      queryClient.invalidateQueries({ queryKey: ["barangay-centers"] }),
      queryClient.invalidateQueries({ queryKey: ["rooms"] }),
      queryClient.invalidateQueries({ queryKey: ["room-families"] }),
    ]);
  }

  async function invalidateFamilyAssignments() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["families"] }),
      queryClient.invalidateQueries({ queryKey: ["rooms"] }),
      queryClient.invalidateQueries({ queryKey: ["room-families"] }),
      queryClient.invalidateQueries({ queryKey: ["evacuation-centers"] }),
      queryClient.invalidateQueries({ queryKey: ["evacuation-center-details"] }),
      queryClient.invalidateQueries({ queryKey: ["barangay-centers"] }),
    ]);
  }

  // Load available families when opening assign modal
  async function openAssignModal() {
    if (!selectedRoom) return;
    setAssignModalOpen(true);
    setSelectedFamilyIdToAssign("");
    setLoadingAvailableFamilies(true);
    setError("");
    try {
      const data = await api.getAvailableFamilies(selectedRoom.id);
      setAvailableFamilies(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load available families:", err);
      setError(err.message || "Failed to load available families.");
    } finally {
      setLoadingAvailableFamilies(false);
    }
  }

  // Target rooms for move modal
  async function handleTargetCenterChange(cId) {
    setTargetCenterId(cId);
    setTargetRoomId("");
  }

  function openMoveModal(family) {
    setMovingFamily(family);
    setTargetCenterId(selectedCenter ? String(selectedCenter.id) : "");
    setTargetRoomId("");
    setError("");
    setMoveModalOpen(true);
    if (selectedCenter?.id) {
      handleTargetCenterChange(String(selectedCenter.id));
    }
  }

  // --- Center Actions ---
  function openAddCenterModal() {
    setCenterForm({
      name: "",
      barangay_ids: [],
      capacity: "",
      building_material: "",
      accessibility_notes: "",
      contact_number: "",
    });
    setCenterModalMode("add");
    setError("");
  }

  function openEditCenterModal(center) {
    const props = center.properties || center;
    setCenterForm({
      name: props.name || "",
      barangay_ids: (props.barangays || []).map((barangay) => String(barangay.id)),
      capacity: props.capacity !== null && props.capacity !== undefined ? String(props.capacity) : "",
      building_material: props.building_material || "",
      accessibility_notes: props.accessibility_notes || "",
      contact_number: props.contact_number || "",
    });
    setSelectedCenter(normalizeCenter(center));
    setCenterModalMode("edit");
    setError("");
  }

  async function handleSaveCenter(e) {
    e.preventDefault();
    if (!centerForm.name.trim()) {
      setError("Evacuation center name is required.");
      return;
    }
    if (!centerForm.barangay_ids.length) {
      setError("Select at least one barangay served by this center.");
      return;
    }

    setSavingCenter(true);
    setError("");

    try {
      const payload = {
        name: centerForm.name.trim(),
        barangay_ids: centerForm.barangay_ids.map(Number),
        capacity: centerForm.capacity !== "" ? Number(centerForm.capacity) : null,
        building_material: centerForm.building_material.trim() || null,
        accessibility_notes: centerForm.accessibility_notes.trim() || null,
        contact_number: centerForm.contact_number.trim() || null,
      };

      if (centerModalMode === "add") {
        const created = await api.createEvacuationCenter(payload);
        setNotice(`Evacuation center "${payload.name}" created successfully.`);
        if (created?.data) {
          setSelectedCenter(normalizeCenter(created.data));
          setCenterSection("overview");
        }
      } else {
        await api.updateEvacuationCenter(selectedCenter.id, payload);
        setNotice(`Evacuation center "${payload.name}" updated successfully.`);
        setSelectedCenter((prev) => ({ ...prev, ...payload }));
      }

      setCenterModalMode(null);
      await invalidateCenterData();
    } catch (err) {
      setError(err.message || "Failed to save evacuation center.");
    } finally {
      setSavingCenter(false);
    }
  }

  function confirmToggleCenterActive(center) {
    const props = center.properties || center;
    const isCurrentlyActive = props.is_active;

    setConfirmDialog({
      title: `${isCurrentlyActive ? "Deactivate" : "Reactivate"} Evacuation Center`,
      message: isCurrentlyActive
        ? `Are you sure you want to deactivate "${props.name}"? Active room assignments will be verified before deactivation.`
        : `Reactivate evacuation center "${props.name}"?`,
      confirmText: isCurrentlyActive ? "Deactivate" : "Reactivate",
      danger: isCurrentlyActive,
      onConfirm: async () => {
        try {
          await api.toggleCenterActive(props.id);
          setNotice(`Evacuation center "${props.name}" ${isCurrentlyActive ? "deactivated" : "reactivated"}.`);
          if (selectedCenter && selectedCenter.id === props.id) {
            setSelectedCenter((prev) => ({ ...prev, is_active: !isCurrentlyActive }));
          }
          await invalidateCenterData();
        } catch (err) {
          setError(err.message || "Failed to toggle center active status.");
        }
      },
    });
  }

  function confirmDeleteCenter(center) {
    const props = center.properties || center;
    setConfirmDialog({
      title: "Delete Evacuation Center",
      message: `Are you sure you want to delete "${props.name}"? If there are assigned families, deletion will be blocked for safety.`,
      confirmText: "Delete Center",
      danger: true,
      onConfirm: async () => {
        try {
          await api.deleteEvacuationCenter(props.id);
          setNotice(`Evacuation center "${props.name}" removed/deactivated.`);
          if (selectedCenter && selectedCenter.id === props.id) {
            setSelectedCenter(null);
            setSelectedRoom(null);
          }
          await invalidateCenterData();
        } catch (err) {
          setError(err.message || "Failed to delete evacuation center.");
        }
      },
    });
  }

  // --- Room Actions ---
  function openAddRoomModal() {
    setRoomForm({
      room_number: "",
      capacity: "",
      latitude: "",
      longitude: "",
    });
    setRoomModalMode("add");
    setError("");
  }

  function openEditRoomModal(room) {
    setRoomForm({
      room_number: room.room_number || "",
      capacity: String(room.capacity || ""),
      latitude: room.latitude !== null && room.latitude !== undefined ? String(room.latitude) : "",
      longitude: room.longitude !== null && room.longitude !== undefined ? String(room.longitude) : "",
    });
    setSelectedRoom(room);
    setRoomModalMode("edit");
    setError("");
  }

  async function handleSaveRoom(e) {
    e.preventDefault();
    if (!roomForm.room_number.trim()) {
      setError("Room number is required.");
      return;
    }
    if (!roomForm.capacity || Number(roomForm.capacity) <= 0) {
      setError("Valid room capacity greater than 0 is required.");
      return;
    }

    setSavingRoom(true);
    setError("");

    try {
      const payload = {
        room_number: roomForm.room_number.trim(),
        capacity: Number(roomForm.capacity),
        latitude: roomForm.latitude ? Number(roomForm.latitude) : null,
        longitude: roomForm.longitude ? Number(roomForm.longitude) : null,
      };

      if (roomModalMode === "add") {
        await api.addRoom(selectedCenter.id, payload);
        setNotice(`${formatRoomLabel(payload.room_number)} added successfully.`);
      } else {
        await api.updateRoom(selectedRoom.id, payload);
        setNotice(`${formatRoomLabel(payload.room_number)} updated successfully.`);
        setSelectedRoom((prev) => (prev ? { ...prev, ...payload } : prev));
      }

      setRoomModalMode(null);
      await loadCenterRooms(selectedCenter.id);
    } catch (err) {
      setError(err.message || "Failed to save room.");
    } finally {
      setSavingRoom(false);
    }
  }

  function confirmToggleRoomActive(room) {
    const isCurrentlyActive = room.is_active;
    setConfirmDialog({
      title: `${isCurrentlyActive ? "Deactivate" : "Reactivate"} Room`,
      message: isCurrentlyActive
        ? `Are you sure you want to deactivate ${formatRoomLabel(room.room_number)}? Assigned families must be unassigned or moved first.`
        : `Reactivate ${formatRoomLabel(room.room_number)}?`,
      confirmText: isCurrentlyActive ? "Deactivate" : "Reactivate",
      danger: isCurrentlyActive,
      onConfirm: async () => {
        try {
          await api.toggleRoomActive(room.id);
          setNotice(`${formatRoomLabel(room.room_number)} ${isCurrentlyActive ? "deactivated" : "reactivated"}.`);
          await loadCenterRooms(selectedCenter.id);
          if (selectedRoom?.id === room.id) {
            setSelectedRoom((prev) => (prev ? { ...prev, is_active: !isCurrentlyActive } : prev));
          }
        } catch (err) {
          setError(err.message || "Failed to toggle room status.");
        }
      },
    });
  }

  function confirmDeleteRoom(room) {
    setConfirmDialog({
      title: "Delete Room",
      message: `Are you sure you want to delete ${formatRoomLabel(room.room_number)}? Deletion will be safely blocked if families are assigned.`,
      confirmText: "Delete Room",
      danger: true,
      onConfirm: async () => {
        try {
          await api.deleteRoom(room.id);
          setNotice(`${formatRoomLabel(room.room_number)} deleted/deactivated.`);
          if (selectedRoom?.id === room.id) {
            setSelectedRoom(null);
            setDrawerTab("rooms");
          }
          await loadCenterRooms(selectedCenter.id);
        } catch (err) {
          setError(err.message || "Failed to delete room.");
        }
      },
    });
  }

  // --- Assignment Actions ---
  async function handleConfirmAssignment() {
    if (!selectedFamilyIdToAssign) {
      setError("Please select a family to assign.");
      return;
    }

    const family = availableFamilies.find(
      (f) => String(f.id) === String(selectedFamilyIdToAssign)
    );
    if (!family) return;

    const remaining = selectedRoom.available ?? (selectedRoom.capacity - (selectedRoom.occupied || 0));
    const memberCount = family.member_count || family.family_members || 1;

    if (memberCount > remaining) {
      setError(`Cannot assign: Family has ${memberCount} members, but room only has ${remaining} spaces left.`);
      return;
    }

    setAssigningFamily(true);
    setError("");

    try {
      await api.assignFamily(family.id, {
        center_id: selectedCenter.id,
        room_id: selectedRoom.id,
      });

      setNotice(`Family "${family.household_head_name || family.head_name}" assigned to ${formatRoomLabel(selectedRoom.room_number)}.`);
      setAssignModalOpen(false);

      await invalidateFamilyAssignments();
    } catch (err) {
      setError(err.message || "Failed to assign family.");
    } finally {
      setAssigningFamily(false);
    }
  }

  async function handleConfirmMove() {
    if (!targetRoomId) {
      setError("Please select a destination room.");
      return;
    }

    const destRoom = targetCenterRooms.find((r) => String(r.id) === String(targetRoomId));
    if (!destRoom) return;

    const needed = movingFamily.assigned_members || movingFamily.family_members || movingFamily.member_count || 1;
    const destRemaining = destRoom.available ?? (destRoom.capacity - (destRoom.occupied || 0));

    if (needed > destRemaining) {
      setError(`Cannot move: Family needs ${needed} spaces, but target room only has ${destRemaining} available.`);
      return;
    }

    setConfirmDialog({
      title: "Confirm Family Transfer",
      message: `Move family "${movingFamily.household_head_name || movingFamily.head_name}" (${needed} members) to ${formatRoomLabel(destRoom.room_number)}? Occupancy will update automatically.`,
      confirmText: "Move Family",
      danger: false,
      onConfirm: async () => {
        setMoving(true);
        setError("");
        try {
          await api.moveFamily(movingFamily.family_id, {
            room_id: Number(targetRoomId),
            center_id: targetCenterId ? Number(targetCenterId) : undefined,
          });

          setNotice(`Family "${movingFamily.household_head_name || movingFamily.head_name}" moved to ${formatRoomLabel(destRoom.room_number)}.`);
          setMoveModalOpen(false);
          setMovingFamily(null);

          await invalidateFamilyAssignments();
        } catch (err) {
          setError(err.message || "Failed to move family.");
        } finally {
          setMoving(false);
        }
      },
    });
  }

  function confirmUnassignFamily(family) {
    const headName = family.household_head_name || family.head_name || "this family";
    const roomLabel = family.room_number
      ? formatRoomLabel(family.room_number)
      : selectedRoom && selectedRoom.id !== "all"
      ? formatRoomLabel(selectedRoom.room_number)
      : "their room";
    setConfirmDialog({
      title: "Remove Family Assignment",
      message: `Are you sure you want to remove family "${headName}" from ${roomLabel}? Their room occupancy will be freed.`,
      confirmText: "Remove Assignment",
      danger: true,
      onConfirm: async () => {
        try {
          await api.unassignFamily(family.family_id);
          setNotice(`Family "${headName}" unassigned successfully.`);
          await invalidateFamilyAssignments();
        } catch (err) {
          setError(err.message || "Failed to unassign family.");
        }
      },
    });
  }



  async function handleBeforeDeselectBarangay(barangayId, barangayName) {
    if (centerModalMode !== "edit" || !selectedCenter) return true;

    const breakdown = selectedCenter.barangay_breakdown || [];
    const row = breakdown.find((b) => String(b.id) === String(barangayId));
    const affectedHouseholds = row?.assigned_families ?? 0;
    const affectedPersons = row?.assigned ?? 0;

    if (affectedHouseholds > 0) {
      return new Promise((resolve) => {
        setConfirmDialog({
          title: "Remove Served Barangay?",
          message: `Removing "${barangayName}" will affect ${affectedHouseholds} household${affectedHouseholds > 1 ? "s" : ""} (${affectedPersons} person${affectedPersons !== 1 ? "s" : ""}) currently assigned to this center. Are you sure you want to remove it?`,
          confirmText: "Remove Barangay",
          danger: true,
          onConfirm: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
    }
    return true;
  }



  // --- Multi-Criteria Filters ---
  const centerFeatures = centers?.features || [];

  const filteredCenters = useMemo(() => {
    return centerFeatures.filter((item) => {
      const props = item.properties || item;
      const mapped = isCenterMapped(item);

      // Search (name, barangay, or contact)
      const q = searchQuery.trim().toLowerCase();
      const nameMatch =
        !q ||
        String(props.name || "").toLowerCase().includes(q) ||
        (props.barangays || []).some((barangay) =>
          String(barangay.name || "").toLowerCase().includes(q)
        ) ||
        String(props.contact_number || "").toLowerCase().includes(q);

      // Barangay filter
      const brgyMatch =
        !barangayFilter || (props.barangays || []).some(
          (barangay) => String(barangay.id) === String(barangayFilter)
        );

      // Status filter
      const statusMatch =
        statusFilter === "all" ||
        (statusFilter === "active" && Boolean(props.is_active)) ||
        (statusFilter === "inactive" && !props.is_active);

      // Mapping status filter
      const mappingMatch =
        mappingFilter === "all" ||
        (mappingFilter === "mapped" && mapped) ||
        (mappingFilter === "unmapped" && !mapped);

      // Occupancy status filter
      const cap = Number(props.capacity || 0);
      const occ = Number(props.occupied || props.current_occupancy || 0);
      const avail = Number(props.available ?? Math.max(cap - occ, 0));
      const occMatch =
        occupancyFilter === "all" ||
        (occupancyFilter === "available" && (cap === 0 || avail > 0)) ||
        (occupancyFilter === "full" && cap > 0 && avail <= 0);

      return nameMatch && brgyMatch && statusMatch && mappingMatch && occMatch;
    });
  }, [centerFeatures, searchQuery, barangayFilter, statusFilter, mappingFilter, occupancyFilter]);

  // Count unmapped centers in total dataset
  const unmappedCount = useMemo(() => {
    return centerFeatures.filter((c) => !isCenterMapped(c)).length;
  }, [centerFeatures]);

  // Maintain selected center validity when filters change
  useEffect(() => {
    if (selectedCenter) {
      const stillVisible = filteredCenters.some(
        (item) => String((item.properties || item).id) === String(selectedCenter.id)
      );
      if (!stillVisible) {
        setSelectedCenter(null);
        setSelectedRoom(null);
      }
    }
  }, [filteredCenters, selectedCenter]);

  const hasActiveFilters =
    Boolean(searchQuery.trim()) ||
    Boolean(barangayFilter) ||
    statusFilter !== "all" ||
    mappingFilter !== "all" ||
    occupancyFilter !== "all";

  const activeFilterCount =
    (searchQuery.trim() ? 1 : 0) +
    (barangayFilter ? 1 : 0) +
    (statusFilter !== "all" ? 1 : 0) +
    (mappingFilter !== "all" ? 1 : 0) +
    (occupancyFilter !== "all" ? 1 : 0);

  function clearFilters() {
    setSearchQuery("");
    setBarangayFilter("");
    setStatusFilter("all");
    setMappingFilter("all");
    setOccupancyFilter("all");
  }

  // Center metrics calculation
  const centerCapacity = selectedCenter?.capacity || 0;
  const centerOccupied = selectedCenter?.occupied || 0;
  const centerAvailable = selectedCenter?.available ?? Math.max(centerCapacity - centerOccupied, 0);
  const centerOccupancyStatus = getOccupancyStatus(centerOccupied, centerCapacity);
  const centerPercent = centerOccupancyStatus.percent;
  const centerProgressClass = centerOccupancyStatus.barClass;

  // Executive Municipal Overview Statistics
  const totalCenters = centerFeatures.length;
  const activeCentersCount = useMemo(
    () => centerFeatures.filter((c) => (c.properties || c).is_active).length,
    [centerFeatures]
  );
  const totalCapacity = useMemo(
    () => centerFeatures.reduce((acc, c) => acc + Number((c.properties || c).capacity || 0), 0),
    [centerFeatures]
  );
  const totalOccupied = useMemo(
    () =>
      centerFeatures.reduce(
        (acc, c) => acc + Number((c.properties || c).occupied || (c.properties || c).current_occupancy || 0),
        0
      ),
    [centerFeatures]
  );
  const totalAvailable = Math.max(0, totalCapacity - totalOccupied);
  const overallPercent = totalCapacity > 0 ? Math.round((totalOccupied / totalCapacity) * 100) : 0;
  const mappedCount = totalCenters - unmappedCount;

  // Tab 3: Evacuee list computation
  const currentFamiliesList = useMemo(() => {
    if (!selectedRoom || selectedRoom.id === "all") {
      return allCenterFamilies.length > 0 ? allCenterFamilies : roomFamilies;
    }
    return roomFamilies.length > 0
      ? roomFamilies
      : allCenterFamilies.filter((f) => String(f.room_id) === String(selectedRoom.id));
  }, [selectedRoom, allCenterFamilies, roomFamilies]);

  const filteredHouseholds = useMemo(() => {
    if (!householdSearch.trim()) return currentFamiliesList;
    const q = householdSearch.trim().toLowerCase();
    return currentFamiliesList.filter((fam) => {
      const head = String(fam.household_head_name || fam.head_name || "").toLowerCase();
      const code = String(fam.family_code || "").toLowerCase();
      const contact = String(fam.contact_number || "").toLowerCase();
      const rm = String(fam.room_number || "").toLowerCase();
      return head.includes(q) || code.includes(q) || contact.includes(q) || rm.includes(q);
    });
  }, [currentFamiliesList, householdSearch]);

  const totalFilteredPersons = useMemo(() => {
    return filteredHouseholds.reduce(
      (acc, f) => acc + Number(f.assigned_members || f.family_members || 1),
      0
    );
  }, [filteredHouseholds]);

  function exportCentersCsv() {
    const headers = [
      "Center ID",
      "Center Name",
      "Barangays Served",
      "Capacity",
      "Occupied",
      "Available Spaces",
      "Occupancy Rate (%)",
      "Operating Status",
      "GIS Status",
      "Contact Number",
      "Building Material",
      "Accessibility Notes",
    ];

    const escapeCell = (val) => {
      const str = val === null || val === undefined ? "" : String(val);
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows = filteredCenters.map((feature) => {
      const c = feature.properties || feature;
      const mapped = isCenterMapped(feature);
      const cap = Number(c.capacity || 0);
      const occ = Number(c.occupied || c.current_occupancy || 0);
      const avail = cap > 0 ? Math.max(cap - occ, 0) : 0;
      const pct = cap > 0 ? Math.round((occ / cap) * 100) : 0;
      const brgys = (c.barangays || []).map((b) => b.name).join("; ");

      return [
        c.id,
        c.name,
        brgys,
        cap,
        occ,
        avail,
        `${pct}%`,
        c.is_active ? "Active" : "Inactive",
        mapped ? "Mapped on GIS" : "Not Mapped",
        c.contact_number || "",
        c.building_material || "",
        c.accessibility_notes || "",
      ];
    });

    const csvContent = [
      headers.map(escapeCell).join(","),
      ...rows.map((r) => r.map(escapeCell).join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const dateStr = new Date().toISOString().split("T")[0];
    link.setAttribute("download", `Evacuation_Centers_Sogod_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function exportCenterEvacueesCsv() {
    if (!selectedCenter) return;
    const centerName = selectedCenter.name || "Center";
    const families = currentFamiliesList;

    const headers = [
      "Family ID",
      "Family Code",
      "Household Head",
      "Room Assigned",
      "Origin Barangay",
      "Members Sheltered",
      "Contact Number",
      "Evacuation Status",
    ];

    const escapeCell = (val) => {
      const str = val === null || val === undefined ? "" : String(val);
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows = families.map((fam) => [
      fam.family_id || fam.id || "",
      fam.family_code || "",
      fam.household_head_name || fam.head_name || "Unnamed",
      formatRoomLabel(fam.room_number) ||
        (selectedRoom && selectedRoom.id !== "all" ? formatRoomLabel(selectedRoom.room_number) : "—"),
      displayEntityName(fam.barangay, "—"),
      fam.assigned_members || fam.family_members || 1,
      fam.contact_number || "—",
      fam.evacuation_status || "Evacuated",
    ]);

    const csvContent = [
      headers.map(escapeCell).join(","),
      ...rows.map((r) => r.map(escapeCell).join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const dateStr = new Date().toISOString().split("T")[0];
    const safeName = centerName.replace(/[^a-zA-Z0-9_-]/g, "_");
    link.setAttribute("download", `Evacuee_Manifest_${safeName}_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function handlePrintManifest() {
    window.print();
  }

  function handleAssignHouseholdClick() {
    if (!selectedRoom || selectedRoom.id === "all") {
      const firstAvailable = centerRooms.find(
        (r) => r.is_active && (r.available ?? r.capacity - (r.occupied || 0)) > 0
      );
      if (firstAvailable) {
        setSelectedRoom(firstAvailable);
        setTimeout(() => openAssignModal(), 50);
      } else {
        setError(
          "All rooms in this evacuation center are at full capacity or inactive. Please create a new room or adjust room capacity."
        );
      }
    } else {
      openAssignModal();
    }
  }

  return (
    <div className="ecm-container in-list-view">
      <header className="ecm-top-bar">
        <div className="ecm-title-group">
          <h2>Evacuation Centers</h2>
          <p>Monitor center status, manage rooms and capacities, and assign displaced households.</p>
        </div>

        <div className="ecm-controls">
          {/* Mobile Filter Button (opens bottom sheet on mobile) */}
          <button
            type="button"
            className={`btn btn-secondary btn-icon ecm-filter-trigger ${hasActiveFilters ? "has-active" : ""}`}
            onClick={() => setMobileFiltersOpen(true)}
            title="Filter Centers"
            aria-label="Filter Centers"
          >
            <FontAwesomeIcon icon={faSliders} />
            {activeFilterCount > 0 && (
              <span className="ecm-filter-badge">{activeFilterCount}</span>
            )}
          </button>

          <button
            type="button"
            className="btn btn-primary ecm-add-btn"
            onClick={openAddCenterModal}
          >
            <FontAwesomeIcon icon={faPlus} /> <span className="ecm-btn-label">Add Center</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={exportCentersCsv}
            title="Export evacuation centers summary to CSV"
          >
            <FontAwesomeIcon icon={faDownload} /> <span className="ecm-btn-label">Export CSV</span>
          </button>

          {onRefresh && (
            <button
              type="button"
              className="btn btn-secondary btn-icon"
              onClick={onRefresh}
              title="Refresh Center Data"
              aria-label="Refresh Center Data"
            >
              <FontAwesomeIcon icon={faRotate} />
            </button>
          )}
        </div>
      </header>

      {/* =========================================================
          EXECUTIVE STAT CARDS (Overview of All Evacuation Centers)
          ========================================================= */}
      {!selectedCenter && (
        <div className="ecm-stats-grid">
          <button
            type="button"
            className={`ecm-stat-card ${!hasActiveFilters ? "is-selected" : ""}`}
            onClick={clearFilters}
            title="Click to show all evacuation centers"
          >
            <span className="ecm-stat-label">Total Centers</span>
            <strong className="ecm-stat-value">{totalCenters}</strong>
            <span className="ecm-stat-sub">Facilities in Sogod</span>
          </button>

          <button
            type="button"
            className={`ecm-stat-card accent-green ${statusFilter === "active" ? "is-selected" : ""}`}
            onClick={() => setStatusFilter(statusFilter === "active" ? "all" : "active")}
            title="Click to filter active/operational centers"
          >
            <span className="ecm-stat-label">Active Centers</span>
            <strong className="ecm-stat-value" style={{ color: "#16a34a" }}>
              {activeCentersCount}
            </strong>
            <span className="ecm-stat-sub">{totalCenters - activeCentersCount} inactive</span>
          </button>

          <div className="ecm-stat-card">
            <span className="ecm-stat-label">Total Capacity</span>
            <strong className="ecm-stat-value">{totalCapacity.toLocaleString()}</strong>
            <span className="ecm-stat-sub">Max evacuees supported</span>
          </div>

          <button
            type="button"
            className={`ecm-stat-card ${totalAvailable > 0 ? "accent-blue" : "accent-amber"} ${occupancyFilter !== "all" ? "is-selected" : ""}`}
            onClick={() => {
              if (occupancyFilter === "all") setOccupancyFilter("available");
              else if (occupancyFilter === "available") setOccupancyFilter("full");
              else setOccupancyFilter("all");
            }}
            title="Click to toggle Available vs Full centers"
          >
            <span className="ecm-stat-label">Sheltered / Vacant</span>
            <strong className="ecm-stat-value">
              <span style={{ color: "#2563eb" }}>{totalOccupied.toLocaleString()}</span>
              <span style={{ fontSize: 16, fontWeight: 500, color: "var(--muted)", margin: "0 4px" }}>/</span>
              <span style={{ color: totalAvailable > 0 ? "#16a34a" : "#dc2626" }}>
                {totalAvailable.toLocaleString()}
              </span>
            </strong>
            <span className="ecm-stat-sub">
              {overallPercent}% capacity ({occupancyFilter === "all" ? "All" : occupancyFilter === "available" ? "Filtered: Available" : "Filtered: Full"})
            </span>
          </button>

          <button
            type="button"
            className={`ecm-stat-card ${unmappedCount > 0 ? "accent-amber" : "accent-green"} ${mappingFilter === "unmapped" ? "is-selected" : ""}`}
            onClick={() => setMappingFilter(mappingFilter === "unmapped" ? "all" : "unmapped")}
            title={unmappedCount > 0 ? "Click to view centers needing GIS placement" : "All centers placed on map"}
          >
            <span className="ecm-stat-label">GIS Placement</span>
            <strong className="ecm-stat-value" style={{ color: unmappedCount > 0 ? "#d97706" : "#16a34a" }}>
              {unmappedCount > 0 ? `${unmappedCount} Unmapped` : "All Mapped"}
            </strong>
            <span className="ecm-stat-sub">
              {unmappedCount > 0 ? "Needs map boundary" : `${mappedCount} on GIS map`}
            </span>
          </button>
        </div>
      )}

      {/* =========================================================
          FILTER BAR (Search, Barangay, Status, Placement & Occupancy)
          ========================================================= */}
      <div className="ecm-filter-bar">
            <div className="ecm-search">
              <FontAwesomeIcon icon={faMagnifyingGlass} />
              <input
                type="text"
                placeholder="Search center name, barangay, or contact..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="ecm-search-clear"
                  onClick={() => setSearchQuery("")}
                  title="Clear search"
                  aria-label="Clear search"
                >
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              )}
            </div>

            <select
              className="ecm-select"
              value={barangayFilter}
              onChange={(e) => setBarangayFilter(e.target.value)}
              aria-label="Filter by Barangay"
            >
              <option value="">All Barangays</option>
              {barangays.map((b) => (
                <option key={b.id} value={b.id}>
                  {displayEntityName(b.name, `Barangay ${b.id}`)}
                </option>
              ))}
            </select>

            <select
              className="ecm-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter by Status"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active Only</option>
              <option value="inactive">Inactive Only</option>
            </select>

            <select
              className="ecm-select"
              value={mappingFilter}
              onChange={(e) => setMappingFilter(e.target.value)}
              aria-label="Filter by Map Placement"
            >
              <option value="all">All Placement</option>
              <option value="mapped">Mapped</option>
              <option value="unmapped">Not Mapped {unmappedCount > 0 ? `(${unmappedCount})` : ""}</option>
            </select>

            <select
              className="ecm-select"
              value={occupancyFilter}
              onChange={(e) => setOccupancyFilter(e.target.value)}
              aria-label="Filter by Occupancy"
            >
              <option value="all">All Capacities</option>
              <option value="available">Available Spaces</option>
              <option value="full">At Capacity / Full</option>
            </select>

            {hasActiveFilters && (
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={clearFilters}
                title="Reset all filters"
              >
                <FontAwesomeIcon icon={faXmark} /> Clear Filters
              </button>
            )}

            <div className="ecm-result-count">
              Showing <strong>{filteredCenters.length}</strong> of <strong>{centerFeatures.length}</strong> center{centerFeatures.length !== 1 ? "s" : ""}
            </div>
          </div>

          {/* ALERT BANNERS */}
          {(error || roomFamiliesQuery.error || notice) && (
            <div className="ecm-alerts">
              {(error || roomFamiliesQuery.error) && (
                <div className="alert alert-error" role="alert">
                  <FontAwesomeIcon icon={faCircleExclamation} />
                  <span style={{ flex: 1 }}>{error || roomFamiliesQuery.error.message}</span>
                  <button
                    type="button"
                    className="alert-dismiss"
                    onClick={() => setError("")}
                    aria-label="Dismiss error"
                  >
                    <FontAwesomeIcon icon={faXmark} />
                  </button>
                </div>
              )}

              {notice && (
                <div className="alert alert-success" role="status">
                  <FontAwesomeIcon icon={faCircleCheck} />
                  <span style={{ flex: 1 }}>{notice}</span>
                  <button
                    type="button"
                    className="alert-dismiss"
                    onClick={() => setNotice("")}
                    aria-label="Dismiss notice"
                  >
                    <FontAwesomeIcon icon={faXmark} />
                  </button>
                </div>
              )}
            </div>
          )}

      {/* =========================================================
          EVACUATION CENTERS DIRECTORY (List / Details)
          ========================================================= */}
      <div className="ecm-table-view">
          {selectedCenter ? (
            /* ---------------------------------------------------------
               CENTER DETAILS VIEW (Overview, Rooms, Assigned Households, Map)
               --------------------------------------------------------- */
            <div className="ecm-detail-view">
              {/* Breadcrumb & Navigation Actions */}
              <div className="ecm-detail-top-nav">
                <button
                  type="button"
                  className="ecm-back-btn"
                  onClick={() => {
                    setSelectedCenter(null);
                    setSelectedRoom(null);
                    setCenterSection("overview");
                  }}
                >
                  <FontAwesomeIcon icon={faArrowLeft} /> Back to Evacuation Centers
                </button>

                <div className="ecm-detail-nav-actions">
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={handlePrintManifest}
                    title="Print official evacuee manifest"
                  >
                    <FontAwesomeIcon icon={faPrint} /> Print Manifest
                  </button>

                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={exportCenterEvacueesCsv}
                    title="Export center evacuees to CSV"
                  >
                    <FontAwesomeIcon icon={faDownload} /> Export CSV
                  </button>

                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={() => openEditCenterModal(selectedCenter)}
                  >
                    <FontAwesomeIcon icon={faPen} /> Edit Center
                  </button>

                  {canDeactivate && (
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      onClick={() => confirmToggleCenterActive(selectedCenter)}
                    >
                      {selectedCenter.is_active ? "Deactivate" : "Activate"}
                    </button>
                  )}

                  {isCenterMapped(selectedCenter) ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={() => {
                          const cId = selectedCenter?.id || selectedCenter?.properties?.id;
                          navigate(`${mapBasePath}?center=${cId}`);
                        }}
                        title="View center on map"
                      >
                        <FontAwesomeIcon icon={faMap} /> View on Map
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={() => {
                          const cId = selectedCenter?.id || selectedCenter?.properties?.id;
                          navigate(`${mapBasePath}?center=${cId}&mode=place`);
                        }}
                        title="Edit building outline and entrances on map"
                      >
                        <FontAwesomeIcon icon={faDrawPolygon} /> Edit outline
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={() => {
                        const cId = selectedCenter?.id || selectedCenter?.properties?.id;
                        navigate(`${mapBasePath}?center=${cId}&mode=place`);
                      }}
                      title="Place center on map"
                    >
                      <FontAwesomeIcon icon={faDrawPolygon} /> Place on Map
                    </button>
                  )}

                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={() => confirmDeleteCenter(selectedCenter)}
                  >
                    <FontAwesomeIcon icon={faTrash} />
                  </button>
                </div>
              </div>

              {/* Center Title Card */}
              <div className="ecm-center-hero">
                <div className="ecm-center-hero-main">
                  <div className="ecm-center-title-row">
                    <h3>{selectedCenter.name}</h3>
                    <span className={`status-pill ${selectedCenter.is_active ? "is-active" : "is-inactive"}`}>
                      {selectedCenter.is_active ? "Active" : "Inactive"}
                    </span>
                    {isCenterMapped(selectedCenter) ? (
                      <span className="status-pill is-mapped">
                        <FontAwesomeIcon icon={faLocationDot} /> On Map
                      </span>
                    ) : (
                      <span className="status-pill is-unmapped">
                        <FontAwesomeIcon icon={faTriangleExclamation} /> Not Mapped
                      </span>
                    )}
                  </div>
                  <p className="ecm-center-subtitle">
                    {(selectedCenter.barangays || []).map((b) => displayEntityName(b.name, `Barangay ${b.id}`)).join(", ") || "No barangay assigned"}
                    {selectedCenter.contact_number ? ` • Contact: ${selectedCenter.contact_number}` : ""}
                  </p>
                </div>
              </div>

              {/* 4 Clear Section Tabs */}
              <div className="ecm-section-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={centerSection === "overview"}
                  className={`ecm-section-tab ${centerSection === "overview" ? "is-active" : ""}`}
                  onClick={() => setCenterSection("overview")}
                >
                  Overview
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={centerSection === "rooms"}
                  className={`ecm-section-tab ${centerSection === "rooms" ? "is-active" : ""}`}
                  onClick={() => setCenterSection("rooms")}
                >
                  Rooms ({centerRooms.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={centerSection === "households"}
                  className={`ecm-section-tab ${centerSection === "households" ? "is-active" : ""}`}
                  onClick={() => {
                    setCenterSection("households");
                    if (!selectedRoom) {
                      setSelectedRoom({ id: "all", room_number: "All Rooms" });
                    }
                  }}
                >
                  Assigned Households ({allCenterFamilies.length || centerOccupied})
                </button>

              </div>

              {/* Section 1: Overview */}
              {centerSection === "overview" && (
                <div className="ecm-tab-panel">
                  {/* Summary Strip */}
                  <div className="bm-summary-strip">
                    <div className="bm-summary-item">
                      <span className="bm-summary-label">Capacity</span>
                      <span className="bm-summary-val">{centerCapacity}</span>
                      <span className="bm-summary-sub">total people</span>
                    </div>
                    <div className="bm-summary-divider" />
                    <div className="bm-summary-item">
                      <span className="bm-summary-label">Total Assigned</span>
                      <span className="bm-summary-val" style={{ color: "#2563eb" }}>{centerOccupied}</span>
                      <span className="bm-summary-sub">{centerPercent}% of capacity</span>
                    </div>
                    <div className="bm-summary-divider" />
                    <div className="bm-summary-item">
                      <span className="bm-summary-label">Remaining Spaces</span>
                      <span className="bm-summary-val" style={{ color: getOccupancyColor(centerOccupied, centerCapacity) }}>
                        {centerAvailable}
                      </span>
                      <span className="bm-summary-sub">{centerAvailable > 0 ? "vacant spaces" : "full capacity"}</span>
                    </div>
                    <div className="bm-summary-divider" />
                    <div className="bm-summary-item">
                      <span className="bm-summary-label">Rooms</span>
                      <span className="bm-summary-val">{centerRooms.length}</span>
                      <span className="bm-summary-sub">registered rooms</span>
                    </div>
                  </div>

                  {/* Grid: Center Information + Capacity by Barangay */}
                  <div className="ecm-overview-grid">
                    <div className="ecm-card">
                      <h4 className="ecm-card-title">Center Details</h4>
                      <table className="ecm-info-table">
                        <tbody>
                          <tr>
                            <td>Barangays Served</td>
                            <td>
                              <div className="ecm-barangays-plain">
                                {(selectedCenter.barangays || []).map((b) => displayEntityName(b.name, `Barangay ${b.id}`)).join(", ") || "None assigned"}
                              </div>
                            </td>
                          </tr>
                          <tr>
                            <td>Contact Number</td>
                            <td>{selectedCenter.contact_number || "Not provided"}</td>
                          </tr>
                          <tr>
                            <td>Building Material</td>
                            <td>{selectedCenter.building_material || "Not recorded"}</td>
                          </tr>
                          <tr>
                            <td>Accessibility</td>
                            <td>{selectedCenter.accessibility_notes || "None noted"}</td>
                          </tr>
                          <tr>
                            <td>Map Location</td>
                            <td>
                              {isCenterMapped(selectedCenter) ? (
                                <span style={{ color: "#16a34a", fontWeight: 600 }}>
                                  <FontAwesomeIcon icon={faLocationDot} /> Placed on map
                                </span>
                              ) : (
                                <span style={{ color: "#d97706", fontWeight: 600 }}>
                                  <FontAwesomeIcon icon={faTriangleExclamation} /> Not mapped yet
                                </span>
                              )}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <div className="ecm-card">
                      <div className="ecm-card-header-row">
                        <h4 className="ecm-card-title" style={{ margin: 0 }}>Capacity by Barangay</h4>
                        <span className="ecm-card-subtitle">
                          {(selectedCenter.barangay_breakdown || []).length} registered {(selectedCenter.barangay_breakdown || []).length === 1 ? "barangay" : "barangays"}
                        </span>
                      </div>
                      <table className="ecm-breakdown-table">
                        <thead>
                          <tr>
                            <th style={{ width: "42%" }}>Barangay</th>
                            <th style={{ width: "18%", textAlign: "center" }}>Rooms</th>
                            <th style={{ width: "20%", textAlign: "right" }}>Assigned</th>
                            <th style={{ width: "20%", textAlign: "right" }}>Available</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(selectedCenter.barangay_breakdown || []).map((row) => {
                            const rowAssigned = row.assigned || 0;
                            const rowAvail = row.available || 0;
                            const rowCap = rowAssigned + rowAvail;
                            const rowColor = getOccupancyColor(rowAssigned, rowCap);

                            return (
                              <tr key={row.id}>
                                <td>
                                  <div className="ecm-brgy-cell" title={row.name}>
                                    <span
                                      className="ecm-brgy-dot"
                                      style={{ backgroundColor: row.color || "#2563eb" }}
                                    />
                                    <span className="ecm-brgy-name">
                                      {displayEntityName(row.name, `Barangay ${row.id}`)}
                                    </span>
                                  </div>
                                </td>
                                <td style={{ textAlign: "center" }}>
                                  <span className="ecm-rooms-pill">{row.rooms}</span>
                                </td>
                                <td style={{ textAlign: "right" }}>
                                  <strong style={{ color: "#2563eb" }}>{rowAssigned}</strong>
                                  {row.assigned_families > 0 && (
                                    <span className="ecm-sub-fams" style={{ display: "block" }}>
                                      {row.assigned_families} {row.assigned_families === 1 ? "household" : "households"}
                                    </span>
                                  )}
                                </td>
                                <td style={{ textAlign: "right" }}>
                                  <strong style={{ color: rowColor }}>
                                    {rowAvail}
                                  </strong>
                                </td>
                              </tr>
                            );
                          })}
                          {!selectedCenter.barangay_breakdown?.length && (
                            <tr>
                              <td colSpan="4" className="ecm-breakdown-empty-td">
                                No separate barangay allocation breakdown recorded.
                              </td>
                            </tr>
                          )}
                        </tbody>
                        {(selectedCenter.barangay_breakdown || []).length > 1 && (() => {
                          const totalRooms = (selectedCenter.barangay_breakdown || []).reduce((sum, r) => sum + (r.rooms || 0), 0);
                          const totalAssigned = (selectedCenter.barangay_breakdown || []).reduce((sum, r) => sum + (r.assigned || 0), 0);
                          const totalAvailable = (selectedCenter.barangay_breakdown || []).reduce((sum, r) => sum + (r.available || 0), 0);
                          const totalFamilies = (selectedCenter.barangay_breakdown || []).reduce((sum, r) => sum + (r.assigned_families || 0), 0);
                          const totalCap = totalAssigned + totalAvailable;
                          const totalColor = getOccupancyColor(totalAssigned, totalCap);

                          return (
                            <tfoot>
                              <tr className="ecm-breakdown-total-row">
                                <td><strong>Total</strong></td>
                                <td style={{ textAlign: "center" }}>
                                  <span className="ecm-rooms-pill">{totalRooms}</span>
                                </td>
                                <td style={{ textAlign: "right" }}>
                                  <strong style={{ color: "#2563eb" }}>{totalAssigned}</strong>
                                  {totalFamilies > 0 && (
                                    <span className="ecm-sub-fams" style={{ display: "block" }}>
                                      {totalFamilies} {totalFamilies === 1 ? "household" : "households"}
                                    </span>
                                  )}
                                </td>
                                <td style={{ textAlign: "right" }}>
                                  <strong style={{ color: totalColor }}>
                                    {totalAvailable}
                                  </strong>
                                </td>
                              </tr>
                            </tfoot>
                          );
                        })()}
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* Section 2: Rooms */}
              {centerSection === "rooms" && (
                <div className="ecm-tab-panel">
                  <div className="ecm-tab-header">
                    <div>
                      <h4 style={{ margin: 0 }}>Rooms in {selectedCenter.name}</h4>
                      <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--muted)" }}>
                        Manage room capacities, floor locations, and assigned occupants.
                      </p>
                    </div>
                    <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                      <select
                        value={roomAssignmentFilter}
                        onChange={(e) => setRoomAssignmentFilter(e.target.value)}
                        aria-label="Filter rooms by assignment status"
                        style={{
                          padding: "6px 12px",
                          borderRadius: "8px",
                          border: "1px solid var(--line, #cbd5e1)",
                          fontSize: "13px",
                          background: "#fff",
                          fontWeight: 500,
                        }}
                      >
                        <option value="all">All Rooms ({centerRooms.length})</option>
                        <option value="assigned">Assigned ({assignedRoomCount})</option>
                        <option value="unassigned">Unassigned ({unassignedRoomCount})</option>
                      </select>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={openAddRoomModal}
                      >
                        <FontAwesomeIcon icon={faPlus} /> Add Room
                      </button>
                    </div>
                  </div>

                  {loadingRooms ? (
                    <LoadingState message="Loading rooms..." />
                  ) : centerRooms.length === 0 ? (
                    <div className="empty-state">
                      <FontAwesomeIcon icon={faDoorOpen} style={{ fontSize: 32, marginBottom: 8, opacity: 0.6 }} />
                      <h4>No rooms added yet</h4>
                      <p>Click &ldquo;Add Room&rdquo; to register individual rooms inside this center.</p>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={openAddRoomModal}
                        style={{ marginTop: 10 }}
                      >
                        <FontAwesomeIcon icon={faPlus} /> Add Room
                      </button>
                    </div>
                  ) : filteredCenterRooms.length === 0 ? (
                    <div className="empty-state">
                      <FontAwesomeIcon icon={faDoorOpen} style={{ fontSize: 32, marginBottom: 8, opacity: 0.6 }} />
                      <h4>No rooms found</h4>
                      <p>No rooms match the selected assignment status ({roomAssignmentFilter === "assigned" ? "Assigned" : "Unassigned"}).</p>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setRoomAssignmentFilter("all")}
                        style={{ marginTop: 10 }}
                      >
                        Show All Rooms
                      </button>
                    </div>
                  ) : (
                    <div className="ecm-table-wrap">
                      <table className="ecm-table">
                        <thead>
                          <tr>
                            <th>Room</th>
                            <th>Capacity</th>
                            <th>Assigned Evacuees</th>
                            <th>Assignment Status</th>
                            <th style={{ textAlign: "right" }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredCenterRooms.map((room) => {
                            const rCap = room.capacity || 0;
                            const rOcc = room.occupied || 0;
                            const isRoomAssigned = Boolean(
                              room.is_assigned ||
                              room.assignment_status === "Assigned" ||
                              rOcc > 0
                            );

                            return (
                              <tr key={room.id}>
                                <td>
                                  <strong>{formatRoomLabel(room.room_number)}</strong>
                                  {!room.is_active && (
                                    <span className="status-pill is-inactive" style={{ marginLeft: 6, fontSize: 11 }}>
                                      Inactive
                                    </span>
                                  )}
                                  {room.latitude && room.longitude && (
                                    <div style={{ fontSize: 11, color: "var(--muted)" }}>
                                      <FontAwesomeIcon icon={faLocationDot} /> Pinned on map
                                    </div>
                                  )}
                                </td>
                                <td>{rCap} people</td>
                                <td>
                                  <strong style={{ color: rOcc > 0 ? "#2563eb" : "inherit" }}>
                                    {rOcc > 0 ? `${rOcc} people` : "None"}
                                  </strong>
                                </td>
                                <td>
                                  <span className={`status-pill ${isRoomAssigned ? "is-assigned" : "is-unassigned"}`}>
                                    {isRoomAssigned ? "Assigned" : "Unassigned"}
                                  </span>
                                </td>
                                <td>
                                  <div className="ecm-row-actions">
                                    <RoomHouseholdsButton
                                      room={room}
                                      onClick={() => {
                                        setSelectedRoom(room);
                                        setCenterSection("households");
                                      }}
                                      title="View households assigned to this room"
                                    />
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-secondary"
                                      onClick={() => openEditRoomModal(room)}
                                      title="Edit room capacity and details"
                                    >
                                      <FontAwesomeIcon icon={faPen} /> Edit
                                    </button>

                                    <button
                                      type="button"
                                      className="btn btn-sm btn-secondary"
                                      onClick={() => confirmToggleRoomActive(room)}
                                      title={room.is_active ? "Deactivate room" : "Activate room"}
                                    >
                                      {room.is_active ? "Deactivate" : "Activate"}
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-danger"
                                      onClick={() => confirmDeleteRoom(room)}
                                      title="Delete room"
                                    >
                                      <FontAwesomeIcon icon={faTrash} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Section 3: Assigned Households */}
              {centerSection === "households" && (
                <div className="ecm-tab-panel">
                  <div className="ecm-tab-header">
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", flex: 1 }}>
                      <label className="ecm-room-picker-label">
                        <span>Filter by Room:</span>
                        <select
                          className="ecm-select"
                          value={selectedRoom?.id || "all"}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === "all") {
                              setSelectedRoom({ id: "all", room_number: "All Rooms" });
                            } else {
                              const r = centerRooms.find((rm) => String(rm.id) === String(val));
                              setSelectedRoom(r || null);
                            }
                          }}
                        >
                          <option value="all">
                            All Rooms (Center Masterlist • {allCenterFamilies.length || centerOccupied} evacuees)
                          </option>
                          {centerRooms.map((r) => (
                            <option key={r.id} value={r.id}>
                              {formatRoomLabel(r.room_number)} ({r.occupied || 0}/{r.capacity} people)
                            </option>
                          ))}
                        </select>
                      </label>

                      <div className="ecm-search ecm-search-sm">
                        <FontAwesomeIcon icon={faMagnifyingGlass} />
                        <input
                          type="text"
                          placeholder="Search evacuees or code..."
                          value={householdSearch}
                          onChange={(e) => setHouseholdSearch(e.target.value)}
                        />
                        {householdSearch && (
                          <button
                            type="button"
                            className="ecm-search-clear"
                            onClick={() => setHouseholdSearch("")}
                            title="Clear search"
                          >
                            <FontAwesomeIcon icon={faXmark} />
                          </button>
                        )}
                      </div>

                      <span className="ecm-badge ecm-badge-blue">
                        {filteredHouseholds.length} Households • {totalFilteredPersons} Evacuees
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={handlePrintManifest}
                        title="Print Evacuee Manifest"
                      >
                        <FontAwesomeIcon icon={faPrint} /> Print Manifest
                      </button>

                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={exportCenterEvacueesCsv}
                        title="Export Center Evacuees to CSV"
                      >
                        <FontAwesomeIcon icon={faDownload} /> Export CSV
                      </button>

                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={handleAssignHouseholdClick}
                        title="Assign displaced household to room"
                      >
                        <FontAwesomeIcon icon={faPlus} /> Assign Household
                      </button>
                    </div>
                  </div>

                  {loadingRoomFamilies || loadingAllCenterFamilies ? (
                    <LoadingState message="Loading evacuee households..." />
                  ) : filteredHouseholds.length === 0 ? (
                    <div className="empty-state">
                      <FontAwesomeIcon icon={faUsers} style={{ fontSize: 32, marginBottom: 8, opacity: 0.6 }} />
                      <h4>
                        {householdSearch.trim()
                          ? "No evacuees match your search"
                          : selectedRoom && selectedRoom.id !== "all"
                          ? `No households assigned to ${formatRoomLabel(selectedRoom.room_number)}`
                          : "No households currently sheltered in this center"}
                      </h4>
                      <p>
                        {householdSearch.trim()
                          ? "Try checking the spelling or clearing the search filter."
                          : "This center has available space to shelter displaced residents."}
                      </p>
                      {householdSearch.trim() ? (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setHouseholdSearch("")}
                          style={{ marginTop: 10 }}
                        >
                          <FontAwesomeIcon icon={faXmark} /> Clear Search
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={handleAssignHouseholdClick}
                          style={{ marginTop: 10 }}
                        >
                          <FontAwesomeIcon icon={faPlus} /> Assign Household
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="ecm-table-wrap">
                      <table className="ecm-table">
                        <thead>
                          <tr>
                            <th>Household Head</th>
                            <th>Household ID</th>
                            {(!selectedRoom || selectedRoom.id === "all") && <th>Room</th>}
                            <th>Origin Barangay</th>
                            <th>Members Assigned</th>
                            <th>Contact</th>
                            <th style={{ textAlign: "right" }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredHouseholds.map((fam, idx) => {
                            const members = fam.assigned_members || fam.family_members || 1;
                            const head = fam.household_head_name || fam.head_name || "Unnamed Household";
                            const roomName = fam.room_number
                              ? formatRoomLabel(fam.room_number)
                              : selectedRoom && selectedRoom.id !== "all"
                              ? formatRoomLabel(selectedRoom.room_number)
                              : "—";

                            return (
                              <tr key={fam.family_id || fam.id || idx}>
                                <td>
                                  <strong>{head}</strong>
                                </td>
                                <td>
                                  <span className="ecm-code-badge">{fam.family_code || "—"}</span>
                                </td>
                                {(!selectedRoom || selectedRoom.id === "all") && (
                                  <td>
                                    <span className="ecm-rooms-pill">{roomName}</span>
                                  </td>
                                )}
                                <td>{displayEntityName(fam.barangay, "—")}</td>
                                <td>
                                  <strong style={{ color: "#2563eb" }}>{members}</strong>{" "}
                                  {members === 1 ? "person" : "people"}
                                </td>
                                <td>{fam.contact_number || "—"}</td>
                                <td>
                                  <div className="ecm-row-actions">
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-secondary"
                                      onClick={() => openMoveModal(fam)}
                                      title="Transfer household to another room or center"
                                    >
                                      <FontAwesomeIcon icon={faArrowRightArrowLeft} /> Move Room
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-danger"
                                      onClick={() => confirmUnassignFamily(fam)}
                                      title="Unassign household from room"
                                    >
                                      <FontAwesomeIcon icon={faUserMinus} /> Unassign
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              
            </div>
          ) : (
            /* ---------------------------------------------------------
               MAIN EVACUATION CENTERS TABLE (Default List View)
               --------------------------------------------------------- */
            <>
              {!centers ? (
                <LoadingState message="Loading evacuation centers..." />
              ) : filteredCenters.length === 0 ? (
                <div className="empty-state">
                  <FontAwesomeIcon icon={faHouseFlag} style={{ fontSize: 32, marginBottom: 8, opacity: 0.6 }} />
                  <h4 style={{ margin: "0 0 4px", fontSize: 16 }}>No evacuation centers match your filters</h4>
                  <p style={{ margin: 0, fontSize: 13 }}>
                    Try adjusting your search or filter options, or click &ldquo;Clear Filters&rdquo;.
                  </p>
                  {hasActiveFilters && (
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      style={{ marginTop: 10 }}
                      onClick={clearFilters}
                    >
                      <FontAwesomeIcon icon={faXmark} /> Reset Filters
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div className="ecm-table-wrap ecm-desktop-only">
                  <table className="ecm-table">
                    <thead>
                      <tr>
                        <th>Center Name</th>
                        <th>Barangay</th>
                        <th>Capacity</th>
                        <th>Occupancy</th>
                        <th>Status</th>
                        <th style={{ textAlign: "right" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCenters.map((feature) => {
                        const center = feature.properties || feature;
                        const mapped = isCenterMapped(feature);
                        const cap = center.capacity || 0;
                        const occ = center.occupied || center.current_occupancy || 0;
                        const pct = cap > 0 ? Math.min(100, Math.round((occ / cap) * 100)) : 0;
                        const isSelected = selectedCenter && String(selectedCenter.id) === String(center.id);

                        return (
                          <tr key={center.id} className={isSelected ? "is-selected" : ""}>
                            <td>
                              <div className="ecm-name-cell">
                                <strong>{center.name}</strong>
                                {!mapped && (
                                  <span className="status-pill is-unmapped" style={{ marginLeft: 6, fontSize: 11 }}>
                                    <FontAwesomeIcon icon={faTriangleExclamation} /> Not Mapped
                                  </span>
                                )}
                              </div>
                              {center.contact_number && (
                                <div style={{ fontSize: 11, color: "var(--muted)" }}>
                                  {center.contact_number}
                                </div>
                              )}
                            </td>
                            <td>
                              <div className="ecm-barangay-badges">
                                {(center.barangays || []).map((barangay) => (
                                  <span
                                    className="ecm-barangay-badge"
                                    key={barangay.id}
                                    style={{ "--barangay-color": barangay.color || "#2563eb" }}
                                  >
                                    {displayEntityName(barangay.name, `Barangay ${barangay.id}`)}
                                  </span>
                                ))}
                                {!center.barangays?.length && "—"}
                              </div>
                            </td>
                            <td>{cap ? `${cap} people` : "—"}</td>
                            <td>
                              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                <span>
                                  <strong style={{ color: occ > 0 ? "#2563eb" : "inherit" }}>
                                    {occ}
                                  </strong>{" "}
                                  of {cap} people <small style={{ color: "var(--muted)" }}>({pct}%)</small>
                                </span>
                                {cap > 0 && (() => {
                                  const occStatus = getOccupancyStatus(occ, cap);
                                  return (
                                    <div className="ecm-mini-progress">
                                      <div
                                        className={`ecm-mini-progress-fill ${occStatus.barClass}`}
                                        style={{ width: `${occStatus.percent}%`, backgroundColor: occStatus.color }}
                                      />
                                    </div>
                                  );
                                })()}
                              </div>
                            </td>
                            <td>
                              <span className={`status-pill ${center.is_active ? "is-active" : "is-inactive"}`}>
                                {center.is_active ? "Active" : "Inactive"}
                              </span>
                            </td>
                            <td>
                              <div className="ecm-row-actions">
                                <button
                                  type="button"
                                  className="btn btn-sm btn-primary"
                                  onClick={() => {
                                    setSelectedCenter(normalizeCenter(feature));
                                    setCenterSection("overview");
                                  }}
                                  title="View center details and room management"
                                >
                                  View Details
                                </button>

                                {mapped ? (
                                  <>
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-secondary"
                                      onClick={() => {
                                        const cId = center.id ?? feature.id;
                                        navigate(`${mapBasePath}?center=${cId}`);
                                      }}
                                      title="View on map"
                                    >
                                      <FontAwesomeIcon icon={faMap} /> Map
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-secondary"
                                      onClick={() => {
                                        const cId = center.id ?? feature.id;
                                        navigate(`${mapBasePath}?center=${cId}&mode=place`);
                                      }}
                                      title="Edit outline on map"
                                    >
                                      <FontAwesomeIcon icon={faDrawPolygon} /> Edit outline
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-secondary"
                                    onClick={() => {
                                      const cId = center.id ?? feature.id;
                                      navigate(`${mapBasePath}?center=${cId}&mode=place`);
                                    }}
                                    title="Set center coordinates on map"
                                  >
                                    <FontAwesomeIcon icon={faDrawPolygon} /> Place on Map
                                  </button>
                                )}

                                <button
                                  type="button"
                                  className="btn btn-sm btn-secondary"
                                  onClick={() => openEditCenterModal(feature)}
                                  title="Edit center properties"
                                >
                                  <FontAwesomeIcon icon={faPen} />
                                </button>

                                {canDeactivate && (
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-secondary"
                                    onClick={() => confirmToggleCenterActive(feature)}
                                    title={center.is_active ? "Deactivate" : "Activate"}
                                  >
                                    {center.is_active ? "Deactivate" : "Activate"}
                                  </button>
                                )}

                                <button
                                  type="button"
                                  className="btn btn-sm btn-danger"
                                  onClick={() => confirmDeleteCenter(feature)}
                                  title="Delete center"
                                >
                                  <FontAwesomeIcon icon={faTrash} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Stacked Center Cards (<= 768px) */}
                <div className="ecm-mobile-cards ecm-mobile-only">
                  {filteredCenters.map((feature) => {
                    const center = feature.properties || feature;
                    const mapped = isCenterMapped(feature);
                    const cap = center.capacity || 0;
                    const occ = center.occupied || center.current_occupancy || 0;
                    const pct = cap > 0 ? Math.min(100, Math.round((occ / cap) * 100)) : 0;
                    const bNames =
                      (center.barangays || [])
                        .map((b) => displayEntityName(b.name, `Barangay ${b.id}`))
                        .join(", ") || "No barangays assigned";

                    return (
                      <div key={center.id} className="ecm-mobile-center-card">
                        <div className="ecm-mobile-card-header">
                          <div>
                            <strong className="ecm-mobile-card-title">{center.name}</strong>
                            <div className="ecm-mobile-card-sub">{bNames}</div>
                          </div>
                          <span className={`status-pill ${center.is_active ? "is-active" : "is-inactive"}`}>
                            {center.is_active ? "Active" : "Inactive"}
                          </span>
                        </div>

                        <div className="ecm-mobile-card-stats">
                          <div className="ecm-mobile-card-stat">
                            <span>Occupancy</span>
                            <strong>
                              {occ} / {cap} ({pct}%)
                            </strong>
                          </div>
                          <div className="ecm-mobile-card-stat">
                            <span>Status</span>
                            <span className={mapped ? "ecm-mapped-text" : "ecm-unmapped-text"}>
                              {mapped ? "On Map" : "Not Mapped"}
                            </span>
                          </div>
                        </div>

                        {cap > 0 && (() => {
                          const occStatus = getOccupancyStatus(occ, cap);
                          return (
                            <div className="ecm-mini-progress" style={{ margin: "4px 0 8px" }}>
                              <div
                                className={`ecm-mini-progress-fill ${occStatus.barClass}`}
                                style={{ width: `${occStatus.percent}%`, backgroundColor: occStatus.color }}
                              />
                            </div>
                          );
                        })()}

                        <div className="ecm-mobile-card-actions">
                          <button
                            type="button"
                            className="btn btn-primary btn-sm ecm-touch-btn"
                            style={{ flex: 1, minHeight: 44 }}
                            onClick={() => {
                              setSelectedCenter(normalizeCenter(feature));
                              setCenterSection("overview");
                            }}
                          >
                            View Details
                          </button>
                          {mapped ? (
                            <>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm ecm-touch-btn"
                                style={{ minHeight: 44 }}
                                onClick={() => {
                                  const cId = center.id ?? feature.id;
                                  navigate(`${mapBasePath}?center=${cId}`);
                                }}
                                title="View on map"
                              >
                                <FontAwesomeIcon icon={faMap} /> Map
                              </button>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm ecm-touch-btn"
                                style={{ minHeight: 44 }}
                                onClick={() => {
                                  const cId = center.id ?? feature.id;
                                  navigate(`${mapBasePath}?center=${cId}&mode=place`);
                                }}
                                title="Edit outline on map"
                              >
                                <FontAwesomeIcon icon={faDrawPolygon} /> Edit outline
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm ecm-touch-btn"
                              style={{ minHeight: 44 }}
                              onClick={() => {
                                const cId = center.id ?? feature.id;
                                navigate(`${mapBasePath}?center=${cId}&mode=place`);
                              }}
                            >
                              <FontAwesomeIcon icon={faDrawPolygon} /> Place on Map
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm ecm-touch-btn"
                            style={{ minHeight: 44, padding: "0 14px" }}
                            onClick={() => openEditCenterModal(feature)}
                            title="Edit center"
                            aria-label="Edit center"
                          >
                            <FontAwesomeIcon icon={faPen} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            </>
          )}
        </div>

      {/* =========================================================
          MODALS (EvacWay Standard Dialogs)
          ========================================================= */}

      {/* ADD / EDIT CENTER MODAL */}
      {centerModalMode && (
        <div
          className="modal-overlay"
          onMouseDown={(e) => e.target === e.currentTarget && setCenterModalMode(null)}
        >
          <form className="modal-dialog" onSubmit={handleSaveCenter}>
            <div className="modal-header">
              <h3>{centerModalMode === "add" ? "Add Evacuation Center" : "Edit Evacuation Center"}</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setCenterModalMode(null)}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            <div className="modal-body">
              <div className="form-group">
                <label>Center Name *</label>
                <input
                  required
                  type="text"
                  className="form-input"
                  placeholder="e.g. Sogod Central Gymnasium"
                  value={centerForm.name}
                  onChange={(e) => setCenterForm({ ...centerForm, name: e.target.value })}
                />
              </div>

              <div className="form-group">
                <BarangaysServedPicker
                  barangays={barangays}
                  selectedIds={centerForm.barangay_ids}
                  onChange={(selectedIds) =>
                    setCenterForm((prev) => ({ ...prev, barangay_ids: selectedIds }))
                  }
                  onBeforeDeselect={handleBeforeDeselectBarangay}
                  required
                />
              </div>

              <div className="form-group">
                <label>Total Capacity <span>(Max evacuees)</span></label>
                <input
                  type="number"
                  min="0"
                  className="form-input"
                  placeholder="e.g. 250"
                  value={centerForm.capacity}
                  onChange={(e) => setCenterForm({ ...centerForm, capacity: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Building Material</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Reinforced Concrete"
                  value={centerForm.building_material}
                  onChange={(e) => setCenterForm({ ...centerForm, building_material: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Contact Number</label>
                <input
                  type="text"
                  maxLength={20}
                  className="form-input"
                  placeholder="e.g. 0917-123-4567"
                  value={centerForm.contact_number}
                  onChange={(e) => setCenterForm({ ...centerForm, contact_number: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Accessibility Notes</label>
                <textarea
                  className="form-textarea"
                  placeholder="Ramps available, emergency generator installed..."
                  value={centerForm.accessibility_notes}
                  onChange={(e) => setCenterForm({ ...centerForm, accessibility_notes: e.target.value })}
                />
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setCenterModalMode(null)}
                disabled={savingCenter}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={savingCenter}
              >
                <FontAwesomeIcon icon={faFloppyDisk} spin={savingCenter} />
                {savingCenter ? "Saving..." : centerModalMode === "add" ? "Create Center" : "Save Changes"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ADD / EDIT ROOM MODAL */}
      {roomModalMode && (
        <div
          className="modal-overlay"
          onMouseDown={(e) => e.target === e.currentTarget && setRoomModalMode(null)}
        >
          <form className="modal-dialog" onSubmit={handleSaveRoom}>
            <div className="modal-header">
              <h3>
                {roomModalMode === "add"
                  ? `Add Room to ${selectedCenter?.name}`
                  : `Edit ${formatRoomLabel(selectedRoom?.room_number)}`}
              </h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setRoomModalMode(null)}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            <div className="modal-body">
              <div className="form-group">
                <label>Room Number / Name *</label>
                <input
                  required
                  type="text"
                  className="form-input"
                  placeholder="e.g. Room 101, Ground Floor"
                  value={roomForm.room_number}
                  onChange={(e) => setRoomForm({ ...roomForm, room_number: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Room Capacity * <span>(Max people)</span></label>
                <input
                  required
                  type="number"
                  min="1"
                  className="form-input"
                  placeholder="e.g. 30"
                  value={roomForm.capacity}
                  onChange={(e) => setRoomForm({ ...roomForm, capacity: e.target.value })}
                />
                {roomModalMode === "edit" && selectedRoom?.occupied > 0 && (
                  <small style={{ color: "var(--muted)", fontSize: 11 }}>
                    Currently assigned: {selectedRoom.occupied}. Capacity cannot be less than this.
                  </small>
                )}
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setRoomModalMode(null)}
                disabled={savingRoom}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={savingRoom}
              >
                <FontAwesomeIcon icon={faFloppyDisk} spin={savingRoom} />
                {savingRoom ? "Saving..." : roomModalMode === "add" ? "Add Room" : "Save Changes"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ASSIGN FAMILY TO ROOM MODAL */}
      {assignModalOpen && selectedRoom && (
        <div
          className="modal-overlay"
          onMouseDown={(e) => e.target === e.currentTarget && setAssignModalOpen(false)}
        >
          <div className="modal-dialog">
            <div className="modal-header">
              <h3>Assign Family to {formatRoomLabel(selectedRoom.room_number)}</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setAssignModalOpen(false)}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            <div className="modal-body">
              <p style={{ fontSize: 12.5, color: "var(--muted)", margin: 0 }}>
                Select an unassigned registered family. EvacWay verifies capacity before allocating.
              </p>

              <div className="form-group">
                <label>Select Unassigned Family</label>
                <select
                  className="form-select"
                  value={selectedFamilyIdToAssign}
                  onChange={(e) => setSelectedFamilyIdToAssign(e.target.value)}
                  disabled={loadingAvailableFamilies}
                >
                  <option value="">
                    {loadingAvailableFamilies
                      ? "Loading unassigned families..."
                      : availableFamilies.length === 0
                      ? "No unassigned families available"
                      : "Choose family..."}
                  </option>
                  {availableFamilies.map((f) => (
                    <option key={f.id} value={f.id}>
                      {displayEntityName(f.household_head_name || f.head_name)} ({f.family_code}) · {f.member_count || f.family_members || 1} members · {f.barangay || "No barangay"}
                    </option>
                  ))}
                </select>
              </div>

              {/* LIVE CAPACITY & ASSIGNMENT VERIFICATION */}
              {(() => {
                const fam = availableFamilies.find(
                  (f) => String(f.id) === String(selectedFamilyIdToAssign)
                );
                const memCount = fam ? fam.member_count || fam.family_members || 1 : 0;
                const remaining = selectedRoom.available ?? (selectedRoom.capacity - (selectedRoom.occupied || 0));
                const remainingAfter = remaining - memCount;
                const isOverCapacity = fam && memCount > remaining;

                return (
                  <div className="ecm-preview-box">
                    <table className="ecm-info-table">
                      <tbody>
                        <tr>
                          <td>Evacuation Center</td>
                          <td>{selectedCenter?.name}</td>
                        </tr>
                        <tr>
                          <td>Room</td>
                          <td>{formatRoomLabel(selectedRoom.room_number)}</td>
                        </tr>
                        <tr>
                          <td>Room Capacity</td>
                          <td>{selectedRoom.capacity} people</td>
                        </tr>
                        <tr>
                          <td>Currently Assigned</td>
                          <td>{selectedRoom.occupied || 0} people</td>
                        </tr>
                        <tr>
                          <td>Remaining Capacity</td>
                          <td>
                            <strong style={{ color: getOccupancyColor(selectedRoom.occupied || 0, selectedRoom.capacity) }}>
                              {remaining} spaces
                            </strong>
                          </td>
                        </tr>
                        {fam && (
                          <>
                            <tr>
                              <td>Family Head</td>
                              <td>{fam.household_head_name || fam.head_name}</td>
                            </tr>
                            <tr>
                              <td>Members to Assign</td>
                              <td><strong style={{ color: "#1b5fc1" }}>{memCount} people</strong></td>
                            </tr>
                            <tr>
                              <td>Available After</td>
                              <td>
                                <strong style={{ color: isOverCapacity ? "#dc2626" : "#16a34a" }}>
                                  {remainingAfter} {isOverCapacity ? "(Exceeds Capacity!)" : "spaces"}
                                </strong>
                              </td>
                            </tr>
                          </>
                        )}
                      </tbody>
                    </table>

                    {isOverCapacity && (
                      <div className="alert alert-error" style={{ marginTop: 8 }}>
                        <FontAwesomeIcon icon={faCircleExclamation} />
                        <span>Cannot assign: Family has {memCount} members, but room only has {remaining} spaces available.</span>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setAssignModalOpen(false)}
                disabled={assigningFamily}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  !selectedFamilyIdToAssign ||
                  assigningFamily ||
                  (() => {
                    const fam = availableFamilies.find(
                      (f) => String(f.id) === String(selectedFamilyIdToAssign)
                    );
                    const memCount = fam ? fam.member_count || fam.family_members || 1 : 0;
                    const remaining = selectedRoom.available ?? (selectedRoom.capacity - (selectedRoom.occupied || 0));
                    return memCount > remaining;
                  })()
                }
                onClick={handleConfirmAssignment}
              >
                <FontAwesomeIcon icon={faCheck} spin={assigningFamily} />
                {assigningFamily ? "Assigning..." : "Confirm Assignment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MOVE FAMILY MODAL */}
      {moveModalOpen && movingFamily && (
        <div
          className="modal-overlay"
          onMouseDown={(e) => e.target === e.currentTarget && setMoveModalOpen(false)}
        >
          <div className="modal-dialog">
            <div className="modal-header">
              <h3>Move Family to Another Room / Center</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setMoveModalOpen(false)}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            <div className="modal-body">
              <div className="ecm-preview-box">
                <table className="ecm-info-table">
                  <tbody>
                    <tr>
                      <td>Family Head</td>
                      <td>{movingFamily.household_head_name || movingFamily.head_name}</td>
                    </tr>
                    <tr>
                      <td>Family Code</td>
                      <td>{movingFamily.family_code || `#${movingFamily.family_id}`}</td>
                    </tr>
                    <tr>
                      <td>Members</td>
                      <td>
                        <strong style={{ color: "#1b5fc1" }}>
                          {movingFamily.assigned_members || movingFamily.family_members || 1} people
                        </strong>
                      </td>
                    </tr>
                    <tr>
                      <td>Current Room</td>
                      <td>{selectedRoom ? formatRoomLabel(selectedRoom.room_number) : "Assigned"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="form-group">
                <label>Target Evacuation Center</label>
                <select
                  className="form-select"
                  value={targetCenterId}
                  onChange={(e) => handleTargetCenterChange(e.target.value)}
                >
                  <option value="">Select Destination Center...</option>
                  {(centers?.features || [])
                    .filter((c) => (c.properties || c).is_active)
                    .map((feature) => {
                      const c = feature.properties || feature;
                      const barangayNames = (c.barangays || []).map((barangay) => barangay.name).join(", ");
                      return (
                        <option key={c.id} value={c.id}>
                          {c.name} ({barangayNames || "No barangay"})
                        </option>
                      );
                    })
                    .filter((option) => option)}
                </select>
              </div>

              <div className="form-group">
                <label>Target Room</label>
                <select
                  className="form-select"
                  value={targetRoomId}
                  onChange={(e) => setTargetRoomId(e.target.value)}
                  disabled={!targetCenterId || loadingTargetRooms}
                >
                  <option value="">
                    {!targetCenterId
                      ? "Select a center first"
                      : loadingTargetRooms
                      ? "Loading destination rooms..."
                      : targetCenterRooms.length === 0
                      ? "No active rooms available in this center"
                      : "Select destination room..."}
                  </option>
                  {targetCenterRooms.map((r) => {
                    const isCurrent = selectedRoom && String(r.id) === String(selectedRoom.id);
                    return (
                      <option key={r.id} value={r.id} disabled={isCurrent}>
                        {formatRoomLabel(r.room_number)} · Capacity: {r.capacity} · Assigned: {r.occupied || 0} · Remaining: {r.available ?? (r.capacity - (r.occupied || 0))} {isCurrent ? "(Current)" : ""}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* TARGET ROOM CAPACITY VERIFICATION */}
              {(() => {
                const dest = targetCenterRooms.find((r) => String(r.id) === String(targetRoomId));
                if (!dest) return null;

                const needed = movingFamily.assigned_members || movingFamily.family_members || 1;
                const destRemaining = dest.available ?? (dest.capacity - (dest.occupied || 0));
                const remainingAfter = destRemaining - needed;
                const isOver = needed > destRemaining;

                return (
                  <div className="ecm-preview-box">
                    <table className="ecm-info-table">
                      <tbody>
                        <tr>
                          <td>Target Room Capacity</td>
                          <td>{dest.capacity} people</td>
                        </tr>
                        <tr>
                          <td>Target Available Spaces</td>
                          <td>
                            <strong style={{ color: getOccupancyColor(dest.occupied || 0, dest.capacity) }}>
                              {destRemaining} spaces
                            </strong>
                          </td>
                        </tr>
                        <tr>
                          <td>Remaining After Transfer</td>
                          <td>
                            <strong style={{ color: isOver ? "#dc2626" : "#16a34a" }}>
                              {remainingAfter} {isOver ? "(Exceeds Capacity!)" : "spaces"}
                            </strong>
                          </td>
                        </tr>
                      </tbody>
                    </table>

                    {isOver && (
                      <div className="alert alert-error" style={{ marginTop: 8 }}>
                        <FontAwesomeIcon icon={faCircleExclamation} />
                        <span>Cannot move: The target room does not have enough capacity for this family.</span>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setMoveModalOpen(false)}
                disabled={moving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  !targetRoomId ||
                  moving ||
                  (() => {
                    const dest = targetCenterRooms.find((r) => String(r.id) === String(targetRoomId));
                    if (!dest) return true;
                    const needed = movingFamily.assigned_members || movingFamily.family_members || 1;
                    const destRemaining = dest.available ?? (dest.capacity - (dest.occupied || 0));
                    return needed > destRemaining;
                  })()
                }
                onClick={handleConfirmMove}
              >
                <FontAwesomeIcon icon={faArrowRightArrowLeft} spin={moving} />
                {moving ? "Moving..." : "Confirm Move"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REUSABLE CONFIRMATION DIALOG */}
      {confirmDialog && (
        <div
          className="modal-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              const onCancel = confirmDialog.onCancel;
              setConfirmDialog(null);
              if (onCancel) onCancel();
            }
          }}
        >
          <div className="modal-dialog" style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <h3>{confirmDialog.title}</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => {
                  const onCancel = confirmDialog.onCancel;
                  setConfirmDialog(null);
                  if (onCancel) onCancel();
                }}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            <div className="modal-body">
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: "#374151" }}>
                {confirmDialog.message}
              </p>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  const onCancel = confirmDialog.onCancel;
                  setConfirmDialog(null);
                  if (onCancel) onCancel();
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`btn ${confirmDialog.danger ? "btn-danger" : "btn-primary"}`}
                onClick={async () => {
                  const action = confirmDialog.onConfirm;
                  setConfirmDialog(null);
                  if (action) await action();
                }}
              >
                {confirmDialog.confirmText || "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* =========================================================
          MOBILE FILTERS BOTTOM SHEET
          ========================================================= */}
      {mobileFiltersOpen && (
        <div
          className="ecm-bottom-sheet-overlay"
          onClick={() => setMobileFiltersOpen(false)}
        >
          <div
            className="ecm-bottom-sheet"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Filter Evacuation Centers"
          >
            <div className="ecm-sheet-header">
              <div className="ecm-sheet-title-wrap">
                <span className="ecm-sheet-handle" />
                <h3>Filter Centers</h3>
              </div>
              <button
                type="button"
                className="ecm-sheet-close"
                onClick={() => setMobileFiltersOpen(false)}
                aria-label="Close filters"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            <div className="ecm-sheet-body">
              <div className="ecm-sheet-field">
                <label>Search Query</label>
                <div className="ecm-search" style={{ maxWidth: "none", width: "100%" }}>
                  <FontAwesomeIcon icon={faMagnifyingGlass} />
                  <input
                    type="text"
                    placeholder="Search center name, barangay, or contact..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      className="ecm-search-clear"
                      onClick={() => setSearchQuery("")}
                    >
                      <FontAwesomeIcon icon={faXmark} />
                    </button>
                  )}
                </div>
              </div>

              <div className="ecm-sheet-field">
                <label>Barangay</label>
                <select
                  className="ecm-select"
                  value={barangayFilter}
                  onChange={(e) => setBarangayFilter(e.target.value)}
                >
                  <option value="">All Barangays</option>
                  {barangays.map((b) => {
                    const bName = typeof b === "string" ? b : b.name;
                    return (
                      <option key={b.id || bName} value={bName}>
                        {bName}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="ecm-sheet-field">
                <label>Operating Status</label>
                <select
                  className="ecm-select"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="all">All Statuses</option>
                  <option value="active">Active Only</option>
                  <option value="inactive">Inactive Only</option>
                </select>
              </div>

              <div className="ecm-sheet-field">
                <label>Map Placement</label>
                <select
                  className="ecm-select"
                  value={mappingFilter}
                  onChange={(e) => setMappingFilter(e.target.value)}
                >
                  <option value="all">All Placement Statuses</option>
                  <option value="mapped">Mapped on GIS</option>
                  <option value="unmapped">Not Mapped Yet ({unmappedCount})</option>
                </select>
              </div>

              <div className="ecm-sheet-field">
                <label>Occupancy & Space</label>
                <select
                  className="ecm-select"
                  value={occupancyFilter}
                  onChange={(e) => setOccupancyFilter(e.target.value)}
                >
                  <option value="all">All Capacities</option>
                  <option value="available">Available Spaces Only</option>
                  <option value="full">At Capacity / Full Only</option>
                </select>
              </div>
            </div>

            <div className="ecm-sheet-footer">
              {hasActiveFilters && (
                <button
                  type="button"
                  className="btn btn-secondary btn-touch"
                  onClick={clearFilters}
                >
                  Reset All
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary btn-touch"
                style={{ flex: 1, justifyContent: "center" }}
                onClick={() => setMobileFiltersOpen(false)}
              >
                Apply ({filteredCenters.length} centers)
              </button>
            </div>
          </div>
        </div>
      )}
      {/* =========================================================
          OFFICIAL PRINTABLE EVACUEE MANIFEST (DSWD / MDRRMO FORMAT)
          ========================================================= */}
      {selectedCenter && (
        <div className="ecm-printable-manifest" aria-hidden="true">
          <div className="ecm-print-header">
            <div className="ecm-print-logo-text">
              <h4>REPUBLIC OF THE PHILIPPINES</h4>
              <h5>PROVINCE OF SOUTHERN LEYTE • MUNICIPALITY OF SOGOD</h5>
              <h3>MUNICIPAL DISASTER RISK REDUCTION AND MANAGEMENT OFFICE (MDRRMO)</h3>
              <h2>OFFICIAL EVACUATION CENTER MASTERLIST & EVACUEE MANIFEST</h2>
            </div>
            <div className="ecm-print-date">
              Date Generated:{" "}
              {new Date().toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}
            </div>
          </div>

          <div className="ecm-print-meta-grid">
            <div className="ecm-print-meta-item">
              <span className="ecm-print-label">Evacuation Center:</span>
              <strong>{selectedCenter.name}</strong>
            </div>
            <div className="ecm-print-meta-item">
              <span className="ecm-print-label">Barangays Served:</span>
              <strong>
                {(selectedCenter.barangays || []).map((b) => b.name).join(", ") || "—"}
              </strong>
            </div>
            <div className="ecm-print-meta-item">
              <span className="ecm-print-label">Operating Status:</span>
              <strong>{selectedCenter.is_active ? "ACTIVE (Operational)" : "INACTIVE"}</strong>
            </div>
            <div className="ecm-print-meta-item">
              <span className="ecm-print-label">Contact / Focal Person:</span>
              <strong>{selectedCenter.contact_number || "Not provided"}</strong>
            </div>
            <div className="ecm-print-meta-item">
              <span className="ecm-print-label">Total Capacity:</span>
              <strong>{centerCapacity} persons</strong>
            </div>
            <div className="ecm-print-meta-item">
              <span className="ecm-print-label">Sheltered Evacuees:</span>
              <strong>
                {centerOccupied} persons ({centerPercent}% occupancy)
              </strong>
            </div>
            <div className="ecm-print-meta-item">
              <span className="ecm-print-label">Vacant Space:</span>
              <strong>{centerAvailable} persons</strong>
            </div>
            <div className="ecm-print-meta-item">
              <span className="ecm-print-label">Registered Rooms:</span>
              <strong>{centerRooms.length} rooms</strong>
            </div>
          </div>

          <div className="ecm-print-section-title">
            I. ROOM ALLOCATION & OCCUPANCY SUMMARY
          </div>
          <table className="ecm-print-table">
            <thead>
              <tr>
                <th>Room Number</th>
                <th>Designated Capacity</th>
                <th>Occupied Count</th>
                <th>Available Spaces</th>
                <th>Room Status</th>
              </tr>
            </thead>
            <tbody>
              {centerRooms.map((rm) => (
                <tr key={rm.id}>
                  <td>
                    <strong>{formatRoomLabel(rm.room_number)}</strong>
                  </td>
                  <td>{rm.capacity} persons</td>
                  <td>{rm.occupied || 0} persons</td>
                  <td>
                    {rm.available ?? Math.max(rm.capacity - (rm.occupied || 0), 0)} spaces
                  </td>
                  <td>{rm.is_active ? "Operational" : "Deactivated"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="ecm-print-section-title" style={{ marginTop: 20 }}>
            II. REGISTERED EVACUEE HOUSEHOLDS MANIFEST
          </div>
          <table className="ecm-print-table">
            <thead>
              <tr>
                <th style={{ width: 30 }}>#</th>
                <th>Household Head</th>
                <th>Family Code</th>
                <th>Room</th>
                <th>Origin Barangay</th>
                <th>Headcount</th>
                <th>Contact</th>
                <th>Remarks / Signature</th>
              </tr>
            </thead>
            <tbody>
              {(allCenterFamilies.length > 0 ? allCenterFamilies : roomFamilies).map((fam, idx) => (
                <tr key={fam.family_id || idx}>
                  <td>{idx + 1}</td>
                  <td>
                    <strong>{fam.household_head_name || fam.head_name || "—"}</strong>
                  </td>
                  <td>{fam.family_code || "—"}</td>
                  <td>{formatRoomLabel(fam.room_number) || "—"}</td>
                  <td>{displayEntityName(fam.barangay, "—")}</td>
                  <td>{fam.assigned_members || fam.family_members || 1}</td>
                  <td>{fam.contact_number || "—"}</td>
                  <td style={{ borderBottom: "1px dashed #cbd5e1" }}></td>
                </tr>
              ))}
              {allCenterFamilies.length === 0 && roomFamilies.length === 0 && (
                <tr>
                  <td colSpan="8" style={{ textAlign: "center", padding: 16 }}>
                    No evacuee households currently registered in this facility.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="ecm-print-sign-grid">
            <div className="ecm-print-sign-box">
              <p>Prepared by:</p>
              <div className="ecm-print-sign-line" />
              <strong>Camp Manager / Evacuation Center Desk Officer</strong>
              <span>Date: ________________________</span>
            </div>
            <div className="ecm-print-sign-box">
              <p>Certified & Noted by:</p>
              <div className="ecm-print-sign-line" />
              <strong>MDRRMO Incident Commander / LGU Official</strong>
              <span>Date: ________________________</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default EvacuationCenterManager;
import { useState, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api";
import { queryKeys, useBarangays, useRoomFamilies, useRooms } from "../hooks/useEvacuationQueries";
import DashboardMap from "./DashboardMap";
import LoadingState from "./LoadingState";
import BarangaysServedPicker from "./BarangaysServedPicker";
import { displayEntityName } from "../utils/displayEntityName";
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
} from "@fortawesome/free-solid-svg-icons";
import "../components_css/EvacuationCenterManager.css";

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

function polygonToPoints(geometry) {
  if (!geometry || !geometry.coordinates) return [];
  const ring = geometry.coordinates[0];
  if (!ring || ring.length < 4) return [];
  return ring.slice(0, ring.length - 1).map(([lng, lat]) => ({ lat, lng }));
}

function EvacuationCenterManager({
  centers,
  hazardZones,
  onRefresh,
  canDeactivate = true,
  focusLocation,
}) {
  // List-first by default: "table" | "map"
  const [viewMode, setViewMode] = useState("table");

  // Center detail view section: "overview" | "rooms" | "households" | "map"
  const [centerSection, setCenterSection] = useState("overview");

  // Drawer drilldown level inside map view: "center" | "rooms" | "families"
  const [drawerTab, setDrawerTab] = useState("center");
  const [drawerExpanded, setDrawerExpanded] = useState(false);

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

  const [selectedRoom, setSelectedRoom] = useState(null);
  const roomFamiliesQuery = useRoomFamilies(selectedRoom?.id);
  const roomFamilies = roomFamiliesQuery.data?.families || [];
  const loadingRoomFamilies = roomFamiliesQuery.isLoading;

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
  const [step, setStep] = useState("idle"); // "idle" | "footprint" | "entrance" | "room-map"
  const [footprintPoints, setFootprintPoints] = useState([]);
  const [entrancePoints, setEntrancePoints] = useState([]);
  const [editingCenter, setEditingCenter] = useState(null);
  const [roomLocation, setRoomLocation] = useState(null);
  const [savingRoomLocation, setSavingRoomLocation] = useState(false);
  const [savingMap, setSavingMap] = useState(false);

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
          setDrawerTab("center");
          setViewMode("map");
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
        setNotice(`Room "${payload.room_number}" added successfully.`);
      } else {
        await api.updateRoom(selectedRoom.id, payload);
        setNotice(`Room "${payload.room_number}" updated successfully.`);
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
        ? `Are you sure you want to deactivate Room "${room.room_number}"? Assigned families must be unassigned or moved first.`
        : `Reactivate Room "${room.room_number}"?`,
      confirmText: isCurrentlyActive ? "Deactivate" : "Reactivate",
      danger: isCurrentlyActive,
      onConfirm: async () => {
        try {
          await api.toggleRoomActive(room.id);
          setNotice(`Room "${room.room_number}" ${isCurrentlyActive ? "deactivated" : "reactivated"}.`);
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
      message: `Are you sure you want to delete Room "${room.room_number}"? Deletion will be safely blocked if families are assigned.`,
      confirmText: "Delete Room",
      danger: true,
      onConfirm: async () => {
        try {
          await api.deleteRoom(room.id);
          setNotice(`Room "${room.room_number}" deleted/deactivated.`);
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

      setNotice(`Family "${family.household_head_name || family.head_name}" assigned to Room ${selectedRoom.room_number}.`);
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
      message: `Move family "${movingFamily.household_head_name || movingFamily.head_name}" (${needed} members) to Room ${destRoom.room_number}? Occupancy will update automatically.`,
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

          setNotice(`Family "${movingFamily.household_head_name || movingFamily.head_name}" moved to Room ${destRoom.room_number}.`);
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
    setConfirmDialog({
      title: "Remove Family Assignment",
      message: `Are you sure you want to remove family "${headName}" from Room ${selectedRoom.room_number}? Their room occupancy will be freed.`,
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

  // --- Map Coordinates & Footprint Mapping ---
  function cancelMapping() {
    setStep("idle");
    setEditingCenter(null);
    setFootprintPoints([]);
    setEntrancePoints([]);
    setRoomLocation(null);
    setError("");
    setSavingMap(false);
    setSavingRoomLocation(false);
  }

  // Cleanup on unmount or when leaving map view
  useEffect(() => {
    return () => {
      cancelMapping();
    };
  }, []);

  useEffect(() => {
    if (viewMode !== "map" && step !== "idle") {
      cancelMapping();
    }
  }, [viewMode, step]);

  function startMappingCenterOnMap(center) {
    const props = center.properties || center;
    setEditingCenter(center);
    setFootprintPoints(polygonToPoints(center.geometry));
    setEntrancePoints(props.entrances || []);
    setViewMode("map");
    setStep("footprint");
  }

  function startMappingRoomLocation(room) {
    setSelectedRoom(room);
    setViewMode("map");
    setStep("room-map");
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

  async function handleSaveMapPlacement() {
    if (!editingCenter) return;
    setSavingMap(true);
    setError("");
    try {
      const centerId = editingCenter.properties?.id || editingCenter.id;
      await api.updateEvacuationCenter(centerId, {
        polygon: footprintPoints,
        entrances: entrancePoints,
      });
      setNotice("Evacuation center outline and entrances saved!");
      cancelMapping();
      await invalidateCenterData();
      await queryClient.invalidateQueries({ queryKey: queryKeys.evacuationCenters });
    } catch (err) {
      setError(err.message || "Failed to save center map location.");
    } finally {
      setSavingMap(false);
    }
  }

  async function handleSaveRoomMapLocation() {
    if (!roomLocation || !selectedRoom) return;
    setSavingRoomLocation(true);
    setError("");
    try {
      await api.updateRoomLocation(selectedRoom.id, {
        latitude: roomLocation.lat,
        longitude: roomLocation.lng,
      });
      setNotice(`Room ${selectedRoom.room_number} location saved!`);
      const cId = selectedCenter?.id;
      cancelMapping();
      if (cId) await loadCenterRooms(cId);
      await invalidateCenterData();
      await queryClient.invalidateQueries({ queryKey: queryKeys.evacuationCenters });
    } catch (err) {
      setError(err.message || "Failed to save room location.");
    } finally {
      setSavingRoomLocation(false);
    }
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

  // Keep the map synchronized with filtered features
  const filteredFeatureCollection = useMemo(() => ({
    type: "FeatureCollection",
    features: filteredCenters,
  }), [filteredCenters]);

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
        setDrawerTab("center");
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
  const centerPercent = centerCapacity > 0 ? Math.min(100, Math.round((centerOccupied / centerCapacity) * 100)) : 0;
  const centerProgressClass =
    centerPercent >= 90 ? "is-full" : centerPercent >= 60 ? "is-high" : "";

  return (
    <div className={`ecm-container ${viewMode === "map" ? "in-map-view" : "in-list-view"} ${step !== "idle" ? "in-mapping-mode" : ""}`}>
      {/* =========================================================
          TOP BAR (Focused Mapping Bar or Standard Navigation Bar)
          ========================================================= */}
      {step !== "idle" ? (
        <header className="ecm-mapping-top-bar">
          <div className="ecm-mapping-title">
            <strong>{editingCenter?.properties?.name || editingCenter?.name || selectedCenter?.name || "Evacuation Center"}</strong>
            <span className="ecm-mapping-step-chip">
              {step === "footprint"
                ? "Step 1: Outline"
                : step === "entrance"
                ? "Step 2: Entrances"
                : `Position Room ${selectedRoom?.room_number || ""}`}
            </span>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-secondary ecm-touch-btn"
            onClick={cancelMapping}
          >
            Cancel
          </button>
        </header>
      ) : (
        <header className="ecm-top-bar">
          <div className="ecm-title-group">
            <h2>Evacuation Centers</h2>
            <p>Monitor center status, manage rooms and capacities, and assign displaced households.</p>
          </div>

          <div className="ecm-controls">
            {/* Segmented View Switcher: List View (default) vs Map View */}
            <div className="ecm-view-switcher" role="group" aria-label="View Mode">
              <button
                type="button"
                className={`ecm-view-btn ${viewMode === "table" ? "is-active" : ""}`}
                onClick={() => {
                  setViewMode("table");
                  setSelectedCenter(null);
                  setSelectedRoom(null);
                }}
                title="List View"
              >
                <FontAwesomeIcon icon={faList} /> <span className="ecm-btn-label">List View</span>
              </button>
              <button
                type="button"
                className={`ecm-view-btn ${viewMode === "map" ? "is-active" : ""}`}
                onClick={() => {
                  setViewMode("map");
                  setSelectedCenter(null);
                  setSelectedRoom(null);
                  setDrawerTab("center");
                }}
                title="Map View"
              >
                <FontAwesomeIcon icon={faMap} /> <span className="ecm-btn-label">Map View</span>
              </button>
            </div>

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
      )}

      {/* Only show filter bar, unmapped banner, and alerts when idle (not actively mapping) */}
      {step === "idle" && (
        <>
          {/* =========================================================
              FILTER BAR (Search + at most 2 filters: Barangay & Status)
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
        </>
      )}

      {/* =========================================================
          VIEW MODE 1: MAP-FIRST (DEFAULT WEB-GIS WORKSPACE)
          ========================================================= */}
      {viewMode === "map" ? (
        <div className="ecm-map-workspace">
          {/* MAP CANVAS (Passed filtered feature collection and hides duplicate search) */}
          <DashboardMap
            centers={filteredFeatureCollection}
            hazardZones={hazardZones}
            hideInternalPanel={true}
            hideSearch={true}
            selectedCenter={selectedCenter}
            onCenterClick={(c) => {
              setSelectedCenter(normalizeCenter(c));
              setDrawerTab("center");
            }}
            drawMode={
              step === "footprint"
                ? "footprint"
                : step === "entrance"
                ? "entrance"
                : step === "room-map"
                ? "room"
                : "none"
            }
            onMapClick={(latlng) => {
              if (step === "footprint") {
                setFootprintPoints((pts) => [...pts, latlng]);
              } else if (step === "entrance") {
                setEntrancePoints((pts) => [...pts, latlng]);
              } else if (step === "room-map" && selectedRoom) {
                setRoomLocation(latlng);
              }
            }}
            pendingFootprint={footprintPoints}
            pendingEntrances={entrancePoints}
            rooms={centerRooms}
            onRoomClick={(r) => {
              setSelectedRoom(r);
              setDrawerTab("families");
            }}
            pendingRoomLocation={roomLocation}
            focusLocation={focusLocation}
          />

          {/* LOADING OVERLAY ON MAP */}
          {!centers && (
            <LoadingState overlay={true} message="Loading evacuation centers on map..." />
          )}



          {/* MAPPING FIXED BOTTOM DOCK BAR: SINGLE COMPACT GUIDE AND CONTROLS */}
          {step !== "idle" && (
            <div className="ecm-mapping-dock-bar">
              <div className="ecm-mapping-guide-line">
                <FontAwesomeIcon
                  icon={
                    step === "footprint"
                      ? faDrawPolygon
                      : step === "entrance"
                      ? faDoorOpen
                      : faLocationDot
                  }
                />
                <span>
                  {step === "footprint" &&
                    `Tap the map to draw building outline (${footprintPoints.length} points placed).`}
                  {step === "entrance" &&
                    `Tap the map to mark building entrances (${entrancePoints.length} placed).`}
                  {step === "room-map" &&
                    (roomLocation
                      ? `Room ${selectedRoom?.room_number || ""} placed (${roomLocation.lat.toFixed(4)}, ${roomLocation.lng.toFixed(4)}). Tap Save Room.`
                      : `Tap inside the building footprint to position Room ${selectedRoom?.room_number || ""}.`)}
                </span>
              </div>

              <div className="ecm-mapping-dock-actions">
                {step === "footprint" && (
                  <>
                    <button
                      type="button"
                      className="btn btn-secondary ecm-touch-btn"
                      onClick={cancelMapping}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary ecm-touch-btn"
                      onClick={() => setFootprintPoints((p) => p.slice(0, -1))}
                      disabled={!footprintPoints.length}
                    >
                      Undo
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary ecm-touch-btn"
                      onClick={() => setStep("entrance")}
                      disabled={footprintPoints.length < 3}
                    >
                      Next: Entrances
                    </button>
                  </>
                )}

                {step === "entrance" && (
                  <>
                    <button
                      type="button"
                      className="btn btn-secondary ecm-touch-btn"
                      onClick={cancelMapping}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary ecm-touch-btn"
                      onClick={() => setStep("footprint")}
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary ecm-touch-btn"
                      onClick={() => setEntrancePoints((p) => p.slice(0, -1))}
                      disabled={!entrancePoints.length}
                    >
                      Undo
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary ecm-touch-btn"
                      disabled={entrancePoints.length < 1 || savingMap}
                      onClick={handleSaveMapPlacement}
                    >
                      <FontAwesomeIcon icon={faFloppyDisk} spin={savingMap} /> Save Map
                    </button>
                  </>
                )}

                {step === "room-map" && selectedRoom && (
                  <>
                    <button
                      type="button"
                      className="btn btn-secondary ecm-touch-btn"
                      onClick={cancelMapping}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary ecm-touch-btn"
                      disabled={!roomLocation || savingRoomLocation}
                      onClick={handleSaveRoomMapLocation}
                    >
                      <FontAwesomeIcon icon={faFloppyDisk} spin={savingRoomLocation} /> Save Room
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* =========================================================
              FLOATING MAP DRAWER (CONNECTED TO MAP SELECTION)
              On mobile: functions as expandable bottom sheet
              ========================================================= */}
          {step === "idle" && selectedCenter && (
            <aside
              className={`ecm-map-drawer ${drawerExpanded ? "is-expanded" : "is-collapsed"}`}
              aria-label="Center details panel"
            >
              {/* Mobile grab handle to expand/collapse bottom sheet */}
              <div
                className="ecm-drawer-handle-bar"
                onClick={() => setDrawerExpanded((exp) => !exp)}
                role="button"
                tabIndex={0}
                aria-label={drawerExpanded ? "Collapse sheet" : "Expand sheet"}
              >
                <span className="ecm-drawer-handle" />
              </div>

              {/* DRAWER HEADER */}
              <div className="ecm-drawer-header">
                <div className="ecm-drawer-title-wrap">
                  <p className="ecm-drawer-subtitle">
                    {drawerTab === "families" && selectedRoom
                      ? `Room ${selectedRoom.room_number} Households`
                      : drawerTab === "rooms"
                      ? `${selectedCenter.name} Rooms`
                      : selectedCenter.barangay || "Evacuation Center"}
                  </p>
                  <h3 className="ecm-drawer-title">
                    {drawerTab === "families" && selectedRoom
                      ? `Assigned to Room ${selectedRoom.room_number}`
                      : selectedCenter.name}
                  </h3>
                </div>

                <div className="ecm-drawer-header-actions">
                  <button
                    type="button"
                    className="ecm-drawer-toggle-btn"
                    onClick={() => setDrawerExpanded((exp) => !exp)}
                    aria-label={drawerExpanded ? "Collapse" : "Expand"}
                    title={drawerExpanded ? "Collapse" : "Expand"}
                  >
                    <FontAwesomeIcon icon={drawerExpanded ? faChevronDown : faChevronUp} />
                  </button>

                  <button
                    type="button"
                    className="ecm-drawer-close-btn"
                    onClick={() => {
                      setSelectedCenter(null);
                      setSelectedRoom(null);
                      setDrawerTab("center");
                      setDrawerExpanded(false);
                    }}
                    aria-label="Close center panel"
                    title="Close panel"
                  >
                    <FontAwesomeIcon icon={faXmark} />
                  </button>
                </div>
              </div>

              {/* DRAWER BODY (DRILLDOWN LEVELS) */}
              <div className="ecm-drawer-body">
                {/* ---------------- LEVEL 1: CENTER DETAILS ---------------- */}
                {drawerTab === "center" && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
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

                    {!isCenterMapped(selectedCenter) && (
                      <div className="alert alert-warning" style={{ fontSize: 12 }}>
                        <FontAwesomeIcon icon={faTriangleExclamation} />
                        <span>This center is not placed on the map yet. Click &ldquo;Draw Outline&rdquo; below to mark its location.</span>
                      </div>
                    )}

                    {/* STATS GRID */}
                    <div className="ecm-stats-grid">
                      <div className="ecm-stat-box">
                        <strong>{centerCapacity}</strong>
                        <span>Capacity</span>
                      </div>
                      <div className="ecm-stat-box">
                        <strong style={{ color: "#2563eb" }}>{centerOccupied}</strong>
                        <span>Assigned</span>
                      </div>
                      <div className="ecm-stat-box">
                        <strong style={{ color: centerAvailable > 0 ? "#16a34a" : "#dc2626" }}>
                          {centerAvailable}
                        </strong>
                        <span>Remaining</span>
                      </div>
                    </div>

                    {/* OCCUPANCY BAR */}
                    {centerCapacity > 0 && (
                      <div className="ecm-progress-wrap">
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--muted)" }}>
                          <span>Assignment Rate</span>
                          <strong>{centerPercent}% ({centerOccupied} / {centerCapacity})</strong>
                        </div>
                        <div className="ecm-progress-bar">
                          <div
                            className={`ecm-progress-fill ${centerProgressClass}`}
                            style={{ width: `${centerPercent}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* CENTER DETAILS TABLE */}
                    <table className="ecm-info-table">
                      <tbody>
                        <tr>
                          <td>Barangays Served</td>
                          <td>
                            <div className="ecm-barangays-plain">
                              {(selectedCenter.barangays || []).map((b) => displayEntityName(b.name, `Barangay ${b.id}`)).join(", ") || "Not specified"}
                            </div>
                          </td>
                        </tr>
                        <tr>
                          <td>Map Location</td>
                          <td>
                            {isCenterMapped(selectedCenter) ? "Placed on map" : "Not mapped yet"}
                          </td>
                        </tr>
                        <tr>
                          <td>Rooms</td>
                          <td>{centerRooms.length} room{centerRooms.length !== 1 ? "s" : ""}</td>
                        </tr>
                        {selectedCenter.contact_number && (
                          <tr>
                            <td>Contact</td>
                            <td>{selectedCenter.contact_number}</td>
                          </tr>
                        )}
                        {selectedCenter.building_material && (
                          <tr>
                            <td>Building</td>
                            <td>{selectedCenter.building_material}</td>
                          </tr>
                        )}
                        {selectedCenter.accessibility_notes && (
                          <tr>
                            <td>Accessibility</td>
                            <td>{selectedCenter.accessibility_notes}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>

                    <div className="ecm-breakdown-wrap">
                      <h4 className="ecm-section-title">Capacity by Barangay</h4>
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
                          {(selectedCenter.barangay_breakdown || []).map((row) => (
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
                                <strong style={{ color: "#2563eb" }}>{row.assigned || 0}</strong>
                              </td>
                              <td style={{ textAlign: "right" }}>
                                <strong style={{ color: (row.available || 0) > 0 ? "#16a34a" : "#dc2626" }}>
                                  {row.available || 0}
                                </strong>
                              </td>
                            </tr>
                          ))}
                          {!selectedCenter.barangay_breakdown?.length && (
                            <tr>
                              <td colSpan="4" className="ecm-breakdown-empty-td">
                                No barangay allocation data available.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* MANAGE ROOMS ACTION TRIGGER */}
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ width: "100%", justifyContent: "center" }}
                      onClick={() => setDrawerTab("rooms")}
                    >
                      <FontAwesomeIcon icon={faDoorOpen} />
                      Manage Rooms ({centerRooms.length})
                    </button>
                  </>
                )}

                {/* ---------------- LEVEL 2: ROOMS LIST ---------------- */}
                {drawerTab === "rooms" && (
                  <>
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      style={{ alignSelf: "flex-start" }}
                      onClick={() => setDrawerTab("center")}
                    >
                      <FontAwesomeIcon icon={faArrowLeft} /> Back to Center Details
                    </button>

                    <div className="ecm-section-header">
                      <h4 className="ecm-section-title">
                        Rooms in {selectedCenter.name} ({centerRooms.length})
                      </h4>
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={openAddRoomModal}
                      >
                        <FontAwesomeIcon icon={faPlus} /> Add Room
                      </button>
                    </div>

                    {loadingRooms ? (
                      <LoadingState message="Loading rooms..." size="sm" />
                    ) : centerRooms.length === 0 ? (
                      <div className="empty-state">
                        <FontAwesomeIcon icon={faDoorOpen} style={{ fontSize: 24, marginBottom: 6, opacity: 0.6 }} />
                        <p style={{ margin: 0, fontWeight: 600 }}>No rooms created yet</p>
                        <p style={{ margin: "4px 0 10px", fontSize: 12 }}>
                          Click &ldquo;Add Room&rdquo; to create a room inside this evacuation center.
                        </p>
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={openAddRoomModal}
                        >
                          <FontAwesomeIcon icon={faPlus} /> Add Room
                        </button>
                      </div>
                    ) : (
                      <div className="ecm-room-list">
                        {centerRooms.map((room) => {
                          const rCap = room.capacity || 0;
                          const rOcc = room.occupied || 0;
                          const rAvail = room.available ?? Math.max(rCap - rOcc, 0);

                          return (
                            <div key={room.id} className="ecm-room-card">
                              <div className="ecm-room-card-head">
                                <strong>Room {room.room_number}</strong>
                                <span className={`status-pill ${room.is_active ? "is-active" : "is-inactive"}`}>
                                  {room.is_active ? "Active" : "Inactive"}
                                </span>
                              </div>

                              <div className="ecm-room-card-stats">
                                <span>Cap: <strong>{rCap}</strong></span>
                                <span>Occ: <strong style={{ color: "#2563eb" }}>{rOcc}</strong></span>
                                <span>
                                  Avail:{" "}
                                  <strong style={{ color: rAvail > 0 ? "#16a34a" : "#dc2626" }}>
                                    {rAvail}
                                  </strong>
                                </span>
                              </div>

                              <div className="ecm-room-card-actions">
                                <button
                                  type="button"
                                  className="btn btn-sm btn-primary"
                                  onClick={() => {
                                    setSelectedRoom(room);
                                    setDrawerTab("families");
                                  }}
                                  title="View and manage assigned households"
                                >
                                  <FontAwesomeIcon icon={faUsers} /> Households ({rOcc})
                                </button>

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
                                  onClick={() => startMappingRoomLocation(room)}
                                  title="Place room on map"
                                >
                                  <FontAwesomeIcon icon={faLocationDot} /> Map Pin
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
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}

                {/* ---------------- LEVEL 3: ASSIGNED HOUSEHOLDS ---------------- */}
                {drawerTab === "families" && selectedRoom && (
                  <>
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      style={{ alignSelf: "flex-start" }}
                      onClick={() => setDrawerTab("rooms")}
                    >
                      <FontAwesomeIcon icon={faArrowLeft} /> Back to Rooms
                    </button>

                    {/* ROOM OCCUPANCY RECAP */}
                    <div className="ecm-stat-box" style={{ textAlign: "left" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 12, color: "var(--muted)", textTransform: "none" }}>
                          Room {selectedRoom.room_number} Summary
                        </span>
                        <span className={`status-pill ${selectedRoom.is_active ? "is-active" : "is-inactive"}`}>
                          {selectedRoom.is_active ? "Active" : "Inactive"}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 14, marginTop: 6, fontSize: 13 }}>
                        <span>Capacity: <strong>{selectedRoom.capacity}</strong></span>
                        <span>Assigned: <strong style={{ color: "#2563eb" }}>{selectedRoom.occupied || 0}</strong></span>
                        <span>
                          Remaining:{" "}
                          <strong style={{ color: (selectedRoom.available ?? 0) > 0 ? "#16a34a" : "#dc2626" }}>
                            {selectedRoom.available ?? (selectedRoom.capacity - (selectedRoom.occupied || 0))}
                          </strong>
                        </span>
                      </div>
                    </div>

                    <div className="ecm-section-header">
                      <h4 className="ecm-section-title">
                        Assigned Households ({roomFamilies.length})
                      </h4>
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={openAssignModal}
                        disabled={!selectedRoom.is_active || (selectedRoom.available ?? 0) <= 0}
                        title={(selectedRoom.available ?? 0) <= 0 ? "Room is at capacity" : "Assign household"}
                      >
                        <FontAwesomeIcon icon={faPlus} /> Assign Household
                      </button>
                    </div>

                    {loadingRoomFamilies ? (
                      <LoadingState message="Loading assigned households..." size="sm" />
                    ) : roomFamilies.length === 0 ? (
                      <div className="empty-state">
                        <FontAwesomeIcon icon={faUsers} style={{ fontSize: 24, marginBottom: 6, opacity: 0.6 }} />
                        <p style={{ margin: 0, fontWeight: 600 }}>No households assigned</p>
                        <p style={{ margin: "4px 0 10px", fontSize: 12 }}>
                          This room currently has space for evacuees.
                        </p>
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={openAssignModal}
                          disabled={!selectedRoom.is_active || (selectedRoom.available ?? 0) <= 0}
                        >
                          <FontAwesomeIcon icon={faPlus} /> Assign Household
                        </button>
                      </div>
                    ) : (
                      <div className="ecm-family-list">
                        {roomFamilies.map((fam, idx) => {
                          const members = fam.assigned_members || fam.family_members || 1;
                          const head = fam.household_head_name || fam.head_name || "Unnamed Household";

                          return (
                            <div key={fam.family_id || idx} className="ecm-family-card">
                              <div className="ecm-family-card-head">
                                <div>
                                  <strong>{head}</strong>
                                  <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 6 }}>
                                    {fam.family_code ? `(${fam.family_code})` : ""}
                                  </span>
                                </div>
                                <span className="status-pill is-assigned">
                                  {members} member{members !== 1 ? "s" : ""}
                                </span>
                              </div>

                              <div className="ecm-family-meta">
                                <div>Barangay: <strong>{displayEntityName(fam.barangay, "—")}</strong></div>
                                {fam.contact_number && <div>Contact: {fam.contact_number}</div>}
                                {fam.address && <div>Address: {fam.address}</div>}
                              </div>

                              <div className="ecm-family-card-actions">
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
                                  title="Remove assignment and free capacity"
                                >
                                  <FontAwesomeIcon icon={faUserMinus} /> Remove
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* DRAWER FOOTER (QUICK CENTER ACTIONS) */}
              <div className="ecm-drawer-footer">
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={() => openEditCenterModal(selectedCenter)}
                >
                  <FontAwesomeIcon icon={faPen} /> Edit Center
                </button>

                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={() => startMappingCenterOnMap(selectedCenter)}
                  title="Draw building outline and entrances on map"
                >
                  <FontAwesomeIcon icon={faDrawPolygon} /> Draw Outline
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

                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  onClick={() => confirmDeleteCenter(selectedCenter)}
                >
                  <FontAwesomeIcon icon={faTrash} />
                </button>
              </div>
            </aside>
          )}
        </div>
      ) : (
        /* =========================================================
            VIEW MODE: LIST VIEW (PRIMARY WORKSPACE)
            ========================================================= */
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
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      onClick={() => {
                        setViewMode("map");
                        setDrawerTab("center");
                      }}
                    >
                      <FontAwesomeIcon icon={faMap} /> View on Map
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={() => startMappingCenterOnMap(selectedCenter)}
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
                    if (!selectedRoom && centerRooms.length > 0) {
                      setSelectedRoom(centerRooms[0]);
                    }
                  }}
                >
                  Assigned Households
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={centerSection === "map"}
                  className={`ecm-section-tab ${centerSection === "map" ? "is-active" : ""}`}
                  onClick={() => setCenterSection("map")}
                >
                  Map
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
                      <span className="bm-summary-val" style={{ color: centerAvailable > 0 ? "#16a34a" : "#dc2626" }}>
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
                          {(selectedCenter.barangay_breakdown || []).map((row) => (
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
                                <strong style={{ color: "#2563eb" }}>{row.assigned || 0}</strong>
                                {row.assigned_families > 0 && (
                                  <span className="ecm-sub-fams"> ({row.assigned_families}f)</span>
                                )}
                              </td>
                              <td style={{ textAlign: "right" }}>
                                <strong style={{ color: (row.available || 0) > 0 ? "#16a34a" : "#dc2626" }}>
                                  {row.available || 0}
                                </strong>
                              </td>
                            </tr>
                          ))}
                          {!selectedCenter.barangay_breakdown?.length && (
                            <tr>
                              <td colSpan="4" className="ecm-breakdown-empty-td">
                                No separate barangay allocation breakdown recorded.
                              </td>
                            </tr>
                          )}
                        </tbody>
                        {(selectedCenter.barangay_breakdown || []).length > 1 && (
                          <tfoot>
                            <tr className="ecm-breakdown-total-row">
                              <td><strong>Total</strong></td>
                              <td style={{ textAlign: "center" }}>
                                <span className="ecm-rooms-pill">
                                  {(selectedCenter.barangay_breakdown || []).reduce((sum, r) => sum + (r.rooms || 0), 0)}
                                </span>
                              </td>
                              <td style={{ textAlign: "right" }}>
                                <strong style={{ color: "#2563eb" }}>
                                  {(selectedCenter.barangay_breakdown || []).reduce((sum, r) => sum + (r.assigned || 0), 0)}
                                </strong>
                              </td>
                              <td style={{ textAlign: "right" }}>
                                <strong style={{ color: "#16a34a" }}>
                                  {(selectedCenter.barangay_breakdown || []).reduce((sum, r) => sum + (r.available || 0), 0)}
                                </strong>
                              </td>
                            </tr>
                          </tfoot>
                        )}
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
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={openAddRoomModal}
                    >
                      <FontAwesomeIcon icon={faPlus} /> Add Room
                    </button>
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
                  ) : (
                    <div className="ecm-table-wrap">
                      <table className="ecm-table">
                        <thead>
                          <tr>
                            <th>Room</th>
                            <th>Capacity</th>
                            <th>Occupancy</th>
                            <th>Available</th>
                            <th>Status</th>
                            <th style={{ textAlign: "right" }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {centerRooms.map((room) => {
                            const rCap = room.capacity || 0;
                            const rOcc = room.occupied || 0;
                            const rAvail = room.available ?? Math.max(rCap - rOcc, 0);

                            return (
                              <tr key={room.id}>
                                <td>
                                  <strong>Room {room.room_number}</strong>
                                  {room.latitude && room.longitude && (
                                    <div style={{ fontSize: 11, color: "var(--muted)" }}>
                                      <FontAwesomeIcon icon={faLocationDot} /> Pinned on map
                                    </div>
                                  )}
                                </td>
                                <td>{rCap} people</td>
                                <td>
                                  <strong style={{ color: rOcc > 0 ? "#2563eb" : "inherit" }}>{rOcc}</strong> people
                                </td>
                                <td>
                                  <strong style={{ color: rAvail > 0 ? "#16a34a" : "#dc2626" }}>
                                    {rAvail}
                                  </strong>{" "}
                                  spaces
                                </td>
                                <td>
                                  <span className={`status-pill ${room.is_active ? "is-active" : "is-inactive"}`}>
                                    {room.is_active ? "Active" : "Inactive"}
                                  </span>
                                </td>
                                <td>
                                  <div className="ecm-row-actions">
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-primary"
                                      onClick={() => {
                                        setSelectedRoom(room);
                                        setCenterSection("households");
                                      }}
                                      title="View households assigned to this room"
                                    >
                                      <FontAwesomeIcon icon={faUsers} /> Households ({rOcc})
                                    </button>
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
                                      onClick={() => startMappingRoomLocation(room)}
                                      title="Place room pin on map"
                                    >
                                      <FontAwesomeIcon icon={faLocationDot} /> Pin on Map
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
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      <label className="ecm-room-picker-label">
                        <span>Filter by Room:</span>
                        <select
                          className="ecm-select"
                          value={selectedRoom?.id || ""}
                          onChange={(e) => {
                            const r = centerRooms.find((rm) => String(rm.id) === String(e.target.value));
                            setSelectedRoom(r || null);
                          }}
                        >
                          {centerRooms.map((r) => (
                            <option key={r.id} value={r.id}>
                              Room {r.room_number} ({r.occupied || 0}/{r.capacity} people)
                            </option>
                          ))}
                        </select>
                      </label>
                      {selectedRoom && (
                        <span className="ecm-badge ecm-badge-blue">
                          Remaining: {selectedRoom.available ?? (selectedRoom.capacity - (selectedRoom.occupied || 0))} spaces
                        </span>
                      )}
                    </div>

                    {selectedRoom && (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={openAssignModal}
                        disabled={!selectedRoom.is_active || (selectedRoom.available ?? 0) <= 0}
                        title={(selectedRoom.available ?? 0) <= 0 ? "Room is at capacity" : "Assign household"}
                      >
                        <FontAwesomeIcon icon={faPlus} /> Assign Household
                      </button>
                    )}
                  </div>

                  {!selectedRoom ? (
                    <div className="empty-state">
                      <FontAwesomeIcon icon={faDoorOpen} style={{ fontSize: 32, marginBottom: 8, opacity: 0.6 }} />
                      <h4>Select a room to view assigned households</h4>
                      <p>Choose a room above to see evacuee occupants or assign a household.</p>
                    </div>
                  ) : loadingRoomFamilies ? (
                    <LoadingState message={`Loading households in Room ${selectedRoom.room_number}...`} />
                  ) : roomFamilies.length === 0 ? (
                    <div className="empty-state">
                      <FontAwesomeIcon icon={faUsers} style={{ fontSize: 32, marginBottom: 8, opacity: 0.6 }} />
                      <h4>No households assigned to Room {selectedRoom.room_number}</h4>
                      <p>This room has available space for displaced residents.</p>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={openAssignModal}
                        disabled={!selectedRoom.is_active || (selectedRoom.available ?? 0) <= 0}
                        style={{ marginTop: 10 }}
                      >
                        <FontAwesomeIcon icon={faPlus} /> Assign Household
                      </button>
                    </div>
                  ) : (
                    <div className="ecm-table-wrap">
                      <table className="ecm-table">
                        <thead>
                          <tr>
                            <th>Household Head</th>
                            <th>Household ID</th>
                            <th>Barangay</th>
                            <th>Members Assigned</th>
                            <th>Contact</th>
                            <th style={{ textAlign: "right" }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {roomFamilies.map((fam, idx) => {
                            const members = fam.assigned_members || fam.family_members || 1;
                            const head = fam.household_head_name || fam.head_name || "Unnamed Household";

                            return (
                              <tr key={fam.family_id || idx}>
                                <td>
                                  <strong>{head}</strong>
                                </td>
                                <td>
                                  <span className="ecm-code-badge">{fam.family_code || "—"}</span>
                                </td>
                                <td>{displayEntityName(fam.barangay, "—")}</td>
                                <td>
                                  <strong style={{ color: "#2563eb" }}>{members}</strong> {members === 1 ? "person" : "people"}
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

              {/* Section 4: Map */}
              {centerSection === "map" && (
                <div className="ecm-tab-panel" style={{ padding: 0 }}>
                  <div className="ecm-embedded-map-wrap" style={{ height: 500, position: "relative" }}>
                    <DashboardMap
                      centers={filteredFeatureCollection}
                      hazardZones={hazardZones}
                      hideInternalPanel={true}
                      hideSearch={true}
                      selectedCenter={selectedCenter}
                      drawMode={
                        step === "footprint"
                          ? "footprint"
                          : step === "entrance"
                          ? "entrance"
                          : step === "room-map"
                          ? "room"
                          : "none"
                      }
                      onMapClick={(latlng) => {
                        if (step === "footprint") {
                          setFootprintPoints((pts) => [...pts, latlng]);
                        } else if (step === "entrance") {
                          setEntrancePoints((pts) => [...pts, latlng]);
                        } else if (step === "room-map" && selectedRoom) {
                          setRoomLocation(latlng);
                        }
                      }}
                      pendingFootprint={footprintPoints}
                      pendingEntrances={entrancePoints}
                      rooms={centerRooms}
                      pendingRoomLocation={roomLocation}
                      focusLocation={focusLocation}
                    />
                  </div>
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
                        const avail = center.available ?? Math.max(cap - occ, 0);
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
                                {cap > 0 && (
                                  <div className="ecm-mini-progress">
                                    <div
                                      className={`ecm-mini-progress-fill ${pct >= 90 ? "is-full" : pct >= 60 ? "is-high" : ""}`}
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                )}
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
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-secondary"
                                    onClick={() => {
                                      setSelectedCenter(normalizeCenter(feature));
                                      setDrawerTab("center");
                                      setViewMode("map");
                                    }}
                                    title="View on map"
                                  >
                                    <FontAwesomeIcon icon={faMap} /> Map
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-secondary"
                                    onClick={() => startMappingCenterOnMap(feature)}
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

                        {cap > 0 && (
                          <div className="ecm-mini-progress" style={{ margin: "4px 0 8px" }}>
                            <div
                              className={`ecm-mini-progress-fill ${pct >= 90 ? "is-full" : pct >= 60 ? "is-high" : ""}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        )}

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
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm ecm-touch-btn"
                              style={{ minHeight: 44 }}
                              onClick={() => {
                                setSelectedCenter(normalizeCenter(feature));
                                setDrawerTab("center");
                                setViewMode("map");
                              }}
                            >
                              <FontAwesomeIcon icon={faMap} /> Map
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm ecm-touch-btn"
                              style={{ minHeight: 44 }}
                              onClick={() => startMappingCenterOnMap(feature)}
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
      )}

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
                  : `Edit Room ${selectedRoom?.room_number}`}
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
              <h3>Assign Family to Room {selectedRoom.room_number}</h3>
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
                          <td>Room {selectedRoom.room_number}</td>
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
                            <strong style={{ color: remaining > 0 ? "#16a34a" : "#dc2626" }}>
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
                      <td>{selectedRoom ? `Room ${selectedRoom.room_number}` : "Assigned"}</td>
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
                        Room {r.room_number} · Capacity: {r.capacity} · Assigned: {r.occupied || 0} · Remaining: {r.available ?? (r.capacity - (r.occupied || 0))} {isCurrent ? "(Current)" : ""}
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
                            <strong style={{ color: destRemaining > 0 ? "#16a34a" : "#dc2626" }}>
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
    </div>
  );
}

export default EvacuationCenterManager;
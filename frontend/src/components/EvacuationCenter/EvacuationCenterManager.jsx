import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../services/api";
import {
  queryKeys,
  useBarangays,
  useRoomFamilies,
  useRooms,
  useCenterBuildings,
} from "../../hooks/useEvacuationQueries";
import { displayEntityName } from "../../utils/displayEntityName";
import { formatRoomLabel } from "../../utils/formatRoomLabel";
import { useEscapeKey } from "./utils";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { getOccupancyStatus } from "./evacuationStatus";
import {
  faCircleExclamation,
  faCircleCheck,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import "./EvacuationCenterManager.css";

import CenterList from "./CenterList";
import CenterDetailPage from "./CenterDetail";
import { CenterFormModal, CenterRoomModal, AddBuildingModal, AssignFamilyModal, MoveFamilyModal, ConfirmCenterDialog } from "./CenterModals";

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

export default function EvacuationCenterManager({
  centers,
  onRefresh,
  canDeactivate = true,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const isLgu = location.pathname.startsWith("/lgu");
  const mapBasePath = isLgu ? "/lgu/map" : "/admin/map";

  const [centerSection, setCenterSection] = useState("overview");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [barangayFilter, setBarangayFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [mappingFilter, setMappingFilter] = useState("all");
  const [occupancyFilter, setOccupancyFilter] = useState("all");

  // Barangays
  const queryClient = useQueryClient();
  const barangaysQuery = useBarangays();
  const barangays = Array.isArray(barangaysQuery.data) ? barangaysQuery.data : [];

  // Active selections
  const [selectedCenter, setSelectedCenter] = useState(null);
  const centerRoomsQuery = useRooms(selectedCenter?.id);
  const centerRooms = centerRoomsQuery.data || [];

  // Buildings for this center (GeoJSON FeatureCollection -> normalized array)
  const centerBuildingsQuery = useCenterBuildings(selectedCenter?.id);
  const buildings = useMemo(() => {
    const data = centerBuildingsQuery.data;
    if (!data) return [];
    const features = Array.isArray(data?.features) ? data.features : (Array.isArray(data) ? data : []);
    return features.map((feature) => {
      const props = feature?.properties || feature;
      const id = props?.id ?? feature?.id;
      const name = props?.name || props?.display_label || `Building #${id}`;
      const is_mapped = Boolean(
        props?.is_mapped ||
        (feature?.geometry && feature.geometry.coordinates && feature.geometry.coordinates.length > 0)
      );
      return {
        id,
        name,
        notes: props?.notes || null,
        geometry: feature?.geometry || null,
        is_mapped,
        properties: props,
      };
    });
  }, [centerBuildingsQuery.data]);

  const [selectedRoom, setSelectedRoom] = useState(null);
  const roomFamiliesQuery = useRoomFamilies(
    selectedRoom?.id && selectedRoom?.id !== "all" ? selectedRoom.id : null
  );
  const roomFamilies = roomFamiliesQuery.data?.families || [];

  // Center details query to fetch assigned_families across the whole center
  const centerDetailsQuery = useQuery({
    queryKey: ["evacuation-center-details", selectedCenter?.id],
    queryFn: () => api.getEvacuationCenter(selectedCenter.id),
    enabled: Boolean(selectedCenter?.id),
  });
  const allCenterFamilies = centerDetailsQuery.data?.assigned_families || [];

  // Search filter inside Assigned Households tab

  // Available unassigned families for assignment
  const [availableFamilies, setAvailableFamilies] = useState([]);
  const [loadingAvailableFamilies, setLoadingAvailableFamilies] = useState(false);

  // Alerts
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Auto-dismiss floating notification toasts after 4.5 seconds
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(""), 4500);
    return () => clearTimeout(t);
  }, [error]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(t);
  }, [notice]);

  // Center modals
  const [centerModalMode, setCenterModalMode] = useState(null);
  const [centerForm, setCenterForm] = useState({
    name: "",
    barangay_ids: [],
    capacity: "",
    building_material: "",
    accessibility_notes: "",
    contact_number: "",
  });
  const [savingCenter, setSavingCenter] = useState(false);

  // Room modal
  const [roomModalMode, setRoomModalMode] = useState(null);
  const [roomForm, setRoomForm] = useState({
    room_number: "",
    capacity: "",
    building_id: "",
  });
  const [savingRoom, setSavingRoom] = useState(false);

  // Building modal
  const [buildingModalOpen, setBuildingModalOpen] = useState(false);
  const [buildingForm, setBuildingForm] = useState({ name: '', notes: '' });
  const [savingBuilding, setSavingBuilding] = useState(false);

  // Assign family modal
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [selectedFamilyIdToAssign, setSelectedFamilyIdToAssign] = useState("");
  const [assigningFamily, setAssigningFamily] = useState(false);

  // Move family modal
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

  // Escape closes the confirmation dialog (some confirm flows have no onCancel).
  useEscapeKey(confirmDialog != null, () => setConfirmDialog(null));

  // Mapbox drawing states (ref to avoid re-renders on URL sync)
  const handledUrlRef = useRef("");

  // Active building (kept for handleBack parity with previous behavior)

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

  async function openAssignModal(targetRoom = selectedRoom) {
    const isSingle = selectedCenter?.center_type === 'single_venue' || (!targetRoom && centerRooms.length === 0);
    if (!targetRoom && !isSingle) return;
    setAssignModalOpen(true);
    setSelectedFamilyIdToAssign("");
    setLoadingAvailableFamilies(true);
    setError("");
    try {
      const data = await api.getAvailableFamilies(targetRoom?.id, selectedCenter?.id);
      setAvailableFamilies(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load available families:", err);
      setError(err.message || "Failed to load available families.");
    } finally {
      setLoadingAvailableFamilies(false);
    }
  }

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
      center_type: "campus",
      building_material: "",
      amenity_ids: [],
      accessibility_feature_ids: [],
      accessibility_id: null,
      accessibility_notes: "",
      contact_number: "",
      owner_name: "",
      max_rooms: "",
    });
    setCenterModalMode("add");
    setError("");
  }

  function openEditCenterModal(center) {
    const props = center.properties || center;
    const featIds = props.amenity_ids || props.accessibility_feature_ids || (props.amenities || props.accessibility_features || []).map(f => f.id) || [];
    setCenterForm({
      name: props.name || "",
      barangay_ids: (props.barangays || []).map((barangay) => String(barangay.id)),
      capacity: props.capacity !== null && props.capacity !== undefined ? String(props.capacity) : "",
      center_type: props.center_type || "campus",
      center_type_id: props.center_type_id || 1,
      building_material: props.building_material || "",
      building_material_id: props.building_material_id || null,
      amenity_ids: featIds,
      accessibility_feature_ids: featIds,
      accessibility_notes: props.accessibility_notes || "",
      contact_number: props.contact_number || "",
      owner_name: props.owner_name || "",
      max_rooms: props.max_rooms ? String(props.max_rooms) : "",
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
        center_type: centerForm.center_type || "campus",
        center_type_id: centerForm.center_type_id || null,
        building_material: centerForm.building_material?.trim() || null,
        building_material_id: centerForm.building_material_id || null,
        amenity_ids: centerForm.amenity_ids || centerForm.accessibility_feature_ids || [],
        accessibility_feature_ids: centerForm.amenity_ids || centerForm.accessibility_feature_ids || [],
        accessibility_notes: centerForm.accessibility_notes?.trim() || null,
        contact_number: centerForm.contact_number?.trim() || null,
        owner_name: centerForm.owner_name?.trim() || null,
        max_rooms: centerForm.max_rooms ? Number(centerForm.max_rooms) : null,
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

  function openEditRoomModal(room) {
    setRoomForm({
      room_number: room.room_number || "",
      capacity: String(room.capacity || ""),
      building_id: room.building_id != null ? String(room.building_id) : "",
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
      const parsedBuildingId = roomForm.building_id !== "" ? Number(roomForm.building_id) : null;
      const payload = {
        room_number: roomForm.room_number.trim(),
        capacity: Number(roomForm.capacity),
        building_id: parsedBuildingId,
      };

      if (roomModalMode === "add") {
        const result = await api.addRoom(selectedCenter.id, payload);
        const createdRoomId = result?.room?.id ?? result?.id;
        if (parsedBuildingId && createdRoomId) {
          await api.updateBuilding(parsedBuildingId, { add_room_ids: [createdRoomId] });
        }
        setNotice(`${formatRoomLabel(payload.room_number)} added successfully.`);
      } else {
        const originalBuildingId = selectedRoom?.building_id != null ? String(selectedRoom.building_id) : "";
        const newBuildingId = parsedBuildingId != null ? String(parsedBuildingId) : "";
        await api.updateRoom(selectedRoom.id, payload);
        if (newBuildingId !== originalBuildingId) {
          if (newBuildingId !== "") {
            await api.updateBuilding(Number(newBuildingId), { add_room_ids: [selectedRoom.id] });
          } else if (originalBuildingId !== "") {
            await api.updateBuilding(Number(originalBuildingId), { remove_room_ids: [selectedRoom.id] });
          }
        }
        setNotice(`${formatRoomLabel(payload.room_number)} updated successfully.`);
        setSelectedRoom((prev) => (prev ? { ...prev, ...payload } : prev));
      }

      setRoomModalMode(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.rooms(selectedCenter.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.buildings(selectedCenter.id) }),
      ]);
    } catch (err) {
      setError(err.message || "Failed to save room.");
    } finally {
      setSavingRoom(false);
    }
  }

  async function handleSaveBuilding(e) {
    e.preventDefault();
    if (!buildingForm.name || !buildingForm.name.trim()) {
      setError('Building name is required.');
      return;
    }

    const cId = selectedCenter?.id || selectedCenter?.properties?.id;
    if (!cId) return;

    setSavingBuilding(true);
    setError('');

    try {
      await api.createBuilding(cId, {
        name: buildingForm.name.trim(),
        notes: buildingForm.notes.trim() || null,
      });
      setNotice(`Building "${buildingForm.name.trim()}" added successfully.`);
      setBuildingModalOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.buildings(cId) }),
        queryClient.invalidateQueries({ queryKey: ["evacuation-centers"] }),
        queryClient.invalidateQueries({ queryKey: ["evacuation-center-details"] }),
      ]);
    } catch (err) {
      setError(err.message || "Failed to add building.");
    } finally {
      setSavingBuilding(false);
    }
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
            setCenterSection("rooms");
          }
          await loadCenterRooms(selectedCenter.id);
        } catch (err) {
          setError(err.message || "Failed to delete room.");
        }
      },
    });
  }

  async function handleConfirmAssignment() {
    if (!selectedFamilyIdToAssign) {
      setError("Please select a family to assign.");
      return;
    }

    const family = availableFamilies.find(
      (f) => String(f.id) === String(selectedFamilyIdToAssign)
    );
    if (!family) return;

    const isSingle = selectedCenter?.center_type === 'single_venue' || (!selectedRoom && centerRooms.length === 0);
    const memberCount = family.member_count || family.family_members || 1;

    let remaining = 0;
    if (isSingle) {
      const assigned = Number(selectedCenter?.assigned ?? selectedCenter?.total_assigned ?? selectedCenter?.occupied ?? 0);
      remaining = Math.max((selectedCenter?.capacity || 0) - assigned, 0);
    } else if (selectedRoom) {
      remaining = selectedRoom.available ?? ((selectedRoom.capacity || 0) - (selectedRoom.occupied || 0));
    }

    if ((selectedCenter?.capacity || selectedRoom?.capacity) && remaining > 0 && memberCount > remaining) {
      setError(`Cannot assign: Family has ${memberCount} members, but only ${remaining} spaces left.`);
      return;
    }

    setAssigningFamily(true);
    setError("");

    try {
      await api.assignFamily(family.id, {
        center_id: selectedCenter.id,
        room_id: isSingle ? null : (selectedRoom?.id || null),
      });

      const locationLabel = (isSingle || !selectedRoom)
        ? (selectedCenter?.name || "the evacuation center")
        : formatRoomLabel(selectedRoom.room_number);

      setNotice(`Family "${family.household_head_name || family.head_name}" assigned to ${locationLabel}.`);
      setAssignModalOpen(false);

      await invalidateFamilyAssignments();
    } catch (err) {
      setError(err.message || "Failed to assign family.");
    } finally {
      setAssigningFamily(false);
    }
  }

  async function handleConfirmMove() {
    if (!targetRoomId) return;

    const dest = targetCenterRooms.find((r) => String(r.id) === String(targetRoomId));
    if (!dest) return;

    const needed = movingFamily.assigned_members || movingFamily.family_members || movingFamily.member_count || 1;
    const destRemaining = dest.available ?? (dest.capacity - (dest.occupied || 0));

    if (needed > destRemaining) {
      setError(`Cannot move: Family needs ${needed} spaces, but target room only has ${destRemaining} available.`);
      return;
    }

    setConfirmDialog({
      title: "Confirm Family Transfer",
      message: `Move family "${movingFamily.household_head_name || movingFamily.head_name}" (${needed} members) to ${formatRoomLabel(dest.room_number)}? Occupancy will update automatically.`,
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

          setNotice(`Family "${movingFamily.household_head_name || movingFamily.head_name}" moved to ${formatRoomLabel(dest.room_number)}.`);
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

      const q = searchQuery.trim().toLowerCase();
      const nameMatch =
        !q ||
        String(props.name || "").toLowerCase().includes(q) ||
        (props.barangays || []).some((barangay) =>
          String(barangay.name || "").toLowerCase().includes(q)
        ) ||
        String(props.contact_number || "").toLowerCase().includes(q);

      const brgyMatch =
        !barangayFilter ||
        (props.barangays || []).some((barangay) => String(barangay.id) === String(barangayFilter));

      const statusMatch =
        statusFilter === "all" ||
        (statusFilter === "active" && Boolean(props.is_active)) ||
        (statusFilter === "inactive" && !props.is_active);

      const mappingMatch =
        mappingFilter === "all" ||
        (mappingFilter === "mapped" && mapped) ||
        (mappingFilter === "unmapped" && !mapped);

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

  const unmappedCount = useMemo(() => {
    return centerFeatures.filter((c) => !isCenterMapped(c)).length;
  }, [centerFeatures]);

  useEffect(() => {
    if (selectedCenter) {
      const stillVisible = filteredCenters.some(
        (item) => String((item.properties || item).id) === String(selectedCenter.id)
      );
      if (!stillVisible) {
        setTimeout(() => {
          setSelectedRoom(null);
          setSelectedCenter(null);
        }, 0);
      }
    }
  }, [filteredCenters, selectedCenter]);

  const hasActiveFilters =
    Boolean(searchQuery.trim()) ||
    Boolean(barangayFilter) ||
    statusFilter !== "all" ||
    mappingFilter !== "all" ||
    occupancyFilter !== "all";

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
  const centerAssigned = Number(selectedCenter?.assigned ?? selectedCenter?.total_assigned ?? 0);
  const centerAvailable = selectedCenter?.available ?? Math.max(centerCapacity - centerOccupied, 0);
  const centerBuildingCount = Number(selectedCenter?.building_count || 0);
  const centerOccupancyStatus = getOccupancyStatus(centerOccupied, centerCapacity);
  const centerPercent = centerOccupancyStatus.percent;

  // Executive Municipal Overview Statistics
  // Tab 3: Evacuee list computation


  function handleAssignHouseholdClick() {
    const isSingle = selectedCenter?.center_type === 'single_venue' || centerRooms.length === 0;
    if (isSingle) {
      const assigned = Number(selectedCenter?.assigned ?? selectedCenter?.total_assigned ?? selectedCenter?.occupied ?? 0);
      const remaining = Math.max((selectedCenter?.capacity || 0) - assigned, 0);
      if ((selectedCenter?.capacity || 0) > 0 && remaining <= 0) {
        setError("This evacuation center is at full capacity.");
        return;
      }
      setSelectedRoom(null);
      openAssignModal(null);
      return;
    }

    if (!selectedRoom || selectedRoom.id === "all") {
      const firstAvailable = centerRooms.find(
        (r) => r.is_active && (r.available ?? r.capacity - (r.occupied || 0)) > 0
      );
      if (firstAvailable) {
        setSelectedRoom(firstAvailable);
        openAssignModal(firstAvailable);
      } else {
        setError(
          "All rooms in this evacuation center are at full capacity or inactive. Please create a new room or adjust room capacity."
        );
      }
    } else {
      openAssignModal(selectedRoom);
    }
  }

  function handleBack() {
    setSelectedCenter(null);
    setSelectedRoom(null);
    setCenterSection("buildings");
    handledUrlRef.current = "";
    const nextSearch = new URLSearchParams(location.search);
    nextSearch.delete("center");
    nextSearch.delete("subtab");
    nextSearch.delete("view");
    nextSearch.delete("building");
    const query = nextSearch.toString();
    navigate(
      `${location.pathname}${query ? "?" + query : ""}`,
      { replace: true }
    );
  }

  return (
    <div className="ecm-container in-list-view">
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

      {/* EVACUATION CENTERS DIRECTORY (List / Details) */}
      {selectedCenter ? (
        <CenterDetailPage
          center={selectedCenter}
          section={centerSection}
          onDeactivate={confirmToggleCenterActive}
          counts={{
            structure: centerRooms.length,
            households: allCenterFamilies.length,
          }}
          rooms={centerRooms}
          buildings={buildings}
          centerCapacity={centerCapacity}
          centerOccupied={centerOccupied}
          centerAssigned={centerAssigned}
          centerAvailable={centerAvailable}
          centerBuildingCount={centerBuildingCount}
          onBack={handleBack}
          onSectionChange={setCenterSection}
          onAssignHousehold={handleAssignHouseholdClick}
          onViewMap={() => {
            const cId = selectedCenter?.id || selectedCenter?.properties?.id;
            navigate(`${mapBasePath}?center=${cId}`);
          }}
          onEditCenter={() => openEditCenterModal(selectedCenter)}
          onAddRooms={() => {
            setRoomModalMode("add");

            setError("");
          }}
          onAddBuilding={() => {
            setBuildingForm({ name: '', notes: '' });
            setBuildingModalOpen(true);
            setError('');
          }}
          onAddRoom={() => {
            setRoomModalMode("add");

            setError("");
          }}
          onEditRoom={(room) => openEditRoomModal(room)}
          onViewBuildingMap={(building) => {
            const cId = selectedCenter?.id || selectedCenter?.properties?.id;
            if (cId && building?.id) {
              navigate(`${mapBasePath}?center=${cId}&building=${building.id}`);
            }
          }}
          onPlaceBuilding={(building, mode) => {
            const cId = selectedCenter?.id || selectedCenter?.properties?.id;
            if (cId && building?.id) {
              const action = typeof mode === 'string' ? mode : (mode ? 'edit_polygon' : 'place_building');
              navigate(`${mapBasePath}?center=${cId}&building=${building.id}&mode=${action}`);
            }
          }}
          onLinkRoom={(room) => openEditRoomModal(room)}
          onDeleteRoom={(room) => confirmDeleteRoom(room)}
          onMove={(family) => openMoveModal(family)}
          onUnassign={(family) => confirmUnassignFamily(family)}
          canDeactivate={canDeactivate}
          onPlaceOnMap={() => {
            const cId = selectedCenter?.id || selectedCenter?.properties?.id;
            navigate(`${mapBasePath}?center=${cId}&mode=place`);
          }}
        />
      ) : (
        <CenterList
          centers={centers}
          barangays={barangays}
          onRefresh={onRefresh}
          canDeactivate={canDeactivate}
          onAddCenter={openAddCenterModal}
          onEdit={openEditCenterModal}
          onViewMap={(f) => {
            const cId = f.properties?.id ?? f.id;
            navigate(`${mapBasePath}?center=${cId}`);
          }}
          onAddRooms={() => {
            setRoomModalMode("add");
            setError("");
          }}
          onRowOpen={(feature) => {
            setSelectedCenter(normalizeCenter(feature));
            setCenterSection("overview");
          }}
          onDeactivate={(f) => confirmToggleCenterActive(f)}
          onPlaceOnMap={(f) => {
            const cId = f.properties?.id ?? f.id;
            navigate(`${mapBasePath}?center=${cId}&mode=place`);
          }}
        />
      )}

      {/* MODALS */}
      {centerModalMode && (
        <CenterFormModal
          mode={centerModalMode}
          centerForm={centerForm}
          onChange={setCenterForm}
          barangays={barangays}
          saving={savingCenter}
          onSubmit={handleSaveCenter}
          onClose={() => setCenterModalMode(null)}
          onBeforeDeselect={handleBeforeDeselectBarangay}
        />
      )}
      {roomModalMode && (
        <CenterRoomModal
          mode={roomModalMode}
          selectedCenter={selectedCenter}
          selectedRoom={selectedRoom}
          roomForm={roomForm}
          onChange={setRoomForm}
          saving={savingRoom}
          onSubmit={handleSaveRoom}
          onClose={() => setRoomModalMode(null)}
          buildings={buildings}
          defaultBuildingId={roomModalMode === 'add' ? '' : (selectedRoom?.building_id != null ? String(selectedRoom.building_id) : '')}
        />
      )}
      <AssignFamilyModal
        open={assignModalOpen && (!!selectedRoom || selectedCenter?.center_type === 'single_venue' || centerRooms.length === 0)}
        selectedCenter={selectedCenter}
        selectedRoom={selectedRoom}
        availableFamilies={availableFamilies}
        loadingAvailableFamilies={loadingAvailableFamilies}
        selectedFamilyIdToAssign={selectedFamilyIdToAssign}
        assigningFamily={assigningFamily}
        onClose={() => setAssignModalOpen(false)}
        onFamilyChange={setSelectedFamilyIdToAssign}
        onConfirm={handleConfirmAssignment}
      />
      <MoveFamilyModal
        open={moveModalOpen && !!movingFamily}
        movingFamily={movingFamily}
        selectedRoom={selectedRoom}
        centers={centers}
        targetCenterRooms={targetCenterRooms}
        targetCenterId={targetCenterId}
        targetRoomId={targetRoomId}
        loadingTargetRooms={loadingTargetRooms}
        moving={moving}
        onClose={() => setMoveModalOpen(false)}
        onTargetCenterChange={handleTargetCenterChange}
        onTargetRoomChange={setTargetRoomId}
        onConfirmMove={handleConfirmMove}
      />
      {buildingModalOpen && (
        <AddBuildingModal
          open={buildingModalOpen}
          buildingForm={buildingForm}
          onChange={setBuildingForm}
          saving={savingBuilding}
          onSubmit={handleSaveBuilding}
          onClose={() => setBuildingModalOpen(false)}
        />
      )}
      <ConfirmCenterDialog
        open={!!confirmDialog}
        title={confirmDialog?.title}
        message={confirmDialog?.message}
        confirmText={confirmDialog?.confirmText}
        danger={confirmDialog?.danger}
        onConfirm={confirmDialog?.onConfirm}
        onCancel={confirmDialog?.onCancel}
      />

      {/* MOBILE FILTERS BOTTOM SHEET */}
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
                <label>Search</label>
                <input
                  type="text"
                  className="ecm-sheet-input"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Search centers"
                />
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

      {/* OFFICIAL PRINTABLE EVACUEE MANIFEST */}
      {selectedCenter && (
        <div className="ecm-printable-manifest" aria-hidden="true">
          <div className="ecm-print-header">
            <div className="ecm-print-logo-text">
              <h4>REPUBLIC OF THE PHILIPPINES</h4>
              <h5>PROVINCE OF SOUTHERN LEYTE ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ MUNICIPALITY OF SOGOD</h5>
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
                {(selectedCenter.barangays || []).map((b) => b.name).join(", ") || "ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â"}
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
                <th scope="col">Room Number</th>
                <th scope="col">Designated Capacity</th>
                <th scope="col">Occupied Count</th>
                <th scope="col">Available Spaces</th>
                <th scope="col">Room Status</th>
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
                <th style={{ width: 30 }} scope="col">#</th>
                <th scope="col">Household Head</th>
                <th scope="col">Family Code</th>
                <th scope="col">Room</th>
                <th scope="col">Origin Barangay</th>
                <th scope="col">Headcount</th>
                <th scope="col">Contact</th>
                <th scope="col">Remarks / Signature</th>
              </tr>
            </thead>
            <tbody>
              {(allCenterFamilies.length > 0 ? allCenterFamilies : roomFamilies).map((fam, idx) => (
                <tr key={fam.family_id || idx}>
                  <td>{idx + 1}</td>
                  <td>
                    <strong>{fam.household_head_name || fam.head_name || "ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â"}</strong>
                  </td>
                  <td>{fam.family_code || "ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â"}</td>
                  <td>{formatRoomLabel(fam.room_number) || "ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â"}</td>
                  <td>{displayEntityName(fam.barangay, "ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â")}</td>
                  <td>{fam.assigned_members || fam.family_members || 1}</td>
                  <td>{fam.contact_number || "ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â"}</td>
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
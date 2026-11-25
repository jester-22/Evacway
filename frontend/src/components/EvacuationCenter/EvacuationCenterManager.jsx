import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
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
import { formatManilaDateTime } from "../../utils/dateTime";
import { resolveCenterStructureMode, useEscapeKey } from "./utils";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { getOccupancyStatus } from "./evacuationStatus";
import {
  faCircleExclamation,
  faCircleCheck,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import "./EvacuationCenterManager.css";

import CenterList from "./CenterList";
import CenterDetailPage, { RoomDetailPage } from "./CenterDetail";
import BuildingDetail from "./BuildingDetail";
import { CenterFormModal, CenterRoomModal, AddBuildingModal, EditBuildingModal, BuildingFormModal, AssignFamilyModal, MoveFamilyModal, ConfirmCenterDialog } from "./CenterModals";

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
  const { centerId: routeCenterId, buildingId: routeBuildingId, roomId: routeRoomId } = useParams();
  const isLgu = location.pathname.startsWith("/lgu");
  const mapBasePath = isLgu ? "/lgu/map" : "/admin/map";
  const appBasePath = isLgu ? "/lgu" : "/admin";

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
        floors: props?.floors != null ? Number(props.floors) : 1,
        max_rooms: props?.max_rooms ?? props?.room_capacity_limit ?? null,
        status: ['open', 'closed', 'under_repair'].includes(props?.operational_status)
          ? props.operational_status
          : ['open', 'closed', 'under_repair'].includes(props?.building_status)
            ? props.building_status
            : 'open',
        occupancyStatus: props?.status || null,
        notes: props?.notes || null,
        geometry: feature?.geometry || null,
        is_mapped,
        properties: props,
      };
    });
  }, [centerBuildingsQuery.data]);

  const [selectedRoom, setSelectedRoom] = useState(null);
  const [roomDetail, setRoomDetail] = useState(null);
  useEffect(() => {
    if (!selectedCenter) return undefined;
    const frameId = window.requestAnimationFrame(() => window.scrollTo(0, 0));
    return () => window.cancelAnimationFrame(frameId);
  }, [routeBuildingId, routeRoomId, roomDetail?.id, selectedCenter?.id]);
  const roomFamiliesQuery = useRoomFamilies(
    routeRoomId || (selectedRoom?.id && selectedRoom?.id !== "all" ? selectedRoom.id : null)
  );
  const roomFamilies = roomFamiliesQuery.data?.families || [];
  const routedRoom = routeRoomId
    ? centerRooms.find((room) => String(room.id) === String(routeRoomId)) || null
    : null;
  const routedBuilding = routeBuildingId
    ? buildings.find((building) => String(building.id) === String(routeBuildingId)) || null
    : null;
  const routedRoomBuilding = routedRoom?.building_id != null
    ? buildings.find((building) => String(building.id) === String(routedRoom.building_id)) || null
    : null;

  // Center details query to fetch assigned_families across the whole center
  const centerDetailsQuery = useQuery({
    queryKey: queryKeys.centerDetails(selectedCenter?.id),
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
  const [centerModalInitialStep, setCenterModalInitialStep] = useState(1);
  const [allowedCenterTypes, setAllowedCenterTypes] = useState(null);
  const [centerForm, setCenterForm] = useState({
    name: "",
    barangay_ids: [],
    capacity: "",
    building_material: "",
    amenities: [],
    contact_number: "",
  });
  const [savingCenter, setSavingCenter] = useState(false);

  // Room modal
  const [roomModalMode, setRoomModalMode] = useState(null);
  const [roomForm, setRoomForm] = useState({
    room_number: "",
    family_slots: "5",
    people_spaces: "25",
    building_id: "",
    floor: "",
  });
  const [savingRoom, setSavingRoom] = useState(false);

  // Building modal
  const [buildingModalOpen, setBuildingModalOpen] = useState(false);
  const [buildingModalMode, setBuildingModalMode] = useState("add");
  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [buildingForm, setBuildingForm] = useState({
    name: '',
    max_rooms: null,
    floors: 1,
    status: 'open',
    notes: '',
  });
  const [savingBuilding, setSavingBuilding] = useState(false);

  // Assign family modal
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignTargetRoom, setAssignTargetRoom] = useState(null);
  const [assignRoomSelectionEnabled, setAssignRoomSelectionEnabled] = useState(false);
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
  const targetCenterBuildingsQuery = useCenterBuildings(targetCenterId ? Number(targetCenterId) : null);
  const targetCenterBuildings = useMemo(() => {
    const data = targetCenterBuildingsQuery.data;
    if (!data) return [];
    const features = Array.isArray(data?.features) ? data.features : (Array.isArray(data) ? data : []);
    return features.map((feature) => {
      const props = feature?.properties || feature;
      return {
        id: props?.id ?? feature?.id,
        name: props?.name || props?.display_label || `Building #${props?.id ?? feature?.id}`,
        properties: props,
      };
    });
  }, [targetCenterBuildingsQuery.data]);
  const loadingTargetRooms = targetRoomsQuery.isLoading;
  const [moving, setMoving] = useState(false);

  // Confirmation dialog
  const [confirmDialog, setConfirmDialog] = useState(null);

  // Escape closes the confirmation dialog (some confirm flows have no onCancel).
  useEscapeKey(confirmDialog != null, () => setConfirmDialog(null));

  // Mapbox drawing states (ref to avoid re-renders on URL sync)
  const handledUrlRef = useRef("");

  // Open a center directly when arriving from the map or a refreshed detail URL.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const requestedCenterId = routeCenterId || params.get("center");
    if (!requestedCenterId) {
      handledUrlRef.current = "";
      setSelectedCenter(null);
      setSelectedRoom(null);
      setRoomDetail(null);
      return;
    }
    if (!Array.isArray(centers?.features)) return;

    const requestKey = `${location.pathname}:${requestedCenterId}`;
    if (handledUrlRef.current === requestKey) return;

    const requestedCenter = centers.features.find((feature) => {
      const props = feature?.properties || feature;
      return String(props?.id) === String(requestedCenterId);
    });
    if (!requestedCenter) return;

    handledUrlRef.current = requestKey;
    setSelectedCenter(normalizeCenter(requestedCenter));
    setSelectedRoom(null);
    setRoomDetail(null);
  }, [centers, location.pathname, location.search, routeCenterId, routeBuildingId, routeRoomId]);

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
      queryClient.invalidateQueries({ queryKey: ["buildings"] }),
      queryClient.invalidateQueries({ queryKey: ["building-details"] }),
      queryClient.invalidateQueries({ queryKey: ["rooms"] }),
      queryClient.invalidateQueries({ queryKey: ["room-families"] }),
    ]);
  }

  async function invalidateFamilyAssignments() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["families"] }),
      queryClient.invalidateQueries({ queryKey: ["rooms"] }),
      queryClient.invalidateQueries({ queryKey: ["buildings"] }),
      queryClient.invalidateQueries({ queryKey: ["building-details"] }),
      queryClient.invalidateQueries({ queryKey: ["room-families"] }),
      queryClient.invalidateQueries({ queryKey: ["evacuation-centers"] }),
      queryClient.invalidateQueries({ queryKey: ["evacuation-center-details"] }),
      queryClient.invalidateQueries({ queryKey: ["barangay-centers"] }),
    ]);
  }

  async function openAssignModal(targetRoom = selectedRoom, allowRoomSelection = false) {
    const isSingle = resolveCenterStructureMode(selectedCenter) === 'open_area';
    if (!targetRoom && !isSingle && !allowRoomSelection) return;
    setAssignTargetRoom(targetRoom || null);
    setAssignRoomSelectionEnabled(allowRoomSelection);
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
    setAllowedCenterTypes(null);
    setCenterForm({
      name: "",
      barangay_ids: [],
      capacity: "",
      center_type: "campus",
      building_material: "",
      amenities: [],
      contact_number: "",
      owner_name: "",
      max_rooms: "",
    });
    setCenterModalInitialStep(1);
    setCenterModalMode("add");
    setError("");
  }

  function openEditCenterModal(center, initialStep = 1) {
    const props = center.properties || center;
    const rawAmenities = props.amenities || [];
    const prefilledAmenities = Array.isArray(rawAmenities)
      ? rawAmenities.map((a) => (typeof a === "object" && a !== null ? a.name || a.code : a)).filter(Boolean)
      : [];

    setCenterForm({
      name: props.name || "",
      barangay_ids: (props.barangays || []).map((barangay) =>
        String(typeof barangay === "object" && barangay !== null ? barangay.id : barangay)
      ),
      capacity:
        props.capacity !== null && props.capacity !== undefined ? String(props.capacity) : "",
      center_type: props.center_type || "campus",
      center_type_id: props.center_type_id || 1,
      structure_mode: props.structure_mode || resolveCenterStructureMode(props),
      building_material: props.building_material || "",
      building_material_id: props.building_material_id || null,
      amenities: prefilledAmenities,
      contact_number: props.contact_number || "",
      owner_name: props.owner_name || props.owner_operator || "",
      max_rooms: props.max_rooms ? String(props.max_rooms) : "",
    });
    setSelectedCenter(normalizeCenter(center));
    setCenterModalInitialStep(typeof initialStep === "number" ? initialStep : 1);
    setAllowedCenterTypes(null);
    setCenterModalMode("edit");
    setError("");

    const centerId = props.id;
    if (centerId) {
      api.getAllowedCenterTypes(centerId)
        .then((rules) => {
          setAllowedCenterTypes(rules || null);
        })
        .catch(() => {
          setAllowedCenterTypes(null);
        });
    }
  }

  async function handleSaveCenter(e) {
    if (e?.preventDefault) e.preventDefault();
    if (savingCenter) return;
    if (!centerForm.name?.trim()) {
      setError("Evacuation center name is required.");
      return;
    }
    if (!centerForm.barangay_ids?.length) {
      setError("Select at least one barangay served by this center.");
      return;
    }

    setSavingCenter(true);
    setError("");

    try {
      const formStructureMode = resolveCenterStructureMode(centerForm);
      const isFormOpenArea = formStructureMode === "open_area";
      const payload = {
        name: centerForm.name.trim(),
        barangay_ids: (centerForm.barangay_ids || []).map(Number),
        ...(isFormOpenArea
          ? {
            capacity:
              centerForm.capacity !== "" &&
                centerForm.capacity !== null &&
                centerForm.capacity !== undefined
                ? Number(centerForm.capacity)
                : null,
          }
          : {}),
        center_type: centerForm.center_type || "campus",
        center_type_id: centerForm.center_type_id ? Number(centerForm.center_type_id) : null,
        building_material: centerForm.building_material?.trim() || null,
        building_material_id: centerForm.building_material_id
          ? Number(centerForm.building_material_id)
          : null,
        amenities: centerForm.amenities || [],
        contact_number: centerForm.contact_number?.trim() || null,
        owner_name: centerForm.owner_name?.trim() || null,
        owner_operator: centerForm.owner_name?.trim() || null,
      };

      if (centerModalMode === "add") {
        const created = await api.createEvacuationCenter(payload);
        setNotice(`Evacuation center "${payload.name}" created successfully.`);
        if (created?.data) {
          setSelectedCenter(normalizeCenter(created.data));
        } else if (created) {
          setSelectedCenter(normalizeCenter(created));
        }
      } else {
        const updated = await api.updateEvacuationCenter(selectedCenter.id, payload);
        setNotice(`Evacuation center "${payload.name}" updated successfully.`);
        if (updated?.data) {
          setSelectedCenter(normalizeCenter(updated.data));
        } else if (updated) {
          setSelectedCenter(normalizeCenter(updated));
        } else {
          setSelectedCenter((prev) => ({ ...prev, ...payload }));
        }
      }

      setCenterModalMode(null);
      await invalidateCenterData();
      await onRefresh?.();
    } catch (err) {
      const msg =
        err?.message === "Failed to fetch" || err?.name === "TypeError"
          ? "Couldn't reach the server. Check your connection and try again."
          : err?.message || "Failed to save evacuation center.";
      setError(msg);
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
    const spaces = Number(room.people_spaces ?? room.capacity ?? 25);
    const derivedSlots = Math.max(1, Math.ceil(spaces / 5));
    setRoomForm({
      room_number: room.room_number || "",
      family_slots: String(derivedSlots),
      people_spaces: String(spaces),
      building_id: room.building_id != null ? String(room.building_id) : "",
      floor: room.floor != null ? String(room.floor) : "",
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
    const parsedPeopleSpaces = Number(roomForm.people_spaces);
    if (!Number.isInteger(parsedPeopleSpaces) || parsedPeopleSpaces < 1) {
      setError("People spaces must be a whole number of at least 1.");
      return;
    }
    const computedFamilySlots = Math.max(1, Math.ceil(parsedPeopleSpaces / 5));

    setSavingRoom(true);
    setError("");

    try {
      const parsedBuildingId = roomForm.building_id !== "" ? Number(roomForm.building_id) : null;
      const payload = {
        room_number: roomForm.room_number.trim(),
        family_slots: computedFamilySlots,
        people_spaces: parsedPeopleSpaces,
        building_id: parsedBuildingId,
      };

      if (roomForm.floor !== "") {
        payload.floor = Number(roomForm.floor);
      } else if (roomModalMode === "add" && parsedBuildingId != null) {
        payload.floor = 1;
      } else if (!(roomModalMode === "edit" && selectedRoom?.floor == null && String(selectedRoom?.building_id ?? "") === String(parsedBuildingId ?? ""))) {
        payload.floor = null;
      }

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
        queryClient.invalidateQueries({ queryKey: ["building-details"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.centerDetails(selectedCenter.id) }),
        queryClient.invalidateQueries({ queryKey: ["evacuation-centers"] }),
      ]);
    } catch (err) {
      setError(err.message || "Failed to save room.");
    } finally {
      setSavingRoom(false);
    }
  }

  function openAddBuildingModal() {
    setSelectedBuilding(null);
    setBuildingForm({
      name: '',
      max_rooms: null,
      floors: 1,
      status: 'open',
      notes: '',
    });
    setBuildingModalMode('add');
    setBuildingModalOpen(true);
    setError('');
  }

  function openEditBuildingModal(building) {
    setSelectedBuilding(building);
    setBuildingForm({
      name: building.name || '',
      max_rooms: building.max_rooms != null ? Number(building.max_rooms) : null,
      floors: building.floors != null ? Number(building.floors) : 1,
      status: building.status || 'open',
      notes: building.notes || '',
    });
    setBuildingModalMode('edit');
    setBuildingModalOpen(true);
    setError('');
  }

  function openAddRoomForBuilding(building) {
    setRoomForm({
      room_number: '',
      family_slots: '5',
      people_spaces: '25',
      building_id: building?.id != null ? String(building.id) : '',
      floor: building?.id != null ? '1' : '',
    });
    setSelectedRoom(null);
    setRoomModalMode('add');
    setError('');
  }

  async function handleSaveBuilding(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!buildingForm.name || !buildingForm.name.trim()) {
      setError('Building name is required.');
      return;
    }

    const cId = selectedCenter?.id || selectedCenter?.properties?.id;
    if (!cId) return;

    setSavingBuilding(true);
    setError('');

    try {
      const payload = {
        name: buildingForm.name.trim(),
        max_rooms: buildingForm.max_rooms !== null && buildingForm.max_rooms !== '' ? Number(buildingForm.max_rooms) : null,
        floors: Number(buildingForm.floors || 1),
        status: buildingForm.status || 'open',
        notes: buildingForm.notes?.trim() || null,
      };

      if (buildingModalMode === 'edit' && selectedBuilding) {
        await api.updateBuilding(selectedBuilding.id, payload);
        setNotice(`Building "${payload.name}" updated successfully.`);
      } else {
        await api.createBuilding(cId, payload);
        setNotice(`Building "${payload.name}" added successfully.`);
      }

      setBuildingModalOpen(false);
      setSelectedBuilding(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.buildings(cId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.rooms(cId) }),
        queryClient.invalidateQueries({ queryKey: ["building-details"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.centerDetails(cId) }),
        queryClient.invalidateQueries({ queryKey: ["evacuation-centers"] }),
        queryClient.invalidateQueries({ queryKey: ["evacuation-center-details"] }),
      ]);
    } catch (err) {
      setError(err.message || "Failed to save building.");
    } finally {
      setSavingBuilding(false);
    }
  }

  function confirmDeleteBuilding(building) {
    const bldName = building.name || `Building #${building.id}`;
    const linkedRoomsCount = centerRooms.filter((r) => String(r.building_id) === String(building.id)).length;
    setConfirmDialog({
      title: "Delete Building",
      message: linkedRoomsCount > 0
        ? `Are you sure you want to delete "${bldName}"? Its ${linkedRoomsCount} linked room(s) will be safely unlinked and kept as unassigned rooms. Any assigned families will remain intact.`
        : `Are you sure you want to delete building "${bldName}"?`,
      confirmText: "Delete Building",
      danger: true,
      onCancel: () => setConfirmDialog(null),
      onConfirm: async () => {
        const buildingId = building?.properties?.id ?? building?.id;
        const cId = selectedCenter?.id || selectedCenter?.properties?.id;
        const refreshCenterStructure = () => Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.buildings(cId) }),
          queryClient.invalidateQueries({ queryKey: ["building-details"] }),
          queryClient.invalidateQueries({ queryKey: queryKeys.rooms(cId) }),
          queryClient.invalidateQueries({ queryKey: ["evacuation-centers"] }),
          queryClient.invalidateQueries({ queryKey: ["evacuation-center-details"] }),
        ]);

        try {
          await api.deleteBuilding(buildingId);
          setConfirmDialog(null);
          setNotice(`Building "${bldName}" deleted successfully.`);
          await refreshCenterStructure();
          if (String(routeBuildingId) === String(buildingId)) {
            navigate(centerStructureHref);
          }
        } catch (err) {
          if (err.status === 404) {
            await refreshCenterStructure();
            setConfirmDialog(null);
            setError("That building could not be found. The building list was refreshed; select it again if it is still shown.");
            return;
          }
          setError(err.message || "Failed to delete building.");
        }
      },
    });
  }

  function confirmDeleteRoom(room) {
    setConfirmDialog({
      title: "Delete Room",
      message: `Are you sure you want to permanently delete ${formatRoomLabel(room.room_number)}? Move or unassign its families first; deletion is blocked while families are assigned.`,
      confirmText: "Delete Room",
      danger: true,
      onConfirm: async () => {
        try {
          await api.deleteRoom(room.id);
          setNotice(`${formatRoomLabel(room.room_number)} deleted.`);
          if (selectedRoom?.id === room.id) {
            setSelectedRoom(null);
          }
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: queryKeys.rooms(selectedCenter.id) }),
            queryClient.invalidateQueries({ queryKey: queryKeys.buildings(selectedCenter.id) }),
            queryClient.invalidateQueries({ queryKey: ["building-details"] }),
            queryClient.invalidateQueries({ queryKey: queryKeys.centerDetails(selectedCenter.id) }),
            queryClient.invalidateQueries({ queryKey: ["evacuation-centers"] }),
          ]);
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

    const isSingle = resolveCenterStructureMode(selectedCenter) === 'open_area';
    const assignmentRoom = assignTargetRoom;
    const memberCount = family.member_count || family.family_members || 1;

    let capacity;
    let remaining;
    if (isSingle) {
      capacity = Number(selectedCenter?.capacity || 0);
      const assigned = Number(selectedCenter?.assigned ?? selectedCenter?.total_assigned ?? selectedCenter?.occupied ?? 0);
      remaining = Math.max(capacity - assigned, 0);
    } else if (assignmentRoom) {
      capacity = Number(assignmentRoom.capacity || 0);
      const assigned = Number(assignmentRoom.assigned ?? (assignmentRoom.unassigned != null
        ? capacity - Number(assignmentRoom.unassigned)
        : assignmentRoom.occupied ?? 0));
      remaining = Math.max(capacity - assigned, 0);
    } else if (assignRoomSelectionEnabled) {
      setError("Please select an available room before assigning this family.");
      return;
    } else {
      setError("Please select a room before assigning this family.");
      return;
    }

    if (capacity <= 0 || remaining <= 0) {
      setError(isSingle ? "Cannot assign: This evacuation center is at full capacity." : "Cannot assign: This room is at full capacity.");
      return;
    }

    if (memberCount > remaining) {
      setError(`Cannot assign: Family has ${memberCount} members, but only ${remaining} spaces left.`);
      return;
    }

    setAssigningFamily(true);
    setError("");

    try {
      await api.assignFamily(family.id, {
        center_id: selectedCenter.id,
        room_id: isSingle ? null : (assignmentRoom?.id || null),
      });

      const locationLabel = isSingle
        ? (selectedCenter?.name || "the evacuation center")
        : formatRoomLabel(assignmentRoom.room_number);

      setNotice(`Family "${family.household_head_name || family.head_name}" assigned to ${locationLabel}.`);
      setAssignModalOpen(false);
      setAssignTargetRoom(null);
      setAssignRoomSelectionEnabled(false);

      await invalidateFamilyAssignments();
    } catch (err) {
      setError(err.message || "Failed to assign family.");
    } finally {
      setAssigningFamily(false);
    }
  }

  async function handleConfirmMove() {
    if (!targetCenterId) return;

    const targetFeature = (centers?.features || []).find(
      (f) => String((f.properties || f).id) === String(targetCenterId)
    );
    const targetCenter = targetFeature ? (targetFeature.properties || targetFeature) : null;
    const isTargetOpenArea = targetCenter ? resolveCenterStructureMode(targetCenter) === "open_area" : false;

    const needed = movingFamily.assigned_members || movingFamily.family_members || movingFamily.member_count || 1;

    if (isTargetOpenArea) {
      const cap = Number(targetCenter?.capacity || 0);
      const assigned = Number(targetCenter?.assigned ?? targetCenter?.total_assigned ?? targetCenter?.occupied ?? 0);
      const centerRemaining = Math.max(cap - assigned, 0);
      if (cap <= 0 || centerRemaining <= 0 || needed > centerRemaining) {
        setError(`Cannot move: Family needs ${needed} spaces, but ${targetCenter?.name || "target center"} only has ${centerRemaining} available.`);
        return;
      }
      setConfirmDialog({
        title: "Confirm Family Transfer",
        message: `Move family "${movingFamily.household_head_name || movingFamily.head_name}" (${needed} members) to ${targetCenter?.name || "selected center"}? Occupancy will update automatically.`,
        confirmText: "Move Family",
        danger: false,
        onConfirm: async () => {
          setMoving(true);
          setError("");
          try {
            await api.moveFamily(movingFamily.family_id, {
              room_id: null,
              center_id: Number(targetCenterId),
            });

            setNotice(`Family "${movingFamily.household_head_name || movingFamily.head_name}" moved to ${targetCenter?.name || "target center"}.`);
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
      return;
    }

    if (!targetRoomId) return;

    const dest = targetCenterRooms.find((r) => String(r.id) === String(targetRoomId));
    if (!dest) return;

    const destSlots = Math.max(1, Number(dest.family_slots ?? 5));
    const destSpaces = Math.max(1, Number(dest.people_spaces ?? dest.capacity ?? 25));
    const slotsLeft = Math.max(0, Number(dest.available_slots ?? destSlots - Number(dest.used_slots ?? dest.assigned_households ?? 0)));
    const spacesLeft = Math.max(0, Number(dest.available_spaces ?? dest.unassigned ?? destSpaces - Number(dest.used_spaces ?? dest.assigned ?? dest.occupied ?? 0)));

    if (slotsLeft < 1) {
      setError("Cannot move: target room has no family slots available.");
      return;
    }
    if (needed > spacesLeft) {
      setError(`Cannot move: Family needs ${needed} people spaces, but target room only has ${spacesLeft} available.`);
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
          message: `Removing "${barangayName}" will affect ${affectedHouseholds} family${affectedHouseholds > 1 ? "s" : ""} (${affectedPersons} person${affectedPersons !== 1 ? "s" : ""}) currently assigned to this center. Are you sure you want to remove it?`,
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
    const centerMapped = Boolean(
      isCenterMapped(selectedCenter) ||
      selectedCenter?.has_map ||
      selectedCenter?.is_mapped
    );
    if (!centerMapped) {
      setError("Cannot assign families: This evacuation center is not mapped yet. Place the center on the map first.");
      return;
    }
    const mode = resolveCenterStructureMode(selectedCenter);
    const isSingle = mode === 'open_area';
    if (mode === 'buildings_and_rooms') {
      const hasMappedOpenBuilding =
        buildings.some(
          (b) =>
            Boolean(b?.is_mapped || b?.properties?.is_mapped) &&
            (b?.status || b?.properties?.status || 'open') === 'open'
        ) ||
        centerRooms.some(
          (r) =>
            Boolean(r?.building_is_mapped) &&
            (!r?.building_status || r.building_status === 'open')
        );
      if (!hasMappedOpenBuilding) {
        setError("Cannot assign families: Place at least one open building on the map first.");
        return;
      }
    }
    if (isSingle) {
      const cap = Number(selectedCenter?.capacity || 0);
      const assigned = Number(selectedCenter?.assigned ?? selectedCenter?.total_assigned ?? selectedCenter?.occupied ?? 0);
      const remaining = Math.max(cap - assigned, 0);
      if (cap <= 0 || remaining <= 0) {
        setError("This evacuation center is at full capacity.");
        return;
      }
      setSelectedRoom(null);
      openAssignModal(null);
      return;
    }

    // Open the room picker even if room data is still loading or no rooms have
    // space. The modal owns the available-room filter and explains when none fit.
    openAssignModal(null, true);
  }

  function handleBack() {
    setRoomDetail(null);
    setSelectedCenter(null);
    setSelectedRoom(null);
    handledUrlRef.current = "";
    navigate(`${appBasePath}?tab=centers`, { replace: true });
  }

  const selectedCenterId = selectedCenter?.id || selectedCenter?.properties?.id;
  const centersListHref = `${appBasePath}?tab=centers`;
  const centerStructureHref = selectedCenterId
    ? `${appBasePath}/evacuation-centers/${encodeURIComponent(selectedCenterId)}?tab=structure`
    : centersListHref;
  const buildingDetailHref = (buildingId) => `${appBasePath}/evacuation-centers/${selectedCenterId}/buildings/${buildingId}`;
  const roomDetailHref = (roomId) => `${appBasePath}/evacuation-centers/${selectedCenterId}/rooms/${roomId}`;

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
        routeBuildingId ? (
          <BuildingDetail
            center={selectedCenter}
            building={routedBuilding}
            rooms={centerRooms}
            families={allCenterFamilies}
            loading={centerBuildingsQuery.isPending || centerRoomsQuery.isPending || centerDetailsQuery.isPending}
            notFound={!centerBuildingsQuery.isPending && !centerBuildingsQuery.isFetching && !routedBuilding}
            listHref={centersListHref}
            centerHref={centerStructureHref}
            onAddRoom={() => routedBuilding && openAddRoomForBuilding(routedBuilding)}
            onEditBuilding={openEditBuildingModal}
            onDeleteBuilding={confirmDeleteBuilding}
            onViewBuildingMap={(building) => navigate(`${mapBasePath}?center=${selectedCenterId}&building=${building.id}`)}
            onPlaceBuilding={(building, mode) => navigate(`${mapBasePath}?center=${selectedCenterId}&building=${building.id}&mode=${mode}`)}
            onOpenRoom={(room) => navigate(roomDetailHref(room.id))}
          />
        ) : routeRoomId || roomDetail ? (
          <RoomDetailPage
            center={selectedCenter}
            room={
              (routedRoom || roomDetail)
                ? {
                    ...(routedRoom || roomDetail),
                    ...(roomFamiliesQuery.data
                      ? {
                          used_slots: roomFamiliesQuery.data.used_slots ?? (routedRoom || roomDetail)?.used_slots,
                          used_spaces: roomFamiliesQuery.data.used_spaces ?? (routedRoom || roomDetail)?.used_spaces,
                          available_slots: roomFamiliesQuery.data.available_slots ?? (routedRoom || roomDetail)?.available_slots,
                          available_spaces: roomFamiliesQuery.data.available_spaces ?? (routedRoom || roomDetail)?.available_spaces,
                          is_full: roomFamiliesQuery.data.is_full ?? (routedRoom || roomDetail)?.is_full,
                          is_over_capacity: roomFamiliesQuery.data.is_over_capacity ?? (routedRoom || roomDetail)?.is_over_capacity,
                          occupied: roomFamiliesQuery.data.occupied ?? (routedRoom || roomDetail)?.occupied,
                          building_is_mapped: roomFamiliesQuery.data.building_is_mapped ?? (routedRoom || roomDetail)?.building_is_mapped,
                          center_is_mapped: roomFamiliesQuery.data.center_is_mapped ?? (routedRoom || roomDetail)?.center_is_mapped,
                          building_status: roomFamiliesQuery.data.building_status ?? (routedRoom || roomDetail)?.building_status,
                        }
                      : {}),
                  }
                : null
            }
            building={routedRoomBuilding}
            buildingName={routedRoomBuilding?.name}
            buildingFloors={routedRoomBuilding?.floors}
            buildingHref={routedRoomBuilding ? buildingDetailHref(routedRoomBuilding.id) : null}
            families={roomFamilies}
            loading={roomFamiliesQuery.isLoading || (Boolean(routeRoomId) && centerRoomsQuery.isLoading)}
            notFound={Boolean(routeRoomId) && !centerRoomsQuery.isLoading && !routedRoom}
            error={roomFamiliesQuery.error}
            onRetry={() => roomFamiliesQuery.refetch()}
            onBack={() => {
              if (routedRoomBuilding) navigate(buildingDetailHref(routedRoomBuilding.id));
              else navigate(centerStructureHref);
            }}
            onBackToList={() => navigate(centersListHref)}
            listHref={centersListHref}
            centerHref={centerStructureHref}
            onOpenBuilding={(building) => navigate(buildingDetailHref(building.id))}
            onAddHousehold={() => openAssignModal(routedRoom || roomDetail)}
            onUnassignHousehold={confirmUnassignFamily}
            onEditRoom={openEditRoomModal}
          />
        ) : (
        <CenterDetailPage
          center={selectedCenter}
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
          householdCapacity={selectedCenter?.household_capacity}
          householdAssigned={selectedCenter?.household_assigned}
          householdArrived={selectedCenter?.household_arrived}
          householdSpaceLeft={selectedCenter?.household_space_left}
          centerBuildingCount={centerBuildingCount}
          onBack={handleBack}
          onAssignHousehold={handleAssignHouseholdClick}
          onViewMap={() => {
            const cId = selectedCenter?.id || selectedCenter?.properties?.id;
            navigate(`${mapBasePath}?center=${cId}`);
          }}
          onEditCenter={(step) => openEditCenterModal(selectedCenter, typeof step === "number" ? step : 1)}
          onAddRooms={() => {
            setRoomForm({ room_number: "", family_slots: "5", people_spaces: "25", building_id: "", floor: "" });
            setSelectedRoom(null);
            setRoomModalMode("add");
            setError("");
          }}
          onAddBuilding={openAddBuildingModal}
          onAddRoom={() => {
            setRoomForm({ room_number: "", family_slots: "5", people_spaces: "25", building_id: "", floor: "" });
            setSelectedRoom(null);
            setRoomModalMode("add");
            setError("");
          }}
          onEditRoom={(room) => openEditRoomModal(room)}
          onOpenRoom={(room) => navigate(roomDetailHref(room.id))}
          onOpenBuilding={(building) => navigate(buildingDetailHref(building.id))}
          onMove={(family) => openMoveModal(family)}
          onUnassign={(family) => confirmUnassignFamily(family)}
          canDeactivate={canDeactivate}
          onPlaceOnMap={() => {
            const cId = selectedCenter?.id || selectedCenter?.properties?.id;
            navigate(`${mapBasePath}?center=${cId}&mode=place`);
          }}
        />
        )
      ) : routeCenterId ? (
        <main className="ec-room-detail-page">
          <div className="ec-room-households-state" role="status">
            {Array.isArray(centers?.features) ? (
              <><h1>Evacuation center not found</h1><p>This center may have been removed or is unavailable.</p></>
            ) : 'Loading evacuation center…'}
          </div>
        </main>
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
            setRoomForm({ room_number: "", family_slots: "5", people_spaces: "25", building_id: "", floor: "" });
            setSelectedRoom(null);
            setRoomModalMode("add");
            setError("");
          }}
          onRowOpen={(feature) => {
            const centerId = feature?.properties?.id ?? feature?.id;
            navigate(`${appBasePath}/evacuation-centers/${encodeURIComponent(centerId)}`);
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
          error={error}
          onClearError={() => setError("")}
          onSubmit={handleSaveCenter}
          onClose={() => {
            setCenterModalMode(null);
            setAllowedCenterTypes(null);
            setError("");
          }}
          onBeforeDeselect={handleBeforeDeselectBarangay}
          allowedCenterTypes={centerModalMode === "edit" ? allowedCenterTypes : null}
          initialStep={centerModalInitialStep}
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
          errorMessage={error}
          onSubmit={handleSaveRoom}
          onClose={() => setRoomModalMode(null)}
          buildings={buildings}
          defaultBuildingId={roomModalMode === 'add' ? '' : (selectedRoom?.building_id != null ? String(selectedRoom.building_id) : '')}
          onDeleteRoom={confirmDeleteRoom}
        />
      )}
      <AssignFamilyModal
        open={assignModalOpen && (!!assignTargetRoom || assignRoomSelectionEnabled || resolveCenterStructureMode(selectedCenter) === 'open_area')}
        selectedCenter={selectedCenter}
        selectedRoom={assignTargetRoom}
        rooms={centerRooms}
        buildings={buildings}
        allowRoomSelection={assignRoomSelectionEnabled}
        availableFamilies={availableFamilies}
        loadingAvailableFamilies={loadingAvailableFamilies}
        selectedFamilyIdToAssign={selectedFamilyIdToAssign}
        assigningFamily={assigningFamily}
        onClose={() => {
          setAssignModalOpen(false);
          setAssignTargetRoom(null);
          setAssignRoomSelectionEnabled(false);
        }}
        onFamilyChange={setSelectedFamilyIdToAssign}
        onRoomChange={setAssignTargetRoom}
        onConfirm={handleConfirmAssignment}
      />
      <MoveFamilyModal
        open={moveModalOpen && !!movingFamily}
        movingFamily={movingFamily}
        selectedRoom={selectedRoom}
        centers={centers}
        targetCenterRooms={targetCenterRooms}
        targetCenterBuildings={targetCenterBuildings}
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
        <BuildingFormModal
          open={buildingModalOpen}
          mode={buildingModalMode}
          buildingForm={buildingForm}
          onChange={setBuildingForm}
          activeRoomCount={
            selectedBuilding
              ? centerRooms.filter((r) => String(r.building_id) === String(selectedBuilding.id)).length
              : 0
          }
          assignedHouseholdCount={
            selectedBuilding
              ? new Set(allCenterFamilies
                  .filter((family) => String(family.building_id) === String(selectedBuilding.id))
                  .map((family) => family.family_id)
                ).size
              : 0
          }
          saving={savingBuilding}
          onSubmit={handleSaveBuilding}
          onClose={() => {
            setBuildingModalOpen(false);
            setSelectedBuilding(null);
          }}
        />
      )}
      <ConfirmCenterDialog
        open={!!confirmDialog}
        title={confirmDialog?.title}
        message={confirmDialog?.message}
        confirmText={confirmDialog?.confirmText}
        danger={confirmDialog?.danger}
        onConfirm={async () => {
          try {
            await confirmDialog?.onConfirm?.();
          } finally {
            setConfirmDialog(null);
          }
        }}
        onCancel={() => {
          confirmDialog?.onCancel?.();
          setConfirmDialog(null);
        }}
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
              {formatManilaDateTime(new Date(), { dateStyle: "medium", timeStyle: "short" })}
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
            II. REGISTERED EVACUEE FAMILIES MANIFEST
          </div>
          <table className="ecm-print-table">
            <thead>
              <tr>
                <th style={{ width: 30 }} scope="col">#</th>
                <th scope="col">Family Head</th>
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
                    No evacuee families currently registered in this facility.
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

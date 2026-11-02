import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faSearch,
  faXmark,
  faHouseFlag,
  faLocationDot,
  faArrowUpRightFromSquare,
  faDrawPolygon,
  faCheck,
  faArrowLeft,
  faArrowRight,
  faRotateLeft,
  faChevronLeft,
  faMapPin,
  faBuildingColumns,
  faPlus,
  faDoorOpen,
  faPlay,
  faArrowsUpDownLeftRight,
  faTrashCan,
  faPhone,
  faUsers,
  faSpinner,
  faLayerGroup,
  faLink,
  faUnlink,
  faEye,
  faCheckDouble,
  faEllipsisVertical,
  faPen,
  faChevronRight,
  faChevronDown,
  faChevronUp,
  faArrowsRotate,
  faCircleExclamation,
  faHome,
  faPlaceOfWorship,
  faWarehouse,
} from "@fortawesome/free-solid-svg-icons";

import { api } from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import {
  queryKeys,
  invalidateEvacuationQueries,
  useEvacuationCenters,
  useHazardZones,
  useNotifications,
  useHazardReports,
  usePublicHazardReports,
  useRooms,
  useRoomsForCenters,
  useRoomFamilies,
  useBuildingsForCenters,
} from "../../hooks/useEvacuationQueries";
import Sidebar from "../../components/Sidebar/Sidebar";
import DashboardMap, {
  isCenterMapped,
  getOccupancyStatus,
  getCenterCoordinates,
  isPointInOrNearPolygon,
} from "../../components/DashboardMap/DashboardMap";
import CenterPlacementFlow, { polygonToPoints } from "../../components/CenterPlacementFlow/CenterPlacementFlow";
import RoomDetailsModal from "../../components/EvacuationCenter/RoomDetailsModal";
import BuildingDetailsModal from "../../components/BuildingDetailsModal/BuildingDetailsModal";
import { displayEntityName } from "../../utils/displayEntityName";
import { snapLngLatToPolygonEdge } from "../../utils/polygonSnap";
import "../../components_css/AdminMap.css";

function naturalCompare(a, b) {
  const numA = String(a?.room_number || "").trim();
  const numB = String(b?.room_number || "").trim();
  return numA.localeCompare(numB, undefined, { numeric: true, sensitivity: "base" });
}

function getPolygonCentroid(geometry) {
  if (!geometry || !geometry.coordinates) return null;
  const coords =
    geometry.type === "Polygon"
      ? geometry.coordinates[0]
      : Array.isArray(geometry.coordinates[0]?.[0])
      ? geometry.coordinates[0][0]
      : geometry.coordinates[0];
  if (!coords || !Array.isArray(coords) || coords.length === 0) return null;
  let sumLng = 0;
  let sumLat = 0;
  let count = 0;
  coords.forEach((pt) => {
    if (Array.isArray(pt) && pt.length >= 2) {
      sumLng += Number(pt[0]);
      sumLat += Number(pt[1]);
      count++;
    }
  });
  if (count === 0) return null;
  return {
    latitude: sumLat / count,
    longitude: sumLng / count,
    zoom: 18,
    noPin: true,
    requestedAt: Date.now(),
  };
}

/**
 * Checks whether a point is inside a polygon using ray-casting algorithm.
 * Returns true if point is inside or on the boundary.
 */
function isPointInPolygon(point, polygonPoints) {
  if (!polygonPoints || polygonPoints.length < 3) return true;

  const x = Number(point?.lng ?? point?.longitude);
  const y = Number(point?.lat ?? point?.latitude);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;

  // Ray-casting for point-in-polygon
  let inside = false;
  for (let i = 0, j = polygonPoints.length - 1; i < polygonPoints.length; j = i++) {
    const xi = Number(polygonPoints[i].lng ?? polygonPoints[i].longitude);
    const yi = Number(polygonPoints[i].lat ?? polygonPoints[i].latitude);
    const xj = Number(polygonPoints[j].lng ?? polygonPoints[j].longitude);
    const yj = Number(polygonPoints[j].lat ?? polygonPoints[j].latitude);

    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Validates that all building vertices are inside the center boundary.
 * Returns { valid: boolean, invalidPoints: Array<{index, point}> }
 */
function validateBuildingInsideCenter(buildingPoints, centerPoints) {
  if (!centerPoints || centerPoints.length < 3) return { valid: true, invalidPoints: [] };
  const invalidPoints = [];
  buildingPoints.forEach((point, index) => {
    if (!isPointInOrNearPolygon(point, centerPoints, 15)) {
      invalidPoints.push({ index, point });
    }
  });
  return { valid: invalidPoints.length === 0, invalidPoints };
}

const MOBILE_BREAKPOINT = 768;

function useIsMobile(breakpoint = MOBILE_BREAKPOINT) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth <= breakpoint : false
  );

  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth <= breakpoint);
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [breakpoint]);

  return isMobile;
}

export { isCenterMapped, getOccupancyStatus, getCenterCoordinates };

export default function AdminMap() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, logout } = useAuth();
  const isAdmin = user?.role === "admin";
  const isLgu = user?.role === "lgu_personnel";
  const canManageRooms = isAdmin || isLgu;
  const basePath = isAdmin ? "/admin" : "/lgu";
  const isMobile = useIsMobile();

  const searchParams = useMemo(
    () => new URLSearchParams(location.search),
    [location.search]
  );
  const deepLinkedCenterId = searchParams.get("center");
  const deepLinkedBuildingId = searchParams.get("building");
  const initialMode = searchParams.get("mode");
  const notificationId = searchParams.get("notificationId");
  const deepLinkedLat = searchParams.get("lat");
  const deepLinkedLng = searchParams.get("lng");
  const deepLinkedHazardId = searchParams.get("hazard");
  const deepLinkedRescueId = searchParams.get("rescue");
  const deepLinkedType = searchParams.get("type");
  const deepLinkedBarangay = searchParams.get("barangay");

  // Geocoded barangay fallback state for deep linked coordinates
  const [geoBarangay, setGeoBarangay] = useState("");

  // Centers & hazard zones data
  const centersQuery = useEvacuationCenters(true);
  const hazardZonesQuery = useHazardZones();
  const allHazardReportsQuery = useHazardReports("all", {
    enabled: Boolean(deepLinkedHazardId),
  });
  const publicHazardReportsQuery = usePublicHazardReports({
    enabled: Boolean(deepLinkedHazardId),
  });
  const notificationsQuery = useNotifications({
    enabled: Boolean(notificationId),
  });

  const centers = centersQuery.data ?? null;
  const hazardZones = hazardZonesQuery.data ?? null;
  const { rooms: allLoadedRooms } = useRoomsForCenters(centers);
  const { buildingsGeoJSON, refetch: refetchBuildings } = useBuildingsForCenters(centers);

  // Map of center ID -> active room count for list rows
  const roomsCountByCenterId = useMemo(() => {
    const counts = {};
    if (Array.isArray(allLoadedRooms)) {
      allLoadedRooms.forEach((r) => {
        const cId = r.evacuation_center_id;
        if (cId != null && r.is_active !== false) {
          counts[cId] = (counts[cId] || 0) + 1;
        }
      });
    }
    return counts;
  }, [allLoadedRooms]);

  // Map of center ID -> active building count for list rows
  const buildingsCountByCenterId = useMemo(() => {
    const counts = {};
    if (buildingsGeoJSON?.features) {
      buildingsGeoJSON.features.forEach((b) => {
        const cId = b.properties?.evacuation_center_id;
        if (cId != null) {
          counts[cId] = (counts[cId] || 0) + 1;
        }
      });
    }
    return counts;
  }, [buildingsGeoJSON]);

  // Unmapped centers count for sidebar badge
  const unmappedCentersCount = useMemo(() => {
    if (!centers?.features) return 0;
    return centers.features.filter((c) => !isCenterMapped(c)).length;
  }, [centers]);

  // Match hazard report across both admin and public queries
  const matchedHazardReport = useMemo(() => {
    if (!deepLinkedHazardId) return null;
    const all = [
      ...(Array.isArray(allHazardReportsQuery.data)
        ? allHazardReportsQuery.data
        : allHazardReportsQuery.data?.data ||
          allHazardReportsQuery.data?.reports ||
          []),
      ...(Array.isArray(publicHazardReportsQuery.data)
        ? publicHazardReportsQuery.data
        : publicHazardReportsQuery.data?.data ||
          publicHazardReportsQuery.data?.reports ||
          []),
    ];
    return (
      all.find((r) => String(r.id) === String(deepLinkedHazardId)) || null
    );
  }, [
    deepLinkedHazardId,
    allHazardReportsQuery.data,
    publicHazardReportsQuery.data,
  ]);

  // Match hazard zone features
  const matchedHazardZone = useMemo(() => {
    if (!deepLinkedHazardId || !hazardZones?.features) return null;
    return (
      hazardZones.features.find((f) => {
        const id = f.properties?.id ?? f.id;
        return String(id) === String(deepLinkedHazardId);
      }) || null
    );
  }, [deepLinkedHazardId, hazardZones]);

  // Selected center for map & summary card
  const [selectedCenter, setSelectedCenter] = useState(null);
  const [mapFocusLocation, setMapFocusLocation] = useState(null);

  // Detailed rooms for the selected center
  const selectedCenterId =
    selectedCenter?.properties?.id ?? selectedCenter?.id ?? null;
  const selectedCenterRoomsQuery = useRooms(selectedCenterId, {
    enabled: Boolean(selectedCenterId),
  });
  const selectedCenterRooms = useMemo(() => {
    if (
      Array.isArray(selectedCenterRoomsQuery.data) &&
      selectedCenterRoomsQuery.data.length > 0
    ) {
      return selectedCenterRoomsQuery.data.filter((r) => r.is_active !== false);
    }
    if (Array.isArray(allLoadedRooms) && selectedCenterId) {
      return allLoadedRooms.filter(
        (r) =>
          String(r.evacuation_center_id) === String(selectedCenterId) &&
          r.is_active !== false
      );
    }
    return [];
  }, [selectedCenterRoomsQuery.data, allLoadedRooms, selectedCenterId]);

  const selectedCenterMappedRooms = useMemo(() => {
    return selectedCenterRooms.filter(
      (r) => r.latitude != null && r.longitude != null
    );
  }, [selectedCenterRooms]);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState("all"); // "all" | "mapped" | "unmapped"
  const [geocodingResults, setGeocodingResults] = useState([]);
  const [geocodingLoading, setGeocodingLoading] = useState(false);

  // Panel state: Desktop floating panel open by default
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [panelSubView, setPanelSubView] = useState("details"); // "details" | "map_rooms"
  const previousSubViewRef = useRef("details");

  // Mobile Bottom Sheet state: open by default with collapsed / half / full snap heights
  const [bottomSheetOpen, setBottomSheetOpen] = useState(true);

  // Center Details Modal state (Phase 2)
  const [centerModalOpen, setCenterModalOpen] = useState(false);
  const [expandedCenterFamilyIds, setExpandedCenterFamilyIds] = useState({});
  const centerModalDialogRef = useRef(null);
  const centerModalTriggerRef = useRef(null);

  const selectedCenterDetailsQuery = useQuery({
    queryKey: ["evacuation-center-details", selectedCenterId],
    queryFn: () => api.getEvacuationCenterDetails(selectedCenterId),
    enabled: Boolean(selectedCenterId && centerModalOpen),
    staleTime: 10_000,
  });

  const handleCloseCenterModal = useCallback(() => {
    setCenterModalOpen(false);
    const trigger = centerModalTriggerRef.current;
    if (trigger && typeof trigger.focus === "function") {
      setTimeout(() => {
        try {
          trigger.focus();
        } catch (e) {}
      }, 0);
    }
  }, []);

  useEffect(() => {
    if (centerModalOpen && centerModalDialogRef.current) {
      const timer = setTimeout(() => {
        try {
          centerModalDialogRef.current?.focus();
        } catch (e) {}
      }, 20);
      return () => clearTimeout(timer);
    }
  }, [centerModalOpen]);

  // Room Details Modal state (Completely independent of center card!)
  const [roomModalOpen, setRoomModalOpen] = useState(false);

  // Placement Flow state
  const [isMapping, setIsMapping] = useState(false);
  const [mappingStep, setMappingStep] = useState("footprint"); // "footprint" | "entrance" | "confirm"
  const [editingCenter, setEditingCenter] = useState(null);
  const [footprintPoints, setFootprintPoints] = useState([]);
  const [entrancePoints, setEntrancePoints] = useState([]);
  const [mappingTool, setMappingTool] = useState("draw"); // "draw" | "pan"
  const [mapZoom, setMapZoom] = useState(12);
  const [savingMap, setSavingMap] = useState(false);

  // Room Mapping flow state
  const [isPlacingRoom, setIsPlacingRoom] = useState(false);
  const [placingRoom, setPlacingRoom] = useState(null);
  const [remainingUnmappedRooms, setRemainingUnmappedRooms] = useState([]);
  const [initialUnmappedCount, setInitialUnmappedCount] = useState(0);

  // Room Marker hover & selection sync
  const [hoveredRoomId, setHoveredRoomId] = useState(null);
  const [selectedRoomId, setSelectedRoomId] = useState(null);

  // Track selected room object across both current center and all loaded rooms
  const selectedRoom = useMemo(() => {
    if (!selectedRoomId) return null;
    const inCenter = selectedCenterRooms.find((r) => String(r.id) === String(selectedRoomId));
    if (inCenter) return inCenter;
    if (Array.isArray(allLoadedRooms)) {
      return allLoadedRooms.find((r) => String(r.id) === String(selectedRoomId)) || null;
    }
    return null;
  }, [selectedCenterRooms, allLoadedRooms, selectedRoomId]);

  // Click on room marker or list item opens independent Room Details modal
  const handleRoomClick = useCallback((room) => {
    if (!room) return;
    setSelectedRoomId(room.id);
    setRoomModalOpen(true);
  }, []);

  const handleCloseRoomModal = useCallback(() => {
    setRoomModalOpen(false);
    setSelectedRoomId(null);
  }, []);

  // Building Details & Selection state (Independent of center card)
  const [selectedBuildingId, setSelectedBuildingId] = useState(null);
  const [selectedBuildingDetail, setSelectedBuildingDetail] = useState(null);
  const [buildingDetailsData, setBuildingDetailsData] = useState(null);
  const [buildingDetailsLoading, setBuildingDetailsLoading] = useState(false);
  const [buildingDetailsError, setBuildingDetailsError] = useState(null);
  const [expandedStaffRoomIds, setExpandedStaffRoomIds] = useState({});
  const [expandedStaffFamilyIds, setExpandedStaffFamilyIds] = useState({});
  const [activeOverflowMenuId, setActiveOverflowMenuId] = useState(null);
  const [renamingBuilding, setRenamingBuilding] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [deletingBuilding, setDeletingBuilding] = useState(null);
  const [managingRoomsBuilding, setManagingRoomsBuilding] = useState(null);
  const [managingRoomIds, setManagingRoomIds] = useState([]);
  const [redrawingBuildingId, setRedrawingBuildingId] = useState(null);
  const [mobileSheetSnap, setMobileSheetSnap] = useState("half");
  const [buildingModalOpen, setBuildingModalOpen] = useState(false);

  // Map Rooms view tab: "buildings" | "points"
  const [mapRoomsTab, setMapRoomsTab] = useState("buildings");

  // Room suggestions & building linking state
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [managingBuildingId, setManagingBuildingId] = useState(null);

  // Add building guided 3-step flow state (Change 2)
  const [isAddingBuilding, setIsAddingBuilding] = useState(false);
  const [addBuildingStep, setAddBuildingStep] = useState("draw"); // "draw" | "name" | "rooms"
  const [newBuildingName, setNewBuildingName] = useState("");
  const [newBuildingRoomIds, setNewBuildingRoomIds] = useState([]);
  const [newBuildingPoints, setNewBuildingPoints] = useState([]);
  const [isDrawingBuilding, setIsDrawingBuilding] = useState(false);
  const [roomSearchQuery, setRoomSearchQuery] = useState("");
  const [roomRangeInput, setRoomRangeInput] = useState("");
  const [isSavingBuilding, setIsSavingBuilding] = useState(false);
  const [panelHeaderMenuOpen, setPanelHeaderMenuOpen] = useState(false);

  // Building edit mode toolbar state
  const [buildingEditOriginalPoints, setBuildingEditOriginalPoints] = useState([]);
  const [buildingEditUndoStack, setBuildingEditUndoStack] = useState([]);
  const [buildingEditBoundaryError, setBuildingEditBoundaryError] = useState(null);

  // Center redraw state
  const [redrawingCenterId, setRedrawingCenterId] = useState(null);
  const [centerEditOriginalPoints, setCenterEditOriginalPoints] = useState([]);
  const [centerEditOriginalEntrances, setCenterEditOriginalEntrances] = useState([]);

  // Close overflow menu when clicking outside
  useEffect(() => {
    function handleWindowClick(e) {
      if (activeOverflowMenuId && !e.target.closest(".admin-bld-overflow-wrap")) {
        setActiveOverflowMenuId(null);
      }
    }
    window.addEventListener("click", handleWindowClick);
    return () => window.removeEventListener("click", handleWindowClick);
  }, [activeOverflowMenuId]);

  // Fetch full building details when inline detail view is opened
  useEffect(() => {
    if (!selectedBuildingDetail) {
      setBuildingDetailsData(null);
      setBuildingDetailsError(null);
      return;
    }
    const bId = selectedBuildingDetail.properties?.id ?? selectedBuildingDetail.id;
    if (!bId) return;
    setBuildingDetailsLoading(true);
    setBuildingDetailsError(null);
    api.getBuildingDetails(bId)
      .then((res) => {
        setBuildingDetailsData(res);
      })
      .catch((err) => {
        console.error("Failed to load building details:", err);
        setBuildingDetailsError("Failed to load details for this building.");
      })
      .finally(() => {
        setBuildingDetailsLoading(false);
      });
  }, [selectedBuildingDetail]);

  const handleSelectBuildingRow = useCallback((b) => {
    if (!b) return;
    const bId = b.properties?.id ?? b.id;
    setSelectedBuildingId(bId);
    setSelectedBuildingDetail(b);
    const centroid = getPolygonCentroid(b.geometry);
    if (centroid) {
      setMapFocusLocation(centroid);
    }
  }, []);

  const handleBuildingClick = useCallback((building) => {
    if (!building) return;
    const bId = building.properties?.id ?? building.id;
    if (bId) {
      setSelectedBuildingId(bId);
      if (panelSubView === "map_rooms") {
        setSelectedBuildingDetail(building);
        const centroid = getPolygonCentroid(building.geometry);
        if (centroid) {
          setMapFocusLocation(centroid);
        }
      } else {
        setBuildingModalOpen(true);
      }
    }
  }, [panelSubView]);

  const handleCloseBuildingModal = useCallback(() => {
    setBuildingModalOpen(false);
    setSelectedBuildingId(null);
  }, []);

  // Center buildings for selected center
  const centerBuildings = useMemo(() => {
    if (!buildingsGeoJSON?.features || !selectedCenterId) return [];
    return buildingsGeoJSON.features.filter(
      (f) => String(f.properties?.evacuation_center_id) === String(selectedCenterId)
    );
  }, [buildingsGeoJSON, selectedCenterId]);

  // Unlinked rooms for selected center (rooms without building_id)
  const unlinkedRooms = useMemo(() => {
    return selectedCenterRooms.filter((r) => r.is_active !== false && !r.building_id);
  }, [selectedCenterRooms]);

  // Pending room suggestions (not yet linked)
  const pendingSuggestions = useMemo(() => {
    return suggestions.filter((s) => !s.is_already_linked);
  }, [suggestions]);

  // Fetch room suggestions when opening map rooms
  useEffect(() => {
    if (panelSubView === "map_rooms" && selectedCenterId) {
      setLoadingSuggestions(true);
      api.suggestRoomsForBuildings(selectedCenterId)
        .then((res) => {
          setSuggestions(res.suggestions || []);
        })
        .catch((err) => {
          console.warn("Failed to load room suggestions:", err);
          setSuggestions([]);
        })
        .finally(() => {
          setLoadingSuggestions(false);
        });
    }
  }, [panelSubView, selectedCenterId]);

  const handleConfirmSuggestion = async (s) => {
    try {
      await api.updateBuilding(s.building_id, {
        add_room_ids: [s.room_id],
      });
      await invalidateEvacuationQueries(queryClient);
      await refetchBuildings();
      setSuggestions((prev) =>
        prev.map((item) =>
          item.room_id === s.room_id ? { ...item, is_already_linked: true } : item
        )
      );
      showPlacementToast(`Linked Room ${s.room_number} to ${s.building_name}`);
    } catch (err) {
      console.error("Failed to link room to building:", err);
      showPlacementToast("Failed to link room.");
    }
  };

  const handleConfirmAllSuggestions = async () => {
    if (pendingSuggestions.length === 0) return;
    try {
      const grouped = {};
      pendingSuggestions.forEach((s) => {
        if (!grouped[s.building_id]) grouped[s.building_id] = [];
        grouped[s.building_id].push(s.room_id);
      });
      for (const [bId, rIds] of Object.entries(grouped)) {
        await api.updateBuilding(bId, {
          add_room_ids: rIds,
        });
      }
      await invalidateEvacuationQueries(queryClient);
      await refetchBuildings();
      setSuggestions((prev) =>
        prev.map((item) => ({ ...item, is_already_linked: true }))
      );
      showPlacementToast(`Confirmed ${pendingSuggestions.length} room assignments`);
    } catch (err) {
      console.error("Failed to link all rooms:", err);
      showPlacementToast("Failed to link some rooms.");
    }
  };

  const handleUnlinkRoom = async (buildingId, roomId, roomNumber) => {
    try {
      await api.updateBuilding(buildingId, {
        remove_room_ids: [roomId],
      });
      await invalidateEvacuationQueries(queryClient);
      await refetchBuildings();
      if (selectedCenterId) {
        api.suggestRoomsForBuildings(selectedCenterId).then((res) => {
          setSuggestions(res.suggestions || []);
        });
      }
      showPlacementToast(`Unlinked Room ${roomNumber}`);
    } catch (err) {
      console.error("Failed to unlink room:", err);
      showPlacementToast("Failed to unlink room.");
    }
  };

  const handleSaveRename = async () => {
    if (!renamingBuilding || !renameValue.trim()) return;
    const bId = renamingBuilding.properties?.id ?? renamingBuilding.id;
    try {
      await api.updateBuilding(bId, { name: renameValue.trim() });
      await invalidateEvacuationQueries(queryClient);
      await refetchBuildings();
      showPlacementToast(`Building renamed to "${renameValue.trim()}".`);
      setRenamingBuilding(null);
      if (
        selectedBuildingDetail &&
        String(selectedBuildingDetail.properties?.id ?? selectedBuildingDetail.id) === String(bId)
      ) {
        setSelectedBuildingDetail((prev) => ({
          ...prev,
          properties: { ...prev.properties, name: renameValue.trim() },
        }));
      }
    } catch (err) {
      console.error("Failed to rename building:", err);
      showPlacementToast("Failed to rename building.");
    }
  };

  const handleConfirmDeleteBuilding = async () => {
    if (!deletingBuilding) return;
    const bId = deletingBuilding.properties?.id ?? deletingBuilding.id;
    try {
      await api.deleteBuilding(bId);
      await invalidateEvacuationQueries(queryClient);
      await refetchBuildings();
      showPlacementToast("Building deleted. Linked rooms unlinked.");
      setDeletingBuilding(null);
      if (
        selectedBuildingDetail &&
        String(selectedBuildingDetail.properties?.id ?? selectedBuildingDetail.id) === String(bId)
      ) {
        setSelectedBuildingDetail(null);
        setSelectedBuildingId(null);
      }
    } catch (err) {
      console.error("Failed to delete building:", err);
      showPlacementToast("Failed to delete building.");
    }
  };

  const handleSaveManageRooms = async () => {
    if (!managingRoomsBuilding) return;
    const bId = managingRoomsBuilding.properties?.id ?? managingRoomsBuilding.id;
    const originalLinked = selectedCenterRooms
      .filter((r) => String(r.building_id) === String(bId))
      .map((r) => r.id);
    const toAdd = managingRoomIds.filter((id) => !originalLinked.includes(id));
    const toRemove = originalLinked.filter((id) => !managingRoomIds.includes(id));

    try {
      await api.updateBuilding(bId, {
        add_room_ids: toAdd,
        remove_room_ids: toRemove,
      });
      await invalidateEvacuationQueries(queryClient);
      await refetchBuildings();
      showPlacementToast("Building room assignments updated.");
      setManagingRoomsBuilding(null);
      if (
        selectedBuildingDetail &&
        String(selectedBuildingDetail.properties?.id ?? selectedBuildingDetail.id) === String(bId)
      ) {
        api.getBuildingDetails(bId).then(setBuildingDetailsData).catch(() => {});
      }
    } catch (err) {
      console.error("Failed to update building rooms:", err);
      showPlacementToast("Failed to update building rooms.");
    }
  };

  // Start Add Building Guided Flow (Change 2 & Change 3)
  const startAddBuildingFlowForCenter = useCallback((center) => {
    if (!center) return;
    const props = center.properties || center;
    const centerId = props.id ?? center.id;
    setSelectedCenter(center);
    setCenterModalOpen(false);
    setPanelCollapsed(false);
    setBottomSheetOpen(true);
    setPanelSubView("map_rooms");
    setMapRoomsTab("buildings");
    setSelectedBuildingDetail(null);
    setSelectedBuildingId(null);
    setRedrawingBuildingId(null);

    // Focus map on center
    const coords = getCenterCoordinates(center);
    if (coords) {
      setMapFocusLocation({
        ...coords,
        zoom: 18,
        noPin: true,
        requestedAt: Date.now(),
      });
    }

    // Default next building name: "Building " + (existing buildings for this center + 1)
    let bldCount = 0;
    if (buildingsGeoJSON?.features) {
      bldCount = buildingsGeoJSON.features.filter(
        (b) => String(b.properties?.evacuation_center_id) === String(centerId)
      ).length;
    }
    const defaultName = `Building ${bldCount + 1}`;

    setIsAddingBuilding(true);
    setIsDrawingBuilding(true);
    setAddBuildingStep("draw");
    setNewBuildingPoints([]);
    setNewBuildingName(defaultName);
    setNewBuildingRoomIds([]);
    setRoomSearchQuery("");
    setRoomRangeInput("");
    setPanelHeaderMenuOpen(false);
  }, [buildingsGeoJSON]);

  const handleDoubleTapFinish = useCallback(() => {
    if (isDrawingBuilding && addBuildingStep === "draw") {
      if (newBuildingPoints.length >= 3) {
        setAddBuildingStep("name");
        showPlacementToast("Outline finished. Now name your building.");
      } else {
        showPlacementToast("Click at least 3 corners before finishing.");
      }
    }
  }, [isDrawingBuilding, addBuildingStep, newBuildingPoints.length]);

  const handleBasemapBuildingClick = useCallback((pts) => {
    if (isDrawingBuilding && addBuildingStep === "draw") {
      setNewBuildingPoints(pts);
      showPlacementToast("Basemap outline selected. Double-click or click Next to name.");
    }
  }, [isDrawingBuilding, addBuildingStep]);

  const handleSaveBuildingWithRooms = async () => {
    if (newBuildingPoints.length < 3) {
      alert("Please click at least 3 corners on the map to define the building outline.");
      setAddBuildingStep("draw");
      return;
    }
    if (!newBuildingName.trim()) {
      alert("Please enter a building name.");
      setAddBuildingStep("name");
      return;
    }
    const coords = newBuildingPoints.map((p) => [Number(p.lng), Number(p.lat)]);
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      coords.push([first[0], first[1]]);
    }

    setIsSavingBuilding(true);
    try {
      if (redrawingBuildingId) {
        await api.updateBuilding(redrawingBuildingId, {
          coordinates: coords,
        });
        await invalidateEvacuationQueries(queryClient);
        await refetchBuildings();
        setIsAddingBuilding(false);
        setIsDrawingBuilding(false);
        setRedrawingBuildingId(null);
        setNewBuildingPoints([]);
        showPlacementToast("Building outline redrawn successfully.");
      } else {
        const savedName = newBuildingName.trim();
        const roomCountLinked = newBuildingRoomIds.length;

        const created = await api.createBuilding(selectedCenterId, {
          name: savedName,
          coordinates: coords,
          room_ids: newBuildingRoomIds,
        });
        await invalidateEvacuationQueries(queryClient);
        await refetchBuildings();

        const createdId = created?.id || created?.data?.id;
        if (createdId) {
          setSelectedBuildingId(createdId);
        }

        setIsAddingBuilding(false);
        setIsDrawingBuilding(false);
        setAddBuildingStep(null);
        setNewBuildingName("");
        setNewBuildingRoomIds([]);
        setNewBuildingPoints([]);

        // Small toast with "Back to center" link per change_3_deep_links
        setSaveNotice({
          message: `${savedName} saved - ${roomCountLinked} ${
            roomCountLinked === 1 ? "room" : "rooms"
          } linked`,
          centerId: selectedCenterId,
        });
      }
    } catch (err) {
      console.error("Failed to save building:", err);
      alert(err.message || "Failed to save building.");
    } finally {
      setIsSavingBuilding(false);
    }
  };

  const handleCancelDrawingBuilding = () => {
    setIsAddingBuilding(false);
    setIsDrawingBuilding(false);
    // Restore building layer filter (un-hide the saved outline) if we were redrawing
    if (redrawingBuildingId) {
      
      
      
      
    }
    setRedrawingBuildingId(null);
    setAddBuildingStep(null);
    setNewBuildingName("");
    setNewBuildingRoomIds([]);
    setNewBuildingPoints([]);
    setBuildingEditOriginalPoints([]);
    setBuildingEditUndoStack([]);
    setPanelHeaderMenuOpen(false);
  };

  // Save building outline in edit mode (redrawingBuildingId is set)
  const handleSaveBuildingOutline = useCallback(async () => {
    if (!redrawingBuildingId || newBuildingPoints.length < 3) return;

    // Validate building is inside center boundary
    const centerPoints = selectedCenter?.geometry ? polygonToPoints(selectedCenter.geometry) : [];
    const { valid, invalidPoints } = validateBuildingInsideCenter(newBuildingPoints, centerPoints);

    if (!valid) {
      setBuildingEditBoundaryError(
        `Keep the building inside the center boundary. ${invalidPoints.length} vertex${invalidPoints.length !== 1 ? 'es' : ''} outside.`
      );
      return;
    }
    setBuildingEditBoundaryError(null);

    const coords = newBuildingPoints.map((p) => [Number(p.lng), Number(p.lat)]);
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      coords.push([first[0], first[1]]);
    }

    setIsSavingBuilding(true);
    try {
      await api.updateBuilding(redrawingBuildingId, { coordinates: coords });
      await invalidateEvacuationQueries(queryClient);
      await refetchBuildings();
      // Set selectedCenter from refetched centers list by id (never from response copy)
      const bldId = redrawingBuildingId;
      setIsDrawingBuilding(false);
      setRedrawingBuildingId(null);
      setNewBuildingPoints([]);
      setBuildingEditOriginalPoints([]);
      setBuildingEditUndoStack([]);
      setBuildingEditBoundaryError(null);
      // Set selectedCenter from refetched centers list by id (never from response copy)
      const selCenterId = selectedCenter?.id ?? selectedCenter?.properties?.id;
      if (selCenterId) {
        const refetchedCenters = queryClient.getQueryData(queryKeys.evacuationCenters(true));
        if (refetchedCenters?.features) {
          const match = refetchedCenters.features.find((c) => {
            const cid = c.properties?.id ?? c.id;
            return String(cid) === String(selCenterId);
          });
          if (match) setSelectedCenter(match);
        }
      }
    } catch (err) {
      console.error("Failed to save building outline:", err);
      alert(err.message || "Failed to save building outline.");
    } finally {
      setIsSavingBuilding(false);
    }
  }, [redrawingBuildingId, newBuildingPoints, selectedCenter, queryClient, refetchBuildings]);

  // Undo last vertex change
  const handleUndoBuildingEdit = useCallback(() => {
    if (buildingEditUndoStack.length > 0) {
      const previousPoints = buildingEditUndoStack[buildingEditUndoStack.length - 1];
      setNewBuildingPoints(previousPoints);
      setBuildingEditUndoStack((prev) => prev.slice(0, -1));
    }
  }, [buildingEditUndoStack]);

  // Reset to original saved outline
  const handleResetBuildingEdit = useCallback(() => {
    if (buildingEditOriginalPoints.length > 0) {
      setNewBuildingPoints(buildingEditOriginalPoints);
      setBuildingEditUndoStack([]);
    }
  }, [buildingEditOriginalPoints]);

  // Redraw from scratch - clear all points
  const handleRedrawBuildingEdit = useCallback(() => {
    // Push current state to undo stack before clearing
    if (newBuildingPoints.length > 0) {
      setBuildingEditUndoStack((prev) => [...prev, newBuildingPoints]);
    }
    setNewBuildingPoints([]);
  }, [newBuildingPoints]);

  // Handler for building vertex handle changes during edit mode
  const handleEditingBuildingPointsChange = useCallback((newPoints, isFinal) => {
    // Push to undo stack when drag is finalized
    if (isFinal) {
      setBuildingEditUndoStack((prev) => [...prev, newBuildingPoints]);
    }
    setNewBuildingPoints(newPoints);
  }, []);

  const unassignedRooms = useMemo(() => {
    return selectedCenterRooms.filter(
      (r) => r.is_active !== false && (r.building_id == null || !r.building_id)
    );
  }, [selectedCenterRooms]);

  const filteredUnassignedRooms = useMemo(() => {
    let list = unassignedRooms;
    if (roomSearchQuery.trim()) {
      const q = roomSearchQuery.toLowerCase().trim();
      list = list.filter((r) =>
        String(r.room_number || "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [unassignedRooms, roomSearchQuery]);

  const handleToggleRoomCheckbox = (roomId) => {
    setNewBuildingRoomIds((prev) =>
      prev.includes(roomId) ? prev.filter((id) => id !== roomId) : [...prev, roomId]
    );
  };

  const handleSelectAllUnmappedRooms = () => {
    setNewBuildingRoomIds(unassignedRooms.map((r) => r.id));
  };

  const handleApplyRoomRange = () => {
    if (!roomRangeInput.trim()) return;
    const input = roomRangeInput.trim();
    const parts = input.split(",").map((p) => p.trim());
    const matchedIds = new Set(newBuildingRoomIds);

    parts.forEach((part) => {
      const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1], 10);
        const end = parseInt(rangeMatch[2], 10);
        const minVal = Math.min(start, end);
        const maxVal = Math.max(start, end);

        unassignedRooms.forEach((rm) => {
          const numMatch = String(rm.room_number || "").match(/\d+/);
          if (numMatch) {
            const val = parseInt(numMatch[0], 10);
            if (val >= minVal && val <= maxVal) {
              matchedIds.add(rm.id);
            }
          }
        });
      } else {
        const singleTrim = part.toLowerCase();
        unassignedRooms.forEach((rm) => {
          if (
            String(rm.room_number || "").toLowerCase() === singleTrim ||
            String(rm.room_number || "").match(/\d+/)?.[0] === singleTrim
          ) {
            matchedIds.add(rm.id);
          }
        });
      }
    });

    setNewBuildingRoomIds(Array.from(matchedIds));
    setRoomRangeInput("");
  };

  const handleMapBackgroundClick = useCallback(() => {
    if (roomModalOpen) {
      handleCloseRoomModal();
    }
    if (buildingModalOpen) {
      handleCloseBuildingModal();
    }
  }, [roomModalOpen, buildingModalOpen, handleCloseRoomModal, handleCloseBuildingModal]);

  // Placement flow toast message (e.g. Entrance must be on outline)
  const showPlacementToast = (msg) => {
    setPlacementToast(msg);
    setTimeout(() => {
      setPlacementToast(null);
    }, 2500);
  };
  const [placementToast, setPlacementToast] = useState(null);

  // Success Notice with "Back to center" button
  const [saveNotice, setSaveNotice] = useState(null);

  // Track if deep link center & mode=place have been initialized
  const handledModePlaceKeyRef = useRef("");

  // Handle escape key to close room/building modal, cancel room placement, return to center details or close bottom sheet
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "Escape") {
        if (roomModalOpen) {
          handleCloseRoomModal();
          return;
        }
        if (buildingModalOpen) {
          handleCloseBuildingModal();
          return;
        }
        if (centerModalOpen) {
          handleCloseCenterModal();
          return;
        }
        if (isDrawingBuilding) {
          setIsDrawingBuilding(false);
          setNewBuildingPoints([]);
          return;
        }
        if (isPlacingRoom) {
          handleCancelPlacement();
          return;
        }
        if (panelSubView === "map_rooms") {
          setPanelSubView("details");
          return;
        }
        if (bottomSheetOpen) {
          setBottomSheetOpen(false);
          return;
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    bottomSheetOpen,
    isPlacingRoom,
    isDrawingBuilding,
    panelSubView,
    roomModalOpen,
    buildingModalOpen,
    centerModalOpen,
    handleCloseRoomModal,
    handleCloseBuildingModal,
    handleCloseCenterModal,
  ]);

  // Mapbox Geocoding for "Places" search group (limited to PH near Sogod, Southern Leyte)
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setGeocodingResults([]);
      setGeocodingLoading(false);
      return;
    }

    const timer = setTimeout(async () => {
      setGeocodingLoading(true);
      try {
        const token = import.meta.env.VITE_MAPBOX_TOKEN;
        if (!token) return;
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
          q
        )}.json?country=ph&proximity=124.996,10.435&limit=4&access_token=${token}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          setGeocodingResults(data.features || []);
        } else {
          setGeocodingResults([]);
        }
      } catch (err) {
        console.warn("Places geocoding search failed:", err);
        setGeocodingResults([]);
      } finally {
        setGeocodingLoading(false);
      }
    }, 280);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Check and flag problem entrances in admin map console
  useEffect(() => {
    api.getProblemEntrances()
      .then((res) => {
        const problems = res?.problem_entrances || [];
        problems.forEach((p) => {
          console.warn(
            `[Entrance Warning] Center "${p.center_name}" ${p.entrance_name}: ${p.warning} (Coordinates: [${p.latitude}, ${p.longitude}], Nearest road: ${p.nearest_road})`
          );
        });
      })
      .catch((err) => {
        console.warn("Could not check problem entrances:", err);
      });
  }, []);

  // Deep Link Handling: <route>?center=<id>&building=<id>&mode=<place|redraw|link_rooms>
  const handledBuildingDeepLinkRef = useRef(false);
  useEffect(() => {
    if (!centers?.features) return;

    if (deepLinkedCenterId) {
      const match = centers.features.find((c) => {
        const id = c.properties?.id ?? c.id;
        return String(id) === String(deepLinkedCenterId);
      });

      if (match) {
        setSelectedCenter(match);

        const modeKey = `${deepLinkedCenterId}_${initialMode}`;

        // Read mode=place once and start the placement flow
        if (initialMode === "place" && handledModePlaceKeyRef.current !== modeKey) {
          handledModePlaceKeyRef.current = modeKey;
          startPlacementFlow(match);

          // Remove mode=place from URL once read
          const nextSearch = new URLSearchParams(window.location.search);
          nextSearch.delete("mode");
          const query = nextSearch.toString();
          navigate(`${window.location.pathname}${query ? `?${query}` : ""}`, {
            replace: true,
          });
        } else if (
          (initialMode === "link_rooms" || initialMode === "add_building") &&
          handledModePlaceKeyRef.current !== modeKey
        ) {
          handledModePlaceKeyRef.current = modeKey;
          startAddBuildingFlowForCenter(match);

          const nextSearch = new URLSearchParams(window.location.search);
          nextSearch.delete("mode");
          const query = nextSearch.toString();
          navigate(`${window.location.pathname}${query ? `?${query}` : ""}`, {
            replace: true,
          });
        }
      }
    }
  }, [centers, deepLinkedCenterId, initialMode, navigate]);

  useEffect(() => {
    if (!deepLinkedBuildingId || handledBuildingDeepLinkRef.current) return;
    if (!buildingsGeoJSON?.features?.length) return;

    const matchedBuilding = buildingsGeoJSON.features.find((b) => {
      const bId = b.properties?.id ?? b.id;
      return String(bId) === String(deepLinkedBuildingId);
    });
    if (!matchedBuilding) return;

    handledBuildingDeepLinkRef.current = true;
    const bId = matchedBuilding.properties?.id ?? matchedBuilding.id;
    setSelectedBuildingId(bId);
    setSelectedBuildingDetail(matchedBuilding);
    setPanelCollapsed(false);

    const centroid = getPolygonCentroid(matchedBuilding.geometry);
    if (centroid) {
      setMapFocusLocation(centroid);
    }

    if (initialMode === "redraw") {
      const bOrigPoints = polygonToPoints(matchedBuilding.geometry);
      setBuildingEditOriginalPoints(bOrigPoints.length >= 3 ? bOrigPoints : []);
      setBuildingEditUndoStack([]);
      setPanelSubView("map_rooms");
      setMapRoomsTab("buildings");
      setRedrawingBuildingId(bId);
      setIsDrawingBuilding(true);
      // Initialize with existing polygon points so vertex handles appear for editing
      setNewBuildingPoints(bOrigPoints.length >= 3 ? bOrigPoints : []);
      // Hide the saved building outline during redraw




    } else {
      setBuildingModalOpen(true);
    }
  }, [deepLinkedBuildingId, buildingsGeoJSON, initialMode]);

  function formatHazardType(rawType) {
    if (!rawType) return "Hazard";
    const cleaned = String(rawType).trim();
    return cleaned
      .split(/[\s_-]+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
  }

  function formatBarangayLabel(rawBrgy) {
    if (!rawBrgy) return "";
    const cleaned = String(rawBrgy).trim();
    if (!cleaned) return "";
    if (/^(brgy\.?|barangay)\s+/i.test(cleaned)) {
      return cleaned.replace(/^(brgy\.?|barangay)\s+/i, "Brgy. ");
    }
    return `Brgy. ${cleaned}`;
  }

  // Reverse geocode deep-linked coordinates to obtain the barangay automatically
  useEffect(() => {
    if (!deepLinkedLat || !deepLinkedLng) {
      setGeoBarangay("");
      return;
    }
    const lat = Number(deepLinkedLat);
    const lng = Number(deepLinkedLng);
    const token = import.meta.env.VITE_MAPBOX_TOKEN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !token) return;

    let cancelled = false;
    const url = `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${lng}&latitude=${lat}&types=locality,neighborhood,place&access_token=${encodeURIComponent(
      token
    )}`;

    fetch(url)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        if (cancelled) return;
        const properties = data.features?.[0]?.properties;
        const context = properties?.context || {};
        const resolved =
          context.neighborhood?.name ||
          context.locality?.name ||
          context.place?.name ||
          properties?.name ||
          "";
        if (resolved) {
          setGeoBarangay(resolved);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [deepLinkedLat, deepLinkedLng]);

  // Deep Link Handling: <route>?lat=<lat>&lng=<lng>&hazard=<id> or ?lat=<lat>&lng=<lng>&rescue=<id>
  // Only show incident marker for Hazard Reports/Rescue Alerts with explicit incident param
  useEffect(() => {
    if (deepLinkedLat && deepLinkedLng && (deepLinkedHazardId || deepLinkedRescueId)) {
      const lat = Number(deepLinkedLat);
      const lng = Number(deepLinkedLng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        let label = "Incident Location";

        if (deepLinkedHazardId) {
          const rawType =
            deepLinkedType ||
            matchedHazardReport?.report_type ||
            matchedHazardReport?.hazard_type ||
            matchedHazardReport?.type ||
            matchedHazardZone?.properties?.hazard_type ||
            matchedHazardZone?.properties?.name ||
            "";

          const rawBarangay =
            deepLinkedBarangay ||
            matchedHazardReport?.barangay ||
            matchedHazardReport?.barangay_name ||
            matchedHazardZone?.properties?.barangay ||
            matchedHazardZone?.properties?.barangay_name ||
            geoBarangay ||
            "";

          const typeName = rawType ? formatHazardType(rawType) : "Hazard";

          if (rawBarangay) {
            label = `${typeName} • ${formatBarangayLabel(rawBarangay)}`;
          } else if (rawType) {
            label = `${typeName} Report`;
          } else {
            label = "Reported Hazard";
          }
        } else if (deepLinkedRescueId) {
          const rescueBarangay = deepLinkedBarangay || geoBarangay || "";
          if (rescueBarangay) {
            label = `Rescue Request • ${formatBarangayLabel(rescueBarangay)}`;
          } else {
            label = "Rescue Request";
          }
        }

        setMapFocusLocation({
          latitude: lat,
          longitude: lng,
          zoom: 16,
          hazardId: deepLinkedHazardId,
          rescueId: deepLinkedRescueId,
          label,
          requestedAt: Date.now(),
        });
      }
    } else if (!deepLinkedHazardId && !deepLinkedRescueId) {
      // Clear incident marker when no hazard/rescue param (e.g. user selects a center)
      setMapFocusLocation(null);
    }
  }, [
    deepLinkedLat,
    deepLinkedLng,
    deepLinkedHazardId,
    deepLinkedRescueId,
    deepLinkedType,
    deepLinkedBarangay,
    matchedHazardReport,
    matchedHazardZone,
    geoBarangay,
  ]);

  // Start placement flow for a center
  function startPlacementFlow(center) {
    if (!center) return;
    const props = center.properties || center;
    const centerId = props.id || center.id;
    setEditingCenter(center);
    setSelectedCenter(center);
    setFootprintPoints([]);
    const originalPoints = polygonToPoints(center.geometry);
    setCenterEditOriginalPoints(originalPoints);

    // Hide the saved center outline during redraw
    if (originalPoints.length >= 3) {
      setRedrawingCenterId(centerId);
      
      
    }

    const rawEntrances = Array.isArray(props.entrances) ? props.entrances : [];
    const normalizedEntrances = rawEntrances
      .map((e) => {
        const lat = Number(e?.lat ?? e?.latitude);
        const lng = Number(e?.lng ?? e?.longitude);
        return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
      })
      .filter(Boolean);
    setEntrancePoints(normalizedEntrances);

    setMappingTool("draw");
    setMappingStep("footprint");
    setIsMapping(true);
    setSaveNotice(null);
    setPlacementToast(null);
    if (bottomSheetOpen) {
      setBottomSheetOpen(false);
    }
  }

  // Start placement for a specific room (or next unmapped)
  function handleStartPlacement(room, unmappedList = []) {
    if (!room) return;
    setPlacingRoom(room);
    setRemainingUnmappedRooms(unmappedList);
    setInitialUnmappedCount(unmappedList.length);
    setIsPlacingRoom(true);
    if (isMobile) {
      setBottomSheetOpen(false);
    } else {
      setPanelCollapsed(false);
    }
  }

  function handleCancelPlacement() {
    setIsPlacingRoom(false);
    setPlacingRoom(null);
    setRemainingUnmappedRooms([]);
  }

  function handleDonePlacement() {
    setIsPlacingRoom(false);
    setPlacingRoom(null);
    setRemainingUnmappedRooms([]);
  }

  function handleSkipRoom() {
    if (!isPlacingRoom || !placingRoom) return;

    const nextRemaining = remainingUnmappedRooms.filter(
      (r) => r.id !== placingRoom.id
    );
    setRemainingUnmappedRooms(nextRemaining);

    if (nextRemaining.length > 0) {
      setPlacingRoom(nextRemaining[0]);
      showPlacementToast(`Skipped ${placingRoom.room_number}.`);
    } else {
      setIsPlacingRoom(false);
      setPlacingRoom(null);
      setSaveNotice({
        type: "room",
        message: "No more unmapped rooms.",
        centerId: selectedCenter?.properties?.id || selectedCenter?.id,
      });
    }
  }

  async function handleMapClickForRoom(latlng) {
    if (!isPlacingRoom || !placingRoom) return;

    try {
      await api.updateRoomLocation(placingRoom.id, {
        latitude: latlng.lat,
        longitude: latlng.lng,
      });

      await invalidateEvacuationQueries(queryClient);
      showPlacementToast(`Room "${placingRoom.room_number}" mapped.`);

      const nextRemaining = remainingUnmappedRooms.filter(
        (r) => r.id !== placingRoom.id
      );
      setRemainingUnmappedRooms(nextRemaining);

      if (nextRemaining.length > 0) {
        setPlacingRoom(nextRemaining[0]);
      } else {
        setIsPlacingRoom(false);
        setPlacingRoom(null);
        setSaveNotice({
          type: "room",
          message: "All rooms are mapped.",
          centerId: selectedCenter?.properties?.id || selectedCenter?.id,
        });
      }
    } catch (err) {
      console.error("Failed to map room location:", err);
      showPlacementToast(err.message || "Failed to save room location.");
    }
  }

  async function handleRemoveLocation(room) {
    if (!room) return;
    const confirmed = window.confirm(
      `Remove map location for "${room.room_number}"? The room will become unmapped.`
    );
    if (!confirmed) return;

    try {
      await api.updateRoomLocation(room.id, {
        latitude: null,
        longitude: null,
      });
      await invalidateEvacuationQueries(queryClient);
      showPlacementToast(`Location removed for "${room.room_number}".`);
    } catch (err) {
      console.error("Failed to remove room location:", err);
      alert(err.message || "Failed to remove room location.");
    }
  }

  // Cancel placement flow without saving
  function cancelPlacementFlow() {
    setIsMapping(false);
    setMappingStep("footprint");
    setEditingCenter(null);
    setFootprintPoints([]);
    // Restore original entrances if they were filtered during step transition
    if (centerEditOriginalEntrances.length > 0) {
      setEntrancePoints(centerEditOriginalEntrances);
      setCenterEditOriginalEntrances([]);
    } else {
      setEntrancePoints([]);
    }
    setMappingTool("draw");
    setSavingMap(false);
    setPlacementToast(null);
    // Restore center outline if we were redrawing
    if (redrawingCenterId) {
      
      
      setRedrawingCenterId(null);
      setCenterEditOriginalPoints([]);
    }
  }

  // Handle step change with entrance filtering when moving from footprint to entrance
  const handleStepChange = useCallback((nextStep) => {
    if (nextStep === "entrance" && mappingStep === "footprint") {
      const savedEntrances = entrancePoints;
      setCenterEditOriginalEntrances(savedEntrances);
      const footprint = footprintPoints;
      let removedCount = 0;
      // Re-snap each entrance onto the (possibly edited) outline; drop ones now > 15 m away
      const filtered = [];
      savedEntrances.forEach((ent) => {
        const snapped = snapLngLatToPolygonEdge(
          { lng: ent.lng ?? ent.longitude, lat: ent.lat ?? ent.latitude },
          footprint,
          15
        );
        if (!snapped) {
          removedCount++;
          return;
        }
        filtered.push({ ...ent, lng: snapped.lng, lat: snapped.lat });
      });
      setEntrancePoints(filtered);
      if (removedCount > 0) {
        showPlacementToast(removedCount + " entrance(s) removed: outside the new outline.");
      }
    }
    setMappingStep(nextStep);
  }, [mappingStep, footprintPoints, entrancePoints, showPlacementToast]);

  // Save placement flow (outline + entrances)
  async function handleSaveMapPlacement() {
    if (!editingCenter) return;
    const centerId = editingCenter.properties?.id || editingCenter.id;
    if (!centerId) return;

    if (footprintPoints.length < 3) {
      alert("Failed to save map placement. Please ensure footprint has at least 3 points.");
      return;
    }

    setSavingMap(true);
    let savedCenterFeature = null;

    try {
      const payload = {
        polygon: footprintPoints.map((pt) => ({
          lat: Number(pt.lat),
          lng: Number(pt.lng),
        })),
        entrances: entrancePoints.map((p) => ({
          lat: Number(p.lat),
          lng: Number(p.lng),
        })),
      };

      savedCenterFeature = await api.updateEvacuationCenter(centerId, payload);
    } catch (err) {
      console.error("Failed to save mapping placement:", err);
      const serverMessage =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        err?.message;

      if (serverMessage) {
        alert(serverMessage);
      } else if (footprintPoints.length < 3) {
        alert(
          "Failed to save map placement. Please ensure footprint has at least 3 points."
        );
      } else {
        alert("Failed to save map placement. Please try again.");
      }
      setSavingMap(false);
      return;
    }

    // Refresh data after a successful save without failing the save operation
    try {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.evacuationCenters(true),
      });
    } catch (refreshErr) {
      console.warn("Failed to refresh centers query after successful save:", refreshErr);
    }

    const updatedName =
      editingCenter.properties?.name || editingCenter.name || "Center";

    if (redrawingCenterId) {
      setRedrawingCenterId(null);
      setCenterEditOriginalPoints([]);
    }

    setIsMapping(false);
    setEditingCenter(null);
    setPanelCollapsed(false);
    // Set selectedCenter from refetched centers list by id (never from response copy)
    const refetchedCenters = queryClient.getQueryData(queryKeys.evacuationCenters(true));
    if (refetchedCenters?.features) {
      const match = refetchedCenters.features.find((c) => {
        const cid = c.properties?.id ?? c.id;
        return String(cid) === String(centerId);
      });
      if (match) setSelectedCenter(match);
    }
    setFootprintPoints([]);
    setEntrancePoints([]);
    setMappingStep("footprint");
    setPlacementToast(null);
    setSavingMap(false);

    setSaveNotice({
      centerId,
      message: `Saved outline and entrances for ${updatedName}`,
    });
  }

  // Select a center: ease map to center and open Center details modal over the map
  function handleSelectCenter(center) {
    if (!center) return;
    if (typeof document !== "undefined" && document.activeElement) {
      centerModalTriggerRef.current = document.activeElement;
    }
    setSelectedCenter({ ...center, _focusAt: Date.now() });
    setCenterModalOpen(true);
  }

  // Selecting a place from geocoding search flies map to zoom 16
  function handleSelectPlace(feature) {
    if (!feature?.center) return;
    const [lng, lat] = feature.center;
    setMapFocusLocation({
      latitude: lat,
      longitude: lng,
      zoom: 16,
      noPin: true,
      requestedAt: Date.now(),
    });
    if (isMobile) {
      setBottomSheetOpen(false);
    }
  }



  // Sidebar navigation handler
  function handleTabChange(nextTab) {
    if (nextTab === "map") return;
    if (nextTab === "dashboard") {
      navigate("/dashboard");
      return;
    }
    if (nextTab === "profile") {
      navigate("/profile");
      return;
    }
    const path = isAdmin ? "/admin" : "/lgu";
    navigate(`${path}?tab=${encodeURIComponent(nextTab)}`);
  }

  function handleNotificationSelect(notification) {
    const path = isAdmin ? "/admin" : "/lgu";
    const tab =
      notification.resource_type === "hazard_report" ? "reports" : "rescue";
    navigate(`${path}?tab=${tab}&notificationId=${notification.id}`);
  }

  // List calculations
  const allCentersList = useMemo(() => {
    return centers?.features || [];
  }, [centers]);

  const mappedCount = useMemo(() => {
    return allCentersList.filter(isCenterMapped).length;
  }, [allCentersList]);

  const unmappedCount = allCentersList.length - mappedCount;

  const filteredCenters = useMemo(() => {
    return allCentersList.filter((center) => {
      const props = center.properties || center;
      const mapped = isCenterMapped(center);

      if (filter === "mapped" && !mapped) return false;
      if (filter === "unmapped" && mapped) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      const name = String(props.name || "").toLowerCase();
      const address = String(props.address || "").toLowerCase();
      const barangays = (props.barangays || [])
        .map((b) => String(b.name || "").toLowerCase())
        .join(" ");
      return name.includes(q) || address.includes(q) || barangays.includes(q);
    });
  }, [allCentersList, filter, searchQuery]);


  // Render Center List Item (3-row layout: name+type+mapped, location+counts, occupancy)
  function renderCenterItem(center) {
    const props = center.properties || center;
    const centerId = props.id ?? center.id;
    const mapped = isCenterMapped(center);
    const isSelected =
      selectedCenter &&
      String(selectedCenter.properties?.id ?? selectedCenter.id) ===
        String(centerId);
    const active = Boolean(props.is_active);
    const roomCount =
      roomsCountByCenterId[centerId] ??
      props.total_rooms ??
      props.room_count ??
      0;
    const buildingCount = buildingsCountByCenterId[centerId] || 0;
    const capacity = Number(props.capacity || 0);
    const occupied = Number(props.occupied || 0);
    const assigned = Number(props.assigned ?? props.total_assigned ?? 0);
    const occPct =
      capacity > 0 ? Math.min(100, Math.round((occupied / capacity) * 100)) : 0;
    const assignedPct =
      capacity > 0 ? Math.min(100, Math.round((assigned / capacity) * 100)) : 0;
    const isFull = capacity > 0 && occupied >= capacity;
    const barColor =
      capacity <= 0
        ? "#94a3b8"
        : isFull
        ? "#dc2626"
        : occPct >= 70
        ? "#d97706"
        : occupied > 0
        ? "#16a34a"
        : "#94a3b8";

    const barangayLabel =
      props.barangays && props.barangays.length > 0
        ? props.barangays
            .map((b) => displayEntityName(b.name || b))
            .join(", ")
        : displayEntityName(props.barangay_name || props.address) || "Sogod";

    const centerType = props.center_type || "campus";
    const isVenueOrHouse = centerType !== "campus";

    // Center type label and icon
    const typeConfig = {
      campus: { label: "Campus", icon: faBuildingColumns, color: "#2563eb", bg: "#eff6ff" },
      private_property: { label: "Private Property", icon: faHome, color: "#7c3aed", bg: "#f5f3ff" },
      single_venue: { label: "Single Venue", icon: faPlaceOfWorship, color: "#059669", bg: "#ecfdf5" },
    };
    const typeInfo = typeConfig[centerType] || typeConfig.campus;

    // Mapped status chip
    const mappedChip = mapped
      ? { label: "Mapped", color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0" }
      : { label: "Not mapped", color: "#dc2626", bg: "#fef2f2", border: "#fecaca" };

    // Exception badge only: Inactive, Full (Not mapped is now a chip in row 1)
    let exceptionBadge = null;
    if (!active) {
      exceptionBadge = { label: "Inactive", tone: "inactive" };
    } else if (isFull) {
      exceptionBadge = { label: "Full", tone: "full" };
    }

    return (
      <div
        key={centerId}
        role="button"
        tabIndex={0}
        className={`admin-map-center-item ${isSelected ? "is-selected" : ""}`}
        onClick={() => handleSelectCenter(center)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleSelectCenter(center);
          }
        }}
        aria-selected={isSelected}
      >
        <div className="admin-map-item-main">
          {/* Row 1: Name + Type badge + Mapped chip */}
          <div className="admin-map-item-row1">
            <span
              className={`admin-map-status-dot ${active ? "is-active" : "is-inactive"}`}
              title={active ? "Active" : "Inactive"}
              aria-label={active ? "Active" : "Inactive"}
            />
            <span className="admin-map-item-name">{props.name || "Evacuation Center"}</span>
            <span
              className="admin-map-center-type-badge"
              style={{
                backgroundColor: typeInfo.bg,
                color: typeInfo.color,
                borderColor: typeInfo.color,
              }}
              title={typeInfo.label}
            >
              <FontAwesomeIcon icon={typeInfo.icon} size="xs" style={{ marginRight: "4px" }} />
              {typeInfo.label}
            </span>
            <span
              className="admin-map-mapped-chip"
              style={{
                backgroundColor: mappedChip.bg,
                color: mappedChip.color,
                borderColor: mappedChip.border,
              }}
            >
              <FontAwesomeIcon
                icon={mapped ? faMapPin : faCircleExclamation}
                size="xs"
                style={{ marginRight: "4px" }}
              />
              {mappedChip.label}
            </span>
          </div>

          {/* Row 2: Barangay + Room/Building counts (wrapping) */}
          <div className="admin-map-item-row2">
            <span className="admin-map-item-sub-brgy">{barangayLabel}</span>
            <span className="admin-map-item-sub-counts">
              {roomCount} {roomCount === 1 ? "room" : "rooms"}
              {!isVenueOrHouse && buildingCount > 0 && (
                <>
                  {" · "}
                  <FontAwesomeIcon icon={faWarehouse} size="xs" style={{ marginRight: "2px" }} />
                  {buildingCount} {buildingCount === 1 ? "building" : "buildings"}
                </>
              )}
            </span>
          </div>

          {/* Row 3: Occupancy bar + "X of Y here" + exception badge */}
          <div className="admin-map-item-row3">
            <div className="admin-map-item-occ-bar-wrap">
              <span className="admin-map-item-here-text">
                {occupied} of {capacity} here
              </span>
              <div className="admin-map-item-occ-bar" aria-hidden="true">
                {assignedPct > 0 && (
                  <div
                    className="admin-map-item-occ-assigned"
                    style={{ width: `${assignedPct}%` }}
                  />
                )}
                {occPct > 0 && (
                  <div
                    className="admin-map-item-occ-fill"
                    style={{ width: `${occPct}%`, backgroundColor: barColor }}
                  />
                )}
              </div>
            </div>
            {exceptionBadge && (
              <span className={`admin-map-exception-tag is-${exceptionBadge.tone}`}>
                {exceptionBadge.label}
              </span>
            )}
          </div>

          {/* Place on map / Edit polygon button for ALL center types */}
          <div className="admin-map-item-polygon-action-wrap">
            <button
              type="button"
              className="admin-map-center-row-polygon-action"
              onClick={(e) => {
                e.stopPropagation();
                handleCloseCenterModal?.();
                startPlacementFlow(center);
              }}
              title={mapped ? `Edit polygon for ${props.name || "center"}` : `Place ${props.name || "center"} on map`}
              aria-label={mapped ? "Edit polygon" : "Place on map"}
            >
              <FontAwesomeIcon
                icon={mapped ? faPen : faDrawPolygon}
                size="xs"
                style={{ marginRight: "4px" }}
              />
              {mapped ? "Edit polygon" : "Place on map"}
            </button>
          </div>

          {/* Add building button for campus only */}
          {!isVenueOrHouse && (
            <div className="admin-map-item-add-building-wrap">
              <button
                type="button"
                className={`admin-map-center-row-add-bld ${!mapped ? "is-disabled" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (mapped) {
                    startAddBuildingFlowForCenter(center);
                  }
                }}
                title={mapped ? `Add building to ${props.name || "center"}` : "Place the center on the map first"}
                disabled={!mapped}
              >
                <FontAwesomeIcon icon={faPlus} size="xs" style={{ marginRight: "4px" }} /> Add building
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Detail View when a center is selected
  function renderDetailView() {
    if (!selectedCenter) return null;
    const props = selectedCenter.properties || selectedCenter || {};
    const centerId = props.id ?? selectedCenter.id;
    const active = Boolean(props.is_active);
    const mapped = isCenterMapped(selectedCenter);
    const capacity = Number(props.capacity || 0);
    const occupied = Number(props.occupied || 0);
    const assigned = Number(props.assigned ?? props.total_assigned ?? 0);
    const assignedPct = capacity > 0 ? Math.min(100, Math.round((assigned / capacity) * 100)) : 0;
    const isCenterFullyAssigned = capacity > 0 && assigned >= capacity;
    const occ = getOccupancyStatus(occupied, capacity);
    const barangays = props.barangays || props.barangay_breakdown || [];
    const contactNumber = props.contact_number || props.contact || null;
    const basePath = isAdmin ? "/admin" : "/lgu";

    return (
      <div className="admin-map-detail-view">
        <div className="admin-map-detail-top-row">
          <button
            type="button"
            className="admin-map-back-btn"
            onClick={() => setSelectedCenter(null)}
            aria-label="Back to centers list"
          >
            <FontAwesomeIcon icon={faChevronLeft} />
            <span>Back</span>
          </button>
          {!isMobile && (
            <button
              type="button"
              className="admin-map-panel-collapse-btn"
              onClick={() => setPanelCollapsed(true)}
              title="Collapse panel"
              aria-label="Collapse center card"
            >
              <FontAwesomeIcon icon={faChevronLeft} />
            </button>
          )}
          {isMobile && (
            <button
              type="button"
              className="admin-map-sheet-close"
              onClick={() => setBottomSheetOpen(false)}
              aria-label="Close bottom sheet"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          )}
        </div>

        <div className="admin-map-detail-title-row">
          <h2 className="admin-map-detail-name">
            {props.name || "Evacuation Center"}
          </h2>
          <span
            className={`admin-map-detail-badge ${
              active ? "is-active" : "is-inactive"
            }`}
          >
            {active ? "Active" : "Inactive"}
          </span>
        </div>

        <div className="admin-map-detail-section">
          <div className="admin-map-detail-label">
            Barangays: {barangays.length}
          </div>
          <div className="admin-map-detail-barangays-text">
            {barangays.length > 0
              ? barangays.map((b) => displayEntityName(b.name || b)).join(", ")
              : "No barangays assigned"}
          </div>
        </div>

        <div className="admin-map-detail-section">
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
            {assignedPct > 0 && (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  height: "100%",
                  width: `${assignedPct}%`,
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
                width: `${occ.percent}%`,
                backgroundColor: occ.color,
              }}
            />
          </div>
          <div className="admin-map-detail-occ-sub">
            <span style={{ color: occ.color, fontWeight: 600 }}>
              {occ.percent}% ({occ.statusText})
              {isCenterFullyAssigned ? " · Fully assigned" : ""}
            </span>
            <span className="admin-map-detail-muted-text">
              {occ.spacesLeftText}
            </span>
          </div>
        </div>

        <div className="admin-map-detail-section">
          <div className="admin-map-detail-label">Contact number</div>
          <div className="admin-map-detail-contact-text">
            {contactNumber || "None provided"}
          </div>
        </div>

        <div className="admin-map-detail-actions">
          {!mapped ? (
            <>
              <button
                type="button"
                className="admin-map-btn admin-map-btn-primary"
                onClick={() => startPlacementFlow(selectedCenter)}
              >
                <FontAwesomeIcon icon={faDrawPolygon} />
                <span>Place on map</span>
              </button>
              <button
                type="button"
                className="admin-map-btn-link"
                onClick={() => {
                  navigate(`${basePath}?tab=centers&center=${centerId}`);
                }}
              >
                <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                <span>View details</span>
              </button>
              {canManageRooms && (!props.center_type || props.center_type === "campus") && (
                <>
                  <button
                    type="button"
                    className="admin-map-btn admin-map-btn-secondary"
                    disabled={!active || !mapped}
                    title={
                      !active
                        ? "Activate this center to map rooms."
                        : !mapped
                        ? "Place the center outline first."
                        : `Map rooms for ${props.name || "center"}`
                    }
                    onClick={() => {
                      setPanelSubView("map_rooms");
                      if (isMobile) {
                        setBottomSheetOpen(true);
                      }
                    }}
                  >
                    <FontAwesomeIcon icon={faLocationDot} />
                    <span>
                      Map rooms (
                      {selectedCenterMappedRooms.length} of {selectedCenterRooms.length} mapped)
                    </span>
                  </button>
                  <button
                    type="button"
                    className="admin-map-btn admin-map-btn-secondary"
                    onClick={() => {
                      navigate(
                        `${basePath}?tab=centers&center=${centerId}&subtab=rooms`
                      );
                    }}
                  >
                    <FontAwesomeIcon icon={faDoorOpen} />
                    <span>Manage rooms</span>
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                className="admin-map-btn admin-map-btn-primary"
                onClick={() => {
                  navigate(`${basePath}?tab=centers&center=${centerId}`);
                }}
              >
                <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                <span>View details</span>
              </button>
              {canManageRooms && (!props.center_type || props.center_type === "campus") && (
                <>
                  <button
                    type="button"
                    className="admin-map-btn admin-map-btn-secondary"
                    disabled={!active || !mapped}
                    title={
                      !active
                        ? "Activate this center to map rooms."
                        : !mapped
                        ? "Place the center outline first."
                        : `Map rooms for ${props.name || "center"}`
                    }
                    onClick={() => {
                      setPanelSubView("map_rooms");
                      if (isMobile) {
                        setBottomSheetOpen(true);
                      }
                    }}
                  >
                    <FontAwesomeIcon icon={faLocationDot} />
                    <span>
                      Map rooms (
                      {selectedCenterMappedRooms.length} of {selectedCenterRooms.length} mapped)
                    </span>
                  </button>
                  <button
                    type="button"
                    className="admin-map-btn admin-map-btn-secondary"
                    onClick={() => {
                      navigate(
                        `${basePath}?tab=centers&center=${centerId}&subtab=rooms`
                      );
                    }}
                  >
                    <FontAwesomeIcon icon={faDoorOpen} />
                    <span>Manage rooms</span>
                  </button>
                </>
              )}
              <button
                type="button"
                className="admin-map-btn admin-map-btn-secondary"
                onClick={() => startPlacementFlow(selectedCenter)}
              >
                <FontAwesomeIcon icon={faDrawPolygon} />
                <span>Edit outline</span>
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // Map Rooms View rendered directly inside the side panel or mobile sheet
  function renderMapRoomsView() {
    if (!selectedCenter) return null;
    const props = selectedCenter.properties || selectedCenter || {};

    const activeRooms = selectedCenterRooms.filter((r) => r.is_active !== false);
    const unmappedRooms = activeRooms
      .filter((r) => r.latitude == null || r.longitude == null)
      .sort(naturalCompare);
    const mappedRooms = activeRooms
      .filter((r) => r.latitude != null && r.longitude != null)
      .sort(naturalCompare);
    const sortedRooms = [...unmappedRooms, ...mappedRooms];

    const totalCount = sortedRooms.length;
    const mappedCount = mappedRooms.length;
    const progressPct = totalCount > 0 ? Math.round((mappedCount / totalCount) * 100) : 0;
    const nextUnmappedRoom = unmappedRooms[0];

    // Detail view for currently selected building (if any)
    const bDetailProps = selectedBuildingDetail?.properties || selectedBuildingDetail || {};
    const bDetailId = bDetailProps.id ?? selectedBuildingDetail?.id;
    const bDetailData = buildingDetailsData?.building || buildingDetailsData || bDetailProps;
    const detailedRooms = buildingDetailsData?.rooms || [];
    const bDetailCap = bDetailData.total_capacity ?? bDetailData.capacity ?? bDetailProps.capacity ?? 0;
    const bDetailOcc = bDetailData.total_occupied ?? bDetailData.occupied ?? bDetailData.occupancy ?? bDetailProps.occupied ?? bDetailProps.occupancy ?? 0;
    const bDetailAssigned = bDetailData.total_assigned ?? bDetailData.assigned ?? bDetailProps.assigned ?? 0;
    const bDetailPct = bDetailCap > 0 ? Math.min(100, Math.round((bDetailOcc / bDetailCap) * 100)) : (bDetailProps.occupancy_pct ?? bDetailProps.occupancy_percentage ?? 0);
    const bDetailIsFullyAssigned = bDetailCap > 0 && bDetailAssigned >= bDetailCap;
    const bDetailStatus = bDetailCap === 0 ? "Closed" : bDetailOcc >= bDetailCap ? "Full" : bDetailPct >= 70 ? "Near Capacity" : "Available";
    const bDetailColor = bDetailCap === 0 ? "#94a3b8" : bDetailOcc >= bDetailCap ? "#dc2626" : bDetailPct >= 70 ? "#d97706" : "#16a34a";

    return (
      <div className="admin-map-rooms-panel-view">
        {/* FIXED HEADER */}
        <header className="admin-map-rooms-panel-header">
          <div className="admin-map-rooms-header-top">
            {selectedBuildingDetail ? (
              <button
                type="button"
                className="admin-map-back-link"
                onClick={() => {
                  setSelectedBuildingDetail(null);
                  setSelectedBuildingId(null);
                }}
                aria-label="Back to buildings list"
              >
                <FontAwesomeIcon icon={faChevronLeft} />
                <span>Buildings</span>
              </button>
            ) : addBuildingStep ? (
              <button
                type="button"
                className="admin-map-back-link"
                onClick={handleCancelDrawingBuilding}
                aria-label="Cancel adding building"
              >
                <FontAwesomeIcon icon={faChevronLeft} />
                <span>Cancel</span>
              </button>
            ) : mapRoomsTab === "points" ? (
              <button
                type="button"
                className="admin-map-back-link"
                onClick={() => setMapRoomsTab("buildings")}
                aria-label="Back to buildings"
              >
                <FontAwesomeIcon icon={faChevronLeft} />
                <span>Buildings</span>
              </button>
            ) : (
              <button
                type="button"
                className="admin-map-back-link"
                onClick={() => {
                  setPanelSubView("details");
                  setSelectedBuildingId(null);
                  setSelectedBuildingDetail(null);
                }}
                aria-label="Back to center details"
              >
                <FontAwesomeIcon icon={faChevronLeft} />
                <span>Back</span>
              </button>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
              {!selectedBuildingDetail && !addBuildingStep && mapRoomsTab === "buildings" && (
                <div style={{ position: "relative" }}>
                  <button
                    type="button"
                    className="admin-map-panel-collapse-trigger"
                    onClick={() => setPanelHeaderMenuOpen((prev) => !prev)}
                    title="More options"
                    aria-label="More options"
                    aria-expanded={panelHeaderMenuOpen}
                  >
                    <FontAwesomeIcon icon={faEllipsisVertical} />
                  </button>
                  {panelHeaderMenuOpen && (
                    <div
                      className="admin-bld-dropdown-menu"
                      style={{ right: 0, left: "auto", top: "100%", width: 220, zIndex: 100 }}
                    >
                      <button
                        type="button"
                        className="admin-bld-menu-item"
                        onClick={() => {
                          setPanelHeaderMenuOpen(false);
                          setMapRoomsTab("points");
                        }}
                      >
                        <FontAwesomeIcon icon={faLocationDot} />
                        <span>Place room points (advanced)</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {!isMobile ? (
                <button
                  type="button"
                  className="admin-map-panel-collapse-trigger"
                  onClick={() => setPanelCollapsed(true)}
                  title="Collapse panel"
                  aria-label="Collapse map rooms panel"
                >
                  <FontAwesomeIcon icon={faChevronLeft} />
                </button>
              ) : (
                <button
                  type="button"
                  className="admin-map-panel-collapse-trigger"
                  onClick={() => setBottomSheetOpen(false)}
                  aria-label="Close bottom sheet"
                >
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              )}
            </div>
          </div>

          <div className="admin-map-rooms-title-group">
            <h2>
              {selectedBuildingDetail
                ? (bDetailProps.name || "Building Details")
                : addBuildingStep
                ? "Add Building"
                : mapRoomsTab === "points"
                ? "Place Room Points"
                : "Buildings"}
            </h2>
            <div className="admin-map-rooms-center-name">
              {props.name || "Evacuation Center"}
            </div>
          </div>

          {/* Progress Line (Only shown in advanced room points mode) */}
          {mapRoomsTab === "points" && !selectedBuildingDetail && !addBuildingStep && (
            <div className="admin-map-progress-box">
              <div className="admin-map-progress-label">
                <span>{mappedCount} of {totalCount} rooms placed</span>
                <span>{progressPct}%</span>
              </div>
              <div className="admin-map-progress-track">
                <div
                  className="admin-map-progress-fill"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}
        </header>

        {/* SINGLE SCROLLING BODY */}
        <div className="admin-map-rooms-scroll-body">
          {selectedBuildingDetail ? (
            /* ========================================================
               INLINE BUILDING DETAIL VIEW
               ======================================================== */
            <div className="admin-bld-detail-view">
              <header className="admin-bld-detail-header">
                <button
                  type="button"
                  className="admin-bld-detail-back-btn"
                  onClick={() => {
                    setSelectedBuildingDetail(null);
                    setSelectedBuildingId(null);
                  }}
                >
                  <FontAwesomeIcon icon={faArrowLeft} />
                  <span>Back to buildings</span>
                </button>
                <div className="admin-bld-detail-title">
                  {bDetailProps.name || "Building"}
                </div>
              </header>

              {buildingDetailsLoading ? (
                <div className="admin-bld-skeleton-row" style={{ height: "120px" }} />
              ) : buildingDetailsError ? (
                <div className="admin-bld-error-state">
                  <span>{buildingDetailsError}</span>
                  <button
                    type="button"
                    className="admin-bld-retry-btn"
                    onClick={() => {
                      if (bDetailId) {
                        setBuildingDetailsLoading(true);
                        api.getBuildingDetails(bDetailId)
                          .then(setBuildingDetailsData)
                          .catch(() => setBuildingDetailsError("Retry failed."))
                          .finally(() => setBuildingDetailsLoading(false));
                      }
                    }}
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <>
                  {/* Summary Card */}
                  <div className="admin-bld-detail-summary-card">
                    <div className="admin-bld-detail-summary-row">
                      <span style={{ color: "#64748b" }}>Occupancy</span>
                      <span style={{ fontWeight: 600 }}>
                        {bDetailOcc} of {bDetailCap} here · {bDetailAssigned} assigned
                      </span>
                    </div>
                    <div className="admin-bld-detail-summary-row">
                      <span style={{ color: "#64748b" }}>Status</span>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                        {bDetailIsFullyAssigned && (
                          <span
                            style={{
                              fontWeight: 600,
                              fontSize: "11px",
                              color: "#475569",
                              padding: "2px 8px",
                              borderRadius: "4px",
                              background: "#f1f5f9",
                              border: "1px solid #cbd5e1",
                            }}
                          >
                            Fully assigned
                          </span>
                        )}
                        <span
                          style={{
                            fontWeight: 600,
                            color: bDetailColor,
                            padding: "2px 8px",
                            borderRadius: "4px",
                            background: `${bDetailColor}18`,
                            border: `1px solid ${bDetailColor}40`,
                          }}
                        >
                          {bDetailStatus}
                        </span>
                      </div>
                    </div>
                    <div className="admin-bld-detail-summary-row">
                      <span style={{ color: "#64748b" }}>Rooms</span>
                      <span style={{ fontWeight: 600 }}>
                        {detailedRooms.length > 0 ? `${detailedRooms.length} rooms` : "0 rooms"}
                      </span>
                    </div>
                  </div>

                  {/* Redraw Outline Action */}
                  <button
                    type="button"
                    className="admin-bld-redraw-btn"
                    onClick={() => {
                      setIsDrawingBuilding(true);
                      const bOrigPoints = polygonToPoints(selectedBuildingDetail?.geometry);
                      setBuildingEditOriginalPoints(bOrigPoints.length >= 3 ? bOrigPoints : []);
                      setBuildingEditUndoStack([]);
                      setRedrawingBuildingId(bDetailId);
                      // Initialize with existing polygon points so vertex handles appear for editing
                      setNewBuildingPoints(bOrigPoints.length >= 3 ? bOrigPoints : []);

                    }}
                  >
                    <FontAwesomeIcon icon={faArrowsRotate} />
                    <span>Redraw outline on map</span>
                  </button>

                  {/* Rooms & Staff Assigned Families Section */}
                  <div className="admin-bld-rooms-section">
                    <div className="admin-bld-rooms-heading">
                      Rooms & Occupants ({detailedRooms.length})
                    </div>

                    {detailedRooms.length === 0 ? (
                      <div style={{ fontSize: "13px", color: "#64748b", padding: "8px 0" }}>
                        No rooms linked to this building yet. Use "Link / unlink rooms" from the buildings menu.
                      </div>
                    ) : (
                      <div className="admin-bld-rooms-list">
                        {detailedRooms.map((rm) => {
                          const isStaffExpanded = expandedStaffRoomIds[rm.id];
                          const fams = rm.assigned_families || rm.families || [];
                          return (
                            <div key={rm.id} className="admin-bld-room-card">
                              <div className="admin-bld-room-top">
                                <span className="admin-bld-room-num">
                                  Room {rm.room_number}
                                </span>
                                <span className="admin-bld-room-cap">
                                  {rm.occupied || 0} of {rm.capacity || 0} here · {rm.assigned ?? 0} assigned
                                </span>
                              </div>

                              {/* Staff expandable families */}
                              {fams.length > 0 ? (
                                <>
                                  <button
                                    type="button"
                                    className="admin-bld-families-toggle"
                                    onClick={() => {
                                      setExpandedStaffRoomIds((prev) => ({
                                        ...prev,
                                        [rm.id]: !prev[rm.id],
                                      }));
                                    }}
                                  >
                                    <FontAwesomeIcon icon={faUsers} />
                                    <span>
                                      Assigned families ({fams.length})
                                    </span>
                                    <FontAwesomeIcon
                                      icon={isStaffExpanded ? faChevronUp : faChevronDown}
                                      className="admin-bld-chevron"
                                    />
                                  </button>

                                  {isStaffExpanded && (
                                    <div className="admin-bld-families-list">
                                      {fams.map((f, idx) => {
                                        const famKey = `${rm.id}-fam-${f.family_id || idx}`;
                                        const isFamExpanded = Boolean(expandedStaffFamilyIds[famKey]);
                                        const fMembers = Array.isArray(f.members) ? f.members : [];
                                        const fMemberCount =
                                          fMembers.length || Number(f.assigned_members ?? f.member_count ?? 1);
                                        const isFCheckedIn = Boolean(f.is_checked_in);
                                        const fStatusChip =
                                          f.checkin_status ||
                                          (isFCheckedIn ? "Checked in" : "Not yet arrived");
                                        return (
                                          <div key={f.family_id || idx} className="admin-bld-family-item">
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setExpandedStaffFamilyIds((prev) => ({
                                                  ...prev,
                                                  [famKey]: !prev[famKey],
                                                }))
                                              }
                                              aria-expanded={isFamExpanded}
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
                                              <div
                                                className="admin-bld-family-name"
                                                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}
                                              >
                                                <span>
                                                  {f.head_name || "Family"} ({fMemberCount} {fMemberCount === 1 ? "member" : "members"})
                                                </span>
                                                <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                                  <span
                                                    style={{
                                                      padding: "2px 7px",
                                                      borderRadius: "999px",
                                                      fontSize: "10px",
                                                      fontWeight: 700,
                                                      backgroundColor: isFCheckedIn ? "#dcfce7" : "#f1f5f9",
                                                      color: isFCheckedIn ? "#166534" : "#475569",
                                                      border: isFCheckedIn ? "none" : "1px solid #cbd5e1",
                                                      whiteSpace: "nowrap",
                                                    }}
                                                  >
                                                    {fStatusChip}
                                                  </span>
                                                  <FontAwesomeIcon
                                                    icon={isFamExpanded ? faChevronUp : faChevronDown}
                                                    style={{ fontSize: "10px", color: "#64748b" }}
                                                  />
                                                </div>
                                              </div>
                                              <div className="admin-bld-family-meta">
                                                Contact: {f.contact_number || f.contact || "N/A"}
                                                {f.special_needs?.length > 0 && (
                                                  <span style={{ marginLeft: "6px", color: "#d97706", fontWeight: 600 }}>
                                                    [{f.special_needs.join(", ")}]
                                                  </span>
                                                )}
                                              </div>
                                            </button>

                                            {isFamExpanded && (
                                              <div
                                                style={{
                                                  marginTop: "6px",
                                                  paddingTop: "6px",
                                                  borderTop: "1px solid #e2e8f0",
                                                  display: "flex",
                                                  flexDirection: "column",
                                                  gap: "4px",
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
                                                    {fMemberCount} {fMemberCount === 1 ? "member" : "members"}
                                                  </span>
                                                  <span>Total: {rm.assigned ?? 0} assigned</span>
                                                </div>
                                                {fMembers.map((mem, mIdx) => {
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
                                                      key={mem?.resident_id || `m-${mIdx}`}
                                                      style={{
                                                        display: "flex",
                                                        alignItems: "center",
                                                        justifyContent: "space-between",
                                                        gap: "6px",
                                                        padding: "4px 6px",
                                                        background: "#ffffff",
                                                        border: "1px solid #e2e8f0",
                                                        borderRadius: "4px",
                                                        fontSize: "11.5px",
                                                        color: "#1e293b",
                                                      }}
                                                    >
                                                      <span>{memName}</span>
                                                      {hasMemCheckin && (
                                                        <span
                                                          style={{
                                                            padding: "1px 6px",
                                                            borderRadius: "999px",
                                                            fontSize: "9.5px",
                                                            fontWeight: 700,
                                                            backgroundColor: memCheckedIn ? "#dcfce7" : "#f1f5f9",
                                                            color: memCheckedIn ? "#166534" : "#475569",
                                                            border: memCheckedIn ? "none" : "1px solid #cbd5e1",
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
                                      })}
                                    </div>
                                  )}
                                </>
                              ) : (
                                <div className="admin-bld-empty-families">
                                  No occupants assigned to this room.
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          ) : mapRoomsTab === "buildings" ? (
            /* ========================================================
               BUILDINGS TAB
               ======================================================== */
            <>
              {/* 1. ROOM SUGGESTIONS BANNER */}
              {loadingSuggestions && (
                <div className="admin-map-families-loading">
                  <FontAwesomeIcon icon={faSpinner} spin className="admin-map-spinner-icon" />
                  <span>Checking for rooms inside building outlines...</span>
                </div>
              )}

              {!loadingSuggestions && pendingSuggestions.length > 0 && (
                <div className="admin-map-suggestions-box">
                  <div className="admin-map-suggestions-header">
                    <div className="admin-map-suggestions-title">
                      <FontAwesomeIcon icon={faLink} />
                      <span>Suggested Room Assignments ({pendingSuggestions.length})</span>
                    </div>
                  </div>
                  <div className="admin-map-suggestions-desc">
                    These rooms have coordinates located inside building footprints. Confirm each assignment or confirm all at once:
                  </div>

                  <button
                    type="button"
                    className="admin-map-confirm-all-btn"
                    onClick={handleConfirmAllSuggestions}
                  >
                    <FontAwesomeIcon icon={faCheckDouble} />
                    <span>Confirm All ({pendingSuggestions.length})</span>
                  </button>

                  <div className="admin-map-suggestions-list" role="list">
                    {pendingSuggestions.map((s) => (
                      <div key={s.room_id} className="admin-map-suggestion-item" role="listitem">
                        <div className="admin-map-suggestion-info">
                          <span className="admin-map-suggestion-room-tag">Room {s.room_number}</span>
                          <span className="admin-map-suggestion-arrow">→</span>
                          <span className="admin-map-suggestion-building-tag">{s.building_name}</span>
                        </div>
                        <button
                          type="button"
                          className="admin-map-suggestion-confirm-btn"
                          onClick={() => handleConfirmSuggestion(s)}
                          title={`Link Room ${s.room_number} to ${s.building_name}`}
                        >
                          <FontAwesomeIcon icon={faCheck} /> Confirm
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* GUIDED 3-STEP FLOW (When adding a building) */}
              {addBuildingStep ? (
                <div className="admin-guided-flow-panel">
                  {/* 3-Step Indicator */}
                  <div className="admin-guided-step-bar" role="tablist" aria-label="Add building steps">
                    <div className={`admin-guided-step ${addBuildingStep === "draw" ? "is-active" : newBuildingPoints.length >= 3 ? "is-complete" : ""}`}>
                      <span className="admin-guided-step-num">
                        {newBuildingPoints.length >= 3 && addBuildingStep !== "draw" ? (
                          <FontAwesomeIcon icon={faCheck} />
                        ) : (
                          "1"
                        )}
                      </span>
                      <span>Draw</span>
                    </div>
                    <div className="admin-guided-step-line" />
                    <div className={`admin-guided-step ${addBuildingStep === "name" ? "is-active" : newBuildingName.trim() ? "is-complete" : ""}`}>
                      <span className="admin-guided-step-num">
                        {newBuildingName.trim() && addBuildingStep === "rooms" ? (
                          <FontAwesomeIcon icon={faCheck} />
                        ) : (
                          "2"
                        )}
                      </span>
                      <span>Name</span>
                    </div>
                    <div className="admin-guided-step-line" />
                    <div className={`admin-guided-step ${addBuildingStep === "rooms" ? "is-active" : ""}`}>
                      <span className="admin-guided-step-num">3</span>
                      <span>Rooms</span>
                    </div>
                  </div>

                  {/* Step 1: Draw */}
                  {addBuildingStep === "draw" && (
                    <div className="admin-guided-card">
                      <h3 className="admin-guided-title">
                        <FontAwesomeIcon icon={faDrawPolygon} style={{ color: "#2563eb" }} />
                        <span>Step 1: Draw building outline</span>
                      </h3>

                      <div className="admin-guided-hint-box">
                        <div>
                          <strong>Click the corners of the building on the map. Double-click to finish.</strong>
                        </div>
                        <div className="admin-guided-tip-sub">
                          Tip: You can also click an existing building footprint on the map to trace it automatically.
                        </div>
                      </div>

                      <div
                        className="admin-guided-pts-pill"
                        style={{
                          backgroundColor: newBuildingPoints.length >= 3 ? "#dcfce7" : "#f1f5f9",
                          color: newBuildingPoints.length >= 3 ? "#166534" : "#475569",
                        }}
                      >
                        <FontAwesomeIcon icon={newBuildingPoints.length >= 3 ? faCheck : faDrawPolygon} />
                        <span>
                          {newBuildingPoints.length} corner{newBuildingPoints.length === 1 ? "" : "s"} placed (minimum 3)
                        </span>
                      </div>

                      <div className="admin-guided-actions-row">
                        <button
                          type="button"
                          className="admin-guided-btn"
                          onClick={() => setNewBuildingPoints((pts) => pts.slice(0, -1))}
                          disabled={newBuildingPoints.length === 0}
                          title="Undo last corner"
                        >
                          <FontAwesomeIcon icon={faRotateLeft} />
                          <span>Undo</span>
                        </button>
                        <button
                          type="button"
                          className="admin-guided-btn"
                          onClick={() => setNewBuildingPoints([])}
                          disabled={newBuildingPoints.length === 0}
                          title="Clear corners"
                        >
                          <span>Clear</span>
                        </button>
                        <button
                          type="button"
                          className="admin-guided-btn is-danger"
                          onClick={handleCancelDrawingBuilding}
                        >
                          <span>Cancel</span>
                        </button>
                        <button
                          type="button"
                          className="admin-guided-btn is-primary"
                          style={{ marginLeft: "auto" }}
                          onClick={() => {
                            if (newBuildingPoints.length >= 3) {
                              if (!newBuildingName.trim()) {
                                setNewBuildingName(`Building ${centerBuildings.length + 1}`);
                              }
                              setAddBuildingStep("name");
                            }
                          }}
                          disabled={newBuildingPoints.length < 3}
                        >
                          <span>Next: Name</span>
                          <FontAwesomeIcon icon={faArrowRight} />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Step 2: Name */}
                  {addBuildingStep === "name" && (
                    <div className="admin-guided-card">
                      <h3 className="admin-guided-title">
                        <FontAwesomeIcon icon={faPen} style={{ color: "#2563eb" }} />
                        <span>Step 2: Name the building</span>
                      </h3>

                      <div className="admin-guided-field-group">
                        <label htmlFor="guided-building-name" className="admin-guided-label">
                          Building Name
                        </label>
                        <input
                          id="guided-building-name"
                          type="text"
                          autoFocus
                          className="admin-guided-input"
                          placeholder="e.g. Building 1, Science Wing, Main Hall"
                          value={newBuildingName}
                          onChange={(e) => setNewBuildingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && newBuildingName.trim()) {
                              e.preventDefault();
                              setAddBuildingStep("rooms");
                            }
                          }}
                        />
                      </div>

                      <div className="admin-guided-actions-row">
                        <button
                          type="button"
                          className="admin-guided-btn"
                          onClick={() => setAddBuildingStep("draw")}
                        >
                          <FontAwesomeIcon icon={faArrowLeft} />
                          <span>Back to Draw</span>
                        </button>
                        <button
                          type="button"
                          className="admin-guided-btn is-danger"
                          onClick={handleCancelDrawingBuilding}
                        >
                          <span>Cancel</span>
                        </button>
                        <button
                          type="button"
                          className="admin-guided-btn is-primary"
                          style={{ marginLeft: "auto" }}
                          onClick={() => {
                            if (newBuildingName.trim()) {
                              setAddBuildingStep("rooms");
                            }
                          }}
                          disabled={!newBuildingName.trim()}
                        >
                          <span>Next: Rooms</span>
                          <FontAwesomeIcon icon={faArrowRight} />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Step 3: Rooms */}
                  {addBuildingStep === "rooms" && (
                    <div className="admin-guided-card">
                      <h3 className="admin-guided-title">
                        <FontAwesomeIcon icon={faDoorOpen} style={{ color: "#2563eb" }} />
                        <span>Step 3: Link rooms to {newBuildingName}</span>
                      </h3>

                      <div className="admin-guided-rooms-toolbar">
                        <div className="admin-guided-filter-inputs">
                          <input
                            type="text"
                            className="admin-guided-search-input"
                            placeholder="Search unmapped rooms..."
                            value={roomSearchQuery}
                            onChange={(e) => setRoomSearchQuery(e.target.value)}
                          />
                          <div className="admin-guided-range-wrap">
                            <input
                              type="text"
                              className="admin-guided-range-input"
                              placeholder="Range (1-7)"
                              value={roomRangeInput}
                              onChange={(e) => setRoomRangeInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  handleApplyRoomRange();
                                }
                              }}
                            />
                            <button
                              type="button"
                              className="admin-guided-btn"
                              style={{ height: 36, minHeight: 36, padding: "0 10px", fontSize: 12 }}
                              onClick={handleApplyRoomRange}
                            >
                              Apply
                            </button>
                          </div>
                        </div>

                        <div className="admin-guided-quick-select-row">
                          <span>
                            <strong>{newBuildingRoomIds.length}</strong> room{newBuildingRoomIds.length === 1 ? "" : "s"} selected
                          </span>
                          <div style={{ display: "flex", gap: "10px" }}>
                            <button
                              type="button"
                              className="admin-guided-quick-btn"
                              onClick={handleSelectAllUnmappedRooms}
                            >
                              Select all
                            </button>
                            <button
                              type="button"
                              className="admin-guided-quick-btn"
                              onClick={() => setNewBuildingRoomIds([])}
                            >
                              Clear
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Vertical Checklist */}
                      <div className="admin-guided-rooms-list" role="list" aria-label="Available rooms">
                        {filteredUnassignedRooms.length === 0 ? (
                          <div style={{ padding: "16px", textAlign: "center", color: "#64748b", fontSize: 13 }}>
                            {unassignedRooms.length === 0
                              ? "All rooms in this center are already linked to buildings."
                              : "No unlinked rooms match your filter."}
                          </div>
                        ) : (
                          filteredUnassignedRooms.map((rm) => {
                            const isChecked = newBuildingRoomIds.includes(rm.id);
                            return (
                              <label
                                key={rm.id}
                                className={`admin-guided-room-item ${isChecked ? "is-checked" : ""}`}
                              >
                                <input
                                  type="checkbox"
                                  className="admin-guided-room-cb"
                                  checked={isChecked}
                                  onChange={() => handleToggleRoomCheckbox(rm.id)}
                                />
                                <div className="admin-guided-room-info">
                                  <span className="admin-guided-room-name">
                                    Room {rm.room_number || "Unnamed"}
                                  </span>
                                  <span className="admin-guided-room-meta">
                                    {rm.capacity ? `${rm.capacity} cap` : "No cap"}
                                  </span>
                                </div>
                              </label>
                            );
                          })
                        )}
                      </div>

                      <div className="admin-guided-actions-row">
                        <button
                          type="button"
                          className="admin-guided-btn"
                          onClick={() => setAddBuildingStep("name")}
                          disabled={isSavingBuilding}
                        >
                          <FontAwesomeIcon icon={faArrowLeft} />
                          <span>Back to Name</span>
                        </button>
                        <button
                          type="button"
                          className="admin-guided-btn is-danger"
                          onClick={handleCancelDrawingBuilding}
                          disabled={isSavingBuilding}
                        >
                          <span>Cancel</span>
                        </button>
                        <button
                          type="button"
                          className="admin-guided-btn is-primary"
                          style={{ marginLeft: "auto" }}
                          onClick={handleSaveBuildingWithRooms}
                          disabled={isSavingBuilding || !newBuildingName.trim()}
                        >
                          {isSavingBuilding ? (
                            <>
                              <FontAwesomeIcon icon={faSpinner} spin />
                              <span>Saving...</span>
                            </>
                          ) : (
                            <>
                              <FontAwesomeIcon icon={faCheck} />
                              <span>Save Building ({newBuildingRoomIds.length} rooms)</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {/* Redrawing Outline Alert if redrawing an existing building */}
                  {isDrawingBuilding && redrawingBuildingId && (
                    <div className="admin-map-edit-building-toolbar">
                      <div className="admin-map-edit-toolbar-hint">
                        <FontAwesomeIcon icon={faHand} style={{ marginRight: "6px", color: "var(--ew-brand-primary)" }} />
                        <span>{newBuildingPoints.length === 0 ? "Click each corner of the new outline." : "Drag corners to reshape. Drag small dots to add corners."}</span>
                      </div>
                      {buildingEditBoundaryError && (
                        <div className="admin-map-edit-toolbar-error">
                          <FontAwesomeIcon icon={faTriangleExclamation} style={{ marginRight: "6px" }} />
                          <span>{buildingEditBoundaryError}</span>
                        </div>
                      )}
                      <div className="admin-map-edit-toolbar-actions">
                        <button
                          type="button"
                          className="admin-map-edit-toolbar-btn"
                          onClick={handleUndoBuildingEdit}
                          disabled={buildingEditUndoStack.length === 0 || isSavingBuilding}
                          title="Undo last change"
                        >
                          <FontAwesomeIcon icon={faRotateLeft} />
                          <span>Undo</span>
                        </button>
                        <button
                          type="button"
                          className="admin-map-edit-toolbar-btn"
                          onClick={handleResetBuildingEdit}
                          disabled={buildingEditOriginalPoints.length === 0 || isSavingBuilding}
                          title="Reset to saved outline"
                        >
                          <FontAwesomeIcon icon={faArrowsRotate} />
                          <span>Reset</span>
                        </button>
                        <button
                          type="button"
                          className="admin-map-edit-toolbar-btn"
                          onClick={handleRedrawBuildingEdit}
                          disabled={newBuildingPoints.length === 0 || isSavingBuilding}
                          title="Redraw from scratch"
                        >
                          <FontAwesomeIcon icon={faTrashCan} />
                          <span>Redraw</span>
                        </button>
                        <button
                          type="button"
                          className="admin-map-edit-toolbar-btn is-danger"
                          onClick={handleCancelDrawingBuilding}
                          disabled={isSavingBuilding}
                          title="Cancel editing"
                        >
                          <FontAwesomeIcon icon={faXmark} />
                          <span>Cancel</span>
                        </button>
                        <button
                          type="button"
                          className="admin-map-edit-toolbar-btn is-primary"
                          onClick={handleSaveBuildingOutline}
                          disabled={newBuildingPoints.length < 3 || isSavingBuilding}
                        >
                          {isSavingBuilding ? (
                            <>
                              <FontAwesomeIcon icon={faSpinner} spin />
                              <span>Saving...</span>
                            </>
                          ) : (
                            <>
                              <FontAwesomeIcon icon={faCheck} />
                              <span>Save ({newBuildingPoints.length} pts)</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 4. 64px COMPACT BUILDING ROWS */}
                  {centerBuildings.length === 0 ? (
                    <div className="admin-bld-empty-state">
                      <FontAwesomeIcon icon={faBuildingColumns} className="admin-bld-empty-icon" />
                      <span>No buildings yet. Draw one to link its rooms.</span>
                      <button
                        type="button"
                        className="admin-guided-btn is-primary"
                        style={{ marginTop: 8 }}
                        onClick={() => startAddBuildingFlowForCenter(selectedCenter)}
                      >
                        <FontAwesomeIcon icon={faPlus} />
                        <span>Add building</span>
                      </button>
                    </div>
                  ) : (
                centerBuildings.map((b) => {
                  const bProps = b.properties || {};
                  const bId = bProps.id ?? b.id;
                  const bName = bProps.name || "Building";
                  const roomCount = bProps.room_count || 0;
                  const bCap = bProps.capacity || 0;
                  const bOcc = bProps.occupied || 0;
                  const bAssigned = bProps.assigned ?? 0;
                  const occPct = bCap > 0 ? Math.min(100, Math.round((bOcc / bCap) * 100)) : (bProps.occupancy_pct ?? bProps.occupancy_percentage ?? 0);
                  const assignedPct = bCap > 0 ? Math.min(100, Math.round((bAssigned / bCap) * 100)) : 0;
                  const isFullyAssigned = bCap > 0 && bAssigned >= bCap;
                  const occStatus = bCap === 0 ? "Closed" : bOcc >= bCap ? "Full" : occPct >= 70 ? "Near Capacity" : "Available";
                  const statusColor = bProps.fill_color || bProps.status_color || (bCap === 0 ? "#94a3b8" : bOcc >= bCap ? "#dc2626" : occPct >= 70 ? "#d97706" : "#16a34a");
                  const isSelected = String(selectedBuildingId) === String(bId);

                  // Muted subline: occupied & assigned vs capacity
                  const subline =
                    roomCount > 0
                      ? `${bOcc} of ${bCap} here · ${bAssigned} assigned`
                      : "No rooms linked yet";

                  // Exception-only badge: Only show for Full, Near Capacity, or Closed
                  const isException =
                    occStatus === "Full" ||
                    occStatus === "Near Capacity" ||
                    occStatus === "Closed";

                  // Linked rooms for manage count
                  const linkedRooms = selectedCenterRooms.filter(
                    (r) => String(r.building_id) === String(bId)
                  );

                  return (
                    <div
                      key={bId}
                      className={`admin-bld-row ${isSelected ? "is-selected" : ""}`}
                      onClick={() => handleSelectBuildingRow(b)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleSelectBuildingRow(b);
                        }
                      }}
                      aria-label={`${bName}, ${bOcc} of ${bCap} here, ${bAssigned} assigned, ${occStatus}`}
                    >
                      {/* Swatch */}
                      <div
                        className="admin-bld-swatch"
                        style={{ backgroundColor: statusColor }}
                        aria-hidden="true"
                      />

                      {/* Info */}
                      <div className="admin-bld-info">
                        <div className="admin-bld-name" title={bName}>
                          {bName}
                        </div>
                        <div className="admin-bld-subline" title={subline}>
                          {subline}
                        </div>
                      </div>

                      {/* Right side stats & overflow */}
                      <div
                        className="admin-bld-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="admin-bld-pct">{occPct}%</span>

                        {isFullyAssigned && (
                          <span
                            className="admin-bld-exception-badge"
                            style={{
                              backgroundColor: "#f1f5f9",
                              color: "#475569",
                              border: "1px solid #cbd5e1",
                            }}
                          >
                            Fully assigned
                          </span>
                        )}

                        {/* Exception-only badge */}
                        {isException && (
                          <span
                            className={`admin-bld-exception-badge ${occStatus.toLowerCase().replace(/\s+/g, "-")}`}
                          >
                            {occStatus}
                          </span>
                        )}

                        {/* "..." Overflow Menu */}
                        <div className="admin-bld-overflow-wrap">
                          <button
                            type="button"
                            className="admin-bld-overflow-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveOverflowMenuId(activeOverflowMenuId === bId ? null : bId);
                            }}
                            aria-label={`Options for ${bName}`}
                            aria-haspopup="true"
                            aria-expanded={activeOverflowMenuId === bId}
                          >
                            <FontAwesomeIcon icon={faEllipsisVertical} />
                          </button>

                          {activeOverflowMenuId === bId && (
                            <div className="admin-bld-dropdown-menu" role="menu">
                              <button
                                type="button"
                                role="menuitem"
                                className="admin-bld-menu-item"
                                onClick={() => {
                                  setActiveOverflowMenuId(null);
                                  setRenamingBuilding(b);
                                  setRenameValue(bName);
                                }}
                              >
                                <FontAwesomeIcon icon={faPen} />
                                <span>Rename</span>
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                className="admin-bld-menu-item"
                                onClick={() => {
                                  setActiveOverflowMenuId(null);
                                  setManagingRoomsBuilding(b);
                                  setManagingRoomIds(linkedRooms.map((r) => r.id));
                                }}
                              >
                                <FontAwesomeIcon icon={faLink} />
                                <span>Link / unlink rooms</span>
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                className="admin-bld-menu-item"
                                onClick={() => {
                                  setActiveOverflowMenuId(null);
                                  const bOrigPoints = polygonToPoints(b.geometry);
                                  setBuildingEditOriginalPoints(bOrigPoints.length >= 3 ? bOrigPoints : []);
                                  setBuildingEditUndoStack([]);
                                  setIsDrawingBuilding(true);
                                  setRedrawingBuildingId(bId);
                                  setNewBuildingPoints([]);
        
        
        
        
                                }}
                              >
                                <FontAwesomeIcon icon={faArrowsRotate} />
                                <span>Redraw outline</span>
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                className="admin-bld-menu-item is-danger"
                                onClick={() => {
                                  setActiveOverflowMenuId(null);
                                  setDeletingBuilding(b);
                                }}
                              >
                                <FontAwesomeIcon icon={faTrashCan} />
                                <span>Delete building</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* 4px Bottom Bar */}
                      <div className="admin-bld-bottom-bar-track" style={{ position: "relative" }}>
                        {assignedPct > 0 && (
                          <div
                            style={{
                              position: "absolute",
                              top: 0,
                              left: 0,
                              height: "100%",
                              width: `${Math.min(100, assignedPct)}%`,
                              backgroundColor: "#94a3b8",
                              opacity: 0.45,
                            }}
                          />
                        )}
                        <div
                          className="admin-bld-bottom-bar-fill"
                          style={{
                            position: "relative",
                            zIndex: 2,
                            width: `${Math.min(100, occPct)}%`,
                            backgroundColor: statusColor,
                          }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
                </>
              )}
            </>
          ) : (
            /* ========================================================
               ROOM POINTS TAB
               ======================================================== */
            <>
              {nextUnmappedRoom ? (
                <button
                  type="button"
                  className="admin-map-btn admin-map-btn-primary admin-map-rooms-start-btn"
                  onClick={() => handleStartPlacement(nextUnmappedRoom, unmappedRooms)}
                >
                  <FontAwesomeIcon icon={faPlay} />
                  <span>
                    Start with next unmapped ({nextUnmappedRoom.room_number})
                  </span>
                </button>
              ) : totalCount > 0 ? (
                <div className="admin-map-rooms-all-mapped-banner">
                  <FontAwesomeIcon icon={faCheck} className="text-green-600" />
                  <span>All {totalCount} rooms are mapped on the outline.</span>
                </div>
              ) : (
                <div className="admin-map-rooms-empty-banner">
                  <FontAwesomeIcon icon={faDoorOpen} />
                  <span>No rooms registered yet for this center.</span>
                </div>
              )}

              <div role="list" aria-label="Rooms list" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {sortedRooms.map((room) => {
                  const isMapped = room.latitude != null && room.longitude != null;
                  const isCurrent = isPlacingRoom && placingRoom?.id === room.id;
                  const isHovered = hoveredRoomId != null && String(hoveredRoomId) === String(room.id);
                  const isSelected = selectedRoomId != null && String(selectedRoomId) === String(room.id);

                  return (
                    <div
                      key={room.id}
                      id={`admin-room-row-${room.id}`}
                      className={`admin-map-room-row ${
                        isMapped ? "is-mapped" : "is-unmapped"
                      } ${isCurrent ? "is-current-placing" : ""} ${
                        isHovered ? "is-hovered-room" : ""
                      } ${isSelected ? "is-selected-room" : ""}`}
                      role="listitem"
                      onMouseEnter={() => setHoveredRoomId(room.id)}
                      onMouseLeave={() => setHoveredRoomId(null)}
                      onClick={() => {
                        handleRoomClick(room);
                      }}
                    >
                      <div className="admin-map-room-info">
                        <div className="admin-map-room-title-line">
                          <span className="admin-map-room-number">
                            {room.room_number || "Unnamed Room"}
                          </span>
                          {room.capacity ? (
                            <span className="admin-map-room-capacity">
                              {room.capacity} cap
                            </span>
                          ) : null}
                        </div>
                        <div className="admin-map-room-badge-line">
                          {isMapped ? (
                            <span className="admin-map-room-badge is-mapped">
                              <FontAwesomeIcon icon={faCheck} /> Mapped
                            </span>
                          ) : (
                            <span className="admin-map-room-badge is-unmapped">
                              Not mapped
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="admin-map-room-actions">
                        {!isMapped ? (
                          <button
                            type="button"
                            className="admin-map-room-action-btn admin-map-room-place-btn"
                            onClick={() => handleStartPlacement(room, unmappedRooms)}
                            title={`Place ${room.room_number} on map`}
                          >
                            <FontAwesomeIcon icon={faLocationDot} />
                            <span>Place</span>
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="admin-map-room-action-btn admin-map-room-place-btn"
                              onClick={() => handleStartPlacement(room, [room])}
                              title={`Move ${room.room_number} on map`}
                            >
                              <FontAwesomeIcon icon={faArrowsUpDownLeftRight} />
                              <span>Place</span>
                            </button>
                            <button
                              type="button"
                              className="admin-map-room-action-btn admin-map-room-remove-btn"
                              onClick={() => handleRemoveLocation(room)}
                              title={`Remove map location for ${room.room_number}`}
                              aria-label={`Remove location for ${room.room_number}`}
                            >
                              <FontAwesomeIcon icon={faTrashCan} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* FIXED FOOTER (Add Building button) */}
        {!selectedBuildingDetail && mapRoomsTab === "buildings" && !addBuildingStep && !redrawingBuildingId && (
          <footer className="admin-map-rooms-panel-footer">
            <button
              type="button"
              className="admin-bld-add-btn"
              onClick={() => startAddBuildingFlowForCenter(selectedCenter)}
            >
              <FontAwesomeIcon icon={faPlus} />
              <span>{centerBuildings.length > 0 ? "Add another building" : "Add building"}</span>
            </button>
          </footer>
        )}
      </div>
    );
  }

  // Common Header Controls (Search + Segmented Control) used inside Fixed Header
  function renderPanelHeaderControls(compactOnly = false) {
    return (
      <>
        {!compactOnly && (
          <div className="admin-map-search-wrap">
            <FontAwesomeIcon icon={faSearch} className="admin-map-search-icon" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search center, barangay or place..."
              className="admin-map-search-input"
              aria-label="Search evacuation centers or places"
            />
            {searchQuery && (
              <button
                type="button"
                className="admin-map-search-clear"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search query"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            )}
          </div>
        )}

        <div
          className="admin-map-filter-row"
          role="group"
          aria-label="Filter centers by mapping status"
        >
          <button
            type="button"
            className={`admin-map-filter-btn ${
              filter === "all" ? "is-active" : ""
            }`}
            onClick={() => setFilter("all")}
          >
            <span>All {allCentersList.length}</span>
          </button>

          <button
            type="button"
            className={`admin-map-filter-btn ${
              filter === "mapped" ? "is-active" : ""
            }`}
            onClick={() => setFilter("mapped")}
          >
            <span>Mapped {mappedCount}</span>
          </button>

          <button
            type="button"
            className={`admin-map-filter-btn ${
              filter === "unmapped" ? "is-active" : ""
            }`}
            onClick={() => setFilter("unmapped")}
          >
            <span>Not mapped {unmappedCount}</span>
          </button>
        </div>
      </>
    );
  }

  // Common Scrolling List View used inside Desktop Panel & Mobile Bottom Sheet
  function renderPanelContent() {
    const isSearching = searchQuery.trim().length >= 2;

    if (centersQuery.isLoading) {
      return (
        <div className="admin-map-list" role="status" aria-label="Loading centers">
          <div className="admin-map-skeleton-row" />
          <div className="admin-map-skeleton-row" />
          <div className="admin-map-skeleton-row" />
        </div>
      );
    }

    if (centersQuery.isError) {
      return (
        <div className="admin-map-error-state" role="alert">
          <FontAwesomeIcon icon={faCircleExclamation} className="admin-map-state-icon is-error" />
          <span>Failed to load evacuation centers.</span>
          <button
            type="button"
            className="admin-map-state-retry-btn"
            onClick={() => centersQuery.refetch()}
          >
            Retry
          </button>
        </div>
      );
    }

    return (
      <div className="admin-map-list" role="list">
        {isSearching ? (
          <div className="admin-map-search-groups">
            <div className="admin-map-group">
              <div className="admin-map-group-heading">
                <FontAwesomeIcon icon={faHouseFlag} />
                <span>Centers ({filteredCenters.length})</span>
              </div>

              {filteredCenters.length > 0 ? (
                <div className="admin-map-group-items">
                  {filteredCenters.map(renderCenterItem)}
                </div>
              ) : (
                <div className="admin-map-empty-state">
                  <FontAwesomeIcon icon={faBuildingColumns} className="admin-map-state-icon" />
                  <span>No evacuation centers matching &ldquo;{searchQuery}&rdquo;</span>
                </div>
              )}
            </div>

            <div className="admin-map-group">
              <div className="admin-map-group-heading">
                <FontAwesomeIcon icon={faMapPin} />
                <span>
                  Places{" "}
                  {geocodingLoading
                    ? "..."
                    : `(${geocodingResults.length})`}
                </span>
              </div>

              {geocodingResults.length > 0 ? (
                <div className="admin-map-group-items">
                  {geocodingResults.map((place) => (
                    <button
                      key={place.id}
                      type="button"
                      className="admin-map-place-item"
                      onClick={() => handleSelectPlace(place)}
                      title="Fly map to this place"
                    >
                      <FontAwesomeIcon
                        icon={faLocationDot}
                        className="admin-map-place-icon"
                      />
                      <div className="admin-map-place-text">
                        <strong>{place.text || place.place_name}</strong>
                        <small>{place.place_name}</small>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                !geocodingLoading && (
                  <div className="admin-map-search-empty">
                    No places found near Sogod
                  </div>
                )
              )}
            </div>
          </div>
        ) : filteredCenters.length > 0 ? (
          filteredCenters.map(renderCenterItem)
        ) : (
          <div className="admin-map-empty-state">
            <FontAwesomeIcon icon={faBuildingColumns} className="admin-map-state-icon" />
            <span>No evacuation centers match your filter.</span>
          </div>
        )}
      </div>
    );
  }

  // Phase 2: Center Details Modal over the map
  function renderCenterDetailsModal() {
    if (!centerModalOpen || !selectedCenter) return null;
    const props = selectedCenter.properties || selectedCenter || {};
    const centerId = props.id ?? selectedCenter.id;
    const active = Boolean(props.is_active);
    const mapped = isCenterMapped(selectedCenter);
    const capacity = Number(props.capacity || 0);
    const occupied = Number(props.occupied || 0);
    const assigned = Number(props.assigned ?? props.total_assigned ?? 0);
    const occPct =
      capacity > 0 ? Math.min(100, Math.round((occupied / capacity) * 100)) : 0;
    const assignedPct =
      capacity > 0 ? Math.min(100, Math.round((assigned / capacity) * 100)) : 0;
    const isFull = capacity > 0 && occupied >= capacity;
    const isFullyAssigned = capacity > 0 && assigned >= capacity;
    const occ = getOccupancyStatus(occupied, capacity);
    const roomCount =
      roomsCountByCenterId[centerId] ??
      selectedCenterRooms.length ??
      props.total_rooms ??
      props.room_count ??
      0;
    const buildingCount = centerBuildings.length;
    const barangays = props.barangays || props.barangay_breakdown || [];
    const barangayText =
      barangays.length > 0
        ? barangays.map((b) => displayEntityName(b.name || b)).join(", ")
        : displayEntityName(props.barangay_name || props.address) ||
          "Sogod, Southern Leyte";
    const addressText = displayEntityName(props.address);

    const isVenueOrHouse = props.center_type && props.center_type !== "campus";
    const spaceLeft = Math.max(0, capacity - occupied);
    const centerFamilies = selectedCenterDetailsQuery.data?.families || [];
    const isOwner = props.center_type === "private_property" && props.owner_name;

    // Center type config
    const centerType = props.center_type || "campus";
    const typeConfig = {
      campus: { label: "Campus", icon: faBuildingColumns, color: "#2563eb", bg: "#eff6ff" },
      private_property: { label: "Private Property", icon: faHome, color: "#7c3aed", bg: "#f5f3ff" },
      single_venue: { label: "Single Venue", icon: faPlaceOfWorship, color: "#059669", bg: "#ecfdf5" },
    };
    const typeInfo = typeConfig[centerType] || typeConfig.campus;

    // Mapped status chip
    const mappedChip = mapped
      ? { label: "Mapped", color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0", icon: faMapPin }
      : { label: "Not mapped", color: "#dc2626", bg: "#fef2f2", border: "#fecaca", icon: faCircleExclamation };

    // Check if any building has geometry (for campus type)
    const hasMappedBuildings = centerBuildings.some((b) => b.geometry && b.geometry.coordinates && b.geometry.coordinates.length > 0);

    return (
      <div
        className="admin-center-modal-backdrop"
        onClick={handleCloseCenterModal}
      >
        <div
          ref={centerModalDialogRef}
          className="admin-center-modal-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-center-modal-title"
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Fixed Header */}
          <header className="admin-center-modal-header">
            <div className="admin-center-modal-title-group">
              <div className="admin-center-modal-title-row">
                <h2 id="admin-center-modal-title" className="admin-center-modal-title">
                  {props.name || "Evacuation Center"}
                </h2>
                {/* Center type badge */}
                <span
                  className="admin-center-modal-type-badge"
                  style={{
                    backgroundColor: typeInfo.bg,
                    color: typeInfo.color,
                    borderColor: typeInfo.color,
                  }}
                  title={typeInfo.label}
                >
                  <FontAwesomeIcon icon={typeInfo.icon} size="xs" style={{ marginRight: "4px" }} />
                  {typeInfo.label}
                </span>
                {/* Mapped/Not mapped chip */}
                <span
                  className="admin-center-modal-mapped-chip"
                  style={{
                    backgroundColor: mappedChip.bg,
                    color: mappedChip.color,
                    borderColor: mappedChip.border,
                  }}
                >
                  <FontAwesomeIcon icon={mappedChip.icon} size="xs" style={{ marginRight: "4px" }} />
                  {mappedChip.label}
                </span>
                <span
                  className={`admin-center-modal-status-badge ${active ? "is-active" : "is-inactive"}`}
                >
                  {active ? "Active" : "Inactive"}
                </span>
              </div>
              <div className="admin-center-modal-subtitle">
                {barangayText}
                {addressText && addressText !== barangayText
                  ? ` · ${addressText}`
                  : ""}
                {isOwner ? ` · Owner: ${props.owner_name}` : ""}
              </div>
            </div>

            <button
              type="button"
              className="admin-center-modal-close-btn"
              onClick={handleCloseCenterModal}
              aria-label="Close center details"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </header>

          {/* Fixed Summary */}
          <div className="admin-center-modal-summary">
            <div className="admin-center-modal-occ-box">
              <div className="admin-center-modal-occ-top">
                <span className="admin-center-modal-occ-text">
                  {occupied} of {capacity} here · {assigned} / {capacity} assigned
                </span>
                <div className="admin-center-modal-occ-badges">
                  {isFull && (
                    <span className="admin-center-modal-chip is-full">Full</span>
                  )}
                  {isFullyAssigned && (
                    <span className="admin-center-modal-chip is-neutral">
                      Fully assigned
                    </span>
                  )}
                </div>
              </div>

              <div className="admin-center-modal-progress-track">
                {assignedPct > 0 && (
                  <div
                    className="admin-center-modal-progress-assigned"
                    style={{ width: `${assignedPct}%` }}
                  />
                )}
                {occPct > 0 && (
                  <div
                    className="admin-center-modal-progress-fill"
                    style={{
                      width: `${occPct}%`,
                      backgroundColor: occ.color,
                    }}
                  />
                )}
              </div>
            </div>

            <div className="admin-center-modal-stats-row">
              {isVenueOrHouse ? (
                <>
                  <div className="admin-center-modal-stat-pill">
                    <FontAwesomeIcon icon={faHouseFlag} />
                    <span>
                      1 space (
                      {props.center_type === "private_property"
                        ? "Private property"
                        : "Single venue"}
                      )
                    </span>
                  </div>
                  <div className="admin-center-modal-stat-pill">
                    <FontAwesomeIcon icon={faUsers} />
                    <span>
                      {spaceLeft} space{spaceLeft === 1 ? "" : "s"} left
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="admin-center-modal-stat-pill">
                    <FontAwesomeIcon icon={faDoorOpen} />
                    <span>
                      {roomCount} {roomCount === 1 ? "room" : "rooms"}
                    </span>
                  </div>
                  <div className="admin-center-modal-stat-pill">
                    <FontAwesomeIcon icon={faBuildingColumns} />
                    <span>
                      {buildingCount} {buildingCount === 1 ? "building" : "buildings"}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Scrollable Area: Buildings List (for campus) OR Assigned Households (for venue/house) */}
          {isVenueOrHouse ? (
            <div className="admin-center-modal-buildings-section">
              <div className="admin-center-modal-buildings-heading">
                Assigned Households ({centerFamilies.length})
              </div>
              <div
                className="admin-center-modal-buildings-list"
                role="list"
                aria-label="Assigned households"
              >
                {selectedCenterDetailsQuery.isLoading ? (
                  <div
                    style={{
                      padding: "16px 20px",
                      color: "#64748b",
                      fontSize: 13,
                      textAlign: "center",
                    }}
                  >
                    Loading assigned households...
                  </div>
                ) : centerFamilies.length === 0 ? (
                  <div className="admin-center-modal-buildings-empty">
                    No households assigned to this shelter yet.
                  </div>
                ) : (
                  centerFamilies.map((fam) => {
                    const famId = fam.id || fam.family_id;
                    const isExpanded = Boolean(expandedCenterFamilyIds[famId]);
                    const members = fam.members || [];
                    const memCount =
                      fam.resident_count ?? fam.member_count ?? members.length ?? 1;

                    return (
                      <div
                        key={famId}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          background: "#ffffff",
                          border: "1px solid #e2e8f0",
                          borderRadius: 8,
                          marginBottom: 8,
                          overflow: "hidden",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedCenterFamilyIds((prev) => ({
                              ...prev,
                              [famId]: !prev[famId],
                            }))
                          }
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "10px 14px",
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            textAlign: "left",
                            width: "100%",
                          }}
                        >
                          <div>
                            <strong style={{ fontSize: 13, color: "#0f172a" }}>
                              {fam.head_name ||
                                fam.head_of_family ||
                                "Unnamed Household"}
                            </strong>
                            <div
                              style={{
                                fontSize: 12,
                                color: "#64748b",
                                marginTop: 2,
                              }}
                            >
                              {fam.family_code || `FM-${famId}`} · {memCount}{" "}
                              {memCount === 1 ? "member" : "members"}
                            </div>
                          </div>
                          <FontAwesomeIcon
                            icon={isExpanded ? faChevronUp : faChevronDown}
                            style={{ color: "#94a3b8", fontSize: 12 }}
                          />
                        </button>

                        {isExpanded && (
                          <div
                            style={{
                              padding: "8px 14px 12px",
                              background: "#f8fafc",
                              borderTop: "1px solid #e2e8f0",
                              fontSize: 12,
                            }}
                          >
                            {members.length === 0 ? (
                              <span style={{ color: "#64748b" }}>
                                No individual member records listed.
                              </span>
                            ) : (
                              <table
                                style={{
                                  width: "100%",
                                  borderCollapse: "collapse",
                                }}
                              >
                                <thead>
                                  <tr
                                    style={{
                                      color: "#64748b",
                                      textAlign: "left",
                                      borderBottom: "1px solid #e2e8f0",
                                    }}
                                  >
                                    <th
                                      style={{
                                        padding: "4px 0",
                                        fontWeight: 600,
                                      }}
                                    >
                                      Name
                                    </th>
                                    <th
                                      style={{
                                        padding: "4px 0",
                                        fontWeight: 600,
                                      }}
                                    >
                                      Age
                                    </th>
                                    <th
                                      style={{
                                        padding: "4px 0",
                                        fontWeight: 600,
                                      }}
                                    >
                                      Gender
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {members.map((m, idx) => (
                                    <tr
                                      key={m.id || idx}
                                      style={{
                                        borderBottom: "1px solid #f1f5f9",
                                      }}
                                    >
                                      <td
                                        style={{
                                          padding: "4px 0",
                                          color: "#1e293b",
                                        }}
                                      >
                                        {m.full_name ||
                                          m.name ||
                                          `${m.first_name || ""} ${m.last_name || ""}`.trim() ||
                                          "Member"}
                                      </td>
                                      <td
                                        style={{
                                          padding: "4px 0",
                                          color: "#64748b",
                                        }}
                                      >
                                        {m.age ?? "—"}
                                      </td>
                                      <td
                                        style={{
                                          padding: "4px 0",
                                          color: "#64748b",
                                        }}
                                      >
                                        {m.gender ?? "—"}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            <div className="admin-center-modal-buildings-section">
              <div className="admin-center-modal-buildings-heading">
                Buildings ({buildingCount})
              </div>
              <div
                className="admin-center-modal-buildings-list"
                role="list"
                aria-label="Buildings in this center"
              >
                {buildingCount === 0 ? (
                  <div className="admin-center-modal-buildings-empty-action">
                    <div className="admin-center-modal-empty-icon-wrap">
                      <FontAwesomeIcon icon={faBuildingColumns} />
                    </div>
                    <div className="admin-center-modal-empty-text">
                      No buildings yet. Draw one to link its rooms.
                    </div>
                    <button
                      type="button"
                      className="admin-center-modal-btn is-primary"
                      onClick={() => startAddBuildingFlowForCenter(selectedCenter)}
                    >
                      <FontAwesomeIcon icon={faDrawPolygon} style={{ marginRight: 6 }} />
                      Add building
                    </button>
                  </div>
                ) : (
                  !mapped ? (
                    // Center not mapped: show "Map the center first" message
                    <div className="admin-center-modal-buildings-empty-action">
                      <div className="admin-center-modal-empty-icon-wrap">
                        <FontAwesomeIcon icon={faCircleExclamation} />
                      </div>
                      <div className="admin-center-modal-empty-text">
                        Map the center first
                      </div>
                    </div>
                  ) : (
                    centerBuildings.map((b) => {
                      const bProps = b.properties || {};
                      const bId = bProps.id ?? b.id;
                      const bName = bProps.name || "Building";
                      const bRoomCount =
                        bProps.room_count ??
                        selectedCenterRooms.filter(
                          (r) => String(r.building_id) === String(bId)
                        ).length;
                      const bCap = Number(bProps.capacity || 0);
                      const bOcc = Number(bProps.occupied || 0);
                      const bOccPct =
                        bCap > 0
                          ? Math.min(100, Math.round((bOcc / bCap) * 100))
                          : 0;
                      const bColor =
                        bProps.fill_color ||
                        bProps.status_color ||
                        (bCap <= 0
                          ? "#94a3b8"
                          : bOcc >= bCap
                          ? "#dc2626"
                          : bOccPct >= 70
                          ? "#d97706"
                          : "#16a34a");
                      // Building mapped status
                      const bMapped = Boolean(b.geometry && b.geometry.coordinates && b.geometry.coordinates.length > 0);
                      const bMappedChip = bMapped
                        ? { label: "Mapped", color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0", icon: faMapPin }
                        : { label: "Not mapped", color: "#dc2626", bg: "#fef2f2", border: "#fecaca", icon: faCircleExclamation };

                      // Building polygon action handler
                      const handleBuildingPolygonAction = (e) => {
                        e.stopPropagation(); // Prevent row click (zoom to building)
                        if (bMapped) {
                          // Edit existing building polygon
                          const points = polygonToPoints(b.geometry);
                          // Store original points for Restore functionality
                          setBuildingEditOriginalPoints(points);
                          // Clear undo stack
                          setBuildingEditUndoStack([]);
                          // Load existing polygon points so vertex handles appear for editing
                          setNewBuildingPoints(points.length >= 3 ? points : []);
                          setRedrawingBuildingId(bId);
                          setIsDrawingBuilding(true);

                          handleCloseCenterModal();
                        } else {
                          // Map existing unmapped building polygon (updates existing building, never creates new)
                          setNewBuildingPoints([]);
                          setBuildingEditOriginalPoints([]);
                          setBuildingEditUndoStack([]);
                          setRedrawingBuildingId(bId);
                          setIsDrawingBuilding(true);
                          handleCloseCenterModal();
                        }
                      };

                      return (
                        <div key={bId} className="admin-center-modal-building-row-wrap">
                          <button
                            type="button"
                            role="listitem"
                            className="admin-center-modal-building-row"
                            onClick={() => {
                              setSelectedBuildingId(bId);
                              const centroid = getPolygonCentroid(b.geometry);
                              if (centroid) {
                                setMapFocusLocation({
                                  ...centroid,
                                  zoom: 18,
                                  noPin: true,
                                  requestedAt: Date.now(),
                                });
                              }
                              setCenterModalOpen(false);
                              setBuildingModalOpen(true);
                            }}
                          >
                            <span
                              className="admin-center-modal-building-swatch"
                              style={{ backgroundColor: bColor }}
                              aria-hidden="true"
                            />
                            <span className="admin-center-modal-building-name">
                              {bName}
                            </span>
                            <span className="admin-center-modal-building-rooms">
                              {bRoomCount} {bRoomCount === 1 ? "room" : "rooms"}
                            </span>
                            {/* Mapped/Not mapped chip for building */}
                            <span
                              className="admin-center-modal-building-mapped-chip"
                              style={{
                                backgroundColor: bMappedChip.bg,
                                color: bMappedChip.color,
                                borderColor: bMappedChip.border,
                              }}
                            >
                              <FontAwesomeIcon icon={bMappedChip.icon} size="xs" style={{ marginRight: "4px" }} />
                              {bMappedChip.label}
                            </span>
                            <span className="admin-center-modal-building-occ">
                              {bOcc} of {bCap} here
                            </span>
                            <FontAwesomeIcon
                              icon={faChevronRight}
                              className="admin-center-modal-building-chevron"
                            />
                          </button>
                          {/* Building polygon action button */}
                          <button
                            type="button"
                            className="admin-center-modal-building-action"
                            onClick={handleBuildingPolygonAction}
                            title={bMapped ? `Edit ${bName} polygon` : `Map ${bName} polygon`}
                            aria-label={bMapped ? "Edit polygon" : "Map building"}
                          >
                            <FontAwesomeIcon
                              icon={bMapped ? faPen : faDrawPolygon}
                              size="xs"
                              style={{ marginRight: "4px" }}
                            />
                            {bMapped ? "Edit polygon" : "Map building"}
                          </button>
                        </div>
                      );
                    })
                  )
                )}
              </div>
            </div>
          )}

          {/* Fixed Footer */}
          <footer className="admin-center-modal-footer">
            {!mapped ? (
              // NOT MAPPED: Primary "Place on map", Secondary "Edit center"
              <>
                <button
                  type="button"
                  className="admin-center-modal-btn is-primary"
                  onClick={() => {
                    handleCloseCenterModal();
                    startPlacementFlow(selectedCenter);
                  }}
                >
                  <FontAwesomeIcon icon={faDrawPolygon} style={{ marginRight: "6px" }} />
                  Place on map
                </button>
                <button
                  type="button"
                  className="admin-center-modal-btn is-secondary"
                  onClick={() => {
                    navigate(`${basePath}?tab=centers&center=${centerId}`);
                  }}
                >
                  <FontAwesomeIcon icon={faPen} style={{ marginRight: "6px" }} />
                  Edit center
                </button>
              </>
            ) : (
              // MAPPED: Primary "Edit polygon", Secondary "View on map" + "Edit center"
              <>
                <button
                  type="button"
                  className="admin-center-modal-btn is-primary"
                  onClick={() => {
                    handleCloseCenterModal();
                    startPlacementFlow(selectedCenter);
                  }}
                >
                  <FontAwesomeIcon icon={faPen} style={{ marginRight: "6px" }} />
                  Edit polygon
                </button>
                <button
                  type="button"
                  className="admin-center-modal-btn is-text"
                  onClick={() => {
                    // View on map - focus map on center and close modal
                    const coords = getCenterCoordinates(selectedCenter);
                    if (coords) {
                      setMapFocusLocation({
                        ...coords,
                        zoom: 16,
                        noPin: true,
                        requestedAt: Date.now(),
                      });
                    }
                    handleCloseCenterModal();
                  }}
                >
                  <FontAwesomeIcon icon={faEye} style={{ marginRight: "6px" }} />
                  View on map
                </button>
                <button
                  type="button"
                  className="admin-center-modal-btn is-text"
                  onClick={() => {
                    navigate(`${basePath}?tab=centers&center=${centerId}`);
                  }}
                >
                  <FontAwesomeIcon icon={faPen} style={{ marginRight: "6px" }} />
                  Edit center
                </button>
              </>
            )}
          </footer>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-layout">
      {/* Admin Sidebar with "Map" tab active */}
      <Sidebar
        tab="map"
        setTab={handleTabChange}
        user={user}
        logout={logout}
        isMobile={isMobile}
        onSelectNotification={handleNotificationSelect}
      />

      <div className="dashboard-content">
        <main
          className={`admin-map-page ${
            panelCollapsed ? "is-panel-collapsed" : ""
          } ${isMapping ? "in-mapping-mode" : ""} ${
            selectedCenter ? "has-selected-center" : ""
          } mobile-snap-${mobileSheetSnap}`}
          aria-label="Admin Map View"
        >
          {/* ---------------------------------------------------------
              MAP CANVAS & PLACEMENT FLOW WORKSPACE (Fills entire area)
              --------------------------------------------------------- */}
          <div className="admin-map-canvas-wrap">
            {/* Active Center Placement Flow (Full-Screen Workspace overlay) */}
            {isMapping ? (
              <CenterPlacementFlow
                center={editingCenter}
                step={mappingStep}
                onStepChange={handleStepChange}
                footprintPoints={footprintPoints}
                onFootprintPointsChange={setFootprintPoints}
                entrancePoints={entrancePoints}
                onEntrancePointsChange={setEntrancePoints}
                mappingTool={mappingTool}
                onMappingToolChange={setMappingTool}
                mapZoom={mapZoom}
                onCancel={cancelPlacementFlow}
                onSave={handleSaveMapPlacement}
                saving={savingMap}
                onZoomIn={() => {
                  setMapFocusLocation({
                    zoom: 18,
                    requestedAt: Date.now(),
                  });
                }}
                toastMessage={placementToast}
              >
                <DashboardMap
                  centers={centers}
                  hazardZones={hazardZones}
                  selectedCenter={selectedCenter}
                  editingCenter={editingCenter}
                  mappingTool={mappingTool}
                  onMappingToolChange={setMappingTool}
                  currentZoom={mapZoom}
                  onZoomChange={setMapZoom}
                  onCenterClick={(center) => handleSelectCenter(center)}
                  focusLocation={mapFocusLocation}
                  hideInternalPanel={true}
                  hideSearch={true}
                  hideZoomControls={true}
                  drawMode={
                    mappingStep === "footprint"
                      ? "footprint"
                      : mappingStep === "entrance"
                      ? "entrance"
                      : "confirm"
                  }
                  pendingFootprint={footprintPoints}
                  pendingEntrances={entrancePoints}
                  onCloseShape={() => {
                    if (footprintPoints.length >= 3) {
                      setMappingStep("entrance");
                    }
                  }}
                  onOutsideOutlineClick={() => {
                    showPlacementToast("Entrance must be on the outline");
                  }}
                  onMapClick={(latlng) => {
                    if (mappingTool === "pan") return;
                    if (mappingStep === "footprint") {
                      setFootprintPoints((pts) => [...pts, latlng]);
                    } else if (mappingStep === "entrance") {
                      setEntrancePoints((pts) => [...pts, latlng]);
                    }
                  }}
                  onEntranceDrag={(index, point, isFinal) => {
                    if (!isFinal) {
                      // Update during drag for live preview
                      setEntrancePoints((pts) =>
                        pts.map((p, i) => (i === index ? point : p))
                      );
                    }
                  }}
                  hiddenCenterId={redrawingCenterId || undefined}
                  hiddenBuildingId={redrawingBuildingId || undefined}
                />
              </CenterPlacementFlow>
            ) : (
              <DashboardMap
                centers={centers}
                hazardZones={hazardZones}
                selectedCenter={selectedCenter}
                panelSubView={panelSubView}
                editingCenter={editingCenter}
                currentZoom={mapZoom}
                onZoomChange={setMapZoom}
                onCenterClick={(center) => {
                  if (isPlacingRoom || isDrawingBuilding) return;
                  handleSelectCenter(center);
                }}
                rooms={selectedCenterRooms.length > 0 ? selectedCenterRooms : (allLoadedRooms || [])}
                buildingsGeoJSON={buildingsGeoJSON}
                selectedBuildingId={selectedBuildingId}
                onBuildingClick={handleBuildingClick}
                hoveredRoomId={hoveredRoomId}
                selectedRoomId={selectedRoomId}
                onRoomClick={handleRoomClick}
                onMapBackgroundClick={handleMapBackgroundClick}
                focusLocation={mapFocusLocation}
                hideInternalPanel={true}
                hideSearch={true}
                hideZoomControls={false}
                hiddenCenterId={redrawingCenterId || undefined}
                hiddenBuildingId={redrawingBuildingId || undefined}
                drawMode={isDrawingBuilding ? "footprint" : isPlacingRoom ? "room" : "none"}
                pendingFootprint={
                  isDrawingBuilding
                    ? newBuildingPoints
                    : (isPlacingRoom || panelSubView === "map_rooms") && selectedCenter?.geometry
                    ? polygonToPoints(selectedCenter.geometry)
                    : []
                }
                // Building edit mode props
                editingBuildingId={isDrawingBuilding && redrawingBuildingId ? redrawingBuildingId : null}
                editingBuildingPoints={isDrawingBuilding && redrawingBuildingId ? newBuildingPoints : null}
                onEditingBuildingPointsChange={isDrawingBuilding && redrawingBuildingId ? handleEditingBuildingPointsChange : null}
                onOutsideOutlineClick={() => {
                  showPlacementToast(
                    "Click inside or near the outline."
                  );
                }}
                onBasemapBuildingClick={handleBasemapBuildingClick}
                onDoubleTapFinish={handleDoubleTapFinish}
                onCloseShape={() => {
                  if (isDrawingBuilding && addBuildingStep === "draw") {
                    handleDoubleTapFinish();
                  }
                }}
                onMapClick={(latlng) => {
                  if (isPlacingRoom) {
                    handleMapClickForRoom(latlng);
                  } else if (isDrawingBuilding) {
                    // Allow adding points by clicking in ALL building drawing modes:
                    // - Adding a new building
                    // - Mapping an unmapped building
                    // - Editing an existing building (redrawingBuildingId is set)
                    setNewBuildingPoints((pts) => [...pts, latlng]);
                  }
                }}
              />
            )}

            {/* Active Room Placement Top Bar */}
            {isPlacingRoom && placingRoom && (
              <div className="admin-map-room-placement-bar" role="status">
                <div className="admin-map-room-placement-text">
                  <FontAwesomeIcon icon={faLocationDot} />
                  <span>
                    <strong>Placing: {placingRoom.room_number}</strong>{" "}
                    {remainingUnmappedRooms.length > 0 && initialUnmappedCount > 0 ? (
                      <span className="admin-map-placement-counter">
                        ({remainingUnmappedRooms.length} of {initialUnmappedCount} left).
                      </span>
                    ) : null}{" "}
                    <span className="admin-map-placement-hint">
                      Click inside or near the center outline.
                    </span>
                  </span>
                </div>
                <div className="admin-map-room-placement-actions">
                  {remainingUnmappedRooms.length > 1 && (
                    <button
                      type="button"
                      className="admin-map-placement-btn admin-map-placement-btn-skip"
                      onClick={handleSkipRoom}
                      title="Skip this room and go to next"
                    >
                      Skip
                    </button>
                  )}
                  <button
                    type="button"
                    className="admin-map-placement-btn admin-map-placement-btn-done"
                    onClick={handleDonePlacement}
                    title="Finish mapping"
                  >
                    Done
                  </button>
                  <button
                    type="button"
                    className="admin-map-room-placement-cancel"
                    onClick={handleCancelPlacement}
                    title="Cancel placement mode (Esc)"
                  >
                    <FontAwesomeIcon icon={faXmark} /> Cancel (Esc)
                  </button>
                </div>
              </div>
            )}

            {/* Building edit toolbar (full-screen like center edit) */}
            {isDrawingBuilding && redrawingBuildingId && (
              <div className="admin-map-building-edit-bar" role="toolbar" aria-label="Building edit actions">
                <div className="admin-map-building-edit-title">
                  <FontAwesomeIcon icon={faArrowsRotate} />
                  <span>Editing {selectedBuildingDetail?.properties?.name || "Building"}</span>
                </div>
                {buildingEditBoundaryError && (
                  <div className="admin-map-building-edit-error" role="alert">
                    <FontAwesomeIcon icon={faCircleExclamation} />
                    <span>{buildingEditBoundaryError}</span>
                  </div>
                )}
                <div className="admin-map-building-edit-actions">
                  <button
                    type="button"
                    className="admin-map-btn admin-map-btn-secondary"
                    onClick={handleUndoBuildingEdit}
                    disabled={buildingEditUndoStack.length === 0}
                    title="Undo last change"
                    aria-label="Undo"
                  >
                    <FontAwesomeIcon icon={faRotateLeft} />
                    <span>Undo</span>
                  </button>
                  <button
                    type="button"
                    className="admin-map-btn admin-map-btn-secondary"
                    onClick={handleResetBuildingEdit}
                    disabled={buildingEditOriginalPoints.length === 0}
                    title="Reset to original outline"
                    aria-label="Reset"
                  >
                    <FontAwesomeIcon icon={faArrowLeft} />
                    <span>Reset</span>
                  </button>
                  <button
                    type="button"
                    className="admin-map-btn admin-map-btn-secondary"
                    onClick={handleRedrawBuildingEdit}
                    title="Redraw from scratch"
                    aria-label="Redraw"
                  >
                    <FontAwesomeIcon icon={faTrashCan} />
                    <span>Redraw</span>
                  </button>
                  <button
                    type="button"
                    className="admin-map-btn admin-map-btn-primary"
                    onClick={handleSaveBuildingOutline}
                    disabled={newBuildingPoints.length < 3 || isSavingBuilding}
                    title="Save building outline"
                    aria-label="Save"
                  >
                    <FontAwesomeIcon icon={faCheck} />
                    <span>{isSavingBuilding ? "Saving..." : "Save"}</span>
                  </button>
                  <button
                    type="button"
                    className="admin-map-btn admin-map-btn-danger"
                    onClick={handleCancelDrawingBuilding}
                    disabled={isSavingBuilding}
                    title="Cancel editing"
                    aria-label="Cancel"
                  >
                    <FontAwesomeIcon icon={faXmark} />
                    <span>Cancel</span>
                  </button>
                </div>
              </div>
            )}

            {/* Room placement toast (e.g. click outside outline) */}
            {placementToast && !isMapping && (
              <div className="admin-map-floating-toast" role="alert">
                <span>{placementToast}</span>
              </div>
            )}

            {/* Post-Save Toast with "Back to center" Button */}
            {saveNotice && !isMapping && (
              <div className="admin-map-save-banner" role="status">
                <div className="admin-map-save-banner-text">
                  <FontAwesomeIcon icon={faCheck} className="text-green-400" />
                  <span>{saveNotice.message}</span>
                </div>

                <button
                  type="button"
                  className="btn-back"
                  onClick={() => {
                    const basePath = isAdmin ? "/admin" : "/lgu";
                    navigate(
                      `${basePath}?tab=centers&center=${saveNotice.centerId}`
                    );
                  }}
                  title="Open this center on the Evacuation Centers page"
                >
                  <FontAwesomeIcon icon={faArrowLeft} />
                  <span>Back to center</span>
                </button>

                <button
                  type="button"
                  className="btn-dismiss"
                  onClick={() => setSaveNotice(null)}
                  aria-label="Dismiss notification"
                  title="Dismiss notification"
                >
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              </div>
            )}

          </div>

          {/* ---------------------------------------------------------
              DESKTOP FLOATING PANEL (Width 360px, left 16px, top 16px)
              --------------------------------------------------------- */}
          {!isMobile && !panelCollapsed && !isMapping && !isDrawingBuilding && (
            <aside
              className="admin-map-floating-panel"
              aria-label="Evacuation Centers Panel"
            >
              {selectedCenter && panelSubView === "map_rooms" ? (
                renderMapRoomsView()
              ) : (
                <>
                  <header className="admin-map-panel-header">
                    <div className="admin-map-panel-title-row">
                      <div className="admin-map-panel-title-group">
                        <h2>Centers</h2>
                        <span className="admin-map-panel-count">
                          {allCentersList.length}{" "}
                          {allCentersList.length === 1 ? "center" : "centers"}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="admin-map-panel-collapse-btn"
                        onClick={() => setPanelCollapsed(true)}
                        title="Collapse panel"
                        aria-label="Collapse centers panel"
                      >
                        <FontAwesomeIcon icon={faChevronLeft} />
                      </button>
                    </div>
                    {renderPanelHeaderControls()}
                  </header>

                  <div className="admin-map-panel-body">
                    {renderPanelContent()}
                  </div>
                </>
              )}
            </aside>
          )}

          {/* Collapsed 48px Rounded Rail on Desktop (Floating, not full height, no rotated text) */}
          {!isMobile && panelCollapsed && !isMapping && (
            <button
              type="button"
              className="admin-map-rail"
              onClick={() => setPanelCollapsed(false)}
              title="Expand Centers Panel"
              aria-label={`Expand Centers panel (${allCentersList.length} centers)`}
            >
              <span className="admin-map-rail-icon">
                <FontAwesomeIcon icon={faLocationDot} />
              </span>
              <span className="admin-map-rail-count">
                {allCentersList.length}
              </span>
              {unmappedCentersCount > 0 && (
                <span className="admin-map-rail-badge" aria-label={`${unmappedCentersCount} unmapped center${unmappedCentersCount !== 1 ? 's' : ''}`}>
                  {unmappedCentersCount}
                </span>
              )}
            </button>
          )}

          {/* ---------------------------------------------------------
              MOBILE BOTTOM SHEET (Visible <= 768px: collapsed 120px, half, full)
              --------------------------------------------------------- */}
          {isMobile && !isMapping && !isDrawingBuilding && (
            <section
              className={`admin-map-bottom-sheet is-open snap-${mobileSheetSnap}`}
              role="region"
              aria-label="Evacuation Centers"
            >
              <button
                type="button"
                className="admin-map-sheet-drag-handle"
                onClick={() => {
                  setMobileSheetSnap((prev) =>
                    prev === "collapsed"
                      ? "half"
                      : prev === "half"
                      ? "full"
                      : "collapsed"
                  );
                }}
                aria-label={`Centers panel height: ${mobileSheetSnap}. Tap to change height.`}
              >
                <span className="admin-map-sheet-handle-bar" aria-hidden="true" />
                {unmappedCentersCount > 0 && (
                  <span className="admin-map-sheet-badge" aria-label={`${unmappedCentersCount} unmapped center${unmappedCentersCount !== 1 ? 's' : ''}`}>
                    {unmappedCentersCount}
                  </span>
                )}
              </button>

              {selectedCenter && panelSubView === "map_rooms" ? (
                <div className="admin-map-sheet-body is-map-rooms">
                  {renderMapRoomsView()}
                </div>
              ) : (
                <>
                  <header className="admin-map-panel-header is-mobile-sheet-header">
                    <div className="admin-map-panel-title-row">
                      <div className="admin-map-panel-title-group">
                        <h2>Centers</h2>
                        <span className="admin-map-panel-count">
                          {allCentersList.length}{" "}
                          {allCentersList.length === 1 ? "center" : "centers"}
                        </span>
                      </div>

                      <div className="admin-map-sheet-snap-controls">
                        <button
                          type="button"
                          className="admin-map-panel-collapse-btn"
                          onClick={() => {
                            setMobileSheetSnap((prev) =>
                              prev === "collapsed"
                                ? "half"
                                : prev === "half"
                                ? "full"
                                : "collapsed"
                            );
                          }}
                          aria-label={
                            mobileSheetSnap === "collapsed"
                              ? "Expand centers sheet"
                              : mobileSheetSnap === "half"
                              ? "Maximize centers sheet"
                              : "Collapse centers sheet"
                          }
                        >
                          <FontAwesomeIcon
                            icon={
                              mobileSheetSnap === "full"
                                ? faChevronDown
                                : faChevronUp
                            }
                          />
                        </button>
                      </div>
                    </div>
                    {renderPanelHeaderControls(mobileSheetSnap === "collapsed")}
                  </header>

                  {mobileSheetSnap !== "collapsed" && (
                    <div className="admin-map-sheet-body">
                      {renderPanelContent()}
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {/* Phase 2: Center Details Modal over the map */}
          {renderCenterDetailsModal()}

          {/* Rename Building Modal */}
          {renamingBuilding && (
            <div className="admin-map-modal-backdrop" onClick={() => setRenamingBuilding(null)}>
              <div className="admin-map-modal-dialog" onClick={(e) => e.stopPropagation()}>
                <div className="admin-map-modal-title">Rename Building</div>
                <div className="admin-map-modal-body">
                  <input
                    type="text"
                    className="admin-map-modal-input"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    placeholder="Enter building name"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveRename();
                      if (e.key === "Escape") setRenamingBuilding(null);
                    }}
                  />
                </div>
                <div className="admin-map-modal-actions">
                  <button
                    type="button"
                    className="admin-map-modal-btn is-secondary"
                    onClick={() => setRenamingBuilding(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="admin-map-modal-btn is-primary"
                    onClick={handleSaveRename}
                    disabled={!renameValue.trim()}
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Delete Building Confirmation Modal */}
          {deletingBuilding && (
            <div className="admin-map-modal-backdrop" onClick={() => setDeletingBuilding(null)}>
              <div className="admin-map-modal-dialog" onClick={(e) => e.stopPropagation()}>
                <div className="admin-map-modal-title">Delete Building</div>
                <div className="admin-map-modal-body">
                  Are you sure you want to delete <strong>"{deletingBuilding.properties?.name || "this building"}"</strong>?
                  <p style={{ marginTop: "8px", fontSize: "13px", color: "#64748b" }}>
                    Any linked rooms will become unassigned, but their coordinates and family assignments will remain untouched.
                  </p>
                </div>
                <div className="admin-map-modal-actions">
                  <button
                    type="button"
                    className="admin-map-modal-btn is-secondary"
                    onClick={() => setDeletingBuilding(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="admin-map-modal-btn is-danger"
                    onClick={handleConfirmDeleteBuilding}
                  >
                    Delete Building
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Manage / Link Rooms Modal */}
          {managingRoomsBuilding && (
            <div className="admin-map-modal-backdrop" onClick={() => setManagingRoomsBuilding(null)}>
              <div className="admin-map-modal-dialog is-wide" onClick={(e) => e.stopPropagation()}>
                <div className="admin-map-modal-title">
                  Link / Unlink Rooms · {managingRoomsBuilding.properties?.name || "Building"}
                </div>
                <div className="admin-map-modal-body">
                  <p style={{ marginBottom: "8px", fontSize: "13px" }}>
                    Select rooms located in this building ({managingRoomIds.length} linked):
                  </p>
                  <div className="admin-map-link-rooms-checklist">
                    {selectedCenterRooms
                      .filter((r) => r.is_active !== false)
                      .sort(naturalCompare)
                      .map((r) => {
                        const checked = managingRoomIds.includes(r.id);
                        const isOtherBld = r.building_id && String(r.building_id) !== String(managingRoomsBuilding.properties?.id ?? managingRoomsBuilding.id);
                        return (
                          <label key={r.id} className="admin-map-add-room-checkbox-label">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setManagingRoomIds((prev) => [...prev, r.id]);
                                } else {
                                  setManagingRoomIds((prev) => prev.filter((id) => id !== r.id));
                                }
                              }}
                            />
                            <span>Room {r.room_number}{isOtherBld ? " (reassign)" : ""}</span>
                          </label>
                        );
                      })}
                  </div>
                </div>
                <div className="admin-map-modal-actions">
                  <button
                    type="button"
                    className="admin-map-modal-btn is-secondary"
                    onClick={() => setManagingRoomsBuilding(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="admin-map-modal-btn is-primary"
                    onClick={handleSaveManageRooms}
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            </div>
          )}
          {/* Standalone Room Details Modal (Desktop Centered & Mobile Bottom Sheet) */}
          <RoomDetailsModal
            isOpen={roomModalOpen}
            room={selectedRoom}
            centers={centers}
            canManageRooms={canManageRooms}
            basePath={basePath}
            onClose={handleCloseRoomModal}
          />
          {/* Standalone Building Details Modal (Staff mode: shows assigned families, contact, special needs) */}
          <BuildingDetailsModal
            isOpen={buildingModalOpen}
            buildingId={selectedBuildingId}
            isStaff={true}
            onClose={handleCloseBuildingModal}
          />
        </main>
      </div>
    </div>
  );
}

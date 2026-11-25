import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { appAlert, appConfirm } from "../../utils/appDialog";
import {
  Maximize2,
  Minimize2,
  Plus,
  LifeBuoy,
  AlertTriangle,
  Search,
  X,
  PanelLeftClose,
  Building2,
  Building,
  Home,
  Landmark,
  Pencil,
  MapPin,
  AlertCircle,
  ExternalLink,
  ChevronRight,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
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
  faBuilding,
  faHand,
  faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";
import {
  MapControlButton,
  MapOverlayPanel,
  StatusPill,
  ProgressBar,
  SegmentedControl,
} from "../../components/ui";

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
  useSogodBoundary,
  useRescueRequests,
  useBarangays,
} from "../../hooks/useEvacuationQueries";
import Sidebar from "../../components/Sidebar/Sidebar";
import DashboardMap, {
  isCenterMapped,
  getOccupancyStatus,
  getCenterCoordinates,
  isPointInOrNearPolygon,
  isBuildingInsideCenter,
} from "../../components/DashboardMap/DashboardMap";
import CenterPlacementFlow, { polygonToPoints } from "../../components/CenterPlacementFlow/CenterPlacementFlow";
import RoomDetailsModal from "../../components/EvacuationCenter/RoomDetailsModal";
import BuildingDetailsModal from "../../components/BuildingDetailsModal/BuildingDetailsModal";
import { AddBuildingModal, BuildingFormModal, CenterRoomModal, CenterFormModal } from "../../components/EvacuationCenter/CenterModals";
import { displayEntityName } from "../../utils/displayEntityName";
import { snapLngLatToPolygonEdge } from "../../utils/polygonSnap";
import { isBlockedRoadReport } from "../../components/mapReports/mapReports";
import "../resident/ResidentHome.css";
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
 * Checks whether a [lng, lat] coordinate is inside a GeoJSON Polygon / MultiPolygon coordinates structure.
 */
function isPointInGeoPolygon(point, coordinates) {
  if (!point || !coordinates || !Array.isArray(coordinates)) return false;
  const [x, y] = point;

  function checkRing(ring) {
    if (!ring || ring.length < 3) return false;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = Number(ring[i][0]);
      const yi = Number(ring[i][1]);
      const xj = Number(ring[j][0]);
      const yj = Number(ring[j][1]);
      const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  if (Array.isArray(coordinates[0]) && typeof coordinates[0][0] === "number") {
    return checkRing(coordinates);
  }
  if (Array.isArray(coordinates[0]) && Array.isArray(coordinates[0][0]) && typeof coordinates[0][0][0] === "number") {
    return checkRing(coordinates[0]);
  }
  if (Array.isArray(coordinates[0]) && Array.isArray(coordinates[0][0]) && Array.isArray(coordinates[0][0][0])) {
    return coordinates.some((poly) => checkRing(poly[0]));
  }
  return false;
}

/**
 * Validates that all building vertices and edges stay strictly inside the center boundary.
 * Returns { valid: boolean, invalidPoints: Array<{index, point}> }
 */
function validateBuildingInsideCenter(buildingPoints, centerPoints) {
  if (!centerPoints || centerPoints.length < 3) return { valid: true, invalidPoints: [] };
  const invalidPoints = [];
  buildingPoints.forEach((point, index) => {
    if (!isPointInOrNearPolygon(point, centerPoints, 0.1)) {
      invalidPoints.push({ index, point });
    }
  });
  const edgesInside = isBuildingInsideCenter(buildingPoints, centerPoints, true);
  return { valid: invalidPoints.length === 0 && edgesInside, invalidPoints };
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
  const deepLinkedStatus = (searchParams.get("status") || "").toLowerCase();

  // Geocoded barangay fallback state for deep linked coordinates
  const [geoBarangay, setGeoBarangay] = useState("");

  // Centers & hazard zones data
  const centersQuery = useEvacuationCenters(true);
  const hazardZonesQuery = useHazardZones();
  const { data: sogodBoundary = null } = useSogodBoundary();
  const allHazardReportsQuery = useHazardReports("all", {
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
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
  const { buildingsGeoJSON, isLoading: buildingsLoading, refetch: refetchBuildings } = useBuildingsForCenters(centers);

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

  // Map of center ID -> active building count & mapped/unmapped breakdown for list rows
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

  const buildingStatsByCenterId = useMemo(() => {
    const stats = {};
    if (buildingsGeoJSON?.features) {
      buildingsGeoJSON.features.forEach((b) => {
        const cId = b.properties?.evacuation_center_id;
        if (cId == null) return;
        if (!stats[cId]) stats[cId] = { total: 0, mapped: 0, unmapped: 0 };
        stats[cId].total += 1;
        const isMapped = Boolean(
          (b.geometry &&
            Array.isArray(b.geometry.coordinates) &&
            b.geometry.coordinates.length > 0) ||
            b.properties?.is_mapped
        );
        if (isMapped) stats[cId].mapped += 1;
        else stats[cId].unmapped += 1;
      });
    }
    if (centers?.features) {
      centers.features.forEach((c) => {
        const props = c.properties || c;
        const cId = props.id ?? c.id;
        if (cId == null || stats[cId]) return;
        if (Array.isArray(props.buildings)) {
          const total = props.buildings.length;
          const mapped = props.buildings.filter((b) => Boolean(b?.is_mapped)).length;
          stats[cId] = { total, mapped, unmapped: Math.max(0, total - mapped) };
        } else if (props.building_count != null) {
          const total = Number(props.building_count || 0);
          const unmapped = Number(props.unmapped_building_count || 0);
          const mapped = Number(props.mapped_building_count ?? Math.max(0, total - unmapped));
          stats[cId] = { total, mapped, unmapped };
        }
      });
    }
    return stats;
  }, [buildingsGeoJSON, centers]);

  const unmappedBuildingsSummary = useMemo(() => {
    let totalUnmappedBuildings = 0;
    let centersWithUnmappedBuildings = 0;
    if (centers?.features) {
      centers.features.forEach((c) => {
        const props = c.properties || c;
        const cId = props.id ?? c.id;
        const cType = props.center_type || "campus";
        if (cType !== "campus") return;
        const st = buildingStatsByCenterId[cId];
        const unmapped = st ? st.unmapped : Number(props.unmapped_building_count || 0);
        if (unmapped > 0) {
          totalUnmappedBuildings += unmapped;
          centersWithUnmappedBuildings += 1;
        }
      });
    }
    return { totalUnmappedBuildings, centersWithUnmappedBuildings };
  }, [centers, buildingStatsByCenterId]);

  // Unmapped centers count for sidebar badge
  const unmappedCentersCount = useMemo(() => {
    if (!centers?.features) return 0;
    return centers.features.filter((c) => !isCenterMapped(c)).length;
  }, [centers]);

  // Rescue requests query for action bar badge & map overlay markers
  const rescueRequestsQuery = useRescueRequests();
  const activeRescueRequests = useMemo(() => {
    const data = rescueRequestsQuery.data;
    const list = Array.isArray(data)
      ? data
      : Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data?.requests)
          ? data.requests
          : [];
    return list.filter((r) => {
      const s = String(r.status || "").toLowerCase();
      return s !== "resolved" && s !== "completed" && s !== "cancelled";
    });
  }, [rescueRequestsQuery.data]);

  const openRescueCount = useMemo(() => {
    return activeRescueRequests.filter((r) => {
      const s = String(r.status || "").toLowerCase();
      return s === "pending" || s === "open";
    }).length;
  }, [activeRescueRequests]);

  // Pending hazard reports awaiting staff review
  const pendingHazardReports = useMemo(() => {
    const data = allHazardReportsQuery.data;
    const list = Array.isArray(data)
      ? data
      : Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data?.reports)
          ? data.reports
          : [];
    return list.filter(
      (r) => String(r?.status || "").toLowerCase() === "pending"
    );
  }, [allHazardReportsQuery.data]);

  // Barangays data for Add Center wizard
  const { data: barangaysData = [] } = useBarangays();

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

  const matchedRescueRequest = useMemo(() => {
    if (!deepLinkedRescueId) return null;
    const data = rescueRequestsQuery.data;
    const list = Array.isArray(data)
      ? data
      : Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data?.requests)
          ? data.requests
          : [];
    return list.find((r) => String(r.id) === String(deepLinkedRescueId)) || null;
  }, [deepLinkedRescueId, rescueRequestsQuery.data]);

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

  // Filters & Search (active centers tab lives in URL: ?centers=all | mapped | not-mapped)
  const [searchQuery, setSearchQuery] = useState("");
  const rawCentersTab = searchParams.get("centers");
  const filter =
    rawCentersTab === "mapped" || rawCentersTab === "not-mapped"
      ? rawCentersTab
      : "all";
  const setFilter = useCallback(
    (nextTab) => {
      const normalized =
        nextTab === "mapped" || nextTab === "not-mapped" ? nextTab : "all";
      const nextParams = new URLSearchParams(location.search);
      nextParams.set("centers", normalized);
      const qs = nextParams.toString();
      navigate(`${location.pathname}${qs ? `?${qs}` : ""}`, { replace: true });
    },
    [location.pathname, location.search, navigate]
  );
  const [geocodingResults, setGeocodingResults] = useState([]);
  const [geocodingLoading, setGeocodingLoading] = useState(false);

  // Panel state: collapsed by default on initial load (unless deep-linked on >=1024px) and auto-collapsed below 1024px
  const [panelCollapsed, setPanelCollapsed] = useState(() => {
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      return true;
    }
    return !deepLinkedCenterId && !deepLinkedBuildingId;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(max-width: 1023px)");
    const handleViewportChange = (e) => {
      if (e.matches) {
        setPanelCollapsed(true);
      }
    };
    if (mq.matches) {
      setPanelCollapsed(true);
    }
    mq.addEventListener("change", handleViewportChange);
    return () => mq.removeEventListener("change", handleViewportChange);
  }, []);
  const [panelSubView, setPanelSubView] = useState("details"); // "details" | "map_rooms"
  const previousSubViewRef = useRef("details");

  // Mobile Bottom Sheet state: closed by default
  const [bottomSheetOpen, setBottomSheetOpen] = useState(false);

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
        } catch (e) { }
      }, 0);
    }
  }, []);

  useEffect(() => {
    if (centerModalOpen && centerModalDialogRef.current) {
      const timer = setTimeout(() => {
        try {
          centerModalDialogRef.current?.focus();
        } catch (e) { }
      }, 20);
      return () => clearTimeout(timer);
    }
  }, [centerModalOpen]);

  // Room Details Modal state (Completely independent of center card!)
  const [roomModalOpen, setRoomModalOpen] = useState(false);

  // Mobile Centers panel sheet state (opens on trigger pill)
  const [mobileCentersSheetOpen, setMobileCentersSheetOpen] = useState(
    Boolean(isMobile && (deepLinkedCenterId || deepLinkedBuildingId))
  );
  const [centerPanelScrolled, setCenterPanelScrolled] = useState(false);

  // Mobile Centers sheet touch drag-to-close handling
  const sheetTouchStartYRef = useRef(0);
  const sheetTouchCurrentYRef = useRef(0);
  const mobileSheetRef = useRef(null);

  const handleDragHandleTouchStart = useCallback((e) => {
    sheetTouchStartYRef.current = e.touches[0].clientY;
    sheetTouchCurrentYRef.current = e.touches[0].clientY;
    if (mobileSheetRef.current) {
      mobileSheetRef.current.style.transition = "none";
    }
  }, []);

  const handleDragHandleTouchMove = useCallback((e) => {
    sheetTouchCurrentYRef.current = e.touches[0].clientY;
    const deltaY = sheetTouchCurrentYRef.current - sheetTouchStartYRef.current;
    if (deltaY > 0 && mobileSheetRef.current) {
      mobileSheetRef.current.style.transform = `translate(-50%, ${deltaY}px)`;
    }
  }, []);

  const handleDragHandleTouchEnd = useCallback(() => {
    const deltaY = sheetTouchCurrentYRef.current - sheetTouchStartYRef.current;
    if (mobileSheetRef.current) {
      mobileSheetRef.current.style.transition =
        "transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)";
    }
    if (deltaY > 60) {
      if (mobileSheetRef.current) {
        mobileSheetRef.current.style.transform = "translate(-50%, 100%)";
      }
      setTimeout(() => {
        setMobileCentersSheetOpen(false);
        if (mobileSheetRef.current) {
          mobileSheetRef.current.style.transform = "";
        }
      }, 150);
    } else {
      if (mobileSheetRef.current) {
        mobileSheetRef.current.style.transform = "translate(-50%, 0)";
      }
    }
  }, []);

  // Add Evacuation Center modal state (4-step wizard)
  const [addCenterModalOpen, setAddCenterModalOpen] = useState(false);
  const [addCenterForm, setAddCenterForm] = useState({
    name: "",
    center_type: "campus",
    barangay_ids: [],
    capacity: "",
    building_material: "",
    contact_number: "",
    owner_name: "",
    amenities: [],
  });
  const [savingAddCenter, setSavingAddCenter] = useState(false);
  const [addCenterError, setAddCenterError] = useState("");

  const handleOpenAddCenter = useCallback(() => {
    setAddCenterForm({
      name: "",
      center_type: "campus",
      barangay_ids: [],
      capacity: "",
      building_material: "",
      contact_number: "",
      owner_name: "",
      amenities: [],
    });
    setAddCenterError("");
    setAddCenterModalOpen(true);
  }, []);

  const handleSaveAddCenter = useCallback(async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setSavingAddCenter(true);
    setAddCenterError("");
    try {
      const payload = {
        name: addCenterForm.name,
        center_type: addCenterForm.center_type,
        barangay_ids: addCenterForm.barangay_ids,
        capacity: addCenterForm.capacity ? Number(addCenterForm.capacity) : 0,
        building_material: addCenterForm.building_material || null,
        contact_number: addCenterForm.contact_number || null,
        owner_name: addCenterForm.owner_name || null,
        amenities: addCenterForm.amenities || [],
      };
      const created = await api.createEvacuationCenter(payload);
      await invalidateEvacuationQueries(queryClient);
      setAddCenterModalOpen(false);
      const centerObj = created?.center || created?.data || created;
      if (centerObj) {
        startPlacementFlow(centerObj);
      }
    } catch (err) {
      setAddCenterError(err.message || "Failed to create evacuation center");
    } finally {
      setSavingAddCenter(false);
    }
  }, [addCenterForm, queryClient]);

  // Staff Hazard Actions
  const handleVerifyReport = useCallback(async (report) => {
    const ok = await appConfirm(
      `Validate Incident #${report.id}? This will mark the hazard report as Validated and automatically close affected road segments within 100m.`,
      {
        title: `Validate Incident #${report.id}?`,
        confirmText: "Confirm Validate",
        tone: "info",
      }
    );
    if (!ok) return;
    try {
      const result = await api.validateHazardReport(report.id, "validated");
      queryClient.invalidateQueries({ queryKey: ["hazard-reports"] });
      queryClient.invalidateQueries({ queryKey: ["hazard-zones"] });
      queryClient.invalidateQueries({ queryKey: ["road-segments"] });
      if (result?.closed_roads?.length > 0) {
        await appAlert(
          "The following road(s) were automatically closed due to this confirmed hazard:",
          {
            title: "Road(s) Automatically Closed",
            tone: "warning",
            items: result.closed_roads,
          }
        );
      }
    } catch (err) {
      console.error("Failed to verify hazard report:", err);
      await appAlert(err.message || "Failed to validate hazard report.", {
        title: "Validation Failed",
        tone: "danger",
      });
    }
  }, [queryClient]);

  const handleResolveReport = useCallback(async (report) => {
    const ok = await appConfirm(
      `Mark Incident #${report.id} as resolved and reopen any affected road(s) for evacuation routing?`,
      {
        title: `Resolve Incident #${report.id}?`,
        confirmText: "Confirm Resolve",
        tone: "success",
      }
    );
    if (!ok) return;
    try {
      let result = null;
      if (isBlockedRoadReport(report)) {
        result = await api.reopenRoad(report.id);
      } else {
        result = await api.validateHazardReport(report.id, "resolved");
      }
      queryClient.invalidateQueries({ queryKey: ["hazard-reports"] });
      queryClient.invalidateQueries({ queryKey: ["hazard-zones"] });
      queryClient.invalidateQueries({ queryKey: ["road-segments"] });
      if (result?.reopened_roads?.length > 0) {
        await appAlert(
          "The following road(s) have been reopened for evacuation routing:",
          {
            title: "Incident Resolved · Road(s) Reopened",
            tone: "success",
            items: result.reopened_roads,
          }
        );
      }
    } catch (err) {
      console.error("Failed to resolve hazard report:", err);
      await appAlert(err.message || "Failed to resolve hazard report.", {
        title: "Resolution Failed",
        tone: "danger",
      });
    }
  }, [queryClient]);

  const handleEditReport = useCallback((report) => {
    navigate(`${basePath}?tab=reports&hazard=${report.id}`);
  }, [navigate, basePath]);

  const handleDeleteReport = useCallback(async (report) => {
    const ok = await appConfirm("Are you sure you want to delete this hazard report?", {
      title: `Delete Incident #${report.id}?`,
      confirmText: "Delete Report",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteHazardReport(report.id);
      queryClient.invalidateQueries({ queryKey: ["hazard-reports"] });
      queryClient.invalidateQueries({ queryKey: ["hazard-zones"] });
      queryClient.invalidateQueries({ queryKey: ["road-segments"] });
    } catch (err) {
      console.error("Failed to delete hazard report:", err);
    }
  }, [queryClient]);

  const staffActions = useMemo(() => ({
    isStaff: true,
    isAdmin,
    onVerify: handleVerifyReport,
    onResolve: handleResolveReport,
    onEdit: handleEditReport,
    onDelete: handleDeleteReport,
  }), [isAdmin, handleVerifyReport, handleResolveReport, handleEditReport, handleDeleteReport]);

  const handleAdvanceRescueStatus = useCallback(async (rescue, nextStatus) => {
    await api.updateRescueRequest(rescue.id, nextStatus);
    queryClient.invalidateQueries({ queryKey: queryKeys.rescueRequests });
  }, [queryClient]);

  const handleOpenRescueAlerts = useCallback((rescue) => {
    navigate(`${basePath}?tab=rescue&rescue=${rescue.id}`);
  }, [navigate, basePath]);

  const rescueActions = useMemo(() => ({
    onAdvanceStatus: handleAdvanceRescueStatus,
    onOpenInRescueAlerts: handleOpenRescueAlerts,
  }), [handleAdvanceRescueStatus, handleOpenRescueAlerts]);

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

  // Edit Building & Add/Edit Room Modal state
  const [editBuildingModalOpen, setEditBuildingModalOpen] = useState(false);
  const [editingBuilding, setEditingBuilding] = useState(null);
  const [editingBuildingForm, setEditingBuildingForm] = useState({
    name: "",
    max_rooms: null,
    floors: null,
    status: "open",
    notes: "",
  });
  const [savingBuildingModal, setSavingBuildingModal] = useState(false);
  const [mapAddBuildingModalOpen, setMapAddBuildingModalOpen] = useState(false);
  const [mapAddBuildingForm, setMapAddBuildingForm] = useState({
    name: "",
    max_rooms: null,
    floors: null,
    status: "open",
    notes: "",
  });

  const [isAdminRoomModalOpen, setIsAdminRoomModalOpen] = useState(false);
  const [roomModalMode, setRoomModalMode] = useState("add");
  const [selectedRoomToEdit, setSelectedRoomToEdit] = useState(null);
  const [adminRoomForm, setAdminRoomForm] = useState({
    room_number: "",
    family_slots: "5",
    people_spaces: "25",
    building_id: "",
    floor: "",
  });
  const [savingAdminRoom, setSavingAdminRoom] = useState(false);

  // Map Rooms view tab: "buildings" | "points"
  const [mapRoomsTab, setMapRoomsTab] = useState("buildings");

  // Room suggestions & building linking state
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [managingBuildingId, setManagingBuildingId] = useState(null);

  // Add building details are collected in the shared form, then its outline is drawn on the map.
  const [addBuildingStep, setAddBuildingStep] = useState(null);
  const [newBuildingPoints, setNewBuildingPoints] = useState([]);
  const [isDrawingBuilding, setIsDrawingBuilding] = useState(false);
  const [isSavingBuilding, setIsSavingBuilding] = useState(false);
  const [panelHeaderMenuOpen, setPanelHeaderMenuOpen] = useState(false);

  // Building edit mode toolbar state
  const [buildingEditOriginalPoints, setBuildingEditOriginalPoints] = useState([]);
  const [buildingEditUndoStack, setBuildingEditUndoStack] = useState([]);
  const [buildingEditBoundaryError, setBuildingEditBoundaryError] = useState(null);
  const [isRedrawingBuildingFromScratch, setIsRedrawingBuildingFromScratch] = useState(false);
  const [isFullView, setIsFullView] = useState(false);

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
      if (
        selectedBuildingDetail &&
        String(selectedBuildingDetail.properties?.id ?? selectedBuildingDetail.id) === String(buildingId)
      ) {
        api.getBuildingDetails(buildingId).then(setBuildingDetailsData).catch(() => {});
      }
    } catch (err) {
      console.error("Failed to unlink room:", err);
      showPlacementToast("Failed to unlink room.");
    }
  };

  const handleDeleteRoomFromMap = async (rm) => {
    const ok = await appConfirm(`Are you sure you want to delete Room ${rm.room_number}?`, {
      title: `Delete Room ${rm.room_number}?`,
      confirmText: "Delete Room",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteRoom(rm.id);
      await invalidateEvacuationQueries(queryClient);
      await refetchBuildings();
      showPlacementToast(`Room ${rm.room_number} deleted.`);
      if (selectedBuildingDetail) {
        const bId = selectedBuildingDetail.properties?.id ?? selectedBuildingDetail.id;
        api.getBuildingDetails(bId).then(setBuildingDetailsData).catch(() => {});
      }
    } catch (err) {
      console.error("Failed to delete room:", err);
      showPlacementToast(err.message || "Failed to delete room.");
    }
  };

  const handleStartEditBuilding = (b) => {
    const props = b.properties || b;
    setEditingBuilding(b);
    setEditingBuildingForm({
      name: props.name || "",
      max_rooms: props.max_rooms != null ? Number(props.max_rooms) : null,
      floors: props.floors != null ? Number(props.floors) : null,
      status: props.status || "open",
      notes: props.notes || "",
    });
    setEditBuildingModalOpen(true);
  };

  const handleSaveEditBuilding = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!editingBuilding || !editingBuildingForm.name?.trim()) {
      showPlacementToast("Building name is required.");
      return;
    }
    const bId = editingBuilding.properties?.id ?? editingBuilding.id;
    setSavingBuildingModal(true);
    try {
      const payload = {
        name: editingBuildingForm.name.trim(),
        max_rooms:
          editingBuildingForm.max_rooms !== null && editingBuildingForm.max_rooms !== ""
            ? Number(editingBuildingForm.max_rooms)
            : null,
        floors:
          editingBuildingForm.floors !== null && editingBuildingForm.floors !== ""
            ? Number(editingBuildingForm.floors)
            : null,
        status: editingBuildingForm.status || "open",
        notes: editingBuildingForm.notes?.trim() || null,
      };
      await api.updateBuilding(bId, payload);
      await invalidateEvacuationQueries(queryClient);
      await refetchBuildings();
      showPlacementToast(`Building "${payload.name}" updated successfully.`);
      setEditBuildingModalOpen(false);
      setEditingBuilding(null);
      if (
        selectedBuildingDetail &&
        String(selectedBuildingDetail.properties?.id ?? selectedBuildingDetail.id) === String(bId)
      ) {
        api.getBuildingDetails(bId).then(setBuildingDetailsData).catch(() => {});
        setSelectedBuildingDetail((prev) => ({
          ...prev,
          properties: { ...prev.properties, ...payload },
        }));
      }
    } catch (err) {
      console.error("Failed to update building:", err);
      showPlacementToast(err.message || "Failed to update building.");
    } finally {
      setSavingBuildingModal(false);
    }
  };

  const handleOpenAddRoomModalForBuilding = (buildingId) => {
    setRoomModalMode("add");
    setSelectedRoomToEdit(null);
    setAdminRoomForm({
      room_number: "",
      family_slots: "5",
      people_spaces: "25",
      building_id: String(buildingId),
      floor: "1",
    });
    setIsAdminRoomModalOpen(true);
  };

  const handleOpenEditRoomModalFromMap = (rm, buildingId) => {
    setRoomModalMode("edit");
    setSelectedRoomToEdit(rm);
    setAdminRoomForm({
      room_number: rm.room_number || "",
      family_slots: String(rm.family_slots ?? 5),
      people_spaces: String(rm.people_spaces ?? rm.capacity ?? 25),
      building_id: String(buildingId),
      floor: rm.floor != null ? String(rm.floor) : "",
    });
    setIsAdminRoomModalOpen(true);
  };

  const handleSaveAdminRoom = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!adminRoomForm.room_number?.trim()) {
      showPlacementToast("Room number is required.");
      return;
    }
    if (!Number.isInteger(Number(adminRoomForm.family_slots)) || Number(adminRoomForm.family_slots) < 1) {
      showPlacementToast("Family slots must be a whole number of at least 1.");
      return;
    }
    if (!Number.isInteger(Number(adminRoomForm.people_spaces)) || Number(adminRoomForm.people_spaces) < 1) {
      showPlacementToast("People spaces must be a whole number of at least 1.");
      return;
    }

    setSavingAdminRoom(true);
    try {
      const parsedBId = adminRoomForm.building_id !== "" ? Number(adminRoomForm.building_id) : null;
      const payload = {
        room_number: adminRoomForm.room_number.trim(),
        family_slots: Number(adminRoomForm.family_slots),
        people_spaces: Number(adminRoomForm.people_spaces),
        building_id: parsedBId,
        floor: adminRoomForm.floor !== "" ? Number(adminRoomForm.floor) : (parsedBId != null ? 1 : null),
      };

      if (roomModalMode === "add") {
        await api.addRoom(selectedCenterId, payload);
        showPlacementToast(`Room ${payload.room_number} added.`);
      } else {
        await api.updateRoom(selectedRoomToEdit.id, payload);
        showPlacementToast(`Room ${payload.room_number} updated.`);
      }

      setIsAdminRoomModalOpen(false);
      setSelectedRoomToEdit(null);
      await invalidateEvacuationQueries(queryClient);
      await refetchBuildings();
      if (selectedBuildingDetail) {
        const bId = selectedBuildingDetail.properties?.id ?? selectedBuildingDetail.id;
        api.getBuildingDetails(bId).then(setBuildingDetailsData).catch(() => {});
      }
    } catch (err) {
      console.error("Failed to save room:", err);
      showPlacementToast(err.message || "Failed to save room.");
    } finally {
      setSavingAdminRoom(false);
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
        api.getBuildingDetails(bId).then(setBuildingDetailsData).catch(() => { });
      }
    } catch (err) {
      console.error("Failed to update building rooms:", err);
      showPlacementToast("Failed to update building rooms.");
    }
  };

  // Open the shared building form, then collect the footprint on the map.
  const startAddBuildingFlowForCenter = useCallback((center) => {
    if (!center) return;
    const props = center.properties || center;
    const centerId = props.id ?? center.id;
    setSelectedCenter(center);
    setCenterModalOpen(false);
    setPanelCollapsed(false);
    setBottomSheetOpen(true);
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

    setIsDrawingBuilding(false);
    setAddBuildingStep(null);
    setNewBuildingPoints([]);
    setMapAddBuildingForm({
      name: defaultName,
      max_rooms: null,
      floors: null,
      status: "open",
      notes: "",
    });
    setMapAddBuildingModalOpen(true);
    setPanelHeaderMenuOpen(false);
  }, [buildingsGeoJSON]);

  const handleBeginBuildingOutline = (e) => {
    if (e?.preventDefault) e.preventDefault();
    setMapAddBuildingModalOpen(false);
    setPanelSubView("map_rooms");
    setMapRoomsTab("buildings");
    setIsDrawingBuilding(true);
    setAddBuildingStep("draw");
    setNewBuildingPoints([]);
  };

  const handleDoubleTapFinish = useCallback(() => {
    if (isDrawingBuilding && addBuildingStep === "draw") {
      if (newBuildingPoints.length >= 3) {
        const centerPoints = selectedCenter?.geometry ? polygonToPoints(selectedCenter.geometry) : [];
        if (centerPoints.length >= 3 && !isBuildingInsideCenter(newBuildingPoints, centerPoints, true)) {
          showPlacementToast("Building must stay inside the evacuation center boundary.");
          return;
        }
        setIsDrawingBuilding(false);
        showPlacementToast("Building outline finished. Save to add the building.");
      } else {
        showPlacementToast("Click at least 3 corners before finishing.");
      }
    } else if (isDrawingBuilding && redrawingBuildingId && isRedrawingBuildingFromScratch) {
      if (newBuildingPoints.length >= 3) {
        const centerPoints = selectedCenter?.geometry ? polygonToPoints(selectedCenter.geometry) : [];
        if (centerPoints.length >= 3 && !isBuildingInsideCenter(newBuildingPoints, centerPoints, true)) {
          showPlacementToast("Building must stay inside the evacuation center boundary.");
          return;
        }
        setIsRedrawingBuildingFromScratch(false);
      } else {
        showPlacementToast("Click at least 3 corners before finishing.");
      }
    }
  }, [isDrawingBuilding, addBuildingStep, redrawingBuildingId, isRedrawingBuildingFromScratch, newBuildingPoints, selectedCenter]);

  const handleBasemapBuildingClick = useCallback((pts) => {
    const centerPoints = selectedCenter?.geometry ? polygonToPoints(selectedCenter.geometry) : [];
    if (centerPoints.length >= 3 && !isBuildingInsideCenter(pts, centerPoints, true)) {
      showPlacementToast("Building must stay inside the evacuation center boundary.");
      return;
    }
    if (isDrawingBuilding && addBuildingStep === "draw") {
      setNewBuildingPoints(pts);
      showPlacementToast("Building outline selected. Review it, then save.");
    } else if (isDrawingBuilding && redrawingBuildingId && (isRedrawingBuildingFromScratch || newBuildingPoints.length === 0)) {
      setNewBuildingPoints(pts);
      setIsRedrawingBuildingFromScratch(false);
      showPlacementToast("Basemap outline selected.");
    }
  }, [isDrawingBuilding, addBuildingStep, redrawingBuildingId, isRedrawingBuildingFromScratch, newBuildingPoints.length, selectedCenter]);

  const handleSaveMapBuilding = async () => {
    if (newBuildingPoints.length < 3) {
      showPlacementToast("Place at least 3 corners to define the building outline.");
      setAddBuildingStep("draw");
      setIsDrawingBuilding(true);
      return;
    }
    const centerPoints = selectedCenter?.geometry ? polygonToPoints(selectedCenter.geometry) : [];
    if (centerPoints.length >= 3 && !isBuildingInsideCenter(newBuildingPoints, centerPoints, true)) {
      showPlacementToast("Building must stay inside the evacuation center boundary.");
      setAddBuildingStep("draw");
      setIsDrawingBuilding(true);
      return;
    }
    if (!mapAddBuildingForm.name.trim()) {
      showPlacementToast("Building name is required.");
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
        setIsDrawingBuilding(false);
        setRedrawingBuildingId(null);
        setNewBuildingPoints([]);
        showPlacementToast("Building outline redrawn successfully.");
      } else {
        const savedName = mapAddBuildingForm.name.trim();

        const created = await api.createBuilding(selectedCenterId, {
          name: savedName,
          coordinates: coords,
          max_rooms: mapAddBuildingForm.max_rooms,
          floors: mapAddBuildingForm.floors,
          status: mapAddBuildingForm.status || "open",
          notes: mapAddBuildingForm.notes?.trim() || null,
        });
        await invalidateEvacuationQueries(queryClient);
        await refetchBuildings();

        const createdId = created?.id || created?.data?.id;
        if (createdId) {
          setSelectedBuildingId(createdId);
        }

        setIsDrawingBuilding(false);
        setAddBuildingStep(null);
        setNewBuildingPoints([]);

        // Small toast with "Back to center" link per change_3_deep_links
        setSaveNotice({
          message: `${savedName} added. Add rooms from the building details.`,
          centerId: selectedCenterId,
        });
      }
    } catch (err) {
      console.error("Failed to save building:", err);
      await appAlert(err.message || "Failed to save building.", {
        title: "Save Building Failed",
        tone: "danger",
      });
    } finally {
      setIsSavingBuilding(false);
    }
  };

  const handleCancelDrawingBuilding = () => {
    setIsDrawingBuilding(false);
    // Restore building layer filter (un-hide the saved outline) if we were redrawing
    if (redrawingBuildingId) {




    }
    setRedrawingBuildingId(null);
    setIsRedrawingBuildingFromScratch(false);
    setAddBuildingStep(null);
    setNewBuildingPoints([]);
    setBuildingEditOriginalPoints([]);
    setBuildingEditUndoStack([]);
    setBuildingEditBoundaryError(null);
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
        invalidPoints.length > 0
          ? `Keep the building inside the center boundary. ${invalidPoints.length} vertex${invalidPoints.length !== 1 ? "es" : ""} outside.`
          : "Keep the building completely inside the evacuation center boundary."
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
      setIsRedrawingBuildingFromScratch(false);
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
      await appAlert(err.message || "Failed to save building outline.", {
        title: "Save Outline Failed",
        tone: "danger",
      });
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
      setBuildingEditBoundaryError(null);
      if (previousPoints.length >= 3) {
        setIsRedrawingBuildingFromScratch(false);
      }
    }
  }, [buildingEditUndoStack]);

  // Reset to original saved outline
  const handleResetBuildingEdit = useCallback(() => {
    if (buildingEditOriginalPoints.length > 0) {
      setNewBuildingPoints(buildingEditOriginalPoints);
      setBuildingEditUndoStack([]);
      setBuildingEditBoundaryError(null);
      setIsRedrawingBuildingFromScratch(false);
    }
  }, [buildingEditOriginalPoints]);

  // Redraw from scratch - clear all points
  const handleRedrawBuildingEdit = useCallback(() => {
    // Push current state to undo stack before clearing
    if (newBuildingPoints.length > 0) {
      setBuildingEditUndoStack((prev) => [...prev, newBuildingPoints]);
    }
    setNewBuildingPoints([]);
    setBuildingEditBoundaryError(null);
    setIsRedrawingBuildingFromScratch(true);
  }, [newBuildingPoints]);

  // Handler for building vertex handle changes during edit mode
  const handleEditingBuildingPointsChange = useCallback((newPoints, isFinal) => {
    // Push to undo stack when drag is finalized
    if (isFinal) {
      setBuildingEditUndoStack((prev) => [...prev, newBuildingPoints]);
    }
    setBuildingEditBoundaryError(null);
    setNewBuildingPoints(newPoints);
  }, [newBuildingPoints]);

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
        setPanelCollapsed(false);
        if (isMobile) {
          setMobileCentersSheetOpen(true);
        }

        const coords = getCenterCoordinates(match);
        if (coords && !initialMode) {
          setMapFocusLocation({
            ...coords,
            zoom: 17,
          });
        }

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
  }, [centers, deepLinkedCenterId, initialMode, navigate, isMobile]);

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
    if (isMobile) {
      setMobileCentersSheetOpen(true);
    }

    const centroid = getPolygonCentroid(matchedBuilding.geometry);
    if (centroid) {
      setMapFocusLocation(centroid);
    } else if (selectedCenter) {
      const centerCoords = getCenterCoordinates(selectedCenter);
      if (centerCoords) {
        setMapFocusLocation({
          ...centerCoords,
          zoom: 18,
          noPin: true,
          requestedAt: Date.now(),
        });
      }
    }

    if (["redraw", "remap", "place_building", "place"].includes(initialMode)) {
      const bOrigPoints = polygonToPoints(matchedBuilding.geometry);
      setBuildingEditOriginalPoints(bOrigPoints.length >= 3 ? bOrigPoints : []);
      setBuildingEditUndoStack([]);
      setIsRedrawingBuildingFromScratch(bOrigPoints.length < 3);
      setPanelSubView("map_rooms");
      setMapRoomsTab("buildings");
      setRedrawingBuildingId(bId);
      setIsDrawingBuilding(true);
      // Initialize with existing polygon points so vertex handles appear for editing
      setNewBuildingPoints(bOrigPoints.length >= 3 ? bOrigPoints : []);
    } else {
      setBuildingModalOpen(true);
    }
  }, [deepLinkedBuildingId, buildingsGeoJSON, initialMode, isMobile, selectedCenter]);

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
      .catch(() => { });

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
        let hasLiveIcon = false;

        if (deepLinkedHazardId) {
          const hazardStatus = String(
            matchedHazardReport?.status || deepLinkedStatus || ""
          ).toLowerCase();
          hasLiveIcon = hazardStatus === "pending" || hazardStatus === "validated";

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
          const rescueStatus = String(
            matchedRescueRequest?.status || deepLinkedStatus || ""
          ).toLowerCase();
          hasLiveIcon =
            activeRescueRequests.some((r) => String(r.id) === String(deepLinkedRescueId)) ||
            ["pending", "open", "acknowledged", "responding"].includes(rescueStatus);

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
          report: matchedHazardReport || null,
          rescue: matchedRescueRequest || null,
          label,
          noPin: hasLiveIcon,
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
    deepLinkedStatus,
    matchedHazardReport,
    matchedRescueRequest,
    activeRescueRequests,
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
    const originalPoints = polygonToPoints(center.geometry);
    setCenterEditOriginalPoints(originalPoints);

    const existingEntrances = Array.isArray(props.entrances)
      ? props.entrances
        .map((e) => ({
          lat: Number(e.lat ?? e.latitude),
          lng: Number(e.lng ?? e.longitude),
        }))
        .filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lng))
      : [];
    setEntrancePoints(existingEntrances);
    setCenterEditOriginalEntrances(existingEntrances);

    // If center already has a polygon, load it and open directly in Step 3 (Edit)
    if (originalPoints.length >= 3) {
      setFootprintPoints(originalPoints);
      setRedrawingCenterId(centerId);
      setMappingStep("edit");
    } else {
      setFootprintPoints([]);
      setRedrawingCenterId(null);
      setMappingStep("footprint");
    }
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
    const confirmed = await appConfirm(
      `Remove map location for "${room.room_number}"? The room will become unmapped.`,
      {
        title: `Unmap Room ${room.room_number}?`,
        confirmText: "Remove Location",
        danger: true,
      }
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
      await appAlert(err.message || "Failed to remove room location.", {
        title: "Could Not Remove Location",
        tone: "danger",
      });
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

  // Handle step change with entrance filtering when moving from footprint to entrance or edit to confirm
  const handleStepChange = useCallback((nextStep) => {
    if (
      (nextStep === "entrance" && mappingStep === "footprint") ||
      (nextStep === "confirm" && mappingStep === "edit")
    ) {
      const savedEntrances = entrancePoints;
      if (centerEditOriginalEntrances.length === 0 && savedEntrances.length > 0) {
        setCenterEditOriginalEntrances(savedEntrances);
      }
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
      if (nextStep === "confirm" && filtered.length === 0) {
        showPlacementToast("Center outline moved. Please place at least one entrance on the new outline.");
        setMappingStep("entrance");
        return;
      }
      if (removedCount > 0) {
        showPlacementToast(removedCount + " entrance(s) removed: outside the new outline.");
      }
    }
    setMappingStep(nextStep);
  }, [mappingStep, footprintPoints, entrancePoints, centerEditOriginalEntrances.length, showPlacementToast]);

  // Save placement flow (outline + entrances)
  async function handleSaveMapPlacement() {
    if (!editingCenter) return;
    const centerId = editingCenter.properties?.id || editingCenter.id;
    if (!centerId) return;

    if (footprintPoints.length < 3) {
      await appAlert("Failed to save map placement. Please ensure footprint has at least 3 points.", {
        title: "Incomplete Outline",
        tone: "warning",
      });
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
        await appAlert(serverMessage, { title: "Save Failed", tone: "danger" });
      } else if (footprintPoints.length < 3) {
        await appAlert(
          "Failed to save map placement. Please ensure footprint has at least 3 points.",
          { title: "Incomplete Outline", tone: "warning" }
        );
      } else {
        await appAlert("Failed to save map placement. Please try again.", {
          title: "Save Failed",
          tone: "danger",
        });
      }
      setSavingMap(false);
      return;
    }

    // Refresh centers and buildings after a successful save
    try {
      await invalidateEvacuationQueries(queryClient);
      await refetchBuildings();
    } catch (refreshErr) {
      console.warn("Failed to refresh queries after successful save:", refreshErr);
    }

    const updatedName =
      editingCenter.properties?.name || editingCenter.name || "Center";
    const resetBuildingsCount = Number(
      savedCenterFeature?.properties?.reset_buildings_count || 0
    );

    if (redrawingCenterId) {
      setRedrawingCenterId(null);
      setCenterEditOriginalPoints([]);
    }

    setIsMapping(false);
    setEditingCenter(null);
    setPanelCollapsed(false);
    // Set selectedCenter from refetched centers list by id (or saved feature)
    const refetchedCenters = queryClient.getQueryData(queryKeys.evacuationCenters(true));
    let matchedCenter = savedCenterFeature || null;
    if (refetchedCenters?.features) {
      const match = refetchedCenters.features.find((c) => {
        const cid = c.properties?.id ?? c.id;
        return String(cid) === String(centerId);
      });
      if (match) matchedCenter = match;
    }
    if (matchedCenter) {
      setSelectedCenter({ ...matchedCenter, _focusAt: Date.now() });
    }
    setFootprintPoints([]);
    setEntrancePoints([]);
    setCenterEditOriginalEntrances([]);
    setMappingStep("footprint");
    setPlacementToast(null);
    setSavingMap(false);

    if (resetBuildingsCount > 0) {
      setCenterModalOpen(true);
      setSaveNotice({
        centerId,
        message: `Updated outline for ${updatedName}. Please remap its ${resetBuildingsCount} ${resetBuildingsCount === 1 ? "building" : "buildings"
          } inside the new boundary.`,
      });
    } else {
      setSaveNotice({
        centerId,
        message: `Saved outline and entrances for ${updatedName}`,
      });
    }
  }

  // Select a center: ease map to center and open Center details modal over the map
  function handleSelectCenter(center) {
    if (!center) return;
    if (typeof document !== "undefined" && document.activeElement) {
      centerModalTriggerRef.current = document.activeElement;
    }
    setSelectedCenter({ ...center, _focusAt: Date.now() });
    setCenterModalOpen(true);
    if (isMobile) {
      setMobileCentersSheetOpen(false);
    }
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
    let tab = "rescue";
    if (notification.resource_type === "hazard_report") {
      tab = "reports";
    } else if (
      notification.resource_type === "resident_registration" ||
      notification.resource_type === "resident_account"
    ) {
      tab = "registrations";
    }
    const params = new URLSearchParams({
      tab,
      notificationId: String(notification.id),
      resourceType: String(notification.resource_type || ""),
      resourceId: String(notification.resource_id ?? ""),
    });
    navigate(`${path}?${params.toString()}`);
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
      if (filter === "not-mapped" && mapped) return false;

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

  // Scrollable centers list refs & sync
  const listWindowRef = useRef(null);
  const lastSelectedCenterIdRef = useRef(null);

  // Reset scroll to top when search query or filter tab changes
  useEffect(() => {
    if (listWindowRef.current) {
      listWindowRef.current.scrollTop = 0;
    }
  }, [searchQuery, filter]);

  // Scroll selected card into view when selection changes from outside (e.g., map click or deep link)
  useEffect(() => {
    if (!selectedCenter) {
      lastSelectedCenterIdRef.current = null;
      return;
    }
    const currentSelectedId = String(
      selectedCenter.properties?.id ?? selectedCenter.id ?? ""
    );
    if (!currentSelectedId || currentSelectedId === lastSelectedCenterIdRef.current) {
      return;
    }
    lastSelectedCenterIdRef.current = currentSelectedId;
    const container = listWindowRef.current;
    if (!container) return;
    const cardEl = container.querySelector(
      `[data-center-id="${CSS.escape ? CSS.escape(currentSelectedId) : currentSelectedId}"]`
    );
    if (cardEl && typeof cardEl.scrollIntoView === "function") {
      const prefersReduced =
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      cardEl.scrollIntoView({
        block: "nearest",
        behavior: prefersReduced ? "auto" : "smooth",
      });
    }
  }, [selectedCenter, filteredCenters]);

  // Render Center Card in scrollable list
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
    const capacity = Number(props.capacity || 0);
    const occupied = Number(props.occupied || 0);

    // Show at most 2 barangays, then "+N"
    let barangayText = "Sogod";
    const brgyList = props.barangays || props.barangay_breakdown || [];
    if (brgyList.length > 0) {
      const names = brgyList.map((b) => displayEntityName(b.name || b));
      if (names.length <= 2) {
        barangayText = names.join(", ");
      } else {
        barangayText = `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
      }
    } else if (props.barangay_name || props.address) {
      barangayText = displayEntityName(props.barangay_name || props.address);
    }

    const centerType = props.center_type || "campus";
    const isVenueOrHouse = centerType !== "campus";
    const typeNames = {
      campus: "Campus",
      single_venue: "Single venue",
      private_property: "Private property",
    };
    const typeText =
      typeNames[centerType] ||
      centerType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

    const bldStats = buildingStatsByCenterId[centerId] || {
      total: Number(props.building_count || 0),
      mapped: Number(props.mapped_building_count || 0),
      unmapped: Number(props.unmapped_building_count || 0),
    };
    const unmappedBldgCount = !isVenueOrHouse ? bldStats.unmapped : 0;
    const totalBldgCount = !isVenueOrHouse ? bldStats.total : 0;

    const row2Parts = [barangayText, typeText];
    if (!isVenueOrHouse && totalBldgCount > 0) {
      row2Parts.push(
        `${bldStats.mapped}/${totalBldgCount} ${totalBldgCount === 1 ? "bldg" : "bldgs"} mapped`
      );
    }
    row2Parts.push(`${roomCount} ${roomCount === 1 ? "room" : "rooms"}`);
    const row2Text = row2Parts.join(" · ");

    const statusVariant = !mapped
      ? "not-mapped"
      : active
        ? "active"
        : "inactive";

    const centerName = props.name || "Evacuation Center";

    return (
      <article
        key={centerId}
        data-center-id={String(centerId)}
        className={`admin-map-center-card ${isSelected ? "is-selected" : ""} ${unmappedBldgCount > 0 ? "has-unmapped-buildings" : ""}`}
      >
        <button
          type="button"
          className="admin-map-center-card__select"
          onClick={() => handleSelectCenter(center)}
          aria-pressed={Boolean(isSelected)}
        >
          <div className="admin-map-center-card__header">
            <span className="admin-map-center-card__name">{centerName}</span>
            <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
              {mapped && unmappedBldgCount > 0 && (
                <StatusPill
                  variant="unmapped"
                  label={`${unmappedBldgCount} ${unmappedBldgCount === 1 ? "bldg unmapped" : "bldgs unmapped"}`}
                />
              )}
              <StatusPill variant={statusVariant} />
            </div>
          </div>

          <div className="admin-map-center-card__meta">{row2Text}</div>

          <div className="admin-map-center-card__occupancy">
            <div className="admin-map-center-card__occ-text">
              <strong>{occupied}</strong> of {capacity} here
            </div>
            <ProgressBar
              value={occupied}
              max={capacity}
              size={6}
              ariaLabel={`${centerName} occupancy: ${occupied} of ${capacity} here`}
            />
          </div>
        </button>

        <div className="admin-map-center-card__actions">
          <button
            type="button"
            className="admin-map-btn-secondary-outline"
            onClick={() => {
              handleCloseCenterModal?.();
              startPlacementFlow(center);
            }}
            title={
              mapped
                ? `Edit polygon for ${centerName}`
                : `Place ${centerName} on map`
            }
          >
            {mapped ? (
              <Pencil size={13} strokeWidth={2} aria-hidden="true" />
            ) : (
              <MapPin size={13} strokeWidth={2} aria-hidden="true" />
            )}
            <span>{mapped ? "Edit polygon" : "Place on map"}</span>
          </button>
          {!isVenueOrHouse && (
            <button
              type="button"
              className={`admin-map-btn-secondary-outline ${!mapped ? "is-disabled" : ""}`}
              onClick={() => {
                if (mapped) {
                  startAddBuildingFlowForCenter(center);
                }
              }}
              title={
                mapped
                  ? `Add building to ${centerName}`
                  : "Place the center on the map first"
              }
              disabled={!mapped}
            >
              <Plus size={13} strokeWidth={2.25} aria-hidden="true" />
              <span>Add building</span>
            </button>
          )}
        </div>
      </article>
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
            className={`admin-map-detail-badge ${active ? "is-active" : "is-inactive"
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
                  navigate(`${basePath}/evacuation-centers/${centerId}`);
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
                        `${basePath}/evacuation-centers/${centerId}?tab=structure`
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
                  navigate(`${basePath}/evacuation-centers/${centerId}`);
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
                        `${basePath}/evacuation-centers/${centerId}?tab=structure`
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
              <header className="admin-bld-detail-header" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button
                  type="button"
                  className="admin-bld-detail-back-btn"
                  onClick={() => {
                    setSelectedBuildingDetail(null);
                    setSelectedBuildingId(null);
                  }}
                >
                  <FontAwesomeIcon icon={faArrowLeft} />
                  <span>Back</span>
                </button>
                <div className="admin-bld-detail-title" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {bDetailProps.name || "Building"}
                </div>
                <div style={{ display: "inline-flex", gap: "6px", marginLeft: "auto" }}>
                  <button
                    type="button"
                    className="admin-guided-btn"
                    style={{ height: 30, minHeight: 30, padding: "0 8px", fontSize: 11 }}
                    onClick={() => handleStartEditBuilding(selectedBuildingDetail)}
                    title="Edit building details & room limit"
                  >
                    <FontAwesomeIcon icon={faPen} style={{ marginRight: 4 }} />
                    <span>Edit</span>
                  </button>
                  <button
                    type="button"
                    className="admin-guided-btn is-primary"
                    style={{ height: 30, minHeight: 30, padding: "0 8px", fontSize: 11 }}
                    onClick={() => handleOpenAddRoomModalForBuilding(bDetailId)}
                    title="Add a new room to this building"
                  >
                    <FontAwesomeIcon icon={faPlus} style={{ marginRight: 4 }} />
                    <span>Add Room</span>
                  </button>
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
                      setBuildingEditBoundaryError(null);
                      setIsRedrawingBuildingFromScratch(bOrigPoints.length < 3);
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
                    <div className="admin-bld-rooms-heading" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span>Rooms & Occupants ({detailedRooms.length})</span>
                      <button
                        type="button"
                        style={{
                          background: "#eff6ff",
                          border: "1px solid #bfdbfe",
                          borderRadius: "4px",
                          color: "#1d4ed8",
                          fontSize: "11px",
                          fontWeight: 600,
                          padding: "2px 8px",
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                        }}
                        onClick={() => handleOpenAddRoomModalForBuilding(bDetailId)}
                        title="Add room to this building"
                      >
                        <FontAwesomeIcon icon={faPlus} />
                        <span>Add Room</span>
                      </button>
                    </div>

                    {detailedRooms.length === 0 ? (
                      <div style={{ fontSize: "13px", color: "#64748b", padding: "8px 0" }}>
                        No rooms linked to this building yet. Use "+ Add Room" or "Link / unlink rooms" from the buildings menu.
                      </div>
                    ) : (
                      <div className="admin-bld-rooms-list">
                        {detailedRooms.map((rm) => {
                          const isStaffExpanded = expandedStaffRoomIds[rm.id];
                          const fams = rm.assigned_families || rm.families || [];
                          return (
                            <div key={rm.id} className="admin-bld-room-card">
                              <div className="admin-bld-room-top" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
                                <span className="admin-bld-room-num">
                                  Room {rm.room_number}
                                </span>
                                <span className="admin-bld-room-cap">
                                  {rm.occupied || 0} of {rm.capacity || 0} here · {rm.assigned ?? 0} assigned
                                </span>
                                <div style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                  <button
                                    type="button"
                                    style={{
                                      background: "none",
                                      border: "none",
                                      cursor: "pointer",
                                      padding: "2px 6px",
                                      borderRadius: "4px",
                                      fontSize: "11px",
                                      color: "#64748b",
                                    }}
                                    onClick={() => handleOpenEditRoomModalFromMap(rm, bDetailId)}
                                    title={`Edit Room ${rm.room_number}`}
                                  >
                                    <FontAwesomeIcon icon={faPen} />
                                  </button>
                                  <button
                                    type="button"
                                    style={{
                                      background: "none",
                                      border: "none",
                                      cursor: "pointer",
                                      padding: "2px 6px",
                                      borderRadius: "4px",
                                      fontSize: "11px",
                                      color: "#d97706",
                                    }}
                                    onClick={() => handleUnlinkRoom(bDetailId, rm.id, rm.room_number)}
                                    title={`Remove Room ${rm.room_number} from this building (unlink)`}
                                  >
                                    <FontAwesomeIcon icon={faUnlink} />
                                    <span style={{ marginLeft: "3px" }}>Unlink</span>
                                  </button>
                                  <button
                                    type="button"
                                    style={{
                                      background: "none",
                                      border: "none",
                                      cursor: rm.assigned > 0 || rm.occupied > 0 ? "not-allowed" : "pointer",
                                      padding: "2px 6px",
                                      borderRadius: "4px",
                                      fontSize: "11px",
                                      color: rm.assigned > 0 || rm.occupied > 0 ? "#cbd5e1" : "#dc2626",
                                    }}
                                    disabled={rm.assigned > 0 || rm.occupied > 0}
                                    onClick={() => handleDeleteRoomFromMap(rm)}
                                    title={rm.assigned > 0 || rm.occupied > 0 ? "Cannot delete: residents assigned" : `Delete Room ${rm.room_number}`}
                                  >
                                    <FontAwesomeIcon icon={faTrashCan} />
                                  </button>
                                </div>
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
                                                      : mem.full_name || mem.name || "Family Member";
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

              {/* Draw-only step after the shared Add Building form */}
              {addBuildingStep ? (
                <div className="admin-map-building-draw-panel">
                  <div className="admin-map-building-draw-heading">
                    <div>
                      <h3>Place building outline</h3>
                      <p>Draw the footprint for <strong>{mapAddBuildingForm.name || "this building"}</strong> on the map. Click corners, then double-click to finish.</p>
                    </div>
                    <span className={`admin-map-building-draw-count ${newBuildingPoints.length >= 3 ? "is-ready" : ""}`}>
                      {newBuildingPoints.length} / 3 corners
                    </span>
                  </div>
                  <p className="admin-map-building-draw-note">You can also select an existing map footprint. Rooms can be added from the building after it is created.</p>
                  <div className="admin-map-building-draw-actions">
                    <button type="button" className="admin-guided-btn" onClick={() => setNewBuildingPoints((points) => points.slice(0, -1))} disabled={!newBuildingPoints.length || isSavingBuilding}>
                      <FontAwesomeIcon icon={faRotateLeft} /> Undo
                    </button>
                    <button type="button" className="admin-guided-btn" onClick={() => { setNewBuildingPoints([]); setIsDrawingBuilding(true); }} disabled={!newBuildingPoints.length || isSavingBuilding}>
                      Clear
                    </button>
                    <button type="button" className="admin-guided-btn is-danger" onClick={handleCancelDrawingBuilding} disabled={isSavingBuilding}>
                      Cancel
                    </button>
                    {isDrawingBuilding ? (
                      <button type="button" className="admin-guided-btn is-primary" onClick={handleDoubleTapFinish} disabled={newBuildingPoints.length < 3 || isSavingBuilding}>
                        Finish outline
                      </button>
                    ) : (
                      <button type="button" className="admin-guided-btn" onClick={() => setIsDrawingBuilding(true)} disabled={newBuildingPoints.length < 3 || isSavingBuilding}>
                        Continue drawing
                      </button>
                    )}
                    <button type="button" className="admin-guided-btn is-primary" onClick={handleSaveMapBuilding} disabled={isSavingBuilding || isDrawingBuilding || newBuildingPoints.length < 3}>
                      {isSavingBuilding ? <><FontAwesomeIcon icon={faSpinner} spin /> Saving...</> : <><FontAwesomeIcon icon={faCheck} /> Save building</>}
                    </button>
                  </div>
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
                      <span>No buildings yet. Add a building, then add its rooms from the building details.</span>
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
                      const isBuildingMapped = Boolean(b.geometry?.coordinates?.[0]?.length >= 4 || bProps.is_mapped);
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
                            {!isBuildingMapped && (
                              <span
                                className="admin-bld-exception-badge"
                                style={{
                                  backgroundColor: "#fffbeb",
                                  color: "#b45309",
                                  border: "1px solid #fde68a",
                                }}
                              >
                                Not mapped
                              </span>
                            )}

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
                                      handleStartEditBuilding(b);
                                    }}
                                  >
                                    <FontAwesomeIcon icon={faPen} />
                                    <span>Edit details & max rooms</span>
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
                                      setSelectedBuildingDetail(b);
                                      const bOrigPoints = polygonToPoints(b.geometry);
                                      setBuildingEditOriginalPoints(bOrigPoints.length >= 3 ? bOrigPoints : []);
                                      setBuildingEditUndoStack([]);
                                      setBuildingEditBoundaryError(null);
                                      setIsRedrawingBuildingFromScratch(bOrigPoints.length < 3);
                                      setIsDrawingBuilding(true);
                                      setRedrawingBuildingId(bId);
                                      setNewBuildingPoints(bOrigPoints.length >= 3 ? bOrigPoints : []);
                                    }}
                                  >
                                    <FontAwesomeIcon icon={faArrowsRotate} />
                                    <span>{isBuildingMapped ? "Redraw outline" : "Map building"}</span>
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
                      className={`admin-map-room-row ${isMapped ? "is-mapped" : "is-unmapped"
                        } ${isCurrent ? "is-current-placing" : ""} ${isHovered ? "is-hovered-room" : ""
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
                              {room.family_slots ?? 5} slots · {room.people_spaces ?? room.capacity} spaces
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
            <Search size={15} strokeWidth={2} className="admin-map-search-icon" aria-hidden="true" />
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
                <X size={14} strokeWidth={2} aria-hidden="true" />
              </button>
            )}
          </div>
        )}

        <SegmentedControl
          size="sm"
          className="admin-map-centers-segmented"
          ariaLabel="Filter centers by mapping status"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All", count: allCentersList.length },
            { value: "mapped", label: "Mapped", count: mappedCount },
            { value: "not-mapped", label: "Not mapped", count: unmappedCount },
          ]}
        />

        {unmappedBuildingsSummary.totalUnmappedBuildings > 0 && (
          <div
            role="status"
            style={{
              marginTop: "8px",
              padding: "7px 10px",
              borderRadius: "8px",
              backgroundColor: "#fffbeb",
              border: "1px solid #fde68a",
              color: "#b45309",
              fontSize: "12px",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: "7px",
              lineHeight: 1.35,
            }}
          >
            <AlertTriangle size={14} strokeWidth={2.2} style={{ flexShrink: 0 }} aria-hidden="true" />
            <span>
              {unmappedBuildingsSummary.totalUnmappedBuildings}{" "}
              {unmappedBuildingsSummary.totalUnmappedBuildings === 1
                ? "building is"
                : "buildings are"}{" "}
              not mapped yet across {unmappedBuildingsSummary.centersWithUnmappedBuildings}{" "}
              {unmappedBuildingsSummary.centersWithUnmappedBuildings === 1 ? "center" : "centers"}
            </span>
          </div>
        )}
      </>
    );
  }

  // Scrollable list of center cards with skeleton loading, empty, and error states
  function renderPanelContent() {
    if (centersQuery.isLoading) {
      return (
        <div
          className="admin-map-centers-list"
          role="region"
          aria-label="Evacuation centers"
          aria-busy="true"
        >
          {[0, 1, 2, 3].map((idx) => (
            <div key={idx} className="admin-map-skeleton-card" aria-hidden="true">
              <div className="admin-map-skeleton-row">
                <div className="admin-map-skeleton-line admin-map-skeleton-line--title" />
                <div className="admin-map-skeleton-pill" />
              </div>
              <div className="admin-map-skeleton-line admin-map-skeleton-line--meta" />
              <div className="admin-map-skeleton-line admin-map-skeleton-line--bar" />
              <div className="admin-map-skeleton-actions">
                <div className="admin-map-skeleton-btn" />
                <div className="admin-map-skeleton-btn" />
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (centersQuery.isError) {
      return (
        <div className="admin-map-centers-list" role="region" aria-label="Evacuation centers">
          <div className="admin-map-panel-state is-error" role="alert">
            <AlertCircle size={22} strokeWidth={2} className="admin-map-panel-state__icon" aria-hidden="true" />
            <p className="admin-map-panel-state__title">Failed to load evacuation centers.</p>
            <p className="admin-map-panel-state__desc">
              Check your connection and try again.
            </p>
            <button
              type="button"
              className="admin-map-btn-secondary-outline"
              onClick={() => centersQuery.refetch()}
            >
              Retry
            </button>
          </div>
        </div>
      );
    }

    const hasCenters = filteredCenters.length > 0;
    const hasActiveFilters = Boolean(searchQuery.trim()) || filter !== "all";

    return (
      <div
        ref={listWindowRef}
        className="admin-map-centers-list"
        role="region"
        aria-label="Evacuation centers"
      >
        {hasCenters ? (
          filteredCenters.map(renderCenterItem)
        ) : (
          <div className="admin-map-panel-state">
            <Building2 size={22} strokeWidth={1.75} className="admin-map-panel-state__icon" aria-hidden="true" />
            <p className="admin-map-panel-state__title">
              {hasActiveFilters ? "No centers match your filters" : "No evacuation centers yet"}
            </p>
            <p className="admin-map-panel-state__desc">
              {hasActiveFilters
                ? "Try adjusting your search or switching tabs."
                : "Add an evacuation center to get started."}
            </p>
            {hasActiveFilters && (
              <button
                type="button"
                className="admin-map-btn-secondary-outline"
                onClick={() => {
                  setSearchQuery("");
                  setFilter("all");
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // Center Detail Overlay Panel next to the Centers panel (no modal backdrop)
  function renderCenterDetailsModal() {
    if (
      !centerModalOpen ||
      !selectedCenter ||
      isMapping ||
      (isDrawingBuilding && redrawingBuildingId)
    ) {
      return null;
    }
    const props = selectedCenter.properties || selectedCenter || {};
    const centerId = props.id ?? selectedCenter.id;
    const active = Boolean(props.is_active);
    const mapped = isCenterMapped(selectedCenter);
    const capacity = Number(props.capacity || 0);
    const occupied = Number(props.occupied || 0);
    const assigned = Number(props.assigned ?? props.total_assigned ?? 0);
    const buildingCount = centerBuildings.length;
    const mappedBuildingsInCenter = centerBuildings.filter((b) =>
      Boolean(
        (b.geometry &&
          Array.isArray(b.geometry.coordinates) &&
          b.geometry.coordinates.length > 0) ||
          b.properties?.is_mapped
      )
    ).length;
    const unmappedBuildingsInCenter = Math.max(
      0,
      buildingCount - mappedBuildingsInCenter
    );
    const barangays = props.barangays || props.barangay_breakdown || [];
    const barangayText =
      barangays.length > 0
        ? barangays.map((b) => displayEntityName(b.name || b)).join(", ")
        : displayEntityName(props.barangay_name || props.address) ||
          "Sogod, Southern Leyte";
    const addressText = displayEntityName(props.address);

    const isVenueOrHouse = Boolean(
      props.center_type && props.center_type !== "campus"
    );
    const showShelterAndFamilies = isVenueOrHouse || !mapped;
    const spaceLeft = Math.max(0, capacity - occupied);
    const centerFamilies = selectedCenterDetailsQuery.data?.families || [];
    const isOwner = props.center_type === "private_property" && props.owner_name;

    const centerType = props.center_type || "campus";
    const typeConfig = {
      campus: { label: "Campus", Icon: Building2 },
      private_property: { label: "Private Property", Icon: Home },
      single_venue: { label: "Single Venue", Icon: Landmark },
    };
    const typeInfo = typeConfig[centerType] || typeConfig.campus;
    const TypeIcon = typeInfo.Icon;
    const centerName = props.name || "Evacuation Center";

    return (
      <MapOverlayPanel
        as="aside"
        ref={centerModalDialogRef}
        tabIndex={-1}
        role="region"
        aria-label={`${centerName} details`}
        className={`admin-map-detail-panel ${isMobile ? "is-mobile" : ""}`}
      >
        {/* Fixed Top Section: Header, 3 Stat Boxes, Action Row */}
        <div
          className={`admin-map-detail-top ${centerPanelScrolled ? "is-scrolled" : ""}`}
        >
          {/* Header */}
          <div className="admin-map-detail-header">
            <div className="admin-map-detail-header-main">
              <div className="admin-map-detail-title-row">
                <h3 className="admin-map-detail-title">{centerName}</h3>
                <StatusPill variant={active ? "active" : "inactive"} />
                <span className="admin-map-detail-type-chip">
                  <TypeIcon size={12} strokeWidth={2} aria-hidden="true" />
                  <span>{typeInfo.label}</span>
                </span>
              </div>
              <p className="admin-map-detail-meta" title={barangayText}>
                {barangayText}
                {addressText && addressText !== barangayText
                  ? ` · ${addressText}`
                  : ""}
                {isOwner ? ` · Owner: ${props.owner_name}` : ""}
              </p>
            </div>

            <button
              type="button"
              className="admin-map-detail-close-btn"
              onClick={handleCloseCenterModal}
              aria-label="Close"
              title="Close"
            >
              <X size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>

          {/* 3 Stat Boxes in a Row */}
          <div className="admin-map-detail-stats">
            <div className="admin-map-detail-stat">
              <div
                className={`admin-map-detail-stat__val is-boundary ${mapped ? "is-mapped" : "is-unmapped"}`}
              >
                {mapped ? (
                  <MapPin size={14} strokeWidth={2.25} aria-hidden="true" />
                ) : (
                  <AlertCircle size={14} strokeWidth={2.25} aria-hidden="true" />
                )}
                <span>{mapped ? "Mapped" : "Unmapped"}</span>
              </div>
              <span className="admin-map-detail-stat__label">Boundary</span>
            </div>

            <div className="admin-map-detail-stat">
              <div className="admin-map-detail-stat__val">
                <strong>{occupied}</strong>
                {capacity > 0 && <span>of {capacity}</span>}
              </div>
              <span className="admin-map-detail-stat__label">here</span>
            </div>

            <div className="admin-map-detail-stat">
              <div className="admin-map-detail-stat__val">
                <strong>{assigned}</strong>
                {capacity > 0 && <span>of {capacity}</span>}
              </div>
              <span className="admin-map-detail-stat__label">assigned</span>
            </div>
          </div>

          {/* Action Row (34px secondary buttons) */}
          <div className="admin-map-detail-actions">
            <button
              type="button"
              className="admin-map-btn-secondary-outline"
              onClick={() => {
                handleCloseCenterModal();
                startPlacementFlow(selectedCenter);
              }}
            >
              {mapped ? (
                <Pencil size={13} strokeWidth={2} aria-hidden="true" />
              ) : (
                <MapPin size={13} strokeWidth={2} aria-hidden="true" />
              )}
              <span>{mapped ? "Edit polygon" : "Place on map"}</span>
            </button>

            {!isVenueOrHouse && mapped && (
              <button
                type="button"
                className="admin-map-btn-secondary-outline"
                onClick={() => {
                  handleCloseCenterModal();
                  startAddBuildingFlowForCenter(selectedCenter);
                }}
              >
                <Plus size={13} strokeWidth={2.25} aria-hidden="true" />
                <span>Add building</span>
              </button>
            )}

            <Link
              to={`${basePath}/evacuation-centers/${centerId}`}
              className="admin-map-btn-secondary-outline"
            >
              <ExternalLink size={13} strokeWidth={2} aria-hidden="true" />
              <span>Details</span>
            </Link>
          </div>
        </div>

        {/* Scrollable Body */}
        <div
          className="admin-map-detail-body"
          onScroll={(e) => setCenterPanelScrolled(e.currentTarget.scrollTop > 4)}
        >
          {/* Buildings section for campus centers */}
          {!isVenueOrHouse && (
            <section
              className="admin-map-detail-section"
              aria-label="Center buildings"
            >
              <div className="admin-map-detail-section-header">
                <div style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                  <h4 className="admin-map-detail-section-title">
                    Buildings ({buildingCount})
                  </h4>
                  {buildingCount > 0 && unmappedBuildingsInCenter > 0 && (
                    <StatusPill
                      variant="unmapped"
                      label={`${unmappedBuildingsInCenter} not mapped`}
                    />
                  )}
                  {buildingCount > 0 && unmappedBuildingsInCenter === 0 && (
                    <StatusPill variant="available" label="All mapped" />
                  )}
                </div>
                <span className="admin-map-detail-section-hint">
                  Tap a building to view rooms
                </span>
              </div>

              {buildingCount > 0 && unmappedBuildingsInCenter > 0 && (
                <div
                  role="status"
                  style={{
                    marginBottom: "10px",
                    padding: "8px 10px",
                    borderRadius: "8px",
                    backgroundColor: "#fffbeb",
                    border: "1px solid #fde68a",
                    color: "#b45309",
                    fontSize: "12px",
                    fontWeight: 500,
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "7px",
                    lineHeight: 1.4,
                  }}
                >
                  <AlertTriangle
                    size={14}
                    strokeWidth={2.2}
                    style={{ flexShrink: 0, marginTop: "2px" }}
                    aria-hidden="true"
                  />
                  <span>
                    <strong>
                      {unmappedBuildingsInCenter} of {buildingCount}{" "}
                      {buildingCount === 1 ? "building is" : "buildings are"} not mapped yet.
                    </strong>{" "}
                    Click <strong>Map building</strong> on an unmapped building below to draw its footprint on the map.
                  </span>
                </div>
              )}

              {buildingsLoading && buildingCount === 0 ? (
                <div
                  className="admin-map-detail-buildings-list"
                  aria-busy="true"
                  aria-label="Loading buildings"
                >
                  {[0, 1].map((idx) => (
                    <div
                      key={idx}
                      className="admin-map-skeleton-card"
                      aria-hidden="true"
                    >
                      <div className="admin-map-skeleton-row">
                        <div className="admin-map-skeleton-line admin-map-skeleton-line--title" />
                        <div className="admin-map-skeleton-pill" />
                      </div>
                      <div className="admin-map-skeleton-line admin-map-skeleton-line--meta" />
                      <div className="admin-map-skeleton-line admin-map-skeleton-line--bar" />
                    </div>
                  ))}
                </div>
              ) : buildingCount === 0 ? (
                <div className="admin-map-detail-empty-dashed">
                  <p className="admin-map-detail-empty-text">
                    No buildings yet.{" "}
                    {mapped
                      ? "Draw one to link its rooms."
                      : "Place this center on the map to draw buildings."}
                  </p>
                  {mapped && (
                    <button
                      type="button"
                      className="admin-map-btn-secondary-outline"
                      onClick={() => {
                        handleCloseCenterModal();
                        startAddBuildingFlowForCenter(selectedCenter);
                      }}
                    >
                      <Plus size={13} strokeWidth={2.25} aria-hidden="true" />
                      <span>Add building</span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="admin-map-detail-buildings-list" role="list">
                  {centerBuildings.map((b) => {
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
                    const bAssigned = Number(bProps.assigned ?? 0);
                    const bPct =
                      bCap > 0
                        ? Math.min(100, Math.round((bOcc / bCap) * 100))
                        : 0;

                    let statusVariant = "available";
                    let statusLabel = "Available";

                    if (bCap === 0) {
                      statusVariant = "neutral";
                      statusLabel = "No data";
                    } else if (bOcc >= bCap) {
                      statusVariant = "full";
                      statusLabel = "Full";
                    } else if (bAssigned >= bCap) {
                      statusVariant = "fully-assigned";
                      statusLabel = "Fully assigned";
                    } else if (bPct >= 80) {
                      statusVariant = "almost-full";
                      statusLabel = "Almost full";
                    }

                    const bMapped = Boolean(
                      (b.geometry &&
                        b.geometry.coordinates &&
                        b.geometry.coordinates.length > 0) ||
                        bProps.is_mapped
                    );

                    if (!bMapped) {
                      statusVariant = "unmapped";
                      statusLabel = "Not mapped";
                    }

                    const isSelectedBuilding =
                      selectedBuildingId != null &&
                      String(selectedBuildingId) === String(bId);

                    const handleOpenBuilding = () => {
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
                      setBuildingModalOpen(true);
                    };

                    const handleBuildingPolygonAction = () => {
                      setSelectedBuildingDetail(b);
                      setBuildingEditBoundaryError(null);
                      if (bMapped) {
                        const points = polygonToPoints(b.geometry);
                        setBuildingEditOriginalPoints(points);
                        setBuildingEditUndoStack([]);
                        setIsRedrawingBuildingFromScratch(points.length < 3);
                        setNewBuildingPoints(points.length >= 3 ? points : []);
                        setRedrawingBuildingId(bId);
                        setIsDrawingBuilding(true);
                        handleCloseCenterModal();
                      } else {
                        setNewBuildingPoints([]);
                        setBuildingEditOriginalPoints([]);
                        setBuildingEditUndoStack([]);
                        setIsRedrawingBuildingFromScratch(true);
                        setRedrawingBuildingId(bId);
                        setIsDrawingBuilding(true);
                        handleCloseCenterModal();
                      }
                    };

                    return (
                      <article
                        key={bId}
                        role="listitem"
                        className={`admin-map-building-card ${isSelectedBuilding ? "is-selected" : ""}`}
                      >
                        <button
                          type="button"
                          className="admin-map-building-card__select"
                          onClick={handleOpenBuilding}
                          aria-pressed={isSelectedBuilding}
                        >
                          <div className="admin-map-building-card__main">
                            <div
                              className="admin-map-building-card__icon"
                              aria-hidden="true"
                            >
                              <Building size={18} strokeWidth={2} />
                            </div>

                            <div className="admin-map-building-card__info">
                              <span className="admin-map-building-card__name">
                                {bName}
                              </span>
                              <span className="admin-map-building-card__sub">
                                {bOcc} of {bCap} here · {bAssigned} assigned
                              </span>
                            </div>

                            <div className="admin-map-building-card__right">
                              <span className="admin-map-building-card__rooms">
                                <span>
                                  {bRoomCount}{" "}
                                  {bRoomCount === 1 ? "room" : "rooms"}
                                </span>
                                <ChevronRight
                                  size={14}
                                  strokeWidth={2}
                                  aria-hidden="true"
                                />
                              </span>
                              <StatusPill
                                variant={statusVariant}
                                label={statusLabel}
                              />
                            </div>
                          </div>

                          <div className="admin-map-building-card__bar-row">
                            <ProgressBar
                              value={bOcc}
                              max={bCap}
                              size={8}
                              ariaLabel={`${bName} occupancy: ${bPct}%`}
                            />
                            <span className="admin-map-building-card__pct">
                              {bPct}%
                            </span>
                          </div>
                        </button>

                        <div className="admin-map-building-card__footer">
                          <button
                            type="button"
                            className="admin-map-btn-secondary-outline"
                            onClick={handleBuildingPolygonAction}
                            title={
                              bMapped
                                ? `Edit ${bName} polygon`
                                : `Map ${bName} polygon`
                            }
                          >
                            {bMapped ? (
                              <Pencil
                                size={13}
                                strokeWidth={2}
                                aria-hidden="true"
                              />
                            ) : (
                              <MapPin
                                size={13}
                                strokeWidth={2}
                                aria-hidden="true"
                              />
                            )}
                            <span>
                              {bMapped ? "Edit polygon" : "Map building"}
                            </span>
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* Shelter Capacity & Assigned Families (single venue, private property, or unmapped center) */}
          {showShelterAndFamilies && (
            <section
              className="admin-map-detail-section"
              aria-label="Shelter capacity and assigned families"
            >
              <div className="admin-map-detail-section-header">
                <h4 className="admin-map-detail-section-title">
                  Shelter capacity
                </h4>
                <span className="admin-map-detail-section-hint">
                  {typeInfo.label}
                </span>
              </div>

              <div className="admin-map-shelter-card">
                <div className="admin-map-shelter-row">
                  <span className="admin-map-shelter-label">Capacity</span>
                  <strong className="admin-map-shelter-val">
                    {capacity} {capacity === 1 ? "person" : "people"}
                  </strong>
                </div>
                <div className="admin-map-shelter-row">
                  <span className="admin-map-shelter-label">
                    Space remaining
                  </span>
                  <strong
                    className={`admin-map-shelter-val ${spaceLeft > 0 ? "is-available" : "is-full"}`}
                  >
                    {spaceLeft} {spaceLeft === 1 ? "space" : "spaces"} left
                  </strong>
                </div>
                {props.building_material && (
                  <div className="admin-map-shelter-row">
                    <span className="admin-map-shelter-label">
                      Building material
                    </span>
                    <span className="admin-map-shelter-val">
                      {props.building_material}
                    </span>
                  </div>
                )}
              </div>

              {/* Assigned families */}
              <div className="admin-map-detail-section-header admin-map-detail-section-header--spaced">
                <h4 className="admin-map-detail-section-title">
                  Assigned families ({centerFamilies.length})
                </h4>
              </div>

              {selectedCenterDetailsQuery.isLoading ? (
                <div
                  className="admin-map-detail-families-list"
                  aria-busy="true"
                  aria-label="Loading assigned families"
                >
                  {[0, 1].map((idx) => (
                    <div
                      key={idx}
                      className="admin-map-skeleton-card"
                      aria-hidden="true"
                    >
                      <div className="admin-map-skeleton-line admin-map-skeleton-line--title" />
                      <div className="admin-map-skeleton-line admin-map-skeleton-line--meta" />
                    </div>
                  ))}
                </div>
              ) : selectedCenterDetailsQuery.isError &&
                typeof api.getEvacuationCenterDetails === "function" ? (
                <div className="admin-map-panel-state is-error" role="alert">
                  <AlertCircle
                    size={20}
                    strokeWidth={2}
                    className="admin-map-panel-state__icon"
                    aria-hidden="true"
                  />
                  <p className="admin-map-panel-state__title">
                    Failed to load assigned families.
                  </p>
                  <button
                    type="button"
                    className="admin-map-btn-secondary-outline"
                    onClick={() => selectedCenterDetailsQuery.refetch()}
                  >
                    Retry
                  </button>
                </div>
              ) : centerFamilies.length === 0 ? (
                <div className="admin-map-detail-empty-dashed">
                  <p className="admin-map-detail-empty-text">
                    No families assigned to this shelter yet.
                  </p>
                </div>
              ) : (
                <div className="admin-map-detail-families-list">
                  {centerFamilies.map((fam) => {
                    const famId = fam.id || fam.family_id;
                    const isExpanded = Boolean(expandedCenterFamilyIds[famId]);
                    const members = fam.members || [];
                    const memCount =
                      fam.resident_count ??
                      fam.member_count ??
                      members.length ??
                      1;

                    return (
                      <div key={famId} className="admin-map-family-card">
                        <button
                          type="button"
                          className="admin-map-family-card__toggle"
                          aria-expanded={isExpanded}
                          onClick={() =>
                            setExpandedCenterFamilyIds((prev) => ({
                              ...prev,
                              [famId]: !prev[famId],
                            }))
                          }
                        >
                          <div className="admin-map-family-card__info">
                            <span className="admin-map-family-card__head">
                              {fam.head_name ||
                                fam.head_of_family ||
                                "Unnamed Family"}
                            </span>
                            <span className="admin-map-family-card__meta">
                              {fam.family_code || `FM-${famId}`} · {memCount}{" "}
                              {memCount === 1 ? "member" : "members"}
                            </span>
                          </div>
                          {isExpanded ? (
                            <ChevronUp
                              size={15}
                              strokeWidth={2}
                              className="admin-map-family-card__chevron"
                              aria-hidden="true"
                            />
                          ) : (
                            <ChevronDown
                              size={15}
                              strokeWidth={2}
                              className="admin-map-family-card__chevron"
                              aria-hidden="true"
                            />
                          )}
                        </button>

                        {isExpanded && (
                          <div className="admin-map-family-card__members">
                            {members.length === 0 ? (
                              <p className="admin-map-family-card__empty">
                                No individual member records listed.
                              </p>
                            ) : (
                              <table className="admin-map-family-table">
                                <thead>
                                  <tr>
                                    <th>Name</th>
                                    <th>Age</th>
                                    <th>Gender</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {members.map((m, idx) => (
                                    <tr key={m.id || idx}>
                                      <td className="admin-map-family-table__name">
                                        {m.full_name ||
                                          m.name ||
                                          `${m.first_name || ""} ${m.last_name || ""}`.trim() ||
                                          "Member"}
                                      </td>
                                      <td>{m.age ?? "—"}</td>
                                      <td>{m.gender ?? "—"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </div>
      </MapOverlayPanel>
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
          className={`admin-map-page ${panelCollapsed ? "is-panel-collapsed" : ""
            } ${isMapping ? "in-mapping-mode" : ""} ${isFullView || isDrawingBuilding || isPlacingRoom ? "is-full-view" : ""
            } ${selectedCenter ? "has-selected-center" : ""
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
                        : mappingStep === "edit"
                          ? "edit"
                          : "confirm"
                  }
                  pendingFootprint={footprintPoints}
                  pendingEntrances={footprintPoints.length >= 3 ? entrancePoints : []}
                  editablePolygon={mappingStep === "edit" ? footprintPoints : null}
                  onEditablePolygonChange={
                    mappingStep === "edit"
                      ? (newPoints) => {
                        setFootprintPoints(newPoints);
                      }
                      : null
                  }
                  onCloseShape={() => {
                    if (footprintPoints.length >= 3) {
                      handleStepChange("entrance");
                    }
                  }}
                  onOutsideOutlineClick={() => {
                    showPlacementToast("Entrance must be on the outline");
                  }}
                  onOutsideSogodClick={() => {
                    showPlacementToast("Cannot map beyond the Sogod municipality boundary.");
                  }}
                  onMapClick={(latlng) => {
                    if (mappingTool === "pan") return;
                    if (sogodBoundary) {
                      const coords = sogodBoundary.features?.[0]?.geometry?.coordinates;
                      if (coords && !isPointInGeoPolygon([Number(latlng.lng), Number(latlng.lat)], coords)) {
                        showPlacementToast("Cannot map beyond the Sogod municipality boundary.");
                        return;
                      }
                    }
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
                  buildingsGeoJSON={buildingsGeoJSON}
                  hiddenCenterId={redrawingCenterId || undefined}
                  hiddenBuildingId={redrawingBuildingId || undefined}
                  onStaffAction={staffActions}
                />
              </CenterPlacementFlow>
            ) : (
              <DashboardMap
                centers={centers}
                hazardZones={hazardZones}
                selectedCenter={selectedCenter}
                onStaffAction={staffActions}
                rescueRequests={activeRescueRequests}
                pendingHazardReports={pendingHazardReports}
                onRescueAction={rescueActions}
                topRightSlot={
                  !isDrawingBuilding && !isPlacingRoom ? (
                    <MapControlButton
                      icon={isFullView ? Minimize2 : Maximize2}
                      active={isFullView}
                      aria-pressed={isFullView}
                      onClick={() => setIsFullView((v) => !v)}
                      title={isFullView ? "Exit full view" : "Full view"}
                      ariaLabel={isFullView ? "Exit full view" : "Full view"}
                    />
                  ) : null
                }
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
                drawMode={
                  isDrawingBuilding && redrawingBuildingId && !isRedrawingBuildingFromScratch && newBuildingPoints.length >= 3
                    ? "edit"
                    : isDrawingBuilding
                      ? "footprint"
                      : isPlacingRoom
                        ? "room"
                        : "none"
                }
                pendingFootprint={
                  isDrawingBuilding
                    ? newBuildingPoints
                    : (isPlacingRoom || panelSubView === "map_rooms") && selectedCenter?.geometry
                      ? polygonToPoints(selectedCenter.geometry)
                      : []
                }
                editablePolygon={
                  isDrawingBuilding && redrawingBuildingId && !isRedrawingBuildingFromScratch && newBuildingPoints.length >= 3
                    ? newBuildingPoints
                    : null
                }
                onEditablePolygonChange={
                  isDrawingBuilding && redrawingBuildingId && !isRedrawingBuildingFromScratch && newBuildingPoints.length >= 3
                    ? handleEditingBuildingPointsChange
                    : null
                }
                centerBoundaryPolygon={
                  (isDrawingBuilding || isPlacingRoom) && selectedCenter?.geometry
                    ? polygonToPoints(selectedCenter.geometry)
                    : null
                }
                // Building edit mode props
                editingBuildingId={isDrawingBuilding && redrawingBuildingId ? redrawingBuildingId : null}
                editingBuildingPoints={isDrawingBuilding && redrawingBuildingId ? newBuildingPoints : null}
                onEditingBuildingPointsChange={isDrawingBuilding && redrawingBuildingId ? handleEditingBuildingPointsChange : null}
                onOutsideOutlineClick={() => {
                  showPlacementToast(
                    isDrawingBuilding
                      ? "Building must stay inside the evacuation center boundary."
                      : "Click inside or near the outline."
                  );
                }}
                onOutsideSogodClick={() => {
                  showPlacementToast(
                    "Cannot map beyond the Sogod municipality boundary."
                  );
                }}
                onBasemapBuildingClick={handleBasemapBuildingClick}
                onDoubleTapFinish={handleDoubleTapFinish}
                onCloseShape={() => {
                  if (isDrawingBuilding && addBuildingStep === "draw") {
                    handleDoubleTapFinish();
                  } else if (isDrawingBuilding && redrawingBuildingId && isRedrawingBuildingFromScratch && newBuildingPoints.length >= 3) {
                    const centerPts = selectedCenter?.geometry ? polygonToPoints(selectedCenter.geometry) : [];
                    if (centerPts.length >= 3 && !isBuildingInsideCenter(newBuildingPoints, centerPts, true)) {
                      showPlacementToast("Building must stay inside the evacuation center boundary.");
                      return;
                    }
                    setIsRedrawingBuildingFromScratch(false);
                  }
                }}
                onMapClick={(latlng) => {
                  if (sogodBoundary) {
                    const coords = sogodBoundary.features?.[0]?.geometry?.coordinates;
                    if (coords && !isPointInGeoPolygon([Number(latlng.lng), Number(latlng.lat)], coords)) {
                      showPlacementToast("Cannot map beyond the Sogod municipality boundary.");
                      return;
                    }
                  }
                  if (isPlacingRoom) {
                    handleMapClickForRoom(latlng);
                  } else if (isDrawingBuilding) {
                    // Only allow adding points by clicking when drawing a new building or redrawing from scratch
                    if (redrawingBuildingId && !isRedrawingBuildingFromScratch && newBuildingPoints.length >= 3) {
                      return;
                    }
                    const centerPts = selectedCenter?.geometry ? polygonToPoints(selectedCenter.geometry) : [];
                    if (
                      centerPts.length >= 3 &&
                      !isBuildingInsideCenter([...newBuildingPoints, latlng], centerPts, false)
                    ) {
                      showPlacementToast("Building must stay inside the evacuation center boundary.");
                      return;
                    }
                    setBuildingEditBoundaryError(null);
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
                    className="admin-map-building-edit-btn is-secondary"
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
                    className="admin-map-building-edit-btn is-secondary"
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
                    className="admin-map-building-edit-btn is-secondary"
                    onClick={handleRedrawBuildingEdit}
                    title="Redraw from scratch"
                    aria-label="Redraw"
                  >
                    <FontAwesomeIcon icon={faTrashCan} />
                    <span>Redraw</span>
                  </button>
                  <button
                    type="button"
                    className="admin-map-building-edit-btn is-primary"
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
                    className="admin-map-building-edit-btn is-danger"
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
                      `${basePath}/evacuation-centers/${saveNotice.centerId}`
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
              DESKTOP FLOATING PANEL (360px wide, 20px margins, full height)
              --------------------------------------------------------- */}
          {!isMobile && !panelCollapsed && !isMapping && !(isDrawingBuilding && redrawingBuildingId) && (
            <MapOverlayPanel
              as="aside"
              className={`admin-map-floating-panel ${selectedCenter && panelSubView === "map_rooms" ? "is-rooms-panel" : ""}`}
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
                        aria-label="Collapse panel"
                      >
                        <PanelLeftClose size={16} strokeWidth={2} aria-hidden="true" />
                      </button>
                    </div>
                    {renderPanelHeaderControls()}
                  </header>

                  <div className="admin-map-panel-body">
                    {renderPanelContent()}
                  </div>
                </>
              )}
            </MapOverlayPanel>
          )}

          {/* ---------------------------------------------------------
              TOP-LEFT FLOATING PILLS (Go Back + Collapsed Centers Button)
              --------------------------------------------------------- */}
          {!isMapping && !(isDrawingBuilding && redrawingBuildingId) && (
            <div className="admin-map-top-left-pills">
              {(deepLinkedHazardId || deepLinkedRescueId) && (
                <button
                  type="button"
                  className="admin-map-back-pill"
                  onClick={() => {
                    if (deepLinkedHazardId) {
                      handleEditReport({ id: deepLinkedHazardId });
                    } else if (deepLinkedRescueId) {
                      handleOpenRescueAlerts({ id: deepLinkedRescueId });
                    }
                  }}
                  aria-label={
                    deepLinkedHazardId
                      ? "Go back to Hazard Reports"
                      : "Go back to Rescue Alerts"
                  }
                >
                  <FontAwesomeIcon icon={faArrowLeft} className="admin-map-back-pill-icon" aria-hidden="true" />
                  <span className="admin-map-centers-pill-label">Go back</span>
                </button>
              )}

              {((!isMobile && panelCollapsed) || (isMobile && !mobileCentersSheetOpen)) && (
                <button
                  type="button"
                  className="admin-map-centers-pill admin-map-mobile-centers-pill"
                  onClick={() => {
                    if (isMobile) {
                      setMobileCentersSheetOpen(true);
                    } else {
                      setPanelCollapsed(false);
                    }
                  }}
                  aria-expanded="false"
                  aria-label={`Open centers panel, ${allCentersList.length} center${allCentersList.length === 1 ? "" : "s"}${
                    unmappedCentersCount > 0 ? `, ${unmappedCentersCount} center(s) not mapped` : ""
                  }${
                    unmappedBuildingsSummary.totalUnmappedBuildings > 0
                      ? `, ${unmappedBuildingsSummary.totalUnmappedBuildings} building(s) not mapped`
                      : ""
                  }`}
                >
                  <Building2 size={16} strokeWidth={2} className="admin-map-centers-pill-icon" aria-hidden="true" />
                  <span className="admin-map-centers-pill-label">
                    Centers ({allCentersList.length})
                  </span>
                  {(unmappedCentersCount > 0 || unmappedBuildingsSummary.totalUnmappedBuildings > 0) && (
                    <span
                      className="admin-map-sheet-badge"
                      title={
                        [
                          unmappedCentersCount > 0
                            ? `${unmappedCentersCount} unmapped center${unmappedCentersCount === 1 ? "" : "s"}`
                            : null,
                          unmappedBuildingsSummary.totalUnmappedBuildings > 0
                            ? `${unmappedBuildingsSummary.totalUnmappedBuildings} unmapped building${unmappedBuildingsSummary.totalUnmappedBuildings === 1 ? "" : "s"}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      }
                      aria-hidden="true"
                    >
                      {unmappedCentersCount + unmappedBuildingsSummary.totalUnmappedBuildings}
                    </span>
                  )}
                </button>
              )}
            </div>
          )}

          {/* Mobile Bottom Sheet (Visible <= 768px when triggered) */}
          {isMobile && !isMapping && mobileCentersSheetOpen && !(isDrawingBuilding && redrawingBuildingId) && (
            <>
              <div
                className="admin-map-bottom-sheet-backdrop popover-backdrop"
                onClick={() => setMobileCentersSheetOpen(false)}
                aria-hidden="true"
              />
              <section
                ref={mobileSheetRef}
                className="admin-map-bottom-sheet is-open mobile-sheet-active"
                role="region"
                aria-label="Evacuation Centers"
              >
                <button
                  type="button"
                  className="admin-map-sheet-drag-handle"
                  onClick={() => setMobileCentersSheetOpen(false)}
                  onTouchStart={handleDragHandleTouchStart}
                  onTouchMove={handleDragHandleTouchMove}
                  onTouchEnd={handleDragHandleTouchEnd}
                  aria-label="Close centers panel"
                >
                  <span className="admin-map-sheet-handle-bar" aria-hidden="true" />
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

                        <button
                          type="button"
                          className="admin-map-sheet-close-btn admin-map-panel-collapse-btn"
                          onClick={() => setMobileCentersSheetOpen(false)}
                          aria-label="Close centers sheet"
                        >
                          <FontAwesomeIcon icon={faXmark} />
                        </button>
                      </div>
                      {renderPanelHeaderControls(false)}
                    </header>

                    <div className="admin-map-sheet-body">
                      {renderPanelContent()}
                    </div>
                  </>
                )}
              </section>
            </>
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
          <AddBuildingModal
            open={mapAddBuildingModalOpen}
            buildingForm={mapAddBuildingForm}
            onChange={setMapAddBuildingForm}
            saving={false}
            onSubmit={handleBeginBuildingOutline}
            onClose={() => setMapAddBuildingModalOpen(false)}
          />
          {/* Edit Building Details & Max Rooms Modal */}
          {editBuildingModalOpen && (
            <BuildingFormModal
              open={editBuildingModalOpen}
              mode="edit"
              buildingForm={editingBuildingForm}
              onChange={setEditingBuildingForm}
              activeRoomCount={
                editingBuilding
                  ? selectedCenterRooms.filter(
                      (r) =>
                        String(r.building_id) ===
                          String(editingBuilding.properties?.id ?? editingBuilding.id) &&
                        r.is_active !== false
                    ).length
                  : 0
              }
              saving={savingBuildingModal}
              onSubmit={handleSaveEditBuilding}
              onClose={() => {
                setEditBuildingModalOpen(false);
                setEditingBuilding(null);
              }}
            />
          )}

          {/* Add / Edit Room Modal for Buildings */}
          {isAdminRoomModalOpen && (
            <CenterRoomModal
              mode={roomModalMode}
              selectedCenter={selectedCenter}
              selectedRoom={selectedRoomToEdit}
              roomForm={adminRoomForm}
              onChange={setAdminRoomForm}
              saving={savingAdminRoom}
              onSubmit={handleSaveAdminRoom}
              onClose={() => {
                setIsAdminRoomModalOpen(false);
                setSelectedRoomToEdit(null);
              }}
              buildings={centerBuildings}
              defaultBuildingId={adminRoomForm.building_id}
            />
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

          {/* Bottom-right floating action buttons */}
          {!isMapping && !(isDrawingBuilding && redrawingBuildingId) && (
            <div
              className="admin-map-fab-bar"
              role="toolbar"
              aria-label="Admin quick actions"
            >
              <button
                type="button"
                className="admin-map-fab admin-map-fab--primary"
                onClick={handleOpenAddCenter}
                aria-label="Add Evacuation Center"
              >
                <Plus size={20} strokeWidth={2.25} aria-hidden="true" />
                <span className="admin-map-fab__tooltip" role="tooltip">
                  Add Evacuation Center
                </span>
              </button>

              <button
                type="button"
                className="admin-map-fab admin-map-fab--secondary"
                onClick={() => navigate(`${basePath}?tab=rescue`)}
                aria-label={`Rescue Alerts${openRescueCount > 0 ? ` (${openRescueCount} open)` : ""}`}
              >
                <LifeBuoy size={20} strokeWidth={2} aria-hidden="true" />
                {openRescueCount > 0 && (
                  <span className="admin-map-fab__badge" aria-hidden="true">
                    {openRescueCount}
                  </span>
                )}
                <span className="admin-map-fab__tooltip" role="tooltip">
                  Rescue alerts
                </span>
              </button>

              <button
                type="button"
                className={`admin-map-fab admin-map-fab--danger${pendingHazardReports.length > 0 ? " has-alerts" : ""}`}
                onClick={() => navigate(`${basePath}?tab=reports`)}
                aria-label={`Hazard Reports${pendingHazardReports.length > 0 ? ` (${pendingHazardReports.length} pending review)` : ""}`}
              >
                <AlertTriangle size={20} strokeWidth={2} aria-hidden="true" />
                {pendingHazardReports.length > 0 && (
                  <span className="admin-map-fab__badge is-warn" aria-hidden="true">
                    {pendingHazardReports.length}
                  </span>
                )}
                <span className="admin-map-fab__tooltip" role="tooltip">
                  Hazard reports
                </span>
              </button>
            </div>
          )}

          {/* Add Evacuation Center Modal (4-step wizard) */}
          {addCenterModalOpen && (
            <CenterFormModal
              mode="add"
              centerForm={addCenterForm}
              onChange={setAddCenterForm}
              barangays={barangaysData}
              saving={savingAddCenter}
              error={addCenterError}
              onClearError={() => setAddCenterError("")}
              onSubmit={handleSaveAddCenter}
              onClose={() => setAddCenterModalOpen(false)}
            />
          )}
        </main>
      </div>
    </div>
  );
}

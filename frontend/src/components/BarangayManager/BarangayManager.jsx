import { useMemo, useRef, useState, useEffect } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Download,
  Home,
  LayoutGrid,
  MapPin,
  Plus,
  Search,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { api } from "../../services/api";
import {
  invalidateEvacuationQueries,
  queryKeys,
  useBarangay,
  useBarangayCenters,
  useBarangays,
  useEvacuationCenters,
} from "../../hooks/useEvacuationQueries";
import "./BarangayManager.css";
import "./BarangayManager.motion.css";
import FamilyManagement from "../EvacuationCenter/FamilyManagement";
import { resolveCenterStructureMode } from "../EvacuationCenter/utils";
import LoadingState from "../LoadingState/LoadingState";
import BarangaysServedPicker from "../BarangaysServedPicker/BarangaysServedPicker";
import { Button, ProgressBar, SegmentedControl, StatCard, StatusPill, MobileFilterButton } from "../ui";
import { formatRoomLabel } from "../../utils/formatRoomLabel";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faRotate,
  faTriangleExclamation,
  faArrowLeft,
  faLocationDot,
  faUpload,
  faFileExcel,
  faXmark,
  faCircleCheck,
  faHouse,
  faPeopleGroup,
  faBuilding,
  faDoorOpen,
  faPlus,
  faPenToSquare,
  faRightLeft,
  faUserXmark,
  faEye,
  faChevronRight,
  faHouseFlag,
} from "@fortawesome/free-solid-svg-icons";

function formatHouseholdCode(idOrCode) {
  if (!idOrCode) return "FM-NEW";
  if (typeof idOrCode === "object") {
    if (idOrCode.family_code) return idOrCode.family_code;
    const rawId = idOrCode.family_id || idOrCode.id;
    return rawId ? `FM-${String(rawId).padStart(4, "0")}` : "FM-NEW";
  }
  if (typeof idOrCode === "string" && idOrCode.includes("-")) {
    return idOrCode;
  }
  return `FM-${String(idOrCode).padStart(4, "0")}`;
}

function BarangayManager() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const barangaysQuery = useBarangays();
  const barangays = useMemo(
    () => (Array.isArray(barangaysQuery.data) ? barangaysQuery.data : []),
    [barangaysQuery.data]
  );

  const allCentersQuery = useEvacuationCenters(true);
  const totalUniqueCenters = useMemo(() => {
    if (Array.isArray(allCentersQuery.data?.features)) {
      return allCentersQuery.data.features.length;
    }
    if (Array.isArray(allCentersQuery.data)) {
      return allCentersQuery.data.length;
    }
    return 0;
  }, [allCentersQuery.data]);

  // Navigation state: top-level and detail tabs live in the URL (?tab=barangays|families|overview)
  const barangayParam = searchParams.get("barangay");
  const selectedBarangayId = useMemo(() => {
    if (!barangayParam) return null;
    const asNumber = Number(barangayParam);
    return Number.isNaN(asNumber) ? barangayParam : asNumber;
  }, [barangayParam]);

  const tabParam = searchParams.get("tab");
  const workspaceTab =
    !selectedBarangayId && tabParam === "families" ? "families" : "barangays";
  const barangaySection =
    selectedBarangayId && tabParam === "families" ? "households" : "overview";

  function setWorkspaceTab(nextTab) {
    const targetTab = nextTab === "families" ? "families" : "barangays";
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("barangay");
      next.set("tab", targetTab);
      return next;
    });
  }

  function setBarangayDetailTab(nextSection) {
    const targetTab =
      nextSection === "households" || nextSection === "families"
        ? "families"
        : "overview";
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", targetTab);
      if (selectedBarangayId != null) {
        next.set("barangay", String(selectedBarangayId));
      }
      return next;
    });
  }

  const barangaysTabHref = `${location.pathname}?tab=barangays`;
  const familiesTabHref = `${location.pathname}?tab=families`;
  const [selectedCenterId, setSelectedCenterId] = useState(null);
  const [selectedRoomId, setSelectedRoomId] = useState(null);

  // Deep-link triggers into FamilyManagement
  const [startAddFamilyOnOpen, setStartAddFamilyOnOpen] = useState(false);
  const [initialFamilyIdToOpen, setInitialFamilyIdToOpen] = useState(null);

  // Queries for selected barangay
  const selectedBarangayQuery = useBarangay(selectedBarangayId);
  const selectedBarangay = useMemo(() => {
    const raw = selectedBarangayQuery.data;
    if (!raw) return null;
    const rawFamilies = Array.isArray(raw.families) ? raw.families : [];
    return {
      ...raw,
      families: rawFamilies.map((f) => {
        const isAssigned =
          f.assignment_status === "Assigned" ||
          f.evacuation_status === "Assigned" ||
          f.evacuation_status === "Partially Assigned" ||
          Number(f.assigned_members || 0) > 0;
        return {
          ...f,
          head_of_family: f.head_of_family || f.head_name || "",
          head_name: f.head_name || f.head_of_family || "",
          assignment_status: isAssigned ? "Assigned" : "Unassigned",
        };
      }),
    };
  }, [selectedBarangayQuery.data]);

  const centersQuery = useBarangayCenters(selectedBarangay?.id, {
    enabled: selectedBarangay?.id != null,
  });
  const centers = useMemo(() => {
    const rawCenters = Array.isArray(centersQuery.data) ? centersQuery.data : [];
    return rawCenters.map((c) => {
      const rawRooms = Array.isArray(c.rooms) ? c.rooms : [];
      return {
        ...c,
        rooms: rawRooms.map((r) => {
          const rawFams = Array.isArray(r.assigned_families)
            ? r.assigned_families
            : Array.isArray(r.families)
              ? r.families
              : [];
          const rawNum = r.room_number || r.room_name || "";
          const displayRoomName = formatRoomLabel(r.room_name || rawNum);
          const isRoomAssigned = Boolean(
            r.is_assigned ||
            r.assignment_status === "Assigned" ||
            rawFams.length > 0 ||
            Number(r.occupied || 0) > 0
          );
          return {
            ...r,
            room_number: rawNum,
            room_name: displayRoomName,
            is_assigned: isRoomAssigned,
            assignment_status: isRoomAssigned ? "Assigned" : "Unassigned",
            assigned_families: rawFams.map((f) => ({
              ...f,
              family_id: f.family_id || f.id,
              head_of_family: f.head_of_family || f.head_name || "",
              head_name: f.head_name || f.head_of_family || "",
              occupied: f.occupied ?? f.assigned_members ?? f.member_count ?? 1,
            })),
          };
        }),
      };
    });
  }, [centersQuery.data]);

  // Feedback banners
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Auto-dismiss notification toasts after 4.5 seconds
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(""), 4500);
    return () => clearTimeout(t);
  }, [error]);

  useEffect(() => {
    if (!successMsg) return;
    const t = setTimeout(() => setSuccessMsg(""), 4500);
    return () => clearTimeout(t);
  }, [successMsg]);

  // Page A Search, Status Filter & Pagination
  const [barangaySearch, setBarangaySearch] = useState("");
  const [barangayStatusFilter, setBarangayStatusFilter] = useState("all"); // 'all' | 'sheltered' | 'unassigned' | 'no-records'
  const [brgyPage, setBrgyPage] = useState(1);
  const brgyPageSize = 10;

  // Phase 3: Barangay Overview Household Filters (Assigned/Unassigned + Building)
  const [overviewHouseholdSearch, setOverviewHouseholdSearch] = useState("");
  const [overviewStatusFilter, setOverviewStatusFilter] = useState("");
  const [overviewBuildingFilter, setOverviewBuildingFilter] = useState("");

  // Evacuation Center Add/Edit Modal
  const [centerModal, setCenterModal] = useState(null); // { mode: 'add' | 'edit', id?, name, address, capacity, contact_number, building_material, amenities, is_active }
  const [savingCenter, setSavingCenter] = useState(false);

  // Room Add/Edit Modal
  const [roomModal, setRoomModal] = useState(null); // { mode: 'add' | 'edit', centerId, centerName, id?, room_name, room_type, capacity, notes, is_active }
  const [savingRoom, setSavingRoom] = useState(false);

  // Room Household Assignment / Transfer Modal
  const [roomAssignModal, setRoomAssignModal] = useState(null);
  // { mode: 'assign-to-room' | 'transfer-household', familyId, centerId, roomId, familyObj? }
  const [assigningHousehold, setAssigningHousehold] = useState(false);

  // Confirm Unassign Modal
  const [unassignTarget, setUnassignTarget] = useState(null); // { familyId, headName }
  const [unassigning, setUnassigning] = useState(false);
  const [familyScreen, setFamilyScreen] = useState("list");
  const familyActionsRef = useRef(null);

  const loading = barangaysQuery.isLoading;
  const detailLoading = selectedBarangayQuery.isLoading && Boolean(selectedBarangayId);
  const centersLoading = centersQuery.isLoading;

  const visibleError =
    error ||
    barangaysQuery.error?.message ||
    selectedBarangayQuery.error?.message ||
    centersQuery.error?.message ||
    "";

  // Derived active center & room objects
  const activeCenter = useMemo(
    () => centers.find((c) => Number(c.id) === Number(selectedCenterId)) || null,
    [centers, selectedCenterId]
  );

  const activeRoom = useMemo(() => {
    if (!activeCenter) return null;
    return (
      (activeCenter.rooms || []).find((r) => Number(r.id) === Number(selectedRoomId)) || null
    );
  }, [activeCenter, selectedRoomId]);

  // Derived Barangay Summary Totals (Page A)
  const overallStats = useMemo(() => {
    let totalHouseholds = 0;
    let totalResidents = 0;
    let totalAssigned = 0;
    let totalUnassigned = 0;

    for (const b of barangays) {
      totalHouseholds += Number(
        b.household_count ?? b.family_count ?? b.total_families ?? 0
      );
      totalResidents += Number(b.resident_count ?? b.total_residents ?? 0);
      totalAssigned += Number(b.assigned_family_count ?? 0);
      totalUnassigned += Number(b.unassigned_family_count ?? 0);
    }

    const assignedPct = totalHouseholds > 0 ? Math.round((totalAssigned / totalHouseholds) * 100) : 0;

    return {
      totalBarangays: barangays.length,
      totalHouseholds,
      totalResidents,
      totalCenters: totalUniqueCenters,
      totalAssigned,
      totalUnassigned,
      assignedPct,
    };
  }, [barangays, totalUniqueCenters]);

  // Filtered Barangays (Page A)
  const filteredBarangays = useMemo(() => {
    const q = barangaySearch.trim().toLowerCase();
    return barangays.filter((b) => {
      if (q && !(b.name || "").toLowerCase().includes(q)) return false;
      if (barangayStatusFilter !== "all") {
        const famCount = Number(
          b.household_count ?? b.family_count ?? b.total_families ?? 0
        );
        const assignedCount = Number(b.assigned_family_count ?? 0);
        const unassignedCount = Number(
          b.unassigned_family_count ?? Math.max(0, famCount - assignedCount)
        );
        const rowStatus =
          famCount === 0
            ? "no-records"
            : unassignedCount > 0
              ? "unassigned"
              : "sheltered";
        if (rowStatus !== barangayStatusFilter) return false;
      }
      return true;
    });
  }, [barangays, barangaySearch, barangayStatusFilter]);

  const totalBrgyPages = Math.max(1, Math.ceil(filteredBarangays.length / brgyPageSize));
  const safeBrgyPage = Math.min(brgyPage, totalBrgyPages);
  const paginatedBarangays = useMemo(() => {
    const start = (safeBrgyPage - 1) * brgyPageSize;
    return filteredBarangays.slice(start, start + brgyPageSize);
  }, [filteredBarangays, safeBrgyPage, brgyPageSize]);

  // Selected Barangay Derived Stats (Page B)
  const selectedBarangayStats = useMemo(() => {
    if (!selectedBarangay) {
      return {
        totalHouseholds: 0,
        totalResidents: 0,
        assignedHouseholds: 0,
        unassignedHouseholds: 0,
        totalCenters: 0,
        totalRooms: 0,
        totalCapacity: 0,
        totalOccupied: 0,
        totalAvailable: 0,
      };
    }

    const familiesList = Array.isArray(selectedBarangay.families)
      ? selectedBarangay.families
      : [];
    const totalHouseholds = Number(
      selectedBarangay.household_count ??
      selectedBarangay.family_count ??
      familiesList.length ??
      0
    );
    const totalResidents = Number(
      selectedBarangay.resident_count ??
      familiesList.reduce(
        (acc, f) => acc + Number(f.resident_count ?? f.member_count ?? 0),
        0
      )
    );
    const assignedHouseholds = Number(
      selectedBarangay.assigned_family_count ??
      familiesList.filter((f) => f.assignment_status === "Assigned").length
    );
    const unassignedHouseholds = Number(
      selectedBarangay.unassigned_family_count ??
      Math.max(0, totalHouseholds - assignedHouseholds)
    );

    let totalRooms = 0;
    let totalCapacity = 0;
    let totalOccupied = 0;
    let totalAvailable = 0;

    for (const c of centers) {
      const rooms = Array.isArray(c.rooms) ? c.rooms : [];
      totalRooms += rooms.length;
      const cap = Number(
        c.capacity || rooms.reduce((sum, r) => sum + Number(r.capacity || 0), 0)
      );
      const occ = Number(
        c.occupied ?? rooms.reduce((sum, r) => sum + Number(r.occupied || 0), 0)
      );
      totalCapacity += cap;
      totalOccupied += occ;
      totalAvailable += Math.max(0, cap - occ);
    }

    return {
      totalHouseholds,
      totalResidents,
      assignedHouseholds,
      unassignedHouseholds,
      totalCenters: centers.length || Number(selectedBarangay.evacuation_center_count || 0),
      totalRooms,
      totalCapacity,
      totalOccupied,
      totalAvailable,
    };
  }, [selectedBarangay, centers]);

  const barangayBuildings = useMemo(() => {
    const map = new Map();
    if (Array.isArray(selectedBarangay?.buildings)) {
      for (const b of selectedBarangay.buildings) {
        if (b?.id != null) {
          map.set(Number(b.id), {
            id: Number(b.id),
            name: b.name || `Building ${b.id}`,
            center_name: b.center_name || "",
          });
        }
      }
    }
    for (const c of centers) {
      if (Array.isArray(c.buildings)) {
        for (const b of c.buildings) {
          if (b?.id != null && !map.has(Number(b.id))) {
            map.set(Number(b.id), {
              id: Number(b.id),
              name: b.name || `Building ${b.id}`,
              center_name: c.name || "",
            });
          }
        }
      }
    }
    for (const fam of selectedBarangay?.families || []) {
      if (fam?.current_building_id != null && !map.has(Number(fam.current_building_id))) {
        map.set(Number(fam.current_building_id), {
          id: Number(fam.current_building_id),
          name: fam.current_building_name || fam.current_building || `Building ${fam.current_building_id}`,
          center_name: fam.current_center_name || "",
        });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""))
    );
  }, [selectedBarangay, centers]);

  const filteredOverviewFamilies = useMemo(() => {
    const list = Array.isArray(selectedBarangay?.families) ? selectedBarangay.families : [];
    const q = overviewHouseholdSearch.trim().toLowerCase();
    return list.filter((fam) => {
      const isAssigned = fam.assignment_status === "Assigned";
      if (overviewStatusFilter === "assigned" && !isAssigned) return false;
      if (overviewStatusFilter === "unassigned" && isAssigned) return false;

      if (overviewBuildingFilter) {
        if (overviewBuildingFilter === "unmapped") {
          if (!isAssigned || fam.current_building_id != null) return false;
        } else {
          const matchesPrimary =
            fam.current_building_id != null &&
            String(fam.current_building_id) === String(overviewBuildingFilter);
          const matchesAssignment =
            Array.isArray(fam.assignments) &&
            fam.assignments.some(
              (a) =>
                a.building_id != null &&
                String(a.building_id) === String(overviewBuildingFilter)
            );
          if (!matchesPrimary && !matchesAssignment) return false;
        }
      }

      if (q) {
        const hay = `${fam.head_name || fam.head_of_family || ""} ${fam.family_code || ""
          } ${fam.current_building_name || ""} ${fam.current_room_name || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    selectedBarangay,
    overviewHouseholdSearch,
    overviewStatusFilter,
    overviewBuildingFilter,
  ]);

  async function loadBarangays() {
    try {
      setError("");
      await invalidateEvacuationQueries(queryClient);
    } catch (err) {
      console.error("Failed to refresh barangays:", err);
      setError(err.message || "Failed to refresh barangay data.");
    }
  }

  async function openBarangay(id, initialSection = "overview") {
    try {
      setError("");
      setSuccessMsg("");
      setFamilyScreen("list");
      setSelectedCenterId(null);
      setSelectedRoomId(null);
      setOverviewHouseholdSearch("");
      setOverviewStatusFilter("");
      setOverviewBuildingFilter("");
      const targetTab =
        initialSection === "households" || initialSection === "families"
          ? "families"
          : "overview";
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", targetTab);
        next.set("barangay", String(id));
        return next;
      });
      await queryClient.fetchQuery({
        queryKey: queryKeys.barangay(id),
        queryFn: () => api.getBarangay(id),
      });
    } catch (err) {
      console.error("Failed to load barangay:", err);
      setError(err.message || "Failed to load barangay.");
    }
  }

  function closeBarangay() {
    setFamilyScreen("list");
    setSelectedCenterId(null);
    setSelectedRoomId(null);
    setStartAddFamilyOnOpen(false);
    setInitialFamilyIdToOpen(null);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("barangay");
      next.set("tab", "barangays");
      return next;
    });
  }

  function openHouseholdsSection(options = {}) {
    if (options.startAdd) {
      setStartAddFamilyOnOpen(true);
    }
    if (options.familyId) {
      setInitialFamilyIdToOpen(options.familyId);
      setFamilyScreen("household-detail");
    } else {
      setFamilyScreen("list");
    }
    setBarangayDetailTab("families");
  }

  function openCentersSection(centerId = null, roomId = null) {
    const isLgu = window.location.pathname.startsWith("/lgu");
    const targetPath = isLgu ? "/lgu" : "/admin";
    if (centerId) {
      navigate(`${targetPath}?tab=centers&center=${centerId}&subtab=buildings`);
    } else {
      navigate(`${targetPath}?tab=centers`);
    }
  }



  // =========================================================
  // EVACUATION CENTER & ROOM HANDLERS (SECTION 5)
  // =========================================================

  function openAddCenterModal() {
    if (!selectedBarangay) return;
    setError("");
    setCenterModal({
      mode: "add",
      name: "",
      barangay_ids: [String(selectedBarangay.id)],
      address: selectedBarangay.name,
      capacity: 100,
      contact_number: "",
      building_material: "",
      amenities: "",
      is_active: true,
    });
  }

  function openEditCenterModal(center) {
    setError("");
    setCenterModal({
      mode: "edit",
      id: center.id,
      name: center.name || "",
      barangay_ids: (center.barangays || []).map((barangay) => String(barangay.id)),
      address: center.address || selectedBarangay?.name || "",
      capacity: center.capacity ?? 0,
      contact_number: center.contact_number || "",
      building_material: center.building_material || "",
      amenities: Array.isArray(center.amenities)
        ? center.amenities.map((a) => (typeof a === "string" ? a : a.name)).join(", ")
        : center.amenities || "",
      is_active: center.is_active !== false,
    });
  }

  async function handleSaveCenter(e) {
    e.preventDefault();
    if (!centerModal || !selectedBarangay) return;
    if (!centerModal.name.trim()) {
      setError("Evacuation center name is required.");
      return;
    }
    if (!centerModal.barangay_ids || !centerModal.barangay_ids.length) {
      setError("Select at least one barangay served by this center.");
      return;
    }

    try {
      setSavingCenter(true);
      setError("");
      const payload = {
        name: centerModal.name.trim(),
        barangay_ids: centerModal.barangay_ids.map(Number),
        address: centerModal.address.trim() || selectedBarangay.name,
        capacity: Number(centerModal.capacity || 0),
        contact_number: centerModal.contact_number.trim() || null,
        building_material: centerModal.building_material.trim() || null,
        amenities: centerModal.amenities
          ? centerModal.amenities.split(",").map((s) => s.trim()).filter(Boolean)
          : [],
        is_active: Boolean(centerModal.is_active),
      };

      if (centerModal.mode === "add") {
        await api.createEvacuationCenter(payload);
        setSuccessMsg(`Evacuation center "${payload.name}" added.`);
      } else {
        await api.updateEvacuationCenter(centerModal.id, payload);
        setSuccessMsg(`Evacuation center "${payload.name}" updated.`);
      }
      setCenterModal(null);
      await invalidateEvacuationQueries(queryClient);
    } catch (err) {
      setError(err.message || "Failed to save evacuation center.");
    } finally {
      setSavingCenter(false);
    }
  }

  function openAddRoomModal(center) {
    if (!center) return;
    setError("");
    setRoomModal({
      mode: "add",
      centerId: center.id,
      centerName: center.name,
      room_name: "",
      room_type: "Individual/Family",
      family_slots: 5,
      people_spaces: 25,
      notes: "",
      is_active: true,
    });
  }

  function openEditRoomModal(center, room) {
    if (!center || !room) return;
    setError("");
    setRoomModal({
      mode: "edit",
      centerId: center.id,
      centerName: center.name,
      id: room.id,
      room_name: room.room_number || room.room_name || "",
      room_type: room.room_type || "Individual/Family",
      family_slots: room.family_slots ?? 5,
      people_spaces: room.people_spaces ?? room.capacity ?? 25,
      notes: room.notes || "",
      is_active: room.is_active !== false,
    });
  }

  async function handleSaveRoom(e) {
    e.preventDefault();
    if (!roomModal) return;
    if (!roomModal.room_name.trim()) {
      setError("Room name is required.");
      return;
    }
    if (!Number.isInteger(Number(roomModal.family_slots)) || Number(roomModal.family_slots) < 1) {
      setError("Family slots must be a whole number of at least 1.");
      return;
    }
    if (!Number.isInteger(Number(roomModal.people_spaces)) || Number(roomModal.people_spaces) < 25) {
      setError("People spaces must be a whole number of at least 25.");
      return;
    }

    try {
      setSavingRoom(true);
      setError("");
      if (roomModal.mode === "add") {
        await api.addRoom(roomModal.centerId, {
          room_number: roomModal.room_name.trim(),
          room_type: roomModal.room_type,
          family_slots: Number(roomModal.family_slots),
          people_spaces: Number(roomModal.people_spaces),
          notes: roomModal.notes.trim() || null,
        });
        setSuccessMsg(`${formatRoomLabel(roomModal.room_name.trim())} added to ${roomModal.centerName}.`);
      } else {
        await api.updateRoom(roomModal.id, {
          room_number: roomModal.room_name.trim(),
          room_type: roomModal.room_type,
          family_slots: Number(roomModal.family_slots),
          people_spaces: Number(roomModal.people_spaces),
          notes: roomModal.notes.trim() || null,
          is_active: Boolean(roomModal.is_active),
        });
        setSuccessMsg(`${formatRoomLabel(roomModal.room_name.trim())} updated.`);
      }
      setRoomModal(null);
      await invalidateEvacuationQueries(queryClient);
    } catch (err) {
      setError(err.message || "Failed to save room.");
    } finally {
      setSavingRoom(false);
    }
  }

  // Assign or Transfer Household from Center/Room screens
  function getBmRoomRemaining(r) {
    if (!r) return 0;
    const cap = Number(r.capacity || 0);
    if (r.unassigned != null) return Math.max(Number(r.unassigned), 0);
    const assigned = Number(r.assigned ?? r.assigned_count ?? r.occupied ?? 0);
    return Math.max(cap - assigned, 0);
  }

  function getBmCenterRemaining(c) {
    if (!c) return 0;
    const cap = Number(c.capacity || 0);
    if (c.unassigned != null) return Math.max(Number(c.unassigned), 0);
    const assigned = Number(
      c.assigned ?? c.total_assigned ?? c.occupied ?? c.current_occupancy ?? 0
    );
    return Math.max(cap - assigned, 0);
  }

  function isBmDirectCenter(c) {
    if (!c) return false;
    return resolveCenterStructureMode(c) === "open_area";
  }

  function bmCenterHasBuildings(c) {
    if (!c || resolveCenterStructureMode(c) !== "buildings_and_rooms") return false;
    if (Array.isArray(c.buildings) && c.buildings.length > 0) return true;
    const activeRooms = (c.rooms || []).filter((r) => r.is_active !== false);
    return activeRooms.some((r) => r.building_id != null);
  }

  function getBmAvailableBuildings(c, needed = 1) {
    if (!c) return [];
    const activeRooms = (c.rooms || []).filter((r) => r.is_active !== false);
    const bldgMap = new Map();
    for (const b of c.buildings || []) {
      if (b?.id != null && b.status !== "closed" && b.status !== "under_repair") {
        bldgMap.set(String(b.id), {
          id: String(b.id),
          name: b.name || `Building #${b.id}`,
          rooms: [],
          availableSpaces: 0,
        });
      }
    }
    for (const r of activeRooms) {
      if (r.building_id != null) {
        const key = String(r.building_id);
        if (!bldgMap.has(key)) {
          bldgMap.set(key, {
            id: key,
            name: r.building_name || `Building #${r.building_id}`,
            rooms: [],
            availableSpaces: 0,
          });
        }
        const rem = getBmRoomRemaining(r);
        if (rem >= needed) {
          const entry = bldgMap.get(key);
          entry.rooms.push(r);
          entry.availableSpaces += rem;
        }
      }
    }
    const list = Array.from(bldgMap.values()).filter((b) => b.rooms.length > 0);
    const unmappedRooms = activeRooms.filter(
      (r) => r.building_id == null && getBmRoomRemaining(r) >= needed
    );
    if (unmappedRooms.length > 0) {
      const unmappedSpaces = unmappedRooms.reduce(
        (sum, r) => sum + getBmRoomRemaining(r),
        0
      );
      list.push({
        id: "unmapped",
        name: "Other / Unassigned Building Rooms",
        rooms: unmappedRooms,
        availableSpaces: unmappedSpaces,
      });
    }
    return list;
  }

  function openAssignHouseholdToRoomModal(center, room = null) {
    setError("");
    setRoomAssignModal({
      mode: "assign-to-room",
      familyId: "",
      centerId: center ? String(center.id) : "",
      buildingId:
        room?.building_id != null
          ? String(room.building_id)
          : room && center && bmCenterHasBuildings(center)
            ? "unmapped"
            : "",
      roomId: room ? String(room.id) : "",
      familyObj: null,
    });
  }

  function openTransferHouseholdModal(familyItem, currentCenterId, currentRoomId) {
    setError("");
    setRoomAssignModal({
      mode: "transfer-household",
      familyId: String(familyItem.family_id || familyItem.id),
      centerId: currentCenterId ? String(currentCenterId) : "",
      buildingId: "",
      roomId: currentRoomId ? String(currentRoomId) : "",
      familyObj: familyItem,
    });
  }

  async function handleConfirmRoomAssign(e) {
    e.preventDefault();
    if (!roomAssignModal?.familyId || !roomAssignModal?.centerId) {
      setError("Please select both a family and an evacuation center.");
      return;
    }

    const selectedCenter = centers.find(
      (c) => Number(c.id) === Number(roomAssignModal.centerId)
    );
    const isDirect = isBmDirectCenter(selectedCenter);
    const hasBldgs = bmCenterHasBuildings(selectedCenter);

    if (isDirect) {
      const rem = getBmCenterRemaining(selectedCenter);
      const cap = Number(selectedCenter?.capacity || 0);
      const fam = (selectedBarangay?.families || []).find((f) => Number(f.id) === Number(roomAssignModal.familyId)) || roomAssignModal.familyObj;
      const needed = Number(fam?.member_count || fam?.resident_count || 1);
      if (cap <= 0 || rem <= 0 || rem < needed) {
        setError(`Selected center only has ${rem} spaces left (needs ${needed}).`);
        return;
      }
    } else {
      if (hasBldgs && !roomAssignModal.buildingId) {
        setError("Please select a building first.");
        return;
      }
      if (!roomAssignModal.roomId) {
        setError("Please select a destination room.");
        return;
      }
      const chosenRoom = (selectedCenter?.rooms || []).find((r) => Number(r.id) === Number(roomAssignModal.roomId));
      if (chosenRoom) {
        const rRem = getBmRoomRemaining(chosenRoom);
        const fam = (selectedBarangay?.families || []).find((f) => Number(f.id) === Number(roomAssignModal.familyId)) || roomAssignModal.familyObj;
        const needed = Number(fam?.member_count || fam?.resident_count || 1);
        if (Number(chosenRoom.capacity || 0) <= 0 || rRem <= 0 || rRem < needed) {
          setError(`Selected room only has ${rRem} spaces left (needs ${needed}).`);
          return;
        }
      }
    }

    try {
      setAssigningHousehold(true);
      setError("");
      const famId = Number(roomAssignModal.familyId);
      const centerId = Number(roomAssignModal.centerId);
      const rmId = isDirect ? null : Number(roomAssignModal.roomId);

      // Determine if household is already assigned
      const barangayFamilies = selectedBarangay?.families || [];
      const foundFam = barangayFamilies.find((f) => Number(f.id) === famId);
      const isAlreadyAssigned =
        roomAssignModal.mode === "transfer-household" ||
        foundFam?.assignment_status === "Assigned";

      if (isAlreadyAssigned) {
        await api.moveFamily(famId, {
          center_id: centerId || undefined,
          room_id: rmId,
        });
        setSuccessMsg(
          isDirect
            ? "Family transferred to the selected center."
            : "Family transferred to the selected room."
        );
      } else {
        await api.assignFamily(famId, {
          center_id: centerId || undefined,
          room_id: rmId,
        });
        setSuccessMsg(
          isDirect
            ? "Family assigned to the selected center."
            : "Family assigned to the selected room."
        );
      }

      setRoomAssignModal(null);
      await invalidateEvacuationQueries(queryClient);
    } catch (err) {
      setError(err.message || "Failed to assign family.");
    } finally {
      setAssigningHousehold(false);
    }
  }

  async function handleConfirmUnassignHousehold() {
    if (!unassignTarget) return;
    try {
      setUnassigning(true);
      setError("");
      await api.unassignFamily(unassignTarget.familyId);
      setSuccessMsg(`Family "${unassignTarget.headName}" unassigned from room.`);
      setUnassignTarget(null);
      await invalidateEvacuationQueries(queryClient);
    } catch (err) {
      setError(err.message || "Failed to unassign family.");
      setUnassignTarget(null);
    } finally {
      setUnassigning(false);
    }
  }

  // =========================================================
  // EXPORT HANDLERS
  // =========================================================

  function downloadCsv(filename, headers, rows) {
    const escapeCell = (val) => {
      const str = val === null || val === undefined ? "" : String(val);
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };
    const csvContent = [
      headers.map(escapeCell).join(","),
      ...rows.map((r) => r.map(escapeCell).join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function exportBarangaysCsv() {
    const headers = [
      "Barangay ID",
      "Barangay Name",
      "Total Families",
      "Assigned Families",
      "Unassigned Families",
      "Total Residents",
      "Evacuation Centers",
    ];
    const rows = filteredBarangays.map((b) => [
      b.id,
      b.name,
      b.family_count ?? b.total_families ?? 0,
      b.assigned_family_count ?? 0,
      b.unassigned_family_count ?? 0,
      b.resident_count ?? b.total_residents ?? 0,
      b.evacuation_center_count ?? 0,
    ]);
    downloadCsv("evacway-barangays.csv", headers, rows);
  }

  // =========================================================
  // RENDER HELPERS FOR SECTION 5 (EVACUATION CENTERS & ROOMS)
  // =========================================================

  function renderBarangayCentersSection() {
    if (centersLoading) {
      return (
        <LoadingState
          title="Loading evacuation centers..."
          subtitle={`Fetching centers and rooms in ${selectedBarangay?.name || "barangay"}.`}
          compact
        />
      );
    }

    // Sub-screen 5.3: Room Details & Assigned Households
    if (activeCenter && activeRoom) {
      const cap = Number(activeRoom.capacity || 0);
      const occ = Number(activeRoom.occupied || 0);
      const assigned = Number(activeRoom.assigned ?? activeRoom.assigned_count ?? occ);
      const avail = Math.max(0, cap - assigned);
      const isFull = occ >= cap && cap > 0;
      const isFullyAssigned = assigned >= cap && cap > 0;
      const assignedFamilies = Array.isArray(activeRoom.assigned_families)
        ? activeRoom.assigned_families
        : [];
      const isRoomAssigned = Boolean(
        activeRoom.is_assigned ||
        activeRoom.assignment_status === "Assigned" ||
        assignedFamilies.length > 0 ||
        assigned > 0 ||
        occ > 0
      );

      return (
        <div className="bm-subscreen">
          <div className="bm-sub-breadcrumb-row">
            <div className="bm-breadcrumb">
              <button
                type="button"
                className="bm-breadcrumb-link"
                onClick={() => openCentersSection(null, null)}
              >
                Evacuation Centers
              </button>
              <FontAwesomeIcon icon={faChevronRight} className="bm-breadcrumb-sep" />
              <button
                type="button"
                className="bm-breadcrumb-link"
                onClick={() => openCentersSection(activeCenter.id, null)}
              >
                {activeCenter.name}
              </button>
              <FontAwesomeIcon icon={faChevronRight} className="bm-breadcrumb-sep" />
              <span className="bm-breadcrumb-current">{activeRoom.room_name}</span>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => openCentersSection(activeCenter.id, null)}
            >
              <FontAwesomeIcon icon={faArrowLeft} /> Back to {activeCenter.name} Rooms
            </button>
          </div>

          <div className="bm-hero-card">
            <div>
              <span className="bm-kicker">{activeCenter.name} — Room Details</span>
              <div className="bm-hero-title-row">
                <h3 className="bm-hero-title">{activeRoom.room_name}</h3>
                <span className="bm-type-pill">{activeRoom.room_type || "Individual/Family"}</span>
                <span className={`bm-status-pill ${activeRoom.is_active === false
                      ? "bm-status-pill--closed"
                      : isRoomAssigned
                        ? "bm-status-pill--available"
                        : "bm-status-pill--unmapped"
                    }`}>
                  <span className="bm-status-dot" aria-hidden="true" />
                  {activeRoom.is_active === false
                    ? "Inactive"
                    : isRoomAssigned
                      ? "Available"
                      : "Unassigned"}
                </span>
              </div>
              {activeRoom.notes && <p className="bm-hero-sub">{activeRoom.notes}</p>}
            </div>

            <div className="bm-hero-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => openEditRoomModal(activeCenter, activeRoom)}
              >
                <FontAwesomeIcon icon={faPenToSquare} /> Edit Room
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={avail <= 0}
                onClick={() => openAssignHouseholdToRoomModal(activeCenter, activeRoom)}
              >
                <FontAwesomeIcon icon={faPlus} /> Assign Family
              </button>
            </div>
          </div>

          <div className="stat-card-grid cols-4">
            <div className="stat-card is-plain">
              <span className="stat-card-label">Room Capacity</span>
              <strong className="stat-card-value">{cap}</strong>
              <span className="stat-card-hint">Maximum evacuees</span>
            </div>
            <div className="stat-card is-plain">
              <span className="stat-card-label">Current Occupancy</span>
              <strong className="stat-card-value">{occ}</strong>
              <span className="stat-card-hint">{occ} of {cap} here · {assigned} assigned</span>
            </div>
            <div className={`bm-stat-card ${avail > 0 ? "accent-green" : "accent-amber"}`}>
              <span className="stat-card-label">Available Slots</span>
              <strong className="stat-card-value">{avail}</strong>
              <span className="stat-card-hint">{isFull ? "Full" : isFullyAssigned ? "Fully assigned" : "Ready for assignment"}</span>
            </div>
            <div className="stat-card is-plain">
              <span className="stat-card-label">Assigned Families</span>
              <strong className="stat-card-value">{assignedFamilies.length}</strong>
              <span className="stat-card-hint">Families in this room</span>
            </div>
          </div>

          <div className="bm-section-card">
            <div className="bm-section-card-header">
              <div>
                <h4>
                  <FontAwesomeIcon icon={faPeopleGroup} /> Assigned Families ({assignedFamilies.length})
                </h4>
                <p>Manage families currently sheltered in {activeRoom.room_name}.</p>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={avail <= 0}
                onClick={() => openAssignHouseholdToRoomModal(activeCenter, activeRoom)}
              >
                <FontAwesomeIcon icon={faPlus} /> Assign Family to Room
              </button>
            </div>

            {assignedFamilies.length === 0 ? (
              <div className="bm-empty-box">
                <FontAwesomeIcon icon={faHouse} className="bm-empty-icon" />
                <h4>No Families Assigned Yet</h4>
                <p>This room has {avail} available slots ready for family assignment.</p>
                {avail > 0 && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => openAssignHouseholdToRoomModal(activeCenter, activeRoom)}
                  >
                    <FontAwesomeIcon icon={faPlus} /> Assign Family
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="bm-table-wrap bm-desktop-only">
                  <table className="bm-table">
                    <thead>
                      <tr>
                        <th>Family ID</th>
                        <th>Family Head</th>
                        <th>Members Assigned</th>
                        <th>Vulnerability Notes</th>
                        <th className="bm-th-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assignedFamilies.map((fam) => {
                        const fId = fam.family_id || fam.id;
                        return (
                          <tr key={fId}>
                            <td>
                              <span className="bm-code-badge">{formatHouseholdCode(fId)}</span>
                            </td>
                            <td>
                              <strong className="bm-cell-strong">{fam.head_of_family}</strong>
                              <div style={{ marginTop: 4 }}>
                                <span
                                  style={{
                                    display: "inline-block",
                                    fontSize: "10.5px",
                                    fontWeight: 600,
                                    padding: "2px 8px",
                                    borderRadius: "999px",
                                    background: fam.is_checked_in ? "#dcfce7" : "#f1f5f9",
                                    color: fam.is_checked_in ? "#166534" : "#64748b",
                                    border: `1px solid ${fam.is_checked_in ? "#bbf7d0" : "#e2e8f0"}`
                                  }}
                                >
                                  {fam.checkin_status || (fam.is_checked_in ? "Checked in" : "Not yet arrived")}
                                </span>
                              </div>
                            </td>
                            <td>
                              <span className="bm-count-badge">
                                {fam.assigned || fam.member_count || fam.occupied || 1} person(s)
                              </span>
                            </td>
                            <td>
                              {fam.vulnerable_members ? (
                                <span className="bm-vuln-pill">{fam.vulnerable_members}</span>
                              ) : (
                                <span className="bm-muted">None recorded</span>
                              )}
                            </td>
                            <td className="bm-td-right">
                              <div className="bm-action-group">
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => openHouseholdsSection({ familyId: fId })}
                                >
                                  <FontAwesomeIcon icon={faEye} /> View Family
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-outline btn-sm"
                                  onClick={() =>
                                    openTransferHouseholdModal(
                                      fam,
                                      activeCenter.id,
                                      activeRoom.id
                                    )
                                  }
                                >
                                  <FontAwesomeIcon icon={faRightLeft} /> Move Room
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-danger-outline btn-sm"
                                  onClick={() =>
                                    setUnassignTarget({
                                      familyId: fId,
                                      headName: fam.head_of_family,
                                    })
                                  }
                                >
                                  <FontAwesomeIcon icon={faUserXmark} /> Unassign
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="bm-mobile-stack bm-mobile-only">
                  {assignedFamilies.map((fam) => {
                    const fId = fam.family_id || fam.id;
                    return (
                      <div key={fId} className="bm-mobile-card">
                        <div className="bm-mobile-card-top">
                          <div>
                            <span className="bm-code-badge">{formatHouseholdCode(fId)}</span>
                            <h5 className="bm-mobile-card-title">{fam.head_of_family}</h5>
                          </div>
                          <span className="bm-count-badge">
                            {fam.occupied || fam.member_count || 1} members
                          </span>
                        </div>
                        {fam.vulnerable_members && (
                          <div className="bm-mobile-card-meta">
                            <span>Vulnerability:</span>
                            <strong>{fam.vulnerable_members}</strong>
                          </div>
                        )}
                        <div className="bm-mobile-card-actions">
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => openHouseholdsSection({ familyId: fId })}
                          >
                            <FontAwesomeIcon icon={faEye} /> View
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            onClick={() =>
                              openTransferHouseholdModal(
                                fam,
                                activeCenter.id,
                                activeRoom.id
                              )
                            }
                          >
                            <FontAwesomeIcon icon={faRightLeft} /> Move
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger-outline btn-sm"
                            onClick={() =>
                              setUnassignTarget({
                                familyId: fId,
                                headName: fam.head_of_family,
                              })
                            }
                          >
                            <FontAwesomeIcon icon={faUserXmark} /> Unassign
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      );
    }

    // Sub-screen 5.2: Evacuation Center Details & Room List
    if (activeCenter) {
      const rooms = Array.isArray(activeCenter.rooms) ? activeCenter.rooms : [];
      const totalCap = Number(
        activeCenter.capacity ||
        rooms.reduce((acc, r) => acc + Number(r.capacity || 0), 0)
      );
      const totalOcc = Number(
        activeCenter.occupied ??
        rooms.reduce((acc, r) => acc + Number(r.occupied || 0), 0)
      );
      const totalAssigned = Number(
        activeCenter.assigned ??
        activeCenter.total_assigned ??
        rooms.reduce((acc, r) => acc + Number(r.assigned ?? r.assigned_count ?? r.occupied ?? 0), 0)
      );
      const totalAvail = Math.max(0, totalCap - totalAssigned);

      return (
        <div className="bm-subscreen">
          <div className="bm-sub-breadcrumb-row">
            <div className="bm-breadcrumb">
              <button
                type="button"
                className="bm-breadcrumb-link"
                onClick={() => openCentersSection(null, null)}
              >
                Evacuation Centers
              </button>
              <FontAwesomeIcon icon={faChevronRight} className="bm-breadcrumb-sep" />
              <span className="bm-breadcrumb-current">{activeCenter.name}</span>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => openCentersSection(null, null)}
            >
              <FontAwesomeIcon icon={faArrowLeft} /> Back to Evacuation Centers
            </button>
          </div>

          <div className="bm-hero-card">
            <div>
              <span className="bm-kicker">Evacuation Center Details</span>
              <div className="bm-hero-title-row">
                <h3 className="bm-hero-title">{activeCenter.name}</h3>
                <span
                  className={`bm-status-pill ${activeCenter.is_active === false
                      ? "inactive"
                      : totalAvail <= 0 && totalCap > 0
                        ? "full"
                        : "available"
                    }`}
                >
                  {activeCenter.is_active === false
                    ? "Inactive"
                    : totalAvail <= 0 && totalCap > 0
                      ? "Full"
                      : "Available"}
                </span>
              </div>
              <p className="bm-hero-sub">
                <FontAwesomeIcon icon={faLocationDot} />{" "}
                {activeCenter.address || selectedBarangay?.name}
                {activeCenter.building_material
                  ? ` • Material: ${activeCenter.building_material}`
                  : ""}
                {activeCenter.contact_number
                  ? ` • Contact: ${activeCenter.contact_number}`
                  : ""}
              </p>
            </div>
            <div className="bm-hero-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => openEditCenterModal(activeCenter)}
              >
                <FontAwesomeIcon icon={faPenToSquare} /> Edit Center
              </button>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => openAssignHouseholdToRoomModal(activeCenter, null)}
              >
                <FontAwesomeIcon icon={faRightLeft} /> Assign Family
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => openAddRoomModal(activeCenter)}
              >
                <FontAwesomeIcon icon={faPlus} /> Add Room
              </button>
            </div>
          </div>

          <div className="stat-card-grid cols-4">
            <div className="stat-card is-plain">
              <span className="stat-card-label">Total Rooms</span>
              <strong className="stat-card-value">{rooms.length}</strong>
              <span className="stat-card-hint">Configured rooms</span>
            </div>
            <div className="stat-card is-plain">
              <span className="stat-card-label">Total Capacity</span>
              <strong className="stat-card-value">{totalCap}</strong>
              <span className="stat-card-hint">Maximum center capacity</span>
            </div>
            <div className="stat-card is-plain">
              <span className="stat-card-label">Current Occupancy</span>
              <strong className="stat-card-value">{totalOcc}</strong>
              <span className="stat-card-hint">{totalOcc} of {totalCap} here · {totalAssigned} assigned</span>
            </div>
            <div className={`bm-stat-card ${totalAvail > 0 ? "accent-green" : "accent-amber"}`}>
              <span className="stat-card-label">Available Capacity</span>
              <strong className="stat-card-value">{totalAvail}</strong>
              <span className="stat-card-hint">Remaining slots</span>
            </div>
          </div>

          <div className="bm-section-card">
            <div className="bm-section-card-header">
              <div>
                <h4>
                  <FontAwesomeIcon icon={faDoorOpen} /> Rooms in {activeCenter.name} ({rooms.length})
                </h4>
                <p>Select a room to view its assigned families, transfer families, or manage capacity.</p>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => openAddRoomModal(activeCenter)}
              >
                <FontAwesomeIcon icon={faPlus} /> Add Room
              </button>
            </div>

            {rooms.length === 0 ? (
              <div className="bm-empty-box">
                <FontAwesomeIcon icon={faDoorOpen} className="bm-empty-icon" />
                <h4>No Rooms Configured Yet</h4>
                <p>Add rooms to {activeCenter.name} so families can be assigned to specific rooms.</p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => openAddRoomModal(activeCenter)}
                >
                  <FontAwesomeIcon icon={faPlus} /> Add First Room
                </button>
              </div>
            ) : (
              <>
                <div className="bm-table-wrap bm-desktop-only">
                  <table className="bm-table">
                    <thead>
                      <tr>
                        <th>Room Name</th>
                        <th>Type</th>
                        <th>Capacity</th>
                        <th>Occupied</th>
                        <th>Available Slots</th>
                        <th>Families</th>
                        <th className="bm-th-status">STATUS</th>
                        <th className="bm-th-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rooms.map((rm) => {
                        const rCap = Number(rm.capacity || 0);
                        const rOcc = Number(rm.occupied || 0);
                        const rAssigned = Number(rm.assigned ?? rm.assigned_count ?? rOcc);
                        const rAvail = Math.max(0, rCap - rAssigned);
                        const rFull = rOcc >= rCap && rCap > 0;
                        const famCount = Array.isArray(rm.assigned_families)
                          ? rm.assigned_families.length
                          : 0;
                        const isRoomAssigned = Boolean(
                          rm.is_assigned ||
                          rm.assignment_status === "Assigned" ||
                          famCount > 0 ||
                          rAssigned > 0 ||
                          rOcc > 0
                        );

                        return (
                          <tr key={rm.id}>
                            <td>
                              <strong className="bm-cell-strong">{rm.room_name}</strong>
                              {rm.notes && <div className="bm-cell-sub">{rm.notes}</div>}
                            </td>
                            <td>
                              <span className="bm-type-pill">
                                {rm.room_type || "Individual/Family"}
                              </span>
                            </td>
                            <td>{rCap}</td>
                            <td>{rOcc} of {rCap} here · {rAssigned} assigned</td>
                            <td>
                              <strong className={rAvail > 0 ? "text-green" : "text-amber"}>
                                {rAvail}
                              </strong>
                            </td>
                            <td>
                              <span className="bm-count-badge">{famCount}</span>
                            </td>
                            <td>
                              <span className={`bm-status-pill ${rm.is_active === false
                                  ? "bm-status-pill--closed"
                                  : isRoomAssigned
                                    ? "bm-status-pill--available"
                                    : "bm-status-pill--unmapped"
                                }`}>
                                <span className="bm-status-dot" aria-hidden="true" />
                                {rm.is_active === false
                                  ? "Inactive"
                                  : isRoomAssigned
                                    ? "Available"
                                    : "Unassigned"}
                              </span>
                            </td>
                            <td className="bm-td-right">
                              <div className="bm-action-group">
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm"
                                  onClick={() => openCentersSection(activeCenter.id, rm.id)}
                                >
                                  <FontAwesomeIcon icon={faEye} /> View Room
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-outline btn-sm"
                                  disabled={rAvail <= 0}
                                  onClick={() =>
                                    openAssignHouseholdToRoomModal(activeCenter, rm)
                                  }
                                >
                                  <FontAwesomeIcon icon={faPlus} /> Assign
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => openEditRoomModal(activeCenter, rm)}
                                >
                                  <FontAwesomeIcon icon={faPenToSquare} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="bm-mobile-stack bm-mobile-only">
                  {rooms.map((rm) => {
                    const rCap = Number(rm.capacity || 0);
                    const rOcc = Number(rm.occupied || 0);
                    const rAvail = Math.max(0, rCap - rOcc);
                    const rFull = rAvail <= 0 && rCap > 0;
                    const famCount = Array.isArray(rm.assigned_families)
                      ? rm.assigned_families.length
                      : 0;
                    const isRoomAssigned = Boolean(
                      rm.is_assigned ||
                      rm.assignment_status === "Assigned" ||
                      famCount > 0 ||
                      rOcc > 0
                    );

                    return (
                      <div key={rm.id} className="bm-mobile-card">
                        <div className="bm-mobile-card-top">
                          <div>
                            <span className="bm-type-pill">
                              {rm.room_type || "Individual/Family"}
                            </span>
                            <h5 className="bm-mobile-card-title">{rm.room_name}</h5>
                          </div>
                          <span className={`bm-status-pill ${rm.is_active === false
                                ? "bm-status-pill--closed"
                                : isRoomAssigned
                                  ? "bm-status-pill--available"
                                  : "bm-status-pill--unmapped"
                            }`}>
                            <span className="bm-status-dot" aria-hidden="true" />
                            {rm.is_active === false
                              ? "Inactive"
                              : isRoomAssigned
                                ? "Available"
                                : "Unassigned"}
                          </span>
                        </div>
                        <div className="bm-mobile-card-grid">
                          <div>
                            <span>Capacity</span>
                            <strong>{rCap}</strong>
                          </div>
                          <div>
                            <span>Occupied</span>
                            <strong>{rOcc}</strong>
                          </div>
                          <div>
                            <span>Available</span>
                            <strong>{rAvail}</strong>
                          </div>
                          <div>
                            <span>Families</span>
                            <strong>{famCount}</strong>
                          </div>
                        </div>
                        <div className="bm-mobile-card-actions">
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => openCentersSection(activeCenter.id, rm.id)}
                          >
                            <FontAwesomeIcon icon={faEye} /> View Room
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            disabled={rAvail <= 0}
                            onClick={() => openAssignHouseholdToRoomModal(activeCenter, rm)}
                          >
                            <FontAwesomeIcon icon={faPlus} /> Assign
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => openEditRoomModal(activeCenter, rm)}
                          >
                            <FontAwesomeIcon icon={faPenToSquare} /> Edit
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      );
    }

    // Sub-screen 5.1: Evacuation Centers List in Selected Barangay
    return (
      <div className="bm-subscreen">
        <div className="bm-hero-card">
          <div>
            <span className="bm-kicker">{selectedBarangay?.name} — Evacuation Facilities</span>
            <h3 className="bm-hero-title">Evacuation Centers & Rooms</h3>
            <p className="bm-hero-sub">
              Manage evacuation centers, room capacities, and family room assignments in{" "}
              {selectedBarangay?.name}.
            </p>
          </div>
          <div className="bm-hero-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={openAddCenterModal}
            >
              <FontAwesomeIcon icon={faPlus} /> Add Evacuation Center
            </button>
          </div>
        </div>

        <div className="stat-card-grid cols-4">
          <div className="stat-card is-plain">
            <span className="stat-card-label">Evacuation Centers</span>
            <strong className="stat-card-value">{centers.length}</strong>
            <span className="stat-card-hint">Facilities in barangay</span>
          </div>
          <div className="stat-card is-plain">
            <span className="stat-card-label">Total Rooms</span>
            <strong className="stat-card-value">{selectedBarangayStats.totalRooms}</strong>
            <span className="stat-card-hint">Across all centers</span>
          </div>
          <div className="stat-card is-plain">
            <span className="stat-card-label">Current Occupancy</span>
            <strong className="stat-card-value">
              {selectedBarangayStats.totalOccupied} / {selectedBarangayStats.totalCapacity}
            </strong>
            <span className="stat-card-hint">Assigned evacuees</span>
          </div>
          <div className="bm-stat-card accent-green">
            <span className="stat-card-label">Available Capacity</span>
            <strong className="stat-card-value">{selectedBarangayStats.totalAvailable}</strong>
            <span className="stat-card-hint">Remaining room slots</span>
          </div>
        </div>

        <div className="bm-section-card">
          <div className="bm-section-card-header">
            <div>
              <h4>
                <FontAwesomeIcon icon={faBuilding} /> Barangay Evacuation Centers ({centers.length})
              </h4>
              <p>Select an evacuation center to inspect its rooms and assigned families.</p>
            </div>
          </div>

          {centers.length === 0 ? (
            <div className="bm-empty-box">
              <FontAwesomeIcon icon={faBuilding} className="bm-empty-icon" />
              <h4>No Evacuation Centers Registered</h4>
              <p>
                There are no evacuation centers recorded for {selectedBarangay?.name} yet.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={openAddCenterModal}
              >
                <FontAwesomeIcon icon={faPlus} /> Add Evacuation Center
              </button>
            </div>
          ) : (
            <>
              <div className="bm-table-wrap bm-desktop-only">
                <table className="bm-table">
                  <thead>
                    <tr>
                      <th>Center</th>
                      <th>Rooms</th>
                      <th>Capacity</th>
                      <th>Occupancy</th>
                      <th className="bm-th-status">STATUS</th>
                      <th className="bm-th-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {centers.map((center) => {
                      const rooms = Array.isArray(center.rooms) ? center.rooms : [];
                      const cap = Number(center.capacity || 0);
                      const assignedFamilies = Number(center.barangay_assigned_families || 0);
                      const occupiedResidents = Number(
                        center.barangay_occupied ??
                        center.occupied ??
                        0
                      );
                      const assignedResidents = Number(
                        center.barangay_assigned ??
                        center.assigned ??
                        center.total_assigned ??
                        Math.max(0, cap - Number(center.barangay_available || 0))
                      );
                      const avail = Number(center.barangay_available || 0);
                      const isFull = occupiedResidents >= cap && cap > 0;

                      return (
                        <tr key={center.id}>
                          <td>
                            <strong className="bm-cell-strong">{center.name}</strong>
                            {center.address && (
                              <div className="bm-cell-sub">{center.address}</div>
                            )}
                          </td>
                          <td>
                            {center.center_type && center.center_type !== "campus" ? (
                              <span className="bm-count-badge">1 space</span>
                            ) : (
                              <span className="bm-count-badge">{rooms.length}</span>
                            )}
                          </td>
                          <td>{cap > 0 ? `${cap} people` : "—"}</td>
                          <td>
                            <div>
                              <strong className="bm-cell-strong">
                                {occupiedResidents} of {cap} here · {assignedResidents} assigned
                              </strong>
                              <div className="bm-cell-sub">
                                {assignedFamilies} family{assignedFamilies === 1 ? "" : "s"}
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className={`bm-status-pill ${center.is_active === false
                                ? "bm-status-pill--closed"
                                : isFull
                                  ? "bm-status-pill--full"
                                  : "bm-status-pill--available"
                            }`}>
                              <span className="bm-status-dot" aria-hidden="true" />
                              {center.is_active === false
                                ? "Inactive"
                                : isFull
                                  ? "Full"
                                  : "Available"}
                            </span>
                          </td>
                          <td className="bm-td-right">
                            <div className="bm-action-group">
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                onClick={() => openCentersSection(center.id, null)}
                              >
                                {center.center_type && center.center_type !== "campus"
                                  ? "View center"
                                  : "View buildings"}
                              </button>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => openEditCenterModal(center)}
                                title="Edit Center"
                              >
                                <FontAwesomeIcon icon={faPenToSquare} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="bm-mobile-stack bm-mobile-only">
                {centers.map((center) => {
                  const rooms = Array.isArray(center.rooms) ? center.rooms : [];
                  const cap = Number(center.capacity || 0);
                  const assignedFamilies = Number(center.barangay_assigned_families || 0);
                  const avail = Number(center.barangay_available || 0);
                  const isFull = avail <= 0 && rooms.length > 0;

                  return (
                    <div key={center.id} className="bm-mobile-card">
                      <div className="bm-mobile-card-top">
                        <div>
                          <h5 className="bm-mobile-card-title">{center.name}</h5>
                          <span className="bm-cell-sub">
                            {center.shared_with?.length
                              ? `Shared with: ${center.shared_with.map((barangay) => barangay.name).join(", ")}`
                              : "Not shared"}
                          </span>
                        </div>
                        <span className={`bm-status-pill ${center.is_active === false
                              ? "bm-status-pill--closed"
                              : isFull
                                ? "bm-status-pill--full"
                                : "bm-status-pill--available"
                            }`}>
                          <span className="bm-status-dot" aria-hidden="true" />
                          {center.is_active === false
                            ? "Inactive"
                            : isFull
                              ? "Full"
                              : "Available"}
                        </span>
                      </div>
                      <div className="bm-mobile-card-grid">
                        <div>
                          <span>{center.center_type && center.center_type !== "campus" ? "Space" : "Rooms"}</span>
                          <strong>{center.center_type && center.center_type !== "campus" ? "1 open space" : rooms.length}</strong>
                        </div>
                        <div>
                          <span>Capacity</span>
                          <strong>{cap}</strong>
                        </div>
                        <div>
                          <span>Assigned families here</span>
                          <strong>{assignedFamilies}</strong>
                        </div>
                        <div>
                          <span>Available</span>
                          <strong>{avail}</strong>
                        </div>
                      </div>
                      <div className="bm-mobile-card-actions">
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => openCentersSection(center.id, null)}
                        >
                          <FontAwesomeIcon icon={center.center_type && center.center_type !== "campus" ? faHouseFlag : faBuilding} />{" "}
                          {center.center_type && center.center_type !== "campus" ? "View center" : "View buildings"}
                        </button>
                        {(!center.center_type || center.center_type === "campus") && (
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            onClick={() => openAddRoomModal(center)}
                          >
                            <FontAwesomeIcon icon={faPlus} /> Add Room
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => openEditCenterModal(center)}
                        >
                          <FontAwesomeIcon icon={faPenToSquare} /> Edit
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // =========================================================
  // MAIN RENDER
  // =========================================================

  const isAllHouseholdsDetailOpen =
    !selectedBarangayId &&
    workspaceTab === "families" &&
    familyScreen !== "list";

  const isTopLevelListView =
    !selectedBarangay &&
    !isAllHouseholdsDetailOpen &&
    (workspaceTab === "barangays" || workspaceTab === "families");

  const isBarangaysListView = !selectedBarangay && workspaceTab === "barangays";

  const isBarangayHouseholdDetailOpen =
    Boolean(selectedBarangay) &&
    barangaySection === "households" &&
    familyScreen !== "list";

  function handleHeaderAddFamily() {
    if (workspaceTab === "families" && familyActionsRef.current?.openAddFamilyWizard) {
      familyActionsRef.current.openAddFamilyWizard();
      return;
    }
    setStartAddFamilyOnOpen(true);
    setFamilyScreen("list");
    setWorkspaceTab("families");
  }

  function handleHeaderExportCsv() {
    if (workspaceTab === "families") {
      familyActionsRef.current?.exportFamilies?.();
      return;
    }
    exportBarangaysCsv();
  }

  const hasActiveBarangayFilters =
    barangaySearch.trim().length > 0 || barangayStatusFilter !== "all";

  const pageRangeStart =
    filteredBarangays.length === 0 ? 0 : (safeBrgyPage - 1) * brgyPageSize + 1;
  const pageRangeEnd = Math.min(safeBrgyPage * brgyPageSize, filteredBarangays.length);

  const overviewMetrics = useMemo(() => {
    const totalHH = selectedBarangayStats.totalHouseholds;
    const assignedHH = selectedBarangayStats.assignedHouseholds;
    const unassignedHH = selectedBarangayStats.unassignedHouseholds;
    const assignPct =
      totalHH > 0 ? Math.min(100, Math.round((assignedHH / totalHH) * 100)) : 0;
    const unassignPct = totalHH > 0 ? Math.max(0, 100 - assignPct) : 0;
    const avgFamilySize =
      totalHH > 0
        ? (selectedBarangayStats.totalResidents / totalHH).toFixed(1)
        : "0";
    const radius = 54;
    const circumference = 2 * Math.PI * radius;
    const hasBoth = assignedHH > 0 && unassignedHH > 0;
    const gap = hasBoth ? 12 : 0;
    const rawAssigned = totalHH > 0 ? (assignedHH / totalHH) * circumference : 0;
    const rawUnassigned = totalHH > 0 ? Math.max(0, circumference - rawAssigned) : 0;
    const assignedArc = assignedHH > 0 ? Math.max(4, rawAssigned - gap) : 0;
    const unassignedArc = unassignedHH > 0 ? Math.max(4, rawUnassigned - gap) : 0;
    const assignedOffset = hasBoth ? -gap / 2 : 0;
    const unassignedOffset = hasBoth ? -(rawAssigned + gap / 2) : 0;

    return {
      totalHH,
      assignedHH,
      unassignedHH,
      assignPct,
      unassignPct,
      avgFamilySize,
      radius,
      circumference,
      assignedArc,
      unassignedArc,
      assignedOffset,
      unassignedOffset,
    };
  }, [selectedBarangayStats]);

  const isDetailPage =
    Boolean(selectedBarangayId) && !isBarangayHouseholdDetailOpen;

  return (
    <div
      className={`barangay-page ${
        isTopLevelListView ? "bm-list-page" : ""
      } ${isDetailPage ? "bm-detail-page" : ""}`.trim()}
    >
      {/* Top Page Header */}
      {!selectedBarangayId && !isAllHouseholdsDetailOpen && (
        <header className="bm-list-header">
          <div className="bm-list-header-copy">
            <h1 className="bm-list-title">Barangays</h1>
            <p className="bm-list-subtitle">
              Manage registered barangays, families, and shelter assignments.
            </p>
          </div>

          <div className="bm-list-header-actions">
            <Button
              variant="secondary"
              onClick={handleHeaderExportCsv}
              disabled={workspaceTab === "barangays" && filteredBarangays.length === 0}
            >
              <Download size={16} strokeWidth={2} aria-hidden="true" />
              <span>Export CSV</span>
            </Button>
            <Button variant="primary" onClick={handleHeaderAddFamily}>
              <Plus size={16} strokeWidth={2} aria-hidden="true" />
              <span>Add Family</span>
            </Button>
          </div>
        </header>
      )}

      {/* Top-Level Segmented Control: Barangays / All Families (URL-driven) */}
      {!selectedBarangayId && !isAllHouseholdsDetailOpen && (
        <div className="bm-list-mode-row">
          <SegmentedControl
            ariaLabel="Barangays workspace view"
            value={workspaceTab}
            onChange={(nextTab) => {
              setFamilyScreen("list");
              setWorkspaceTab(nextTab);
            }}
            options={[
              { value: "barangays", label: "Barangays", icon: MapPin },
              { value: "families", label: "All Families", icon: Users },
            ]}
          />
        </div>
      )}

      {/* Feedback Alerts */}
      {visibleError && !isBarangaysListView && (
        <div className="alert alert-error bm-banner-alert">
          <span className="alert-icon">
            <FontAwesomeIcon icon={faTriangleExclamation} />
          </span>
          <span>{visibleError}</span>
          <button
            type="button"
            className="bm-alert-dismiss"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="alert alert-success bm-banner-alert" role="status">
          <span className="alert-icon">
            <FontAwesomeIcon icon={faCircleCheck} />
          </span>
          <span>{successMsg}</span>
          <button
            type="button"
            className="bm-alert-dismiss"
            aria-label="Dismiss message"
            onClick={() => setSuccessMsg("")}
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
      )}

      {/* Global All-Families Directory Tab */}
      {workspaceTab === "families" && !selectedBarangayId ? (
        <FamilyManagement
          barangays={barangays}
          initialStartAdd={startAddFamilyOnOpen}
          onInitialStartAddConsumed={() => setStartAddFamilyOnOpen(false)}
          onRefreshParent={loadBarangays}
          hideListHeader={true}
          compactMobileAllHouseholds={true}
          onBackToBarangays={() => {
            setWorkspaceTab("barangays");
            setFamilyScreen("list");
          }}
          onScreenChange={setFamilyScreen}
          onRegisterActions={(actions) => {
            familyActionsRef.current = actions;
          }}
        />
      ) : detailLoading ? (
        <div className="bm-detail-shell" aria-busy="true" aria-label="Loading barangay details">
          <div className="bm-detail-header" aria-hidden="true">
            <span className="bm-skeleton bm-skeleton-line-sm" />
            <div className="bm-detail-header-row">
              <div className="bm-detail-heading">
                <span className="bm-skeleton bm-skeleton-detail-title" />
                <div className="bm-detail-meta-chips">
                  <span className="bm-skeleton bm-skeleton-pill" />
                  <span className="bm-skeleton bm-skeleton-pill" />
                </div>
              </div>
              <div className="bm-detail-header-actions">
                <span className="bm-skeleton bm-skeleton-btn" />
                <span className="bm-skeleton bm-skeleton-btn" />
              </div>
            </div>
            <div className="bm-detail-tabs">
              <span className="bm-skeleton bm-skeleton-tab" />
              <span className="bm-skeleton bm-skeleton-tab" />
            </div>
          </div>

          {barangaySection === "households" ? (
            <div className="bm-list-card" aria-hidden="true">
              <div className="bm-list-toolbar">
                <span className="bm-skeleton bm-skeleton-search" />
                <div className="bm-skeleton-row">
                  <span className="bm-skeleton bm-skeleton-btn" />
                  <span className="bm-skeleton bm-skeleton-btn" />
                </div>
              </div>
              {Array.from({ length: 5 }).map((_, idx) => (
                <div key={idx} className="bm-list-skeleton-row">
                  <span className="bm-skeleton bm-skeleton-line-md" />
                </div>
              ))}
            </div>
          ) : (
            <div className="bm-ov-stats-grid" aria-hidden="true">
              {Array.from({ length: 4 }).map((_, idx) => (
                <div key={idx} className="bm-skeleton-stat-card">
                  <div className="bm-skeleton-row">
                    <span className="bm-skeleton bm-skeleton-tile-sm" />
                    <span className="bm-skeleton bm-skeleton-line-sm" />
                  </div>
                  <span className="bm-skeleton bm-skeleton-val" />
                  <span className="bm-skeleton bm-skeleton-line-md" />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : selectedBarangayId && !selectedBarangay ? (
        <section className="bm-list-card" aria-label="Barangay error">
          <div className="bm-list-state" role="alert">
            <span className="bm-list-state-icon is-error" aria-hidden="true">
              <AlertTriangle size={20} strokeWidth={2} />
            </span>
            <h3>Could not load barangay</h3>
            <p>
              {selectedBarangayQuery.error?.message ||
                "This barangay record could not be found or failed to load."}
            </p>
            <div className="bm-list-footer-nav">
              <Button
                variant="secondary"
                onClick={() => selectedBarangayQuery.refetch()}
              >
                Try again
              </Button>
              <Button variant="primary" onClick={closeBarangay}>
                Back to Barangays
              </Button>
            </div>
          </div>
        </section>
      ) : !selectedBarangay ? (
        /* =========================================================
           PAGE A: BARANGAYS LIST (REDESIGNED)
           ========================================================= */
        <div className="bm-list-stack">
          {/* Attention Banner Card (hidden when unassigned === 0 or loading) */}
          {!loading && overallStats.totalUnassigned > 0 && (
            <section
              className="bm-attention-banner"
              aria-label="Unassigned families attention"
            >
              <div className="bm-attention-left">
                <span className="bm-attention-icon" aria-hidden="true">
                  <AlertTriangle size={18} strokeWidth={2} />
                </span>
                <div className="bm-attention-copy">
                  <strong className="bm-attention-title">
                    {overallStats.totalUnassigned}{" "}
                    {overallStats.totalUnassigned === 1
                      ? "family still needs a room"
                      : "families still need a room"}
                  </strong>
                  <p className="bm-attention-sub">
                    Review unassigned families and match them to an available evacuation center room.
                  </p>
                </div>
              </div>
              <Link
                to={familiesTabHref}
                className="ui-btn ui-btn--secondary bm-attention-cta"
              >
                Review families
              </Link>
            </section>
          )}

          {/* 4 StatCards */}
          {loading ? (
            <div className="bm-list-stats-grid" aria-hidden="true">
              {Array.from({ length: 4 }).map((_, idx) => (
                <div key={idx} className="bm-skeleton-stat-card">
                  <div className="bm-skeleton-row">
                    <span className="bm-skeleton bm-skeleton-tile-sm" />
                    <span className="bm-skeleton bm-skeleton-line-sm" />
                  </div>
                  <span className="bm-skeleton bm-skeleton-val" />
                  <span className="bm-skeleton bm-skeleton-line-md" />
                </div>
              ))}
            </div>
          ) : (
            <section className="bm-list-stats-grid" aria-label="Barangays summary">
              <StatCard
                icon={MapPin}
                iconTone="primary"
                label="Barangays"
                value={overallStats.totalBarangays}
                showProgress={false}
                footer={`${overallStats.totalCenters} evacuation ${
                  overallStats.totalCenters === 1 ? "center" : "centers"
                }`}
              />
              <StatCard
                icon={Users}
                iconTone="neutral"
                label="Families"
                value={overallStats.totalHouseholds}
                showProgress={false}
                footer={`${overallStats.totalResidents} registered ${
                  overallStats.totalResidents === 1 ? "resident" : "residents"
                }`}
              />
              <StatCard
                icon={CheckCircle2}
                iconTone="success"
                label="Assigned"
                value={overallStats.totalAssigned}
                of={overallStats.totalHouseholds}
                showProgress={true}
                progressValue={overallStats.totalAssigned}
                progressMax={Math.max(overallStats.totalHouseholds, 1)}
                progressVariant="completion"
                footer={`${overallStats.assignedPct}% of families sheltered`}
              />
              <StatCard
                icon={overallStats.totalUnassigned > 0 ? AlertTriangle : ShieldCheck}
                iconTone={overallStats.totalUnassigned > 0 ? "warn" : "success"}
                label="Unassigned"
                value={overallStats.totalUnassigned}
                showProgress={false}
                footer={
                  overallStats.totalUnassigned > 0
                    ? "Awaiting room assignment"
                    : "All families assigned"
                }
              />
            </section>
          )}

          {/* One Table Card (--radius-xl) */}
          <section className="bm-list-card" aria-label="Registered barangays">
            {/* Toolbar: Search + Status Select */}
            <div className="bm-list-toolbar">
              <div className="bm-list-search-wrap">
                <Search
                  size={16}
                  strokeWidth={2}
                  className="bm-list-search-icon"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  className="bm-list-search-input"
                  placeholder="Search barangays..."
                  aria-label="Search barangays"
                  value={barangaySearch}
                  onChange={(e) => {
                    setBarangaySearch(e.target.value);
                    setBrgyPage(1);
                  }}
                />
                {barangaySearch && (
                  <button
                    type="button"
                    className="bm-list-search-clear"
                    aria-label="Clear search"
                    onClick={() => {
                      setBarangaySearch("");
                      setBrgyPage(1);
                    }}
                  >
                    <X size={15} strokeWidth={2} aria-hidden="true" />
                  </button>
                )}
              </div>

              <MobileFilterButton
                activeCount={barangayStatusFilter !== "all" ? 1 : 0}
                title="Filter barangays"
                onReset={() => {
                  setBarangayStatusFilter("all");
                  setBrgyPage(1);
                }}
              >
                <label className="ui-mobile-filter-field">
                  <span className="ui-mobile-filter-field__label">Status</span>
                  <select
                    aria-label="Filter by status"
                    value={barangayStatusFilter}
                    onChange={(e) => {
                      setBarangayStatusFilter(e.target.value);
                      setBrgyPage(1);
                    }}
                  >
                    <option value="all">All statuses</option>
                    <option value="sheltered">Sheltered</option>
                    <option value="unassigned">Unassigned</option>
                    <option value="no-records">No records</option>
                  </select>
                </label>
              </MobileFilterButton>

              <div className="bm-list-toolbar-right">
                <select
                  className="bm-list-select"
                  aria-label="Filter by status"
                  value={barangayStatusFilter}
                  onChange={(e) => {
                    setBarangayStatusFilter(e.target.value);
                    setBrgyPage(1);
                  }}
                >
                  <option value="all">All statuses</option>
                  <option value="sheltered">Sheltered</option>
                  <option value="unassigned">Unassigned</option>
                  <option value="no-records">No records</option>
                </select>
              </div>
            </div>

            {/* Table Content: Skeleton / Error / Empty / Rows */}
            {loading ? (
              <div className="bm-list-table-scroll" aria-busy="true" aria-label="Loading barangays">
                <div className="bm-list-grid bm-list-grid-head" aria-hidden="true">
                  <span>BARANGAY</span>
                  <span className="is-center">FAMILIES</span>
                  <span>SHELTER ASSIGNMENT</span>
                  <span>STATUS</span>
                  <span>EVACUATION CENTERS</span>
                </div>
                {Array.from({ length: 6 }).map((_, idx) => (
                  <div key={idx} className="bm-list-grid bm-list-skeleton-row" aria-hidden="true">
                    <div className="bm-list-brgy-cell">
                      <span className="bm-skeleton bm-skeleton-tile-lg" />
                      <div className="bm-skeleton-col">
                        <span className="bm-skeleton bm-skeleton-line-md" />
                        <span className="bm-skeleton bm-skeleton-line-sm" />
                      </div>
                    </div>
                    <div className="bm-list-families-cell">
                      <span className="bm-skeleton bm-skeleton-num" />
                    </div>
                    <div className="bm-skeleton-col">
                      <span className="bm-skeleton bm-skeleton-line-md" />
                      <span className="bm-skeleton bm-skeleton-bar" />
                    </div>
                    <div>
                      <span className="bm-skeleton bm-skeleton-pill" />
                    </div>
                    <div className="bm-list-centers-cell">
                      <span className="bm-skeleton bm-skeleton-pill" />
                    </div>
                  </div>
                ))}
              </div>
            ) : barangaysQuery.error || error ? (
              <div className="bm-list-state" role="alert">
                <span className="bm-list-state-icon is-error" aria-hidden="true">
                  <AlertTriangle size={20} strokeWidth={2} />
                </span>
                <h3>Could not load barangays</h3>
                <p>{visibleError || "Something went wrong while loading barangay records."}</p>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setError("");
                    barangaysQuery.refetch();
                  }}
                >
                  Try again
                </Button>
              </div>
            ) : filteredBarangays.length === 0 ? (
              <div className="bm-list-state" role="status">
                <span className="bm-list-state-icon" aria-hidden="true">
                  <MapPin size={20} strokeWidth={2} />
                </span>
                <h3>
                  {barangays.length === 0 ? "No barangays found" : "No matching barangays"}
                </h3>
                <p>
                  {barangays.length === 0
                    ? "No barangays are currently registered in the system."
                    : "Try adjusting your search or status filter to see more barangays."}
                </p>
                {hasActiveBarangayFilters && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setBarangaySearch("");
                      setBarangayStatusFilter("all");
                      setBrgyPage(1);
                    }}
                  >
                    Clear filters
                  </Button>
                )}
              </div>
            ) : (
              <>
                <div className="bm-list-table-scroll">
                  <div className="bm-list-grid bm-list-grid-head" role="row">
                    <span role="columnheader">BARANGAY</span>
                    <span role="columnheader" className="is-center">
                      FAMILIES
                    </span>
                    <span role="columnheader">SHELTER ASSIGNMENT</span>
                    <span role="columnheader">STATUS</span>
                    <span role="columnheader">EVACUATION CENTERS</span>
                  </div>

                  <div className="bm-list-rows" role="list">
                    {paginatedBarangays.map((b) => {
                      const famCount = Number(
                        b.household_count ?? b.family_count ?? b.total_families ?? 0
                      );
                      const assignedCount = Number(b.assigned_family_count ?? 0);
                      const unassignedCount = Number(
                        b.unassigned_family_count ?? Math.max(0, famCount - assignedCount)
                      );
                      const resCount = Number(
                        b.resident_count ?? b.total_residents ?? 0
                      );
                      const centerCount = Number(b.evacuation_center_count ?? 0);
                      const assignPct =
                        famCount > 0 ? Math.round((assignedCount / famCount) * 100) : 0;
                      const avgPerFamily =
                        famCount > 0 ? (resCount / famCount).toFixed(1) : "0";
                      const statusVariant =
                        famCount === 0
                          ? "no-records"
                          : unassignedCount > 0
                            ? "unassigned"
                            : "sheltered";
                      const pctToneClass =
                        assignPct >= 100
                          ? "is-complete"
                          : assignPct > 0
                            ? "is-partial"
                            : "is-zero";

                      return (
                        <button
                          key={b.id}
                          type="button"
                          role="listitem"
                          className="bm-list-grid bm-list-row"
                          aria-label={`Open ${b.name} details`}
                          onClick={() => openBarangay(b.id, "overview")}
                        >
                          {/* BARANGAY */}
                          <span className="bm-list-brgy-cell">
                            <span className="bm-list-brgy-tile" aria-hidden="true">
                              <MapPin size={18} strokeWidth={2} />
                            </span>
                            <span className="bm-list-brgy-copy">
                              <span className="bm-list-brgy-name">{b.name}</span>
                              <span className="bm-list-brgy-meta">
                                {resCount} {resCount === 1 ? "resident" : "residents"} &bull;{" "}
                                {avgPerFamily} avg per family
                              </span>
                            </span>
                          </span>

                          {/* FAMILIES */}
                          <span className="bm-list-families-cell">
                            <span className="bm-list-mobile-label">Families</span>
                            <span className="bm-list-families-num">{famCount}</span>
                          </span>

                          {/* SHELTER ASSIGNMENT */}
                          <span className="bm-list-assign-cell">
                            <span className="bm-list-assign-top">
                              <span className="bm-list-assign-text">
                                <strong>{assignedCount}</strong> of {famCount}{" "}
                                {famCount === 1 ? "family" : "families"} assigned
                              </span>
                              <span className={`bm-list-assign-pct ${pctToneClass}`}>
                                {assignPct}%
                              </span>
                            </span>
                            <ProgressBar
                              value={assignedCount}
                              max={Math.max(famCount, 1)}
                              variant="completion"
                              ariaLabel={`${b.name} shelter assignment ${assignPct}%`}
                            />
                          </span>

                          {/* STATUS */}
                          <span className="bm-list-status-cell">
                            <StatusPill variant={statusVariant} />
                          </span>

                          {/* EVACUATION CENTERS + CHEVRON */}
                          <span className="bm-list-centers-cell">
                            <span className="bm-list-center-chip">
                              <Building2 size={15} strokeWidth={2} aria-hidden="true" />
                              <span>
                                {centerCount} {centerCount === 1 ? "center" : "centers"}
                              </span>
                            </span>
                            <ChevronRight
                              size={16}
                              strokeWidth={2}
                              className="bm-list-row-chevron"
                              aria-hidden="true"
                            />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Footer: Showing X of Y + Previous / Next */}
                <footer className="bm-list-footer">
                  <span className="bm-list-footer-info">
                    {totalBrgyPages > 1
                      ? `Showing ${pageRangeStart}–${pageRangeEnd} of ${filteredBarangays.length} barangays`
                      : `Showing ${filteredBarangays.length} of ${barangays.length} ${
                          barangays.length === 1 ? "barangay" : "barangays"
                        }`}
                  </span>

                  <div className="bm-list-footer-nav">
                    <Button
                      variant="secondary"
                      className="bm-list-page-btn"
                      disabled={safeBrgyPage <= 1}
                      onClick={() => setBrgyPage((p) => Math.max(1, p - 1))}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="secondary"
                      className="bm-list-page-btn"
                      disabled={safeBrgyPage >= totalBrgyPages}
                      onClick={() => setBrgyPage((p) => Math.min(totalBrgyPages, p + 1))}
                    >
                      Next
                    </Button>
                  </div>
                </footer>
              </>
            )}
          </section>
        </div>
      ) : (
        /* =========================================================
           PAGE B: BARANGAY DETAIL
           ========================================================= */
        <div className="bm-detail-shell">
          {/* Redesigned Barangay Detail Header (Tabs live in URL: ?tab=overview | ?tab=families) */}
          {!isBarangayHouseholdDetailOpen && (
            <header className="bm-detail-header">
              {/* Breadcrumb: back arrow, Barangays > barangay name */}
              <nav className="bm-detail-breadcrumb" aria-label="Breadcrumb">
                <Link
                  to={barangaysTabHref}
                  className="bm-detail-breadcrumb-link"
                  onClick={(e) => {
                    e.preventDefault();
                    closeBarangay();
                  }}
                >
                  <ArrowLeft size={16} strokeWidth={2} aria-hidden="true" />
                  <span>Barangays</span>
                </Link>
                <ChevronRight
                  size={15}
                  strokeWidth={2}
                  className="bm-detail-breadcrumb-sep"
                  aria-hidden="true"
                />
                <span className="bm-detail-breadcrumb-current" aria-current="page">
                  {selectedBarangay.name}
                </span>
              </nav>

              {/* Title + Status Pill + Meta Chips + Actions */}
              <div className="bm-detail-header-row">
                <div className="bm-detail-heading">
                  <div className="bm-detail-title-line">
                    <h1 className="bm-detail-title">{selectedBarangay.name}</h1>
                    {selectedBarangayStats.totalHouseholds === 0 ? (
                      <StatusPill variant="no-records" label="No families yet" />
                    ) : selectedBarangayStats.unassignedHouseholds > 0 ? (
                      <StatusPill
                        variant="unassigned"
                        label={`${selectedBarangayStats.unassignedHouseholds} ${
                          selectedBarangayStats.unassignedHouseholds === 1
                            ? "family"
                            : "families"
                        } unassigned`}
                      />
                    ) : (
                      <StatusPill variant="sheltered" label="All families sheltered" />
                    )}
                  </div>

                  <div className="bm-detail-meta-chips">
                    <span className="bm-detail-meta-chip">
                      <MapPin size={14} strokeWidth={2} aria-hidden="true" />
                      <span>{selectedBarangay.municipality || "Sogod Municipality"}</span>
                    </span>
                    <span className="bm-detail-meta-chip">
                      <Calendar size={14} strokeWidth={2} aria-hidden="true" />
                      <span>Census Year {selectedBarangay.census_year || "2026"}</span>
                    </span>
                  </div>
                </div>

                <div className="bm-detail-header-actions">
                  <Button
                    variant="secondary"
                    onClick={() => familyActionsRef.current?.exportFamilies?.()}
                  >
                    <Download size={16} strokeWidth={2} aria-hidden="true" />
                    <span>Export CSV</span>
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => familyActionsRef.current?.openAddFamilyWizard?.()}
                  >
                    <Plus size={16} strokeWidth={2} aria-hidden="true" />
                    <span>Add Family</span>
                  </Button>
                </div>
              </div>

              {/* Underline Tabs: Overview & Families (URL-driven) */}
              <div
                className="bm-detail-tabs"
                role="tablist"
                aria-label="Barangay detail sections"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={barangaySection === "overview"}
                  tabIndex={barangaySection === "overview" ? 0 : -1}
                  className={`bm-detail-tab ${
                    barangaySection === "overview" ? "is-active" : ""
                  }`}
                  onClick={() => {
                    setSelectedCenterId(null);
                    setSelectedRoomId(null);
                    setFamilyScreen("list");
                    setBarangayDetailTab("overview");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                      e.preventDefault();
                      openHouseholdsSection();
                    }
                  }}
                >
                  <LayoutGrid size={16} strokeWidth={2} aria-hidden="true" />
                  <span>Overview</span>
                </button>

                <button
                  type="button"
                  role="tab"
                  aria-selected={barangaySection === "households"}
                  tabIndex={barangaySection === "households" ? 0 : -1}
                  className={`bm-detail-tab ${
                    barangaySection === "households" ? "is-active" : ""
                  }`}
                  onClick={() => openHouseholdsSection()}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                      e.preventDefault();
                      setSelectedCenterId(null);
                      setSelectedRoomId(null);
                      setFamilyScreen("list");
                      setBarangayDetailTab("overview");
                    }
                  }}
                >
                  <Users size={16} strokeWidth={2} aria-hidden="true" />
                  <span>Families</span>
                  <span className="bm-detail-tab-count">
                    {selectedBarangayStats.totalHouseholds}
                  </span>
                </button>
              </div>
            </header>
          )}

          {barangaySection === "overview" && (
            <div className="bm-ov-stack">
              {/* 4 StatCards: Families, Residents, Assigned, Unassigned */}
              <section className="bm-ov-stats-grid" aria-label="Barangay summary">
                <StatCard
                  icon={Home}
                  iconTone="primary"
                  label="Families"
                  value={overviewMetrics.totalHH}
                  showProgress={false}
                  footer={`${overviewMetrics.avgFamilySize} avg per family`}
                />
                <StatCard
                  icon={Users}
                  iconTone="neutral"
                  label="Residents"
                  value={selectedBarangayStats.totalResidents}
                  showProgress={false}
                  footer="Registered in census"
                />
                <StatCard
                  icon={CheckCircle2}
                  iconTone="success"
                  label="Assigned"
                  value={overviewMetrics.assignedHH}
                  of={overviewMetrics.totalHH}
                  showProgress={true}
                  progressValue={overviewMetrics.assignedHH}
                  progressMax={Math.max(overviewMetrics.totalHH, 1)}
                  progressVariant="completion"
                  footer={`${overviewMetrics.assignPct}% of families sheltered`}
                />
                <StatCard
                  icon={overviewMetrics.unassignedHH > 0 ? AlertTriangle : ShieldCheck}
                  iconTone={overviewMetrics.unassignedHH > 0 ? "warn" : "success"}
                  label="Unassigned"
                  value={overviewMetrics.unassignedHH}
                  showProgress={false}
                  footer={
                    overviewMetrics.unassignedHH > 0
                      ? "Still need a room"
                      : "All families assigned"
                  }
                />
              </section>

              {/* Two Columns: Shelter assignment (left) + Barangay details (right) */}
              <div className="bm-ov-grid">
                {/* Left: Shelter assignment card */}
                <section
                  className="bm-ov-card bm-ov-assignment-card"
                  aria-labelledby="bm-ov-assignment-title"
                >
                  <div className="bm-ov-card-header">
                    <h2 id="bm-ov-assignment-title" className="bm-ov-card-title">
                      Shelter assignment
                    </h2>
                    <Button
                      variant="secondary"
                      className="bm-ov-manage-btn"
                      onClick={() => openHouseholdsSection()}
                    >
                      <span>Manage families ({overviewMetrics.totalHH})</span>
                      <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
                    </Button>
                  </div>

                  {overviewMetrics.totalHH === 0 ? (
                    <div className="bm-ov-empty" role="status">
                      <span className="bm-ov-empty-icon" aria-hidden="true">
                        <Users size={20} strokeWidth={2} />
                      </span>
                      <h3>No families registered yet</h3>
                      <p>
                        The shelter assignment breakdown will appear once families are registered in{" "}
                        {selectedBarangay.name}.
                      </p>
                      <Button
                        variant="primary"
                        onClick={() => familyActionsRef.current?.openAddFamilyWizard?.()}
                      >
                        <Plus size={16} strokeWidth={2} aria-hidden="true" />
                        <span>Add Family</span>
                      </Button>
                    </div>
                  ) : (
                    <div className="bm-ov-donut-layout">
                      <div
                        className="bm-ov-donut-wrap"
                        role="img"
                        aria-label={`Shelter assignment: ${overviewMetrics.assignedHH} assigned (${overviewMetrics.assignPct}%) and ${overviewMetrics.unassignedHH} unassigned (${overviewMetrics.unassignPct}%) out of ${overviewMetrics.totalHH} families`}
                      >
                        <svg className="bm-ov-donut-svg" viewBox="0 0 140 140" aria-hidden="true">
                          <circle
                            className="bm-ov-donut-track"
                            cx="70"
                            cy="70"
                            r={overviewMetrics.radius}
                            fill="none"
                            strokeWidth="12"
                          />
                          {overviewMetrics.unassignedHH > 0 && (
                            <circle
                              className="bm-ov-donut-arc is-unassigned"
                              cx="70"
                              cy="70"
                              r={overviewMetrics.radius}
                              fill="none"
                              strokeWidth="12"
                              strokeLinecap="round"
                              strokeDasharray={`${overviewMetrics.unassignedArc} ${overviewMetrics.circumference}`}
                              strokeDashoffset={overviewMetrics.unassignedOffset}
                              transform="rotate(-90 70 70)"
                            />
                          )}
                          {overviewMetrics.assignedHH > 0 && (
                            <circle
                              className={`bm-ov-donut-arc ${
                                overviewMetrics.assignPct >= 100 ? "is-complete" : "is-assigned"
                              }`}
                              cx="70"
                              cy="70"
                              r={overviewMetrics.radius}
                              fill="none"
                              strokeWidth="12"
                              strokeLinecap="round"
                              strokeDasharray={`${overviewMetrics.assignedArc} ${overviewMetrics.circumference}`}
                              strokeDashoffset={overviewMetrics.assignedOffset}
                              transform="rotate(-90 70 70)"
                            />
                          )}
                        </svg>
                        <div className="bm-ov-donut-center" aria-hidden="true">
                          <strong className="bm-ov-donut-pct">{overviewMetrics.assignPct}%</strong>
                          <span className="bm-ov-donut-caption">Assigned</span>
                        </div>
                      </div>

                      <div className="bm-ov-legend-col">
                        <div className="bm-ov-legend-list">
                          <div className="bm-ov-legend-item">
                            <span className="bm-ov-legend-left">
                              <span
                                className={`bm-ov-legend-dot ${
                                  overviewMetrics.assignPct >= 100 ? "is-complete" : "is-assigned"
                                }`}
                                aria-hidden="true"
                              />
                              <span className="bm-ov-legend-label">Assigned</span>
                            </span>
                            <span className="bm-ov-legend-val">
                              <strong>{overviewMetrics.assignedHH}</strong>{" "}
                              <span className="bm-ov-legend-pct">
                                ({overviewMetrics.assignPct}%)
                              </span>
                            </span>
                          </div>

                          <div className="bm-ov-legend-item">
                            <span className="bm-ov-legend-left">
                              <span
                                className="bm-ov-legend-dot is-unassigned"
                                aria-hidden="true"
                              />
                              <span className="bm-ov-legend-label">Unassigned</span>
                            </span>
                            <span className="bm-ov-legend-val">
                              <strong>{overviewMetrics.unassignedHH}</strong>{" "}
                              <span className="bm-ov-legend-pct">
                                ({overviewMetrics.unassignPct}%)
                              </span>
                            </span>
                          </div>
                        </div>

                        <p className="bm-ov-legend-note">
                          {overviewMetrics.assignedHH} of {overviewMetrics.totalHH}{" "}
                          {overviewMetrics.totalHH === 1 ? "family is" : "families are"} assigned to
                          an evacuation building &amp; room.
                        </p>
                      </div>
                    </div>
                  )}
                </section>

                {/* Right: Barangay details card */}
                <aside
                  className="bm-ov-card bm-ov-details-card"
                  aria-labelledby="bm-ov-details-title"
                >
                  <div className="bm-ov-card-header">
                    <h2 id="bm-ov-details-title" className="bm-ov-card-title">
                      Barangay details
                    </h2>
                  </div>

                  <dl className="bm-ov-dl">
                    <div className="bm-ov-dl-row">
                      <dt className="bm-ov-dt">Municipality</dt>
                      <dd className="bm-ov-dd">
                        {selectedBarangay.municipality || "Sogod Municipality"}
                      </dd>
                    </div>
                    <div className="bm-ov-dl-row">
                      <dt className="bm-ov-dt">Census year</dt>
                      <dd className="bm-ov-dd">
                        {selectedBarangay.census_year || "2026"}
                      </dd>
                    </div>
                    <div className="bm-ov-dl-row">
                      <dt className="bm-ov-dt">Average family size</dt>
                      <dd className="bm-ov-dd">{overviewMetrics.avgFamilySize} members</dd>
                    </div>
                    <div className="bm-ov-dl-row">
                      <dt className="bm-ov-dt">Status</dt>
                      <dd className="bm-ov-dd">
                        <StatusPill
                          variant={
                            overviewMetrics.totalHH === 0
                              ? "no-records"
                              : overviewMetrics.unassignedHH > 0
                                ? "unassigned"
                                : "sheltered"
                          }
                        />
                      </dd>
                    </div>
                  </dl>
                </aside>
              </div>
            </div>
          )}

          <FamilyManagement
            key={`${selectedBarangay.id}-${initialFamilyIdToOpen || "list"}`}
            barangays={barangays}
            availableBuildings={barangayBuildings}
            lockedBarangayId={selectedBarangay.id}
            lockedBarangayName={selectedBarangay.name}
            initialStartAdd={startAddFamilyOnOpen}
            onInitialStartAddConsumed={() => setStartAddFamilyOnOpen(false)}
            initialFamilyId={initialFamilyIdToOpen}
            onInitialFamilyConsumed={() => setInitialFamilyIdToOpen(null)}
            onRefreshParent={loadBarangays}
            hideListHeader={true}
            compactMobileAllHouseholds={true}
            hideScreenContent={barangaySection !== "households"}
            onBackToBarangays={closeBarangay}
            onScreenChange={setFamilyScreen}
            onRegisterActions={(actions) => {
              familyActionsRef.current = actions;
            }}
          />

          {/* Retired legacy room-based center page: redirects directly to Centers tab */}
          {barangaySection === "centers" && null}
        </div>
      )}

      {/* =========================================================
         MODALS
         ========================================================= */}



      {/* Add / Edit Evacuation Center Modal */}
      {centerModal && (
        <div className="modal-overlay" onClick={() => !savingCenter && setCenterModal(null)}>
          <div className="bm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="bm-dialog-header">
              <div>
                <span className="bm-kicker">{selectedBarangay?.name}</span>
                <h4>
                  {centerModal.mode === "add"
                    ? "Add Evacuation Center"
                    : "Edit Evacuation Center"}
                </h4>
              </div>
              <button
                type="button"
                className="bm-dialog-close"
                onClick={() => setCenterModal(null)}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
            <form onSubmit={handleSaveCenter}>
              <div className="bm-dialog-body">
                <div className="bm-form-grid-2">
                  <label className="bm-form-field bm-span-2">
                    <span>Center Name *</span>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Municipal Gymnasium"
                      value={centerModal.name}
                      onChange={(e) =>
                        setCenterModal((p) => ({ ...p, name: e.target.value }))
                      }
                    />
                  </label>
                  <div className="bm-span-2">
                    <BarangaysServedPicker
                      barangays={barangays}
                      selectedIds={centerModal.barangay_ids}
                      onChange={(selectedIds) =>
                        setCenterModal((p) => ({ ...p, barangay_ids: selectedIds }))
                      }
                      onBeforeDeselect={(bId, bName) => {
                        const linkedFams = (centerModal.rooms || []).flatMap(
                          (r) => r.assigned_families || r.families || []
                        );
                        const affectedCount = linkedFams.filter(
                          (f) => String(f.barangay_id) === String(bId) || f.barangay === bName
                        ).length;
                        if (affectedCount > 0) {
                          return window.confirm(
                            `Removing "${bName}" will affect ${affectedCount} family(s) currently assigned to this center. Do you want to remove it?`
                          );
                        }
                        return true;
                      }}
                      required
                    />
                  </div>
                  <label className="bm-form-field">
                    <span>Address / Location *</span>
                    <input
                      type="text"
                      required
                      value={centerModal.address}
                      onChange={(e) =>
                        setCenterModal((p) => ({ ...p, address: e.target.value }))
                      }
                    />
                  </label>
                  <label className="bm-form-field">
                    <span>Total Capacity</span>
                    <input
                      type="number"
                      min="0"
                      value={centerModal.capacity}
                      onChange={(e) =>
                        setCenterModal((p) => ({ ...p, capacity: e.target.value }))
                      }
                    />
                  </label>
                  <label className="bm-form-field">
                    <span>Contact Number</span>
                    <input
                      type="text"
                      placeholder="09XX-XXX-XXXX"
                      value={centerModal.contact_number}
                      onChange={(e) =>
                        setCenterModal((p) => ({
                          ...p,
                          contact_number: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="bm-form-field">
                    <span>Building Material</span>
                    <input
                      type="text"
                      placeholder="e.g. Reinforced Concrete"
                      value={centerModal.building_material}
                      onChange={(e) =>
                        setCenterModal((p) => ({
                          ...p,
                          building_material: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="bm-form-field bm-span-2">
                    <span>Amenities</span>
                    <input
                      type="text"
                      placeholder="Wheelchair Ramps, PWD Restrooms, etc."
                      value={centerModal.amenities}
                      onChange={(e) =>
                        setCenterModal((p) => ({
                          ...p,
                          amenities: e.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
              </div>
              <div className="bm-dialog-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={savingCenter}
                  onClick={() => setCenterModal(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={savingCenter}
                >
                  {savingCenter ? "Saving..." : "Save Evacuation Center"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add / Edit Room Modal */}
      {roomModal && (
        <div className="modal-overlay" onClick={() => !savingRoom && setRoomModal(null)}>
          <div className="bm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="bm-dialog-header">
              <div>
                <span className="bm-kicker">{roomModal.centerName}</span>
                <h4>{roomModal.mode === "add" ? "Add Room" : "Edit Room"}</h4>
              </div>
              <button
                type="button"
                className="bm-dialog-close"
                onClick={() => setRoomModal(null)}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
            <form onSubmit={handleSaveRoom}>
              <div className="bm-dialog-body">
                {error && <div className="alert-error" role="alert">{error}</div>}
                <div className="bm-form-grid-2">
                  <label className="bm-form-field">
                    <span>Room Name *</span>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Room 101"
                      value={roomModal.room_name}
                      onChange={(e) =>
                        setRoomModal((p) => ({ ...p, room_name: e.target.value }))
                      }
                    />
                  </label>
                  <label className="bm-form-field">
                    <span>Room Type</span>
                    <select
                      value={roomModal.room_type}
                      onChange={(e) =>
                        setRoomModal((p) => ({ ...p, room_type: e.target.value }))
                      }
                    >
                      <option value="Individual/Family">Individual/Family</option>
                      <option value="Group">Group</option>
                      <option value="Special Needs">Special Needs</option>
                    </select>
                  </label>
                  <label className="bm-form-field">
                    <span>Family slots *</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      inputMode="numeric"
                      required
                      onKeyDown={(e) => ["e", "E", "+", "-", ".", ","].includes(e.key) && e.preventDefault()}
                      value={roomModal.family_slots}
                      onChange={(e) =>
                        setRoomModal((p) => ({ ...p, family_slots: e.target.value }))
                      }
                    />
                  </label>
                  <label className="bm-form-field">
                    <span>People spaces *</span>
                    <input
                      type="number"
                      min="25"
                      step="1"
                      inputMode="numeric"
                      required
                      onKeyDown={(e) => ["e", "E", "+", "-", ".", ","].includes(e.key) && e.preventDefault()}
                      value={roomModal.people_spaces}
                      onChange={(e) =>
                        setRoomModal((p) => ({ ...p, people_spaces: e.target.value }))
                      }
                    />
                  </label>
                  <label className="bm-form-field">
                    <span>Status</span>
                    <select
                      value={roomModal.is_active ? "active" : "inactive"}
                      onChange={(e) =>
                        setRoomModal((p) => ({
                          ...p,
                          is_active: e.target.value === "active",
                        }))
                      }
                    >
                      <option value="active">Active / Available</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </label>
                  <label className="bm-form-field bm-span-2">
                    <span>Notes</span>
                    <input
                      type="text"
                      placeholder="Optional room notes or equipment"
                      value={roomModal.notes}
                      onChange={(e) =>
                        setRoomModal((p) => ({ ...p, notes: e.target.value }))
                      }
                    />
                  </label>
                </div>
              </div>
              <div className="bm-dialog-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={savingRoom}
                  onClick={() => setRoomModal(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={savingRoom}>
                  {savingRoom ? "Saving..." : "Save Room"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assign or Transfer Household Modal */}
      {roomAssignModal && (() => {
        const barangayFamilies = selectedBarangay?.families || [];
        const selectedFam =
          barangayFamilies.find(
            (f) => String(f.id) === String(roomAssignModal.familyId)
          ) || roomAssignModal.familyObj;
        const needed = Number(
          selectedFam?.member_count ?? selectedFam?.resident_count ?? 1
        );
        const selectedModalCenter = centers.find(
          (c) => Number(c.id) === Number(roomAssignModal.centerId)
        );
        const isDirect = isBmDirectCenter(selectedModalCenter);
        const hasBldgs = bmCenterHasBuildings(selectedModalCenter);
        const availableBldgs = getBmAvailableBuildings(
          selectedModalCenter,
          needed
        );
        const activeRooms = (selectedModalCenter?.rooms || []).filter(
          (r) => r.is_active !== false
        );
        const filteredModalRooms = activeRooms.filter((r) => {
          const rem = getBmRoomRemaining(r);
          if (rem < needed) return false;
          if (!hasBldgs) return true;
          if (!roomAssignModal.buildingId) return false;
          if (roomAssignModal.buildingId === "unmapped")
            return r.building_id == null;
          return String(r.building_id) === String(roomAssignModal.buildingId);
        });
        const availableCenters = centers.filter(
          (c) =>
            c.is_active !== false &&
            (getBmCenterRemaining(c) >= needed ||
              String(c.id) === String(roomAssignModal.centerId))
        );

        return (
          <div
            className="modal-overlay"
            onClick={() => !assigningHousehold && setRoomAssignModal(null)}
          >
            <div className="bm-dialog" onClick={(e) => e.stopPropagation()}>
              <div className="bm-dialog-header">
                <div>
                  <span className="bm-kicker">Evacuation Assignment</span>
                  <h4>
                    {roomAssignModal.mode === "transfer-household"
                      ? "Transfer Family"
                      : "Assign Family"}
                  </h4>
                </div>
                <button
                  type="button"
                  className="bm-dialog-close"
                  onClick={() => setRoomAssignModal(null)}
                >
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              </div>
              <form onSubmit={handleConfirmRoomAssign}>
                <div className="bm-dialog-body">
                  <label className="bm-form-field">
                    <span>Family *</span>
                    <select
                      required
                      value={roomAssignModal.familyId}
                      disabled={roomAssignModal.mode === "transfer-household"}
                      onChange={(e) =>
                        setRoomAssignModal((p) => ({
                          ...p,
                          familyId: e.target.value,
                        }))
                      }
                    >
                      <option value="">
                        Select family in {selectedBarangay?.name}
                      </option>
                      {barangayFamilies.map((f) => (
                        <option key={f.id} value={f.id}>
                          {formatHouseholdCode(f.id)} —{" "}
                          {f.head_of_family || f.head_name} (
                          {f.member_count || f.resident_count || 1} members) •{" "}
                          {f.assignment_status}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="bm-form-field">
                    <span>Evacuation Center *</span>
                    <select
                      required
                      value={roomAssignModal.centerId}
                      onChange={(e) =>
                        setRoomAssignModal((p) => ({
                          ...p,
                          centerId: e.target.value,
                          buildingId: "",
                          roomId: "",
                        }))
                      }
                    >
                      <option value="">Select evacuation center</option>
                      {availableCenters.map((c) => {
                        const rem = getBmCenterRemaining(c);
                        return (
                          <option key={c.id} value={c.id}>
                            {c.name} ({rem} spaces left)
                          </option>
                        );
                      })}
                    </select>
                  </label>

                  {selectedModalCenter && isDirect ? (
                    <div className="bm-form-field">
                      <span>Center Capacity</span>
                      <p style={{ margin: "0.25rem 0 0", fontSize: "0.875rem" }}>
                        Direct assignment to{" "}
                        <strong>{selectedModalCenter.name}</strong> —{" "}
                        {getBmCenterRemaining(selectedModalCenter)} of{" "}
                        {selectedModalCenter.capacity || 0} spaces remaining.
                      </p>
                    </div>
                  ) : (
                    <>
                      {hasBldgs && (
                        <label className="bm-form-field">
                          <span>Building *</span>
                          <select
                            required
                            value={roomAssignModal.buildingId || ""}
                            disabled={!roomAssignModal.centerId}
                            onChange={(e) =>
                              setRoomAssignModal((p) => ({
                                ...p,
                                buildingId: e.target.value,
                                roomId: "",
                              }))
                            }
                          >
                            <option value="">
                              {availableBldgs.length === 0
                                ? "No buildings with available capacity"
                                : "Select building"}
                            </option>
                            {availableBldgs.map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.name} ({b.rooms.length} room
                                {b.rooms.length === 1 ? "" : "s"},{" "}
                                {b.availableSpaces} available)
                              </option>
                            ))}
                          </select>
                        </label>
                      )}

                      <label className="bm-form-field">
                        <span>Room *</span>
                        <select
                          required
                          value={roomAssignModal.roomId}
                          disabled={
                            !roomAssignModal.centerId ||
                            (hasBldgs && !roomAssignModal.buildingId)
                          }
                          onChange={(e) =>
                            setRoomAssignModal((p) => ({
                              ...p,
                              roomId: e.target.value,
                            }))
                          }
                        >
                          <option value="">
                            {!roomAssignModal.centerId
                              ? "Select a center first"
                              : hasBldgs && !roomAssignModal.buildingId
                                ? "Select a building first"
                                : filteredModalRooms.length === 0
                                  ? "No rooms with available capacity"
                                  : "Select room"}
                          </option>
                          {filteredModalRooms.map((r) => {
                            const cap = Number(r.capacity || 0);
                            const avail = getBmRoomRemaining(r);
                            return (
                              <option key={r.id} value={r.id}>
                                {formatRoomLabel(r.room_name || r.room_number)}{" "}
                                ({r.room_type || "Room"}) — {avail} of {cap}{" "}
                                available
                              </option>
                            );
                          })}
                        </select>
                      </label>
                    </>
                  )}
                </div>
                <div className="bm-dialog-footer">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={assigningHousehold}
                    onClick={() => setRoomAssignModal(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={
                      assigningHousehold ||
                      !roomAssignModal.familyId ||
                      !roomAssignModal.centerId ||
                      (!isDirect &&
                        ((hasBldgs && !roomAssignModal.buildingId) ||
                          !roomAssignModal.roomId ||
                          (() => {
                            const rObj = filteredModalRooms.find(
                              (r) => String(r.id) === String(roomAssignModal.roomId)
                            );
                            return !rObj || Number(rObj.capacity || 0) <= 0 || getBmRoomRemaining(rObj) < needed;
                          })())) ||
                      (isDirect &&
                        (Number(selectedModalCenter?.capacity || 0) <= 0 ||
                          getBmCenterRemaining(selectedModalCenter) < needed))
                    }
                  >
                    {assigningHousehold ? "Saving..." : "Confirm Assignment"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* Confirm Unassign Household Modal */}
      {unassignTarget && (
        <div
          className="modal-overlay"
          onClick={() => !unassigning && setUnassignTarget(null)}
        >
          <div className="bm-dialog bm-dialog-sm" onClick={(e) => e.stopPropagation()}>
            <div className="bm-dialog-header">
              <h4>Unassign Family</h4>
              <button
                type="button"
                className="bm-dialog-close"
                onClick={() => setUnassignTarget(null)}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
            <div className="bm-dialog-body">
              <p>
                Are you sure you want to unassign{" "}
                <strong>{unassignTarget.headName}</strong> from this room?
              </p>
            </div>
            <div className="bm-dialog-footer">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={unassigning}
                onClick={() => setUnassignTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={unassigning}
                onClick={handleConfirmUnassignHousehold}
              >
                {unassigning ? "Unassigning..." : "Unassign Family"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default BarangayManager;

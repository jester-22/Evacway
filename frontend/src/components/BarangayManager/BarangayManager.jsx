import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
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
import LoadingState from "../LoadingState/LoadingState";
import BarangaysServedPicker from "../BarangaysServedPicker/BarangaysServedPicker";
import { formatRoomLabel } from "../../utils/formatRoomLabel";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faRotate,
  faTriangleExclamation,
  faArrowLeft,
  faLocationDot,
  faArrowRight,
  faUpload,
  faFileExcel,
  faXmark,
  faCircleCheck,
  faHouse,
  faPeopleGroup,
  faBuilding,
  faDoorOpen,
  faMagnifyingGlass,
  faDownload,
  faPlus,
  faPenToSquare,
  faTrash,
  faRightLeft,
  faUserXmark,
  faEye,
  faChevronRight,
  faLayerGroup,
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
    return 3;
  }, [allCentersQuery.data]);

  // Navigation state
  const [workspaceTab, setWorkspaceTab] = useState("barangays"); // 'barangays' | 'families'
  const [selectedBarangayId, setSelectedBarangayId] = useState(null);
  const [barangaySection, setBarangaySection] = useState("overview"); // 'overview' | 'households' | 'centers'
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

  // Page A Search & Pagination
  const [barangaySearch, setBarangaySearch] = useState("");
  const [brgyPage, setBrgyPage] = useState(1);
  const BRGY_PAGE_SIZE = 10;

  // Phase 3: Barangay Overview Household Filters (Assigned/Unassigned + Building)
  const [overviewHouseholdSearch, setOverviewHouseholdSearch] = useState("");
  const [overviewStatusFilter, setOverviewStatusFilter] = useState("");
  const [overviewBuildingFilter, setOverviewBuildingFilter] = useState("");

  // Evacuation Center Add/Edit Modal
  const [centerModal, setCenterModal] = useState(null); // { mode: 'add' | 'edit', id?, name, address, capacity, contact_number, building_material, accessibility_notes, is_active }
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

    return {
      totalBarangays: barangays.length,
      totalHouseholds,
      totalResidents,
      totalCenters: totalUniqueCenters,
      totalAssigned,
      totalUnassigned,
    };
  }, [barangays, totalUniqueCenters]);

  // Filtered Barangays (Page A)
  const filteredBarangays = useMemo(() => {
    const q = barangaySearch.trim().toLowerCase();
    if (!q) return barangays;
    return barangays.filter((b) => (b.name || "").toLowerCase().includes(q));
  }, [barangays, barangaySearch]);

  const totalBrgyPages = Math.max(1, Math.ceil(filteredBarangays.length / BRGY_PAGE_SIZE));
  const safeBrgyPage = Math.min(brgyPage, totalBrgyPages);
  const paginatedBarangays = useMemo(() => {
    const start = (safeBrgyPage - 1) * BRGY_PAGE_SIZE;
    return filteredBarangays.slice(start, start + BRGY_PAGE_SIZE);
  }, [filteredBarangays, safeBrgyPage]);

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
      setWorkspaceTab("barangays");
      setError("");
      setSuccessMsg("");
      setSelectedBarangayId(id);
      setBarangaySection(initialSection);
      setSelectedCenterId(null);
      setSelectedRoomId(null);
      setOverviewHouseholdSearch("");
      setOverviewStatusFilter("");
      setOverviewBuildingFilter("");
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
    setSelectedBarangayId(null);
    setBarangaySection("overview");
    setSelectedCenterId(null);
    setSelectedRoomId(null);
    setStartAddFamilyOnOpen(false);
    setInitialFamilyIdToOpen(null);
  }

  function openHouseholdsSection(options = {}) {
    if (options.startAdd) {
      setStartAddFamilyOnOpen(true);
    }
    if (options.familyId) {
      setInitialFamilyIdToOpen(options.familyId);
    }
    setBarangaySection("households");
  }

  function openCentersSection(centerId = null, roomId = null) {
    if (centerId) {
      navigate(`/admin?tab=centers&center=${centerId}&subtab=buildings`);
    } else {
      navigate("/admin?tab=centers");
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
      accessibility_notes: "",
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
      accessibility_notes: center.accessibility_notes || "",
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
        accessibility_notes: centerModal.accessibility_notes.trim() || null,
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
      capacity: 15,
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
      capacity: room.capacity ?? 10,
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
    if (Number(roomModal.capacity) <= 0) {
      setError("Room capacity must be greater than zero.");
      return;
    }

    try {
      setSavingRoom(true);
      setError("");
      if (roomModal.mode === "add") {
        await api.addRoom(roomModal.centerId, {
          room_number: roomModal.room_name.trim(),
          room_type: roomModal.room_type,
          capacity: Number(roomModal.capacity),
          notes: roomModal.notes.trim() || null,
        });
        setSuccessMsg(`${formatRoomLabel(roomModal.room_name.trim())} added to ${roomModal.centerName}.`);
      } else {
        await api.updateRoom(roomModal.id, {
          room_number: roomModal.room_name.trim(),
          room_type: roomModal.room_type,
          capacity: Number(roomModal.capacity),
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
  function openAssignHouseholdToRoomModal(center, room = null) {
    setError("");
    setRoomAssignModal({
      mode: "assign-to-room",
      familyId: "",
      centerId: center ? String(center.id) : "",
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
      roomId: currentRoomId ? String(currentRoomId) : "",
      familyObj: familyItem,
    });
  }

  async function handleConfirmRoomAssign(e) {
    e.preventDefault();
    if (!roomAssignModal?.familyId || !roomAssignModal?.roomId) {
      setError("Please select both a household and a destination room.");
      return;
    }

    try {
      setAssigningHousehold(true);
      setError("");
      const famId = Number(roomAssignModal.familyId);
      const centerId = Number(roomAssignModal.centerId);
      const rmId = Number(roomAssignModal.roomId);

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
        setSuccessMsg("Household transferred to the selected room.");
      } else {
        await api.assignFamily(famId, {
          center_id: centerId || undefined,
          room_id: rmId,
        });
        setSuccessMsg("Household assigned to the selected room.");
      }

      setRoomAssignModal(null);
      await invalidateEvacuationQueries(queryClient);
    } catch (err) {
      setError(err.message || "Failed to assign household to room.");
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
      setSuccessMsg(`Household "${unassignTarget.headName}" unassigned from room.`);
      setUnassignTarget(null);
      await invalidateEvacuationQueries(queryClient);
    } catch (err) {
      setError(err.message || "Failed to unassign household.");
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
      "Total Households",
      "Assigned Households",
      "Unassigned Households",
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
                <span
                  className={`bm-status-pill ${activeRoom.is_active === false
                      ? "inactive"
                      : isRoomAssigned
                        ? "assigned"
                        : "unassigned"
                    }`}
                >
                  {activeRoom.is_active === false
                    ? "Inactive"
                    : isRoomAssigned
                      ? "Assigned"
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
                <FontAwesomeIcon icon={faPlus} /> Assign Household
              </button>
            </div>
          </div>

          <div className="bm-stats-grid-4">
            <div className="bm-stat-card">
              <span className="bm-stat-label">Room Capacity</span>
              <strong className="bm-stat-value">{cap}</strong>
              <span className="bm-stat-sub">Maximum evacuees</span>
            </div>
            <div className="bm-stat-card">
              <span className="bm-stat-label">Current Occupancy</span>
              <strong className="bm-stat-value">{occ}</strong>
              <span className="bm-stat-sub">{occ} of {cap} here · {assigned} assigned</span>
            </div>
            <div className={`bm-stat-card ${avail > 0 ? "accent-green" : "accent-amber"}`}>
              <span className="bm-stat-label">Available Slots</span>
              <strong className="bm-stat-value">{avail}</strong>
              <span className="bm-stat-sub">{isFull ? "Full" : isFullyAssigned ? "Fully assigned" : "Ready for assignment"}</span>
            </div>
            <div className="bm-stat-card">
              <span className="bm-stat-label">Assigned Households</span>
              <strong className="bm-stat-value">{assignedFamilies.length}</strong>
              <span className="bm-stat-sub">Families in this room</span>
            </div>
          </div>

          <div className="bm-section-card">
            <div className="bm-section-card-header">
              <div>
                <h4>
                  <FontAwesomeIcon icon={faPeopleGroup} /> Assigned Households ({assignedFamilies.length})
                </h4>
                <p>Manage households currently sheltered in {activeRoom.room_name}.</p>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={avail <= 0}
                onClick={() => openAssignHouseholdToRoomModal(activeCenter, activeRoom)}
              >
                <FontAwesomeIcon icon={faPlus} /> Assign Household to Room
              </button>
            </div>

            {assignedFamilies.length === 0 ? (
              <div className="bm-empty-box">
                <FontAwesomeIcon icon={faHouse} className="bm-empty-icon" />
                <h4>No Households Assigned Yet</h4>
                <p>This room has {avail} available slots ready for household assignment.</p>
                {avail > 0 && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => openAssignHouseholdToRoomModal(activeCenter, activeRoom)}
                  >
                    <FontAwesomeIcon icon={faPlus} /> Assign Household
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="bm-table-wrap bm-desktop-only">
                  <table className="bm-table">
                    <thead>
                      <tr>
                        <th>Household ID</th>
                        <th>Household Head</th>
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
                                  <FontAwesomeIcon icon={faEye} /> View Household
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
                <FontAwesomeIcon icon={faRightLeft} /> Assign Household
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

          <div className="bm-stats-grid-4">
            <div className="bm-stat-card">
              <span className="bm-stat-label">Total Rooms</span>
              <strong className="bm-stat-value">{rooms.length}</strong>
              <span className="bm-stat-sub">Configured rooms</span>
            </div>
            <div className="bm-stat-card">
              <span className="bm-stat-label">Total Capacity</span>
              <strong className="bm-stat-value">{totalCap}</strong>
              <span className="bm-stat-sub">Maximum center capacity</span>
            </div>
            <div className="bm-stat-card">
              <span className="bm-stat-label">Current Occupancy</span>
              <strong className="bm-stat-value">{totalOcc}</strong>
              <span className="bm-stat-sub">{totalOcc} of {totalCap} here · {totalAssigned} assigned</span>
            </div>
            <div className={`bm-stat-card ${totalAvail > 0 ? "accent-green" : "accent-amber"}`}>
              <span className="bm-stat-label">Available Capacity</span>
              <strong className="bm-stat-value">{totalAvail}</strong>
              <span className="bm-stat-sub">Remaining slots</span>
            </div>
          </div>

          <div className="bm-section-card">
            <div className="bm-section-card-header">
              <div>
                <h4>
                  <FontAwesomeIcon icon={faDoorOpen} /> Rooms in {activeCenter.name} ({rooms.length})
                </h4>
                <p>Select a room to view its assigned households, transfer families, or manage capacity.</p>
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
                <p>Add rooms to {activeCenter.name} so households can be assigned to specific rooms.</p>
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
                        <th>Households</th>
                        <th>Status</th>
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
                              <span
                                className={`bm-status-pill ${rm.is_active === false
                                    ? "inactive"
                                    : isRoomAssigned
                                      ? "assigned"
                                      : "unassigned"
                                  }`}
                              >
                                {rm.is_active === false
                                  ? "Inactive"
                                  : isRoomAssigned
                                    ? "Assigned"
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
                          <span
                            className={`bm-status-pill ${rm.is_active === false
                                ? "inactive"
                                : isRoomAssigned
                                  ? "assigned"
                                  : "unassigned"
                              }`}
                          >
                            {rm.is_active === false
                              ? "Inactive"
                              : isRoomAssigned
                                ? "Assigned"
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
                            <span>Households</span>
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
              Manage evacuation centers, room capacities, and household room assignments in{" "}
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

        <div className="bm-stats-grid-4">
          <div className="bm-stat-card">
            <span className="bm-stat-label">Evacuation Centers</span>
            <strong className="bm-stat-value">{centers.length}</strong>
            <span className="bm-stat-sub">Facilities in barangay</span>
          </div>
          <div className="bm-stat-card">
            <span className="bm-stat-label">Total Rooms</span>
            <strong className="bm-stat-value">{selectedBarangayStats.totalRooms}</strong>
            <span className="bm-stat-sub">Across all centers</span>
          </div>
          <div className="bm-stat-card">
            <span className="bm-stat-label">Current Occupancy</span>
            <strong className="bm-stat-value">
              {selectedBarangayStats.totalOccupied} / {selectedBarangayStats.totalCapacity}
            </strong>
            <span className="bm-stat-sub">Assigned evacuees</span>
          </div>
          <div className="bm-stat-card accent-green">
            <span className="bm-stat-label">Available Capacity</span>
            <strong className="bm-stat-value">{selectedBarangayStats.totalAvailable}</strong>
            <span className="bm-stat-sub">Remaining room slots</span>
          </div>
        </div>

        <div className="bm-section-card">
          <div className="bm-section-card-header">
            <div>
              <h4>
                <FontAwesomeIcon icon={faBuilding} /> Barangay Evacuation Centers ({centers.length})
              </h4>
              <p>Select an evacuation center to inspect its rooms and assigned households.</p>
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
                      <th>Status</th>
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
                                {assignedFamilies} household{assignedFamilies === 1 ? "" : "s"}
                              </div>
                            </div>
                          </td>
                          <td>
                            <span
                              className={`bm-status-pill ${center.is_active === false
                                  ? "inactive"
                                  : isFull
                                    ? "full"
                                    : "available"
                                }`}
                            >
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
                        <span
                          className={`bm-status-pill ${center.is_active === false
                              ? "inactive"
                              : isFull
                                ? "full"
                                : "available"
                            }`}
                        >
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

  return (
    <div className="barangay-page">
      {/* Top Page Header */}
      <div className="barangay-header">
        <div>
          <h2 className="barangay-title">Barangays</h2>
          <p className="barangay-subtitle">
            Manage registered barangays, population, and associated records.
          </p>
        </div>

        <div className="barangay-header-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={loadBarangays}
            disabled={loading || detailLoading}
          >
            <FontAwesomeIcon icon={faRotate} spin={loading || detailLoading} /> Refresh
          </button>
        </div>
      </div>

      {/* Top-Level Mode Switcher when on Landing Page */}
      {!selectedBarangayId && (
        <div className="barangay-workspace-tabs">
          <button
            type="button"
            className={workspaceTab === "barangays" ? "active" : ""}
            onClick={() => setWorkspaceTab("barangays")}
          >
            <FontAwesomeIcon icon={faLocationDot} /> Barangays
          </button>
          <button
            type="button"
            className={workspaceTab === "families" ? "active" : ""}
            onClick={() => setWorkspaceTab("families")}
          >
            <FontAwesomeIcon icon={faPeopleGroup} /> All Households
          </button>
        </div>
      )}

      {/* Feedback Alerts */}
      {visibleError && (
        <div className="alert alert-error bm-banner-alert">
          <span className="alert-icon">
            <FontAwesomeIcon icon={faTriangleExclamation} />
          </span>
          <span>{visibleError}</span>
          <button
            type="button"
            className="bm-alert-dismiss"
            onClick={() => setError("")}
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="alert alert-success bm-banner-alert">
          <span className="alert-icon">
            <FontAwesomeIcon icon={faCircleCheck} />
          </span>
          <span>{successMsg}</span>
          <button
            type="button"
            className="bm-alert-dismiss"
            onClick={() => setSuccessMsg("")}
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
      )}

      {/* Global All-Households Directory Tab */}
      {workspaceTab === "families" && !selectedBarangayId ? (
        <FamilyManagement
          barangays={barangays}
          onRefreshParent={loadBarangays}
        />
      ) : loading ? (
        <LoadingState
          title="Loading barangays..."
          subtitle="Fetching barangay records, households, and evacuation center summaries."
        />
      ) : detailLoading ? (
        <LoadingState
          title="Opening barangay..."
          subtitle="Loading households, residents, and evacuation centers."
        />
      ) : !selectedBarangay ? (
        /* =========================================================
           PAGE A: BARANGAY MANAGEMENT LANDING PAGE
           ========================================================= */
        <div className="bm-landing">
          {/* Summary Metric Cards (Households, Assigned, Unassigned, Barangays) */}
          <div className="bm-stats-grid-4" style={{ marginBottom: "16px" }}>
            <div className="bm-stat-card">
              <span className="bm-stat-label">Barangays</span>
              <strong className="bm-stat-value">{overallStats.totalBarangays}</strong>
              <span className="bm-stat-sub">{overallStats.totalCenters} evacuation centers</span>
            </div>
            <div className="bm-stat-card">
              <span className="bm-stat-label">Households</span>
              <strong className="bm-stat-value">{overallStats.totalHouseholds}</strong>
              <span className="bm-stat-sub">{overallStats.totalResidents} residents</span>
            </div>
            <div className="bm-stat-card accent-green">
              <span className="bm-stat-label">Assigned</span>
              <strong className="bm-stat-value">{overallStats.totalAssigned}</strong>
              <span className="bm-stat-sub">Assigned to building &amp; room</span>
            </div>
            <div className={`bm-stat-card ${overallStats.totalUnassigned > 0 ? "accent-amber" : "accent-green"}`}>
              <span className="bm-stat-label">Unassigned</span>
              <strong className="bm-stat-value">{overallStats.totalUnassigned}</strong>
              <span className="bm-stat-sub">
                {overallStats.totalUnassigned > 0 ? "Awaiting room assignment" : "All households assigned"}
              </span>
            </div>
          </div>

          {/* Search & Actions Bar */}
          <div className="barangay-filter-bar">
            <div className="barangay-search">
              <FontAwesomeIcon icon={faMagnifyingGlass} />
              <input
                type="text"
                placeholder="Search barangays..."
                value={barangaySearch}
                onChange={(e) => {
                  setBarangaySearch(e.target.value);
                  setBrgyPage(1);
                }}
              />
              {barangaySearch && (
                <button
                  type="button"
                  className="barangay-search-clear"
                  onClick={() => {
                    setBarangaySearch("");
                    setBrgyPage(1);
                  }}
                >
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              )}
            </div>

            <div className="barangay-filter-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={exportBarangaysCsv}
                disabled={filteredBarangays.length === 0}
              >
                <FontAwesomeIcon icon={faDownload} /> Export CSV
              </button>
            </div>
          </div>

          {/* Barangay List: Desktop Table & Mobile Cards */}
          {filteredBarangays.length === 0 ? (
            <div className="bm-empty-box">
              <FontAwesomeIcon icon={faLocationDot} className="bm-empty-icon" />
              <h4>
                {barangays.length === 0
                  ? "No Barangays Found"
                  : "No Matching Barangays"}
              </h4>
              <p>
                {barangays.length === 0
                  ? "No barangays are currently registered in the system."
                  : `No barangays matched "${barangaySearch}".`}
              </p>
            </div>
          ) : (
            <>
              <div className="bm-section-card bm-desktop-only">
                <div className="bm-table-wrap">
                  <table className="bm-table">
                    <thead>
                      <tr>
                        <th>Barangay</th>
                        <th>Households</th>
                        <th>Assigned</th>
                        <th>Unassigned</th>
                        <th>Evacuation Centers</th>
                        <th className="bm-th-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
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

                        return (
                          <tr key={b.id}>
                            <td>
                              <strong className="bm-cell-strong">{b.name}</strong>
                              <div className="bm-cell-sub">{resCount} residents</div>
                            </td>
                            <td>
                              <strong>{famCount}</strong>
                            </td>
                            <td>
                              <span className="text-green" style={{ fontWeight: 600 }}>
                                {assignedCount}
                              </span>
                            </td>
                            <td>
                              {unassignedCount > 0 ? (
                                <span className="bm-mini-badge unassigned">
                                  {unassignedCount} Unassigned
                                </span>
                              ) : (
                                <span className="bm-muted">0</span>
                              )}
                            </td>
                            <td>{centerCount}</td>
                            <td className="bm-td-right">
                              <div className="bm-action-group">
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm"
                                  onClick={() => openBarangay(b.id, "overview")}
                                >
                                  View Details
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mobile Barangay Cards */}
              <div className="bm-mobile-stack bm-mobile-only">
                {paginatedBarangays.map((b) => {
                  const famCount = Number(
                    b.household_count ?? b.family_count ?? b.total_families ?? 0
                  );
                  const assignedCount = Number(b.assigned_family_count ?? 0);
                  const unassignedCount = Number(
                    b.unassigned_family_count ?? Math.max(0, famCount - assignedCount)
                  );
                  const centerCount = Number(b.evacuation_center_count ?? 0);

                  return (
                    <div key={b.id} className="bm-mobile-card">
                      <div className="bm-mobile-card-top">
                        <h4 className="bm-mobile-card-title">{b.name}</h4>
                        {unassignedCount > 0 && (
                          <span className="bm-mini-badge unassigned">
                            {unassignedCount} Unassigned
                          </span>
                        )}
                      </div>

                      <div className="bm-mobile-card-grid">
                        <div>
                          <span>Households</span>
                          <strong>{famCount}</strong>
                        </div>
                        <div>
                          <span>Assigned</span>
                          <strong className="text-green">{assignedCount}</strong>
                        </div>
                        <div>
                          <span>Unassigned</span>
                          <strong className={unassignedCount > 0 ? "text-amber" : ""}>
                            {unassignedCount}
                          </strong>
                        </div>
                        <div>
                          <span>Centers</span>
                          <strong>{centerCount}</strong>
                        </div>
                      </div>

                      <div className="bm-mobile-card-actions">
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => openBarangay(b.id, "overview")}
                        >
                          Open
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Pagination */}
              {totalBrgyPages > 1 && (
                <div className="bm-pagination">
                  <span className="bm-pagination-info">
                    Showing {(safeBrgyPage - 1) * BRGY_PAGE_SIZE + 1}–
                    {Math.min(safeBrgyPage * BRGY_PAGE_SIZE, filteredBarangays.length)} of{" "}
                    {filteredBarangays.length} barangays
                  </span>
                  <div className="bm-pagination-controls">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={safeBrgyPage <= 1}
                      onClick={() => setBrgyPage((p) => Math.max(1, p - 1))}
                    >
                      Previous
                    </button>
                    <span className="bm-pagination-page">
                      Page {safeBrgyPage} of {totalBrgyPages}
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={safeBrgyPage >= totalBrgyPages}
                      onClick={() => setBrgyPage((p) => Math.min(totalBrgyPages, p + 1))}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        /* =========================================================
           PAGE B: BARANGAY DASHBOARD
           ========================================================= */
        <div className="bm-dashboard">
          {/* Top Breadcrumb Bar */}
          <div className="bm-dashboard-topbar">
            <nav className="bm-breadcrumb" aria-label="Breadcrumb">
              <button
                type="button"
                className="bm-breadcrumb-link"
                onClick={closeBarangay}
              >
                Barangays
              </button>
              <FontAwesomeIcon icon={faChevronRight} className="bm-breadcrumb-sep" />
              <span className="bm-breadcrumb-current">
                {selectedBarangay.name}
              </span>
            </nav>

            {/* Clean Section Switcher */}
            <div className="bm-section-nav">
              <button
                type="button"
                className={barangaySection === "overview" ? "active" : ""}
                onClick={() => {
                  setBarangaySection("overview");
                  setSelectedCenterId(null);
                  setSelectedRoomId(null);
                }}
              >
                <FontAwesomeIcon icon={faLayerGroup} /> Overview
              </button>
              <button
                type="button"
                className={barangaySection === "households" ? "active" : ""}
                onClick={() => openHouseholdsSection()}
              >
                <FontAwesomeIcon icon={faPeopleGroup} /> Households ({selectedBarangayStats.totalHouseholds})
              </button>
              <button
                type="button"
                className={barangaySection === "centers" ? "active" : ""}
                onClick={() => openCentersSection(null, null)}
              >
                <FontAwesomeIcon icon={faBuilding} /> Evacuation Centers ({selectedBarangayStats.totalCenters})
              </button>
            </div>
          </div>

          {barangaySection === "overview" && (
            <div className="bm-overview-content">
              {/* Per-Barangay Summary Strip: Households, Assigned, Unassigned, Evacuation Centers */}
              <div className="bm-stats-grid-4">
                <div className="bm-stat-card">
                  <span className="bm-stat-label">Households</span>
                  <strong className="bm-stat-value">{selectedBarangayStats.totalHouseholds}</strong>
                  <span className="bm-stat-sub">
                    {selectedBarangayStats.totalResidents} registered residents
                  </span>
                </div>
                <div className="bm-stat-card accent-green">
                  <span className="bm-stat-label">Assigned</span>
                  <strong className="bm-stat-value">{selectedBarangayStats.assignedHouseholds}</strong>
                  <span className="bm-stat-sub">Assigned to building &amp; room</span>
                </div>
                <div className={`bm-stat-card ${selectedBarangayStats.unassignedHouseholds > 0 ? "accent-amber" : "accent-green"}`}>
                  <span className="bm-stat-label">Unassigned</span>
                  <strong className="bm-stat-value">
                    {selectedBarangayStats.unassignedHouseholds}
                  </strong>
                  <span className="bm-stat-sub">
                    {selectedBarangayStats.unassignedHouseholds > 0
                      ? "Households awaiting room"
                      : "All households sheltered"}
                  </span>
                </div>
                <div className="bm-stat-card">
                  <span className="bm-stat-label">Evacuation Centers</span>
                  <strong className="bm-stat-value">{selectedBarangayStats.totalCenters}</strong>
                  <span className="bm-stat-sub">
                    {barangayBuildings.length} buildings &bull; {selectedBarangayStats.totalRooms} rooms
                  </span>
                </div>
              </div>

              {/* Registered Households Section with Assigned/Unassigned & Building Filters */}
              <div className="bm-section-card">
                <div className="bm-section-card-header">
                  <div>
                    <h4>
                      <FontAwesomeIcon icon={faPeopleGroup} /> Households in {selectedBarangay.name} ({selectedBarangayStats.totalHouseholds})
                    </h4>
                    <p>
                      {selectedBarangayStats.assignedHouseholds} assigned &middot;{" "}
                      {selectedBarangayStats.unassignedHouseholds} unassigned
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => openHouseholdsSection()}
                    >
                      Manage Households ({selectedBarangayStats.totalHouseholds}) <FontAwesomeIcon icon={faArrowRight} />
                    </button>
                  </div>
                </div>

                {/* Phase 3 Filters: Search, Assigned/Unassigned, Building */}
                <div className="bm-hh-filter-bar" role="search" aria-label="Filter barangay households">
                  <label className="bm-hh-search-box">
                    <FontAwesomeIcon icon={faMagnifyingGlass} />
                    <input
                      type="search"
                      value={overviewHouseholdSearch}
                      onChange={(e) => setOverviewHouseholdSearch(e.target.value)}
                      placeholder="Search household head, code, or room..."
                    />
                  </label>
                  <select
                    value={overviewStatusFilter}
                    onChange={(e) => setOverviewStatusFilter(e.target.value)}
                    aria-label="Filter by assignment status"
                    className="bm-hh-filter-select"
                  >
                    <option value="">All Statuses</option>
                    <option value="assigned">Assigned</option>
                    <option value="unassigned">Unassigned</option>
                  </select>
                  <select
                    value={overviewBuildingFilter}
                    onChange={(e) => setOverviewBuildingFilter(e.target.value)}
                    aria-label="Filter by building"
                    className="bm-hh-filter-select"
                  >
                    <option value="">All Buildings</option>
                    {barangayBuildings.map((b) => (
                      <option key={b.id} value={String(b.id)}>
                        {b.name}
                      </option>
                    ))}
                    <option value="unmapped">Unmapped rooms</option>
                  </select>
                </div>

                {selectedBarangay.families.length === 0 ? (
                  <div className="bm-empty-box">
                    <FontAwesomeIcon icon={faHouse} className="bm-empty-icon" />
                    <h4>No Households Registered Yet</h4>
                    <p>There are no households registered in {selectedBarangay.name} yet.</p>
                  </div>
                ) : filteredOverviewFamilies.length === 0 ? (
                  <div className="bm-empty-box">
                    <FontAwesomeIcon icon={faMagnifyingGlass} className="bm-empty-icon" />
                    <h4>No Matching Households</h4>
                    <p>No households match the selected status or building filter.</p>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setOverviewHouseholdSearch("");
                        setOverviewStatusFilter("");
                        setOverviewBuildingFilter("");
                      }}
                    >
                      Clear Filters
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="bm-table-wrap bm-desktop-only">
                      <table className="bm-table">
                        <thead>
                          <tr>
                            <th>Household Code</th>
                            <th>Head of Family</th>
                            <th>Members</th>
                            <th>Building &middot; Room</th>
                            <th className="bm-td-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredOverviewFamilies.slice(0, 15).map((fam) => {
                            const fId = fam.id || fam.family_id;
                            const isAssigned = fam.assignment_status === "Assigned";
                            const memCount = Number(fam.resident_count ?? fam.member_count ?? 1);
                            const rawRoom = fam.current_room_name || fam.current_room || fam.rooms;
                            const hasBuilding = Boolean(fam.current_building_name || fam.current_building);
                            const bldgName = fam.current_building_name || fam.current_building;

                            return (
                              <tr key={fId || fam.family_code}>
                                <td>
                                  <span className="bm-code-badge">{formatHouseholdCode(fam)}</span>
                                </td>
                                <td>
                                  <strong className="bm-cell-strong">
                                    {fam.head_name || fam.head_of_family || "Unnamed Household"}
                                  </strong>
                                </td>
                                <td>
                                  <span className="bm-count-badge">
                                    {memCount} person{memCount === 1 ? "" : "s"}
                                  </span>
                                </td>
                                <td>
                                  {isAssigned ? (
                                    rawRoom ? (
                                      <div className="bm-bldg-room-cell">
                                        <span className="bm-type-pill">
                                          {hasBuilding ? (
                                            `${bldgName} · ${formatRoomLabel(rawRoom)}`
                                          ) : (
                                            <>
                                              {formatRoomLabel(rawRoom)}
                                              <span className="bm-neutral-unmapped-chip">Unmapped</span>
                                            </>
                                          )}
                                        </span>
                                        {fam.current_center_name && (
                                          <span className="bm-cell-sub">{fam.current_center_name}</span>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="bm-bldg-room-cell">
                                        <span className="bm-type-pill">
                                          {fam.current_center_name || fam.evacuation_center || "Assigned (Open space)"}
                                        </span>
                                      </div>
                                    )
                                  ) : (
                                    <span className="bm-mini-badge unassigned">Unassigned</span>
                                  )}
                                </td>
                                <td className="bm-td-right">
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => openHouseholdsSection({ familyId: fId })}
                                  >
                                    <FontAwesomeIcon icon={faEye} /> Details
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="bm-mobile-stack bm-mobile-only">
                      {filteredOverviewFamilies.slice(0, 15).map((fam) => {
                        const fId = fam.id || fam.family_id;
                        const isAssigned = fam.assignment_status === "Assigned";
                        const memCount = Number(fam.resident_count ?? fam.member_count ?? 1);
                        const rawRoom = fam.current_room_name || fam.current_room || fam.rooms;
                        const hasBuilding = Boolean(fam.current_building_name || fam.current_building);
                        const bldgName = fam.current_building_name || fam.current_building;

                        return (
                          <div key={fId || fam.family_code} className="bm-mobile-card">
                            <div className="bm-mobile-card-top">
                              <div>
                                <span className="bm-code-badge">{formatHouseholdCode(fam)}</span>
                                <h5 className="bm-mobile-card-title">
                                  {fam.head_name || fam.head_of_family || "Unnamed Household"}
                                </h5>
                              </div>
                              {!isAssigned && (
                                <span className="bm-mini-badge unassigned">Unassigned</span>
                              )}
                            </div>
                            <div className="bm-mobile-card-grid">
                              <div>
                                <span>Members</span>
                                <strong>{memCount}</strong>
                              </div>
                              <div style={{ gridColumn: "span 2" }}>
                                <span>{rawRoom ? "Building · Room" : "Shelter"}</span>
                                <strong>
                                  {isAssigned ? (
                                    rawRoom ? (
                                      hasBuilding ? (
                                        `${bldgName} · ${formatRoomLabel(rawRoom)}`
                                      ) : (
                                        <>
                                          {formatRoomLabel(rawRoom)}{" "}
                                          <span className="bm-neutral-unmapped-chip">Unmapped</span>
                                        </>
                                      )
                                    ) : (
                                      fam.current_center_name || fam.evacuation_center || "Assigned (Open space)"
                                    )
                                  ) : (
                                    "Unassigned"
                                  )}
                                </strong>
                              </div>
                            </div>
                            <div className="bm-mobile-card-actions">
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => openHouseholdsSection({ familyId: fId })}
                              >
                                <FontAwesomeIcon icon={faEye} /> View Details
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {filteredOverviewFamilies.length > 15 && (
                      <div className="bm-table-footer">
                        <span>
                          Showing 15 of {filteredOverviewFamilies.length} matching households
                        </span>
                        <button
                          type="button"
                          className="bm-link-btn"
                          onClick={() => openHouseholdsSection()}
                        >
                          View all {selectedBarangay.families.length} households &rarr;
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Designated Evacuation Centers Section */}
              <div className="bm-section-card">
                <div className="bm-section-card-header">
                  <div>
                    <h4>
                      <FontAwesomeIcon icon={faBuilding} /> Designated Evacuation Centers ({centers.length})
                    </h4>
                    <p>Centers assigned to shelter residents of {selectedBarangay.name}.</p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => openCentersSection(null, null)}
                  >
                    Manage All Centers <FontAwesomeIcon icon={faArrowRight} />
                  </button>
                </div>

                {centers.length === 0 ? (
                  <div className="bm-empty-box">
                    <FontAwesomeIcon icon={faBuilding} className="bm-empty-icon" />
                    <h4>No Designated Evacuation Centers</h4>
                    <p>There are no evacuation centers currently assigned to serve {selectedBarangay.name}.</p>
                  </div>
                ) : (
                  <>
                    <div className="bm-table-wrap bm-desktop-only">
                      <table className="bm-table">
                        <thead>
                          <tr>
                            <th>Center Name</th>
                            <th>Address / Location</th>
                            <th>Buildings &middot; Rooms</th>
                            <th>Occupancy &amp; Capacity</th>
                            <th>Status</th>
                            <th className="bm-td-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {centers.map((c) => {
                            const rooms = Array.isArray(c.rooms) ? c.rooms : [];
                            const bCount = Number(c.building_count ?? (c.buildings || []).length ?? 0);
                            const cCap = Number(
                              c.capacity || rooms.reduce((sum, r) => sum + Number(r.capacity || 0), 0)
                            );
                            const cOcc = Number(
                              c.occupied ?? rooms.reduce((sum, r) => sum + Number(r.occupied || 0), 0)
                            );
                            const cAssigned = Number(
                              c.assigned ?? c.total_assigned ?? rooms.reduce((sum, r) => sum + Number(r.assigned ?? r.occupied ?? 0), 0)
                            );
                            const pct = cCap > 0 ? Math.min(100, Math.round((cOcc / cCap) * 100)) : 0;
                            const isFull = cOcc >= cCap && cCap > 0;
                            const isFullyAssigned = !isFull && cAssigned >= cCap && cCap > 0;

                            return (
                              <tr key={c.id}>
                                <td>
                                  <strong className="bm-cell-strong">{c.name}</strong>
                                </td>
                                <td>
                                  <span className="bm-muted">
                                    <FontAwesomeIcon icon={faLocationDot} style={{ marginRight: 5 }} />
                                    {c.address || selectedBarangay.name}
                                  </span>
                                </td>
                                <td>
                                  {c.center_type && c.center_type !== "campus" ? (
                                    <span className="bm-count-badge">
                                      1 space &middot; {cCap} capacity
                                    </span>
                                  ) : (
                                    <span className="bm-count-badge">
                                      {bCount} {bCount === 1 ? "building" : "buildings"} &middot; {rooms.length} {rooms.length === 1 ? "room" : "rooms"}
                                    </span>
                                  )}
                                </td>
                                <td>
                                  <div style={{ minWidth: 160 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                                      <span className="bm-cell-strong">{cOcc} of {cCap} here &middot; {cAssigned} assigned</span>
                                    </div>
                                    <div className="bm-progress-bar">
                                      <div
                                        className={`bm-progress-fill ${pct >= 100 ? "full" : pct >= 80 ? "warning" : "normal"}`}
                                        style={{ width: `${pct}%` }}
                                      />
                                    </div>
                                  </div>
                                </td>
                                <td>
                                  {c.is_active === false ? (
                                    <span className="bm-status-pill inactive">Inactive</span>
                                  ) : isFull ? (
                                    <span className="bm-status-pill full">Full</span>
                                  ) : isFullyAssigned ? (
                                    <span className="bm-status-pill assigned">Fully assigned</span>
                                  ) : (
                                    <span className="bm-status-pill available">Available</span>
                                  )}
                                </td>
                                <td className="bm-td-right">
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => openCentersSection(c.id, null)}
                                  >
                                    <FontAwesomeIcon icon={c.center_type && c.center_type !== "campus" ? faHouseFlag : faBuilding} />{" "}
                                    {c.center_type && c.center_type !== "campus" ? "View center" : "View buildings"}
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="bm-mobile-stack bm-mobile-only">
                      {centers.map((c) => {
                        const rooms = Array.isArray(c.rooms) ? c.rooms : [];
                        const bCount = Number(c.building_count ?? (c.buildings || []).length ?? 0);
                        const cCap = Number(
                          c.capacity || rooms.reduce((sum, r) => sum + Number(r.capacity || 0), 0)
                        );
                        const cOcc = Number(
                          c.occupied ?? rooms.reduce((sum, r) => sum + Number(r.occupied || 0), 0)
                        );
                        const cAssigned = Number(
                          c.assigned ?? c.total_assigned ?? rooms.reduce((sum, r) => sum + Number(r.assigned ?? r.occupied ?? 0), 0)
                        );
                        const isFull = cOcc >= cCap && cCap > 0;

                        return (
                          <div key={c.id} className="bm-mobile-card">
                            <div className="bm-mobile-card-top">
                              <div>
                                <h5 className="bm-mobile-card-title">{c.name}</h5>
                                <span className="bm-muted" style={{ fontSize: 12 }}>
                                  <FontAwesomeIcon icon={faLocationDot} style={{ marginRight: 4 }} />
                                  {c.address || selectedBarangay.name}
                                </span>
                              </div>
                              {isFull && <span className="bm-status-pill full">Full</span>}
                            </div>
                            <div className="bm-mobile-card-grid">
                              <div>
                                <span>Structure</span>
                                <strong>
                                  {c.center_type && c.center_type !== "campus"
                                    ? `1 space · ${cCap} capacity`
                                    : `${bCount} bldgs · ${rooms.length} rms`}
                                </strong>
                              </div>
                              <div style={{ gridColumn: "span 2" }}>
                                <span>Occupancy</span>
                                <strong>{cOcc} of {cCap} here &middot; {cAssigned} assigned</strong>
                              </div>
                            </div>
                            <div className="bm-mobile-card-actions">
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => openCentersSection(c.id, null)}
                              >
                                <FontAwesomeIcon icon={c.center_type && c.center_type !== "campus" ? faHouseFlag : faBuilding} />{" "}
                                {c.center_type && c.center_type !== "campus" ? "View center" : "View buildings"}
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
          )}

          {barangaySection === "households" && (
            <FamilyManagement
              key={`${selectedBarangay.id}-${initialFamilyIdToOpen || "list"}-${startAddFamilyOnOpen ? "add" : "view"
                }`}
              barangays={barangays}
              availableBuildings={barangayBuildings}
              lockedBarangayId={selectedBarangay.id}
              lockedBarangayName={selectedBarangay.name}
              initialStartAdd={startAddFamilyOnOpen}
              onInitialStartAddConsumed={() => setStartAddFamilyOnOpen(false)}
              initialFamilyId={initialFamilyIdToOpen}
              onInitialFamilyConsumed={() => setInitialFamilyIdToOpen(null)}
              onRefreshParent={loadBarangays}
            />
          )}

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
                            `Removing "${bName}" will affect ${affectedCount} household(s) currently assigned to this center. Do you want to remove it?`
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
                    <span>Accessibility Notes</span>
                    <input
                      type="text"
                      placeholder="Wheelchair ramp, ground-floor access, etc."
                      value={centerModal.accessibility_notes}
                      onChange={(e) =>
                        setCenterModal((p) => ({
                          ...p,
                          accessibility_notes: e.target.value,
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
                    <span>Capacity (Persons) *</span>
                    <input
                      type="number"
                      min="1"
                      required
                      value={roomModal.capacity}
                      onChange={(e) =>
                        setRoomModal((p) => ({ ...p, capacity: e.target.value }))
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
      {roomAssignModal && (
        <div
          className="modal-overlay"
          onClick={() => !assigningHousehold && setRoomAssignModal(null)}
        >
          <div className="bm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="bm-dialog-header">
              <div>
                <span className="bm-kicker">Room Assignment</span>
                <h4>
                  {roomAssignModal.mode === "transfer-household"
                    ? "Transfer Household to Another Room"
                    : "Assign Household to Room"}
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
                  <span>Household *</span>
                  <select
                    required
                    value={roomAssignModal.familyId}
                    disabled={roomAssignModal.mode === "transfer-household"}
                    onChange={(e) =>
                      setRoomAssignModal((p) => ({ ...p, familyId: e.target.value }))
                    }
                  >
                    <option value="">Select household in {selectedBarangay?.name}</option>
                    {(selectedBarangay?.families || []).map((f) => (
                      <option key={f.id} value={f.id}>
                        {formatHouseholdCode(f.id)} — {f.head_of_family} (
                        {f.member_count || 1} members) • {f.assignment_status}
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
                        roomId: "",
                      }))
                    }
                  >
                    <option value="">Select evacuation center</option>
                    {centers
                      .filter((c) => c.is_active !== false)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </label>

                <label className="bm-form-field">
                  <span>Room *</span>
                  <select
                    required
                    value={roomAssignModal.roomId}
                    disabled={!roomAssignModal.centerId}
                    onChange={(e) =>
                      setRoomAssignModal((p) => ({ ...p, roomId: e.target.value }))
                    }
                  >
                    <option value="">Select room</option>
                    {(
                      centers.find(
                        (c) => Number(c.id) === Number(roomAssignModal.centerId)
                      )?.rooms || []
                    )
                      .filter((r) => r.is_active !== false)
                      .map((r) => {
                        const cap = Number(r.capacity || 0);
                        const occ = Number(r.occupied || 0);
                        const avail = Math.max(0, cap - occ);
                        return (
                          <option key={r.id} value={r.id} disabled={avail <= 0}>
                            {formatRoomLabel(r.room_name || r.room_number)} ({r.room_type || "Room"}) — {avail} of {cap}{" "}
                            available
                          </option>
                        );
                      })}
                  </select>
                </label>
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
                    !roomAssignModal.roomId
                  }
                >
                  {assigningHousehold ? "Saving..." : "Confirm Assignment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Unassign Household Modal */}
      {unassignTarget && (
        <div
          className="modal-overlay"
          onClick={() => !unassigning && setUnassignTarget(null)}
        >
          <div className="bm-dialog bm-dialog-sm" onClick={(e) => e.stopPropagation()}>
            <div className="bm-dialog-header">
              <h4>Unassign Household</h4>
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
                {unassigning ? "Unassigning..." : "Unassign Household"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default BarangayManager;
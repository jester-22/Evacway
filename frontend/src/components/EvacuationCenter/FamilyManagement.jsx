import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeftRight,
  Pencil,
  Plus,
  Search,
  Users,
  X,
} from "lucide-react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faBuilding,
  faCheckCircle,
  faChevronRight,
  faDoorOpen,
  faDownload,
  faEllipsisVertical,
  faEye,
  faFileExcel,
  faHeartPulse,
  faHouse,
  faMagnifyingGlass,
  faPenToSquare,
  faPlus,
  faRightLeft,
  faRotate,
  faShieldHeart,
  faSliders,
  faTrashCan,
  faTriangleExclamation,
  faUser,
  faUserCheck,
  faUserMinus,
  faUserPlus,
  faUsers,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../../services/api";
import {
  fetchRooms,
  invalidateEvacuationQueries,
  queryKeys,
  useEvacuationCenters,
  useFamilies,
  useFamily,
  useRooms,
} from "../../hooks/useEvacuationQueries";
import { displayEntityName } from "../../utils/displayEntityName";
import { formatRoomLabel } from "../../utils/formatRoomLabel";
import { familyTerm, resolveCenterStructureMode } from "./utils";
import LoadingState from "../LoadingState/LoadingState";
import { Button, StatusPill, MobileFilterButton } from "../ui";
import "./FamilyManagement.css";

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const RELATIONSHIP_OPTIONS = [
  "Spouse",
  "Son",
  "Daughter",
  "Child",
  "Parent",
  "Sibling",
  "Grandchild",
  "Other Relative",
  "Other",
];

const SUFFIX_OPTIONS = [
  "Jr.",
  "Sr.",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
];

function getHouseholdInitials(name) {
  if (!name) return "HH";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatHouseholdDisplayCode(code) {
  if (!code) return "FM-001";
  if (typeof code === "string" && code.includes("-")) {
    const parts = code.split("-");
    const lastPart = parts[parts.length - 1];
    if (/^\d+$/.test(lastPart)) {
      return `#${lastPart}`;
    }
  }
  return String(code).length > 16 ? `${String(code).slice(0, 14)}…` : String(code);
}

function emptyMember(isHead = false) {
  return {
    first_name: "",
    middle_name: "",
    last_name: "",
    suffix: "",
    date_of_birth: "",
    gender: "",
    relationship_to_head: isHead ? "Family Head" : "",
    contact_number: "",
    alternate_contact: "",
    is_head_of_family: isHead,
    is_pwd: false,
    disability_type: "",
    disability_notes: "",
    is_pregnant: false,
    is_lactating: false,
    is_solo_parent: false,
    needs_assistance: false,
    vulnerable_members: "",
    medical_notes: "",
    notes: "",
  };
}

function getLocalYesterdayIso() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getLocalMinDobIso() {
  const now = new Date();
  const y = now.getFullYear() - 120;
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function sanitizeNameInput(raw) {
  return String(raw || "").replace(/[^\p{L} .'-]/gu, "");
}

function formatNameOnBlur(raw) {
  const cleaned = sanitizeNameInput(raw).replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.replace(
    /(^|[\s'.-])(\p{L})/gu,
    (_, sep, ch) => `${sep}${ch.toLocaleUpperCase()}`
  );
}

function hasNameLetters(value) {
  return /\p{L}/u.test(String(value || ""));
}

function sanitizePhoneInput(raw) {
  const str = String(raw || "");
  const hasLeadingPlus = str.trimStart().startsWith("+");
  const digits = str.replace(/\D/g, "");
  if (hasLeadingPlus) {
    return `+${digits}`.slice(0, 13);
  }
  return digits.slice(0, 11);
}

function handlePhoneKeyDown(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const allowedKeys = [
    "Backspace",
    "Delete",
    "Tab",
    "Escape",
    "Enter",
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Home",
    "End",
  ];
  if (allowedKeys.includes(event.key)) return;
  if (/^\d$/.test(event.key)) return;
  if (
    event.key === "+" &&
    event.target?.selectionStart === 0 &&
    (!String(event.target?.value || "").includes("+") ||
      (event.target?.selectionEnd || 0) > 0)
  ) {
    return;
  }
  event.preventDefault();
}

function normalizePhPhoneForCompare(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("+63") && trimmed.length === 13) {
    return `0${trimmed.slice(3)}`;
  }
  return trimmed;
}

function normalizeNameForCompare(member) {
  return memberDisplayName(member).replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function memberDisplayName(member) {
  if (!member) return "";
  const parts = [
    member.first_name,
    member.middle_name,
    member.last_name,
    member.suffix,
  ]
    .map((p) => (p ? String(p).trim() : ""))
    .filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  return member.full_name || member.household_head_name || "";
}

function getAge(dateOfBirth) {
  if (!dateOfBirth) return null;
  const [year, month, day] = String(dateOfBirth).split("-").map(Number);
  if (!year || !month || !day) return null;
  const today = new Date();
  let age = today.getFullYear() - year;
  if (
    today.getMonth() + 1 < month ||
    (today.getMonth() + 1 === month && today.getDate() < day)
  ) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

function getExactAge(dateOfBirth) {
  if (!dateOfBirth) return null;
  const parts = String(dateOfBirth).trim().split("-");
  if (parts.length !== 3) return null;
  const [year, month, day] = parts.map(Number);
  if (!year || !month || !day) return null;
  const dobDate = new Date(year, month - 1, day);
  if (
    Number.isNaN(dobDate.getTime()) ||
    dobDate.getFullYear() !== year ||
    dobDate.getMonth() !== month - 1 ||
    dobDate.getDate() !== day
  ) {
    return null;
  }
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (dobDate > today) {
    return -1;
  }
  let age = today.getFullYear() - year;
  if (
    today.getMonth() + 1 < month ||
    (today.getMonth() + 1 === month && today.getDate() < day)
  ) {
    age -= 1;
  }
  return age;
}

function validateDateOfBirth(
  dateOfBirth,
  { isHead = false, relationship = "" } = {}
) {
  if (!dateOfBirth) return "";
  const parts = String(dateOfBirth).trim().split("-");
  if (parts.length !== 3) {
    return "Please enter a valid date of birth.";
  }
  const [year, month, day] = parts.map(Number);
  if (!year || !month || !day) {
    return "Please enter a valid date of birth.";
  }
  const dobDate = new Date(year, month - 1, day);
  if (
    Number.isNaN(dobDate.getTime()) ||
    dobDate.getFullYear() !== year ||
    dobDate.getMonth() !== month - 1 ||
    dobDate.getDate() !== day
  ) {
    return "Please enter a valid date of birth.";
  }
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (dobDate >= today) {
    return "Date of birth must be a past date.";
  }
  const minDobDate = new Date(
    today.getFullYear() - 120,
    today.getMonth(),
    today.getDate()
  );
  if (dobDate < minDobDate) {
    return "Date of birth cannot be more than 120 years ago.";
  }
  const age = getExactAge(dateOfBirth);
  if (age === null) {
    return "Please enter a valid date of birth.";
  }
  if (isHead && age < 18) {
    return "Family head must be at least 18 years old.";
  }
  if (
    String(relationship || "").trim().toLocaleLowerCase() === "spouse" &&
    age < 15
  ) {
    return "A Spouse must be at least 15 years old.";
  }
  return "";
}

function isValidPhMobile(value) {
  if (value == null || String(value).trim() === "") return true;
  const trimmed = String(value).trim();
  return /^(09\d{9}|\+639\d{9})$/.test(trimmed);
}

function focusFirstInvalidField(fieldIds = []) {
  for (const id of fieldIds) {
    const el = document.getElementById(id);
    if (el && typeof el.focus === "function") {
      el.focus();
      if (typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
      return;
    }
  }
}

function getVulnerabilityBadges(member) {
  if (!member) return [];
  const badges = [];
  const age = getAge(member.date_of_birth);
  if (age !== null && age >= 60) badges.push({ label: "Senior Citizen", tone: "amber" });
  if (age !== null && age < 18) badges.push({ label: "Minor / Child", tone: "blue" });
  if (member.is_pwd) badges.push({ label: "PWD", tone: "amber" });
  if (member.is_pregnant) badges.push({ label: "Pregnant", tone: "amber" });
  if (member.is_lactating) badges.push({ label: "Lactating", tone: "blue" });
  if (member.is_solo_parent) badges.push({ label: "Solo Parent", tone: "blue" });
  if (member.needs_assistance) badges.push({ label: "Needs Assistance", tone: "red" });
  if (member.vulnerable_members && badges.length === 0) {
    badges.push({ label: member.vulnerable_members, tone: "amber" });
  }
  return badges;
}

function isFamilyAssigned(fam) {
  if (!fam) return false;
  if (fam.assignment_status === "Assigned") return true;
  if (fam.assignment_status === "Unassigned") return false;
  if (fam.current_room_id) return true;
  if (Number(fam.assigned_members || 0) > 0) return true;
  if (Array.isArray(fam.assignments) && fam.assignments.length > 0) return true;
  if (fam.current_room || fam.rooms || fam.current_center || fam.evacuation_center) return true;
  if (fam.evacuation_status) {
    const s = fam.evacuation_status.toLowerCase();
    if (
      (s.includes("assigned") && !s.includes("not assigned") && !s.includes("unassigned")) ||
      (s.includes("evacuated") && !s.includes("not evacuated"))
    ) {
      return true;
    }
  }
  return false;
}

function getRoomAssignedCount(room) {
  return Number(room?.assigned ?? room?.occupied ?? 0);
}

function getRoomUsedSlots(room) {
  const families = room?.families ?? room?.assigned_families;
  if (room?.used_slots != null) return Number(room.used_slots);
  if (room?.assigned_households != null) return Number(room.assigned_households);
  return Array.isArray(families)
    ? new Set(families.map((family) => String(family.family_id ?? family.id))).size
    : 0;
}

function getRoomAvailableSlots(room) {
  const slots = Math.max(1, Number(room?.family_slots ?? 5));
  if (room?.available_slots != null) return Math.max(Number(room.available_slots), 0);
  return Math.max(slots - getRoomUsedSlots(room), 0);
}

function getRoomRemainingCapacity(room) {
  if (!room) return 0;
  const spaces = Math.max(1, Number(room.people_spaces ?? room.capacity ?? 25));
  if (room.available_spaces != null) return Math.max(Number(room.available_spaces), 0);
  return Math.max(spaces - getRoomAssignedCount(room), 0);
}

function roomCanFitHousehold(room, people = 1) {
  return getRoomAvailableSlots(room) >= 1 && getRoomRemainingCapacity(room) >= Math.max(1, Number(people) || 1);
}

function getCenterAssignedCount(center) {
  return Number(
    center?.assigned ??
      center?.total_assigned ??
      center?.occupied ??
      center?.current_occupancy ??
      0
  );
}

function getCenterRemainingCapacity(center) {
  if (!center) return 0;
  const cap = Number(center.capacity || 0);
  if (center.unassigned != null) return Math.max(Number(center.unassigned), 0);
  return Math.max(cap - getCenterAssignedCount(center), 0);
}

function getFamilyStructureMode(fam) {
  if (!fam) return "buildings_and_rooms";
  const raw = String(
    fam.current_structure_mode || fam.assignments?.[0]?.structure_mode || ""
  )
    .trim()
    .toLowerCase();
  if (["open_area", "rooms_only", "buildings_and_rooms"].includes(raw)) {
    return raw;
  }
  const code = String(
    fam.current_center_type || fam.assignments?.[0]?.center_type || ""
  )
    .trim()
    .toLowerCase();
  if (code === "single_venue") return "open_area";
  if (code === "private_property") return "rooms_only";
  return "buildings_and_rooms";
}

function isDirectVenueCenter(center) {
  if (!center) return false;
  return resolveCenterStructureMode(center) === "open_area";
}

function centerHasBuildings(center, rooms = []) {
  if (!center) return false;
  if (resolveCenterStructureMode(center) !== "buildings_and_rooms") return false;
  if (Array.isArray(center.buildings) && center.buildings.length > 0) return true;
  if (Number(center.building_count || 0) > 0) return true;
  return rooms.some((r) => r.building_id != null);
}

function getAvailableBuildingsForCenter(center, rooms = [], needed = 1) {
  if (!center) return [];
  const bldgMap = new Map();
  for (const b of center.buildings || []) {
    if (b?.id != null && b.status !== "closed" && b.status !== "under_repair") {
      bldgMap.set(String(b.id), {
        id: String(b.id),
        name: b.name || `Building #${b.id}`,
        rooms: [],
        availableSpaces: 0,
      });
    }
  }
  for (const r of rooms) {
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
      if (Number(needed) <= 0 || roomCanFitHousehold(r, needed)) {
        const rem = getRoomRemainingCapacity(r);
        const entry = bldgMap.get(key);
        entry.rooms.push(r);
        entry.availableSpaces += rem;
      }
    }
  }
  const list = Array.from(bldgMap.values()).filter((b) => b.rooms.length > 0);
  const unmappedRooms = rooms.filter(
    (r) => r.building_id == null && (Number(needed) <= 0 || roomCanFitHousehold(r, needed))
  );
  if (unmappedRooms.length > 0) {
    const unmappedSpaces = unmappedRooms.reduce(
      (sum, r) => sum + getRoomRemainingCapacity(r),
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

function getFilteredRoomsForSelection(
  center,
  rooms = [],
  selectedBuildingId = "",
  needed = 1
) {
  if (!center) return [];
  const hasBldgs = centerHasBuildings(center, rooms);
  return rooms.filter((r) => {
    if (Number(needed) > 0 && !roomCanFitHousehold(r, needed)) return false;
    if (!hasBldgs) return true;
    if (!selectedBuildingId) return false;
    if (selectedBuildingId === "unmapped") return r.building_id == null;
    return String(r.building_id) === String(selectedBuildingId);
  });
}

const ADD_STEPS = [
  { number: 1, title: "Family Details", subtitle: "Barangay, address & contacts" },
  { number: 2, title: "Family Head", subtitle: "Head profile & health info" },
  { number: 3, title: "Family Members", subtitle: "Additional members (optional)" },
  { number: 4, title: "Room & Save", subtitle: "Evacuation room & confirm" },
];

function SuccessToastItem({ toast, onRemove }) {
  const [isLeaving, setIsLeaving] = useState(false);
  const remainingMsRef = useRef(4000);
  const startTimeRef = useRef(null);
  const timerRef = useRef(null);
  const fadeTimerRef = useRef(null);

  const clearTimers = () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (fadeTimerRef.current) {
      window.clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
  };

  const triggerFadeOut = () => {
    clearTimers();
    setIsLeaving(true);
    fadeTimerRef.current = window.setTimeout(() => {
      onRemove(toast.id);
    }, 220);
  };

  const startTimer = (ms) => {
    clearTimers();
    startTimeRef.current = Date.now();
    timerRef.current = window.setTimeout(() => {
      triggerFadeOut();
    }, Math.max(0, ms));
  };

  useEffect(() => {
    startTimer(remainingMsRef.current);
    return () => clearTimers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMouseEnter = () => {
    if (isLeaving) {
      clearTimers();
      setIsLeaving(false);
      remainingMsRef.current = Math.max(remainingMsRef.current, 1200);
      return;
    }
    if (startTimeRef.current != null) {
      const elapsed = Date.now() - startTimeRef.current;
      remainingMsRef.current = Math.max(400, remainingMsRef.current - elapsed);
    }
    clearTimers();
  };

  const handleMouseLeave = () => {
    startTimer(remainingMsRef.current);
  };

  return (
    <div
      className={`fm-toast fm-toast-success ${isLeaving ? "is-leaving" : ""}`}
      role="status"
      aria-live="polite"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="fm-toast-content">
        <FontAwesomeIcon icon={faCheckCircle} className="fm-toast-icon" />
        <span className="fm-toast-message">{toast.message}</span>
      </div>
      <button
        type="button"
        className="fm-toast-dismiss"
        onClick={triggerFadeOut}
        aria-label="Dismiss notification"
      >
        Dismiss
      </button>
    </div>
  );
}

export default function FamilyManagement({
  barangays = [],
  availableBuildings = [],
  lockedBarangayId = null,
  lockedBarangayName = "",
  initialFamilyId = null,
  initialStartAdd = false,
  startWithAddFamily = false,
  onInitialStartAddConsumed = null,
  onInitialFamilyConsumed = null,
  onClearInitialAction = null,
  hideListHeader = false,
  hideScreenContent = false,
  compactMobileAllHouseholds = false,
  onBackToBarangays = null,
  onRegisterActions = null,
  onScreenChange = null,
}) {
  const queryClient = useQueryClient();

  const shouldStartAdd = Boolean(initialStartAdd || startWithAddFamily);

  // Navigation state: "list" | "household-detail" | "member-detail"
  const [activeScreen, setActiveScreen] = useState(() => {
    if (initialFamilyId) return "household-detail";
    return "list";
  });
  const [isAddWizardOpen, setIsAddWizardOpen] = useState(() => shouldStartAdd);

  // List filters & pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [barangayFilter, setBarangayFilter] = useState(
    lockedBarangayId ? String(lockedBarangayId) : ""
  );
  const [assignmentStatus, setAssignmentStatus] = useState("");
  const [sortBy, setSortBy] = useState("family_code");
  const [direction, setDirection] = useState("asc");
  const [rosterYears, setRosterYears] = useState([]);
  const [yearFilter, setYearFilter] = useState("2026");

  // Mobile filters sheet & compact card menu state (used when compactMobileAllHouseholds is enabled)
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(max-width: 768px)").matches
      : false
  );
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);
  const [draftMobileFilters, setDraftMobileFilters] = useState({
    yearFilter: "2026",
    barangayFilter: "",
    assignmentStatus: "",
    sortKey: "family_code:asc",
  });
  const [openMobileCardMenuId, setOpenMobileCardMenuId] = useState(null);
  const [detailMenuOpen, setDetailMenuOpen] = useState(false);

  const sectionRef = useRef(null);
  const listTableWrapRef = useRef(null);
  const listMobileCardsRef = useRef(null);
  const savedListScrollRef = useRef({
    tableTop: 0,
    mobileTop: 0,
    pageTop: 0,
    contentTop: 0,
    windowTop: 0,
  });
  const shouldRestoreListScrollRef = useRef(false);
  const shouldResetDetailScrollRef = useRef(false);

  const defaultYearFilter = useMemo(() => {
    const active = rosterYears.find((y) => y.is_active);
    return active ? String(active.year) : "2026";
  }, [rosterYears]);

  const activeMobileFilterCount = useMemo(() => {
    let count = 0;
    if (yearFilter !== defaultYearFilter) count += 1;
    if (!lockedBarangayId && barangayFilter) count += 1;
    if (assignmentStatus) count += 1;
    if (sortBy !== "family_code" || direction !== "asc") count += 1;
    return count;
  }, [
    yearFilter,
    defaultYearFilter,
    lockedBarangayId,
    barangayFilter,
    assignmentStatus,
    sortBy,
    direction,
  ]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }
    const mq = window.matchMedia("(max-width: 768px)");
    const handleChange = (e) => {
      setIsMobileViewport(e.matches);
      if (!e.matches) {
        setIsMobileFiltersOpen(false);
        setOpenMobileCardMenuId(null);
        setDetailMenuOpen(false);
      }
    };
    setIsMobileViewport(mq.matches);
    mq.addEventListener("change", handleChange);
    return () => mq.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (!openMobileCardMenuId) return undefined;
    const handleOutside = (e) => {
      if (!e.target.closest?.(".fm-mobile-card-menu-wrap")) {
        setOpenMobileCardMenuId(null);
      }
    };
    const handleEsc = (e) => {
      if (e.key === "Escape") setOpenMobileCardMenuId(null);
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [openMobileCardMenuId]);

  useEffect(() => {
    if (!detailMenuOpen) return undefined;
    const handleOutside = (e) => {
      if (!e.target.closest?.(".fm-detail-menu-wrap")) {
        setDetailMenuOpen(false);
      }
    };
    const handleEsc = (e) => {
      if (e.key === "Escape") setDetailMenuOpen(false);
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [detailMenuOpen]);

  useEffect(() => {
    if (!isMobileFiltersOpen) return undefined;
    const handleEsc = (e) => {
      if (e.key === "Escape") setIsMobileFiltersOpen(false);
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [isMobileFiltersOpen]);

  function openMobileFiltersSheet() {
    setDraftMobileFilters({
      yearFilter,
      barangayFilter,
      assignmentStatus,
      sortKey: `${sortBy}:${direction}`,
    });
    setIsMobileFiltersOpen(true);
  }

  function applyMobileFilters() {
    const [nextSort, nextDir] = String(
      draftMobileFilters.sortKey || "family_code:asc"
    ).split(":");
    setYearFilter(draftMobileFilters.yearFilter ?? "");
    setBarangayFilter(
      lockedBarangayId ? String(lockedBarangayId) : draftMobileFilters.barangayFilter ?? ""
    );
    setAssignmentStatus(draftMobileFilters.assignmentStatus ?? "");
    setSortBy(nextSort || "family_code");
    setDirection(nextDir || "asc");
    setPage(1);
    setIsMobileFiltersOpen(false);
  }

  function resetMobileFilters() {
    const nextBrgy = lockedBarangayId ? String(lockedBarangayId) : "";
    const resetValues = {
      yearFilter: defaultYearFilter,
      barangayFilter: nextBrgy,
      assignmentStatus: "",
      sortKey: "family_code:asc",
    };
    setDraftMobileFilters(resetValues);
    setYearFilter(defaultYearFilter);
    setBarangayFilter(nextBrgy);
    setAssignmentStatus("");
    setSortBy("family_code");
    setDirection("asc");
    setPage(1);
    setIsMobileFiltersOpen(false);
  }

  useEffect(() => {
    let isMounted = true;
    api.getRosterYears()
      .then((data) => {
        if (!isMounted) return;
        const list = Array.isArray(data) ? data : [];
        setRosterYears(list);
        const active = list.find((y) => y.is_active);
        if (active) {
          setYearFilter(String(active.year));
        }
      })
      .catch((err) => console.error("Failed to load roster years in FamilyManagement:", err));
    return () => {
      isMounted = false;
    };
  }, []);

  // Feedback banners & toast notifications
  const [localError, setError] = useState("");
  const [toasts, setToasts] = useState([]);
  const toastSeqRef = useRef(0);

  function removeToast(toastId) {
    setToasts((prev) => prev.filter((t) => t.id !== toastId));
  }

  function setNotice(msg) {
    if (!msg) return;
    toastSeqRef.current += 1;
    const id = `${Date.now()}-${toastSeqRef.current}`;
    setToasts((prev) => [...prev, { id, message: String(msg) }]);
  }

  // Selected Household & Member IDs (always derived from React Query)
  const [selectedFamilyId, setSelectedFamilyId] = useState(
    initialFamilyId ? Number(initialFamilyId) : null
  );
  const [selectedFamilySeed, setSelectedFamilySeed] = useState(null);
  const [selectedMemberId, setSelectedMemberId] = useState(null);

  useEffect(() => {
    if (initialFamilyId && onInitialFamilyConsumed) {
      onInitialFamilyConsumed();
    }
    if (shouldStartAdd) {
      setIsAddWizardOpen(true);
      if (onInitialStartAddConsumed) {
        onInitialStartAddConsumed();
      }
    }
    if ((initialFamilyId || shouldStartAdd) && onClearInitialAction) {
      onClearInitialAction();
    }
  }, [
    initialFamilyId,
    shouldStartAdd,
    onInitialFamilyConsumed,
    onInitialStartAddConsumed,
    onClearInitialAction,
  ]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  const effectiveBarangayId = lockedBarangayId
    ? String(lockedBarangayId)
    : barangayFilter;

  const familyFilters = useMemo(
    () => ({
      page,
      per_page: pageSize,
      search,
      barangay_id: effectiveBarangayId,
      assignment_status: assignmentStatus,
      year: yearFilter,
      sort_by: sortBy,
      direction,
    }),
    [page, pageSize, search, effectiveBarangayId, assignmentStatus, yearFilter, sortBy, direction]
  );

  const familiesQuery = useFamilies(familyFilters);
  const families = useMemo(
    () => familiesQuery.data?.items || [],
    [familiesQuery.data?.items]
  );
  const total = familiesQuery.data?.total || 0;
  const pages = Math.max(1, familiesQuery.data?.pages || 1);
  const loading = familiesQuery.isLoading;

  // Modals for quick actions ("edit-household" | "member-form" | "assign" | "move" | "import" | "")
  const [modal, setModal] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [confirmDialog, setConfirmDialog] = useState(null);

  const familyDetailQuery = useFamily(selectedFamilyId, {
    enabled:
      selectedFamilyId != null &&
      (activeScreen === "household-detail" ||
        activeScreen === "member-detail" ||
        modal === "edit-household" ||
        modal === "member-form"),
  });

  const activeFamily = useMemo(() => {
    if (familyDetailQuery.data) return familyDetailQuery.data;
    const fromList = families.find((f) => Number(f.id) === Number(selectedFamilyId));
    return fromList || selectedFamilySeed || null;
  }, [familyDetailQuery.data, families, selectedFamilyId, selectedFamilySeed]);

  const activeMember = useMemo(() => {
    if (!activeFamily?.members || selectedMemberId == null) return null;
    return (
      activeFamily.members.find((m) => Number(m.id) === Number(selectedMemberId)) ||
      null
    );
  }, [activeFamily, selectedMemberId]);

  // 3-Step Add Family Wizard State
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardTouched, setWizardTouched] = useState({});
  const [memberDraftTouched, setMemberDraftTouched] = useState({});
  const [wizardForm, setWizardForm] = useState({
    barangay_id: lockedBarangayId ? String(lockedBarangayId) : "",
    family_code: "",
    address: "",
    contact_number: "",
    alternate_contact: "",
    remarks: "",
    head: emptyMember(true),
    otherMembers: [],
    assignment_mode: "unassigned", // "unassigned" | "assign"
    assignment_center_id: "",
    assignment_building_id: "",
    assignment_room_id: "",
  });
  const [editingOtherIndex, setEditingOtherIndex] = useState(null);
  const [memberDraft, setMemberDraft] = useState(null);

  // Edit Household Form
  const [editHouseholdForm, setEditHouseholdForm] = useState({
    head_name: "",
    head_resident_id: "",
    barangay_id: "",
    contact_number: "",
    alternate_contact: "",
    address: "",
    remarks: "",
  });
  const [editHouseholdInitial, setEditHouseholdInitial] = useState(null);
  const [editHouseholdTouched, setEditHouseholdTouched] = useState({});

  // Add / Edit Individual Member Modal State (from Page D / Page E)
  const [memberModalMode, setMemberModalMode] = useState("add"); // "add" | "edit"
  const [memberModalTargetId, setMemberModalTargetId] = useState(null);
  const [memberModalForm, setMemberModalForm] = useState(emptyMember(false));
  const [memberModalInitial, setMemberModalInitial] = useState(null);
  const [memberModalTouched, setMemberModalTouched] = useState({});
  const modalBodyRef = useRef(null);

  // Assign / Move Room Modal State
  const [assignCenterId, setAssignCenterId] = useState("");
  const [assignBuildingId, setAssignBuildingId] = useState("");
  const [assignRoomId, setAssignRoomId] = useState("");
  const [assigning, setAssigning] = useState(false);

  const [targetCenterId, setTargetCenterId] = useState("");
  const [targetBuildingId, setTargetBuildingId] = useState("");
  const [targetRoomId, setTargetRoomId] = useState("");
  const [moving, setMoving] = useState(false);


  // Evacuation Centers & Rooms Queries
  const centersQuery = useEvacuationCenters(false, {
    enabled:
      activeScreen === "list" ||
      isAddWizardOpen ||
      modal === "assign" ||
      modal === "move",
  });
  const centersList = useMemo(() => {
    const raw = (centersQuery.data?.features || []).map(
      (feature) => feature.properties || feature
    );
    const preferredBarangayId =
      isAddWizardOpen
        ? wizardForm.barangay_id
        : activeFamily?.barangay_id || effectiveBarangayId;
    if (!preferredBarangayId) return raw;
    return raw
      .filter((center) =>
        (center.barangays || []).some(
          (barangay) => Number(barangay.id) === Number(preferredBarangayId)
        )
      )
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  }, [
    centersQuery.data,
    isAddWizardOpen,
    wizardForm.barangay_id,
    activeFamily?.barangay_id,
    effectiveBarangayId,
  ]);

  const wizardRoomsQuery = useRooms(
    wizardForm.assignment_center_id
      ? Number(wizardForm.assignment_center_id)
      : null,
    {
      enabled:
        isAddWizardOpen &&
        wizardForm.assignment_mode === "assign" &&
        Boolean(wizardForm.assignment_center_id),
    }
  );
  const wizardRooms = (wizardRoomsQuery.data || []).filter(
    (room) => room.is_active !== false
  );

  const assignRoomsQuery = useRooms(
    assignCenterId ? Number(assignCenterId) : null,
    { enabled: modal === "assign" && Boolean(assignCenterId) }
  );
  const assignRooms = (assignRoomsQuery.data || []).filter(
    (room) => room.is_active !== false
  );

  const targetRoomsQuery = useRooms(
    targetCenterId ? Number(targetCenterId) : null,
    { enabled: modal === "move" && Boolean(targetCenterId) }
  );
  const currentRoomId =
    activeFamily?.current_room_id || activeFamily?.assignments?.[0]?.room_id;
  const targetRooms = (targetRoomsQuery.data || [])
    .filter((room) => room.is_active !== false)
    .filter(
      (room) => !currentRoomId || String(room.id) !== String(currentRoomId)
    );

  const error =
    localError ||
    familiesQuery.error?.message ||
    (activeScreen !== "list" ? familyDetailQuery.error?.message : "") ||
    "";

  function forceCloseModal() {
    setModal("");
    setError("");
    setEditHouseholdInitial(null);
    setEditHouseholdTouched({});
    setMemberModalInitial(null);
    setMemberModalTouched({});
    setAssignCenterId("");
    setAssignBuildingId("");
    setAssignRoomId("");
    setTargetCenterId("");
    setTargetBuildingId("");
    setTargetRoomId("");
  }

  const isEditHouseholdDirty = useMemo(() => {
    if (modal !== "edit-household" || !editHouseholdInitial) return false;
    return (
      String(editHouseholdForm.head_resident_id || "") !==
        String(editHouseholdInitial.head_resident_id || "") ||
      String(editHouseholdForm.barangay_id || "") !==
        String(editHouseholdInitial.barangay_id || "") ||
      String(editHouseholdForm.address || "") !==
        String(editHouseholdInitial.address || "") ||
      String(editHouseholdForm.contact_number || "") !==
        String(editHouseholdInitial.contact_number || "") ||
      String(editHouseholdForm.alternate_contact || "") !==
        String(editHouseholdInitial.alternate_contact || "") ||
      String(editHouseholdForm.remarks || "") !==
        String(editHouseholdInitial.remarks || "")
    );
  }, [modal, editHouseholdForm, editHouseholdInitial]);

  const isMemberModalDirty = useMemo(() => {
    if (modal !== "member-form" || !memberModalInitial) return false;
    const keys = [
      "first_name",
      "middle_name",
      "last_name",
      "suffix",
      "date_of_birth",
      "gender",
      "relationship_to_head",
      "contact_number",
      "is_head_of_family",
      "is_pwd",
      "disability_type",
      "disability_notes",
      "is_pregnant",
      "is_lactating",
      "is_solo_parent",
      "needs_assistance",
      "vulnerable_members",
      "medical_notes",
      "notes",
    ];
    return keys.some((k) => {
      const a = memberModalForm[k];
      const b = memberModalInitial[k];
      if (typeof b === "boolean" || typeof a === "boolean") {
        return Boolean(a) !== Boolean(b);
      }
      return String(a ?? "") !== String(b ?? "");
    });
  }, [modal, memberModalForm, memberModalInitial]);

  const isActiveModalDirty =
    modal === "edit-household"
      ? isEditHouseholdDirty
      : modal === "member-form"
        ? isMemberModalDirty
        : false;

  function closeModal() {
    if (saving || assigning || moving) return;
    if (isActiveModalDirty) {
      setConfirmDialog({
        title: "Discard unsaved changes?",
        message:
          "You have unsaved changes. Are you sure you want to close without saving?",
        confirmText: "Discard Changes",
        cancelText: "Keep Editing",
        danger: true,
        onConfirm: () => {
          setConfirmDialog(null);
          forceCloseModal();
        },
      });
      return;
    }
    forceCloseModal();
  }

  useEffect(() => {
    if (!modal && !confirmDialog) return undefined;
    const handleEsc = (e) => {
      if (e.key !== "Escape") return;
      if (confirmDialog) {
        if (!saving) setConfirmDialog(null);
        return;
      }
      if (modal) {
        closeModal();
      }
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  });

  function handleModalFormKeyDown(event) {
    if (event.key !== "Enter") return;
    const tag = event.target?.tagName?.toLowerCase();
    if (tag === "textarea" || tag === "button") return;
    if (event.target?.type?.toLowerCase() === "submit") return;
    event.preventDefault();
  }

  function handlePhonePaste(event, applyValue) {
    const pasted = event.clipboardData?.getData("text");
    if (pasted == null) return;
    event.preventDefault();
    const input = event.target;
    const current = String(input?.value || "");
    const start = input?.selectionStart ?? current.length;
    const end = input?.selectionEnd ?? current.length;
    const merged = `${current.slice(0, start)}${pasted}${current.slice(end)}`;
    applyValue(sanitizePhoneInput(merged));
  }

  function handleNamePaste(event, applyValue) {
    const pasted = event.clipboardData?.getData("text");
    if (pasted == null) return;
    event.preventDefault();
    const input = event.target;
    const current = String(input?.value || "");
    const start = input?.selectionStart ?? current.length;
    const end = input?.selectionEnd ?? current.length;
    const merged = `${current.slice(0, start)}${sanitizeNameInput(pasted)}${current.slice(end)}`;
    applyValue(sanitizeNameInput(merged));
  }

  async function refreshAllData(familyIdToKeep = null) {
    await invalidateEvacuationQueries(queryClient);
    if (familyIdToKeep) {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.family(familyIdToKeep),
      });
    }
  }

  // =========================================================
  // NAVIGATION HANDLERS
  // =========================================================
  function captureListScrollPosition() {
    const sectionEl = sectionRef.current;
    const pageEl = sectionEl?.closest?.(".barangay-page") || null;
    const contentEl = sectionEl?.closest?.(".dashboard-content") || null;
    savedListScrollRef.current = {
      tableTop: listTableWrapRef.current?.scrollTop ?? 0,
      mobileTop: listMobileCardsRef.current?.scrollTop ?? 0,
      pageTop: pageEl?.scrollTop ?? 0,
      contentTop: contentEl?.scrollTop ?? 0,
      windowTop: typeof window !== "undefined" ? window.scrollY : 0,
    };
  }

  function openHouseholdDetails(family) {
    captureListScrollPosition();
    shouldRestoreListScrollRef.current = true;
    shouldResetDetailScrollRef.current = true;
    setDetailMenuOpen(false);
    setSelectedFamilySeed(family);
    setSelectedFamilyId(family.id);
    setSelectedMemberId(null);
    setError("");
    setActiveScreen("household-detail");
  }

  function openMemberDetails(member) {
    setDetailMenuOpen(false);
    setSelectedMemberId(member.id);
    setError("");
    setActiveScreen("member-detail");
  }

  function backToHouseholdList() {
    setDetailMenuOpen(false);
    setActiveScreen("list");
    setSelectedMemberId(null);
    setError("");
  }

  useLayoutEffect(() => {
    if (hideScreenContent) return undefined;
    const sectionEl = sectionRef.current;
    const pageEl = sectionEl?.closest?.(".barangay-page") || null;
    const contentEl = sectionEl?.closest?.(".dashboard-content") || null;

    if (activeScreen === "household-detail" && shouldResetDetailScrollRef.current) {
      shouldResetDetailScrollRef.current = false;
      if (pageEl) pageEl.scrollTop = 0;
      if (contentEl) contentEl.scrollTop = 0;
      if (typeof window !== "undefined") window.scrollTo(0, 0);
      return undefined;
    }

    if (activeScreen === "list" && shouldRestoreListScrollRef.current) {
      shouldRestoreListScrollRef.current = false;
      const saved = savedListScrollRef.current;
      const applyScroll = () => {
        if (listTableWrapRef.current) {
          listTableWrapRef.current.scrollTop = saved.tableTop;
        }
        if (listMobileCardsRef.current) {
          listMobileCardsRef.current.scrollTop = saved.mobileTop;
        }
        if (pageEl) pageEl.scrollTop = saved.pageTop;
        if (contentEl) contentEl.scrollTop = saved.contentTop;
        if (typeof window !== "undefined" && saved.windowTop > 0) {
          window.scrollTo(0, saved.windowTop);
        }
      };
      applyScroll();
      const rafId =
        typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"
          ? window.requestAnimationFrame(applyScroll)
          : null;
      return () => {
        if (rafId !== null && typeof window.cancelAnimationFrame === "function") {
          window.cancelAnimationFrame(rafId);
        }
      };
    }

    return undefined;
  }, [activeScreen, hideScreenContent]);

  function backToHouseholdDetails() {
    setActiveScreen("household-detail");
    setSelectedMemberId(null);
    setError("");
  }

  // =========================================================
  // 3-STEP ADD FAMILY WIZARD HANDLERS
  // =========================================================
  function openAddFamilyWizard() {
    const defaultBrgyId = lockedBarangayId
      ? String(lockedBarangayId)
      : barangayFilter || "";
    setWizardForm({
      barangay_id: defaultBrgyId,
      family_code: "",
      address: "",
      contact_number: "",
      alternate_contact: "",
      remarks: "",
      head: emptyMember(true),
      otherMembers: [],
      assignment_mode: "unassigned",
      assignment_center_id: "",
      assignment_building_id: "",
      assignment_room_id: "",
    });
    setWizardStep(1);
    setWizardTouched({});
    setMemberDraftTouched({});
    setEditingOtherIndex(null);
    setMemberDraft(null);
    setError("");
    setNotice("");
    setIsAddWizardOpen(true);
  }

  function hasUnsavedWizardChanges() {
    const defaultBrgyId = lockedBarangayId
      ? String(lockedBarangayId)
      : barangayFilter || "";
    const head = wizardForm.head;
    const headHasData =
      Boolean(head.first_name.trim()) ||
      Boolean(head.middle_name.trim()) ||
      Boolean(head.last_name.trim()) ||
      Boolean(head.suffix.trim()) ||
      Boolean(head.date_of_birth) ||
      Boolean(head.gender) ||
      Boolean(head.contact_number.trim()) ||
      Boolean(head.alternate_contact.trim()) ||
      Boolean(head.is_pwd) ||
      Boolean(head.disability_type.trim()) ||
      Boolean(head.disability_notes.trim()) ||
      Boolean(head.is_pregnant) ||
      Boolean(head.is_lactating) ||
      Boolean(head.is_solo_parent) ||
      Boolean(head.needs_assistance) ||
      Boolean(head.vulnerable_members.trim()) ||
      Boolean(head.medical_notes.trim()) ||
      Boolean(head.notes.trim());

    return (
      (!lockedBarangayId &&
        String(wizardForm.barangay_id || "") !== String(defaultBrgyId)) ||
      Boolean(wizardForm.family_code.trim()) ||
      Boolean(wizardForm.address.trim()) ||
      Boolean(wizardForm.contact_number.trim()) ||
      Boolean(wizardForm.alternate_contact.trim()) ||
      Boolean(wizardForm.remarks.trim()) ||
      headHasData ||
      wizardForm.otherMembers.length > 0 ||
      editingOtherIndex !== null ||
      wizardForm.assignment_mode !== "unassigned" ||
      Boolean(wizardForm.assignment_center_id) ||
      Boolean(wizardForm.assignment_building_id) ||
      Boolean(wizardForm.assignment_room_id)
    );
  }

  function closeAddFamilyWizard() {
    setIsAddWizardOpen(false);
    setWizardTouched({});
    setMemberDraftTouched({});
    setEditingOtherIndex(null);
    setMemberDraft(null);
    setError("");
  }

  function requestCloseAddWizard() {
    if (saving) return;
    if (hasUnsavedWizardChanges()) {
      setConfirmDialog({
        title: "Discard Unsaved Changes?",
        message:
          "You have unsaved changes in the Add Family form. Are you sure you want to close and discard your changes?",
        confirmText: "Discard Changes",
        cancelText: "Keep Editing",
        danger: true,
        onConfirm: () => {
          setConfirmDialog(null);
          closeAddFamilyWizard();
        },
      });
      return;
    }
    closeAddFamilyWizard();
  }

  useEffect(() => {
    if (!isAddWizardOpen && !confirmDialog && !modal) return undefined;
    function handleKeyDown(event) {
      if (event.key !== "Escape") return;
      if (confirmDialog) {
        event.stopPropagation();
        setConfirmDialog(null);
        return;
      }
      if (modal) {
        event.stopPropagation();
        closeModal();
        return;
      }
      if (isAddWizardOpen) {
        event.stopPropagation();
        requestCloseAddWizard();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  function touchWizardField(fieldKey) {
    setWizardTouched((prev) =>
      prev[fieldKey] ? prev : { ...prev, [fieldKey]: true }
    );
  }

  function touchMemberDraftField(fieldKey) {
    setMemberDraftTouched((prev) =>
      prev[fieldKey] ? prev : { ...prev, [fieldKey]: true }
    );
  }

  function updateWizardHead(field, value) {
    setWizardForm((prev) => ({
      ...prev,
      head: {
        ...prev.head,
        [field]: value,
        is_head_of_family: true,
        relationship_to_head: "Family Head",
      },
    }));
  }

  function startAddOtherMember() {
    setError("");
    setMemberDraftTouched({});
    setEditingOtherIndex("new");
    setMemberDraft(emptyMember(false));
  }

  function startEditOtherMember(index) {
    setError("");
    setMemberDraftTouched({});
    setEditingOtherIndex(index);
    setMemberDraft({ ...wizardForm.otherMembers[index] });
  }

  function cancelOtherMemberDraft() {
    setEditingOtherIndex(null);
    setMemberDraft(null);
    setMemberDraftTouched({});
    setError("");
  }

  const wizardStep1Errors = useMemo(() => {
    const errs = {};
    if (!String(wizardForm.barangay_id || "").trim()) {
      errs.barangay_id = "Barangay is required.";
    }
    if (!String(wizardForm.address || "").trim()) {
      errs.address = "Complete family address is required.";
    }
    if (
      String(wizardForm.contact_number || "").length > 0 &&
      !isValidPhMobile(wizardForm.contact_number)
    ) {
      errs.contact_number =
        "Enter a valid PH mobile number (e.g. 09171234567).";
    }
    if (
      String(wizardForm.alternate_contact || "").length > 0 &&
      !isValidPhMobile(wizardForm.alternate_contact)
    ) {
      errs.alternate_contact =
        "Enter a valid PH mobile number (e.g. 09171234567).";
    }
    return errs;
  }, [
    wizardForm.barangay_id,
    wizardForm.address,
    wizardForm.contact_number,
    wizardForm.alternate_contact,
  ]);

  const wizardStep2Errors = useMemo(() => {
    const errs = {};
    const head = wizardForm.head;
    if (!String(head.first_name || "").trim()) {
      errs["head.first_name"] = "First name is required.";
    }
    if (
      String(head.middle_name || "").length > 0 &&
      !String(head.middle_name).trim()
    ) {
      errs["head.middle_name"] = "Middle name cannot contain only spaces.";
    }
    if (!String(head.last_name || "").trim()) {
      errs["head.last_name"] = "Last name is required.";
    }
    if (!head.date_of_birth) {
      errs["head.date_of_birth"] = "Date of birth is required.";
    } else {
      const headDobError = validateDateOfBirth(head.date_of_birth, {
        isHead: true,
      });
      if (headDobError) {
        errs["head.date_of_birth"] = headDobError;
      }
    }
    if (!["Male", "Female"].includes(String(head.gender || "").trim())) {
      errs["head.gender"] = "Select a gender";
    }
    if (
      String(head.contact_number || "").length > 0 &&
      !isValidPhMobile(head.contact_number)
    ) {
      errs["head.contact_number"] =
        "Enter a valid PH mobile number (e.g. 09171234567).";
    }
    return errs;
  }, [wizardForm.head]);

  const memberDraftErrors = useMemo(() => {
    if (!memberDraft) return {};
    const errs = {};
    const first = String(memberDraft.first_name || "").trim();
    const last = String(memberDraft.last_name || "").trim();
    if (!first) {
      errs.first_name = "First name is required.";
    }
    if (
      String(memberDraft.middle_name || "").length > 0 &&
      !String(memberDraft.middle_name).trim()
    ) {
      errs.middle_name = "Middle name cannot contain only spaces.";
    }
    if (!last) {
      errs.last_name = "Last name is required.";
    }
    if (first && last) {
      const candidateName = memberDisplayName({
        ...memberDraft,
        first_name: first,
        middle_name: String(memberDraft.middle_name || "").trim(),
        last_name: last,
      })
        .trim()
        .toLocaleLowerCase();
      const headName = memberDisplayName(wizardForm.head)
        .trim()
        .toLocaleLowerCase();
      if (candidateName === headName) {
        errs.first_name =
          "This member has the same full name as the family head.";
      } else {
        const duplicateInOthers = wizardForm.otherMembers.some((m, idx) => {
          if (editingOtherIndex !== "new" && idx === editingOtherIndex) {
            return false;
          }
          return (
            memberDisplayName(m).trim().toLocaleLowerCase() === candidateName
          );
        });
        if (duplicateInOthers) {
          errs.first_name =
            "Another family member with this full name is already added.";
        }
      }
    }
    const dobError = validateDateOfBirth(memberDraft.date_of_birth, {
      isHead: false,
      relationship: memberDraft.relationship_to_head,
    });
    if (dobError) {
      errs.date_of_birth = dobError;
    }
    if (!["Male", "Female"].includes(String(memberDraft.gender || "").trim())) {
      errs.gender = "Select a gender";
    }
    const rel = String(memberDraft.relationship_to_head || "").trim();
    if (!rel) {
      errs.relationship_to_head = "Relationship to head is required.";
    } else if (
      rel.toLocaleLowerCase() === "family head" ||
      rel.toLocaleLowerCase() === "self"
    ) {
      errs.relationship_to_head =
        "Relationship cannot be Family Head since the head is already set.";
    }
    if (
      String(memberDraft.contact_number || "").length > 0 &&
      !isValidPhMobile(memberDraft.contact_number)
    ) {
      errs.contact_number =
        "Enter a valid PH mobile number (e.g. 09171234567).";
    }
    return errs;
  }, [memberDraft, wizardForm.head, wizardForm.otherMembers, editingOtherIndex]);

  const wizardStep4Errors = useMemo(() => {
    const errs = {};
    if (
      wizardForm.assignment_mode === "assign" ||
      wizardForm.assignment_mode === "venue"
    ) {
      if (!wizardForm.assignment_center_id) {
        errs.assignment_center_id = "Please select an evacuation center.";
        return errs;
      }
      const selectedCenter = centersList.find(
        (c) => String(c.id) === String(wizardForm.assignment_center_id)
      );
      const totalMembersCount = 1 + wizardForm.otherMembers.length;
      const isDirectCenter =
        wizardForm.assignment_mode === "venue" ||
        isDirectVenueCenter(
          selectedCenter,
          wizardRooms,
          wizardRoomsQuery.isLoading
        );

      if (isDirectCenter) {
        const available = getCenterRemainingCapacity(selectedCenter);
        if (selectedCenter && available <= 0) {
          errs.assignment_center_id =
            "Selected evacuation center is full. Please choose another center.";
        } else if (selectedCenter && totalMembersCount > available) {
          errs.assignment_center_id = `Selected center only has ${available} available space(s), but this family has ${totalMembersCount} member(s).`;
        }
        return errs;
      }

      const hasBldgs = centerHasBuildings(selectedCenter, wizardRooms);
      if (hasBldgs && !wizardForm.assignment_building_id) {
        errs.assignment_building_id = "Please select a building.";
      }
      if (!wizardForm.assignment_room_id) {
        if (!hasBldgs || wizardForm.assignment_building_id) {
          errs.assignment_room_id = "Please select a room.";
        }
      } else {
        const selectedRoom = wizardRooms.find(
          (r) => String(r.id) === String(wizardForm.assignment_room_id)
        );
        if (selectedRoom) {
          const available = getRoomRemainingCapacity(selectedRoom);
          const availableSlots = getRoomAvailableSlots(selectedRoom);
          if (availableSlots < 1) errs.assignment_room_id = "Selected room has no family slots available. Please choose another room.";
          else if (totalMembersCount > available) errs.assignment_room_id = `Selected room only has ${available} people space(s) available, but this family has ${totalMembersCount} member(s).`;
        }
      }
    }
    return errs;
  }, [
    wizardForm.assignment_mode,
    wizardForm.assignment_center_id,
    wizardForm.assignment_building_id,
    wizardForm.assignment_room_id,
    wizardForm.otherMembers.length,
    centersList,
    wizardRooms,
    wizardRoomsQuery.isLoading,
  ]);

  function saveOtherMemberDraft() {
    if (!memberDraft) return;
    setMemberDraftTouched({
      first_name: true,
      middle_name: true,
      last_name: true,
      date_of_birth: true,
      gender: true,
      relationship_to_head: true,
      contact_number: true,
    });
    const draftFieldMap = [
      ["first_name", "fm-draft-first-name"],
      ["middle_name", "fm-draft-middle-name"],
      ["last_name", "fm-draft-last-name"],
      ["date_of_birth", "fm-draft-dob"],
      ["gender", "fm-draft-gender"],
      ["relationship_to_head", "fm-draft-relationship"],
      ["contact_number", "fm-draft-contact"],
    ];
    const invalidDraftIds = draftFieldMap
      .filter(([key]) => Boolean(memberDraftErrors[key]))
      .map(([, domId]) => domId);

    if (invalidDraftIds.length > 0) {
      focusFirstInvalidField(invalidDraftIds);
      return;
    }

    const first = memberDraft.first_name.trim();
    const last = memberDraft.last_name.trim();
    const cleanedMember = {
      ...memberDraft,
      first_name: first,
      middle_name: memberDraft.middle_name.trim(),
      last_name: last,
      suffix: memberDraft.suffix.trim(),
      relationship_to_head:
        memberDraft.relationship_to_head.trim() || "Spouse",
      is_head_of_family: false,
    };

    setWizardForm((prev) => {
      const nextOthers = [...prev.otherMembers];
      if (editingOtherIndex === "new") {
        nextOthers.push(cleanedMember);
      } else if (typeof editingOtherIndex === "number") {
        nextOthers[editingOtherIndex] = cleanedMember;
      }
      return { ...prev, otherMembers: nextOthers };
    });
    setEditingOtherIndex(null);
    setMemberDraft(null);
    setMemberDraftTouched({});
    setError("");
  }

  function removeOtherMember(index) {
    setWizardForm((prev) => ({
      ...prev,
      otherMembers: prev.otherMembers.filter((_, idx) => idx !== index),
    }));
    if (editingOtherIndex === index) {
      setEditingOtherIndex(null);
      setMemberDraft(null);
      setMemberDraftTouched({});
    }
  }

  function validateWizardStep(step) {
    setError("");
    if (step === 1) {
      setWizardTouched((prev) => ({
        ...prev,
        barangay_id: true,
        address: true,
        contact_number: true,
        alternate_contact: true,
      }));
      const step1FieldMap = [
        ["barangay_id", "fm-wizard-barangay"],
        ["address", "fm-wizard-address"],
        ["contact_number", "fm-wizard-contact"],
        ["alternate_contact", "fm-wizard-alt-contact"],
      ];
      const invalidIds = step1FieldMap
        .filter(([key]) => Boolean(wizardStep1Errors[key]))
        .map(([, domId]) => domId);

      if (invalidIds.length > 0) {
        focusFirstInvalidField(invalidIds);
        return false;
      }
      return true;
    }

    if (step === 2) {
      setWizardTouched((prev) => ({
        ...prev,
        "head.first_name": true,
        "head.middle_name": true,
        "head.last_name": true,
        "head.date_of_birth": true,
        "head.gender": true,
        "head.contact_number": true,
      }));
      const step2FieldMap = [
        ["head.first_name", "fm-head-first-name"],
        ["head.middle_name", "fm-head-middle-name"],
        ["head.last_name", "fm-head-last-name"],
        ["head.date_of_birth", "fm-head-dob"],
        ["head.gender", "fm-head-gender"],
        ["head.contact_number", "fm-head-contact"],
      ];
      const invalidIds = step2FieldMap
        .filter(([key]) => Boolean(wizardStep2Errors[key]))
        .map(([, domId]) => domId);

      if (invalidIds.length > 0) {
        focusFirstInvalidField(invalidIds);
        return false;
      }
      return true;
    }

    if (step === 3) {
      if (editingOtherIndex !== null) {
        setMemberDraftTouched({
          first_name: true,
          middle_name: true,
          last_name: true,
          date_of_birth: true,
          gender: true,
          relationship_to_head: true,
          contact_number: true,
        });
        const draftFieldMap = [
          ["first_name", "fm-draft-first-name"],
          ["middle_name", "fm-draft-middle-name"],
          ["last_name", "fm-draft-last-name"],
          ["date_of_birth", "fm-draft-dob"],
          ["gender", "fm-draft-gender"],
          ["relationship_to_head", "fm-draft-relationship"],
          ["contact_number", "fm-draft-contact"],
        ];
        const invalidDraftIds = draftFieldMap
          .filter(([key]) => Boolean(memberDraftErrors[key]))
          .map(([, domId]) => domId);
        if (invalidDraftIds.length > 0) {
          focusFirstInvalidField(invalidDraftIds);
        } else {
          focusFirstInvalidField(["fm-draft-save-btn", "fm-draft-first-name"]);
        }
        setError(
          "Please save or cancel the member form you are currently editing before continuing."
        );
        return false;
      }

      for (const m of wizardForm.otherMembers) {
        if (!String(m.first_name || "").trim() || !String(m.last_name || "").trim()) {
          setError("All family members must have a valid first and last name.");
          return false;
        }
        const mDobErr = validateDateOfBirth(m.date_of_birth, { isHead: false });
        if (mDobErr) {
          setError(mDobErr);
          return false;
        }
        if (!["Male", "Female"].includes(String(m.gender || "").trim())) {
          setError("Select a gender");
          return false;
        }
        const rel = String(m.relationship_to_head || "").trim().toLocaleLowerCase();
        if (rel === "family head" || rel === "self") {
          setError("A family member's relationship cannot be Family Head.");
          return false;
        }
      }

      const allMembers = [wizardForm.head, ...wizardForm.otherMembers];
      const names = allMembers.map((m) =>
        memberDisplayName(m).trim().toLocaleLowerCase()
      );
      if (new Set(names).size !== names.length) {
        setError("All family member names must be unique within the family.");
        return false;
      }
      return true;
    }

    if (step === 4) {
      setWizardTouched((prev) => ({
        ...prev,
        assignment_center_id: true,
        assignment_building_id: true,
        assignment_room_id: true,
      }));
      const step4FieldMap = [
        ["assignment_center_id", "fm-wizard-center"],
        ["assignment_building_id", "fm-wizard-building"],
        ["assignment_room_id", "fm-wizard-room"],
      ];
      const invalidIds = step4FieldMap
        .filter(([key]) => Boolean(wizardStep4Errors[key]))
        .map(([, domId]) => domId);
      if (invalidIds.length > 0) {
        focusFirstInvalidField(invalidIds);
        return false;
      }
      return true;
    }

    return true;
  }

  function isWizardStepValid(step) {
    if (step === 1) {
      return Object.keys(wizardStep1Errors).length === 0;
    }
    if (step === 2) {
      return Object.keys(wizardStep2Errors).length === 0;
    }
    if (step === 3) {
      if (editingOtherIndex !== null) return false;
      const allMembers = [wizardForm.head, ...wizardForm.otherMembers];
      const names = allMembers.map((m) =>
        memberDisplayName(m).trim().toLocaleLowerCase()
      );
      if (new Set(names).size !== names.length) return false;
      return true;
    }
    if (step === 4) {
      return Object.keys(wizardStep4Errors).length === 0;
    }
    return true;
  }

  function handleWizardNext() {
    if (!validateWizardStep(wizardStep)) return;
    setWizardStep((prev) => Math.min(4, prev + 1));
  }

  function handleWizardBack() {
    setError("");
    setWizardStep((prev) => Math.max(1, prev - 1));
  }

  function jumpToWizardStep(targetStep) {
    if (targetStep < wizardStep) {
      setError("");
      setWizardStep(targetStep);
      return;
    }
    for (let s = wizardStep; s < targetStep; s += 1) {
      if (!validateWizardStep(s)) return;
    }
    setWizardStep(targetStep);
  }

  function requestSaveNewFamily() {
    if (saving || savingRef.current) return;
    if (wizardStep < 4) {
      handleWizardNext();
      return;
    }
    for (let s = 1; s <= 4; s += 1) {
      if (!validateWizardStep(s)) {
        setWizardStep(s);
        return;
      }
    }
    const headFullName = memberDisplayName(wizardForm.head).trim();
    const totalMembers = 1 + wizardForm.otherMembers.length;
    setConfirmDialog({
      title: "Save this family?",
      message: `Register family "${headFullName}" (${totalMembers} member${totalMembers === 1 ? "" : "s"})?`,
      confirmText: "Confirm",
      cancelText: "Cancel",
      danger: false,
      onConfirm: async () => {
        setConfirmDialog(null);
        await submitNewFamily();
      },
    });
  }

  async function submitNewFamily(event) {
    if (event?.preventDefault) {
      event.preventDefault();
    }
    if (saving || savingRef.current) return;
    if (wizardStep < 4) {
      handleWizardNext();
      return;
    }
    for (let s = 1; s <= 4; s += 1) {
      if (!validateWizardStep(s)) {
        setWizardStep(s);
        return;
      }
    }

    const headFullName = memberDisplayName(wizardForm.head).trim();
    const allMembers = [
      {
        ...wizardForm.head,
        is_head_of_family: true,
        relationship_to_head: "Family Head",
      },
      ...wizardForm.otherMembers.map((m) => ({
        ...m,
        is_head_of_family: false,
      })),
    ];

    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const selectedWizardCenter = centersList.find(
        (c) => String(c.id) === String(wizardForm.assignment_center_id)
      );
      const isWizardDirectCenter =
        wizardForm.assignment_mode === "venue" ||
        isDirectVenueCenter(
          selectedWizardCenter,
          wizardRooms,
          wizardRoomsQuery.isLoading
        );

      const payload = {
        family_code: wizardForm.family_code.trim() || undefined,
        head_name: headFullName,
        barangay_id: Number(wizardForm.barangay_id),
        contact_number:
          wizardForm.contact_number.trim() ||
          wizardForm.head.contact_number.trim() ||
          null,
        alternate_contact:
          wizardForm.alternate_contact.trim() ||
          wizardForm.head.alternate_contact.trim() ||
          null,
        address: wizardForm.address.trim() || null,
        remarks: wizardForm.remarks.trim() || null,
        members: allMembers.map((member) => ({
          first_name: member.first_name.trim(),
          middle_name: member.middle_name.trim() || null,
          last_name: member.last_name.trim(),
          suffix: member.suffix.trim() || null,
          date_of_birth: member.date_of_birth || null,
          gender: member.gender || null,
          relationship_to_head: member.is_head_of_family
            ? "Family Head"
            : member.relationship_to_head.trim() || "Family Member",
          contact_number:
            member.contact_number.trim() ||
            wizardForm.contact_number.trim() ||
            null,
          is_head_of_family: Boolean(member.is_head_of_family),
          is_pwd: Boolean(member.is_pwd),
          disability_type: member.is_pwd
            ? member.disability_type.trim() || null
            : null,
          disability_notes: member.is_pwd
            ? member.disability_notes.trim() || null
            : null,
          is_pregnant:
            member.gender === "Female" ? Boolean(member.is_pregnant) : false,
          is_lactating:
            member.gender === "Female" ? Boolean(member.is_lactating) : false,
          is_solo_parent: Boolean(member.is_solo_parent),
          medical_notes: member.medical_notes.trim() || null,
          notes: member.notes.trim() || null,
        })),
        assignment:
          (wizardForm.assignment_mode === "assign" ||
            wizardForm.assignment_mode === "venue") &&
          wizardForm.assignment_center_id
            ? isWizardDirectCenter
              ? {
                  center_id: Number(wizardForm.assignment_center_id),
                  room_id: null,
                }
              : wizardForm.assignment_room_id
                ? {
                    center_id: Number(wizardForm.assignment_center_id),
                    room_id: Number(wizardForm.assignment_room_id),
                  }
                : null
            : null,
      };

      const result = await api.addFamily(payload);
      const createdFamily = result.family;
      await refreshAllData(createdFamily?.id);
      setNotice(
        result.message ||
          `Family "${headFullName}" (${allMembers.length} member${allMembers.length === 1 ? "" : "s"}) registered successfully.`
      );
      setIsAddWizardOpen(false);
      if (createdFamily?.id && !hideScreenContent) {
        shouldResetDetailScrollRef.current = true;
        setDetailMenuOpen(false);
        setSelectedFamilySeed(createdFamily);
        setSelectedFamilyId(createdFamily.id);
        setActiveScreen("household-detail");
      } else {
        setActiveScreen("list");
      }
    } catch (requestError) {
      setError(requestError.message || "Family could not be registered.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  // =========================================================
  // EDIT HOUSEHOLD HANDLERS & VALIDATION
  // =========================================================
  useEffect(() => {
    if (modal !== "edit-household" || !familyDetailQuery.data?.members) return;
    if (editHouseholdForm.head_resident_id) return;
    const headMember = familyDetailQuery.data.members.find((m) => m.is_head_of_family);
    if (!headMember?.id) return;
    const headId = String(headMember.id);
    setEditHouseholdForm((prev) =>
      prev.head_resident_id ? prev : { ...prev, head_resident_id: headId }
    );
    setEditHouseholdInitial((prev) =>
      prev && !prev.head_resident_id ? { ...prev, head_resident_id: headId } : prev
    );
  }, [modal, familyDetailQuery.data, editHouseholdForm.head_resident_id]);

  function touchEditHouseholdField(field) {
    setEditHouseholdTouched((prev) =>
      prev[field] ? prev : { ...prev, [field]: true }
    );
  }

  const editHouseholdErrors = useMemo(() => {
    if (modal !== "edit-household") return {};
    const errs = {};
    if (!String(editHouseholdForm.barangay_id || "").trim()) {
      errs.barangay_id = "Barangay is required.";
    }
    if (!String(editHouseholdForm.address || "").trim()) {
      errs.address = "Family address is required.";
    }
    if (
      String(editHouseholdForm.contact_number || "").length > 0 &&
      !isValidPhMobile(editHouseholdForm.contact_number)
    ) {
      errs.contact_number = "Enter a valid mobile number, e.g. 09171234567";
    }
    if (
      String(editHouseholdForm.alternate_contact || "").length > 0 &&
      !isValidPhMobile(editHouseholdForm.alternate_contact)
    ) {
      errs.alternate_contact = "Enter a valid mobile number, e.g. 09171234567";
    } else if (
      String(editHouseholdForm.contact_number || "").trim() &&
      String(editHouseholdForm.alternate_contact || "").trim() &&
      normalizePhPhoneForCompare(editHouseholdForm.contact_number) ===
        normalizePhPhoneForCompare(editHouseholdForm.alternate_contact)
    ) {
      errs.alternate_contact =
        "Alternate Contact must not be the same as Contact Number.";
    }
    if (String(editHouseholdForm.remarks || "").length > 500) {
      errs.remarks = "Family remarks must be 500 characters or fewer.";
    }
    return errs;
  }, [modal, editHouseholdForm]);

  const isEditHouseholdValid = Object.keys(editHouseholdErrors).length === 0;

  function openEditHouseholdModal(fam = activeFamily) {
    if (!fam) return;
    setSelectedFamilySeed(fam);
    setSelectedFamilyId(fam.id);
    const headMember = fam.members?.find((m) => m.is_head_of_family);
    const initialData = {
      head_name: fam.head_name || "",
      head_resident_id: headMember?.id ? String(headMember.id) : "",
      barangay_id: fam.barangay_id ? String(fam.barangay_id) : "",
      contact_number: sanitizePhoneInput(fam.contact_number || ""),
      alternate_contact: sanitizePhoneInput(
        fam.alternate_contact || headMember?.alternate_contact || ""
      ),
      address: fam.address || headMember?.address || "",
      remarks: (fam.remarks || headMember?.remarks || "").slice(0, 500),
    };
    setEditHouseholdForm(initialData);
    setEditHouseholdInitial(initialData);
    setEditHouseholdTouched({});
    setError("");
    setModal("edit-household");
  }

  function handleEditBarangayChange(nextBarangayId) {
    const prevBarangayId = String(editHouseholdForm.barangay_id || "");
    const initialBarangayId = String(editHouseholdInitial?.barangay_id || "");
    if (nextBarangayId === prevBarangayId) return;
    if (nextBarangayId && nextBarangayId !== initialBarangayId) {
      const targetBrgy = barangays.find(
        (b) => String(b.id) === String(nextBarangayId)
      );
      setConfirmDialog({
        title: "Change Barangay",
        message: targetBrgy?.name
          ? `Move this family to another barangay (${targetBrgy.name})? The family code stays as it is.`
          : "Move this family to another barangay? The family code stays as it is.",
        confirmText: "Move Family",
        cancelText: "Keep Current",
        danger: false,
        onConfirm: () => {
          setConfirmDialog(null);
          setEditHouseholdForm((prev) => ({
            ...prev,
            barangay_id: nextBarangayId,
          }));
          touchEditHouseholdField("barangay_id");
        },
      });
      return;
    }
    setEditHouseholdForm((prev) => ({
      ...prev,
      barangay_id: nextBarangayId,
    }));
    touchEditHouseholdField("barangay_id");
  }

  function openHeadProfileFromEdit() {
    const headId = editHouseholdForm.head_resident_id;
    const headMember =
      activeFamily?.members?.find((m) => String(m.id) === String(headId)) ||
      activeFamily?.members?.find((m) => m.is_head_of_family);
    if (!headMember) return;

    const navigateToHead = () => {
      forceCloseModal();
      setActiveScreen("member-detail");
      setSelectedMemberId(headMember.id);
    };

    if (isEditHouseholdDirty) {
      setConfirmDialog({
        title: "Discard unsaved changes?",
        message:
          "You have unsaved changes. Are you sure you want to leave this form to view the family head's profile?",
        confirmText: "View Profile",
        cancelText: "Keep Editing",
        danger: false,
        onConfirm: () => {
          setConfirmDialog(null);
          navigateToHead();
        },
      });
      return;
    }
    navigateToHead();
  }

  async function submitEditHousehold(event) {
    event.preventDefault();
    if (!activeFamily || savingRef.current) return;
    setEditHouseholdTouched({
      barangay_id: true,
      address: true,
      contact_number: true,
      alternate_contact: true,
      remarks: true,
    });
    if (!isEditHouseholdValid || !isEditHouseholdDirty) {
      focusFirstInvalidField([
        editHouseholdErrors.barangay_id ? "fm-edit-hh-barangay" : null,
        editHouseholdErrors.address ? "fm-edit-hh-address" : null,
        editHouseholdErrors.contact_number ? "fm-edit-hh-contact" : null,
        editHouseholdErrors.alternate_contact ? "fm-edit-hh-alt-contact" : null,
        editHouseholdErrors.remarks ? "fm-edit-hh-remarks" : null,
      ].filter(Boolean));
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const headChanged =
        editHouseholdForm.head_resident_id &&
        String(editHouseholdForm.head_resident_id) !==
          String(editHouseholdInitial?.head_resident_id || "");
      const payload = {
        head_resident_id: headChanged
          ? Number(editHouseholdForm.head_resident_id)
          : undefined,
        barangay_id: editHouseholdForm.barangay_id
          ? Number(editHouseholdForm.barangay_id)
          : undefined,
        contact_number: editHouseholdForm.contact_number.trim() || null,
        alternate_contact: editHouseholdForm.alternate_contact.trim() || null,
        address: editHouseholdForm.address.trim(),
        remarks: editHouseholdForm.remarks.trim() || null,
      };
      const result = await api.updateFamily(activeFamily.id, payload);
      await refreshAllData(activeFamily.id);
      setNotice(result.message || "Family information updated.");
      forceCloseModal();
    } catch (requestError) {
      setError(requestError.message || "Failed to update family details.");
      if (modalBodyRef.current) modalBodyRef.current.scrollTop = 0;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  // =========================================================
  // ADD / EDIT / DELETE / PROMOTE MEMBER HANDLERS (Page D & Page E)
  // =========================================================
  function touchMemberModalField(field) {
    setMemberModalTouched((prev) =>
      prev[field] ? prev : { ...prev, [field]: true }
    );
  }

  const memberModalErrors = useMemo(() => {
    if (modal !== "member-form") return {};
    const errs = {};
    const first = String(memberModalForm.first_name || "").trim();
    const middle = String(memberModalForm.middle_name || "");
    const last = String(memberModalForm.last_name || "").trim();

    if (!first || !hasNameLetters(first)) {
      errs.first_name = "First name is required.";
    }
    if (middle.length > 0 && (!middle.trim() || !hasNameLetters(middle))) {
      errs.middle_name = "Middle name must contain valid letters.";
    }
    if (!last || !hasNameLetters(last)) {
      errs.last_name = "Last name is required.";
    }

    const isHead = Boolean(memberModalForm.is_head_of_family);
    const dobError = validateDateOfBirth(memberModalForm.date_of_birth, {
      isHead,
      relationship: memberModalForm.relationship_to_head,
    });
    if (dobError) {
      errs.date_of_birth = dobError;
    }
    if (!["Male", "Female"].includes(String(memberModalForm.gender || "").trim())) {
      errs.gender = "Select a gender";
    }

    if (!isHead) {
      const rel = String(memberModalForm.relationship_to_head || "").trim();
      if (!rel) {
        errs.relationship_to_head = "Relationship to head is required.";
      } else if (
        rel.toLocaleLowerCase() === "family head" ||
        rel.toLocaleLowerCase() === "self"
      ) {
        errs.relationship_to_head =
          "Relationship cannot be Family Head since the head already exists.";
      }
    }

    if (
      String(memberModalForm.contact_number || "").length > 0 &&
      !isValidPhMobile(memberModalForm.contact_number)
    ) {
      errs.contact_number = "Enter a valid mobile number, e.g. 09171234567";
    }
    if (String(memberModalForm.medical_notes || "").length > 500) {
      errs.medical_notes = "Medical notes must be 500 characters or fewer.";
    }
    if (String(memberModalForm.notes || "").length > 500) {
      errs.notes = "Additional notes must be 500 characters or fewer.";
    }
    return errs;
  }, [modal, memberModalForm]);

  const memberDuplicateWarning = useMemo(() => {
    if (modal !== "member-form" || !activeFamily?.members) return "";
    const first = String(memberModalForm.first_name || "").trim();
    const last = String(memberModalForm.last_name || "").trim();
    if (!first || !last) return "";
    const candidateName = normalizeNameForCompare({
      ...memberModalForm,
      first_name: first,
      middle_name: String(memberModalForm.middle_name || "").trim(),
      last_name: last,
    });
    if (!candidateName) return "";
    const candidateDob = String(memberModalForm.date_of_birth || "").trim();

    const matches = activeFamily.members.filter((m) => {
      if (
        memberModalMode === "edit" &&
        Number(m.id) === Number(memberModalTargetId)
      ) {
        return false;
      }
      return normalizeNameForCompare(m) === candidateName;
    });
    if (matches.length === 0) return "";

    if (candidateDob) {
      const exactMatch = matches.find(
        (m) => String(m.date_of_birth || "").trim() === candidateDob
      );
      if (exactMatch) {
        return `Warning: A member named "${memberDisplayName(exactMatch)}" with date of birth ${candidateDob} already exists in this family.`;
      }
    }
    if (memberModalMode === "add") {
      return `Warning: A member named "${memberDisplayName(matches[0])}" already exists in this family.`;
    }
    return "";
  }, [
    modal,
    activeFamily,
    memberModalForm,
    memberModalMode,
    memberModalTargetId,
  ]);

  function openAddMemberModal() {
    if (!activeFamily) return;
    const initial = emptyMember(false);
    setMemberModalMode("add");
    setMemberModalTargetId(null);
    setMemberModalForm(initial);
    setMemberModalInitial(initial);
    setMemberModalTouched({});
    setError("");
    setModal("member-form");
  }

  function openEditMemberModal(member) {
    if (!member) return;
    setMemberModalMode("edit");
    setMemberModalTargetId(member.id);
    const rel = member.relationship_to_head || "";
    const normalizedRel =
      member.is_head_of_family || rel.toLowerCase() === "self"
        ? "Family Head"
        : rel || "";
    const rawGender = String(member.gender || "").trim();
    const normalizedGender =
      rawGender.toLowerCase() === "male"
        ? "Male"
        : rawGender.toLowerCase() === "female"
          ? "Female"
          : "";
    const initial = {
      first_name: member.first_name || "",
      middle_name: member.middle_name || "",
      last_name: member.last_name || "",
      suffix: member.suffix || "",
      date_of_birth: member.date_of_birth || "",
      gender: normalizedGender,
      relationship_to_head: normalizedRel,
      contact_number: sanitizePhoneInput(member.contact_number || ""),
      alternate_contact: sanitizePhoneInput(member.alternate_contact || ""),
      is_head_of_family: Boolean(member.is_head_of_family),
      is_pwd: Boolean(member.is_pwd),
      disability_type: member.disability_type || "",
      disability_notes: member.disability_notes || "",
      is_pregnant: Boolean(member.is_pregnant),
      is_lactating: Boolean(member.is_lactating),
      is_solo_parent: Boolean(member.is_solo_parent),
      needs_assistance: Boolean(member.needs_assistance),
      vulnerable_members: member.vulnerable_members || "",
      medical_notes: (member.medical_notes || "").slice(0, 500),
      notes: (member.notes || "").slice(0, 500),
    };
    setMemberModalForm(initial);
    setMemberModalInitial(initial);
    setMemberModalTouched({});
    setError("");
    setModal("member-form");
  }

  async function submitMemberModal(event) {
    event.preventDefault();
    if (!activeFamily || savingRef.current) return;
    setMemberModalTouched({
      first_name: true,
      middle_name: true,
      last_name: true,
      date_of_birth: true,
      gender: true,
      relationship_to_head: true,
      contact_number: true,
      medical_notes: true,
      notes: true,
    });
    if (Object.keys(memberModalErrors).length > 0) {
      setError("Please check the highlighted fields before saving.");
      focusFirstInvalidField([
        memberModalErrors.first_name ? "fm-modal-member-first-name" : null,
        memberModalErrors.middle_name ? "fm-modal-member-middle-name" : null,
        memberModalErrors.last_name ? "fm-modal-member-last-name" : null,
        memberModalErrors.date_of_birth ? "fm-modal-member-dob" : null,
        memberModalErrors.gender ? "fm-modal-member-gender" : null,
        memberModalErrors.relationship_to_head
          ? "fm-modal-member-relationship"
          : null,
        memberModalErrors.contact_number ? "fm-modal-member-contact" : null,
        memberModalErrors.medical_notes ? "fm-modal-member-medical-notes" : null,
        memberModalErrors.notes ? "fm-modal-member-notes" : null,
      ].filter(Boolean));
      return;
    }

    const memberAge = getExactAge(memberModalForm.date_of_birth);
    const allowMaternalFlags =
      memberModalForm.gender === "Female" &&
      !(memberAge !== null && memberAge >= 0 && memberAge < 12);

    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const payload = {
        first_name: formatNameOnBlur(memberModalForm.first_name),
        middle_name: formatNameOnBlur(memberModalForm.middle_name) || null,
        last_name: formatNameOnBlur(memberModalForm.last_name),
        suffix: memberModalForm.suffix.trim() || null,
        date_of_birth: memberModalForm.date_of_birth || null,
        gender: memberModalForm.gender || null,
        relationship_to_head: memberModalForm.is_head_of_family
          ? "Family Head"
          : memberModalForm.relationship_to_head.trim(),
        contact_number: memberModalForm.contact_number.trim() || null,
        alternate_contact: memberModalForm.alternate_contact.trim() || null,
        is_head_of_family: Boolean(memberModalForm.is_head_of_family),
        is_pwd: Boolean(memberModalForm.is_pwd),
        disability_type: memberModalForm.is_pwd
          ? memberModalForm.disability_type.trim() || null
          : null,
        disability_notes: memberModalForm.is_pwd
          ? memberModalForm.disability_notes.trim() || null
          : null,
        is_pregnant: allowMaternalFlags
          ? Boolean(memberModalForm.is_pregnant)
          : false,
        is_lactating: allowMaternalFlags
          ? Boolean(memberModalForm.is_lactating)
          : false,
        is_solo_parent: Boolean(memberModalForm.is_solo_parent),
        medical_notes: memberModalForm.medical_notes.trim() || null,
        notes: memberModalForm.notes.trim() || null,
      };

      if (memberModalMode === "add") {
        const res = await api.addFamilyMember(activeFamily.id, payload);
        await refreshAllData(activeFamily.id);
        setNotice(res.message || "Family member added.");
      } else {
        const res = await api.updateFamilyMember(
          activeFamily.id,
          memberModalTargetId,
          payload
        );
        await refreshAllData(activeFamily.id);
        setNotice(res.message || "Family member updated.");
      }
      forceCloseModal();
    } catch (requestError) {
      const rawMessage = String(requestError?.message || "").trim();
      const friendlyMessage = /^Request failed \(5\d\d\)$/i.test(rawMessage)
        ? "We couldn't save the member details right now. Please try again."
        : rawMessage || "We couldn't save the member details. Please try again.";
      setError(friendlyMessage);
      if (modalBodyRef.current) modalBodyRef.current.scrollTop = 0;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function confirmPromoteToHead(member) {
    if (!activeFamily || !member || member.is_head_of_family) return;
    const name = memberDisplayName(member);
    setConfirmDialog({
      title: "Set as Family Head",
      message: `Designate "${name}" as the new Family Head of ${activeFamily.family_code}? The previous family head (${activeFamily.head_name}) will remain in the family as a regular member.`,
      confirmText: "Set as Family Head",
      danger: false,
      onConfirm: async () => {
        try {
          const res = await api.updateFamily(activeFamily.id, {
            head_resident_id: member.id,
          });
          setConfirmDialog(null);
          await refreshAllData(activeFamily.id);
          setNotice(
            res.message || `"${name}" is now the Family Head of ${activeFamily.family_code}.`
          );
        } catch (err) {
          setError(err.message || "Failed to change family head.");
        }
      },
    });
  }

  function confirmDeleteMember(member) {
    if (!activeFamily || !member) return;
    if (member.is_head_of_family) {
      setError(
        "Cannot remove the family head directly. Please designate another family member as the Family Head first, or delete the entire family."
      );
      return;
    }
    const name = memberDisplayName(member);
    setConfirmDialog({
      title: "Remove Family Member",
      message: `Are you sure you want to remove "${name}" from family ${activeFamily.family_code}?`,
      confirmText: "Remove Member",
      danger: true,
      onConfirm: async () => {
        try {
          const res = await api.deleteFamilyMember(activeFamily.id, member.id);
          setConfirmDialog(null);
          if (
            activeScreen === "member-detail" &&
            Number(selectedMemberId) === Number(member.id)
          ) {
            setActiveScreen("household-detail");
            setSelectedMemberId(null);
          }
          await refreshAllData(activeFamily.id);
          setNotice(res.message || `Removed "${name}" from family.`);
        } catch (err) {
          setError(err.message || "Failed to remove member.");
        }
      },
    });
  }

  // =========================================================
  // DELETE HOUSEHOLD HANDLER
  // =========================================================
  function confirmDeleteFamily(fam = activeFamily) {
    if (!fam) return;
    if (isFamilyAssigned(fam)) {
      setError(
        "Cannot delete a family with an active room assignment. Please unassign the family first."
      );
      return;
    }
    setConfirmDialog({
      title: "Delete Family Record",
      message: `Are you sure you want to delete family "${fam.head_name}" (${fam.family_code || "#" + fam.id})? This will permanently remove the family and its ${fam.member_count || 1} member record(s).`,
      confirmText: "Delete Family",
      danger: true,
      onConfirm: async () => {
        try {
          const res = await api.deleteFamily(fam.id);
          setConfirmDialog(null);
          if (Number(selectedFamilyId) === Number(fam.id)) {
            setDetailMenuOpen(false);
            setActiveScreen("list");
            setSelectedFamilyId(null);
          }
          await refreshAllData();
          setNotice(res.message || `Family "${fam.head_name}" deleted.`);
        } catch (err) {
          setError(err.message || "Failed to delete family.");
        }
      },
    });
  }

  // =========================================================
  // ROOM ASSIGNMENT / MOVE / UNASSIGN HANDLERS
  // =========================================================
  async function loadActiveCenters() {
    try {
      const result = await queryClient.fetchQuery({
        queryKey: queryKeys.activeCenters,
        queryFn: () => api.getEvacuationCenters(false),
      });
      return (result.features || []).map(
        (feature) => feature.properties || feature
      );
    } catch (requestError) {
      setError(requestError.message || "Failed to load evacuation centers.");
      return [];
    }
  }

  async function openAssignModal(fam = activeFamily) {
    if (!fam) return;
    setSelectedFamilySeed(fam);
    setSelectedFamilyId(fam.id);
    setAssignCenterId("");
    setAssignBuildingId("");
    setAssignRoomId("");
    setError("");
    setModal("assign");

    const needed = fam.member_count || fam.resident_count || 1;
    const centers = await loadActiveCenters();
    if (fam.barangay_id) {
      const matching = centers.find(
        (center) =>
          (center.barangays || []).some(
            (barangay) => Number(barangay.id) === Number(fam.barangay_id)
          ) && getCenterRemainingCapacity(center) >= needed
      );
      if (matching) {
        setAssignCenterId(String(matching.id));
        const isDirect = isDirectVenueCenter(matching, [], true);
        if (!isDirect) {
          await queryClient.fetchQuery({
            queryKey: queryKeys.rooms(Number(matching.id)),
            queryFn: () => fetchRooms(Number(matching.id)),
          });
        }
      }
    }
  }

  async function submitAssignment(event) {
    event.preventDefault();

    const selectedCenter = centersList.find(
      (c) => String(c.id) === String(assignCenterId)
    );
    const isDirectCenter = isDirectVenueCenter(
      selectedCenter,
      assignRooms,
      assignRoomsQuery.isLoading
    );
    const hasBldgs = centerHasBuildings(selectedCenter, assignRooms);
    const needed =
      activeFamily?.member_count || activeFamily?.resident_count || 1;

    if (!assignCenterId || !activeFamily) {
      setError("Please select an evacuation center.");
      return;
    }

    if (isDirectCenter) {
      const available = getCenterRemainingCapacity(selectedCenter);
      if (needed > available) {
        setError(
          `${selectedCenter?.name || "Selected center"} only has ${available} space(s) available, but this family has ${needed} member(s).`
        );
        return;
      }
    } else {
      if (hasBldgs && !assignBuildingId) {
        setError("Please select a building first.");
        return;
      }
      if (!assignRoomId) {
        setError(
          hasBldgs
            ? "Please select a room in the selected building."
            : "Please select a room."
        );
        return;
      }
      const room = assignRooms.find(
        (r) => String(r.id) === String(assignRoomId)
      );
      if (!room) return;

      const available = getRoomRemainingCapacity(room);
      const availableSlots = getRoomAvailableSlots(room);
      if (availableSlots < 1) {
        setError(`${formatRoomLabel(room.room_number)} has no family slots available.`);
        return;
      }
      if (needed > available) {
        setError(
          `${formatRoomLabel(room.room_number)} only has ${available} people space(s) available, but this family has ${needed} member(s).`
        );
        return;
      }
    }

    setAssigning(true);
    setError("");
    try {
      const result = await api.assignFamily(activeFamily.id, {
        center_id: Number(assignCenterId),
        room_id: isDirectCenter ? null : Number(assignRoomId),
      });
      await refreshAllData(activeFamily.id);
      const message = isDirectCenter
        ? `Family assigned to ${selectedCenter?.name || "evacuation center"}.`
        : `Family assigned to ${formatRoomLabel(assignRooms.find((r) => String(r.id) === String(assignRoomId))?.room_number)}.`;
      setNotice(result.message || message);
      setModal("");
    } catch (requestError) {
      setError(requestError.message || "Failed to assign family.");
    } finally {
      setAssigning(false);
    }
  }

  async function openMoveModal(fam = activeFamily) {
    if (!fam) return;
    setSelectedFamilySeed(fam);
    setSelectedFamilyId(fam.id);
    const initialCenterId = fam.current_center_id
      ? String(fam.current_center_id)
      : fam.assignments?.[0]?.center_id
        ? String(fam.assignments[0].center_id)
        : "";
    setTargetCenterId(initialCenterId);
    setTargetBuildingId(
      fam.current_building_id ? String(fam.current_building_id) : ""
    );
    setTargetRoomId("");
    setError("");
    setModal("move");

    await loadActiveCenters();
    if (initialCenterId) {
      const initialCenter = centersList.find(
        (c) => String(c.id) === String(initialCenterId)
      );
      const isDirect = isDirectVenueCenter(initialCenter, [], true);
      if (!isDirect) {
        await queryClient.fetchQuery({
          queryKey: queryKeys.rooms(Number(initialCenterId)),
          queryFn: () => fetchRooms(Number(initialCenterId)),
        });
      }
    }
  }

  function handleMoveSubmit(event) {
    event.preventDefault();

    const destCenter = centersList.find(
      (c) => String(c.id) === String(targetCenterId)
    );
    const isDestDirectCenter = isDirectVenueCenter(
      destCenter,
      targetRooms,
      targetRoomsQuery.isLoading
    );
    const destHasBldgs = centerHasBuildings(destCenter, targetRooms);
    const needed =
      activeFamily?.member_count || activeFamily?.resident_count || 1;

    if (!targetCenterId || !activeFamily) {
      setError("Please select a destination center.");
      return;
    }

    if (isDestDirectCenter) {
      const available = getCenterRemainingCapacity(destCenter);
      if (needed > available) {
        setError(
          `${destCenter?.name || "Destination center"} only has ${available} space(s) available, but this family needs ${needed}.`
        );
        return;
      }
    } else {
      if (destHasBldgs && !targetBuildingId) {
        setError("Please select a destination building first.");
        return;
      }
      if (!targetRoomId) {
        setError(
          destHasBldgs
            ? "Please select a destination room in the selected building."
            : "Please select a destination room."
        );
        return;
      }
      const destRoom = targetRooms.find(
        (r) => String(r.id) === String(targetRoomId)
      );
      if (!destRoom) return;

      const available = getRoomRemainingCapacity(destRoom);
      const availableSlots = getRoomAvailableSlots(destRoom);
      if (availableSlots < 1) {
        setError("Destination room has no family slots available.");
        return;
      }
      if (needed > available) {
        setError(
          `Destination room only has ${available} people space(s) available, but this family needs ${needed}.`
        );
        return;
      }
    }

    setConfirmDialog({
      title: isDestDirectCenter
        ? "Confirm Center Transfer"
        : "Confirm Room Transfer",
      message: isDestDirectCenter
        ? `Move family "${activeFamily.head_name}" (${needed} member${needed === 1 ? "" : "s"}) to ${destCenter ? displayEntityName(destCenter.name) : "selected center"}? Occupancy will update automatically.`
        : `Move family "${activeFamily.head_name}" (${needed} member${needed === 1 ? "" : "s"}) to ${destCenter ? displayEntityName(destCenter.name) + " — " : ""}${formatRoomLabel(targetRooms.find((r) => String(r.id) === String(targetRoomId))?.room_number)}? Occupancy in both rooms will update automatically.`,
      confirmText: "Transfer Family",
      danger: false,
      onConfirm: async () => {
        setMoving(true);
        setError("");
        try {
          const res = await api.moveFamily(activeFamily.id, {
            center_id: Number(targetCenterId),
            room_id: isDestDirectCenter ? null : Number(targetRoomId),
          });
          setConfirmDialog(null);
          setModal("");
          await refreshAllData(activeFamily.id);
          const message = isDestDirectCenter
            ? `Family transferred to ${destCenter?.name}.`
            : `Family transferred to ${formatRoomLabel(targetRooms.find((r) => String(r.id) === String(targetRoomId))?.room_number)}.`;
          setNotice(res.message || message);
        } catch (err) {
          setError(err.message || "Failed to transfer family.");
        } finally {
          setMoving(false);
        }
      },
    });
  }

  function confirmUnassign(fam = activeFamily) {
    if (!fam) return;
    const memberCount = fam.member_count || fam.resident_count || 1;
    const currentCenter =
      fam.current_center || fam.evacuation_center || "the evacuation center";
    const currentRoom = fam.current_room || fam.rooms || "";
    const isSingleVenue = fam.current_center_type === 'single_venue';

    setConfirmDialog({
      title: isSingleVenue ? "Unassign Family from Venue" : "Unassign Family from Room",
      message: isSingleVenue
        ? `Unassign family "${fam.head_name}" (${memberCount} member${memberCount === 1 ? "" : "s"}) from ${displayEntityName(currentCenter)}? This will release ${memberCount} space(s).`
        : `Unassign family "${fam.head_name}" (${memberCount} member${memberCount === 1 ? "" : "s"}) from ${displayEntityName(currentCenter)} — ${formatRoomLabel(currentRoom)}? This will release ${memberCount} space(s).`,
      confirmText: "Unassign Family",
      danger: true,
      onConfirm: async () => {
        try {
          const res = await api.unassignFamily(fam.id);
          setConfirmDialog(null);
          await refreshAllData(fam.id);
          setNotice(
            res.message || `Family "${fam.head_name}" unassigned.`
          );
        } catch (err) {
          setError(err.message || "Failed to unassign family.");
        }
      },
    });
  }

  // =========================================================
  // IMPORT / EXPORT HANDLERS
  // =========================================================
  async function downloadTemplate() {
    setError("");
    try {
      saveBlob(
        await api.downloadFamilyTemplate(),
        "evacway-family-template.xlsx"
      );
    } catch (requestError) {
      setError(
        requestError.message || "The Excel template could not be downloaded."
      );
    }
  }

  async function exportFamilies() {
    setError("");
    try {
      const filters = {
        search,
        barangay_id: effectiveBarangayId,
        assignment_status: assignmentStatus,
      };
      const slug = lockedBarangayName
        ? lockedBarangayName.trim().toLowerCase().replace(/\s+/g, "-")
        : "all-barangays";
      saveBlob(
        await api.exportFamilies(filters),
        `evacway-families-${slug}.csv`
      );
    } catch (requestError) {
      setError(
        requestError.message || "The family list could not be exported."
      );
    }
  }


  // Room capacity helpers for modals
  const selectedAssignRoom = assignRooms.find(
    (r) => String(r.id) === String(assignRoomId)
  );
  const assignFamilyMembers =
    activeFamily?.member_count || activeFamily?.resident_count || 1;
  const assignRoomAvailable = getRoomRemainingCapacity(selectedAssignRoom);
  const assignHasCapacity = selectedAssignRoom
    ? getRoomAvailableSlots(selectedAssignRoom) >= 1 && assignRoomAvailable >= assignFamilyMembers
    : false;

  const selectedTargetRoom = targetRooms.find(
    (r) => String(r.id) === String(targetRoomId)
  );
  const moveFamilyMembers =
    activeFamily?.member_count || activeFamily?.resident_count || 1;
  const targetRoomAvailable = getRoomRemainingCapacity(selectedTargetRoom);
  const moveHasCapacity = selectedTargetRoom
    ? getRoomAvailableSlots(selectedTargetRoom) >= 1 && targetRoomAvailable >= moveFamilyMembers
    : false;

  // =========================================================
  // REUSABLE PERSONAL & VULNERABILITY FORM FIELDS
  // =========================================================
  function renderMemberFormFields(
    memberObj,
    onChangeField,
    isHeadLocked = false,
    fieldValidation = {}
  ) {
    const {
      idPrefix = isHeadLocked ? "fm-head" : "fm-member",
      errors = {},
      touched = {},
      onTouchField = () => {},
    } = fieldValidation;
    const calculatedAge = getExactAge(memberObj.date_of_birth);
    const isUnder12 = calculatedAge !== null && calculatedAge >= 0 && calculatedAge < 12;
    const showMaternalCheckboxes = memberObj.gender === "Female" && !isUnder12;
    const showErr = (field) =>
      touched[field] && errors[field] ? errors[field] : "";
    const allowedRelationships = isHeadLocked
      ? RELATIONSHIP_OPTIONS
      : RELATIONSHIP_OPTIONS.filter(
          (rel) =>
            rel.toLowerCase() !== "family head" &&
            rel.toLowerCase() !== "self"
        );

    return (
      <div className="fm-member-fields-block">
        <div className="fm-form-grid-4">
          <label
            className={`fm-field ${showErr("first_name") ? "has-error" : ""}`}
          >
            <span>
              First Name <strong className="fm-req">*</strong>
            </span>
            <input
              id={`${idPrefix}-first-name`}
              type="text"
              value={memberObj.first_name}
              onChange={(e) => {
                const cleaned = sanitizeNameInput(e.target.value);
                onChangeField("first_name", cleaned);
                if (touched.first_name || cleaned !== "") {
                  onTouchField("first_name");
                }
              }}
              onPaste={(e) =>
                handleNamePaste(e, (cleaned) => {
                  onChangeField("first_name", cleaned);
                  onTouchField("first_name");
                })
              }
              onBlur={() => {
                onChangeField("first_name", formatNameOnBlur(memberObj.first_name));
                onTouchField("first_name");
              }}
              aria-invalid={Boolean(showErr("first_name"))}
              aria-describedby={
                showErr("first_name") ? `${idPrefix}-first-name-error` : undefined
              }
              placeholder="e.g. Juan"
            />
            {showErr("first_name") && (
              <small
                id={`${idPrefix}-first-name-error`}
                className="fm-field-error"
                role="alert"
              >
                {showErr("first_name")}
              </small>
            )}
          </label>
          <label
            className={`fm-field ${showErr("middle_name") ? "has-error" : ""}`}
          >
            <span>Middle Name</span>
            <input
              id={`${idPrefix}-middle-name`}
              type="text"
              value={memberObj.middle_name}
              onChange={(e) => {
                const cleaned = sanitizeNameInput(e.target.value);
                onChangeField("middle_name", cleaned);
                if (touched.middle_name || cleaned !== "") {
                  onTouchField("middle_name");
                }
              }}
              onPaste={(e) =>
                handleNamePaste(e, (cleaned) => {
                  onChangeField("middle_name", cleaned);
                  onTouchField("middle_name");
                })
              }
              onBlur={() => {
                onChangeField("middle_name", formatNameOnBlur(memberObj.middle_name));
                onTouchField("middle_name");
              }}
              aria-invalid={Boolean(showErr("middle_name"))}
              aria-describedby={
                showErr("middle_name") ? `${idPrefix}-middle-name-error` : undefined
              }
              placeholder="Optional"
            />
            {showErr("middle_name") && (
              <small
                id={`${idPrefix}-middle-name-error`}
                className="fm-field-error"
                role="alert"
              >
                {showErr("middle_name")}
              </small>
            )}
          </label>
          <label
            className={`fm-field ${showErr("last_name") ? "has-error" : ""}`}
          >
            <span>
              Last Name <strong className="fm-req">*</strong>
            </span>
            <input
              id={`${idPrefix}-last-name`}
              type="text"
              value={memberObj.last_name}
              onChange={(e) => {
                const cleaned = sanitizeNameInput(e.target.value);
                onChangeField("last_name", cleaned);
                if (touched.last_name || cleaned !== "") {
                  onTouchField("last_name");
                }
              }}
              onPaste={(e) =>
                handleNamePaste(e, (cleaned) => {
                  onChangeField("last_name", cleaned);
                  onTouchField("last_name");
                })
              }
              onBlur={() => {
                onChangeField("last_name", formatNameOnBlur(memberObj.last_name));
                onTouchField("last_name");
              }}
              aria-invalid={Boolean(showErr("last_name"))}
              aria-describedby={
                showErr("last_name") ? `${idPrefix}-last-name-error` : undefined
              }
              placeholder="e.g. Dela Cruz"
            />
            {showErr("last_name") && (
              <small
                id={`${idPrefix}-last-name-error`}
                className="fm-field-error"
                role="alert"
              >
                {showErr("last_name")}
              </small>
            )}
          </label>
          <label className="fm-field">
            <span>Suffix</span>
            <select
              id={`${idPrefix}-suffix`}
              value={memberObj.suffix || ""}
              onChange={(e) => onChangeField("suffix", e.target.value)}
            >
              <option value="">None</option>
              {memberObj.suffix &&
                !SUFFIX_OPTIONS.includes(memberObj.suffix) && (
                  <option value={memberObj.suffix}>{memberObj.suffix}</option>
                )}
              {SUFFIX_OPTIONS.map((sfx) => (
                <option key={sfx} value={sfx}>
                  {sfx}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className={isHeadLocked ? "fm-form-grid-3" : "fm-form-grid-4"}>
          <label
            className={`fm-field ${showErr("date_of_birth") ? "has-error" : ""}`}
          >
            <span>
              Date of Birth{" "}
              {isHeadLocked && <strong className="fm-req">*</strong>}
            </span>
            <input
              id={`${idPrefix}-dob`}
              type="date"
              min={getLocalMinDobIso()}
              max={getLocalYesterdayIso()}
              value={memberObj.date_of_birth}
              onChange={(e) => {
                const nextDob = e.target.value;
                onChangeField("date_of_birth", nextDob);
                const nextAge = getExactAge(nextDob);
                if (nextAge !== null && nextAge >= 0 && nextAge < 12) {
                  onChangeField("is_pregnant", false);
                  onChangeField("is_lactating", false);
                }
                onTouchField("date_of_birth");
              }}
              onBlur={() => onTouchField("date_of_birth")}
              aria-invalid={Boolean(showErr("date_of_birth"))}
              aria-describedby={
                showErr("date_of_birth") ? `${idPrefix}-dob-error` : undefined
              }
            />
            {showErr("date_of_birth") && (
              <small
                id={`${idPrefix}-dob-error`}
                className="fm-field-error"
                role="alert"
              >
                {showErr("date_of_birth")}
              </small>
            )}
          </label>
          <div className="fm-field">
            <span>Age</span>
            <div className="fm-readonly-box">
              {calculatedAge !== null && calculatedAge >= 0
                ? `${calculatedAge} year${calculatedAge === 1 ? "" : "s"} old`
                : "Calculated from birth date"}
            </div>
          </div>
          <label className={`fm-field ${showErr("gender") ? "has-error" : ""}`}>
            <span>
              Gender <strong className="fm-req">*</strong>
            </span>
            <select
              id={`${idPrefix}-gender`}
              name="gender"
              value={memberObj.gender || ""}
              onChange={(e) => {
                const nextGender = e.target.value;
                onChangeField("gender", nextGender);
                onTouchField("gender");
                if (nextGender !== "Female") {
                  onChangeField("is_pregnant", false);
                  onChangeField("is_lactating", false);
                }
              }}
              onBlur={() => onTouchField("gender")}
              aria-invalid={Boolean(showErr("gender"))}
              aria-describedby={
                showErr("gender") ? `${idPrefix}-gender-error` : undefined
              }
            >
              <option value="">Select gender</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
            {showErr("gender") && (
              <small
                id={`${idPrefix}-gender-error`}
                className="fm-field-error"
                role="alert"
              >
                {showErr("gender")}
              </small>
            )}
          </label>
          {!isHeadLocked && (
            <label
              className={`fm-field ${showErr("relationship_to_head") ? "has-error" : ""}`}
            >
              <span>
                Relationship to Head <strong className="fm-req">*</strong>
              </span>
              <select
                id={`${idPrefix}-relationship`}
                value={memberObj.relationship_to_head || ""}
                onChange={(e) => {
                  const nextRel = e.target.value;
                  onChangeField("relationship_to_head", nextRel);
                  onTouchField("relationship_to_head");
                  if (nextRel === "Spouse" && memberObj.date_of_birth) {
                    onTouchField("date_of_birth");
                  }
                }}
                onBlur={() => onTouchField("relationship_to_head")}
                aria-invalid={Boolean(showErr("relationship_to_head"))}
                aria-describedby={
                  showErr("relationship_to_head")
                    ? `${idPrefix}-relationship-error`
                    : undefined
                }
              >
                <option value="">Select relationship</option>
                {memberObj.relationship_to_head &&
                  !allowedRelationships.includes(
                    memberObj.relationship_to_head
                  ) && (
                    <option value={memberObj.relationship_to_head}>
                      {memberObj.relationship_to_head}
                    </option>
                  )}
                {allowedRelationships.map((rel) => (
                  <option key={rel} value={rel}>
                    {rel}
                  </option>
                ))}
              </select>
              {showErr("relationship_to_head") && (
                <small
                  id={`${idPrefix}-relationship-error`}
                  className="fm-field-error"
                  role="alert"
                >
                  {showErr("relationship_to_head")}
                </small>
              )}
            </label>
          )}
        </div>

        <div className="fm-form-grid-1">
          <label
            className={`fm-field ${showErr("contact_number") ? "has-error" : ""}`}
          >
            <span>Contact Number</span>
            <input
              id={`${idPrefix}-contact`}
              type="tel"
              inputMode="tel"
              maxLength={13}
              value={memberObj.contact_number}
              onKeyDown={handlePhoneKeyDown}
              onChange={(e) => {
                const cleaned = sanitizePhoneInput(e.target.value);
                onChangeField("contact_number", cleaned);
                if (touched.contact_number || cleaned !== "") {
                  onTouchField("contact_number");
                }
              }}
              onPaste={(e) =>
                handlePhonePaste(e, (cleaned) => {
                  onChangeField("contact_number", cleaned);
                  if (touched.contact_number || cleaned !== "") {
                    onTouchField("contact_number");
                  }
                })
              }
              onBlur={() => onTouchField("contact_number")}
              aria-invalid={Boolean(showErr("contact_number"))}
              aria-describedby={
                showErr("contact_number") ? `${idPrefix}-contact-error` : undefined
              }
              placeholder="e.g. 09171234567 (optional)"
            />
            {showErr("contact_number") && (
              <small
                id={`${idPrefix}-contact-error`}
                className="fm-field-error"
                role="alert"
              >
                {showErr("contact_number")}
              </small>
            )}
          </label>
        </div>

        <div className="fm-vuln-section">
          <span className="fm-vuln-heading">
            <FontAwesomeIcon icon={faShieldHeart} /> Health & Special Needs
          </span>
          <div className="fm-checkbox-grid">
            <label className="fm-check-pill">
              <input
                type="checkbox"
                checked={Boolean(memberObj.is_pwd)}
                onChange={(e) => onChangeField("is_pwd", e.target.checked)}
              />
              <span>Person with Disability (PWD)</span>
            </label>
            {showMaternalCheckboxes && (
              <>
                <label className="fm-check-pill">
                  <input
                    type="checkbox"
                    checked={Boolean(memberObj.is_pregnant)}
                    onChange={(e) =>
                      onChangeField("is_pregnant", e.target.checked)
                    }
                  />
                  <span>Pregnant</span>
                </label>
                <label className="fm-check-pill">
                  <input
                    type="checkbox"
                    checked={Boolean(memberObj.is_lactating)}
                    onChange={(e) =>
                      onChangeField("is_lactating", e.target.checked)
                    }
                  />
                  <span>Lactating Mother</span>
                </label>
              </>
            )}
            <label className="fm-check-pill">
              <input
                type="checkbox"
                checked={Boolean(memberObj.is_solo_parent)}
                onChange={(e) =>
                  onChangeField("is_solo_parent", e.target.checked)
                }
              />
              <span>Solo Parent</span>
            </label>
          </div>
        </div>

        {memberObj.is_pwd && (
          <div className="fm-form-grid-2 fm-conditional-box">
            <label className="fm-field">
              <span>Disability Type</span>
              <input
                type="text"
                value={memberObj.disability_type}
                onChange={(e) =>
                  onChangeField("disability_type", e.target.value)
                }
                placeholder="e.g. Visual, Mobility, Hearing"
              />
            </label>
            <label className="fm-field">
              <span>Disability Notes</span>
              <input
                type="text"
                value={memberObj.disability_notes}
                onChange={(e) =>
                  onChangeField("disability_notes", e.target.value)
                }
                placeholder="Assistive devices or special requirements"
              />
            </label>
          </div>
        )}

        <div className="fm-form-grid-2">
          <label
            className={`fm-field ${showErr("medical_notes") ? "has-error" : ""}`}
          >
            <span className="fm-field-label-row">
              <span>Medical Notes</span>
              <span className="fm-char-count">
                {(memberObj.medical_notes || "").length}/500
              </span>
            </span>
            <textarea
              id={`${idPrefix}-medical-notes`}
              rows={2}
              maxLength={500}
              value={memberObj.medical_notes}
              onChange={(e) => {
                onChangeField("medical_notes", e.target.value.slice(0, 500));
                if (touched.medical_notes) onTouchField("medical_notes");
              }}
              onBlur={() => onTouchField("medical_notes")}
              aria-invalid={Boolean(showErr("medical_notes"))}
              aria-describedby={
                showErr("medical_notes")
                  ? `${idPrefix}-medical-notes-error`
                  : undefined
              }
              placeholder="Medications, allergies, or health conditions (optional)"
            />
            {showErr("medical_notes") && (
              <small
                id={`${idPrefix}-medical-notes-error`}
                className="fm-field-error"
                role="alert"
              >
                {showErr("medical_notes")}
              </small>
            )}
          </label>
          <label className={`fm-field ${showErr("notes") ? "has-error" : ""}`}>
            <span className="fm-field-label-row">
              <span>Additional Notes</span>
              <span className="fm-char-count">
                {(memberObj.notes || "").length}/500
              </span>
            </span>
            <textarea
              id={`${idPrefix}-notes`}
              rows={2}
              maxLength={500}
              value={memberObj.notes}
              onChange={(e) => {
                onChangeField("notes", e.target.value.slice(0, 500));
                if (touched.notes) onTouchField("notes");
              }}
              onBlur={() => onTouchField("notes")}
              aria-invalid={Boolean(showErr("notes"))}
              aria-describedby={
                showErr("notes") ? `${idPrefix}-notes-error` : undefined
              }
              placeholder="Other notes (optional)"
            />
            {showErr("notes") && (
              <small
                id={`${idPrefix}-notes-error`}
                className="fm-field-error"
                role="alert"
              >
                {showErr("notes")}
              </small>
            )}
          </label>
        </div>
      </div>
    );
  }

  useEffect(() => {
    if (typeof onScreenChange === "function") {
      onScreenChange(activeScreen);
    }
  }, [activeScreen, onScreenChange]);

  useEffect(() => {
    if (typeof onRegisterActions === "function") {
      onRegisterActions({
        openAddFamilyWizard,
        exportFamilies,
      });
    }
  });

  return (
    <section
      ref={sectionRef}
      className={`family-module ${hideScreenContent ? "is-screen-hidden" : ""} ${
        compactMobileAllHouseholds ? "is-compact-mobile-all-households" : ""
      }`.trim()}
      data-screen={activeScreen}
      aria-label="Family and Resident Management"
    >
      {/* Feedback Banners */}
      {error && !modal && !isAddWizardOpen && !(activeScreen === "list" && familiesQuery.error && !localError) && (
        <div className="fm-banner fm-banner-error" role="alert">
          <div className="fm-banner-content">
            <FontAwesomeIcon icon={faTriangleExclamation} />
            <span>{error}</span>
          </div>
          <button type="button" onClick={() => setError("")}>
            Dismiss
          </button>
        </div>
      )}

      {toasts.length > 0 && (
        <div className="fm-toast-viewport" aria-label="Notifications">
          {toasts.map((t) => (
            <SuccessToastItem key={t.id} toast={t} onRemove={removeToast} />
          ))}
        </div>
      )}

      {/* =====================================================
          MODAL: 4-STEP ADD HOUSEHOLD WIZARD
      ===================================================== */}
      {isAddWizardOpen && (
        <div
          className="fm-modal-backdrop fm-wizard-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="fm-add-household-modal-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) requestCloseAddWizard();
          }}
        >
          <div className="fm-modal-dialog fm-wizard-modal">
            <div className="fm-modal-header fm-wizard-modal-header">
              <div>
                <div className="fm-wizard-modal-title-row">
                  <h3 id="fm-add-household-modal-title">Add Family</h3>
                  <span className="fm-step-pill">Step {wizardStep} of 4</span>
                </div>
                <p>
                  Follow the steps below to register the family, head of family, and members.
                </p>
              </div>
              <button
                type="button"
                className="fm-modal-close"
                onClick={requestCloseAddWizard}
                disabled={saving}
                aria-label="Close modal"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            {/* 4-Step Progress Indicator */}
            <div className="fm-wizard-stepper-bar">
              <ol className="fm-stepper" aria-label="Registration steps">
                {ADD_STEPS.map((s) => {
                  const isCurrent = wizardStep === s.number;
                  const isCompleted = wizardStep > s.number;
                  let canJump = true;
                  if (s.number > wizardStep) {
                    for (let stepIdx = wizardStep; stepIdx < s.number; stepIdx += 1) {
                      if (!isWizardStepValid(stepIdx)) {
                        canJump = false;
                        break;
                      }
                    }
                  }
                  return (
                    <li
                      key={s.number}
                      className={`fm-stepper-item ${isCurrent ? "is-current" : ""} ${isCompleted ? "is-completed" : ""}`}
                    >
                      <button
                        type="button"
                        className="fm-stepper-btn"
                        onClick={() => jumpToWizardStep(s.number)}
                        disabled={saving || (s.number > wizardStep && !canJump)}
                        aria-current={isCurrent ? "step" : undefined}
                      >
                        <span className="fm-stepper-num">
                          {isCompleted ? (
                            <FontAwesomeIcon icon={faCheckCircle} />
                          ) : (
                            s.number
                          )}
                        </span>
                        <span className="fm-stepper-text">
                          <strong>{s.title}</strong>
                          <small>{s.subtitle}</small>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>

            {error && (
              <div className="fm-banner fm-banner-error fm-modal-alert" role="alert">
                <div className="fm-banner-content">
                  <FontAwesomeIcon icon={faTriangleExclamation} />
                  <span>{error}</span>
                </div>
                <button type="button" onClick={() => setError("")}>
                  Dismiss
                </button>
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (wizardStep < 4) {
                  handleWizardNext();
                } else {
                  requestSaveNewFamily();
                }
              }}
              className="fm-wizard-form"
            >
              <div className="fm-wizard-body fm-wizard-modal-body">
            {/* STEP 1: HOUSEHOLD DETAILS */}
            {wizardStep === 1 && (
              <div className="fm-step-panel">
                <div className="fm-step-intro">
                  <h4>Step 1: Family Details</h4>
                  <p>
                    Enter the barangay, complete family address or purok, contact numbers, and optional remarks.
                  </p>
                </div>

                <div className="fm-form-grid-1">
                  <label
                    className={`fm-field ${wizardTouched.barangay_id && wizardStep1Errors.barangay_id ? "has-error" : ""}`}
                  >
                    <span>
                      Barangay <strong className="fm-req">*</strong>
                    </span>
                    <select
                      id="fm-wizard-barangay"
                      value={wizardForm.barangay_id}
                      onChange={(e) => {
                        setWizardForm((prev) => ({
                          ...prev,
                          barangay_id: e.target.value,
                        }));
                        touchWizardField("barangay_id");
                      }}
                      onBlur={() => touchWizardField("barangay_id")}
                      aria-invalid={Boolean(
                        wizardTouched.barangay_id &&
                          wizardStep1Errors.barangay_id
                      )}
                      disabled={Boolean(lockedBarangayId)}
                    >
                      <option value="">Select barangay</option>
                      {barangays.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                    {wizardTouched.barangay_id &&
                      wizardStep1Errors.barangay_id && (
                        <small className="fm-field-error" role="alert">
                          {wizardStep1Errors.barangay_id}
                        </small>
                      )}
                  </label>
                </div>

                <div className="fm-form-grid-1">
                  <label
                    className={`fm-field ${wizardTouched.address && wizardStep1Errors.address ? "has-error" : ""}`}
                  >
                    <span>
                      Complete Family Address / Purok{" "}
                      <strong className="fm-req">*</strong>
                    </span>
                    <input
                      id="fm-wizard-address"
                      type="text"
                      value={wizardForm.address}
                      onChange={(e) => {
                        const val = e.target.value;
                        setWizardForm((prev) => ({
                          ...prev,
                          address: val,
                        }));
                        if (wizardTouched.address || val !== "") {
                          touchWizardField("address");
                        }
                      }}
                      onBlur={() => touchWizardField("address")}
                      aria-invalid={Boolean(
                        wizardTouched.address && wizardStep1Errors.address
                      )}
                      placeholder="e.g. Purok 3, Sitio Malinao, near Barangay Hall"
                    />
                    {wizardTouched.address && wizardStep1Errors.address && (
                      <small className="fm-field-error" role="alert">
                        {wizardStep1Errors.address}
                      </small>
                    )}
                  </label>
                </div>

                <div className="fm-form-grid-2">
                  <label
                    className={`fm-field ${wizardTouched.contact_number && wizardStep1Errors.contact_number ? "has-error" : ""}`}
                  >
                    <span>Family Contact Number</span>
                    <input
                      id="fm-wizard-contact"
                      type="text"
                      value={wizardForm.contact_number}
                      onChange={(e) => {
                        const val = e.target.value;
                        setWizardForm((prev) => ({
                          ...prev,
                          contact_number: val,
                        }));
                        if (wizardTouched.contact_number || val !== "") {
                          touchWizardField("contact_number");
                        }
                      }}
                      onBlur={() => touchWizardField("contact_number")}
                      aria-invalid={Boolean(
                        wizardTouched.contact_number &&
                          wizardStep1Errors.contact_number
                      )}
                      placeholder="e.g. 09171234567"
                    />
                    {wizardTouched.contact_number &&
                      wizardStep1Errors.contact_number && (
                        <small className="fm-field-error" role="alert">
                          {wizardStep1Errors.contact_number}
                        </small>
                      )}
                  </label>

                  <label
                    className={`fm-field ${wizardTouched.alternate_contact && wizardStep1Errors.alternate_contact ? "has-error" : ""}`}
                  >
                    <span>Alternate Contact Number</span>
                    <input
                      id="fm-wizard-alt-contact"
                      type="text"
                      value={wizardForm.alternate_contact}
                      onChange={(e) => {
                        const val = e.target.value;
                        setWizardForm((prev) => ({
                          ...prev,
                          alternate_contact: val,
                        }));
                        if (wizardTouched.alternate_contact || val !== "") {
                          touchWizardField("alternate_contact");
                        }
                      }}
                      onBlur={() => touchWizardField("alternate_contact")}
                      aria-invalid={Boolean(
                        wizardTouched.alternate_contact &&
                          wizardStep1Errors.alternate_contact
                      )}
                      placeholder="Optional secondary PH mobile number"
                    />
                    {wizardTouched.alternate_contact &&
                      wizardStep1Errors.alternate_contact && (
                        <small className="fm-field-error" role="alert">
                          {wizardStep1Errors.alternate_contact}
                        </small>
                      )}
                  </label>
                </div>

                <div className="fm-form-grid-1">
                  <label className="fm-field">
                    <span>Family Remarks / Evacuation Notes</span>
                    <textarea
                      rows={2}
                      value={wizardForm.remarks}
                      onChange={(e) =>
                        setWizardForm((prev) => ({
                          ...prev,
                          remarks: e.target.value,
                        }))
                      }
                      placeholder="Optional family-level notes or special evacuation instructions"
                    />
                  </label>
                </div>
              </div>
            )}

            {/* STEP 2: HOUSEHOLD HEAD PROFILE */}
            {wizardStep === 2 && (
              <div className="fm-step-panel">
                <div className="fm-step-intro">
                  <div className="fm-step-intro-row">
                    <div>
                      <h4>Step 2: Family Head Profile</h4>
                      <p>
                        Personal details and health information for the designated family head (must be 18 or older).
                      </p>
                    </div>
                    <span className="fm-badge fm-badge-blue">
                      <FontAwesomeIcon icon={faUserCheck} /> Family Head
                    </span>
                  </div>
                </div>

                {renderMemberFormFields(
                  wizardForm.head,
                  updateWizardHead,
                  true,
                  {
                    idPrefix: "fm-head",
                    errors: {
                      first_name: wizardStep2Errors["head.first_name"],
                      middle_name: wizardStep2Errors["head.middle_name"],
                      last_name: wizardStep2Errors["head.last_name"],
                      date_of_birth: wizardStep2Errors["head.date_of_birth"],
                      gender: wizardStep2Errors["head.gender"],
                      contact_number: wizardStep2Errors["head.contact_number"],
                    },
                    touched: {
                      first_name: wizardTouched["head.first_name"],
                      middle_name: wizardTouched["head.middle_name"],
                      last_name: wizardTouched["head.last_name"],
                      date_of_birth:
                        wizardTouched["head.date_of_birth"] ||
                        Boolean(wizardForm.head.date_of_birth),
                      gender: wizardTouched["head.gender"],
                      contact_number: wizardTouched["head.contact_number"],
                    },
                    onTouchField: (f) => touchWizardField(`head.${f}`),
                  }
                )}
              </div>
            )}

            {/* STEP 3: ADDITIONAL HOUSEHOLD MEMBERS */}
            {wizardStep === 3 && (
              <div className="fm-step-panel">
                <div className="fm-step-intro">
                  <div className="fm-step-intro-row">
                    <div>
                      <h4>Step 3: Additional Family Members</h4>
                      <p>
                        Add all additional residents living in this family.
                        Single-person families can proceed directly to Step 4.
                      </p>
                    </div>
                    {editingOtherIndex === null && (
                      <button
                        type="button"
                        className="fm-btn fm-btn-primary"
                        onClick={startAddOtherMember}
                      >
                        <FontAwesomeIcon icon={faUserPlus} /> Add Another Member
                      </button>
                    )}
                  </div>
                </div>

                {/* Locked Household Head Summary Card */}
                <div className="fm-member-summary-card is-head-card">
                  <div className="fm-member-summary-main">
                    <div className="fm-member-avatar is-head">
                      <FontAwesomeIcon icon={faUserCheck} />
                    </div>
                    <div>
                      <div className="fm-member-title-row">
                        <strong>{memberDisplayName(wizardForm.head)}</strong>
                        <span className="fm-badge fm-badge-blue">
                          Family Head
                        </span>
                      </div>
                      <p className="fm-member-sub">
                        {wizardForm.head.gender || "Gender not specified"} •{" "}
                        {wizardForm.head.date_of_birth
                          ? `DOB: ${wizardForm.head.date_of_birth} (${getAge(wizardForm.head.date_of_birth)} yrs)`
                          : "DOB not specified"}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="fm-btn fm-btn-ghost fm-btn-sm"
                    onClick={() => setWizardStep(2)}
                  >
                    <FontAwesomeIcon icon={faPenToSquare} /> Edit Head in Step 2
                  </button>
                </div>

                {/* Additional Member Draft Form (Add / Edit) */}
                {editingOtherIndex !== null && memberDraft && (
                  <div className="fm-member-draft-card">
                    <div className="fm-member-draft-header">
                      <h5>
                        {editingOtherIndex === "new"
                          ? "Add Family Member"
                          : `Edit Family Member #${editingOtherIndex + 2}`}
                      </h5>
                      <button
                        type="button"
                        className="fm-btn fm-btn-ghost fm-btn-sm"
                        onClick={cancelOtherMemberDraft}
                      >
                        <FontAwesomeIcon icon={faXmark} /> Cancel
                      </button>
                    </div>
                    {renderMemberFormFields(
                      memberDraft,
                      (field, value) =>
                        setMemberDraft((prev) => ({ ...prev, [field]: value })),
                      false,
                      {
                        idPrefix: "fm-draft",
                        errors: memberDraftErrors,
                        touched: {
                          ...memberDraftTouched,
                          date_of_birth:
                            memberDraftTouched.date_of_birth ||
                            Boolean(memberDraft.date_of_birth),
                          relationship_to_head:
                            memberDraftTouched.relationship_to_head ||
                            Boolean(memberDraft.relationship_to_head),
                        },
                        onTouchField: touchMemberDraftField,
                      }
                    )}
                    <div className="fm-member-draft-footer">
                      <button
                        type="button"
                        className="fm-btn fm-btn-secondary"
                        onClick={cancelOtherMemberDraft}
                      >
                        Cancel
                      </button>
                      <button
                        id="fm-draft-save-btn"
                        type="button"
                        className="fm-btn fm-btn-primary"
                        onClick={saveOtherMemberDraft}
                      >
                        <FontAwesomeIcon icon={faCheckCircle} /> Save Member
                      </button>
                    </div>
                  </div>
                )}

                {/* List of Added Additional Members */}
                {wizardForm.otherMembers.length === 0 &&
                editingOtherIndex === null ? (
                  <div className="fm-empty-inline">
                    <FontAwesomeIcon icon={faUsers} />
                    <div>
                      <strong>No additional family members added yet</strong>
                      <p>
                        Click &ldquo;Add Another Member&rdquo; above to add
                        dependents, or click &ldquo;Next&rdquo; if this is
                        a single-person family.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="fm-added-members-list">
                    {wizardForm.otherMembers.map((member, idx) => {
                      const badges = getVulnerabilityBadges(member);
                      const age = getAge(member.date_of_birth);
                      return (
                        <div key={idx} className="fm-member-summary-card">
                          <div className="fm-member-summary-main">
                            <div className="fm-member-avatar">
                              <FontAwesomeIcon icon={faUser} />
                            </div>
                            <div>
                              <div className="fm-member-title-row">
                                <strong>{memberDisplayName(member)}</strong>
                                <span className="fm-badge fm-badge-neutral">
                                  {familyTerm(member.relationship_to_head || "Member")}
                                </span>
                                {badges.map((b, bIdx) => (
                                  <span
                                    key={bIdx}
                                    className={`fm-badge fm-badge-${b.tone}`}
                                  >
                                    {b.label}
                                  </span>
                                ))}
                              </div>
                              <p className="fm-member-sub">
                                {member.gender || "Gender not specified"} •{" "}
                                {member.date_of_birth
                                  ? `DOB: ${member.date_of_birth}${age !== null ? ` (${age} yrs)` : ""}`
                                  : "DOB not specified"}
                              </p>
                            </div>
                          </div>
                          <div className="fm-member-summary-actions">
                            <button
                              type="button"
                              className="fm-btn fm-btn-secondary fm-btn-sm"
                              onClick={() => startEditOtherMember(idx)}
                            >
                              <FontAwesomeIcon icon={faPenToSquare} /> Edit
                            </button>
                            <button
                              type="button"
                              className="fm-btn fm-btn-danger-outline fm-btn-sm"
                              onClick={() => removeOtherMember(idx)}
                            >
                              <FontAwesomeIcon icon={faTrashCan} /> Remove
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* STEP 4: EVACUATION ASSIGNMENT & REVIEW */}
            {wizardStep === 4 && (
              <div className="fm-step-panel">
                <div className="fm-step-intro">
                  <h4>Step 4: Evacuation Assignment & Confirm Registration</h4>
                  <p>
                    Optionally assign this family ({1 + wizardForm.otherMembers.length}{" "}
                    total member{wizardForm.otherMembers.length === 0 ? "" : "s"})
                    to an active evacuation center now, and review summary details before saving.
                  </p>
                </div>

                <div className="fm-choice-cards">
                  <label
                    className={`fm-choice-card ${wizardForm.assignment_mode === "unassigned" ? "is-selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name="assignment_mode"
                      checked={wizardForm.assignment_mode === "unassigned"}
                      onChange={() =>
                        setWizardForm((prev) => ({
                          ...prev,
                          assignment_mode: "unassigned",
                          assignment_center_id: "",
                          assignment_building_id: "",
                          assignment_room_id: "",
                        }))
                      }
                    />
                    <div>
                      <strong>Leave Unassigned for Now</strong>
                      <p>
                        Register the family in the barangay registry without
                        occupying an evacuation center or room yet.
                      </p>
                    </div>
                  </label>

                  <label
                    className={`fm-choice-card ${wizardForm.assignment_mode === "assign" || wizardForm.assignment_mode === "venue" ? "is-selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name="assignment_mode"
                      checked={
                        wizardForm.assignment_mode === "assign" ||
                        wizardForm.assignment_mode === "venue"
                      }
                      onChange={() =>
                        setWizardForm((prev) => ({
                          ...prev,
                          assignment_mode: "assign",
                        }))
                      }
                    />
                    <div>
                      <strong>Assign to Evacuation Center</strong>
                      <p>
                        Select an active evacuation center with available capacity
                        (assigns directly to center, room, or building &amp; room).
                      </p>
                    </div>
                  </label>
                </div>

                {(wizardForm.assignment_mode === "assign" ||
                  wizardForm.assignment_mode === "venue") &&
                  (() => {
                    const needed = 1 + wizardForm.otherMembers.length;
                    const availableCenters = centersList;
                    const selectedWizardCenter = centersList.find(
                      (c) =>
                        String(c.id) === String(wizardForm.assignment_center_id)
                    );
                    const isWizardDirect = isDirectVenueCenter(
                      selectedWizardCenter,
                      wizardRooms,
                      wizardRoomsQuery.isLoading
                    );
                    const wizardHasBldgs = centerHasBuildings(
                      selectedWizardCenter,
                      wizardRooms
                    );
                    const wizardAvailableBldgs = getAvailableBuildingsForCenter(
                      selectedWizardCenter,
                      wizardRooms,
                      needed
                    );
                    const wizardFilteredRooms = getFilteredRoomsForSelection(
                      selectedWizardCenter,
                      wizardRooms,
                      wizardForm.assignment_building_id,
                      needed
                    );
                    const showCenterErr =
                      (wizardTouched.assignment_center_id ||
                        Boolean(wizardForm.assignment_center_id)) &&
                      wizardStep4Errors.assignment_center_id;
                    const showBldgErr =
                      (wizardTouched.assignment_building_id ||
                        Boolean(wizardForm.assignment_building_id)) &&
                      wizardStep4Errors.assignment_building_id;
                    const showRoomErr =
                      (wizardTouched.assignment_room_id ||
                        Boolean(wizardForm.assignment_room_id)) &&
                      wizardStep4Errors.assignment_room_id;

                    return (
                      <div className="fm-assignment-selector-box">
                        <div
                          className={
                            isWizardDirect
                              ? "fm-form-grid-1"
                              : "fm-form-grid-2"
                          }
                        >
                          <label
                            className={`fm-field ${showCenterErr ? "has-error" : ""}`}
                          >
                            <span>
                              Evacuation Center{" "}
                              <strong className="fm-req">*</strong>
                            </span>
                            <select
                              id="fm-wizard-center"
                              value={wizardForm.assignment_center_id}
                              onChange={(e) => {
                                setWizardForm((prev) => ({
                                  ...prev,
                                  assignment_center_id: e.target.value,
                                  assignment_building_id: "",
                                  assignment_room_id: "",
                                }));
                                touchWizardField("assignment_center_id");
                              }}
                              onBlur={() =>
                                touchWizardField("assignment_center_id")
                              }
                              aria-invalid={Boolean(showCenterErr)}
                            >
                              <option value="">Select evacuation center</option>
                              {availableCenters.map((c) => {
                                const cap = c.capacity ?? 0;
                                const occ = getCenterAssignedCount(c);
                                const rem = getCenterRemainingCapacity(c);
                                return (
                                  <option key={c.id} value={c.id}>
                                    {displayEntityName(c.name)} (
                                    {(c.barangays || [])
                                      .map((barangay) => barangay.name)
                                      .join(", ")}
                                    ) — {occ}/{cap} assigned (
                                    {rem <= 0 ? "Full" : `${rem} left`})
                                  </option>
                                );
                              })}
                            </select>
                            {showCenterErr && (
                              <small className="fm-field-error" role="alert">
                                {wizardStep4Errors.assignment_center_id}
                              </small>
                            )}
                          </label>

                          {!isWizardDirect && wizardHasBldgs && (
                            <label
                              className={`fm-field ${showBldgErr ? "has-error" : ""}`}
                            >
                              <span>
                                Building <strong className="fm-req">*</strong>
                              </span>
                              <select
                                id="fm-wizard-building"
                                value={wizardForm.assignment_building_id}
                                disabled={
                                  !wizardForm.assignment_center_id ||
                                  wizardRoomsQuery.isLoading
                                }
                                onChange={(e) => {
                                  setWizardForm((prev) => ({
                                    ...prev,
                                    assignment_building_id: e.target.value,
                                    assignment_room_id: "",
                                  }));
                                  touchWizardField("assignment_building_id");
                                }}
                                onBlur={() =>
                                  touchWizardField("assignment_building_id")
                                }
                                aria-invalid={Boolean(showBldgErr)}
                              >
                                <option value="">
                                  {!wizardForm.assignment_center_id
                                    ? "Select a center first"
                                    : wizardRoomsQuery.isLoading
                                      ? "Loading buildings..."
                                      : wizardAvailableBldgs.length === 0
                                        ? "No buildings available"
                                        : "Select building"}
                                </option>
                                {wizardAvailableBldgs.map((b) => (
                                  <option key={b.id} value={b.id}>
                                    {displayEntityName(b.name)} (
                                    {b.rooms.length} room
                                    {b.rooms.length === 1 ? "" : "s"},{" "}
                                    {b.availableSpaces} spaces left)
                                  </option>
                                ))}
                              </select>
                              {showBldgErr && (
                                <small className="fm-field-error" role="alert">
                                  {wizardStep4Errors.assignment_building_id}
                                </small>
                              )}
                            </label>
                          )}

                          {!isWizardDirect && (
                            <label
                              className={`fm-field ${showRoomErr ? "has-error" : ""}`}
                            >
                              <span>
                                Room <strong className="fm-req">*</strong>
                              </span>
                              <select
                                id="fm-wizard-room"
                                value={wizardForm.assignment_room_id}
                                disabled={
                                  !wizardForm.assignment_center_id ||
                                  wizardRoomsQuery.isLoading ||
                                  (wizardHasBldgs &&
                                    !wizardForm.assignment_building_id)
                                }
                                onChange={(e) => {
                                  setWizardForm((prev) => ({
                                    ...prev,
                                    assignment_room_id: e.target.value,
                                  }));
                                  touchWizardField("assignment_room_id");
                                }}
                                onBlur={() =>
                                  touchWizardField("assignment_room_id")
                                }
                                aria-invalid={Boolean(showRoomErr)}
                              >
                                <option value="">
                                  {!wizardForm.assignment_center_id
                                    ? "Select a center first"
                                    : wizardRoomsQuery.isLoading
                                      ? "Loading rooms..."
                                      : wizardHasBldgs &&
                                          !wizardForm.assignment_building_id
                                        ? "Select a building first"
                                        : wizardFilteredRooms.length === 0
                                          ? "No rooms available"
                                          : "Select room"}
                                </option>
                                {wizardFilteredRooms.map((room) => {
                                  const available =
                                    getRoomRemainingCapacity(room);
                                  const assigned = getRoomAssignedCount(room);
                                  const slotsAvailable = getRoomAvailableSlots(room);
                                  return (
                                    <option key={room.id} value={room.id}>
                                      {formatRoomLabel(room.room_number)} —{" "}
                                      Slots {getRoomUsedSlots(room)}/{room.family_slots ?? 5} · Spaces {assigned}/{room.people_spaces ?? room.capacity ?? 25} (
                                      {slotsAvailable < 1
                                        ? "No slots"
                                        : `${available} spaces left`}
                                      )
                                    </option>
                                  );
                                })}
                              </select>
                              {showRoomErr && (
                                <small className="fm-field-error" role="alert">
                                  {wizardStep4Errors.assignment_room_id}
                                </small>
                              )}
                            </label>
                          )}
                        </div>

                        {selectedWizardCenter && isWizardDirect && (
                          <div className="fm-venue-capacity-box">
                            {(() => {
                              const cap = selectedWizardCenter.capacity ?? 0;
                              const occ =
                                getCenterAssignedCount(selectedWizardCenter);
                              const available =
                                getCenterRemainingCapacity(selectedWizardCenter);
                              const enough = available >= needed;
                              return (
                                <div
                                  className={`fm-capacity-summary ${enough ? "has-capacity" : "no-capacity"}`}
                                >
                                  <div className="capacity-row">
                                    <span className="capacity-label">
                                      Center capacity
                                    </span>
                                    <span className="capacity-value">
                                      {cap} people
                                    </span>
                                  </div>
                                  <div className="capacity-row">
                                    <span className="capacity-label">
                                      Currently assigned
                                    </span>
                                    <span className="capacity-value">
                                      {occ} people
                                    </span>
                                  </div>
                                  <div className="capacity-row">
                                    <span className="capacity-label">
                                      Remaining capacity
                                    </span>
                                    <span
                                      className="capacity-value"
                                      style={{
                                        color: enough
                                          ? "var(--ew-safe-text)"
                                          : "var(--ew-danger-text)",
                                      }}
                                    >
                                      {available} spaces left
                                    </span>
                                  </div>
                                  <div className="capacity-row">
                                    <span className="capacity-label">
                                      Family to assign
                                    </span>
                                    <span className="capacity-value">
                                      {needed} members
                                    </span>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        )}

                        {wizardForm.assignment_center_id &&
                          !isWizardDirect &&
                          wizardFilteredRooms.length > 0 && (
                            <div className="fm-room-cards-grid">
                              {wizardFilteredRooms.map((room) => {
                                const available =
                                  getRoomRemainingCapacity(room);
                                const assigned = getRoomAssignedCount(room);
                                const slotsAvailable = getRoomAvailableSlots(room);
                                const isSelected =
                                  String(wizardForm.assignment_room_id) ===
                                  String(room.id);
                                const isFull = slotsAvailable <= 0 || available <= 0;
                                const isInsufficient = !isFull && available < needed;
                                return (
                                  <button
                                    key={room.id}
                                    type="button"
                                    onClick={() => {
                                      setWizardForm((prev) => ({
                                        ...prev,
                                        assignment_room_id: String(room.id),
                                      }));
                                      touchWizardField("assignment_room_id");
                                    }}
                                    className={`fm-room-pick-card ${isSelected ? "is-selected" : ""} ${isFull || isInsufficient ? "is-full" : ""}`}
                                  >
                                    <div className="fm-room-pick-top">
                                      <strong>
                                        <FontAwesomeIcon icon={faDoorOpen} />{" "}
                                        {formatRoomLabel(room.room_number)}
                                      </strong>
                                      <span
                                        className={`fm-badge ${isFull ? "fm-badge-red" : isInsufficient ? "fm-badge-amber" : "fm-badge-green"}`}
                                      >
                                        {isFull
                                          ? "Full"
                                          : `${available} remaining`}
                                      </span>
                                    </div>
                                    <div className="fm-room-pick-meta">
                                      <span>Slots: {getRoomUsedSlots(room)}/{room.family_slots ?? 5}</span>
                                      <span>Spaces: {assigned}/{room.people_spaces ?? room.capacity ?? 25}</span>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                      </div>
                    );
                  })()}

                {/* Review Summary before submission */}
                <div className="fm-step-intro" style={{ marginTop: "1.5rem" }}>
                  <h4>Registration Summary</h4>
                  <p>Please review family details before saving.</p>
                </div>

                <div className="fm-review-grid">
                  {/* Review Block 1: Household Info */}
                  <div className="fm-review-card">
                    <div className="fm-review-card-header">
                      <h5>
                        <FontAwesomeIcon icon={faHouse} /> Family & Head
                      </h5>
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="fm-btn fm-btn-ghost fm-btn-sm"
                          onClick={() => setWizardStep(1)}
                        >
                          <FontAwesomeIcon icon={faPenToSquare} /> Edit Details
                        </button>
                        <button
                          type="button"
                          className="fm-btn fm-btn-ghost fm-btn-sm"
                          onClick={() => setWizardStep(2)}
                        >
                          <FontAwesomeIcon icon={faPenToSquare} /> Edit Head
                        </button>
                      </div>
                    </div>
                    <dl className="fm-dl-grid">
                      <div>
                        <dt>Barangay</dt>
                        <dd>
                          {barangays.find(
                            (b) =>
                              String(b.id) === String(wizardForm.barangay_id)
                          )?.name || "—"}
                        </dd>
                      </div>
                      <div>
                        <dt>Family Head</dt>
                        <dd><strong>{memberDisplayName(wizardForm.head) || "—"}</strong></dd>
                      </div>
                      <div>
                        <dt>Complete Address</dt>
                        <dd>{wizardForm.address || "—"}</dd>
                      </div>
                      <div>
                        <dt>Contact Number</dt>
                        <dd>
                          {wizardForm.contact_number ||
                            wizardForm.head.contact_number ||
                            "Not provided"}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  {/* Review Block 2: Evacuation Assignment */}
                  <div className="fm-review-card">
                    <div className="fm-review-card-header">
                      <h5>
                        <FontAwesomeIcon icon={faBuilding} /> Evacuation Assignment
                      </h5>
                    </div>
                    {(() => {
                      const selectedWizardCenter = centersList.find(
                        (c) =>
                          String(c.id) === String(wizardForm.assignment_center_id)
                      );
                      const isWizardDirect = isDirectVenueCenter(
                        selectedWizardCenter,
                        wizardRooms,
                        wizardRoomsQuery.isLoading
                      );
                      const isAssignedReady =
                        (wizardForm.assignment_mode === "assign" ||
                          wizardForm.assignment_mode === "venue") &&
                        wizardForm.assignment_center_id &&
                        (isWizardDirect || wizardForm.assignment_room_id);

                      if (!isAssignedReady) {
                        return (
                          <div className="fm-review-unassigned">
                            <span className="fm-badge fm-badge-neutral">
                              Unassigned
                            </span>
                            <p>
                              Family will be registered in the barangay
                              registry without an active center assignment.
                            </p>
                          </div>
                        );
                      }

                      const selectedRoomObj = wizardRooms.find(
                        (r) =>
                          String(r.id) === String(wizardForm.assignment_room_id)
                      );

                      return (
                        <dl className="fm-dl-grid">
                          <div>
                            <dt>Status</dt>
                            <dd>
                              <span className="fm-badge fm-badge-green">
                                Assigned on Registration
                              </span>
                            </dd>
                          </div>
                          <div>
                            <dt>Evacuation Center</dt>
                            <dd>
                              {displayEntityName(selectedWizardCenter?.name) ||
                                "Selected Center"}
                            </dd>
                          </div>
                          {!isWizardDirect && selectedRoomObj?.building_name && (
                            <div>
                              <dt>Building</dt>
                              <dd>
                                {displayEntityName(selectedRoomObj.building_name)}
                              </dd>
                            </div>
                          )}
                          <div>
                            <dt>{isWizardDirect ? "Placement" : "Room"}</dt>
                            <dd>
                              {isWizardDirect
                                ? "Direct Center Assignment"
                                : formatRoomLabel(
                                    selectedRoomObj?.room_number ||
                                      wizardForm.assignment_room_id
                                  )}
                            </dd>
                          </div>
                          <div>
                            <dt>Total Members to Assign</dt>
                            <dd>{1 + wizardForm.otherMembers.length}</dd>
                          </div>
                        </dl>
                      );
                    })()}
                  </div>
                </div>

                {/* Review Block 3: Household Head & Members */}
                <div className="fm-review-card" style={{ marginTop: "1rem" }}>
                  <div className="fm-review-card-header">
                    <h5>
                      <FontAwesomeIcon icon={faUsers} /> Family Members ({1 + wizardForm.otherMembers.length})
                    </h5>
                    <button
                      type="button"
                      className="fm-btn fm-btn-ghost fm-btn-sm"
                      onClick={() => setWizardStep(3)}
                    >
                      <FontAwesomeIcon icon={faPenToSquare} /> Edit Members
                    </button>
                  </div>

                  <div className="fm-added-members-list">
                    {[wizardForm.head, ...wizardForm.otherMembers].map(
                      (member, idx) => {
                        const badges = getVulnerabilityBadges(member);
                        const age = getAge(member.date_of_birth);
                        return (
                          <div
                            key={idx}
                            className={`fm-member-summary-card ${member.is_head_of_family ? "is-head-card" : ""}`}
                          >
                            <div className="fm-member-summary-main">
                              <div
                                className={`fm-member-avatar ${member.is_head_of_family ? "is-head" : ""}`}
                              >
                                <FontAwesomeIcon
                                  icon={
                                    member.is_head_of_family
                                      ? faUserCheck
                                      : faUser
                                  }
                                />
                              </div>
                              <div>
                                <div className="fm-member-title-row">
                                  <strong>{memberDisplayName(member)}</strong>
                                  {member.is_head_of_family ? (
                                    <span className="fm-badge fm-badge-blue">
                                      Family Head
                                    </span>
                                  ) : (
                                    <span className="fm-badge fm-badge-neutral">
                                      {familyTerm(member.relationship_to_head || "Member")}
                                    </span>
                                  )}
                                  {badges.map((b, bIdx) => (
                                    <span
                                      key={bIdx}
                                      className={`fm-badge fm-badge-${b.tone}`}
                                    >
                                      {b.label}
                                    </span>
                                  ))}
                                </div>
                                <p className="fm-member-sub">
                                  {member.gender || "Gender not specified"} •{" "}
                                  {member.date_of_birth
                                    ? `DOB: ${member.date_of_birth}${age !== null ? ` (${age} yrs)` : ""}`
                                    : "DOB not specified"}
                                  {member.medical_notes
                                    ? ` • Medical: ${member.medical_notes}`
                                    : ""}
                                </p>
                              </div>
                            </div>
                          </div>
                        );
                      }
                    )}
                  </div>
                </div>
              </div>
            )}

              </div>

              {/* Wizard Navigation Footer */}
              <div className="fm-wizard-footer fm-wizard-modal-footer">
                <button
                  type="button"
                  className="fm-btn fm-btn-secondary"
                  onClick={requestCloseAddWizard}
                  disabled={saving}
                >
                  Cancel
                </button>

                <div className="fm-wizard-footer-right">
                  <button
                    type="button"
                    className="fm-btn fm-btn-secondary"
                    onClick={handleWizardBack}
                    disabled={wizardStep === 1 || saving}
                  >
                    Back
                  </button>
                  {wizardStep < 4 ? (
                    <button
                      key="wizard-next-btn"
                      type="button"
                      className="fm-btn fm-btn-primary"
                      onClick={handleWizardNext}
                      disabled={saving}
                    >
                      Next
                    </button>
                  ) : (
                    <button
                      key="wizard-save-btn"
                      type="button"
                      className="fm-btn fm-btn-primary"
                      onClick={requestSaveNewFamily}
                      disabled={saving}
                    >
                      <FontAwesomeIcon
                        icon={saving ? faRotate : faCheckCircle}
                        spin={saving}
                      />
                      {saving ? "Saving..." : "Save"}
                    </button>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================
          SCREEN 2: INDIVIDUAL MEMBER DETAILS (Page E)
      ===================================================== */}
      {!hideScreenContent && activeScreen === "member-detail" && activeFamily && (() => {
        const barangayLabel =
          lockedBarangayName ||
          activeFamily?.barangay ||
          "All Families";

        return (
          <div className="fm-detail-page fm-member-detail-page">
            <div className="fm-detail-topline fm-member-detail-topline">
              <nav className="fm-detail-breadcrumb" aria-label="Breadcrumb">
                {typeof onBackToBarangays === "function" ? (
                  <>
                    <button
                      type="button"
                      className="fm-detail-breadcrumb-link"
                      onClick={onBackToBarangays}
                    >
                      <FontAwesomeIcon
                        icon={faArrowLeft}
                        className="fm-detail-breadcrumb-icon"
                      />
                      <span>Barangays</span>
                    </button>
                    <FontAwesomeIcon
                      icon={faChevronRight}
                      className="fm-detail-breadcrumb-sep"
                      aria-hidden="true"
                    />
                    <button
                      type="button"
                      className="fm-detail-breadcrumb-link"
                      onClick={backToHouseholdList}
                    >
                      <span>{lockedBarangayName ? barangayLabel : "All Families"}</span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="fm-detail-breadcrumb-link"
                    onClick={backToHouseholdList}
                  >
                    <FontAwesomeIcon
                      icon={faArrowLeft}
                      className="fm-detail-breadcrumb-icon"
                    />
                    <span>Families</span>
                  </button>
                )}
                <FontAwesomeIcon
                  icon={faChevronRight}
                  className="fm-detail-breadcrumb-sep"
                  aria-hidden="true"
                />
                <button
                  type="button"
                  className="fm-detail-breadcrumb-link"
                  onClick={backToHouseholdDetails}
                >
                  <span>{activeFamily.head_name || "Family Details"}</span>
                </button>
                <FontAwesomeIcon
                  icon={faChevronRight}
                  className="fm-detail-breadcrumb-sep"
                  aria-hidden="true"
                />
                <span className="fm-detail-breadcrumb-current">
                  {activeMember ? memberDisplayName(activeMember) : "Member Details"}
                </span>
              </nav>

              {activeMember && (
                <div className="fm-member-detail-actions">
                  {!activeMember.is_head_of_family && (
                    <>
                      <button
                        type="button"
                        className="fm-detail-action-btn"
                        onClick={() => confirmPromoteToHead(activeMember)}
                      >
                        <FontAwesomeIcon icon={faUserCheck} />
                        <span>Set as Family Head</span>
                      </button>
                      <button
                        type="button"
                        className="fm-detail-action-btn danger"
                        onClick={() => confirmDeleteMember(activeMember)}
                      >
                        <FontAwesomeIcon icon={faTrashCan} />
                        <span>Remove Member</span>
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="fm-detail-action-btn"
                    onClick={() => openEditMemberModal(activeMember)}
                  >
                    <FontAwesomeIcon icon={faPenToSquare} />
                    <span>Edit Member Details</span>
                  </button>
                </div>
              )}
            </div>

          {!activeMember ? (
            <LoadingState message="Loading resident profile..." />
          ) : (
            <div className="fm-member-profile-view">
              <div className="fm-profile-hero">
                <div className="fm-profile-hero-main">
                  <div
                    className={`fm-member-avatar large ${activeMember.is_head_of_family ? "is-head" : ""}`}
                  >
                    <FontAwesomeIcon
                      icon={activeMember.is_head_of_family ? faUserCheck : faUser}
                    />
                  </div>
                  <div>
                    <div className="fm-member-title-row">
                      <h3>{memberDisplayName(activeMember)}</h3>
                      {activeMember.is_head_of_family ? (
                        <span className="fm-badge fm-badge-blue">
                          Family Head
                        </span>
                      ) : (
                        <span className="fm-badge fm-badge-neutral">
                          {familyTerm(activeMember.relationship_to_head || "Family Member")}
                        </span>
                      )}
                      <span
                        className={`fm-badge ${
                          isFamilyAssigned(activeFamily) || activeMember.assigned_room_id
                            ? "fm-badge-green"
                            : "fm-badge-amber"
                        }`}
                      >
                        {isFamilyAssigned(activeFamily) || activeMember.assigned_room_id
                          ? "Evacuation Assigned"
                          : "Unassigned"}
                      </span>
                    </div>
                    <p className="fm-profile-subtitle">
                      Family {activeFamily.family_code} (Head: {activeFamily.head_name}) • Barangay{" "}
                      {activeMember.barangay || activeFamily.barangay || "N/A"}
                    </p>
                  </div>
                </div>

                <div className="fm-profile-badges">
                  {getVulnerabilityBadges(activeMember).length > 0 ? (
                    getVulnerabilityBadges(activeMember).map((b, idx) => (
                      <span key={idx} className={`fm-badge fm-badge-${b.tone}`}>
                        {b.label}
                      </span>
                    ))
                  ) : (
                    <span className="fm-badge fm-badge-green">
                      No Vulnerability Flags
                    </span>
                  )}
                </div>
              </div>

              <div className="fm-detail-columns">
                {/* Personal Details */}
                <div className="fm-info-panel">
                  <div className="fm-info-panel-header">
                    <h4>
                      <FontAwesomeIcon icon={faUser} /> Personal Details
                    </h4>
                  </div>
                  <dl className="fm-dl-grid">
                    <div>
                      <dt>First Name</dt>
                      <dd>{activeMember.first_name || "N/A"}</dd>
                    </div>
                    <div>
                      <dt>Middle Name</dt>
                      <dd>{activeMember.middle_name || "N/A"}</dd>
                    </div>
                    <div>
                      <dt>Last Name</dt>
                      <dd>{activeMember.last_name || "N/A"}</dd>
                    </div>
                    <div>
                      <dt>Suffix</dt>
                      <dd>{activeMember.suffix || "N/A"}</dd>
                    </div>
                    <div>
                      <dt>Date of Birth</dt>
                      <dd>{activeMember.date_of_birth || "N/A"}</dd>
                    </div>
                    <div>
                      <dt>Age</dt>
                      <dd>
                        {getAge(activeMember.date_of_birth) !== null
                          ? `${getAge(activeMember.date_of_birth)} years old`
                          : "N/A"}
                      </dd>
                    </div>
                    <div>
                      <dt>Gender</dt>
                      <dd>{activeMember.gender || "N/A"}</dd>
                    </div>
                    <div>
                      <dt>Relationship to Head</dt>
                      <dd>
                        {activeMember.is_head_of_family
                          ? "Family Head"
                          : familyTerm(activeMember.relationship_to_head || "N/A")}
                      </dd>
                    </div>
                    <div>
                      <dt>Family Head</dt>
                      <dd>
                        {activeMember.is_head_of_family
                          ? "Yes — Family Head"
                          : `No (${activeFamily.head_name})`}
                      </dd>
                    </div>
                    <div>
                      <dt>Contact Number</dt>
                      <dd>
                        {activeMember.contact_number ||
                          activeFamily.contact_number ||
                          "N/A"}
                      </dd>
                    </div>
                    <div>
                      <dt>Alternate Contact</dt>
                      <dd>{activeMember.alternate_contact || "N/A"}</dd>
                    </div>
                    <div>
                      <dt>Family Address</dt>
                      <dd>
                        {activeMember.address ||
                          activeFamily.address ||
                          "N/A"}
                      </dd>
                    </div>
                  </dl>
                </div>

                {/* Health & Special Needs Details */}
                <div className="fm-info-panel">
                  <div className="fm-info-panel-header">
                    <h4>
                      <FontAwesomeIcon icon={faHeartPulse} /> Health & Special Needs
                    </h4>
                  </div>
                  <dl className="fm-dl-grid">
                    <div>
                      <dt>PWD Status</dt>
                      <dd>
                        <span
                          className={`fm-badge ${activeMember.is_pwd ? "fm-badge-amber" : "fm-badge-neutral"}`}
                        >
                          {activeMember.is_pwd ? "Yes (PWD)" : "No"}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt>Disability Type</dt>
                      <dd>
                        {activeMember.is_pwd
                          ? activeMember.disability_type || "N/A"
                          : "N/A"}
                      </dd>
                    </div>
                    <div>
                      <dt>Disability Notes</dt>
                      <dd>
                        {activeMember.is_pwd
                          ? activeMember.disability_notes || "N/A"
                          : "N/A"}
                      </dd>
                    </div>
                    <div>
                      <dt>Pregnant</dt>
                      <dd>
                        <span
                          className={`fm-badge ${activeMember.is_pregnant ? "fm-badge-amber" : "fm-badge-neutral"}`}
                        >
                          {activeMember.is_pregnant ? "Yes" : "No"}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt>Lactating Mother</dt>
                      <dd>
                        <span
                          className={`fm-badge ${activeMember.is_lactating ? "fm-badge-blue" : "fm-badge-neutral"}`}
                        >
                          {activeMember.is_lactating ? "Yes" : "No"}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt>Solo Parent</dt>
                      <dd>
                        <span
                          className={`fm-badge ${activeMember.is_solo_parent ? "fm-badge-blue" : "fm-badge-neutral"}`}
                        >
                          {activeMember.is_solo_parent ? "Yes" : "No"}
                        </span>
                      </dd>
                    </div>
                    <div className="fm-dl-full">
                      <dt>Medical Notes</dt>
                      <dd>{activeMember.medical_notes || "N/A"}</dd>
                    </div>
                    <div className="fm-dl-full">
                      <dt>Additional Notes</dt>
                      <dd>
                        {activeMember.notes ||
                          activeMember.remarks ||
                          "N/A"}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>

              {/* Household & Evacuation Assignment Link */}
              <div className="fm-info-panel" style={{ marginTop: "1rem" }}>
                <div className="fm-info-panel-header">
                  <h4>
                    <FontAwesomeIcon icon={faBuilding} />
                    {getFamilyStructureMode(activeFamily) === "open_area"
                      ? "Family & Evacuation Center Assignment"
                      : "Family & Evacuation Room Assignment"}
                  </h4>
                </div>
                <dl className="fm-dl-grid">
                  <div>
                    <dt>Family ID</dt>
                    <dd>{activeFamily.family_code}</dd>
                  </div>
                  <div>
                    <dt>Family Head</dt>
                    <dd>{activeFamily.head_name}</dd>
                  </div>
                  <div>
                    <dt>Evacuation Center</dt>
                    <dd>
                      <strong>
                        {displayEntityName(
                          activeMember.assigned_center_name ||
                            activeFamily.current_center ||
                            activeFamily.evacuation_center ||
                            activeFamily.assignments?.[0]?.center
                        ) || "Unassigned"}
                      </strong>
                    </dd>
                  </div>
                  {getFamilyStructureMode(activeFamily) === "buildings_and_rooms" &&
                    (activeFamily.current_building_name || activeFamily.current_building) && (
                      <div>
                        <dt>Assigned Building</dt>
                        <dd>
                          <strong>
                            {activeFamily.current_building_name || activeFamily.current_building}
                          </strong>
                        </dd>
                      </div>
                    )}
                  {getFamilyStructureMode(activeFamily) !== "open_area" && (
                    <div>
                      <dt>Assigned Room</dt>
                      <dd>
                        <strong>
                          {formatRoomLabel(
                            activeMember.assigned_room_number ||
                              activeFamily.current_room ||
                              activeFamily.rooms ||
                              activeFamily.assignments?.[0]?.room
                          )}
                        </strong>
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            </div>
          )}
        </div>
        );
      })()}

      {/* =====================================================
          SCREEN 3: HOUSEHOLD DETAILS (Page D)
      ===================================================== */}
      {!hideScreenContent && activeScreen === "household-detail" && (() => {
        const assigned = activeFamily ? isFamilyAssigned(activeFamily) : false;
        const memberCount = activeFamily
          ? activeFamily.members?.length ??
            activeFamily.resident_count ??
            activeFamily.member_count ??
            0
          : 0;
        const canDeleteHousehold = activeFamily ? !assigned : false;
        const barangayLabel =
          lockedBarangayName ||
          activeFamily?.barangay ||
          "All Families";

        return (
          <div className="fm-detail-page fm-family-detail-page">
            <div className="fm-detail-topline">
              <nav className="fm-detail-breadcrumb" aria-label="Breadcrumb">
                {typeof onBackToBarangays === "function" ? (
                  <>
                    <button
                      type="button"
                      className="fm-detail-breadcrumb-link"
                      onClick={onBackToBarangays}
                    >
                      <FontAwesomeIcon
                        icon={faArrowLeft}
                        className="fm-detail-breadcrumb-icon"
                      />
                      <span>Barangays</span>
                    </button>
                    <FontAwesomeIcon
                      icon={faChevronRight}
                      className="fm-detail-breadcrumb-sep"
                      aria-hidden="true"
                    />
                    <button
                      type="button"
                      className="fm-detail-breadcrumb-link"
                      onClick={backToHouseholdList}
                    >
                      <span>{lockedBarangayName ? barangayLabel : "All Families"}</span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="fm-detail-breadcrumb-link"
                    onClick={backToHouseholdList}
                  >
                    <FontAwesomeIcon
                      icon={faArrowLeft}
                      className="fm-detail-breadcrumb-icon"
                    />
                    <span>Families</span>
                  </button>
                )}
                <FontAwesomeIcon
                  icon={faChevronRight}
                  className="fm-detail-breadcrumb-sep"
                  aria-hidden="true"
                />
                <span className="fm-detail-breadcrumb-current">
                  {activeFamily?.head_name || "Family Details"}
                </span>
              </nav>
            </div>

            {familyDetailQuery.isLoading && !activeFamily ? (
              <LoadingState message="Loading family details..." />
            ) : !activeFamily ? (
              <div className="fm-empty-state">
                <p>Family record could not be found.</p>
              </div>
            ) : (
              <>
                {/* Full-page Household Header */}
                <div className="fm-detail-hero">
                  <div className="fm-detail-hero-main">
                    <div className="fm-detail-title-row">
                      <h2 className="fm-detail-title">{activeFamily.head_name}</h2>
                      <span
                        className={`fm-detail-status-pill ${assigned ? "complete" : "pending"}`}
                      >
                        <FontAwesomeIcon
                          icon={assigned ? faCheckCircle : faTriangleExclamation}
                        />
                        {assigned ? "Assigned" : "Unassigned"}
                      </span>
                      {assigned && (
                        <span
                          className={`fm-badge ${activeFamily.is_checked_in ? "fm-badge-green" : "fm-badge-neutral"}`}
                        >
                          {activeFamily.checkin_status ||
                            (activeFamily.is_checked_in
                              ? "Checked in"
                              : "Not yet arrived")}
                        </span>
                      )}
                    </div>

                    <div className="fm-detail-actions">
                      <div className="fm-detail-actions-desktop">
                        <button
                          type="button"
                          className="fm-detail-action-btn"
                          onClick={() => openEditHouseholdModal(activeFamily)}
                        >
                          <FontAwesomeIcon icon={faPenToSquare} />
                          <span>Edit Family</span>
                        </button>
                        {canDeleteHousehold && (
                          <button
                            type="button"
                            className="fm-detail-action-btn danger"
                            onClick={() => confirmDeleteFamily(activeFamily)}
                          >
                            <FontAwesomeIcon icon={faTrashCan} />
                            <span>Delete</span>
                          </button>
                        )}
                      </div>

                      <div className="fm-detail-menu-wrap">
                        <button
                          type="button"
                          className="fm-detail-menu-trigger"
                          aria-label="Family actions"
                          aria-expanded={detailMenuOpen}
                          aria-haspopup="menu"
                          onClick={() => setDetailMenuOpen((prev) => !prev)}
                        >
                          <FontAwesomeIcon icon={faEllipsisVertical} />
                        </button>
                        {detailMenuOpen && (
                          <div className="fm-detail-menu-popover" role="menu">
                            <button
                              type="button"
                              role="menuitem"
                              className="fm-detail-menu-item"
                              onClick={() => {
                                setDetailMenuOpen(false);
                                openEditHouseholdModal(activeFamily);
                              }}
                            >
                              <FontAwesomeIcon icon={faPenToSquare} />
                              <span>Edit Family</span>
                            </button>
                            {canDeleteHousehold && (
                              <button
                                type="button"
                                role="menuitem"
                                className="fm-detail-menu-item danger"
                                onClick={() => {
                                  setDetailMenuOpen(false);
                                  confirmDeleteFamily(activeFamily);
                                }}
                              >
                                <FontAwesomeIcon icon={faTrashCan} />
                                <span>Delete</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="fm-detail-chips">
                      {activeFamily.family_code && (
                        <span className="fm-detail-chip fm-detail-chip-code">
                          {activeFamily.family_code}
                        </span>
                      )}
                      <span className="fm-detail-chip">
                        Barangay {activeFamily.barangay || lockedBarangayName || "—"} ·{" "}
                        {memberCount} Member{memberCount === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="fm-detail-sections">
                  {/* Two-column Household Info + Evacuation Assignment */}
                  <div className="fm-detail-columns">
                {/* Household Information */}
                <div className="fm-info-panel">
                  <div className="fm-info-panel-header">
                    <h4>
                      <FontAwesomeIcon icon={faHouse} /> Family Details
                    </h4>
                    <button
                      type="button"
                      className="fm-btn fm-btn-ghost fm-btn-sm"
                      onClick={() => openEditHouseholdModal(activeFamily)}
                    >
                      <FontAwesomeIcon icon={faPenToSquare} /> Edit
                    </button>
                  </div>
                  <dl className="fm-dl-grid">
                    <div>
                      <dt>Family Code</dt>
                      <dd>{activeFamily.family_code}</dd>
                    </div>
                    <div>
                      <dt>Barangay</dt>
                      <dd>{activeFamily.barangay || "Not specified"}</dd>
                    </div>
                    <div>
                      <dt>Address</dt>
                      <dd>{activeFamily.address || "Not recorded"}</dd>
                    </div>
                    <div>
                      <dt>Contact Number</dt>
                      <dd>{activeFamily.contact_number || "Not provided"}</dd>
                    </div>
                    {activeFamily.alternate_contact && (
                      <div>
                        <dt>Alternate Contact</dt>
                        <dd>{activeFamily.alternate_contact}</dd>
                      </div>
                    )}
                    <div className="fm-dl-full">
                      <dt>Remarks</dt>
                      <dd>{activeFamily.remarks || "None recorded"}</dd>
                    </div>
                  </dl>
                </div>

                {/* Evacuation Center & Room Assignment */}
                <div className="fm-info-panel">
                  <div className="fm-info-panel-header">
                    <h4>
                      <FontAwesomeIcon icon={faBuilding} />
                      {getFamilyStructureMode(activeFamily) === "open_area"
                        ? "Evacuation Center Assignment"
                        : "Evacuation Room Assignment"}
                    </h4>
                  </div>

                  {isFamilyAssigned(activeFamily) ? (
                    <div className="fm-assignment-active-box">
                      <dl className="fm-dl-grid">
                        <div>
                          <dt>Evacuation Center</dt>
                          <dd>
                            <strong>
                              {displayEntityName(
                                activeFamily.current_center ||
                                  activeFamily.evacuation_center ||
                                  activeFamily.assignments?.[0]?.center
                              ) || "Assigned Center"}
                            </strong>
                          </dd>
                        </div>
                        {getFamilyStructureMode(activeFamily) === "buildings_and_rooms" &&
                          (activeFamily.current_building_name || activeFamily.current_building) && (
                            <div>
                              <dt>Assigned Building</dt>
                              <dd>
                                <strong>
                                  {activeFamily.current_building_name ||
                                    activeFamily.current_building}
                                </strong>
                              </dd>
                            </div>
                          )}
                        {getFamilyStructureMode(activeFamily) !== "open_area" && (
                          <>
                            <div>
                              <dt>Assigned Room</dt>
                              <dd>
                                <strong>
                                  {formatRoomLabel(
                                    activeFamily.current_room ||
                                      activeFamily.rooms ||
                                      activeFamily.assignments?.[0]?.room
                                  )}
                                </strong>
                              </dd>
                            </div>
                            <div>
                              <dt>Family Slots</dt>
                              <dd>
                                {activeFamily.current_room_family_slots ??
                                  activeFamily.assignments?.[0]?.room_family_slots ??
                                  "—"}
                              </dd>
                            </div>
                            <div>
                              <dt>People Spaces</dt>
                              <dd>
                                {activeFamily.current_room_assigned ??
                                  activeFamily.assigned_members ??
                                  0} of{" "}
                                {activeFamily.current_room_capacity ??
                                  activeFamily.assignments?.[0]?.room_capacity ??
                                  "—"}{" "}
                                total
                              </dd>
                            </div>
                          </>
                        )}
                        {getFamilyStructureMode(activeFamily) === "open_area" && (
                          <>
                            <div>
                              <dt>Center Capacity</dt>
                              <dd>
                                {activeFamily.current_center_capacity ??
                                  activeFamily.assignments?.[0]?.center_capacity ??
                                  "—"}
                              </dd>
                            </div>
                            <div>
                              <dt>Center Occupancy</dt>
                              <dd>
                                {activeFamily.current_center_occupied ?? 0} of{" "}
                                {activeFamily.current_center_capacity ??
                                  activeFamily.assignments?.[0]?.center_capacity ??
                                  "—"}{" "}
                                here ·{" "}
                                {activeFamily.current_center_assigned ??
                                  activeFamily.assigned_members ??
                                  "—"}{" "}
                                assigned
                              </dd>
                            </div>
                          </>
                        )}
                      </dl>
                      <div className="fm-assignment-actions">
                        <button
                          type="button"
                          className="fm-btn fm-btn-primary"
                          onClick={() => openMoveModal(activeFamily)}
                        >
                          <FontAwesomeIcon icon={faRightLeft} />
                          {getFamilyStructureMode(activeFamily) === "open_area"
                            ? "Change Evacuation Center"
                            : "Change Assigned Room"}
                        </button>
                        <button
                          type="button"
                          className="fm-btn fm-btn-danger-outline"
                          onClick={() => confirmUnassign(activeFamily)}
                        >
                          <FontAwesomeIcon icon={faUserMinus} /> Unassign
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="fm-assignment-empty-box">
                      <p>
                        This family is currently{" "}
                        <strong>Unassigned</strong> to any evacuation center.
                      </p>
                      <button
                        type="button"
                        className="fm-btn fm-btn-primary"
                        onClick={() => openAssignModal(activeFamily)}
                      >
                        <FontAwesomeIcon icon={faDoorOpen} />
                        Assign Shelter
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Family Members Section */}
              <div className="fm-members-section">
                <div className="fm-members-section-header">
                  <div className="fm-members-section-heading">
                    <h4>
                      <FontAwesomeIcon icon={faUsers} /> Family Members (
                      {activeFamily.members?.length ??
                        activeFamily.resident_count ??
                        activeFamily.member_count ??
                        0}
                      )
                    </h4>
                    <p>
                      Select any member to view their personal details and health notes.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="fm-btn fm-btn-primary fm-btn-sm fm-members-add-btn"
                    onClick={openAddMemberModal}
                  >
                    <FontAwesomeIcon icon={faUserPlus} /> Add Member
                  </button>
                </div>

                {familyDetailQuery.isLoading && !activeFamily.members ? (
                  <LoadingState message="Loading family members..." />
                ) : !activeFamily.members ||
                  activeFamily.members.length === 0 ? (
                  <div className="fm-empty-inline fm-members-empty">
                    <FontAwesomeIcon icon={faUsers} />
                    <div className="fm-members-empty-copy">
                      <strong>No members yet</strong>
                      <p>
                        Add a family member to record personal and health information.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="fm-btn fm-btn-primary fm-btn-sm fm-members-empty-btn"
                      onClick={openAddMemberModal}
                    >
                      <FontAwesomeIcon icon={faUserPlus} /> Add Member
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Desktop Compact Members Table */}
                    <div className="fm-table-wrap fm-desktop-only">
                      <table className="fm-table fm-members-table">
                        <thead>
                          <tr>
                            <th>Full Name</th>
                            <th>Role</th>
                            <th>Birth Date & Age</th>
                            <th>Gender</th>
                            <th className="fm-col-actions">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeFamily.members.map((member) => {
                            const age = getAge(member.date_of_birth);
                            const displayName = memberDisplayName(member);
                            return (
                              <tr
                                key={member.id}
                                className="fm-table-row fm-clickable-row"
                                tabIndex={0}
                                aria-label={`View details for ${displayName}`}
                                onClick={() => openMemberDetails(member)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    openMemberDetails(member);
                                  }
                                }}
                              >
                                <td>
                                  <div className="fm-member-cell-name">
                                    <strong className="fm-row-link-text">{displayName}</strong>
                                    {member.is_head_of_family && (
                                      <span className="fm-badge fm-badge-blue">
                                        Family Head
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td>
                                  {member.is_head_of_family
                                    ? "Self (Head)"
                                    : familyTerm(member.relationship_to_head ||
                                      "Family Member")}
                                </td>
                                <td>
                                  {member.date_of_birth ? (
                                    <span>
                                      {member.date_of_birth}
                                      {age !== null ? (
                                        <small className="fm-muted-inline">
                                          {" "}
                                          ({age} yrs)
                                        </small>
                                      ) : null}
                                    </span>
                                  ) : (
                                    <span className="fm-muted-inline">
                                      Not recorded
                                    </span>
                                  )}
                                </td>
                                <td>{member.gender || "N/A"}</td>
                                <td className="fm-col-actions">
                                  <div
                                    className="fm-row-actions"
                                    onClick={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => e.stopPropagation()}
                                  >
                                    <button
                                      type="button"
                                      className="fm-btn-icon edit"
                                      aria-label="Edit member"
                                      title="Edit member"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openEditMemberModal(member);
                                      }}
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

                    {/* Mobile Compact Member Cards (768px and below) */}
                    <div className="fm-mobile-cards fm-members-mobile-cards fm-mobile-only">
                      {activeFamily.members.map((member, idx) => {
                        const age = getAge(member.date_of_birth);
                        const badges = getVulnerabilityBadges(member);
                        const displayName = memberDisplayName(member);
                        const roleLabel = member.is_head_of_family
                          ? "Family Head"
                          : familyTerm(member.relationship_to_head || "Family Member");
                        const metaParts = [
                          member.gender || "N/A",
                          age !== null ? `${age} yrs` : null,
                          member.date_of_birth ? member.date_of_birth : null,
                        ].filter(Boolean);
                        const menuKey = `member-${member.id}`;
                        const isMenuOpen = openMobileCardMenuId === menuKey;
                        const openUpward =
                          activeFamily.members.length >= 3 &&
                          idx >= activeFamily.members.length - 2;

                        return (
                          <article
                            key={member.id}
                            className={`fm-mobile-card fm-member-mobile-card ${
                              isMenuOpen ? "has-open-menu" : ""
                            }`}
                            role="button"
                            tabIndex={0}
                            aria-label={`View details for ${displayName}`}
                            onClick={() => {
                              setOpenMobileCardMenuId(null);
                              openMemberDetails(member);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setOpenMobileCardMenuId(null);
                                openMemberDetails(member);
                              }
                            }}
                          >
                            <div className="fm-mm-row1">
                              <span className="fm-mm-name">{displayName}</span>
                              <div
                                className="fm-mobile-card-menu-wrap fm-mm-menu-wrap"
                                onClick={(e) => e.stopPropagation()}
                                onKeyDown={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  className="fm-mc-menu-trigger"
                                  aria-label={`Actions for ${displayName}`}
                                  aria-expanded={isMenuOpen}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenMobileCardMenuId((prev) =>
                                      prev === menuKey ? null : menuKey
                                    );
                                  }}
                                >
                                  <FontAwesomeIcon icon={faEllipsisVertical} />
                                </button>
                                {isMenuOpen && (
                                  <div
                                    className={`fm-mc-menu-popover ${
                                      openUpward ? "open-upward" : ""
                                    }`}
                                    role="menu"
                                  >
                                    <button
                                      type="button"
                                      role="menuitem"
                                      className="fm-mc-menu-item"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setOpenMobileCardMenuId(null);
                                        openMemberDetails(member);
                                      }}
                                    >
                                      <FontAwesomeIcon icon={faEye} />
                                      <span>Details</span>
                                    </button>
                                    <button
                                      type="button"
                                      role="menuitem"
                                      className="fm-mc-menu-item"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setOpenMobileCardMenuId(null);
                                        openEditMemberModal(member);
                                      }}
                                    >
                                      <FontAwesomeIcon icon={faPenToSquare} />
                                      <span>Edit</span>
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="fm-mm-role-row">
                              <span
                                className={`fm-badge fm-mm-role-pill ${
                                  member.is_head_of_family
                                    ? "fm-badge-blue"
                                    : "fm-badge-neutral"
                                }`}
                              >
                                {roleLabel}
                              </span>
                            </div>

                            {metaParts.length > 0 && (
                              <div className="fm-mm-meta">
                                {metaParts.join(" · ")}
                              </div>
                            )}

                            {badges.length > 0 && (
                              <div className="fm-mm-needs">
                                {badges.map((b, bIdx) => (
                                  <span
                                    key={bIdx}
                                    className={`fm-badge fm-badge-${b.tone} fm-mm-need-pill`}
                                  >
                                    {b.label}
                                  </span>
                                ))}
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  </>
                )}
                </div>
              </div>
            </>
          )}
        </div>
        );
      })()}

      {/* =====================================================
          SCREEN 4: FAMILIES LIST (REDESIGNED TABLE CARD)
      ===================================================== */}
      {!hideScreenContent && activeScreen === "list" && (
        <section
          className={`fm-list-card ${lockedBarangayId ? "is-locked-barangay" : ""}`.trim()}
          aria-label={lockedBarangayName ? `Families in ${lockedBarangayName}` : "All families"}
        >
          {/* Optional standalone header (when not hosted under BarangayManager header) */}
          {!hideListHeader && (
            <div className="fm-list-card-header">
              <div>
                <h3 className="fm-list-card-title">
                  {lockedBarangayName ? `Families in ${lockedBarangayName}` : "Registered Families"}
                </h3>
                <p className="fm-list-card-sub">
                  Search families, filter by shelter assignment status, and manage members and rooms.
                </p>
              </div>
              <div className="fm-list-card-actions">
                <Button variant="secondary" onClick={exportFamilies}>
                  <span>Export CSV</span>
                </Button>
                <Button variant="primary" onClick={openAddFamilyWizard}>
                  <Plus size={16} strokeWidth={2} aria-hidden="true" />
                  <span>Add Family</span>
                </Button>
              </div>
            </div>
          )}

          {/* Toolbar: Search, Census Year, Barangay, Status, Sort */}
          <div className="fm-list-toolbar">
            <div className="fm-list-search-wrap">
              <Search
                size={16}
                strokeWidth={2}
                className="fm-list-search-icon"
                aria-hidden="true"
              />
              <input
                type="search"
                className="fm-list-search-input"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search by family ID, family head, or member name..."
                aria-label="Search families by family ID, family head, or member name"
              />
              {searchInput && (
                <button
                  type="button"
                  className="fm-list-search-clear"
                  aria-label="Clear search"
                  onClick={() => {
                    setSearchInput("");
                    setSearch("");
                    setPage(1);
                  }}
                >
                  <X size={15} strokeWidth={2} aria-hidden="true" />
                </button>
              )}
            </div>

            <MobileFilterButton
              activeCount={
                (yearFilter ? 1 : 0) +
                (!lockedBarangayId && barangayFilter ? 1 : 0) +
                (assignmentStatus ? 1 : 0) +
                (sortBy !== "family_code" || direction !== "asc" ? 1 : 0)
              }
              title="Filter & sort families"
              onReset={() => {
                setPage(1);
                setYearFilter("");
                if (!lockedBarangayId) setBarangayFilter("");
                setAssignmentStatus("");
                setSortBy("family_code");
                setDirection("asc");
              }}
            >
              <label className="ui-mobile-filter-field">
                <span className="ui-mobile-filter-field__label">Census year</span>
                <select
                  value={yearFilter}
                  onChange={(e) => {
                    setPage(1);
                    setYearFilter(e.target.value);
                  }}
                  aria-label="Filter by census year"
                >
                  <option value="">All Years</option>
                  {rosterYears.map((ry) => (
                    <option key={ry.id || ry.year} value={ry.year}>
                      Census Year {ry.year} {ry.is_active ? "(Active)" : ""}
                    </option>
                  ))}
                </select>
              </label>

              {!lockedBarangayId && (
                <label className="ui-mobile-filter-field">
                  <span className="ui-mobile-filter-field__label">Barangay</span>
                  <select
                    value={barangayFilter}
                    onChange={(e) => {
                      setPage(1);
                      setBarangayFilter(e.target.value);
                    }}
                    aria-label="Filter by barangay"
                  >
                    <option value="">All Barangays</option>
                    {barangays.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="ui-mobile-filter-field">
                <span className="ui-mobile-filter-field__label">Status</span>
                <select
                  value={assignmentStatus}
                  onChange={(e) => {
                    setPage(1);
                    setAssignmentStatus(e.target.value);
                  }}
                  aria-label="Filter by status"
                >
                  <option value="">All Statuses</option>
                  <option value="assigned">Assigned</option>
                  <option value="unassigned">Unassigned</option>
                </select>
              </label>

              <label className="ui-mobile-filter-field">
                <span className="ui-mobile-filter-field__label">Sort by</span>
                <select
                  value={`${sortBy}:${direction}`}
                  onChange={(e) => {
                    const [nextSort, nextDir] = e.target.value.split(":");
                    setPage(1);
                    setSortBy(nextSort);
                    setDirection(nextDir);
                  }}
                  aria-label="Sort families"
                >
                  <option value="family_code:asc">Family ID (A–Z)</option>
                  <option value="head_name:asc">Family Head (A–Z)</option>
                  <option value="member_count:desc">Most Members</option>
                  <option value="created_at:desc">Recently Added</option>
                </select>
              </label>
            </MobileFilterButton>

            <div className="fm-list-controls">
              <select
                className="fm-list-select"
                value={yearFilter}
                onChange={(e) => {
                  setPage(1);
                  setYearFilter(e.target.value);
                }}
                aria-label="Filter by census year"
              >
                <option value="">All Years</option>
                {rosterYears.map((ry) => (
                  <option key={ry.id || ry.year} value={ry.year}>
                    Census Year {ry.year} {ry.is_active ? "(Active)" : ""}
                  </option>
                ))}
              </select>

              {!lockedBarangayId && (
                <select
                  className="fm-list-select"
                  value={barangayFilter}
                  onChange={(e) => {
                    setPage(1);
                    setBarangayFilter(e.target.value);
                  }}
                  aria-label="Filter by barangay"
                >
                  <option value="">All Barangays</option>
                  {barangays.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              )}

              <select
                className="fm-list-select"
                value={assignmentStatus}
                onChange={(e) => {
                  setPage(1);
                  setAssignmentStatus(e.target.value);
                }}
                aria-label="Filter by status"
              >
                <option value="">All Statuses</option>
                <option value="assigned">Assigned</option>
                <option value="unassigned">Unassigned</option>
              </select>

              <select
                className="fm-list-select"
                value={`${sortBy}:${direction}`}
                onChange={(e) => {
                  const [nextSort, nextDir] = e.target.value.split(":");
                  setPage(1);
                  setSortBy(nextSort);
                  setDirection(nextDir);
                }}
                aria-label="Sort families"
              >
                <option value="family_code:asc">Family ID (A–Z)</option>
                <option value="head_name:asc">Family Head (A–Z)</option>
                <option value="member_count:desc">Most Members</option>
                <option value="created_at:desc">Recently Added</option>
              </select>
            </div>
          </div>

          {/* Body: Skeleton Loading / Error / Empty / Rows */}
          {loading ? (
            <div className="fm-list-table-scroll" aria-busy="true" aria-label="Loading families">
              <div className="fm-list-head" aria-hidden="true">
                <div className={`fm-list-cols ${lockedBarangayId ? "is-locked" : ""}`}>
                  <span>FAMILY</span>
                  {!lockedBarangayId && <span>BARANGAY</span>}
                  <span>MEMBERS</span>
                  <span>BUILDING &middot; ROOM</span>
                </div>
                <span className="fm-list-actions-head">ACTIONS</span>
              </div>
              {Array.from({ length: 6 }).map((_, idx) => (
                <div key={idx} className="fm-list-skeleton-row" aria-hidden="true">
                  <div className={`fm-list-cols ${lockedBarangayId ? "is-locked" : ""}`}>
                    <div className="fm-list-family-cell">
                      <span className="fm-skel fm-skel-avatar" />
                      <div className="fm-skel-stack">
                        <span className="fm-skel fm-skel-name" />
                        <span className="fm-skel fm-skel-code" />
                      </div>
                    </div>
                    {!lockedBarangayId && <span className="fm-skel fm-skel-chip" />}
                    <span className="fm-skel fm-skel-chip-sm" />
                    <div className="fm-skel-stack">
                      <span className="fm-skel fm-skel-room" />
                      <span className="fm-skel fm-skel-center" />
                    </div>
                  </div>
                  <div className="fm-list-actions-cell">
                    <span className="fm-skel fm-skel-btn" />
                    <span className="fm-skel fm-skel-btn" />
                  </div>
                </div>
              ))}
            </div>
          ) : familiesQuery.error ? (
            <div className="fm-list-state" role="alert">
              <span className="fm-list-state-icon is-error" aria-hidden="true">
                <AlertTriangle size={20} strokeWidth={2} />
              </span>
              <h3>Could not load families</h3>
              <p>
                {familiesQuery.error?.message ||
                  "Something went wrong while loading family records."}
              </p>
              <Button variant="secondary" onClick={() => familiesQuery.refetch()}>
                Try again
              </Button>
            </div>
          ) : families.length === 0 ? (
            <div className="fm-list-state" role="status">
              <span className="fm-list-state-icon" aria-hidden="true">
                <Users size={20} strokeWidth={2} />
              </span>
              <h3>
                {searchInput.trim() ||
                (!lockedBarangayId && barangayFilter) ||
                assignmentStatus ||
                (yearFilter && yearFilter !== defaultYearFilter) ||
                sortBy !== "family_code" ||
                direction !== "asc"
                  ? "No matching families"
                  : "No families found"}
              </h3>
              <p>
                {searchInput.trim() ||
                (!lockedBarangayId && barangayFilter) ||
                assignmentStatus ||
                (yearFilter && yearFilter !== defaultYearFilter) ||
                sortBy !== "family_code" ||
                direction !== "asc"
                  ? "Try adjusting your search or filter criteria to see more families."
                  : lockedBarangayName
                    ? `No families are registered in ${lockedBarangayName} yet. Register a family using Add Family to get started.`
                    : "Register a family using Add Family to get started."}
              </p>
              {searchInput.trim() ||
              (!lockedBarangayId && barangayFilter) ||
              assignmentStatus ||
              (yearFilter && yearFilter !== defaultYearFilter) ||
              sortBy !== "family_code" ||
              direction !== "asc" ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearchInput("");
                    setSearch("");
                    if (!lockedBarangayId) setBarangayFilter("");
                    setAssignmentStatus("");
                    setYearFilter(defaultYearFilter);
                    setSortBy("family_code");
                    setDirection("asc");
                    setPage(1);
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <Button variant="primary" onClick={openAddFamilyWizard}>
                  <Plus size={16} strokeWidth={2} aria-hidden="true" />
                  <span>Add Family</span>
                </Button>
              )}
            </div>
          ) : (
            <>
              <div ref={listTableWrapRef} className="fm-list-table-scroll">
                <div className="fm-list-head" role="row">
                  <div className={`fm-list-cols ${lockedBarangayId ? "is-locked" : ""}`}>
                    <span role="columnheader">FAMILY</span>
                    {!lockedBarangayId && <span role="columnheader">BARANGAY</span>}
                    <span role="columnheader">MEMBERS</span>
                    <span role="columnheader">BUILDING &middot; ROOM</span>
                  </div>
                  <span role="columnheader" className="fm-list-actions-head">
                    ACTIONS
                  </span>
                </div>

                <div ref={listMobileCardsRef} className="fm-list-rows" role="list">
                  {families.map((fam) => {
                    const assigned = isFamilyAssigned(fam);
                    const structureMode = getFamilyStructureMode(fam);
                    const centerName = displayEntityName(
                      fam.current_center_name || fam.current_center || fam.evacuation_center
                    );
                    const roomNum = fam.current_room_name || fam.current_room || fam.rooms;
                    const bldgName = fam.current_building_name || fam.current_building;
                    const roomLabel = roomNum ? formatRoomLabel(roomNum) : null;
                    const bldgRoomText =
                      assigned && structureMode !== "open_area" && roomLabel
                        ? structureMode === "buildings_and_rooms" && bldgName
                          ? `${bldgName} · ${roomLabel}`
                          : roomLabel
                        : null;
                    const memberCount = Number(
                      fam.resident_count ?? fam.member_count ?? 0
                    );
                    const displayCode =
                      fam.family_code || formatHouseholdDisplayCode(fam.id);

                    return (
                      <div key={fam.id} className="fm-list-row" role="listitem">
                        <button
                          type="button"
                          className={`fm-list-row-main fm-list-cols ${
                            lockedBarangayId ? "is-locked" : ""
                          }`}
                          aria-label={`View family details for ${fam.head_name}`}
                          onClick={() => openHouseholdDetails(fam)}
                        >
                          {/* FAMILY */}
                          <span className="fm-list-family-cell">
                            <span className="fm-list-avatar" aria-hidden="true">
                              {getHouseholdInitials(fam.head_name)}
                            </span>
                            <span className="fm-list-family-copy">
                              <span className="fm-list-family-name">{fam.head_name}</span>
                              <span
                                className="fm-list-code-chip"
                                title={`Family ID: ${displayCode}`}
                              >
                                {displayCode}
                              </span>
                            </span>
                          </span>

                          {/* BARANGAY */}
                          {!lockedBarangayId && (
                            <span className="fm-list-chip-cell">
                              <span className="fm-list-chip">{fam.barangay || "—"}</span>
                            </span>
                          )}

                          {/* MEMBERS */}
                          <span className="fm-list-chip-cell">
                            <span className="fm-list-chip">
                              {memberCount} {memberCount === 1 ? "member" : "members"}
                            </span>
                          </span>

                          {/* BUILDING · ROOM */}
                          <span className="fm-list-shelter-cell">
                            {assigned ? (
                              <span className="fm-list-shelter-copy">
                                <strong className="fm-list-shelter-room">
                                  {bldgRoomText || centerName || "Assigned"}
                                </strong>
                                {bldgRoomText && centerName && (
                                  <span className="fm-list-shelter-center" title={centerName}>
                                    {centerName}
                                  </span>
                                )}
                              </span>
                            ) : (
                              <StatusPill variant="unassigned" />
                            )}
                          </span>
                        </button>

                        {/* ACTIONS */}
                        <div className="fm-list-actions-cell">
                          <button
                            type="button"
                            className="fm-list-icon-btn"
                            aria-label={`Edit ${fam.head_name}`}
                            title="Edit family"
                            onClick={() => openEditHouseholdModal(fam)}
                          >
                            <Pencil size={16} strokeWidth={2} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="fm-list-icon-btn"
                            aria-label={
                              assigned
                                ? `Transfer ${fam.head_name} to another room`
                                : `Assign ${fam.head_name} to a room`
                            }
                            title={assigned ? "Transfer room" : "Assign room"}
                            onClick={() => {
                              if (assigned) {
                                openMoveModal(fam);
                              } else {
                                openAssignModal(fam);
                              }
                            }}
                          >
                            <ArrowLeftRight size={16} strokeWidth={2} aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Footer: Showing X of Y + Previous / Next */}
              <footer className="fm-list-footer">
                <span className="fm-list-footer-info">
                  {pages > 1
                    ? `Showing ${((page - 1) * pageSize + 1).toLocaleString()}–${Math.min(
                        page * pageSize,
                        total
                      ).toLocaleString()} of ${total.toLocaleString()} families`
                    : `Showing ${total.toLocaleString()} of ${total.toLocaleString()} ${
                        total === 1 ? "family" : "families"
                      }`}
                </span>

                <div className="fm-list-footer-nav">
                  <Button
                    variant="secondary"
                    className="fm-list-page-btn"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    className="fm-list-page-btn"
                    disabled={page >= pages}
                    onClick={() => setPage((p) => Math.min(pages, p + 1))}
                  >
                    Next
                  </Button>
                </div>
              </footer>
            </>
          )}
        </section>
      )}

      {/* =====================================================
          MODALS (EDIT HOUSEHOLD, ADD/EDIT MEMBER, ASSIGN, MOVE, IMPORT)
      ===================================================== */}
      {modal && (
        <div
          className={`fm-modal-backdrop ${
            modal === "edit-household" || modal === "member-form"
              ? "fm-modal-fullscreen-mobile"
              : ""
          }`.trim()}
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div
            className={`fm-modal-dialog ${modal === "member-form" ? "fm-modal-wide" : ""} ${
              modal === "edit-household" || modal === "member-form"
                ? "fm-modal-fullscreen-mobile"
                : ""
            }`.trim()}
          >
            <div className="fm-modal-header">
              <div>
                <h3>
                  {modal === "edit-household" && "Edit Family Information"}
                  {modal === "member-form" &&
                    (memberModalMode === "add"
                      ? "Add Family Member"
                      : "Edit Family Member")}
                  {modal === "assign" && "Assign Family to Evacuation Center"}
                  {modal === "move" && "Change Assigned Evacuation Center / Room"}
                </h3>
                <p>
                  {modal === "edit-household" &&
                    `Update shared family details for ${activeFamily?.family_code || ""}.`}
                  {modal === "member-form" &&
                    `Household: ${activeFamily?.head_name || ""} (${activeFamily?.family_code || ""})`}
                  {modal === "assign" &&
                    `Select an active evacuation center with available capacity for ${activeFamily?.head_name || ""}.`}
                  {modal === "move" &&
                    `Transfer ${activeFamily?.head_name || ""} to another evacuation center or room.`}
                </p>
              </div>
              <button
                type="button"
                className="fm-modal-close"
                onClick={closeModal}
                aria-label="Close dialog"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            {error && (
              <div className="fm-banner fm-banner-error fm-modal-alert" role="alert">
                <div className="fm-banner-content">
                  <FontAwesomeIcon icon={faTriangleExclamation} />
                  <span>{error}</span>
                </div>
              </div>
            )}

            {/* MODAL: EDIT HOUSEHOLD */}
            {modal === "edit-household" && (() => {
              const editShowErr = (field) =>
                (editHouseholdTouched[field] ||
                  (field === "alternate_contact" &&
                    editHouseholdTouched.contact_number)) &&
                editHouseholdErrors[field]
                  ? editHouseholdErrors[field]
                  : "";
              const headMember =
                activeFamily?.members?.find(
                  (m) => String(m.id) === String(editHouseholdForm.head_resident_id)
                ) || activeFamily?.members?.find((m) => m.is_head_of_family);

              return (
                <form
                  className="fm-modal-form"
                  noValidate
                  onSubmit={submitEditHousehold}
                  onKeyDown={handleModalFormKeyDown}
                >
                  <div className="fm-modal-body" ref={modalBodyRef}>
                    {activeFamily?.members && activeFamily.members.length > 1 && (
                      <label className="fm-field">
                        <span>Designated Family Head (Select Member)</span>
                        <select
                          value={editHouseholdForm.head_resident_id}
                          onChange={(e) => {
                            const selectedId = e.target.value;
                            const selectedMem = activeFamily.members.find(
                              (m) => String(m.id) === String(selectedId)
                            );
                            setEditHouseholdForm((prev) => ({
                              ...prev,
                              head_resident_id: selectedId,
                              head_name: selectedMem
                                ? memberDisplayName(selectedMem)
                                : prev.head_name,
                            }));
                          }}
                        >
                          {activeFamily.members.map((m) => (
                            <option key={m.id} value={m.id}>
                              {memberDisplayName(m)}
                              {m.is_head_of_family
                                ? " (Current Head)"
                                : ` (${familyTerm(m.relationship_to_head || "Member")})`}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}

                    <div className="fm-form-grid-2">
                      <div className="fm-field">
                        <span>Family Head</span>
                        <div className="fm-readonly-box fm-readonly-head-box">
                          <span>
                            {editHouseholdForm.head_name ||
                              (headMember ? memberDisplayName(headMember) : "—")}
                          </span>
                          {headMember && (
                            <button
                              type="button"
                              className="fm-readonly-link-btn"
                              onClick={openHeadProfileFromEdit}
                            >
                              View Profile
                            </button>
                          )}
                        </div>
                      </div>
                      <label
                        className={`fm-field ${editShowErr("barangay_id") ? "has-error" : ""}`}
                      >
                        <span>
                          Barangay <strong className="fm-req">*</strong>
                        </span>
                        <select
                          id="fm-edit-hh-barangay"
                          value={editHouseholdForm.barangay_id}
                          onChange={(e) => handleEditBarangayChange(e.target.value)}
                          onBlur={() => touchEditHouseholdField("barangay_id")}
                          aria-invalid={Boolean(editShowErr("barangay_id"))}
                          aria-describedby={
                            editShowErr("barangay_id")
                              ? "fm-edit-hh-barangay-error"
                              : undefined
                          }
                        >
                          <option value="">Select barangay</option>
                          {barangays.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                        {editShowErr("barangay_id") && (
                          <small
                            id="fm-edit-hh-barangay-error"
                            className="fm-field-error"
                            role="alert"
                          >
                            {editShowErr("barangay_id")}
                          </small>
                        )}
                      </label>
                    </div>

                    <label
                      className={`fm-field ${editShowErr("address") ? "has-error" : ""}`}
                    >
                      <span>
                        Complete Family Address{" "}
                        <strong className="fm-req">*</strong>
                      </span>
                      <input
                        id="fm-edit-hh-address"
                        type="text"
                        value={editHouseholdForm.address}
                        onChange={(e) => {
                          setEditHouseholdForm((prev) => ({
                            ...prev,
                            address: e.target.value,
                          }));
                          if (editHouseholdTouched.address) {
                            touchEditHouseholdField("address");
                          }
                        }}
                        onBlur={() => touchEditHouseholdField("address")}
                        aria-invalid={Boolean(editShowErr("address"))}
                        aria-describedby={
                          editShowErr("address")
                            ? "fm-edit-hh-address-error"
                            : undefined
                        }
                        placeholder="Purok / Street / Sitio"
                      />
                      {editShowErr("address") && (
                        <small
                          id="fm-edit-hh-address-error"
                          className="fm-field-error"
                          role="alert"
                        >
                          {editShowErr("address")}
                        </small>
                      )}
                    </label>

                    <div className="fm-form-grid-2">
                      <label
                        className={`fm-field ${editShowErr("contact_number") ? "has-error" : ""}`}
                      >
                        <span>Contact Number</span>
                        <input
                          id="fm-edit-hh-contact"
                          type="tel"
                          inputMode="tel"
                          maxLength={13}
                          value={editHouseholdForm.contact_number}
                          onKeyDown={handlePhoneKeyDown}
                          onChange={(e) => {
                            const cleaned = sanitizePhoneInput(e.target.value);
                            setEditHouseholdForm((prev) => ({
                              ...prev,
                              contact_number: cleaned,
                            }));
                            if (
                              editHouseholdTouched.contact_number ||
                              cleaned !== ""
                            ) {
                              touchEditHouseholdField("contact_number");
                            }
                          }}
                          onPaste={(e) =>
                            handlePhonePaste(e, (cleaned) => {
                              setEditHouseholdForm((prev) => ({
                                ...prev,
                                contact_number: cleaned,
                              }));
                              touchEditHouseholdField("contact_number");
                            })
                          }
                          onBlur={() => touchEditHouseholdField("contact_number")}
                          aria-invalid={Boolean(editShowErr("contact_number"))}
                          aria-describedby={
                            editShowErr("contact_number")
                              ? "fm-edit-hh-contact-error"
                              : undefined
                          }
                          placeholder="e.g. 09171234567 (optional)"
                        />
                        {editShowErr("contact_number") && (
                          <small
                            id="fm-edit-hh-contact-error"
                            className="fm-field-error"
                            role="alert"
                          >
                            {editShowErr("contact_number")}
                          </small>
                        )}
                      </label>
                      <label
                        className={`fm-field ${editShowErr("alternate_contact") ? "has-error" : ""}`}
                      >
                        <span>Alternate Contact</span>
                        <input
                          id="fm-edit-hh-alt-contact"
                          type="tel"
                          inputMode="tel"
                          maxLength={13}
                          value={editHouseholdForm.alternate_contact}
                          onKeyDown={handlePhoneKeyDown}
                          onChange={(e) => {
                            const cleaned = sanitizePhoneInput(e.target.value);
                            setEditHouseholdForm((prev) => ({
                              ...prev,
                              alternate_contact: cleaned,
                            }));
                            if (
                              editHouseholdTouched.alternate_contact ||
                              cleaned !== ""
                            ) {
                              touchEditHouseholdField("alternate_contact");
                            }
                          }}
                          onPaste={(e) =>
                            handlePhonePaste(e, (cleaned) => {
                              setEditHouseholdForm((prev) => ({
                                ...prev,
                                alternate_contact: cleaned,
                              }));
                              touchEditHouseholdField("alternate_contact");
                            })
                          }
                          onBlur={() =>
                            touchEditHouseholdField("alternate_contact")
                          }
                          aria-invalid={Boolean(editShowErr("alternate_contact"))}
                          aria-describedby={
                            editShowErr("alternate_contact")
                              ? "fm-edit-hh-alt-contact-error"
                              : undefined
                          }
                          placeholder="e.g. 09181234567 (optional)"
                        />
                        {editShowErr("alternate_contact") && (
                          <small
                            id="fm-edit-hh-alt-contact-error"
                            className="fm-field-error"
                            role="alert"
                          >
                            {editShowErr("alternate_contact")}
                          </small>
                        )}
                      </label>
                    </div>

                    <label
                      className={`fm-field ${editShowErr("remarks") ? "has-error" : ""}`}
                    >
                      <span className="fm-field-label-row">
                        <span>Family Remarks</span>
                        <span className="fm-char-count">
                          {(editHouseholdForm.remarks || "").length}/500
                        </span>
                      </span>
                      <textarea
                        id="fm-edit-hh-remarks"
                        rows={3}
                        maxLength={500}
                        value={editHouseholdForm.remarks}
                        onChange={(e) => {
                          setEditHouseholdForm((prev) => ({
                            ...prev,
                            remarks: e.target.value.slice(0, 500),
                          }));
                          if (editHouseholdTouched.remarks) {
                            touchEditHouseholdField("remarks");
                          }
                        }}
                        onBlur={() => touchEditHouseholdField("remarks")}
                        aria-invalid={Boolean(editShowErr("remarks"))}
                        aria-describedby={
                          editShowErr("remarks")
                            ? "fm-edit-hh-remarks-error"
                            : undefined
                        }
                        placeholder="Optional family notes"
                      />
                      {editShowErr("remarks") && (
                        <small
                          id="fm-edit-hh-remarks-error"
                          className="fm-field-error"
                          role="alert"
                        >
                          {editShowErr("remarks")}
                        </small>
                      )}
                    </label>
                  </div>

                  <div className="fm-modal-footer">
                    <button
                      type="button"
                      className="fm-btn fm-btn-secondary"
                      onClick={closeModal}
                      disabled={saving}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="fm-btn fm-btn-primary"
                      disabled={
                        saving || !isEditHouseholdDirty || !isEditHouseholdValid
                      }
                    >
                      {saving ? (
                        <>
                          <FontAwesomeIcon icon={faRotate} spin />
                          Saving...
                        </>
                      ) : (
                        "Save Changes"
                      )}
                    </button>
                  </div>
                </form>
              );
            })()}

            {/* MODAL: ADD / EDIT MEMBER */}
            {modal === "member-form" && (
              <form
                className="fm-modal-form"
                noValidate
                onSubmit={submitMemberModal}
                onKeyDown={handleModalFormKeyDown}
              >
                <div className="fm-modal-body" ref={modalBodyRef}>
                  {memberDuplicateWarning && (
                    <div className="fm-banner fm-banner-warning" role="status">
                      <div className="fm-banner-content">
                        <FontAwesomeIcon icon={faTriangleExclamation} />
                        <span>{memberDuplicateWarning}</span>
                      </div>
                    </div>
                  )}
                  {memberModalMode === "edit" && (
                    <label
                      className="fm-check-pill"
                      style={{ marginBottom: "0.75rem" }}
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(memberModalForm.is_head_of_family)}
                        disabled={Boolean(
                          activeFamily?.members?.find(
                            (m) => Number(m.id) === Number(memberModalTargetId)
                          )?.is_head_of_family
                        )}
                        onChange={(e) =>
                          setMemberModalForm((prev) => ({
                            ...prev,
                            is_head_of_family: e.target.checked,
                            relationship_to_head: e.target.checked
                              ? "Family Head"
                              : prev.relationship_to_head === "Family Head"
                                ? ""
                                : prev.relationship_to_head,
                          }))
                        }
                      />
                      <span>
                        {activeFamily?.members?.find(
                          (m) => Number(m.id) === Number(memberModalTargetId)
                        )?.is_head_of_family
                          ? "Current Family Head"
                          : "Set this resident as the Family Head"}
                      </span>
                    </label>
                  )}
                  {renderMemberFormFields(
                    memberModalForm,
                    (field, value) =>
                      setMemberModalForm((prev) => ({
                        ...prev,
                        [field]: value,
                      })),
                    Boolean(memberModalForm.is_head_of_family),
                    {
                      idPrefix: "fm-modal-member",
                      errors: memberModalErrors,
                      touched: memberModalTouched,
                      onTouchField: touchMemberModalField,
                    }
                  )}
                </div>
                <div className="fm-modal-footer">
                  <button
                    type="button"
                    className="fm-btn fm-btn-secondary"
                    onClick={closeModal}
                    disabled={saving}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="fm-btn fm-btn-primary"
                    disabled={saving}
                  >
                    {saving ? (
                      <>
                        <FontAwesomeIcon icon={faRotate} spin />
                        Saving...
                      </>
                    ) : memberModalMode === "add" ? (
                      "Add Member"
                    ) : (
                      "Save Member"
                    )}
                  </button>
                </div>
              </form>
            )}

            {/* MODAL: ASSIGN ROOM */}
            {modal === "assign" && activeFamily && (() => {
              const selectedCenter = centersList.find(
                (c) => String(c.id) === String(assignCenterId)
              );
              const needed =
                activeFamily.member_count || activeFamily.resident_count || 1;
              const availableCenters = centersList.filter(
                (c) =>
                  getCenterRemainingCapacity(c) >= needed ||
                  String(c.id) === String(assignCenterId)
              );
              const isDirectCenter = isDirectVenueCenter(
                selectedCenter,
                assignRooms,
                assignRoomsQuery.isLoading
              );
              const hasBldgs = centerHasBuildings(selectedCenter, assignRooms);
              const availableBldgs = getAvailableBuildingsForCenter(
                selectedCenter,
                assignRooms,
                needed
              );
              const filteredRooms = getFilteredRoomsForSelection(
                selectedCenter,
                assignRooms,
                assignBuildingId,
                needed
              );

              const venueCap = selectedCenter?.capacity ?? 0;
              const venueOcc = getCenterAssignedCount(selectedCenter);
              const venueAvailable = getCenterRemainingCapacity(selectedCenter);
              const venueHasCapacity = Number(venueCap) > 0 && venueAvailable >= needed;

              return (
                <form onSubmit={submitAssignment} className="fm-modal-body">
                  <div className="fm-capacity-summary">
                    <div>
                      <span>Family Head</span>
                      <strong>{activeFamily.head_name}</strong>
                    </div>
                    <div>
                      <span>Members Requiring Space</span>
                      <strong>{needed}</strong>
                    </div>
                  </div>

                  <div className="fm-form-grid-1">
                    <label className="fm-field">
                      <span>
                        Evacuation Center <strong className="fm-req">*</strong>
                      </span>
                      <select
                        value={assignCenterId}
                        onChange={(e) => {
                          setAssignCenterId(e.target.value);
                          setAssignBuildingId("");
                          setAssignRoomId("");
                        }}
                        required
                      >
                        <option value="">Select evacuation center</option>
                        {availableCenters.map((c) => {
                          const rem = getCenterRemainingCapacity(c);
                          return (
                            <option key={c.id} value={c.id}>
                              {displayEntityName(c.name)} (
                              {(c.barangays || [])
                                .map((barangay) => barangay.name)
                                .join(", ")}
                              ) — {rem} spaces left
                            </option>
                          );
                        })}
                      </select>
                    </label>
                  </div>

                  {isDirectCenter ? (
                    <div className="fm-assignment-selector-box">
                      {selectedCenter && (
                        <div
                          className={`fm-capacity-summary ${venueHasCapacity ? "has-capacity" : "no-capacity"}`}
                        >
                          <div className="capacity-row">
                            <span className="capacity-label">
                              Center capacity
                            </span>
                            <span className="capacity-value">
                              {venueCap} people
                            </span>
                          </div>
                          <div className="capacity-row">
                            <span className="capacity-label">
                              Currently assigned
                            </span>
                            <span className="capacity-value">
                              {venueOcc} people
                            </span>
                          </div>
                          <div className="capacity-row">
                            <span className="capacity-label">
                              Remaining capacity
                            </span>
                            <span
                              className="capacity-value"
                              style={{
                                color: venueHasCapacity
                                  ? "var(--ew-safe-text)"
                                  : "var(--ew-danger-text)",
                              }}
                            >
                              {venueAvailable} spaces left
                            </span>
                          </div>
                          <div className="capacity-row">
                            <span className="capacity-label">
                              Family to assign
                            </span>
                            <span className="capacity-value">
                              {needed} members
                            </span>
                          </div>
                          {!venueHasCapacity && (
                            <p className="capacity-warning">
                              <FontAwesomeIcon icon={faTriangleExclamation} />{" "}
                              Warning: this family has {needed} members but
                              only {venueAvailable} space left. Assigning would
                              exceed center capacity.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <div
                        className={
                          hasBldgs ? "fm-form-grid-2" : "fm-form-grid-1"
                        }
                      >
                        {hasBldgs && (
                          <label className="fm-field">
                            <span>
                              Building <strong className="fm-req">*</strong>
                            </span>
                            <select
                              value={assignBuildingId}
                              disabled={
                                !assignCenterId || assignRoomsQuery.isLoading
                              }
                              onChange={(e) => {
                                setAssignBuildingId(e.target.value);
                                setAssignRoomId("");
                              }}
                              required
                            >
                              <option value="">
                                {!assignCenterId
                                  ? "Select a center first"
                                  : assignRoomsQuery.isLoading
                                    ? "Loading buildings..."
                                    : availableBldgs.length === 0
                                      ? "No buildings with available capacity"
                                      : "Select building"}
                              </option>
                              {availableBldgs.map((b) => (
                                <option key={b.id} value={b.id}>
                                  {displayEntityName(b.name)} ({b.rooms.length}{" "}
                                  room{b.rooms.length === 1 ? "" : "s"},{" "}
                                  {b.availableSpaces} available)
                                </option>
                              ))}
                            </select>
                          </label>
                        )}

                        <label className="fm-field">
                          <span>
                            Room <strong className="fm-req">*</strong>
                          </span>
                          <select
                            value={assignRoomId}
                            disabled={
                              !assignCenterId ||
                              assignRoomsQuery.isLoading ||
                              (hasBldgs && !assignBuildingId)
                            }
                            onChange={(e) => setAssignRoomId(e.target.value)}
                            required
                          >
                            <option value="">
                              {!assignCenterId
                                ? "Select a center first"
                                : assignRoomsQuery.isLoading
                                  ? "Loading rooms..."
                                  : hasBldgs && !assignBuildingId
                                    ? "Select a building first"
                                    : filteredRooms.length === 0
                                      ? "No rooms with available capacity"
                                      : "Select room"}
                            </option>
                            {filteredRooms.map((r) => {
                              const avail = getRoomRemainingCapacity(r);
                              const slots = Math.max(1, Number(r.family_slots ?? 5));
                              const spaces = Math.max(1, Number(r.people_spaces ?? r.capacity ?? 25));
                              return (
                                <option key={r.id} value={r.id}>
                                  {formatRoomLabel(r.room_number)} · Slots {getRoomUsedSlots(r)}/{slots} · Spaces {getRoomAssignedCount(r)}/{spaces} ({getRoomAvailableSlots(r)} slots, {avail} spaces left)
                                </option>
                              );
                            })}
                          </select>
                        </label>
                      </div>

                      {selectedAssignRoom && (
                        <div
                          className={`fm-room-preview ${assignHasCapacity ? "is-ok" : "is-error"}`}
                        >
                          <div>
                            <span>Family slots</span>
                            <strong>{getRoomUsedSlots(selectedAssignRoom)}/{selectedAssignRoom.family_slots ?? 5}</strong>
                          </div>
                          <div>
                            <span>People spaces</span>
                            <strong>{getRoomAssignedCount(selectedAssignRoom)}/{selectedAssignRoom.people_spaces ?? selectedAssignRoom.capacity ?? 25}</strong>
                          </div>
                          <div>
                            <span>Available</span>
                            <strong>{getRoomAvailableSlots(selectedAssignRoom)} slots · {assignRoomAvailable} spaces</strong>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  <div className="fm-modal-footer">
                    <button
                      type="button"
                      className="fm-btn fm-btn-secondary"
                      onClick={closeModal}
                      disabled={assigning}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="fm-btn fm-btn-primary"
                      disabled={
                        assigning ||
                        !assignCenterId ||
                        (!isDirectCenter &&
                          ((hasBldgs && !assignBuildingId) ||
                            !assignRoomId ||
                            !assignHasCapacity)) ||
                        (isDirectCenter && !venueHasCapacity)
                      }
                    >
                      {assigning ? "Assigning..." : "Confirm Assignment"}
                    </button>
                  </div>
                </form>
              );
            })()}

            {/* MODAL: MOVE / CHANGE ROOM */}
            {modal === "move" && activeFamily && (() => {
              const destCenter = centersList.find(
                (c) => String(c.id) === String(targetCenterId)
              );
              const needed = moveFamilyMembers;
              const currentCenterId =
                activeFamily.current_center_id ||
                activeFamily.assignments?.[0]?.center_id;
              const availableDestCenters = centersList.filter((c) => {
                const isSameCenter =
                  currentCenterId && String(c.id) === String(currentCenterId);
                const isDirect = isDirectVenueCenter(c, [], true);
                if (isSameCenter && !isDirect) return true;
                return (
                  getCenterRemainingCapacity(c) >= needed ||
                  String(c.id) === String(targetCenterId)
                );
              });

              const isDestDirectCenter = isDirectVenueCenter(
                destCenter,
                targetRooms,
                targetRoomsQuery.isLoading
              );
              const destHasBldgs = centerHasBuildings(destCenter, targetRooms);
              const destAvailableBldgs = getAvailableBuildingsForCenter(
                destCenter,
                targetRooms,
                needed
              );
              const destFilteredRooms = getFilteredRoomsForSelection(
                destCenter,
                targetRooms,
                targetBuildingId,
                needed
              );

              const venueCap = destCenter?.capacity ?? 0;
              const venueOcc = getCenterAssignedCount(destCenter);
              const venueAvailable = getCenterRemainingCapacity(destCenter);
              const venueHasCapacity = Number(venueCap) > 0 && venueAvailable >= needed;

              const currentCenterName = displayEntityName(
                activeFamily.current_center || activeFamily.evacuation_center
              );
              const currentRoomLabel =
                activeFamily.current_room || activeFamily.rooms;
              const isCurrentDirectVenue =
                getFamilyStructureMode(activeFamily) === "open_area" ||
                !currentRoomLabel ||
                currentRoomLabel === "Single Venue";

              return (
                <form onSubmit={handleMoveSubmit} className="fm-modal-body">
                  <div className="fm-capacity-summary">
                    <div>
                      <span>Current Location</span>
                      <strong>
                        {currentCenterName}
                        {isCurrentDirectVenue
                          ? ""
                          : ` — ${formatRoomLabel(currentRoomLabel)}`}
                      </strong>
                    </div>
                    <div>
                      <span>Members Moving</span>
                      <strong>{needed}</strong>
                    </div>
                  </div>

                  <div className="fm-form-grid-1">
                    <label className="fm-field">
                      <span>
                        Destination Center <strong className="fm-req">*</strong>
                      </span>
                      <select
                        value={targetCenterId}
                        onChange={(e) => {
                          setTargetCenterId(e.target.value);
                          setTargetBuildingId("");
                          setTargetRoomId("");
                        }}
                        required
                      >
                        <option value="">Select destination center</option>
                        {availableDestCenters.map((c) => {
                          const rem = getCenterRemainingCapacity(c);
                          return (
                            <option key={c.id} value={c.id}>
                              {displayEntityName(c.name)} (
                              {(c.barangays || [])
                                .map((barangay) => barangay.name)
                                .join(", ")}
                              ) — {rem} spaces left
                            </option>
                          );
                        })}
                      </select>
                    </label>
                  </div>

                  {isDestDirectCenter ? (
                    <div className="fm-assignment-selector-box">
                      {destCenter && (
                        <div
                          className={`fm-capacity-summary ${venueHasCapacity ? "has-capacity" : "no-capacity"}`}
                        >
                          <div className="capacity-row">
                            <span className="capacity-label">
                              Center capacity
                            </span>
                            <span className="capacity-value">
                              {venueCap} people
                            </span>
                          </div>
                          <div className="capacity-row">
                            <span className="capacity-label">
                              Currently assigned
                            </span>
                            <span className="capacity-value">
                              {venueOcc} people
                            </span>
                          </div>
                          <div className="capacity-row">
                            <span className="capacity-label">
                              Remaining capacity
                            </span>
                            <span
                              className="capacity-value"
                              style={{
                                color: venueHasCapacity
                                  ? "var(--ew-safe-text)"
                                  : "var(--ew-danger-text)",
                              }}
                            >
                              {venueAvailable} spaces left
                            </span>
                          </div>
                          <div className="capacity-row">
                            <span className="capacity-label">
                              Family to move
                            </span>
                            <span className="capacity-value">
                              {needed} members
                            </span>
                          </div>
                          {!venueHasCapacity && (
                            <p className="capacity-warning">
                              <FontAwesomeIcon icon={faTriangleExclamation} />{" "}
                              Warning: this family has {needed} members but
                              only {venueAvailable} space left. Moving would
                              exceed center capacity.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <div
                        className={
                          destHasBldgs ? "fm-form-grid-2" : "fm-form-grid-1"
                        }
                      >
                        {destHasBldgs && (
                          <label className="fm-field">
                            <span>
                              Destination Building{" "}
                              <strong className="fm-req">*</strong>
                            </span>
                            <select
                              value={targetBuildingId}
                              disabled={
                                !targetCenterId || targetRoomsQuery.isLoading
                              }
                              onChange={(e) => {
                                setTargetBuildingId(e.target.value);
                                setTargetRoomId("");
                              }}
                              required
                            >
                              <option value="">
                                {!targetCenterId
                                  ? "Select a center first"
                                  : targetRoomsQuery.isLoading
                                    ? "Loading buildings..."
                                    : destAvailableBldgs.length === 0
                                      ? "No buildings with available capacity"
                                      : "Select destination building"}
                              </option>
                              {destAvailableBldgs.map((b) => (
                                <option key={b.id} value={b.id}>
                                  {displayEntityName(b.name)} ({b.rooms.length}{" "}
                                  room{b.rooms.length === 1 ? "" : "s"},{" "}
                                  {b.availableSpaces} available)
                                </option>
                              ))}
                            </select>
                          </label>
                        )}

                        <label className="fm-field">
                          <span>
                            Destination Room{" "}
                            <strong className="fm-req">*</strong>
                          </span>
                          <select
                            value={targetRoomId}
                            disabled={
                              !targetCenterId ||
                              targetRoomsQuery.isLoading ||
                              (destHasBldgs && !targetBuildingId)
                            }
                            onChange={(e) => setTargetRoomId(e.target.value)}
                            required
                          >
                            <option value="">
                              {!targetCenterId
                                ? "Select a center first"
                                : targetRoomsQuery.isLoading
                                  ? "Loading rooms..."
                                  : destHasBldgs && !targetBuildingId
                                    ? "Select a building first"
                                    : destFilteredRooms.length === 0
                                      ? "No rooms with available capacity"
                                      : "Select destination room"}
                            </option>
                            {destFilteredRooms.map((r) => {
                              const avail = getRoomRemainingCapacity(r);
                              const slots = Math.max(1, Number(r.family_slots ?? 5));
                              const spaces = Math.max(1, Number(r.people_spaces ?? r.capacity ?? 25));
                              return (
                                <option key={r.id} value={r.id}>
                                  {formatRoomLabel(r.room_number)} · Slots {getRoomUsedSlots(r)}/{slots} · Spaces {getRoomAssignedCount(r)}/{spaces} ({getRoomAvailableSlots(r)} slots, {avail} spaces left)
                                </option>
                              );
                            })}
                          </select>
                        </label>
                      </div>

                      {selectedTargetRoom && (
                        <div
                          className={`fm-room-preview ${moveHasCapacity ? "is-ok" : "is-error"}`}
                        >
                          <div>
                            <span>Family slots</span>
                            <strong>{getRoomUsedSlots(selectedTargetRoom)}/{selectedTargetRoom.family_slots ?? 5}</strong>
                          </div>
                          <div>
                            <span>People spaces</span>
                            <strong>{getRoomAssignedCount(selectedTargetRoom)}/{selectedTargetRoom.people_spaces ?? selectedTargetRoom.capacity ?? 25}</strong>
                          </div>
                          <div>
                            <span>Available</span>
                            <strong>{getRoomAvailableSlots(selectedTargetRoom)} slots · {targetRoomAvailable} spaces</strong>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  <div className="fm-modal-footer">
                    <button
                      type="button"
                      className="fm-btn fm-btn-secondary"
                      onClick={closeModal}
                      disabled={moving}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="fm-btn fm-btn-primary"
                      disabled={
                        moving ||
                        !targetCenterId ||
                        (isDestDirectCenter && !venueHasCapacity) ||
                        (!isDestDirectCenter &&
                          ((destHasBldgs && !targetBuildingId) ||
                            !targetRoomId ||
                            !moveHasCapacity))
                      }
                    >
                      {moving ? "Transferring..." : "Review Transfer"}
                    </button>
                  </div>
                </form>
              );
            })()}

          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      {confirmDialog && (
        <div
          className="fm-modal-backdrop fm-confirm-backdrop"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setConfirmDialog(null);
          }}
        >
          <div className="fm-modal-dialog fm-modal-confirm">
            <div className="fm-modal-header">
              <h3>{confirmDialog.title}</h3>
              <button
                type="button"
                className="fm-modal-close"
                onClick={() => setConfirmDialog(null)}
                aria-label="Close confirmation dialog"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
            <div className="fm-modal-body">
              <p>{confirmDialog.message}</p>
              <div className="fm-modal-footer">
                <button
                  type="button"
                  className="fm-btn fm-btn-secondary"
                  onClick={() => setConfirmDialog(null)}
                  disabled={saving}
                >
                  {confirmDialog.cancelText || "Cancel"}
                </button>
                <button
                  type="button"
                  className={`fm-btn ${confirmDialog.danger ? "fm-btn-danger" : "fm-btn-primary"}`}
                  onClick={confirmDialog.onConfirm}
                  disabled={saving}
                >
                  {saving ? "Saving..." : confirmDialog.confirmText || "Confirm"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Filters Bottom Sheet */}
      {compactMobileAllHouseholds && isMobileFiltersOpen && (
        <div
          className="fm-mobile-filter-sheet-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Filter families"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setIsMobileFiltersOpen(false);
          }}
        >
          <div className="fm-mobile-filter-sheet">
            <div className="fm-mobile-filter-sheet-header">
              <h3>Filters</h3>
              <button
                type="button"
                className="fm-modal-close"
                aria-label="Close filters"
                onClick={() => setIsMobileFiltersOpen(false)}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            <div className="fm-mobile-filter-sheet-body">
              <label className="fm-mobile-sheet-field">
                <span>Census Year</span>
                <select
                  value={draftMobileFilters.yearFilter}
                  onChange={(e) =>
                    setDraftMobileFilters((prev) => ({
                      ...prev,
                      yearFilter: e.target.value,
                    }))
                  }
                  aria-label="Filter by census year"
                >
                  <option value="">All Years</option>
                  {rosterYears.map((ry) => (
                    <option key={ry.id || ry.year} value={String(ry.year)}>
                      Census Year {ry.year} {ry.is_active ? "(Active)" : ""}
                    </option>
                  ))}
                </select>
              </label>

              {!lockedBarangayId && (
                <label className="fm-mobile-sheet-field">
                  <span>Barangay</span>
                  <select
                    value={draftMobileFilters.barangayFilter}
                    onChange={(e) =>
                      setDraftMobileFilters((prev) => ({
                        ...prev,
                        barangayFilter: e.target.value,
                      }))
                    }
                    aria-label="Filter by barangay"
                  >
                    <option value="">All Barangays</option>
                    {barangays.map((b) => (
                      <option key={b.id} value={String(b.id)}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="fm-mobile-sheet-field">
                <span>Status</span>
                <select
                  value={draftMobileFilters.assignmentStatus}
                  onChange={(e) =>
                    setDraftMobileFilters((prev) => ({
                      ...prev,
                      assignmentStatus: e.target.value,
                    }))
                  }
                  aria-label="Filter by assignment status"
                >
                  <option value="">All Statuses</option>
                  <option value="assigned">Assigned</option>
                  <option value="unassigned">Unassigned</option>
                </select>
              </label>

              <label className="fm-mobile-sheet-field">
                <span>Sort</span>
                <select
                  value={draftMobileFilters.sortKey}
                  onChange={(e) =>
                    setDraftMobileFilters((prev) => ({
                      ...prev,
                      sortKey: e.target.value,
                    }))
                  }
                  aria-label="Sort families"
                >
                  <option value="family_code:asc">Family ID (A–Z)</option>
                  <option value="head_name:asc">Family Head (A–Z)</option>
                  <option value="member_count:desc">Most Members</option>
                  <option value="created_at:desc">Recently Added</option>
                </select>
              </label>
            </div>

            <div className="fm-mobile-filter-sheet-footer">
              <button
                type="button"
                className="fm-btn fm-btn-secondary"
                onClick={resetMobileFilters}
              >
                Reset
              </button>
              <button
                type="button"
                className="fm-btn fm-btn-primary"
                onClick={applyMobileFilters}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}



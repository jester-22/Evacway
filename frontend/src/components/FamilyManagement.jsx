import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faBuilding,
  faCheckCircle,
  faDoorOpen,
  faDownload,
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
  faTrashCan,
  faTriangleExclamation,
  faUser,
  faUserCheck,
  faUserMinus,
  faUserPlus,
  faUsers,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../services/api";
import {
  fetchRooms,
  invalidateEvacuationQueries,
  queryKeys,
  useEvacuationCenters,
  useFamilies,
  useFamily,
  useRooms,
} from "../hooks/useEvacuationQueries";
import { displayEntityName } from "../utils/displayEntityName";
import LoadingState from "./LoadingState";
import "../components_css/FamilyManagement.css";

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

function emptyMember(isHead = false) {
  return {
    first_name: "",
    middle_name: "",
    last_name: "",
    suffix: "",
    date_of_birth: "",
    gender: "",
    relationship_to_head: isHead ? "Household Head" : "Spouse",
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
  if (fam.current_room_id) return true;
  if (Number(fam.assigned_members || 0) > 0) return true;
  if (Array.isArray(fam.assignments) && fam.assignments.length > 0) return true;
  if (fam.current_room || fam.rooms || fam.current_center || fam.evacuation_center) return true;
  if (fam.evacuation_status) {
    const s = fam.evacuation_status.toLowerCase();
    if (
      (s.includes("assigned") && !s.includes("not assigned")) ||
      (s.includes("evacuated") && !s.includes("not evacuated"))
    ) {
      return true;
    }
  }
  return false;
}

const ADD_STEPS = [
  { number: 1, title: "Household & Head", subtitle: "Address, contact & head profile" },
  { number: 2, title: "Household Members", subtitle: "Additional members (optional)" },
  { number: 3, title: "Room & Save", subtitle: "Evacuation room & confirm" },
];

export default function FamilyManagement({
  barangays = [],
  lockedBarangayId = null,
  lockedBarangayName = "",
  initialFamilyId = null,
  initialStartAdd = false,
  startWithAddFamily = false,
  onInitialStartAddConsumed = null,
  onInitialFamilyConsumed = null,
  onClearInitialAction = null,
}) {
  const queryClient = useQueryClient();

  const shouldStartAdd = Boolean(initialStartAdd || startWithAddFamily);

  // Navigation state: "list" | "household-detail" | "member-detail" | "add-wizard"
  const [activeScreen, setActiveScreen] = useState(() => {
    if (shouldStartAdd) return "add-wizard";
    if (initialFamilyId) return "household-detail";
    return "list";
  });

  // List filters & pagination
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [barangayFilter, setBarangayFilter] = useState(
    lockedBarangayId ? String(lockedBarangayId) : ""
  );
  const [assignmentStatus, setAssignmentStatus] = useState("");
  const [sortBy, setSortBy] = useState("family_code");
  const [direction, setDirection] = useState("asc");

  // Feedback banners
  const [localError, setError] = useState("");
  const [notice, setNotice] = useState("");

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
    if (shouldStartAdd && onInitialStartAddConsumed) {
      onInitialStartAddConsumed();
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
      per_page: 15,
      search,
      barangay_id: effectiveBarangayId,
      assignment_status: assignmentStatus,
      sort_by: sortBy,
      direction,
    }),
    [page, search, effectiveBarangayId, assignmentStatus, sortBy, direction]
  );

  const familiesQuery = useFamilies(familyFilters);
  const families = useMemo(
    () => familiesQuery.data?.items || [],
    [familiesQuery.data?.items]
  );
  const total = familiesQuery.data?.total || 0;
  const pages = Math.max(1, familiesQuery.data?.pages || 1);
  const loading = familiesQuery.isLoading;

  const familyDetailQuery = useFamily(selectedFamilyId, {
    enabled:
      selectedFamilyId != null &&
      (activeScreen === "household-detail" || activeScreen === "member-detail"),
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

  // Modals for quick actions ("edit-household" | "member-form" | "assign" | "move" | "import" | "")
  const [modal, setModal] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);

  // 5-Step Add Family Wizard State
  const [wizardStep, setWizardStep] = useState(1);
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

  // Add / Edit Individual Member Modal State (from Page D / Page E)
  const [memberModalMode, setMemberModalMode] = useState("add"); // "add" | "edit"
  const [memberModalTargetId, setMemberModalTargetId] = useState(null);
  const [memberModalForm, setMemberModalForm] = useState(emptyMember(false));

  // Assign / Move Room Modal State
  const [assignCenterId, setAssignCenterId] = useState("");
  const [assignRoomId, setAssignRoomId] = useState("");
  const [assigning, setAssigning] = useState(false);

  const [targetCenterId, setTargetCenterId] = useState("");
  const [targetRoomId, setTargetRoomId] = useState("");
  const [moving, setMoving] = useState(false);

  // Import Excel State
  const [importFile, setImportFile] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const [importBusy, setImportBusy] = useState(false);

  // Evacuation Centers & Rooms Queries
  const centersQuery = useEvacuationCenters(false, {
    enabled:
      activeScreen === "add-wizard" || modal === "assign" || modal === "move",
  });
  const centersList = useMemo(() => {
    const raw = (centersQuery.data?.features || []).map(
      (feature) => feature.properties || feature
    );
    const preferredBarangayId =
      activeScreen === "add-wizard"
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
    activeScreen,
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
        activeScreen === "add-wizard" &&
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

  function closeModal() {
    if (saving || importBusy || assigning || moving) return;
    setModal("");
    setError("");
    setImportPreview(null);
    setImportFile(null);
    setAssignCenterId("");
    setAssignRoomId("");
    setTargetCenterId("");
    setTargetRoomId("");
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
  function openHouseholdDetails(family) {
    setSelectedFamilySeed(family);
    setSelectedFamilyId(family.id);
    setSelectedMemberId(null);
    setError("");
    setActiveScreen("household-detail");
  }

  function openMemberDetails(member) {
    setSelectedMemberId(member.id);
    setError("");
    setActiveScreen("member-detail");
  }

  function backToHouseholdList() {
    setActiveScreen("list");
    setSelectedMemberId(null);
    setError("");
  }

  function backToHouseholdDetails() {
    setActiveScreen("household-detail");
    setSelectedMemberId(null);
    setError("");
  }

  // =========================================================
  // 5-STEP ADD FAMILY WIZARD HANDLERS
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
      assignment_room_id: "",
    });
    setWizardStep(1);
    setEditingOtherIndex(null);
    setMemberDraft(null);
    setError("");
    setNotice("");
    setActiveScreen("add-wizard");
  }

  function updateWizardHead(field, value) {
    setWizardForm((prev) => ({
      ...prev,
      head: {
        ...prev.head,
        [field]: value,
        is_head_of_family: true,
        relationship_to_head: "Household Head",
      },
    }));
  }

  function startAddOtherMember() {
    setError("");
    setEditingOtherIndex("new");
    setMemberDraft(emptyMember(false));
  }

  function startEditOtherMember(index) {
    setError("");
    setEditingOtherIndex(index);
    setMemberDraft({ ...wizardForm.otherMembers[index] });
  }

  function cancelOtherMemberDraft() {
    setEditingOtherIndex(null);
    setMemberDraft(null);
    setError("");
  }

  function saveOtherMemberDraft() {
    if (!memberDraft) return;
    const first = memberDraft.first_name.trim();
    const last = memberDraft.last_name.trim();
    if (!first || !last) {
      setError("Member first name and last name are required.");
      return;
    }
    if (memberDraft.date_of_birth) {
      const age = getAge(memberDraft.date_of_birth);
      const dobDate = new Date(`${memberDraft.date_of_birth}T00:00:00`);
      if (
        age === null ||
        dobDate > new Date() ||
        dobDate.getFullYear() < 1900
      ) {
        setError("Enter a valid date of birth (between 1900 and today).");
        return;
      }
    }
    const candidateName = memberDisplayName(memberDraft)
      .trim()
      .toLocaleLowerCase();
    const headName = memberDisplayName(wizardForm.head)
      .trim()
      .toLocaleLowerCase();
    if (candidateName === headName) {
      setError(
        "This member has the same full name as the household head. The household head is already registered in Step 2."
      );
      return;
    }
    const duplicateInOthers = wizardForm.otherMembers.some((m, idx) => {
      if (editingOtherIndex !== "new" && idx === editingOtherIndex) return false;
      return memberDisplayName(m).trim().toLocaleLowerCase() === candidateName;
    });
    if (duplicateInOthers) {
      setError("Another family member with this full name is already added.");
      return;
    }

    const cleanedMember = {
      ...memberDraft,
      first_name: first,
      middle_name: memberDraft.middle_name.trim(),
      last_name: last,
      suffix: memberDraft.suffix.trim(),
      relationship_to_head:
        memberDraft.relationship_to_head.trim() || "Family Member",
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
    }
  }

  function validateWizardStep(step) {
    setError("");
    if (step === 1) {
      if (!wizardForm.barangay_id) {
        setError("Please select a barangay for this household.");
        return false;
      }
      if (!wizardForm.address.trim()) {
        setError("Please enter the complete household address or purok/sitio.");
        return false;
      }
      const head = wizardForm.head;
      if (!head.first_name.trim() || !head.last_name.trim()) {
        setError("Household head's first name and last name are required.");
        return false;
      }
      if (head.date_of_birth) {
        const age = getAge(head.date_of_birth);
        const dobDate = new Date(`${head.date_of_birth}T00:00:00`);
        if (
          age === null ||
          dobDate > new Date() ||
          dobDate.getFullYear() < 1900
        ) {
          setError(
            "Please enter a valid date of birth for the household head (not in the future)."
          );
          return false;
        }
      }
      return true;
    }

    if (step === 2) {
      if (editingOtherIndex !== null) {
        setError(
          "Please save or cancel the member form you are currently editing before continuing."
        );
        return false;
      }
      const allMembers = [wizardForm.head, ...wizardForm.otherMembers];
      const names = allMembers.map((m) =>
        memberDisplayName(m).trim().toLocaleLowerCase()
      );
      if (new Set(names).size !== names.length) {
        setError("All household member names must be unique within the household.");
        return false;
      }
      return true;
    }

    if (step === 3) {
      if (wizardForm.assignment_mode === "assign") {
        if (
          !wizardForm.assignment_center_id ||
          !wizardForm.assignment_room_id
        ) {
          setError(
            "Select both an evacuation center and a room, or choose 'Leave Unassigned'."
          );
          return false;
        }
        const selectedRoom = wizardRooms.find(
          (r) => String(r.id) === String(wizardForm.assignment_room_id)
        );
        const totalMembersCount = 1 + wizardForm.otherMembers.length;
        const available =
          selectedRoom?.available ??
          (selectedRoom
            ? Math.max(selectedRoom.capacity - (selectedRoom.occupied || 0), 0)
            : 0);
        if (selectedRoom && totalMembersCount > available) {
          setError(
            `Selected room only has ${available} available space(s), but this household has ${totalMembersCount} member(s).`
          );
          return false;
        }
      }
      return true;
    }

    return true;
  }

  function handleWizardNext() {
    if (!validateWizardStep(wizardStep)) return;
    setWizardStep((prev) => Math.min(3, prev + 1));
  }

  function handleWizardBack() {
    setError("");
    if (editingOtherIndex !== null) {
      setEditingOtherIndex(null);
      setMemberDraft(null);
    }
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

  async function submitNewFamily(event) {
    event.preventDefault();
    if (saving) return;
    for (let s = 1; s <= 2; s += 1) {
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
        relationship_to_head: "Household Head",
      },
      ...wizardForm.otherMembers.map((m) => ({
        ...m,
        is_head_of_family: false,
      })),
    ];

    setSaving(true);
    setError("");
    try {
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
            ? "Household Head"
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
          is_pregnant: Boolean(member.is_pregnant),
          is_lactating: Boolean(member.is_lactating),
          is_solo_parent: Boolean(member.is_solo_parent),
          needs_assistance: Boolean(member.needs_assistance),
          vulnerable_members: member.vulnerable_members.trim() || null,
          medical_notes: member.medical_notes.trim() || null,
          notes: member.notes.trim() || null,
        })),
        assignment:
          wizardForm.assignment_mode === "assign" &&
          wizardForm.assignment_center_id &&
          wizardForm.assignment_room_id
            ? {
                center_id: Number(wizardForm.assignment_center_id),
                room_id: Number(wizardForm.assignment_room_id),
              }
            : null,
      };

      const result = await api.addFamily(payload);
      const createdFamily = result.family;
      await refreshAllData(createdFamily?.id);
      setNotice(
        result.message ||
          `Household "${headFullName}" (${allMembers.length} member${allMembers.length === 1 ? "" : "s"}) registered successfully.`
      );
      if (createdFamily?.id) {
        setSelectedFamilySeed(createdFamily);
        setSelectedFamilyId(createdFamily.id);
        setActiveScreen("household-detail");
      } else {
        setActiveScreen("list");
      }
    } catch (requestError) {
      setError(requestError.message || "Household could not be registered.");
    } finally {
      setSaving(false);
    }
  }

  // =========================================================
  // EDIT HOUSEHOLD HANDLERS
  // =========================================================
  function openEditHouseholdModal(fam = activeFamily) {
    if (!fam) return;
    setSelectedFamilySeed(fam);
    setSelectedFamilyId(fam.id);
    const headMember = fam.members?.find((m) => m.is_head_of_family);
    setEditHouseholdForm({
      head_name: fam.head_name || "",
      head_resident_id: headMember?.id ? String(headMember.id) : "",
      barangay_id: fam.barangay_id ? String(fam.barangay_id) : "",
      contact_number: fam.contact_number || "",
      alternate_contact:
        fam.alternate_contact || headMember?.alternate_contact || "",
      address: fam.address || headMember?.address || "",
      remarks: fam.remarks || headMember?.remarks || "",
    });
    setError("");
    setModal("edit-household");
  }

  async function submitEditHousehold(event) {
    event.preventDefault();
    if (!activeFamily) return;
    if (!editHouseholdForm.head_name.trim() && !editHouseholdForm.head_resident_id) {
      setError("Household head is required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = {
        head_name: editHouseholdForm.head_name.trim() || undefined,
        head_resident_id: editHouseholdForm.head_resident_id
          ? Number(editHouseholdForm.head_resident_id)
          : undefined,
        barangay_id: editHouseholdForm.barangay_id
          ? Number(editHouseholdForm.barangay_id)
          : undefined,
        contact_number: editHouseholdForm.contact_number.trim() || null,
        alternate_contact: editHouseholdForm.alternate_contact.trim() || null,
        address: editHouseholdForm.address.trim() || null,
        remarks: editHouseholdForm.remarks.trim() || null,
      };
      const result = await api.updateFamily(activeFamily.id, payload);
      await refreshAllData(activeFamily.id);
      setNotice(result.message || "Household information updated.");
      setModal("");
    } catch (requestError) {
      setError(requestError.message || "Failed to update household details.");
    } finally {
      setSaving(false);
    }
  }

  // =========================================================
  // ADD / EDIT / DELETE / PROMOTE MEMBER HANDLERS (Page D & Page E)
  // =========================================================
  function openAddMemberModal() {
    if (!activeFamily) return;
    setMemberModalMode("add");
    setMemberModalTargetId(null);
    setMemberModalForm(emptyMember(false));
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
        ? "Household Head"
        : rel || "Spouse";
    setMemberModalForm({
      first_name: member.first_name || "",
      middle_name: member.middle_name || "",
      last_name: member.last_name || "",
      suffix: member.suffix || "",
      date_of_birth: member.date_of_birth || "",
      gender: member.gender || "",
      relationship_to_head: normalizedRel,
      contact_number: member.contact_number || "",
      alternate_contact: member.alternate_contact || "",
      is_head_of_family: Boolean(member.is_head_of_family),
      is_pwd: Boolean(member.is_pwd),
      disability_type: member.disability_type || "",
      disability_notes: member.disability_notes || "",
      is_pregnant: Boolean(member.is_pregnant),
      is_lactating: Boolean(member.is_lactating),
      is_solo_parent: Boolean(member.is_solo_parent),
      needs_assistance: Boolean(member.needs_assistance),
      vulnerable_members: member.vulnerable_members || "",
      medical_notes: member.medical_notes || "",
      notes: member.notes || "",
    });
    setError("");
    setModal("member-form");
  }

  async function submitMemberModal(event) {
    event.preventDefault();
    if (!activeFamily) return;
    if (
      !memberModalForm.first_name.trim() ||
      !memberModalForm.last_name.trim()
    ) {
      setError("First name and last name are required.");
      return;
    }
    if (memberModalForm.date_of_birth) {
      const age = getAge(memberModalForm.date_of_birth);
      const dobDate = new Date(`${memberModalForm.date_of_birth}T00:00:00`);
      if (
        age === null ||
        dobDate > new Date() ||
        dobDate.getFullYear() < 1900
      ) {
        setError("Please enter a valid date of birth (not in the future).");
        return;
      }
    }

    setSaving(true);
    setError("");
    try {
      const payload = {
        first_name: memberModalForm.first_name.trim(),
        middle_name: memberModalForm.middle_name.trim() || null,
        last_name: memberModalForm.last_name.trim(),
        suffix: memberModalForm.suffix.trim() || null,
        date_of_birth: memberModalForm.date_of_birth || null,
        gender: memberModalForm.gender || null,
        relationship_to_head: memberModalForm.is_head_of_family
          ? "Household Head"
          : memberModalForm.relationship_to_head.trim() || "Family Member",
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
        is_pregnant: Boolean(memberModalForm.is_pregnant),
        is_lactating: Boolean(memberModalForm.is_lactating),
        is_solo_parent: Boolean(memberModalForm.is_solo_parent),
        needs_assistance: Boolean(memberModalForm.needs_assistance),
        vulnerable_members: memberModalForm.vulnerable_members.trim() || null,
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
      setModal("");
    } catch (requestError) {
      setError(requestError.message || "Failed to save family member.");
    } finally {
      setSaving(false);
    }
  }

  function confirmPromoteToHead(member) {
    if (!activeFamily || !member || member.is_head_of_family) return;
    const name = memberDisplayName(member);
    setConfirmDialog({
      title: "Set as Household Head",
      message: `Designate "${name}" as the new Household Head of ${activeFamily.family_code}? The previous household head (${activeFamily.head_name}) will remain in the household as a regular member.`,
      confirmText: "Set as Household Head",
      danger: false,
      onConfirm: async () => {
        try {
          const res = await api.updateFamily(activeFamily.id, {
            head_resident_id: member.id,
          });
          setConfirmDialog(null);
          await refreshAllData(activeFamily.id);
          setNotice(
            res.message || `"${name}" is now the Household Head of ${activeFamily.family_code}.`
          );
        } catch (err) {
          setError(err.message || "Failed to change household head.");
        }
      },
    });
  }

  function confirmDeleteMember(member) {
    if (!activeFamily || !member) return;
    if (member.is_head_of_family) {
      setError(
        "Cannot remove the household head directly. Please designate another family member as the Household Head first, or delete the entire household."
      );
      return;
    }
    const name = memberDisplayName(member);
    setConfirmDialog({
      title: "Remove Family Member",
      message: `Are you sure you want to remove "${name}" from household ${activeFamily.family_code}?`,
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
          setNotice(res.message || `Removed "${name}" from household.`);
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
        "Cannot delete a household with an active room assignment. Please unassign the household first."
      );
      return;
    }
    setConfirmDialog({
      title: "Delete Household Record",
      message: `Are you sure you want to delete household "${fam.head_name}" (${fam.family_code || "#" + fam.id})? This will permanently remove the household and its ${fam.member_count || 1} member record(s).`,
      confirmText: "Delete Household",
      danger: true,
      onConfirm: async () => {
        try {
          const res = await api.deleteFamily(fam.id);
          setConfirmDialog(null);
          if (Number(selectedFamilyId) === Number(fam.id)) {
            setActiveScreen("list");
            setSelectedFamilyId(null);
          }
          await refreshAllData();
          setNotice(res.message || `Household "${fam.head_name}" deleted.`);
        } catch (err) {
          setError(err.message || "Failed to delete household.");
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
    setAssignRoomId("");
    setError("");
    setModal("assign");

    const centers = await loadActiveCenters();
    if (fam.barangay_id) {
      const matching = centers.find(
        (center) => (center.barangays || []).some(
          (barangay) => Number(barangay.id) === Number(fam.barangay_id)
        )
      );
      if (matching) {
        setAssignCenterId(String(matching.id));
        await queryClient.fetchQuery({
          queryKey: queryKeys.rooms(Number(matching.id)),
          queryFn: () => fetchRooms(Number(matching.id)),
        });
      }
    }
  }

  async function submitAssignment(event) {
    event.preventDefault();
    if (!assignCenterId || !assignRoomId || !activeFamily) {
      setError("Please select both an evacuation center and a room.");
      return;
    }
    const room = assignRooms.find(
      (r) => String(r.id) === String(assignRoomId)
    );
    if (!room) return;

    const needed =
      activeFamily.member_count || activeFamily.resident_count || 1;
    const available =
      room.available ?? Math.max(room.capacity - (room.occupied || 0), 0);
    if (needed > available) {
      setError(
        `Room ${room.room_number} only has ${available} space(s) available, but this household has ${needed} member(s).`
      );
      return;
    }

    setAssigning(true);
    setError("");
    try {
      const result = await api.assignFamily(activeFamily.id, {
        center_id: Number(assignCenterId),
        room_id: Number(assignRoomId),
      });
      await refreshAllData(activeFamily.id);
      setNotice(
        result.message || `Household assigned to Room ${room.room_number}.`
      );
      setModal("");
    } catch (requestError) {
      setError(requestError.message || "Failed to assign household.");
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
    setTargetRoomId("");
    setError("");
    setModal("move");

    await loadActiveCenters();
    if (initialCenterId) {
      await queryClient.fetchQuery({
        queryKey: queryKeys.rooms(Number(initialCenterId)),
        queryFn: () => fetchRooms(Number(initialCenterId)),
      });
    }
  }

  function handleMoveSubmit(event) {
    event.preventDefault();
    if (!targetCenterId || !targetRoomId || !activeFamily) {
      setError("Please select a destination center and room.");
      return;
    }
    const destRoom = targetRooms.find(
      (r) => String(r.id) === String(targetRoomId)
    );
    const destCenter = centersList.find(
      (c) => String(c.id) === String(targetCenterId)
    );
    if (!destRoom) return;

    const needed =
      activeFamily.member_count || activeFamily.resident_count || 1;
    const available =
      destRoom.available ??
      Math.max(destRoom.capacity - (destRoom.occupied || 0), 0);
    if (needed > available) {
      setError(
        `Destination room only has ${available} space(s) available, but this household needs ${needed}.`
      );
      return;
    }

    setConfirmDialog({
      title: "Confirm Room Transfer",
      message: `Move household "${activeFamily.head_name}" (${needed} member${needed === 1 ? "" : "s"}) to ${destCenter ? displayEntityName(destCenter.name) + " — " : ""}Room ${destRoom.room_number}? Occupancy in both rooms will update automatically.`,
      confirmText: "Transfer Household",
      danger: false,
      onConfirm: async () => {
        setMoving(true);
        setError("");
        try {
          const res = await api.moveFamily(activeFamily.id, {
            center_id: Number(targetCenterId),
            room_id: Number(targetRoomId),
          });
          setConfirmDialog(null);
          setModal("");
          await refreshAllData(activeFamily.id);
          setNotice(
            res.message ||
              `Household transferred to Room ${destRoom.room_number}.`
          );
        } catch (err) {
          setError(err.message || "Failed to transfer household.");
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
    const currentRoom = fam.current_room || fam.rooms || "the room";

    setConfirmDialog({
      title: "Unassign Household from Room",
      message: `Unassign household "${fam.head_name}" (${memberCount} member${memberCount === 1 ? "" : "s"}) from ${displayEntityName(currentCenter)} — Room ${currentRoom}? This will release ${memberCount} space(s).`,
      confirmText: "Unassign Household",
      danger: true,
      onConfirm: async () => {
        try {
          const res = await api.unassignFamily(fam.id);
          setConfirmDialog(null);
          await refreshAllData(fam.id);
          setNotice(
            res.message || `Household "${fam.head_name}" unassigned.`
          );
        } catch (err) {
          setError(err.message || "Failed to unassign household.");
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
        `evacway-households-${slug}.csv`
      );
    } catch (requestError) {
      setError(
        requestError.message || "The household list could not be exported."
      );
    }
  }

  async function previewImport() {
    if (!importFile) return;
    setImportBusy(true);
    setError("");
    setImportPreview(null);
    try {
      setImportPreview(await api.previewFamilyImport(importFile));
    } catch (requestError) {
      setError(requestError.message || "The workbook could not be previewed.");
    } finally {
      setImportBusy(false);
    }
  }

  async function commitImport() {
    if (!importFile || !importPreview?.can_import) return;
    setImportBusy(true);
    setError("");
    try {
      const result = await api.previewFamilyImport(importFile, true);
      await refreshAllData();
      setNotice(
        result.message || `Imported ${result.successful_families} households.`
      );
      closeModal();
    } catch (requestError) {
      setError(
        requestError.message || "The import failed. No records were committed."
      );
    } finally {
      setImportBusy(false);
    }
  }

  // Room capacity helpers for modals
  const selectedAssignRoom = assignRooms.find(
    (r) => String(r.id) === String(assignRoomId)
  );
  const assignFamilyMembers =
    activeFamily?.member_count || activeFamily?.resident_count || 1;
  const assignRoomAvailable =
    selectedAssignRoom?.available ??
    (selectedAssignRoom
      ? Math.max(
          selectedAssignRoom.capacity - (selectedAssignRoom.occupied || 0),
          0
        )
      : 0);
  const assignHasCapacity = selectedAssignRoom
    ? assignRoomAvailable >= assignFamilyMembers
    : false;

  const selectedTargetRoom = targetRooms.find(
    (r) => String(r.id) === String(targetRoomId)
  );
  const moveFamilyMembers =
    activeFamily?.member_count || activeFamily?.resident_count || 1;
  const targetRoomAvailable =
    selectedTargetRoom?.available ??
    (selectedTargetRoom
      ? Math.max(
          selectedTargetRoom.capacity - (selectedTargetRoom.occupied || 0),
          0
        )
      : 0);
  const moveHasCapacity = selectedTargetRoom
    ? targetRoomAvailable >= moveFamilyMembers
    : false;

  // =========================================================
  // REUSABLE PERSONAL & VULNERABILITY FORM FIELDS
  // =========================================================
  function renderMemberFormFields(memberObj, onChangeField, isHeadLocked = false) {
    const calculatedAge = getAge(memberObj.date_of_birth);
    return (
      <div className="fm-member-fields-block">
        <div className="fm-form-grid-4">
          <label className="fm-field">
            <span>
              First Name <strong className="fm-req">*</strong>
            </span>
            <input
              type="text"
              value={memberObj.first_name}
              onChange={(e) => onChangeField("first_name", e.target.value)}
              placeholder="e.g. Juan"
              required
            />
          </label>
          <label className="fm-field">
            <span>Middle Name</span>
            <input
              type="text"
              value={memberObj.middle_name}
              onChange={(e) => onChangeField("middle_name", e.target.value)}
              placeholder="Optional"
            />
          </label>
          <label className="fm-field">
            <span>
              Last Name <strong className="fm-req">*</strong>
            </span>
            <input
              type="text"
              value={memberObj.last_name}
              onChange={(e) => onChangeField("last_name", e.target.value)}
              placeholder="e.g. Dela Cruz"
              required
            />
          </label>
          <label className="fm-field">
            <span>Suffix</span>
            <input
              type="text"
              value={memberObj.suffix}
              onChange={(e) => onChangeField("suffix", e.target.value)}
              placeholder="Jr., Sr., III"
            />
          </label>
        </div>

        <div className="fm-form-grid-4">
          <label className="fm-field">
            <span>Date of Birth</span>
            <input
              type="date"
              max={new Date().toISOString().split("T")[0]}
              value={memberObj.date_of_birth}
              onChange={(e) => onChangeField("date_of_birth", e.target.value)}
            />
          </label>
          <div className="fm-field">
            <span>Age</span>
            <div className="fm-readonly-box">
              {calculatedAge !== null
                ? `${calculatedAge} year${calculatedAge === 1 ? "" : "s"} old`
                : "Calculated from birth date"}
            </div>
          </div>
          <label className="fm-field">
            <span>Gender</span>
            <select
              value={memberObj.gender}
              onChange={(e) => onChangeField("gender", e.target.value)}
            >
              <option value="">Not specified</option>
              <option value="Female">Female</option>
              <option value="Male">Male</option>
            </select>
          </label>
          <label className="fm-field">
            <span>Relationship to Head</span>
            {isHeadLocked ? (
              <div className="fm-readonly-box fm-readonly-badge">
                <FontAwesomeIcon icon={faUserCheck} /> Household Head
              </div>
            ) : (
              <select
                value={memberObj.relationship_to_head || "Spouse"}
                onChange={(e) =>
                  onChangeField("relationship_to_head", e.target.value)
                }
              >
                {memberObj.relationship_to_head &&
                  !RELATIONSHIP_OPTIONS.includes(memberObj.relationship_to_head) && (
                    <option value={memberObj.relationship_to_head}>
                      {memberObj.relationship_to_head}
                    </option>
                  )}
                {RELATIONSHIP_OPTIONS.map((rel) => (
                  <option key={rel} value={rel}>
                    {rel}
                  </option>
                ))}
              </select>
            )}
          </label>
        </div>

        <div className="fm-form-grid-2">
          <label className="fm-field">
            <span>Contact Number</span>
            <input
              type="text"
              value={memberObj.contact_number}
              onChange={(e) => onChangeField("contact_number", e.target.value)}
              placeholder="Optional mobile or phone number"
            />
          </label>
          <label className="fm-field">
            <span>Special Needs Summary (Optional)</span>
            <input
              type="text"
              value={memberObj.vulnerable_members}
              onChange={(e) =>
                onChangeField("vulnerable_members", e.target.value)
              }
              placeholder="e.g. Bedridden, Wheelchair user, Infant"
            />
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
            <label className="fm-check-pill">
              <input
                type="checkbox"
                checked={Boolean(memberObj.is_pregnant)}
                onChange={(e) => onChangeField("is_pregnant", e.target.checked)}
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
            <label className="fm-check-pill">
              <input
                type="checkbox"
                checked={Boolean(memberObj.needs_assistance)}
                onChange={(e) =>
                  onChangeField("needs_assistance", e.target.checked)
                }
              />
              <span>Needs Evacuation Assistance</span>
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
          <label className="fm-field">
            <span>Medical Notes</span>
            <textarea
              rows={2}
              value={memberObj.medical_notes}
              onChange={(e) => onChangeField("medical_notes", e.target.value)}
              placeholder="Medications, allergies, or health conditions (optional)"
            />
          </label>
          <label className="fm-field">
            <span>Additional Notes</span>
            <textarea
              rows={2}
              value={memberObj.notes}
              onChange={(e) => onChangeField("notes", e.target.value)}
              placeholder="Other notes (optional)"
            />
          </label>
        </div>
      </div>
    );
  }

  return (
    <section className="family-module" aria-label="Household and Resident Management">
      {/* Feedback Banners */}
      {error && !modal && (
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

      {notice && (
        <div className="fm-banner fm-banner-success" role="status">
          <div className="fm-banner-content">
            <FontAwesomeIcon icon={faCheckCircle} />
            <span>{notice}</span>
          </div>
          <button type="button" onClick={() => setNotice("")}>
            Dismiss
          </button>
        </div>
      )}

      {/* =====================================================
          SCREEN 1: 5-STEP ADD FAMILY WIZARD
      ===================================================== */}
      {activeScreen === "add-wizard" && (
        <div className="fm-surface-card fm-wizard-container">
          <div className="fm-subpage-topbar">
            <button
              type="button"
              className="fm-back-btn"
              onClick={backToHouseholdList}
              disabled={saving}
            >
              <FontAwesomeIcon icon={faArrowLeft} /> Back to Households
            </button>
            <span className="fm-step-pill">Step {wizardStep} of 3</span>
          </div>

          <div className="fm-wizard-header">
            <div>
              <h3>Add New Household</h3>
              <p>
                Follow the steps below to register the household, head of household, and members.
              </p>
            </div>
          </div>

          {/* 3-Step Progress Indicator */}
          <ol className="fm-stepper" aria-label="Registration steps">
            {ADD_STEPS.map((s) => {
              const isCurrent = wizardStep === s.number;
              const isCompleted = wizardStep > s.number;
              return (
                <li
                  key={s.number}
                  className={`fm-stepper-item ${isCurrent ? "is-current" : ""} ${isCompleted ? "is-completed" : ""}`}
                >
                  <button
                    type="button"
                    className="fm-stepper-btn"
                    onClick={() => jumpToWizardStep(s.number)}
                    disabled={saving}
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

          <form onSubmit={submitNewFamily} className="fm-wizard-body">
            {/* STEP 1: HOUSEHOLD & HEAD INFORMATION */}
            {wizardStep === 1 && (
              <div className="fm-step-panel">
                <div className="fm-step-intro">
                  <h4>Step 1: Household & Household Head Details</h4>
                  <p>
                    Enter the barangay, address, contact details, and personal information for the household head.
                  </p>
                </div>

                <div className="fm-form-grid-2">
                  <label className="fm-field">
                    <span>
                      Barangay <strong className="fm-req">*</strong>
                    </span>
                    <select
                      value={wizardForm.barangay_id}
                      onChange={(e) =>
                        setWizardForm((prev) => ({
                          ...prev,
                          barangay_id: e.target.value,
                        }))
                      }
                      disabled={Boolean(lockedBarangayId)}
                      required
                    >
                      <option value="">Select barangay</option>
                      {barangays.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="fm-field">
                    <span>Household Code (Optional)</span>
                    <input
                      type="text"
                      value={wizardForm.family_code}
                      onChange={(e) =>
                        setWizardForm((prev) => ({
                          ...prev,
                          family_code: e.target.value,
                        }))
                      }
                      placeholder="Auto-generated if left blank"
                    />
                  </label>
                </div>

                <div className="fm-form-grid-1">
                  <label className="fm-field">
                    <span>
                      Complete Household Address / Purok{" "}
                      <strong className="fm-req">*</strong>
                    </span>
                    <input
                      type="text"
                      value={wizardForm.address}
                      onChange={(e) =>
                        setWizardForm((prev) => ({
                          ...prev,
                          address: e.target.value,
                        }))
                      }
                      placeholder="e.g. Purok 3, Sitio Malinao, near Barangay Hall"
                      required
                    />
                  </label>
                </div>

                <div className="fm-form-grid-2">
                  <label className="fm-field">
                    <span>Household Contact Number</span>
                    <input
                      type="text"
                      value={wizardForm.contact_number}
                      onChange={(e) =>
                        setWizardForm((prev) => ({
                          ...prev,
                          contact_number: e.target.value,
                        }))
                      }
                      placeholder="e.g. 09171234567"
                    />
                  </label>

                  <label className="fm-field">
                    <span>Alternate Contact Number</span>
                    <input
                      type="text"
                      value={wizardForm.alternate_contact}
                      onChange={(e) =>
                        setWizardForm((prev) => ({
                          ...prev,
                          alternate_contact: e.target.value,
                        }))
                      }
                      placeholder="Optional secondary contact"
                    />
                  </label>
                </div>

                <div className="fm-form-grid-1">
                  <label className="fm-field">
                    <span>Household Remarks / Evacuation Notes</span>
                    <textarea
                      rows={2}
                      value={wizardForm.remarks}
                      onChange={(e) =>
                        setWizardForm((prev) => ({
                          ...prev,
                          remarks: e.target.value,
                        }))
                      }
                      placeholder="Optional household-level notes or special evacuation instructions"
                    />
                  </label>
                </div>

                <div className="fm-step-subhead" style={{ marginTop: "24px", paddingTop: "18px", borderTop: "1px solid #e2e8f0" }}>
                  <div className="fm-step-intro-row">
                    <div>
                      <h4 style={{ margin: 0, fontSize: "16px" }}>Household Head Profile</h4>
                      <p style={{ margin: "2px 0 0", color: "#64748b", fontSize: "13px" }}>
                        Personal details for the designated household head (first resident).
                      </p>
                    </div>
                    <span className="fm-badge fm-badge-blue">
                      <FontAwesomeIcon icon={faUserCheck} /> Household Head
                    </span>
                  </div>
                </div>

                {renderMemberFormFields(
                  wizardForm.head,
                  updateWizardHead,
                  true
                )}
              </div>
            )}

            {/* STEP 2: ADDITIONAL HOUSEHOLD MEMBERS */}
            {wizardStep === 2 && (
              <div className="fm-step-panel">
                <div className="fm-step-intro">
                  <div className="fm-step-intro-row">
                    <div>
                      <h4>Step 2: Additional Household Members</h4>
                      <p>
                        Add all additional residents living in this household.
                        Single-person households can proceed directly to Step 3.
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
                          Household Head
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
                    onClick={() => setWizardStep(1)}
                  >
                    <FontAwesomeIcon icon={faPenToSquare} /> Edit Head in Step 1
                  </button>
                </div>

                {/* Additional Member Draft Form (Add / Edit) */}
                {editingOtherIndex !== null && memberDraft && (
                  <div className="fm-member-draft-card">
                    <div className="fm-member-draft-header">
                      <h5>
                        {editingOtherIndex === "new"
                          ? "Add Household Member"
                          : `Edit Household Member #${editingOtherIndex + 2}`}
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
                      false
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
                      <strong>No additional household members added yet</strong>
                      <p>
                        Click &ldquo;Add Another Member&rdquo; above to add
                        dependents, or click &ldquo;Next Step&rdquo; if this is
                        a single-person household.
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
                                  {member.relationship_to_head || "Member"}
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

            {/* STEP 3: EVACUATION ASSIGNMENT & REVIEW */}
            {wizardStep === 3 && (
              <div className="fm-step-panel">
                <div className="fm-step-intro">
                  <h4>Step 3: Evacuation Room & Confirm Registration</h4>
                  <p>
                    Optionally assign this household ({1 + wizardForm.otherMembers.length}{" "}
                    total member{wizardForm.otherMembers.length === 0 ? "" : "s"})
                    to an active evacuation room now, and review summary details before saving.
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
                          assignment_room_id: "",
                        }))
                      }
                    />
                    <div>
                      <strong>Leave Unassigned for Now</strong>
                      <p>
                        Register the household in the barangay registry without
                        occupying an evacuation room yet.
                      </p>
                    </div>
                  </label>

                  <label
                    className={`fm-choice-card ${wizardForm.assignment_mode === "assign" ? "is-selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name="assignment_mode"
                      checked={wizardForm.assignment_mode === "assign"}
                      onChange={() =>
                        setWizardForm((prev) => ({
                          ...prev,
                          assignment_mode: "assign",
                        }))
                      }
                    />
                    <div>
                      <strong>Assign to Evacuation Center & Room</strong>
                      <p>
                        Select an active evacuation center and room with
                        sufficient remaining capacity.
                      </p>
                    </div>
                  </label>
                </div>

                {wizardForm.assignment_mode === "assign" && (
                  <div className="fm-assignment-selector-box">
                    <div className="fm-form-grid-2">
                      <label className="fm-field">
                        <span>
                          Evacuation Center <strong className="fm-req">*</strong>
                        </span>
                        <select
                          value={wizardForm.assignment_center_id}
                          onChange={(e) =>
                            setWizardForm((prev) => ({
                              ...prev,
                              assignment_center_id: e.target.value,
                              assignment_room_id: "",
                            }))
                          }
                        >
                          <option value="">Select evacuation center</option>
                          {centersList.map((c) => {
                            const cap = c.capacity ?? 0;
                            const occ = c.occupied ?? c.current_occupancy ?? 0;
                            return (
                              <option key={c.id} value={c.id}>
                                {displayEntityName(c.name)} (
                                {(c.barangays || []).map((barangay) => barangay.name).join(", ")}) — {occ}/{cap} assigned
                              </option>
                            );
                          })}
                        </select>
                      </label>

                      <label className="fm-field">
                        <span>
                          Room <strong className="fm-req">*</strong>
                        </span>
                        <select
                          value={wizardForm.assignment_room_id}
                          disabled={
                            !wizardForm.assignment_center_id ||
                            wizardRoomsQuery.isLoading
                          }
                          onChange={(e) =>
                            setWizardForm((prev) => ({
                              ...prev,
                              assignment_room_id: e.target.value,
                            }))
                          }
                        >
                          <option value="">
                            {!wizardForm.assignment_center_id
                              ? "Select a center first"
                              : wizardRoomsQuery.isLoading
                                ? "Loading rooms..."
                                : wizardRooms.length === 0
                                  ? "No active rooms in this center"
                                  : "Select room"}
                          </option>
                          {wizardRooms.map((room) => {
                            const available =
                              room.available ??
                              Math.max(
                                room.capacity - (room.occupied || 0),
                                0
                              );
                            const needed = 1 + wizardForm.otherMembers.length;
                            const enough = available >= needed;
                            return (
                              <option
                                key={room.id}
                                value={room.id}
                                disabled={!enough}
                              >
                                Room {room.room_number} — {room.occupied || 0}/
                                {room.capacity} assigned ({available} remaining)
                                {!enough ? " [Insufficient capacity]" : ""}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                    </div>

                    {wizardForm.assignment_center_id &&
                      wizardRooms.length > 0 && (
                        <div className="fm-room-cards-grid">
                          {wizardRooms.map((room) => {
                            const available =
                              room.available ??
                              Math.max(
                                room.capacity - (room.occupied || 0),
                                0
                              );
                            const needed = 1 + wizardForm.otherMembers.length;
                            const enough = available >= needed;
                            const isSelected =
                              String(wizardForm.assignment_room_id) ===
                              String(room.id);
                            return (
                              <button
                                key={room.id}
                                type="button"
                                disabled={!enough}
                                onClick={() =>
                                  setWizardForm((prev) => ({
                                    ...prev,
                                    assignment_room_id: String(room.id),
                                  }))
                                }
                                className={`fm-room-pick-card ${isSelected ? "is-selected" : ""} ${!enough ? "is-disabled" : ""}`}
                              >
                                <div className="fm-room-pick-top">
                                  <strong>
                                    <FontAwesomeIcon icon={faDoorOpen} /> Room{" "}
                                    {room.room_number}
                                  </strong>
                                  <span
                                    className={`fm-badge ${enough ? "fm-badge-green" : "fm-badge-red"}`}
                                  >
                                    {available} remaining
                                  </span>
                                </div>
                                <div className="fm-room-pick-meta">
                                  <span>Capacity: {room.capacity}</span>
                                  <span>Assigned: {room.occupied || 0}</span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                  </div>
                )}

                {/* Review Summary before submission */}
                <div className="fm-step-intro" style={{ marginTop: "1.5rem" }}>
                  <h4>Registration Summary</h4>
                  <p>Please review household details before saving.</p>
                </div>

                <div className="fm-review-grid">
                  {/* Review Block 1: Household Info */}
                  <div className="fm-review-card">
                    <div className="fm-review-card-header">
                      <h5>
                        <FontAwesomeIcon icon={faHouse} /> Household & Head
                      </h5>
                      <button
                        type="button"
                        className="fm-btn fm-btn-ghost fm-btn-sm"
                        onClick={() => setWizardStep(1)}
                      >
                        <FontAwesomeIcon icon={faPenToSquare} /> Edit
                      </button>
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
                        <dt>Household Code</dt>
                        <dd>{wizardForm.family_code.trim() || "Auto-generated"}</dd>
                      </div>
                      <div>
                        <dt>Household Head</dt>
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
                        <FontAwesomeIcon icon={faBuilding} /> Room Assignment
                      </h5>
                    </div>
                    {wizardForm.assignment_mode === "assign" &&
                    wizardForm.assignment_center_id &&
                    wizardForm.assignment_room_id ? (
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
                            {displayEntityName(
                              centersList.find(
                                (c) =>
                                  String(c.id) ===
                                  String(wizardForm.assignment_center_id)
                              )?.name
                            ) || "Selected Center"}
                          </dd>
                        </div>
                        <div>
                          <dt>Room</dt>
                          <dd>
                            Room{" "}
                            {wizardRooms.find(
                              (r) =>
                                String(r.id) ===
                                String(wizardForm.assignment_room_id)
                            )?.room_number || wizardForm.assignment_room_id}
                          </dd>
                        </div>
                        <div>
                          <dt>Total Members to Assign</dt>
                          <dd>{1 + wizardForm.otherMembers.length}</dd>
                        </div>
                      </dl>
                    ) : (
                      <div className="fm-review-unassigned">
                        <span className="fm-badge fm-badge-neutral">
                          Unassigned
                        </span>
                        <p>
                          Household will be registered in the barangay registry without an active room assignment.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Review Block 3: Household Head & Members */}
                <div className="fm-review-card" style={{ marginTop: "1rem" }}>
                  <div className="fm-review-card-header">
                    <h5>
                      <FontAwesomeIcon icon={faUsers} /> Household Members ({1 + wizardForm.otherMembers.length})
                    </h5>
                    <button
                      type="button"
                      className="fm-btn fm-btn-ghost fm-btn-sm"
                      onClick={() => setWizardStep(2)}
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
                                      Household Head
                                    </span>
                                  ) : (
                                    <span className="fm-badge fm-badge-neutral">
                                      {member.relationship_to_head || "Member"}
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

            {/* Wizard Navigation Footer */}
            <div className="fm-wizard-footer">
              <button
                type="button"
                className="fm-btn fm-btn-secondary"
                onClick={
                  wizardStep === 1 ? backToHouseholdList : handleWizardBack
                }
                disabled={saving}
              >
                {wizardStep === 1 ? "Cancel" : "Previous Step"}
              </button>

              <div className="fm-wizard-footer-right">
                {wizardStep < 3 ? (
                  <button
                    type="button"
                    className="fm-btn fm-btn-primary"
                    onClick={handleWizardNext}
                  >
                    Next Step
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="fm-btn fm-btn-primary"
                    disabled={saving}
                  >
                    <FontAwesomeIcon
                      icon={saving ? faRotate : faCheckCircle}
                      spin={saving}
                    />
                    {saving
                      ? "Saving Household..."
                      : "Confirm & Register Household"}
                  </button>
                )}
              </div>
            </div>
          </form>
        </div>
      )}

      {/* =====================================================
          SCREEN 2: INDIVIDUAL MEMBER DETAILS (Page E)
      ===================================================== */}
      {activeScreen === "member-detail" && activeFamily && (
        <div className="fm-surface-card fm-detail-page">
          <div className="fm-subpage-topbar">
            <button
              type="button"
              className="fm-back-btn"
              onClick={backToHouseholdDetails}
            >
              <FontAwesomeIcon icon={faArrowLeft} /> Back to Household Details (
              {activeFamily.family_code})
            </button>

            {activeMember && (
              <div className="fm-inline-actions">
                <button
                  type="button"
                  className="fm-btn fm-btn-secondary"
                  onClick={() => openEditMemberModal(activeMember)}
                >
                  <FontAwesomeIcon icon={faPenToSquare} /> Edit Member Details
                </button>
                {!activeMember.is_head_of_family && (
                  <>
                    <button
                      type="button"
                      className="fm-btn fm-btn-secondary"
                      onClick={() => confirmPromoteToHead(activeMember)}
                    >
                      <FontAwesomeIcon icon={faUserCheck} /> Set as Household Head
                    </button>
                    <button
                      type="button"
                      className="fm-btn fm-btn-danger-outline"
                      onClick={() => confirmDeleteMember(activeMember)}
                    >
                      <FontAwesomeIcon icon={faTrashCan} /> Remove Member
                    </button>
                  </>
                )}
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
                          Household Head
                        </span>
                      ) : (
                        <span className="fm-badge fm-badge-neutral">
                          {activeMember.relationship_to_head || "Family Member"}
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
                      Household {activeFamily.family_code} (Head: {activeFamily.head_name}) • Barangay{" "}
                      {activeMember.barangay || activeFamily.barangay || "—"}
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
                      <dd>{activeMember.first_name || "Not recorded"}</dd>
                    </div>
                    <div>
                      <dt>Middle Name</dt>
                      <dd>{activeMember.middle_name || "—"}</dd>
                    </div>
                    <div>
                      <dt>Last Name</dt>
                      <dd>{activeMember.last_name || "Not recorded"}</dd>
                    </div>
                    <div>
                      <dt>Suffix</dt>
                      <dd>{activeMember.suffix || "—"}</dd>
                    </div>
                    <div>
                      <dt>Date of Birth</dt>
                      <dd>{activeMember.date_of_birth || "Not recorded"}</dd>
                    </div>
                    <div>
                      <dt>Age</dt>
                      <dd>
                        {getAge(activeMember.date_of_birth) !== null
                          ? `${getAge(activeMember.date_of_birth)} years old`
                          : "Not available"}
                      </dd>
                    </div>
                    <div>
                      <dt>Gender</dt>
                      <dd>{activeMember.gender || "Not specified"}</dd>
                    </div>
                    <div>
                      <dt>Relationship to Head</dt>
                      <dd>
                        {activeMember.is_head_of_family
                          ? "Household Head"
                          : activeMember.relationship_to_head || "Not specified"}
                      </dd>
                    </div>
                    <div>
                      <dt>Household Head</dt>
                      <dd>
                        {activeMember.is_head_of_family
                          ? "Yes — Household Head"
                          : `No (${activeFamily.head_name})`}
                      </dd>
                    </div>
                    <div>
                      <dt>Contact Number</dt>
                      <dd>
                        {activeMember.contact_number ||
                          activeFamily.contact_number ||
                          "Not provided"}
                      </dd>
                    </div>
                    <div>
                      <dt>Alternate Contact</dt>
                      <dd>{activeMember.alternate_contact || "—"}</dd>
                    </div>
                    <div>
                      <dt>Household Address</dt>
                      <dd>
                        {activeMember.address ||
                          activeFamily.address ||
                          "Not recorded"}
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
                          ? activeMember.disability_type || "Unspecified"
                          : "Not applicable"}
                      </dd>
                    </div>
                    <div>
                      <dt>Disability Notes</dt>
                      <dd>
                        {activeMember.is_pwd
                          ? activeMember.disability_notes || "None recorded"
                          : "Not applicable"}
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
                    <div>
                      <dt>Evacuation Assistance</dt>
                      <dd>
                        <span
                          className={`fm-badge ${activeMember.needs_assistance ? "fm-badge-red" : "fm-badge-neutral"}`}
                        >
                          {activeMember.needs_assistance
                            ? "Needs Assistance"
                            : "No Special Assistance"}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt>Special Needs Summary</dt>
                      <dd>{activeMember.vulnerable_members || "None"}</dd>
                    </div>
                    <div className="fm-dl-full">
                      <dt>Medical Notes</dt>
                      <dd>{activeMember.medical_notes || "None recorded"}</dd>
                    </div>
                    <div className="fm-dl-full">
                      <dt>Additional Notes</dt>
                      <dd>
                        {activeMember.notes ||
                          activeMember.remarks ||
                          "None recorded"}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>

              {/* Household & Evacuation Assignment Link */}
              <div className="fm-info-panel" style={{ marginTop: "1rem" }}>
                <div className="fm-info-panel-header">
                  <h4>
                    <FontAwesomeIcon icon={faBuilding} /> Household & Evacuation Room Assignment
                  </h4>
                  <button
                    type="button"
                    className="fm-btn fm-btn-ghost fm-btn-sm"
                    onClick={backToHouseholdDetails}
                  >
                    <FontAwesomeIcon icon={faHouse} /> View Household ({activeFamily.family_code})
                  </button>
                </div>
                <dl className="fm-dl-grid">
                  <div>
                    <dt>Household ID</dt>
                    <dd>{activeFamily.family_code}</dd>
                  </div>
                  <div>
                    <dt>Household Head</dt>
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
                        ) || "Not Assigned"}
                      </strong>
                    </dd>
                  </div>
                  <div>
                    <dt>Assigned Room</dt>
                    <dd>
                      <strong>
                        {activeMember.assigned_room_number ||
                        activeFamily.current_room ||
                        activeFamily.rooms ||
                        activeFamily.assignments?.[0]?.room
                          ? `Room ${
                              activeMember.assigned_room_number ||
                              activeFamily.current_room ||
                              activeFamily.rooms ||
                              activeFamily.assignments?.[0]?.room
                            }`
                          : "Not Assigned"}
                      </strong>
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =====================================================
          SCREEN 3: HOUSEHOLD DETAILS (Page D)
      ===================================================== */}
      {activeScreen === "household-detail" && (
        <div className="fm-surface-card fm-detail-page">
          <div className="fm-subpage-topbar">
            <button
              type="button"
              className="fm-back-btn"
              onClick={backToHouseholdList}
            >
              <FontAwesomeIcon icon={faArrowLeft} /> Back to Households
            </button>

            {activeFamily && (
              <div className="fm-inline-actions">
                <button
                  type="button"
                  className="fm-btn fm-btn-secondary"
                  onClick={() => openEditHouseholdModal(activeFamily)}
                >
                  <FontAwesomeIcon icon={faPenToSquare} /> Edit Household
                </button>
                <button
                  type="button"
                  className="fm-btn fm-btn-primary"
                  onClick={openAddMemberModal}
                >
                  <FontAwesomeIcon icon={faUserPlus} /> Add Member
                </button>
                {!isFamilyAssigned(activeFamily) && (
                  <button
                    type="button"
                    className="fm-btn fm-btn-danger-outline"
                    onClick={() => confirmDeleteFamily(activeFamily)}
                  >
                    <FontAwesomeIcon icon={faTrashCan} /> Delete
                  </button>
                )}
              </div>
            )}
          </div>

          {familyDetailQuery.isLoading && !activeFamily ? (
            <LoadingState message="Loading household details..." />
          ) : !activeFamily ? (
            <div className="fm-empty-state">
              <p>Household record could not be found.</p>
            </div>
          ) : (
            <>
              {/* Household Header Banner */}
              <div className="fm-profile-hero">
                <div className="fm-profile-hero-main">
                  <div className="fm-member-avatar large is-head">
                    <FontAwesomeIcon icon={faHouse} />
                  </div>
                  <div>
                    <div className="fm-member-title-row">
                      <h3>{activeFamily.head_name}</h3>
                      <span className="fm-code-badge">
                        {activeFamily.family_code}
                      </span>
                      <span
                        className={`fm-badge ${isFamilyAssigned(activeFamily) ? "fm-badge-green" : "fm-badge-amber"}`}
                      >
                        {isFamilyAssigned(activeFamily)
                          ? "Assigned"
                          : "Unassigned"}
                      </span>
                    </div>
                    <p className="fm-profile-subtitle">
                      Barangay {activeFamily.barangay || "—"} •{" "}
                      {activeFamily.members?.length ??
                        activeFamily.resident_count ??
                        activeFamily.member_count ??
                        0}{" "}
                      Member
                      {(activeFamily.members?.length ??
                        activeFamily.resident_count ??
                        activeFamily.member_count ??
                        0) === 1
                        ? ""
                        : "s"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Two-column Household Info + Evacuation Assignment */}
              <div className="fm-detail-columns">
                {/* Household Information */}
                <div className="fm-info-panel">
                  <div className="fm-info-panel-header">
                    <h4>
                      <FontAwesomeIcon icon={faHouse} /> Household Details
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
                      <dt>Household Code</dt>
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
                      <FontAwesomeIcon icon={faBuilding} /> Evacuation Room Assignment
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
                        <div>
                          <dt>Assigned Room</dt>
                          <dd>
                            <strong>
                              Room{" "}
                              {activeFamily.current_room ||
                                activeFamily.rooms ||
                                activeFamily.assignments?.[0]?.room ||
                                "—"}
                            </strong>
                          </dd>
                        </div>
                        <div>
                          <dt>Room Capacity</dt>
                          <dd>
                            {activeFamily.current_room_capacity ??
                              activeFamily.assignments?.[0]?.room_capacity ??
                              "—"}
                          </dd>
                        </div>
                        <div>
                          <dt>Room Assignment</dt>
                          <dd>
                            {activeFamily.current_room_occupied ??
                              activeFamily.assigned_members ??
                              "—"}{" "}
                            assigned •{" "}
                            {activeFamily.current_room_available ?? "—"}{" "}
                            remaining
                          </dd>
                        </div>
                      </dl>
                      <div className="fm-assignment-actions">
                        <button
                          type="button"
                          className="fm-btn fm-btn-primary"
                          onClick={() => openMoveModal(activeFamily)}
                        >
                          <FontAwesomeIcon icon={faRightLeft} /> Change Assigned
                          Room
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
                        This household is currently{" "}
                        <strong>Not Assigned</strong> to any evacuation room.
                      </p>
                      <button
                        type="button"
                        className="fm-btn fm-btn-primary"
                        onClick={() => openAssignModal(activeFamily)}
                      >
                        <FontAwesomeIcon icon={faDoorOpen} /> Assign Room
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Family Members Section */}
              <div className="fm-members-section">
                <div className="fm-members-section-header">
                  <div>
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
                    className="fm-btn fm-btn-primary fm-btn-sm"
                    onClick={openAddMemberModal}
                  >
                    <FontAwesomeIcon icon={faUserPlus} /> Add Member
                  </button>
                </div>

                {familyDetailQuery.isLoading && !activeFamily.members ? (
                  <LoadingState message="Loading family members..." />
                ) : !activeFamily.members ||
                  activeFamily.members.length === 0 ? (
                  <div className="fm-empty-inline">
                    <FontAwesomeIcon icon={faUsers} />
                    <div>
                      <strong>No member records found</strong>
                      <p>
                        Add a family member to record personal and health information.
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Desktop Compact Members Table */}
                    <div className="fm-table-wrap fm-desktop-only">
                      <table className="fm-table">
                        <thead>
                          <tr>
                            <th>Full Name</th>
                            <th>Role</th>
                            <th>Birth Date & Age</th>
                            <th>Gender</th>
                            <th>Special Needs</th>
                            <th className="fm-col-actions">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeFamily.members.map((member) => {
                            const age = getAge(member.date_of_birth);
                            const badges = getVulnerabilityBadges(member);
                            return (
                              <tr key={member.id}>
                                <td>
                                  <div className="fm-member-cell-name">
                                    <strong>{memberDisplayName(member)}</strong>
                                    {member.is_head_of_family && (
                                      <span className="fm-badge fm-badge-blue">
                                        Household Head
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td>
                                  {member.is_head_of_family
                                    ? "Self (Head)"
                                    : member.relationship_to_head ||
                                      "Family Member"}
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
                                <td>{member.gender || "—"}</td>
                                <td>
                                  {badges.length > 0 ? (
                                    <div className="fm-badge-wrap">
                                      {badges.map((b, idx) => (
                                        <span
                                          key={idx}
                                          className={`fm-badge fm-badge-${b.tone}`}
                                        >
                                          {b.label}
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="fm-muted-inline">None</span>
                                  )}
                                </td>
                                <td className="fm-col-actions">
                                  <div className="fm-row-actions">
                                    <button
                                      type="button"
                                      className="fm-btn fm-btn-secondary fm-btn-sm"
                                      onClick={() => openMemberDetails(member)}
                                    >
                                      <FontAwesomeIcon icon={faEye} /> Details
                                    </button>
                                    <button
                                      type="button"
                                      className="fm-btn fm-btn-ghost fm-btn-sm"
                                      onClick={() =>
                                        openEditMemberModal(member)
                                      }
                                      title="Edit Member"
                                    >
                                      <FontAwesomeIcon icon={faPenToSquare} />
                                    </button>
                                    {!member.is_head_of_family && (
                                      <>
                                        <button
                                          type="button"
                                          className="fm-btn fm-btn-ghost fm-btn-sm"
                                          onClick={() =>
                                            confirmPromoteToHead(member)
                                          }
                                          title="Set as Household Head"
                                        >
                                          <FontAwesomeIcon icon={faUserCheck} />
                                        </button>
                                        <button
                                          type="button"
                                          className="fm-btn fm-btn-danger-outline fm-btn-sm"
                                          onClick={() =>
                                            confirmDeleteMember(member)
                                          }
                                          title="Remove Member"
                                        >
                                          <FontAwesomeIcon icon={faTrashCan} />
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile Stacked Member Cards */}
                    <div className="fm-mobile-cards fm-mobile-only">
                      {activeFamily.members.map((member) => {
                        const age = getAge(member.date_of_birth);
                        const badges = getVulnerabilityBadges(member);
                        return (
                          <div key={member.id} className="fm-mobile-card">
                            <div className="fm-mobile-card-top">
                              <div>
                                <strong>{memberDisplayName(member)}</strong>
                                <span className="fm-mobile-sub">
                                  {member.is_head_of_family
                                    ? "Household Head"
                                    : member.relationship_to_head ||
                                      "Family Member"}
                                </span>
                              </div>
                              {member.is_head_of_family && (
                                <span className="fm-badge fm-badge-blue">
                                  Head
                                </span>
                              )}
                            </div>
                            <div className="fm-mobile-card-grid">
                              <div>
                                <span>Age / DOB</span>
                                <strong>
                                  {age !== null
                                    ? `${age} yrs (${member.date_of_birth})`
                                    : member.date_of_birth || "Not recorded"}
                                </strong>
                              </div>
                              <div>
                                <span>Gender</span>
                                <strong>{member.gender || "—"}</strong>
                              </div>
                            </div>
                            {badges.length > 0 && (
                              <div className="fm-badge-wrap">
                                {badges.map((b, idx) => (
                                  <span
                                    key={idx}
                                    className={`fm-badge fm-badge-${b.tone}`}
                                  >
                                    {b.label}
                                  </span>
                                ))}
                              </div>
                            )}
                            <div className="fm-mobile-card-actions">
                              <button
                                type="button"
                                className="fm-btn fm-btn-primary fm-btn-sm"
                                onClick={() => openMemberDetails(member)}
                              >
                                <FontAwesomeIcon icon={faEye} /> View Member
                                Details
                              </button>
                              <button
                                type="button"
                                className="fm-btn fm-btn-secondary fm-btn-sm"
                                onClick={() => openEditMemberModal(member)}
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
            </>
          )}
        </div>
      )}

      {/* =====================================================
          SCREEN 4: HOUSEHOLD LIST (Page C)
      ===================================================== */}
      {activeScreen === "list" && (
        <div className="fm-surface-card">
          {/* Toolbar */}
          <div className="fm-list-header">
            <div>
              <h3>
                {lockedBarangayName
                  ? `Households in ${lockedBarangayName}`
                  : "Registered Households"}
              </h3>
              <p>
                Search households, filter by evacuation assignment status, and
                manage household members and room assignments.
              </p>
            </div>
            <div className="fm-list-actions">
              <button
                type="button"
                className="fm-btn fm-btn-primary"
                onClick={openAddFamilyWizard}
              >
                <FontAwesomeIcon icon={faPlus} /> Add Household
              </button>
              <button
                type="button"
                className="fm-btn fm-btn-secondary"
                onClick={exportFamilies}
              >
                <FontAwesomeIcon icon={faDownload} /> Export CSV
              </button>
            </div>
          </div>

          {/* Search & Filters */}
          <div className="fm-filters-bar">
            <label className="fm-search-box">
              <FontAwesomeIcon icon={faMagnifyingGlass} />
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search by household ID, household head, or member name..."
              />
            </label>

            {!lockedBarangayId && (
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
            )}

            <select
              value={assignmentStatus}
              onChange={(e) => {
                setPage(1);
                setAssignmentStatus(e.target.value);
              }}
              aria-label="Filter by assignment status"
            >
              <option value="">All Statuses</option>
              <option value="assigned">Assigned</option>
              <option value="unassigned">Unassigned</option>
            </select>

            <select
              value={`${sortBy}:${direction}`}
              onChange={(e) => {
                const [nextSort, nextDir] = e.target.value.split(":");
                setPage(1);
                setSortBy(nextSort);
                setDirection(nextDir);
              }}
              aria-label="Sort households"
            >
              <option value="family_code:asc">Household ID (A–Z)</option>
              <option value="head_name:asc">Household Head (A–Z)</option>
              <option value="member_count:desc">Most Members</option>
              <option value="created_at:desc">Recently Added</option>
            </select>
          </div>

          {/* Household List Content */}
          {loading ? (
            <LoadingState message="Loading households..." />
          ) : families.length === 0 ? (
            <div className="fm-empty-state">
              <FontAwesomeIcon icon={faUsers} />
              <h4>No households found</h4>
              <p>
                {search || assignmentStatus
                  ? "No households match your current search or filter criteria."
                  : "Register a household using 'Add Household' to get started."}
              </p>
              <button
                type="button"
                className="fm-btn fm-btn-primary"
                onClick={openAddFamilyWizard}
              >
                <FontAwesomeIcon icon={faPlus} /> Add Household
              </button>
            </div>
          ) : (
            <>
              {/* Desktop Compact Table */}
              <div className="fm-table-wrap fm-desktop-only">
                <table className="fm-table">
                  <thead>
                    <tr>
                      <th>Household ID</th>
                      <th>Household Head</th>
                      {!lockedBarangayId && <th>Barangay</th>}
                      <th>Members</th>
                      <th>Assigned Center / Room</th>
                      <th>Status</th>
                      <th className="fm-col-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {families.map((fam) => {
                      const assigned = isFamilyAssigned(fam);
                      const centerName = displayEntityName(
                        fam.current_center || fam.evacuation_center
                      );
                      const roomNum = fam.current_room || fam.rooms;
                      return (
                        <tr key={fam.id}>
                          <td>
                            <span className="fm-code-badge">
                              {fam.family_code}
                            </span>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="fm-link-btn"
                              onClick={() => openHouseholdDetails(fam)}
                            >
                              {fam.head_name}
                            </button>
                          </td>
                          {!lockedBarangayId && <td>{fam.barangay || "—"}</td>}
                          <td>
                            <strong>
                              {fam.resident_count ?? fam.member_count ?? 0}
                            </strong>
                          </td>
                          <td>
                            {assigned && (centerName || roomNum) ? (
                              <div className="fm-assignment-cell">
                                <strong>{centerName || "Center"}</strong>
                                {roomNum && <span>Room {roomNum}</span>}
                              </div>
                            ) : (
                              <span className="fm-muted-inline">
                                Unassigned
                              </span>
                            )}
                          </td>
                          <td>
                            <span
                              className={`fm-badge ${assigned ? "fm-badge-green" : "fm-badge-amber"}`}
                            >
                              {assigned ? "Assigned" : "Not Assigned"}
                            </span>
                          </td>
                          <td className="fm-col-actions">
                            <div className="fm-row-actions">
                              <button
                                type="button"
                                className="fm-btn fm-btn-secondary fm-btn-sm"
                                onClick={() => openHouseholdDetails(fam)}
                              >
                                <FontAwesomeIcon icon={faEye} /> View
                              </button>
                              <button
                                type="button"
                                className="fm-btn fm-btn-ghost fm-btn-sm"
                                onClick={() => openEditHouseholdModal(fam)}
                                title="Edit Household"
                              >
                                <FontAwesomeIcon icon={faPenToSquare} />
                              </button>
                              {assigned ? (
                                <button
                                  type="button"
                                  className="fm-btn fm-btn-ghost fm-btn-sm"
                                  onClick={() => openMoveModal(fam)}
                                  title="Change Room"
                                >
                                  <FontAwesomeIcon icon={faRightLeft} />
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="fm-btn fm-btn-ghost fm-btn-sm"
                                  onClick={() => openAssignModal(fam)}
                                  title="Assign Room"
                                >
                                  <FontAwesomeIcon icon={faDoorOpen} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Stacked Cards */}
              <div className="fm-mobile-cards fm-mobile-only">
                {families.map((fam) => {
                  const assigned = isFamilyAssigned(fam);
                  const centerName = displayEntityName(
                    fam.current_center || fam.evacuation_center
                  );
                  const roomNum = fam.current_room || fam.rooms;
                  return (
                    <article key={fam.id} className="fm-mobile-card">
                      <div className="fm-mobile-card-top">
                        <div>
                          <span className="fm-code-badge">
                            {fam.family_code}
                          </span>
                          <h4 className="fm-mobile-head-name">
                            {fam.head_name}
                          </h4>
                        </div>
                        <span
                          className={`fm-badge ${assigned ? "fm-badge-green" : "fm-badge-amber"}`}
                        >
                          {assigned ? "Assigned" : "Not Assigned"}
                        </span>
                      </div>

                      <div className="fm-mobile-card-grid">
                        {!lockedBarangayId && (
                          <div>
                            <span>Barangay</span>
                            <strong>{fam.barangay || "—"}</strong>
                          </div>
                        )}
                        <div>
                          <span>Members</span>
                          <strong>
                            {fam.resident_count ?? fam.member_count ?? 0}{" "}
                            member
                            {(fam.resident_count ?? fam.member_count ?? 0) === 1
                              ? ""
                              : "s"}
                          </strong>
                        </div>
                        <div>
                          <span>Evacuation Room</span>
                          <strong>
                            {assigned && (centerName || roomNum)
                              ? `${centerName || "Center"}${roomNum ? ` • Rm ${roomNum}` : ""}`
                              : "Unassigned"}
                          </strong>
                        </div>
                      </div>

                      <div className="fm-mobile-card-actions">
                        <button
                          type="button"
                          className="fm-btn fm-btn-primary fm-btn-sm"
                          onClick={() => openHouseholdDetails(fam)}
                        >
                          <FontAwesomeIcon icon={faEye} /> View Details
                        </button>
                        {assigned ? (
                          <button
                            type="button"
                            className="fm-btn fm-btn-secondary fm-btn-sm"
                            onClick={() => openMoveModal(fam)}
                          >
                            <FontAwesomeIcon icon={faRightLeft} /> Change Room
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="fm-btn fm-btn-secondary fm-btn-sm"
                            onClick={() => openAssignModal(fam)}
                          >
                            <FontAwesomeIcon icon={faDoorOpen} /> Assign Room
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>

              {/* Pagination Footer */}
              <div className="fm-pagination">
                <span>
                  Showing <strong>{families.length}</strong> of{" "}
                  <strong>{total}</strong> household{total === 1 ? "" : "s"}
                </span>
                <div className="fm-pagination-controls">
                  <button
                    type="button"
                    className="fm-btn fm-btn-secondary fm-btn-sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </button>
                  <span className="fm-page-indicator">
                    Page {page} of {pages}
                  </span>
                  <button
                    type="button"
                    className="fm-btn fm-btn-secondary fm-btn-sm"
                    disabled={page >= pages}
                    onClick={() => setPage((p) => Math.min(pages, p + 1))}
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* =====================================================
          MODALS (EDIT HOUSEHOLD, ADD/EDIT MEMBER, ASSIGN, MOVE, IMPORT)
      ===================================================== */}
      {modal && (
        <div
          className="fm-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div
            className={`fm-modal-dialog ${modal === "member-form" || modal === "import" ? "fm-modal-wide" : ""}`}
          >
            <div className="fm-modal-header">
              <div>
                <h3>
                  {modal === "edit-household" && "Edit Household Information"}
                  {modal === "member-form" &&
                    (memberModalMode === "add"
                      ? "Add Household Member"
                      : "Edit Household Member")}
                  {modal === "assign" && "Assign Household to Evacuation Room"}
                  {modal === "move" && "Change Assigned Evacuation Room"}
                  {modal === "import" && "Import Households from Excel"}
                </h3>
                <p>
                  {modal === "edit-household" &&
                    `Update shared household details for ${activeFamily?.family_code || ""}.`}
                  {modal === "member-form" &&
                    `Household: ${activeFamily?.head_name || ""} (${activeFamily?.family_code || ""})`}
                  {modal === "assign" &&
                    `Select an active center and room for ${activeFamily?.head_name || ""}.`}
                  {modal === "move" &&
                    `Transfer ${activeFamily?.head_name || ""} to another room.`}
                  {modal === "import" &&
                    "Preview and validate an .xlsx workbook before committing records."}
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
              <div className="fm-banner fm-banner-error fm-modal-alert">
                <div className="fm-banner-content">
                  <FontAwesomeIcon icon={faTriangleExclamation} />
                  <span>{error}</span>
                </div>
              </div>
            )}

            {/* MODAL: EDIT HOUSEHOLD */}
            {modal === "edit-household" && (
              <form onSubmit={submitEditHousehold} className="fm-modal-body">
                {activeFamily?.members && activeFamily.members.length > 1 && (
                  <label className="fm-field">
                    <span>Designated Household Head (Select Member)</span>
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
                          {m.is_head_of_family ? " (Current Head)" : ` (${m.relationship_to_head || "Member"})`}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <div className="fm-form-grid-2">
                  <label className="fm-field">
                    <span>
                      Household Head Name <strong className="fm-req">*</strong>
                    </span>
                    <input
                      type="text"
                      value={editHouseholdForm.head_name}
                      onChange={(e) =>
                        setEditHouseholdForm((prev) => ({
                          ...prev,
                          head_name: e.target.value,
                        }))
                      }
                      required
                    />
                  </label>
                  <label className="fm-field">
                    <span>Barangay</span>
                    <select
                      value={editHouseholdForm.barangay_id}
                      onChange={(e) =>
                        setEditHouseholdForm((prev) => ({
                          ...prev,
                          barangay_id: e.target.value,
                        }))
                      }
                    >
                      <option value="">Select barangay</option>
                      {barangays.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="fm-field">
                  <span>Complete Household Address</span>
                  <input
                    type="text"
                    value={editHouseholdForm.address}
                    onChange={(e) =>
                      setEditHouseholdForm((prev) => ({
                        ...prev,
                        address: e.target.value,
                      }))
                    }
                    placeholder="Purok / Street / Sitio"
                  />
                </label>

                <div className="fm-form-grid-2">
                  <label className="fm-field">
                    <span>Contact Number</span>
                    <input
                      type="text"
                      value={editHouseholdForm.contact_number}
                      onChange={(e) =>
                        setEditHouseholdForm((prev) => ({
                          ...prev,
                          contact_number: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="fm-field">
                    <span>Alternate Contact</span>
                    <input
                      type="text"
                      value={editHouseholdForm.alternate_contact}
                      onChange={(e) =>
                        setEditHouseholdForm((prev) => ({
                          ...prev,
                          alternate_contact: e.target.value,
                        }))
                      }
                    />
                  </label>
                </div>

                <label className="fm-field">
                  <span>Household Remarks</span>
                  <textarea
                    rows={3}
                    value={editHouseholdForm.remarks}
                    onChange={(e) =>
                      setEditHouseholdForm((prev) => ({
                        ...prev,
                        remarks: e.target.value,
                      }))
                    }
                  />
                </label>

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
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </form>
            )}

            {/* MODAL: ADD / EDIT MEMBER */}
            {modal === "member-form" && (
              <form onSubmit={submitMemberModal} className="fm-modal-body">
                {memberModalMode === "edit" && (
                  <label className="fm-check-pill" style={{ marginBottom: "0.75rem" }}>
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
                            ? "Household Head"
                            : prev.relationship_to_head === "Household Head"
                              ? "Spouse"
                              : prev.relationship_to_head,
                        }))
                      }
                    />
                    <span>
                      {activeFamily?.members?.find(
                        (m) => Number(m.id) === Number(memberModalTargetId)
                      )?.is_head_of_family
                        ? "Current Household Head"
                        : "Set this resident as the Household Head"}
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
                  Boolean(memberModalForm.is_head_of_family)
                )}
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
                    {saving
                      ? "Saving..."
                      : memberModalMode === "add"
                        ? "Add Member"
                        : "Save Member"}
                  </button>
                </div>
              </form>
            )}

            {/* MODAL: ASSIGN ROOM */}
            {modal === "assign" && activeFamily && (
              <form onSubmit={submitAssignment} className="fm-modal-body">
                <div className="fm-capacity-summary">
                  <div>
                    <span>Household Head</span>
                    <strong>{activeFamily.head_name}</strong>
                  </div>
                  <div>
                    <span>Members Requiring Space</span>
                    <strong>{assignFamilyMembers}</strong>
                  </div>
                </div>

                <div className="fm-form-grid-2">
                  <label className="fm-field">
                    <span>
                      Evacuation Center <strong className="fm-req">*</strong>
                    </span>
                    <select
                      value={assignCenterId}
                      onChange={(e) => {
                        setAssignCenterId(e.target.value);
                        setAssignRoomId("");
                      }}
                      required
                    >
                      <option value="">Select evacuation center</option>
                      {centersList.map((c) => (
                        <option key={c.id} value={c.id}>
                          {displayEntityName(c.name)} ({(c.barangays || []).map((barangay) => barangay.name).join(", ")})
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="fm-field">
                    <span>
                      Room <strong className="fm-req">*</strong>
                    </span>
                    <select
                      value={assignRoomId}
                      disabled={!assignCenterId || assignRoomsQuery.isLoading}
                      onChange={(e) => setAssignRoomId(e.target.value)}
                      required
                    >
                      <option value="">
                        {!assignCenterId
                          ? "Select a center first"
                          : assignRoomsQuery.isLoading
                            ? "Loading rooms..."
                            : "Select room"}
                      </option>
                      {assignRooms.map((r) => {
                        const avail =
                          r.available ??
                          Math.max(r.capacity - (r.occupied || 0), 0);
                        return (
                          <option
                            key={r.id}
                            value={r.id}
                            disabled={avail < assignFamilyMembers}
                          >
                            Room {r.room_number} ({avail} available /{" "}
                            {r.capacity} cap)
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
                      <span>Room Capacity</span>
                      <strong>{selectedAssignRoom.capacity}</strong>
                    </div>
                    <div>
                      <span>Currently Assigned</span>
                      <strong>{selectedAssignRoom.occupied || 0}</strong>
                    </div>
                    <div>
                      <span>Remaining Capacity</span>
                      <strong>{assignRoomAvailable}</strong>
                    </div>
                  </div>
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
                      !assignRoomId ||
                      !assignHasCapacity
                    }
                  >
                    {assigning ? "Assigning..." : "Confirm Assignment"}
                  </button>
                </div>
              </form>
            )}

            {/* MODAL: MOVE / CHANGE ROOM */}
            {modal === "move" && activeFamily && (
              <form onSubmit={handleMoveSubmit} className="fm-modal-body">
                <div className="fm-capacity-summary">
                  <div>
                    <span>Current Location</span>
                    <strong>
                      {displayEntityName(
                        activeFamily.current_center ||
                          activeFamily.evacuation_center
                      )}{" "}
                      — Room {activeFamily.current_room || activeFamily.rooms}
                    </strong>
                  </div>
                  <div>
                    <span>Members Moving</span>
                    <strong>{moveFamilyMembers}</strong>
                  </div>
                </div>

                <div className="fm-form-grid-2">
                  <label className="fm-field">
                    <span>
                      Destination Center <strong className="fm-req">*</strong>
                    </span>
                    <select
                      value={targetCenterId}
                      onChange={(e) => {
                        setTargetCenterId(e.target.value);
                        setTargetRoomId("");
                      }}
                      required
                    >
                      <option value="">Select destination center</option>
                      {centersList.map((c) => (
                        <option key={c.id} value={c.id}>
                          {displayEntityName(c.name)} ({(c.barangays || []).map((barangay) => barangay.name).join(", ")})
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="fm-field">
                    <span>
                      Destination Room <strong className="fm-req">*</strong>
                    </span>
                    <select
                      value={targetRoomId}
                      disabled={!targetCenterId || targetRoomsQuery.isLoading}
                      onChange={(e) => setTargetRoomId(e.target.value)}
                      required
                    >
                      <option value="">
                        {!targetCenterId
                          ? "Select a center first"
                          : targetRoomsQuery.isLoading
                            ? "Loading rooms..."
                            : "Select destination room"}
                      </option>
                      {targetRooms.map((r) => {
                        const avail =
                          r.available ??
                          Math.max(r.capacity - (r.occupied || 0), 0);
                        return (
                          <option
                            key={r.id}
                            value={r.id}
                            disabled={avail < moveFamilyMembers}
                          >
                            Room {r.room_number} ({avail} available /{" "}
                            {r.capacity} cap)
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
                      <span>Target Room Capacity</span>
                      <strong>{selectedTargetRoom.capacity}</strong>
                    </div>
                    <div>
                      <span>Currently Assigned</span>
                      <strong>{selectedTargetRoom.occupied || 0}</strong>
                    </div>
                    <div>
                      <span>Remaining Capacity</span>
                      <strong>{targetRoomAvailable}</strong>
                    </div>
                  </div>
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
                      !targetRoomId ||
                      !moveHasCapacity
                    }
                  >
                    {moving ? "Transferring..." : "Review Transfer"}
                  </button>
                </div>
              </form>
            )}

            {/* MODAL: IMPORT EXCEL */}
            {modal === "import" && (
              <div className="fm-modal-body">
                <div className="fm-import-top">
                  <input
                    type="file"
                    accept=".xlsx"
                    onChange={(e) => {
                      setImportFile(e.target.files?.[0] || null);
                      setImportPreview(null);
                    }}
                  />
                  <div className="fm-inline-actions">
                    <button
                      type="button"
                      className="fm-btn fm-btn-secondary"
                      onClick={downloadTemplate}
                    >
                      <FontAwesomeIcon icon={faDownload} /> Template
                    </button>
                    <button
                      type="button"
                      className="fm-btn fm-btn-primary"
                      disabled={!importFile || importBusy}
                      onClick={previewImport}
                    >
                      {importBusy ? "Checking..." : "Validate File"}
                    </button>
                  </div>
                </div>

                {importPreview && (
                  <div className="fm-import-results">
                    <div className="fm-capacity-summary">
                      <div>
                        <span>Rows Read</span>
                        <strong>{importPreview.rows}</strong>
                      </div>
                      <div>
                        <span>Valid Households</span>
                        <strong>{importPreview.families.length}</strong>
                      </div>
                      <div>
                        <span>Errors</span>
                        <strong>{importPreview.errors.length}</strong>
                      </div>
                    </div>

                    {importPreview.errors.length > 0 && (
                      <div className="fm-import-errors">
                        {importPreview.errors.map((err, idx) => (
                          <p key={idx}>
                            <strong>Row {err.row}:</strong> {err.message}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="fm-modal-footer">
                  <button
                    type="button"
                    className="fm-btn fm-btn-secondary"
                    onClick={closeModal}
                    disabled={importBusy}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="fm-btn fm-btn-primary"
                    disabled={!importPreview?.can_import || importBusy}
                    onClick={commitImport}
                  >
                    {importBusy ? "Importing..." : "Commit Import"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      {confirmDialog && (
        <div
          className="fm-modal-backdrop"
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
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={`fm-btn ${confirmDialog.danger ? "fm-btn-danger" : "fm-btn-primary"}`}
                  onClick={confirmDialog.onConfirm}
                >
                  {confirmDialog.confirmText || "Confirm"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBuilding,
  faCheckCircle,
  faDoorOpen,
  faDownload,
  faEye,
  faFileExcel,
  faMagnifyingGlass,
  faPenToSquare,
  faPlus,
  faRightLeft,
  faRotate,
  faTrashCan,
  faTriangleExclamation,
  faUserMinus,
  faUsers,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../services/api";
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

export default function FamilyManagement({ barangays = [] }) {
  const [families, setFamilies] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [barangayId, setBarangayId] = useState("");
  const [assignmentStatus, setAssignmentStatus] = useState("");
  const [sortBy, setSortBy] = useState("family_code");
  const [direction, setDirection] = useState("asc");
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Modals
  const [modal, setModal] = useState(""); // "add" | "import" | "detail" | "edit" | "assign" | "move"
  const [selectedFamily, setSelectedFamily] = useState(null);
  const [familyDetail, setFamilyDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Forms
  const [form, setForm] = useState({
    family_code: "",
    head_name: "",
    barangay_id: "",
    contact_number: "",
    address: "",
    members: [],
  });
  const [editForm, setEditForm] = useState({
    head_name: "",
    barangay_id: "",
    contact_number: "",
    address: "",
  });
  const [saving, setSaving] = useState(false);

  // Import
  const [importFile, setImportFile] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const [importBusy, setImportBusy] = useState(false);

  // Evacuation Centers & Rooms for Assign/Move
  const [centersList, setCentersList] = useState([]);
  const [loadingCenters, setLoadingCenters] = useState(false);

  // Assign state
  const [assignCenterId, setAssignCenterId] = useState("");
  const [assignRoomId, setAssignRoomId] = useState("");
  const [assignRooms, setAssignRooms] = useState([]);
  const [loadingAssignRooms, setLoadingAssignRooms] = useState(false);
  const [assigning, setAssigning] = useState(false);

  // Move state
  const [targetCenterId, setTargetCenterId] = useState("");
  const [targetRoomId, setTargetRoomId] = useState("");
  const [targetRooms, setTargetRooms] = useState([]);
  const [loadingTargetRooms, setLoadingTargetRooms] = useState(false);
  const [moving, setMoving] = useState(false);

  // Reusable confirmation dialog
  const [confirmDialog, setConfirmDialog] = useState(null); // { title, message, confirmText, danger, onConfirm }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    const filters = {
      page,
      per_page: 20,
      search,
      barangay_id: barangayId,
      assignment_status: assignmentStatus,
      sort_by: sortBy,
      direction,
    };

    api.getFamilies(filters)
      .then((result) => {
        if (cancelled) return;
        setFamilies(result.items || []);
        setTotal(result.total || 0);
        setPages(Math.max(1, result.pages || 1));
        setError("");
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError.message || "Families could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [page, search, barangayId, assignmentStatus, sortBy, direction, refreshKey]);

  function closeModal() {
    if (saving || importBusy || assigning || moving) return;
    setModal("");
    setError("");
    setNotice("");
    setImportPreview(null);
    setImportFile(null);
    setAssignCenterId("");
    setAssignRoomId("");
    setAssignRooms([]);
    setTargetCenterId("");
    setTargetRoomId("");
    setTargetRooms([]);
  }

  async function loadActiveCenters() {
    setLoadingCenters(true);
    try {
      const res = await api.getEvacuationCenters({ status: "active" });
      const list = (res.features || []).map((f) => f.properties || f);
      setCentersList(list);
      return list;
    } catch (err) {
      console.error("Failed to load evacuation centers:", err);
      return [];
    } finally {
      setLoadingCenters(false);
    }
  }

  function openAddFamily() {
    setForm({ family_code: "", head_name: "", barangay_id: barangayId || "", contact_number: "", address: "", members: [] });
    setError("");
    setNotice("");
    setModal("add");
  }

  async function openFamily(item) {
    setSelectedFamily(item);
    setFamilyDetail(item);
    setDetailLoading(true);
    setError("");
    setModal("detail");
    try {
      const detail = await api.getFamily(item.id);
      setFamilyDetail((prev) => ({ ...(prev || item), ...detail }));
      setSelectedFamily((prev) => ({ ...(prev || item), ...detail }));
    } catch (requestError) {
      console.error("Family details could not be loaded:", requestError);
      setError(requestError.message || "Family details could not be loaded.");
    } finally {
      setDetailLoading(false);
    }
  }

  function openEditFamily(fam) {
    const target = fam || familyDetail || selectedFamily;
    if (!target) return;
    setEditForm({
      head_name: target.head_name || "",
      barangay_id: target.barangay_id ? String(target.barangay_id) : "",
      contact_number: target.contact_number || "",
      address: target.address || "",
    });
    setError("");
    setModal("edit");
  }

  async function submitEditFamily(event) {
    event.preventDefault();
    if (!editForm.head_name.trim()) {
      setError("Head of family is required.");
      return;
    }
    const target = familyDetail || selectedFamily;
    setSaving(true);
    setError("");
    try {
      const payload = {
        head_name: editForm.head_name.trim(),
        barangay_id: editForm.barangay_id ? Number(editForm.barangay_id) : undefined,
        contact_number: editForm.contact_number.trim() || null,
        address: editForm.address.trim() || null,
      };
      const result = await api.updateFamily(target.id, payload);
      setNotice(result.message || "Family details updated.");
      setModal("detail");
      const updated = await api.getFamily(target.id);
      setFamilyDetail(updated);
      setSelectedFamily(updated);
      setRefreshKey((v) => v + 1);
    } catch (requestError) {
      setError(requestError.message || "Failed to update family details.");
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(fam) {
    const target = fam || familyDetail || selectedFamily;
    if (!target) return;

    if (target.current_room_id || (target.assigned_members && target.assigned_members > 0)) {
      setError("Cannot delete family with active room assignment. Please unassign or move the family first.");
      return;
    }

    setConfirmDialog({
      title: "Delete Family Record",
      message: `Are you sure you want to delete family "${target.head_name}" (${target.family_code || "#" + target.id})? This will permanently delete the family and all registered members.`,
      confirmText: "Delete Family",
      danger: true,
      onConfirm: async () => {
        try {
          const res = await api.deleteFamily(target.id);
          setNotice(res.message || `Family "${target.head_name}" deleted.`);
          setConfirmDialog(null);
          if (modal === "detail") setModal("");
          setRefreshKey((v) => v + 1);
        } catch (err) {
          setError(err.message || "Failed to delete family.");
        }
      },
    });
  }

  // --- Assign Modal Handlers ---
  async function openAssignModal(fam) {
    const target = fam || familyDetail || selectedFamily;
    if (!target) return;
    setAssignCenterId("");
    setAssignRoomId("");
    setAssignRooms([]);
    setError("");
    setModal("assign");

    const centers = await loadActiveCenters();
    if (target.barangay_id) {
      const matching = centers.find((c) => Number(c.barangay_id) === Number(target.barangay_id));
      if (matching) {
        setAssignCenterId(String(matching.id));
        loadRoomsForAssign(matching.id);
      }
    }
  }

  async function handleAssignCenterChange(centerId) {
    setAssignCenterId(centerId);
    setAssignRoomId("");
    loadRoomsForAssign(centerId);
  }

  async function loadRoomsForAssign(centerId) {
    if (!centerId) {
      setAssignRooms([]);
      setAssignRoomId("");
      return;
    }
    setLoadingAssignRooms(true);
    try {
      const data = await api.getRooms(centerId);
      const list = (Array.isArray(data) ? data : data?.rooms || []).filter((r) => r.is_active !== false);
      setAssignRooms(list);
    } catch (err) {
      console.error("Failed to load rooms:", err);
      setError(err.message || "Failed to load rooms for selected center.");
    } finally {
      setLoadingAssignRooms(false);
    }
  }

  async function submitAssignment(event) {
    event.preventDefault();
    if (!assignCenterId || !assignRoomId) {
      setError("Please select both an evacuation center and a room.");
      return;
    }
    const target = familyDetail || selectedFamily;
    const room = assignRooms.find((r) => String(r.id) === String(assignRoomId));
    if (!room) return;

    const needed = target.member_count || target.resident_count || 1;
    const available = room.available ?? Math.max(room.capacity - (room.occupied || 0), 0);
    if (needed > available) {
      setError(`Cannot assign: Family has ${needed} members, but room only has ${available} spaces available.`);
      return;
    }

    setAssigning(true);
    setError("");
    try {
      const result = await api.assignFamily(target.id, {
        center_id: Number(assignCenterId),
        room_id: Number(assignRoomId),
      });
      setNotice(result.message || `Family assigned to Room ${room.room_number}.`);
      setModal("detail");
      const updated = await api.getFamily(target.id);
      setFamilyDetail(updated);
      setSelectedFamily(updated);
      setRefreshKey((v) => v + 1);
    } catch (requestError) {
      setError(requestError.message || "Failed to assign family.");
    } finally {
      setAssigning(false);
    }
  }

  // --- Move Modal Handlers ---
  async function openMoveModal(fam) {
    const target = fam || familyDetail || selectedFamily;
    if (!target) return;
    const initialCenterId = target.current_center_id
      ? String(target.current_center_id)
      : (target.assignments?.[0]?.center_id ? String(target.assignments[0].center_id) : "");
    const curRoomId = target.current_room_id || target.assignments?.[0]?.room_id;
    setTargetCenterId(initialCenterId);
    setTargetRoomId("");
    setTargetRooms([]);
    setError("");
    setModal("move");

    await loadActiveCenters();
    if (initialCenterId) {
      loadRoomsForTarget(initialCenterId, curRoomId);
    }
  }

  async function handleTargetCenterChange(centerId) {
    setTargetCenterId(centerId);
    setTargetRoomId("");
    const target = familyDetail || selectedFamily;
    const currentRoomId = target?.current_room_id || target?.assignments?.[0]?.room_id;
    loadRoomsForTarget(centerId, currentRoomId);
  }

  async function loadRoomsForTarget(centerId, currentRoomId) {
    if (!centerId) {
      setTargetRooms([]);
      setTargetRoomId("");
      return;
    }
    setLoadingTargetRooms(true);
    try {
      const data = await api.getRooms(centerId);
      const list = (Array.isArray(data) ? data : data?.rooms || [])
        .filter((r) => r.is_active !== false)
        .filter((r) => !currentRoomId || String(r.id) !== String(currentRoomId));
      setTargetRooms(list);
    } catch (err) {
      console.error("Failed to load target rooms:", err);
      setError(err.message || "Failed to load target rooms.");
    } finally {
      setLoadingTargetRooms(false);
    }
  }

  function handleMoveSubmit(event) {
    event.preventDefault();
    if (!targetCenterId || !targetRoomId) {
      setError("Please select a destination evacuation center and room.");
      return;
    }
    const target = familyDetail || selectedFamily;
    const destRoom = targetRooms.find((r) => String(r.id) === String(targetRoomId));
    const destCenter = centersList.find((c) => String(c.id) === String(targetCenterId));
    if (!destRoom) return;

    const needed = target.member_count || target.resident_count || 1;
    const available = destRoom.available ?? Math.max(destRoom.capacity - (destRoom.occupied || 0), 0);
    if (needed > available) {
      setError(`Cannot move: Family needs ${needed} spaces, but target room only has ${available} spaces available.`);
      return;
    }

    setConfirmDialog({
      title: "Confirm Family Transfer",
      message: `Move family "${target.head_name}" (${needed} members) to ${destCenter ? destCenter.name + " - " : ""}Room ${destRoom.room_number}? Occupancy in both rooms will update automatically.`,
      confirmText: "Move Family",
      danger: false,
      onConfirm: async () => {
        setMoving(true);
        setError("");
        try {
          const res = await api.moveFamily(target.id, {
            center_id: Number(targetCenterId),
            room_id: Number(targetRoomId),
          });
          setNotice(res.message || `Family moved to Room ${destRoom.room_number}.`);
          setConfirmDialog(null);
          setModal("detail");
          const updated = await api.getFamily(target.id);
          setFamilyDetail(updated);
          setSelectedFamily(updated);
          setRefreshKey((v) => v + 1);
        } catch (err) {
          setError(err.message || "Failed to move family.");
        } finally {
          setMoving(false);
        }
      },
    });
  }

  // --- Unassign Handler ---
  function confirmUnassign(fam) {
    const target = fam || familyDetail || selectedFamily;
    if (!target) return;
    const memberCount = target.member_count || target.resident_count || 1;
    const currentCenter = target.current_center || target.evacuation_center || "the center";
    const currentRoom = target.current_room || target.rooms || "the room";

    setConfirmDialog({
      title: "Remove Family Assignment",
      message: `Are you sure you want to unassign family "${target.head_name}" (${memberCount} members) from ${currentCenter} - Room ${currentRoom}? This will free ${memberCount} spaces in the room and update their status to Not Evacuated.`,
      confirmText: "Unassign Family",
      danger: true,
      onConfirm: async () => {
        try {
          const res = await api.unassignFamily(target.id);
          setNotice(res.message || `Family "${target.head_name}" unassigned successfully.`);
          setConfirmDialog(null);
          if (modal === "detail" && familyDetail?.id === target.id) {
            const updated = await api.getFamily(target.id);
            setFamilyDetail(updated);
            setSelectedFamily(updated);
          }
          setRefreshKey((v) => v + 1);
        } catch (err) {
          setError(err.message || "Failed to unassign family.");
        }
      },
    });
  }

  // --- Existing Add / Import / Export Handlers ---
  async function submitFamily(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        ...form,
        barangay_id: Number(form.barangay_id),
        members: form.members.filter((member) => member.full_name.trim()).map((member) => ({ full_name: member.full_name.trim() })),
      };
      const result = await api.addFamily(payload);
      setNotice(result.message || "Family registered.");
      setModal("");
      setRefreshKey((value) => value + 1);
    } catch (requestError) {
      setError(requestError.message || "Family could not be registered.");
    } finally {
      setSaving(false);
    }
  }

  async function downloadTemplate() {
    setError("");
    try {
      saveBlob(await api.downloadFamilyTemplate(), "evacway-family-template.xlsx");
    } catch (requestError) {
      setError(requestError.message || "The Excel template could not be downloaded.");
    }
  }

  async function exportFamilies() {
    setError("");
    try {
      const filters = { search, barangay_id: barangayId, assignment_status: assignmentStatus };
      saveBlob(await api.exportFamilies(filters), "evacway-families.csv");
    } catch (requestError) {
      setError(requestError.message || "The filtered family list could not be exported.");
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
      setNotice(result.message || `Imported ${result.successful_families} families.`);
      setModal("");
      setImportPreview(null);
      setImportFile(null);
      setRefreshKey((value) => value + 1);
    } catch (requestError) {
      setError(requestError.message || "The import failed. No records were committed.");
    } finally {
      setImportBusy(false);
    }
  }

  // Active room selection metrics for Assign modal
  const selectedAssignRoom = assignRooms.find((r) => String(r.id) === String(assignRoomId));
  const assignFamilyMembers = (familyDetail || selectedFamily)?.member_count || (familyDetail || selectedFamily)?.resident_count || 1;
  const assignRoomAvailable = selectedAssignRoom?.available ?? (selectedAssignRoom ? Math.max(selectedAssignRoom.capacity - (selectedAssignRoom.occupied || 0), 0) : 0);
  const assignHasCapacity = selectedAssignRoom ? assignRoomAvailable >= assignFamilyMembers : false;

  // Target room selection metrics for Move modal
  const selectedTargetRoom = targetRooms.find((r) => String(r.id) === String(targetRoomId));
  const moveFamilyMembers = (familyDetail || selectedFamily)?.member_count || (familyDetail || selectedFamily)?.resident_count || 1;
  const targetRoomAvailable = selectedTargetRoom?.available ?? (selectedTargetRoom ? Math.max(selectedTargetRoom.capacity - (selectedTargetRoom.occupied || 0), 0) : 0);
  const moveHasCapacity = selectedTargetRoom ? targetRoomAvailable >= moveFamilyMembers : false;

  return (
    <section className="family-manager" aria-labelledby="family-manager-title">
      <header className="family-manager-header">
        <div>
          <p className="family-manager-kicker">Barangay records</p>
          <h2 id="family-manager-title">Families</h2>
          <p>Registered households and their current evacuation assignments.</p>
        </div>
        <div className="family-manager-actions">
          <button type="button" className="fm-button fm-button-quiet" onClick={downloadTemplate}>
            <FontAwesomeIcon icon={faDownload} /> Template
          </button>
          <button type="button" className="fm-button fm-button-quiet" onClick={() => { setImportFile(null); setImportPreview(null); setError(""); setModal("import"); }}>
            <FontAwesomeIcon icon={faFileExcel} /> Import Excel
          </button>
          <button type="button" className="fm-button fm-button-quiet" onClick={exportFamilies}>
            <FontAwesomeIcon icon={faDownload} /> Export CSV
          </button>
          <button type="button" className="fm-button fm-button-primary" onClick={openAddFamily}>
            <FontAwesomeIcon icon={faPlus} /> Add Family
          </button>
        </div>
      </header>

      {notice && <p className="fm-notice" role="status">{notice}</p>}
      {error && !modal && <p className="fm-error" role="alert">{error}</p>}

      <div className="family-manager-filters">
        <label className="fm-search">
          <FontAwesomeIcon icon={faMagnifyingGlass} />
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search code, head, address, or contact"
            aria-label="Search families"
          />
          {searchInput && (
            <button
              type="button"
              className="fm-search-clear"
              onClick={() => setSearchInput("")}
              aria-label="Clear search"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          )}
        </label>
        <select aria-label="Filter by barangay" value={barangayId} onChange={(event) => { setBarangayId(event.target.value); setPage(1); }}>
          <option value="">All barangays</option>
          {barangays.map((barangay) => (
            <option key={barangay.id} value={barangay.id}>
              {displayEntityName(barangay.name, `Barangay ${barangay.id}`)}
            </option>
          ))}
        </select>
        <select aria-label="Filter by assignment" value={assignmentStatus} onChange={(event) => { setAssignmentStatus(event.target.value); setPage(1); }}>
          <option value="">All assignment statuses</option>
          <option value="assigned">Assigned</option>
          <option value="unassigned">Not assigned</option>
        </select>
        <select aria-label="Sort families" value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
          <option value="family_code">Sort: Family code</option>
          <option value="head_name">Sort: Head of family</option>
          <option value="barangay">Sort: Barangay</option>
          <option value="member_count">Sort: Members</option>
          <option value="created_at">Sort: Date registered</option>
          <option value="evacuation_status">Sort: Status</option>
        </select>
        <button
          type="button"
          className="fm-sort-direction"
          onClick={() => setDirection((value) => (value === "asc" ? "desc" : "asc"))}
          aria-label={`Sort ${direction === "asc" ? "descending" : "ascending"}`}
          title={`Sort ${direction === "asc" ? "descending" : "ascending"}`}
        >
          {direction === "asc" ? "A–Z" : "Z–A"}
        </button>
      </div>

      <div className="fm-table-wrap">
        <table className="fm-table">
          <thead>
            <tr>
              <th>Family / Household ID</th>
              <th>Head of family</th>
              <th>Members</th>
              <th>Barangay</th>
              <th>Contact</th>
              <th>Evacuation center / room</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="8" style={{ padding: "32px 16px" }}>
                  <LoadingState message="Loading family records..." />
                </td>
              </tr>
            ) : error && families.length === 0 ? (
              <tr><td colSpan="8" className="fm-empty fm-error-text">{error}</td></tr>
            ) : families.length === 0 ? (
              <tr><td colSpan="8" className="fm-empty">No registered families match these filters.</td></tr>
            ) : (
              families.map((family) => {
                const isAssigned = Boolean(
                  (family.assigned_members && family.assigned_members > 0) ||
                  family.current_room_id ||
                  (Array.isArray(family.assignments) && family.assignments.length > 0) ||
                  family.current_room ||
                  family.current_center ||
                  family.evacuation_center ||
                  family.rooms ||
                  (family.evacuation_status && family.evacuation_status.toLowerCase().includes("assigned"))
                );
                const statusText = isAssigned
                  ? ((family.evacuation_status && family.evacuation_status.toLowerCase().includes("evacuated")) ? family.evacuation_status : "Assigned")
                  : (family.evacuation_status && !family.evacuation_status.toLowerCase().includes("not assigned") ? family.evacuation_status : "Not Assigned");
                return (
                  <tr key={family.id}>
                    <td>
                      <button type="button" className="fm-family-code" onClick={() => openFamily(family)}>
                        {family.family_code || `#${family.id}`}
                      </button>
                    </td>
                    <td>{displayEntityName(family.head_name, "Unnamed family")}</td>
                    <td>{family.member_count ?? family.resident_count ?? 0}</td>
                    <td>{displayEntityName(family.barangay, "—")}</td>
                    <td>{family.contact_number || "—"}</td>
                    <td>
                      {[family.current_center || family.evacuation_center || (family.assignments?.[0]?.center), family.current_room ? `Room ${family.current_room}` : (family.rooms || (family.assignments?.[0]?.room ? `Room ${family.assignments[0].room}` : null))]
                        .filter(Boolean)
                        .join(" · ") || "Not assigned"}
                    </td>
                    <td>
                      <span className={`fm-status ${isAssigned ? "is-assigned" : ""}`}>
                        {statusText}
                      </span>
                    </td>
                    <td>
                      <div className="fm-table-actions">
                        <button
                          type="button"
                          className="fm-icon-button"
                          aria-label={`View ${family.family_code}`}
                          title="View family details & assignment"
                          onClick={() => openFamily(family)}
                        >
                          <FontAwesomeIcon icon={faEye} />
                        </button>
                        <button
                          type="button"
                          className="fm-icon-button"
                          aria-label={`Edit ${family.family_code}`}
                          title="Edit family details"
                          onClick={() => { setSelectedFamily(family); openEditFamily(family); }}
                        >
                          <FontAwesomeIcon icon={faPenToSquare} />
                        </button>
                        <button
                          type="button"
                          className="fm-icon-button fm-btn-danger"
                          aria-label={`Delete ${family.family_code}`}
                          title="Delete family record"
                          onClick={() => confirmDelete(family)}
                        >
                          <FontAwesomeIcon icon={faTrashCan} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <footer className="family-manager-pagination">
        <span>{total === 0 ? "0 families" : `${(page - 1) * 20 + 1}–${Math.min(page * 20, total)} of ${total} families`}</span>
        <div>
          <button type="button" className="fm-button fm-button-quiet" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>
            Previous
          </button>
          <span>Page {page} of {pages}</span>
          <button type="button" className="fm-button fm-button-quiet" disabled={page >= pages || loading} onClick={() => setPage((value) => value + 1)}>
            Next
          </button>
          <button type="button" className="fm-icon-button" onClick={() => setRefreshKey((value) => value + 1)} aria-label="Refresh families" title="Refresh">
            <FontAwesomeIcon icon={faRotate} />
          </button>
        </div>
      </footer>

      {/* MODAL: ADD FAMILY */}
      {modal === "add" && (
        <div className="fm-overlay" onMouseDown={(event) => event.target === event.currentTarget && closeModal()}>
          <form className="fm-modal" onSubmit={submitFamily}>
            <header className="fm-modal-header">
              <div><p>Family registration</p><h3>Add Family</h3></div>
              <button type="button" className="fm-icon-button" onClick={closeModal} aria-label="Close"><FontAwesomeIcon icon={faXmark} /></button>
            </header>
            {error && <p className="fm-error" role="alert">{error}</p>}
            <div className="fm-modal-body">
              <label>Family code <span>Optional; generated if blank</span><input value={form.family_code} maxLength={100} onChange={(event) => setForm({ ...form, family_code: event.target.value })} placeholder="Auto-generated" /></label>
              <label>Head of family<input required maxLength={150} value={form.head_name} onChange={(event) => setForm({ ...form, head_name: event.target.value })} /></label>
              <label>Barangay<select required value={form.barangay_id} onChange={(event) => setForm({ ...form, barangay_id: event.target.value })}><option value="">Select barangay</option>{barangays.map((barangay) => <option key={barangay.id} value={barangay.id}>{displayEntityName(barangay.name, `Barangay ${barangay.id}`)}</option>)}</select></label>
              <label>Contact number<input maxLength={20} value={form.contact_number} onChange={(event) => setForm({ ...form, contact_number: event.target.value })} /></label>
              <label>Address / purok<input maxLength={255} value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></label>
              <div className="fm-member-editor">
                <div className="fm-member-editor-head">
                  <strong>Additional family members</strong>
                  <button type="button" className="fm-text-button" onClick={() => setForm({ ...form, members: [...form.members, { full_name: "" }] })}>
                    <FontAwesomeIcon icon={faPlus} /> Add member
                  </button>
                </div>
                {form.members.map((member, index) => (
                  <div className="fm-member-row" key={index}>
                    <input aria-label={`Additional member ${index + 1} full name`} placeholder="Full name" value={member.full_name} onChange={(event) => setForm({ ...form, members: form.members.map((item, itemIndex) => itemIndex === index ? { ...item, full_name: event.target.value } : item) })} />
                    <button type="button" className="fm-icon-button" aria-label={`Remove member ${index + 1}`} onClick={() => setForm({ ...form, members: form.members.filter((_, itemIndex) => itemIndex !== index) })}><FontAwesomeIcon icon={faXmark} /></button>
                  </div>
                ))}
                <small>The household head is saved as a resident automatically.</small>
              </div>
            </div>
            <footer className="fm-modal-actions">
              <button type="button" className="fm-button fm-button-quiet" onClick={closeModal} disabled={saving}>Cancel</button>
              <button type="submit" className="fm-button fm-button-primary" disabled={saving}>{saving ? "Saving…" : "Register family"}</button>
            </footer>
          </form>
        </div>
      )}

      {/* MODAL: IMPORT EXCEL */}
      {modal === "import" && (
        <div className="fm-overlay" onMouseDown={(event) => event.target === event.currentTarget && closeModal()}>
          <section className="fm-modal fm-import-modal" role="dialog" aria-modal="true" aria-labelledby="fm-import-title">
            <header className="fm-modal-header">
              <div><p>Bulk registration</p><h3 id="fm-import-title">Import families</h3></div>
              <button type="button" className="fm-icon-button" onClick={closeModal} aria-label="Close"><FontAwesomeIcon icon={faXmark} /></button>
            </header>
            {error && <p className="fm-error" role="alert">{error}</p>}
            <div className="fm-modal-body">
              <p className="fm-import-help">Use the template. Include one row per family member and repeat each family’s code, head, and barangay on every row. The household head must also appear as a member.</p>
              <button type="button" className="fm-button fm-button-quiet" onClick={downloadTemplate}><FontAwesomeIcon icon={faDownload} /> Download Excel Template</button>
              <label className="fm-file-field">Excel workbook (.xlsx)<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { setImportFile(event.target.files?.[0] || null); setImportPreview(null); }} /></label>
              <button type="button" className="fm-button fm-button-primary" disabled={!importFile || importBusy} onClick={previewImport}>{importBusy ? "Checking workbook…" : "Preview import"}</button>
              {importPreview && (
                <div className="fm-import-preview">
                  <strong>{importPreview.families.length} family groups · {importPreview.rows} member rows</strong>
                  {importPreview.errors.length > 0 ? (
                    <ul className="fm-import-errors">{importPreview.errors.map((item, index) => <li key={`${item.row}-${index}`}>Row {item.row}: {item.message}</li>)}</ul>
                  ) : (
                    <div className="fm-preview-list">
                      {importPreview.families.map((family) => (
                        <div key={family.family_code}>
                          <strong>{displayEntityName(family.family_code)}</strong>
                          <span>{displayEntityName(family.head_name)} · {displayEntityName(family.barangay)} · {family.member_count} members</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <footer className="fm-modal-actions">
              <button type="button" className="fm-button fm-button-quiet" onClick={closeModal} disabled={importBusy}>Cancel</button>
              <button type="button" className="fm-button fm-button-primary" disabled={!importPreview?.can_import || importBusy} onClick={commitImport}>
                {importBusy ? "Importing…" : `Import ${importPreview?.families.length || 0} families`}
              </button>
            </footer>
          </section>
        </div>
      )}

      {/* MODAL: FAMILY DETAILS (Navigation Flow 2: Families -> Family Details -> Evacuation Assignment) */}
      {modal === "detail" && (selectedFamily || familyDetail) && (
        <div className="fm-overlay" onMouseDown={(event) => event.target === event.currentTarget && closeModal()}>
          <section className="fm-modal fm-detail-modal" role="dialog" aria-modal="true" aria-labelledby="fm-detail-title">
            <header className="fm-modal-header">
              <div>
                <p>{familyDetail?.family_code || selectedFamily.family_code}</p>
                <h3 id="fm-detail-title">{familyDetail?.head_name || selectedFamily.head_name}</h3>
              </div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <button
                  type="button"
                  className="fm-button fm-button-quiet fm-button-sm"
                  title="Edit family information"
                  onClick={() => openEditFamily(familyDetail || selectedFamily)}
                >
                  <FontAwesomeIcon icon={faPenToSquare} /> Edit
                </button>
                <button
                  type="button"
                  className="fm-button fm-button-danger fm-button-sm"
                  title="Delete family record"
                  onClick={() => confirmDelete(familyDetail || selectedFamily)}
                >
                  <FontAwesomeIcon icon={faTrashCan} /> Delete
                </button>
                <button type="button" className="fm-icon-button" onClick={closeModal} aria-label="Close">
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              </div>
            </header>

            <div className="fm-modal-body">
              {notice && <p className="fm-notice" role="status">{notice}</p>}
              {error && <p className="fm-error" role="alert">{error}</p>}

              {detailLoading ? (
                <div style={{ padding: "32px 16px" }}>
                  <LoadingState message="Loading family details…" />
                </div>
              ) : (
                <>
                  {/* Household Information */}
                  <div className="fm-meta-details">
                    <div><span>Head of Family</span><strong>{familyDetail?.head_name || selectedFamily.head_name}</strong></div>
                    <div><span>Barangay</span><strong>{displayEntityName(familyDetail?.barangay ?? selectedFamily.barangay, "Not recorded")}</strong></div>
                    <div><span>Contact Number</span><strong>{displayEntityName(familyDetail?.contact_number ?? selectedFamily.contact_number, "None")}</strong></div>
                    <div><span>Address / Purok</span><strong>{displayEntityName(familyDetail?.address ?? selectedFamily.address, "Not recorded")}</strong></div>
                    <div><span>Registered Members</span><strong>{(familyDetail?.members || []).length || familyDetail?.member_count || selectedFamily.member_count || 1} people</strong></div>
                  </div>

                  {/* Evacuation Assignment Card */}
                  {(() => {
                    const targetFamily = familyDetail || selectedFamily;
                    const isFamilyAssigned = Boolean(
                      (targetFamily?.assigned_members && targetFamily.assigned_members > 0) ||
                      targetFamily?.current_room_id ||
                      (Array.isArray(targetFamily?.assignments) && targetFamily.assignments.length > 0) ||
                      targetFamily?.current_room ||
                      targetFamily?.rooms ||
                      targetFamily?.current_center ||
                      targetFamily?.evacuation_center ||
                      (targetFamily?.evacuation_status && (
                        targetFamily.evacuation_status.toLowerCase().includes("assigned") ||
                        targetFamily.evacuation_status.toLowerCase().includes("evacuated")
                      ))
                    );

                    const assignedCenter =
                      targetFamily?.current_center ||
                      targetFamily?.evacuation_center ||
                      targetFamily?.assignments?.[0]?.center ||
                      "Assigned Evacuation Center";

                    const rawRoom =
                      targetFamily?.current_room ||
                      targetFamily?.rooms ||
                      targetFamily?.assignments?.[0]?.room ||
                      "—";

                    const assignedRoom =
                      rawRoom && rawRoom !== "—"
                        ? (String(rawRoom).toLowerCase().startsWith("room") ? rawRoom : `Room ${rawRoom}`)
                        : rawRoom;

                    const displayStatus = isFamilyAssigned
                      ? ((targetFamily?.evacuation_status && targetFamily.evacuation_status.toLowerCase().includes("evacuated")) ? targetFamily.evacuation_status : "Assigned")
                      : (targetFamily?.evacuation_status && !targetFamily.evacuation_status.toLowerCase().includes("not assigned") ? targetFamily.evacuation_status : "Not Assigned");

                    return (
                      <div className="fm-assignment-card">
                        <div className="fm-assignment-header">
                          <div>
                            <strong style={{ fontSize: "13px", color: "var(--ink)" }}>Evacuation Assignment</strong>
                            <p style={{ margin: "2px 0 0", fontSize: "11px", color: "var(--muted)" }}>Current shelter placement and room status</p>
                          </div>
                          <span className={`fm-status ${isFamilyAssigned ? "is-assigned" : ""}`}>
                            {displayStatus}
                          </span>
                        </div>

                        {isFamilyAssigned ? (
                          <>
                            <div className="fm-assignment-grid">
                              <div className="fm-stat-box">
                                <span className="fm-stat-label"><FontAwesomeIcon icon={faBuilding} /> Current Center</span>
                                <span className="fm-stat-val" style={{ fontSize: "13px" }}>{assignedCenter}</span>
                              </div>
                              <div className="fm-stat-box">
                                <span className="fm-stat-label"><FontAwesomeIcon icon={faDoorOpen} /> Assigned Room</span>
                                <span className="fm-stat-val">{assignedRoom}</span>
                              </div>
                              <div className="fm-stat-box">
                                <span className="fm-stat-label">Room Capacity</span>
                                <span className="fm-stat-val">{targetFamily?.current_room_capacity ?? targetFamily?.assignments?.[0]?.room_capacity ?? "—"}</span>
                              </div>
                              <div className="fm-stat-box">
                                <span className="fm-stat-label">Room Occupancy</span>
                                <span className="fm-stat-val">{targetFamily?.current_room_occupied ?? targetFamily?.assigned_members ?? "—"}</span>
                              </div>
                              <div className="fm-stat-box">
                                <span className="fm-stat-label">Available Space</span>
                                <span className={`fm-stat-val ${(targetFamily?.current_room_available ?? 1) === 0 ? "is-danger" : "is-success"}`}>
                                  {targetFamily?.current_room_available ?? "—"}
                                </span>
                              </div>
                            </div>

                            <div className="fm-assignment-actions">
                              <button
                                type="button"
                                className="fm-button fm-button-quiet"
                                onClick={() => openMoveModal(targetFamily)}
                                title="Change assigned room or evacuation center"
                              >
                                <FontAwesomeIcon icon={faRightLeft} /> Change Assigned Room
                              </button>
                              <button
                                type="button"
                                className="fm-button fm-button-danger"
                                onClick={() => confirmUnassign(targetFamily)}
                                title="Unassign family from room"
                              >
                                <FontAwesomeIcon icon={faUserMinus} /> Unassign Family
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="fm-banner-info">
                              <FontAwesomeIcon icon={faTriangleExclamation} />
                              <span>This family is not currently assigned to any evacuation center or room.</span>
                            </div>
                            <div className="fm-assignment-actions">
                              <button
                                type="button"
                                className="fm-button fm-button-primary"
                                onClick={() => openAssignModal(targetFamily)}
                              >
                                <FontAwesomeIcon icon={faPlus} /> Assign to Evacuation Center
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })()}

                  {/* Registered Family Members */}
                  <div>
                    <strong style={{ fontSize: "12px", color: "var(--ink)", display: "block", marginBottom: "6px" }}>
                      <FontAwesomeIcon icon={faUsers} /> Registered Members ({(familyDetail?.members || []).length || 1})
                    </strong>
                    <div className="fm-member-list-card">
                      {(familyDetail?.members || []).length === 0 ? (
                        <div className="fm-member-item">
                          <strong>{familyDetail?.head_name || selectedFamily.head_name} (Head)</strong>
                          <span className="fm-member-item-meta">{displayEntityName(familyDetail?.contact_number ?? selectedFamily.contact_number, "No contact")}</span>
                        </div>
                      ) : (
                        (familyDetail?.members || []).map((member) => (
                          <div key={member.id} className="fm-member-item">
                            <div>
                              <strong>{displayEntityName(member.full_name ?? `${member.first_name} ${member.last_name}`, "Unnamed member")}</strong>
                              {member.full_name === (familyDetail?.head_name || selectedFamily.head_name) && (
                                <span style={{ marginLeft: "6px", fontSize: "10px", padding: "1px 5px", background: "#e0f2fe", color: "#0369a1", borderRadius: "3px", fontWeight: "700" }}>Head</span>
                              )}
                            </div>
                            <span className="fm-member-item-meta">
                              {[member.contact_number, member.address].filter(Boolean).join(" · ") || "No additional info"}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
            <footer className="fm-modal-actions">
              <button type="button" className="fm-button fm-button-quiet" onClick={closeModal}>Close</button>
            </footer>
          </section>
        </div>
      )}

      {/* MODAL: EDIT FAMILY DETAILS */}
      {modal === "edit" && (
        <div className="fm-overlay" onMouseDown={(event) => event.target === event.currentTarget && closeModal()}>
          <form className="fm-modal" onSubmit={submitEditFamily}>
            <header className="fm-modal-header">
              <div><p>Family management</p><h3>Edit Family Details</h3></div>
              <button type="button" className="fm-icon-button" onClick={() => setModal("detail")} aria-label="Back"><FontAwesomeIcon icon={faXmark} /></button>
            </header>
            {error && <p className="fm-error" role="alert">{error}</p>}
            <div className="fm-modal-body">
              <label>Head of family<input required maxLength={150} value={editForm.head_name} onChange={(e) => setEditForm({ ...editForm, head_name: e.target.value })} /></label>
              <label>Barangay
                <select value={editForm.barangay_id} onChange={(e) => setEditForm({ ...editForm, barangay_id: e.target.value })}>
                  <option value="">Select barangay</option>
                  {barangays.map((b) => <option key={b.id} value={b.id}>{displayEntityName(b.name, `Barangay ${b.id}`)}</option>)}
                </select>
              </label>
              <label>Contact number<input maxLength={20} value={editForm.contact_number} onChange={(e) => setEditForm({ ...editForm, contact_number: e.target.value })} /></label>
              <label>Address / purok<input maxLength={255} value={editForm.address} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} /></label>
            </div>
            <footer className="fm-modal-actions">
              <button type="button" className="fm-button fm-button-quiet" onClick={() => setModal("detail")} disabled={saving}>Cancel</button>
              <button type="submit" className="fm-button fm-button-primary" disabled={saving}>{saving ? "Saving…" : "Save Changes"}</button>
            </footer>
          </form>
        </div>
      )}

      {/* MODAL: ASSIGN FAMILY TO EVACUATION CENTER & ROOM */}
      {modal === "assign" && (
        <div className="fm-overlay" onMouseDown={(event) => event.target === event.currentTarget && closeModal()}>
          <form className="fm-modal" onSubmit={submitAssignment}>
            <header className="fm-modal-header">
              <div>
                <p>Evacuation Assignment</p>
                <h3>Assign Family to Room</h3>
              </div>
              <button type="button" className="fm-icon-button" onClick={() => setModal("detail")} aria-label="Back"><FontAwesomeIcon icon={faXmark} /></button>
            </header>
            {error && <p className="fm-error" role="alert">{error}</p>}
            <div className="fm-modal-body">
              <div className="fm-banner-info">
                <span>Assigning <strong>{(familyDetail || selectedFamily)?.head_name}</strong> (<strong>{assignFamilyMembers}</strong> members) to an evacuation room.</span>
              </div>

              <label>
                Evacuation Center
                <select
                  required
                  value={assignCenterId}
                  onChange={(e) => handleAssignCenterChange(e.target.value)}
                  disabled={loadingCenters}
                >
                  <option value="">{loadingCenters ? "Loading centers…" : "Select evacuation center"}</option>
                  {centersList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.barangay ? `(${c.barangay})` : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Room
                <select
                  required
                  value={assignRoomId}
                  onChange={(e) => setAssignRoomId(e.target.value)}
                  disabled={!assignCenterId || loadingAssignRooms}
                >
                  <option value="">
                    {!assignCenterId
                      ? "Select a center first"
                      : loadingAssignRooms
                      ? "Loading rooms…"
                      : assignRooms.length === 0
                      ? "No active rooms available in this center"
                      : "Select room"}
                  </option>
                  {assignRooms.map((r) => {
                    const avail = r.available ?? Math.max(r.capacity - (r.occupied || 0), 0);
                    return (
                      <option key={r.id} value={r.id}>
                        Room {r.room_number} (Capacity: {r.capacity} | Available: {avail} spaces)
                      </option>
                    );
                  })}
                </select>
              </label>

              {/* Real-time Room Capacity Summary */}
              {selectedAssignRoom && (
                <div className="fm-assignment-card" style={{ marginTop: "4px" }}>
                  <strong style={{ fontSize: "11px", textTransform: "uppercase", color: "var(--muted)" }}>Room Capacity Preview</strong>
                  <div className="fm-assignment-grid">
                    <div className="fm-stat-box">
                      <span className="fm-stat-label">Total Capacity</span>
                      <span className="fm-stat-val">{selectedAssignRoom.capacity}</span>
                    </div>
                    <div className="fm-stat-box">
                      <span className="fm-stat-label">Current Occupancy</span>
                      <span className="fm-stat-val">{selectedAssignRoom.occupied || 0}</span>
                    </div>
                    <div className="fm-stat-box">
                      <span className="fm-stat-label">Available Spaces</span>
                      <span className="fm-stat-val is-success">{assignRoomAvailable}</span>
                    </div>
                    <div className="fm-stat-box">
                      <span className="fm-stat-label">After Assignment</span>
                      <span className={`fm-stat-val ${assignRoomAvailable - assignFamilyMembers < 0 ? "is-danger" : "is-success"}`}>
                        {assignRoomAvailable - assignFamilyMembers}
                      </span>
                    </div>
                  </div>

                  {!assignHasCapacity ? (
                    <div className="fm-banner-danger">
                      <FontAwesomeIcon icon={faTriangleExclamation} />
                      <span>
                        Room capacity exceeded! This room only has <strong>{assignRoomAvailable}</strong> spaces available, but this family has <strong>{assignFamilyMembers}</strong> members. Please select a larger room.
                      </span>
                    </div>
                  ) : (
                    <div className="fm-banner-info">
                      <FontAwesomeIcon icon={faCheckCircle} />
                      <span>Room has sufficient capacity for all {assignFamilyMembers} family members.</span>
                    </div>
                  )}
                </div>
              )}
            </div>
            <footer className="fm-modal-actions">
              <button type="button" className="fm-button fm-button-quiet" onClick={() => setModal("detail")} disabled={assigning}>Cancel</button>
              <button
                type="submit"
                className="fm-button fm-button-primary"
                disabled={assigning || !assignRoomId || !assignHasCapacity}
              >
                {assigning ? "Assigning…" : "Confirm Assignment"}
              </button>
            </footer>
          </form>
        </div>
      )}

      {/* MODAL: MOVE FAMILY TO ANOTHER ROOM / CENTER */}
      {modal === "move" && (
        <div className="fm-overlay" onMouseDown={(event) => event.target === event.currentTarget && closeModal()}>
          <form className="fm-modal" onSubmit={handleMoveSubmit}>
            <header className="fm-modal-header">
              <div>
                <p>Change Assignment</p>
                <h3>Change Assigned Room</h3>
              </div>
              <button type="button" className="fm-icon-button" onClick={() => setModal("detail")} aria-label="Back"><FontAwesomeIcon icon={faXmark} /></button>
            </header>
            {error && <p className="fm-error" role="alert">{error}</p>}
            <div className="fm-modal-body">
              <div className="fm-banner-info">
                <span>
                  Changing assigned room for <strong>{(familyDetail || selectedFamily)?.head_name}</strong> (<strong>{moveFamilyMembers}</strong> members).
                </span>
              </div>

              <label>
                Destination Evacuation Center
                <select
                  required
                  value={targetCenterId}
                  onChange={(e) => handleTargetCenterChange(e.target.value)}
                  disabled={loadingCenters}
                >
                  <option value="">{loadingCenters ? "Loading centers…" : "Select center"}</option>
                  {centersList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.barangay ? `(${c.barangay})` : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Destination Room
                <select
                  required
                  value={targetRoomId}
                  onChange={(e) => setTargetRoomId(e.target.value)}
                  disabled={!targetCenterId || loadingTargetRooms}
                >
                  <option value="">
                    {!targetCenterId
                      ? "Select a center first"
                      : loadingTargetRooms
                      ? "Loading rooms…"
                      : targetRooms.length === 0
                      ? "No other active rooms in this center"
                      : "Select destination room"}
                  </option>
                  {targetRooms.map((r) => {
                    const avail = r.available ?? Math.max(r.capacity - (r.occupied || 0), 0);
                    return (
                      <option key={r.id} value={r.id}>
                        Room {r.room_number} (Capacity: {r.capacity} | Available: {avail} spaces)
                      </option>
                    );
                  })}
                </select>
              </label>

              {/* Destination Room Capacity Preview */}
              {selectedTargetRoom && (
                <div className="fm-assignment-card" style={{ marginTop: "4px" }}>
                  <strong style={{ fontSize: "11px", textTransform: "uppercase", color: "var(--muted)" }}>Destination Room Preview</strong>
                  <div className="fm-assignment-grid">
                    <div className="fm-stat-box">
                      <span className="fm-stat-label">Capacity</span>
                      <span className="fm-stat-val">{selectedTargetRoom.capacity}</span>
                    </div>
                    <div className="fm-stat-box">
                      <span className="fm-stat-label">Occupancy</span>
                      <span className="fm-stat-val">{selectedTargetRoom.occupied || 0}</span>
                    </div>
                    <div className="fm-stat-box">
                      <span className="fm-stat-label">Available</span>
                      <span className="fm-stat-val is-success">{targetRoomAvailable}</span>
                    </div>
                    <div className="fm-stat-box">
                      <span className="fm-stat-label">After Move</span>
                      <span className={`fm-stat-val ${targetRoomAvailable - moveFamilyMembers < 0 ? "is-danger" : "is-success"}`}>
                        {targetRoomAvailable - moveFamilyMembers}
                      </span>
                    </div>
                  </div>

                  {!moveHasCapacity ? (
                    <div className="fm-banner-danger">
                      <FontAwesomeIcon icon={faTriangleExclamation} />
                      <span>
                        Target room capacity exceeded! Room has only <strong>{targetRoomAvailable}</strong> spaces available, but family requires <strong>{moveFamilyMembers}</strong> spaces.
                      </span>
                    </div>
                  ) : (
                    <div className="fm-banner-info">
                      <FontAwesomeIcon icon={faCheckCircle} />
                      <span>Target room has sufficient capacity for this transfer.</span>
                    </div>
                  )}
                </div>
              )}
            </div>
            <footer className="fm-modal-actions">
              <button type="button" className="fm-button fm-button-quiet" onClick={() => setModal("detail")} disabled={moving}>Cancel</button>
              <button
                type="submit"
                className="fm-button fm-button-primary"
                disabled={moving || !targetRoomId || !moveHasCapacity}
              >
                {moving ? "Updating…" : "Change Assigned Room"}
              </button>
            </footer>
          </form>
        </div>
      )}

      {/* CONFIRMATION DIALOG (For Deactivate, Delete, Move, Unassign) */}
      {confirmDialog && (
        <div className="fm-overlay" onMouseDown={(e) => e.target === e.currentTarget && setConfirmDialog(null)}>
          <div className="fm-modal fm-confirm-modal" role="alertdialog" aria-modal="true">
            <header className="fm-modal-header">
              <div>
                <p>Confirmation Required</p>
                <h3>{confirmDialog.title}</h3>
              </div>
              <button type="button" className="fm-icon-button" onClick={() => setConfirmDialog(null)} aria-label="Close">
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </header>
            <div className="fm-modal-body">
              <p style={{ margin: 0, fontSize: "12.5px", lineHeight: "1.5", color: "var(--ink)" }}>
                {confirmDialog.message}
              </p>
            </div>
            <footer className="fm-modal-actions">
              <button type="button" className="fm-button fm-button-quiet" onClick={() => setConfirmDialog(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={`fm-button ${confirmDialog.danger ? "fm-button-danger" : "fm-button-primary"}`}
                onClick={async () => {
                  if (confirmDialog.onConfirm) await confirmDialog.onConfirm();
                }}
              >
                {confirmDialog.confirmText || "Confirm"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}